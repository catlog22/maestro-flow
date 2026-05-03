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
    global = JSON.parse(raw) as CliToolsConfig;
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
  // Exact match by name
  if (name && config.tools[name]?.enabled) {
    return { name, entry: config.tools[name] };
  }

  // Fallback: first enabled tool in config order
  for (const [toolName, entry] of Object.entries(config.tools)) {
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
  if (mapping.fallbackChain) {
    for (const toolName of mapping.fallbackChain) {
      if (config.tools[toolName]?.enabled) {
        return { name: toolName, entry: config.tools[toolName] };
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

  for (const [name, entry] of Object.entries(config.tools)) {
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
 * Initialize ~/.maestro/cli-tools.json with auto-detected tool availability.
 * No-op if the file already exists.
 * Returns true if created, false if skipped.
 */
export async function initCliToolsConfig(): Promise<boolean> {
  const configPath = join(homedir(), '.maestro', 'cli-tools.json');
  try {
    await readFile(configPath, 'utf-8');
    return false; // already exists
  } catch {
    // doesn't exist — create it
  }

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
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  return true;
}

/**
 * Synchronous version of initCliToolsConfig for non-async contexts (e.g. forceInstall).
 */
export function initCliToolsConfigSync(): boolean {
  const configPath = join(homedir(), '.maestro', 'cli-tools.json');
  if (existsSync(configPath)) return false;

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
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return true;
}
