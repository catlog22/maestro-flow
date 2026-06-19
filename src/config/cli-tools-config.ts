// ---------------------------------------------------------------------------
// CLI Tools configuration loader
// Reads ~/.maestro/cli-tools.json for tool selection and model routing.
// Supports role-based tool selection and workspace-level config overrides.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import cliToolsDefaults from './cli-tools-defaults.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Domain tags for tool expertise matching. */
export const DOMAIN_TAGS = [
  'frontend', 'backend', 'fullstack', 'devops', 'data', 'mobile', 'infra',
] as const;

export type DomainTag = (typeof DOMAIN_TAGS)[number];

/** Reasoning effort levels for thinking models. */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ToolEntry {
  enabled: boolean;
  primaryModel: string;
  secondaryModel?: string;
  /** Domain expertise tags (frontend, backend, fullstack, etc.) — used by execute for tool selection */
  tags: string[];
  type: string;
  /** Settings file path for the CLI tool (e.g. Claude --settings, Codex --profile) */
  settingsFile?: string;
  /** Base tool name for aliases (e.g. "claude" for "claude-analysis") */
  baseTool?: string;
  /** Reasoning effort level (undefined = tool default).
   *  Translated per-adapter: Claude → --effort, Codex → -c reasoning.effort. */
  reasoningEffort?: ReasoningEffort;
  /** Stale-stream silence window in ms before force-terminating a silent CLI
   *  (undefined = adapter default, 10 min). Overridden by `delegate --timeout`. */
  streamTimeoutMs?: number;
  /** Per-tool proxy toggle. true = inherit global proxy, false = skip proxy for this tool. */
  proxy?: boolean;
}

export interface ProxyConfig {
  enabled: boolean;
  /** HTTP proxy URL (e.g. "http://127.0.0.1:7890") */
  httpProxy?: string;
  /** HTTPS proxy URL (defaults to httpProxy if omitted) */
  httpsProxy?: string;
  /** Comma-separated bypass list (e.g. "127.0.0.1,localhost") */
  noProxy?: string;
}

export interface RoleMapping {
  /** Direct tool name (simplest config) */
  tool?: string;
  /** Ordered fallback tool names */
  fallbackChain?: string[];
}

export interface CliToolsConfig {
  version: string;
  tools: Record<string, ToolEntry>;
  /** User-configurable role → tool mappings */
  roles?: Record<string, RoleMapping>;
  /** Global proxy configuration — injected into CLI subprocess env before spawn */
  proxy?: ProxyConfig;
}

// ---------------------------------------------------------------------------
// Default role mappings
// ---------------------------------------------------------------------------

/** Fixed set of supported roles. */
export const DELEGATE_ROLES = [
  'analyze', 'explore', 'review', 'implement', 'plan', 'brainstorm', 'research',
] as const;

export type DelegateRole = (typeof DELEGATE_ROLES)[number];

// Loaded from cli-tools-defaults.json — edit that file to change defaults.
const DEFAULT_ROLE_MAPPINGS: Record<string, RoleMapping> = cliToolsDefaults.roleMappings as Record<string, RoleMapping>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CliToolsConfig = {
  version: '1.0.0',
  tools: {},
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load CLI tools configuration with workspace-level overrides.
 *
 * Priority: {workDir}/.maestro/cli-tools.json > ~/.maestro/cli-tools.json > DEFAULT_CONFIG
 *
 * Merge strategy:
 * - tools: deep merge (workspace overrides same-name tools)
 * - roles: deep merge (workspace overrides same-name roles)
 */
export async function loadCliToolsConfig(workDir?: string): Promise<CliToolsConfig> {
  // 1. Load global config
  const globalPath = join(homedir(), '.maestro', 'cli-tools.json');
  let global: CliToolsConfig = DEFAULT_CONFIG;
  try {
    const raw = await readFile(globalPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CliToolsConfig>;
    global = { ...DEFAULT_CONFIG, ...parsed, tools: { ...parsed.tools } };
  } catch {
    // No global config — use defaults
  }

  // 2. Load workspace config (if workDir provided)
  if (workDir) {
    const workspacePath = join(workDir, '.maestro', 'cli-tools.json');
    try {
      const raw = await readFile(workspacePath, 'utf-8');
      const workspace = JSON.parse(raw) as Partial<CliToolsConfig>;
      // Merge: workspace overrides global
      global = {
        version: workspace.version ?? global.version,
        tools: { ...global.tools, ...workspace.tools },
        roles: { ...global.roles, ...workspace.roles },
        proxy: workspace.proxy ?? global.proxy,
      };
    } catch {
      // No workspace config — use global as-is
    }
  }

  return global;
}

// ---------------------------------------------------------------------------
// Tool selection
// ---------------------------------------------------------------------------

export interface SelectedTool {
  name: string;
  entry: ToolEntry;
}

/**
 * Select a tool by explicit name or fall back to the first enabled tool.
 * Returns undefined when no tool can be resolved.
 */
export function selectTool(
  name: string | undefined,
  config: CliToolsConfig,
): SelectedTool | undefined {
  const tools = config.tools ?? {};

  // Exact match by name
  if (name && tools[name]?.enabled) {
    return { name, entry: tools[name] };
  }

  // Fallback: first enabled tool in config order
  for (const [toolName, entry] of Object.entries(tools)) {
    if (entry.enabled) {
      return { name: toolName, entry };
    }
  }

  return undefined;
}

/**
 * Select a tool by capability role.
 *
 * Resolution order:
 * 1. User-configured role mapping (config.roles[role])
 * 2. Built-in default role mapping (DEFAULT_ROLE_MAPPINGS[role])
 * 3. If mapping has `tool` → direct selectTool()
 * 4. Walk `fallbackChain` → first enabled tool in chain
 * 5. Last resort → selectTool(undefined) (first enabled)
 */
export function selectToolByRole(
  role: string,
  config: CliToolsConfig,
): SelectedTool | undefined {
  const mapping = config.roles?.[role] ?? DEFAULT_ROLE_MAPPINGS[role];
  if (!mapping) {
    return selectTool(undefined, config);
  }

  // Direct tool name
  if (mapping.tool) {
    return selectTool(mapping.tool, config);
  }

  // Fallback chain: try each named tool in order
  const tools = config.tools ?? {};
  if (mapping.fallbackChain) {
    for (const toolName of mapping.fallbackChain) {
      if (tools[toolName]?.enabled) {
        return { name: toolName, entry: tools[toolName] };
      }
    }
  }

  return selectTool(undefined, config);
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

/**
 * Save CLI tools configuration to a specific scope.
 * Reads existing config, deep-merges the update, and writes back.
 */
export async function saveCliToolsConfig(
  update: Partial<CliToolsConfig>,
  scope: 'global' | 'workspace',
  workDir?: string,
): Promise<void> {
  const configPath = scope === 'global'
    ? join(homedir(), '.maestro', 'cli-tools.json')
    : join(workDir ?? process.cwd(), '.maestro', 'cli-tools.json');

  // Read existing
  let existing: Partial<CliToolsConfig> = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    existing = JSON.parse(raw) as Partial<CliToolsConfig>;
  } catch {
    // No existing config
  }

  // Deep merge — tool entries are field-level merged, not replaced wholesale
  const mergedTools: Record<string, ToolEntry> = { ...existing.tools };
  if (update.tools) {
    for (const [name, entry] of Object.entries(update.tools)) {
      mergedTools[name] = { ...mergedTools[name], ...entry } as ToolEntry;
    }
  }
  const merged: CliToolsConfig = {
    version: update.version ?? existing.version ?? '1.1.0',
    tools: mergedTools,
    roles: { ...existing.roles, ...update.roles },
    proxy: update.proxy ?? existing.proxy,
  };

  // Ensure directory exists and write
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(merged, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

/** Expose default role mappings for TUI display. */
export function getDefaultRoleMappings(): Record<string, RoleMapping> {
  return { ...DEFAULT_ROLE_MAPPINGS };
}

/**
 * Rank enabled tools by domain tag relevance.
 * Returns tools sorted: exact tag match first, then fullstack, then rest.
 * Used by `maestro execute` to suggest the best tool for a task domain.
 */
export function rankToolsByDomain(
  domain: string,
  config: CliToolsConfig,
): SelectedTool[] {
  const exact: SelectedTool[] = [];
  const fullstack: SelectedTool[] = [];
  const rest: SelectedTool[] = [];

  for (const [name, entry] of Object.entries(config.tools ?? {})) {
    if (!entry.enabled) continue;
    const tool: SelectedTool = { name, entry };
    if (entry.tags.includes(domain)) {
      exact.push(tool);
    } else if (entry.tags.includes('fullstack')) {
      fullstack.push(tool);
    } else {
      rest.push(tool);
    }
  }

  return [...exact, ...fullstack, ...rest];
}

// ---------------------------------------------------------------------------
// Proxy env resolution
// ---------------------------------------------------------------------------

/**
 * Build proxy environment variable overrides for a specific tool.
 * Returns an empty object when proxy is disabled globally or for the tool.
 */
export function resolveProxyEnv(
  config: CliToolsConfig,
  toolName: string,
): Record<string, string> {
  const proxy = config.proxy;
  if (!proxy?.enabled) return {};

  const toolEntry = config.tools?.[toolName];
  if (toolEntry?.proxy === false) return {};

  const env: Record<string, string> = {};
  const httpUrl = proxy.httpProxy;
  const httpsUrl = proxy.httpsProxy ?? httpUrl;

  if (httpUrl) {
    env.HTTP_PROXY = httpUrl;
    env.http_proxy = httpUrl;
  }
  if (httpsUrl) {
    env.HTTPS_PROXY = httpsUrl;
    env.https_proxy = httpsUrl;
  }
  if (proxy.noProxy) {
    env.NO_PROXY = proxy.noProxy;
    env.no_proxy = proxy.noProxy;
  }

  return env;
}

/**
 * Quick TCP probe to check if the proxy is reachable.
 * Returns true if a connection can be established within the timeout.
 */
export async function checkProxyReachable(
  proxyUrl: string,
  timeoutMs = 3000,
): Promise<boolean> {
  let host: string;
  let port: number;
  try {
    const url = new URL(proxyUrl);
    host = url.hostname;
    port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    return false;
  }

  const { createConnection } = await import('node:net');
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Load global and workspace configs separately (un-merged) for introspection. */
export async function loadConfigSources(workDir?: string): Promise<{
  globalPath: string;
  global: Partial<CliToolsConfig> | null;
  workspacePath: string | null;
  workspace: Partial<CliToolsConfig> | null;
}> {
  const gp = join(homedir(), '.maestro', 'cli-tools.json');
  let g: Partial<CliToolsConfig> | null = null;
  try { g = JSON.parse(await readFile(gp, 'utf-8')); } catch { /* */ }

  let wp: string | null = null;
  let w: Partial<CliToolsConfig> | null = null;
  if (workDir) {
    wp = join(workDir, '.maestro', 'cli-tools.json');
    try { w = JSON.parse(await readFile(wp, 'utf-8')); } catch { /* */ }
  }

  return { globalPath: gp, global: g, workspacePath: wp, workspace: w };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/** CLI tool definitions — loaded from cli-tools-defaults.json. */
const TOOL_DEFS: Array<{ name: string; cmd: string; primaryModel: string; tags: string[]; type: string }> =
  cliToolsDefaults.tools as Array<{ name: string; cmd: string; primaryModel: string; tags: string[]; type: string }>;

function isCliAvailable(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset ~/.maestro/cli-tools.json to defaults.
 * Re-detects CLI availability and overwrites the existing file.
 * Returns the new config.
 */
export async function resetCliToolsConfig(): Promise<CliToolsConfig> {
  const tools: Record<string, ToolEntry> = {};
  for (const def of TOOL_DEFS) {
    tools[def.name] = {
      enabled: isCliAvailable(def.cmd),
      primaryModel: def.primaryModel,
      tags: def.tags,
      type: def.type,
    };
  }

  const config: CliToolsConfig = { version: '1.1.0', tools };
  const configPath = join(homedir(), '.maestro', 'cli-tools.json');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  return config;
}

export interface InitResult {
  /** Whether the file was created or modified. */
  changed: boolean;
  /** Tool names newly added (empty for first-time create or no-op). */
  added: string[];
  /** True when the file did not exist before this call. */
  created: boolean;
}

function buildDefaultTools(): Record<string, ToolEntry> {
  const tools: Record<string, ToolEntry> = {};
  for (const def of TOOL_DEFS) {
    tools[def.name] = {
      enabled: isCliAvailable(def.cmd),
      primaryModel: def.primaryModel,
      tags: def.tags,
      type: def.type,
    };
  }
  return tools;
}

function mergeMissingToolDefs(existing: Record<string, ToolEntry>): { merged: Record<string, ToolEntry>; added: string[] } {
  const merged: Record<string, ToolEntry> = { ...existing };
  const added: string[] = [];
  for (const def of TOOL_DEFS) {
    if (merged[def.name]) continue; // preserve user-customized entries verbatim
    merged[def.name] = {
      enabled: isCliAvailable(def.cmd),
      primaryModel: def.primaryModel,
      tags: def.tags,
      type: def.type,
    };
    added.push(def.name);
  }
  return { merged, added };
}

/**
 * Initialize / upgrade ~/.maestro/cli-tools.json.
 *
 * - First install (file missing): create from defaults with availability detection.
 * - Upgrade (file present): merge defaults into existing — only adds tools that
 *   are missing. Existing entries (primaryModel, secondaryModel, settingsFile,
 *   reasoningEffort, tags, enabled) are preserved verbatim.
 *
 * Returns details about what changed.
 */
export async function initCliToolsConfig(): Promise<InitResult> {
  const configPath = join(homedir(), '.maestro', 'cli-tools.json');

  let existingRaw: string | undefined;
  try {
    existingRaw = await readFile(configPath, 'utf-8');
  } catch {
    // file missing — fall through to create
  }

  if (existingRaw === undefined) {
    const config: CliToolsConfig = { version: '1.1.0', tools: buildDefaultTools() };
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    return { changed: true, added: [], created: true };
  }

  let existing: CliToolsConfig;
  try {
    existing = JSON.parse(existingRaw) as CliToolsConfig;
  } catch {
    // Malformed — leave it alone, don't blow away user data
    return { changed: false, added: [], created: false };
  }

  const { merged, added } = mergeMissingToolDefs(existing.tools ?? {});
  if (added.length === 0) return { changed: false, added: [], created: false };

  const next: CliToolsConfig = { ...existing, version: existing.version ?? '1.1.0', tools: merged };
  await writeFile(configPath, JSON.stringify(next, null, 2) + '\n');
  return { changed: true, added, created: false };
}

/**
 * Synchronous version of initCliToolsConfig for non-async contexts (e.g. forceInstall).
 * Same semantics: first-install creates, upgrade merges only missing tool defs.
 */
export function initCliToolsConfigSync(): InitResult {
  const configPath = join(homedir(), '.maestro', 'cli-tools.json');

  if (!existsSync(configPath)) {
    const config: CliToolsConfig = { version: '1.1.0', tools: buildDefaultTools() };
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return { changed: true, added: [], created: true };
  }

  let existing: CliToolsConfig;
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf-8')) as CliToolsConfig;
  } catch {
    return { changed: false, added: [], created: false };
  }

  const { merged, added } = mergeMissingToolDefs(existing.tools ?? {});
  if (added.length === 0) return { changed: false, added: [], created: false };

  const next: CliToolsConfig = { ...existing, version: existing.version ?? '1.1.0', tools: merged };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
  return { changed: true, added, created: false };
}
