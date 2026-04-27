/**
 * MCP Routes — Handles all MCP server management API endpoints.
 *
 * Ported from ccw's mcp-routes.ts, adapted to Hono framework.
 * Manages MCP server configs across Claude (.claude.json, .mcp.json),
 * Codex (config.toml), and enterprise managed-mcp.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { Hono } from 'hono';
import * as TemplateStore from './mcp-templates-store.js';

// ---------------------------------------------------------------------------
// Config paths
// ---------------------------------------------------------------------------
const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');

/**
 * Resolve Codex CLI config path across platforms:
 * - All platforms: ~/.codex/config.toml (primary)
 * - Linux: $XDG_CONFIG_HOME/codex/config.toml (fallback)
 */
function resolveCodexConfigPath(): string {
  const primary = join(homedir(), '.codex', 'config.toml');
  if (existsSync(primary)) return primary;
  // XDG fallback (Linux)
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    const xdgPath = join(xdg, 'codex', 'config.toml');
    if (existsSync(xdgPath)) return xdgPath;
  }
  return primary; // default even if not found
}

// ---------------------------------------------------------------------------
// TOML Parser (for Codex config.toml)
// ---------------------------------------------------------------------------

function parseToml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].split('.');
      let obj = result as Record<string, unknown>;
      for (const part of currentSection) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part] as Record<string, unknown>;
      }
      continue;
    }

    const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      let obj = result as Record<string, unknown>;
      for (const part of currentSection) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part] as Record<string, unknown>;
      }
      obj[kvMatch[1]] = parseTomlValue(kvMatch[2].trim());
    }
  }
  return result;
}

function parseTomlValue(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"'))
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value))
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const items: unknown[] = [];
    let depth = 0,
      current = '',
      inStr = false,
      strChar = '';
    for (const ch of inner) {
      if (!inStr && (ch === '"' || ch === "'")) {
        inStr = true;
        strChar = ch;
        current += ch;
      } else if (inStr && ch === strChar) {
        inStr = false;
        current += ch;
      } else if (!inStr && (ch === '[' || ch === '{')) {
        depth++;
        current += ch;
      } else if (!inStr && (ch === ']' || ch === '}')) {
        depth--;
        current += ch;
      } else if (!inStr && ch === ',' && depth === 0) {
        items.push(parseTomlValue(current.trim()));
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) items.push(parseTomlValue(current.trim()));
    return items;
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return {};
    const table: Record<string, unknown> = {};
    for (const pair of inner.split(',')) {
      const m = pair.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
      if (m) table[m[1]] = parseTomlValue(m[2].trim());
    }
    return table;
  }
  return value;
}

// ---------------------------------------------------------------------------
// TOML Serializer
// ---------------------------------------------------------------------------

function serializeToml(obj: Record<string, unknown>, prefix = ''): string {
  let result = '';
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const sectionKey = prefix ? `${prefix}.${key}` : key;
      const rec = value as Record<string, unknown>;
      const simple: [string, unknown][] = [];
      const nested: [string, unknown][] = [];
      for (const [sk, sv] of Object.entries(rec)) {
        if (sv === null || sv === undefined) continue;
        if (typeof sv === 'object' && !Array.isArray(sv)) nested.push([sk, sv]);
        else simple.push([sk, sv]);
      }
      if (simple.length > 0) {
        result += `\n[${sectionKey}]\n`;
        for (const [sk, sv] of simple) result += `${sk} = ${serializeTomlVal(sv)}\n`;
      }
      for (const [sk, sv] of nested) {
        result += serializeToml({ [sk]: sv }, sectionKey);
      }
      if (simple.length === 0 && nested.length === 0) result += `\n[${sectionKey}]\n`;
    } else if (!prefix) {
      result += `${key} = ${serializeTomlVal(value)}\n`;
    }
  }
  return result;
}

function serializeTomlVal(v: unknown): string {
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.map(serializeTomlVal).join(', ')}]`;
  if (typeof v === 'object' && v !== null) {
    const pairs = Object.entries(v)
      .filter(([, val]) => val !== null && val !== undefined)
      .map(([k, val]) => `${k} = ${serializeTomlVal(val)}`);
    return `{ ${pairs.join(', ')} }`;
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

function normalizePathForFS(p: string): string {
  let n = p.replace(/\\/g, '/');
  if (n.match(/^\/[a-zA-Z]\//)) n = n.charAt(1).toUpperCase() + ':' + n.slice(2);
  return n;
}

function normalizeProjectPath(p: string): string {
  let n = p.replace(/\\/g, '/');
  if (n.match(/^\/[a-zA-Z]\//)) n = n.charAt(1).toUpperCase() + ':' + n.slice(2);
  return n;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Enterprise managed-mcp.json path
// ---------------------------------------------------------------------------

function getEnterpriseMcpPath(): string {
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-mcp.json';
  if (process.platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-mcp.json';
  return '/etc/claude-code/managed-mcp.json';
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type McpServers = Record<string, Record<string, unknown>>;
type ProjectConfig = { mcpServers?: McpServers; disabledMcpServers?: string[]; mcpJsonPath?: string; hasMcpJson?: boolean; [k: string]: unknown };
type ProjectsConfig = Record<string, ProjectConfig>;
type ConfigSource = { type: string; path: string; count: number };

interface McpConfig {
  projects: ProjectsConfig;
  userServers: McpServers;
  enterpriseServers: McpServers;
  globalServers: McpServers;
  configSources: ConfigSource[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Config readers
// ---------------------------------------------------------------------------

function getMcpConfig(): McpConfig {
  try {
    const result: McpConfig = {
      projects: {},
      userServers: {},
      enterpriseServers: {},
      globalServers: {},
      configSources: [],
    };

    // 1. Enterprise managed-mcp.json
    const ePath = getEnterpriseMcpPath();
    if (existsSync(ePath)) {
      const ec = safeReadJson(ePath);
      if (ec?.mcpServers) {
        result.enterpriseServers = ec.mcpServers as McpServers;
        result.configSources.push({ type: 'enterprise', path: ePath, count: Object.keys(result.enterpriseServers).length });
      }
    }

    // 2. ~/.claude.json
    if (existsSync(CLAUDE_CONFIG_PATH)) {
      const cc = safeReadJson(CLAUDE_CONFIG_PATH);
      if (cc) {
        if (cc.mcpServers) {
          result.userServers = cc.mcpServers as McpServers;
          result.configSources.push({ type: 'user', path: CLAUDE_CONFIG_PATH, count: Object.keys(result.userServers).length });
        }
        if (cc.projects) result.projects = cc.projects as ProjectsConfig;
      }
    }

    // 3. Per-project .mcp.json
    for (const projectPath of Object.keys(result.projects)) {
      const mcpJsonPath = join(projectPath, '.mcp.json');
      if (existsSync(mcpJsonPath)) {
        const mj = safeReadJson(mcpJsonPath);
        if (mj?.mcpServers) {
          const existing = result.projects[projectPath]?.mcpServers ?? {};
          result.projects[projectPath] = {
            ...result.projects[projectPath],
            mcpServers: { ...existing, ...(mj.mcpServers as McpServers) },
            mcpJsonPath,
            hasMcpJson: true,
          };
          result.configSources.push({ type: 'project-mcp-json', path: mcpJsonPath, count: Object.keys(mj.mcpServers as object).length });
        }
      }
    }

    // 4. Merge global
    result.globalServers = { ...result.userServers, ...result.enterpriseServers };
    return result;
  } catch (error: unknown) {
    return { projects: {}, globalServers: {}, userServers: {}, enterpriseServers: {}, configSources: [], error: (error as Error).message };
  }
}

function getCodexMcpConfig(): { servers: Record<string, unknown>; configPath: string; exists: boolean } {
  // Re-resolve each time in case config was created since startup
  const configPath = resolveCodexConfigPath();
  try {
    if (!existsSync(configPath)) return { servers: {}, configPath, exists: false };
    const cfg = parseToml(readFileSync(configPath, 'utf-8'));
    return { servers: (cfg.mcp_servers ?? {}) as Record<string, unknown>, configPath, exists: true };
  } catch {
    return { servers: {}, configPath, exists: false };
  }
}

// ---------------------------------------------------------------------------
// Codex CRUD
// ---------------------------------------------------------------------------

function addCodexServer(name: string, serverConfig: Record<string, unknown>): { success?: boolean; error?: string } {
  try {
    const configPath = resolveCodexConfigPath();
    const codexDir = dirname(configPath);
    if (!existsSync(codexDir)) mkdirSync(codexDir, { recursive: true });
    let cfg: Record<string, unknown> = {};
    if (existsSync(configPath)) cfg = parseToml(readFileSync(configPath, 'utf-8'));
    if (!cfg.mcp_servers) cfg.mcp_servers = {};

    const out: Record<string, unknown> = {};
    if (serverConfig.command) {
      out.command = serverConfig.command;
      if (Array.isArray(serverConfig.args) && serverConfig.args.length) out.args = serverConfig.args;
      if (serverConfig.env && typeof serverConfig.env === 'object' && Object.keys(serverConfig.env).length) out.env = serverConfig.env;
      if (serverConfig.cwd) out.cwd = serverConfig.cwd;
    }
    if (serverConfig.url) {
      out.url = serverConfig.url;
      if (serverConfig.bearer_token_env_var) out.bearer_token_env_var = serverConfig.bearer_token_env_var;
      if (serverConfig.http_headers) out.http_headers = serverConfig.http_headers;
      if (serverConfig.env_http_headers) out.env_http_headers = serverConfig.env_http_headers;
      if (serverConfig.headers) out.http_headers = { ...(out.http_headers as Record<string, unknown> ?? {}), ...(serverConfig.headers as Record<string, unknown>) };
      if (serverConfig.type) out.type = serverConfig.type;
    }
    for (const k of ['startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'enabled_tools', 'disabled_tools']) {
      if (serverConfig[k] !== undefined) out[k] = serverConfig[k];
    }

    (cfg.mcp_servers as Record<string, unknown>)[name] = out;
    writeFileSync(configPath, serializeToml(cfg), 'utf-8');
    return { success: true };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function removeCodexServer(name: string): { success?: boolean; error?: string } {
  try {
    const configPath = resolveCodexConfigPath();
    if (!existsSync(configPath)) return { error: 'config.toml not found' };
    const cfg = parseToml(readFileSync(configPath, 'utf-8'));
    const servers = cfg.mcp_servers as Record<string, unknown> | undefined;
    if (!servers?.[name]) return { error: `Server not found: ${name}` };
    delete servers[name];
    writeFileSync(configPath, serializeToml(cfg), 'utf-8');
    return { success: true };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function toggleCodexServer(name: string, enabled: boolean): { success?: boolean; error?: string } {
  try {
    const configPath = resolveCodexConfigPath();
    if (!existsSync(configPath)) return { error: 'config.toml not found' };
    const cfg = parseToml(readFileSync(configPath, 'utf-8'));
    const servers = cfg.mcp_servers as Record<string, Record<string, unknown>> | undefined;
    if (!servers?.[name]) return { error: `Server not found: ${name}` };
    servers[name].enabled = enabled;
    writeFileSync(configPath, serializeToml(cfg), 'utf-8');
    return { success: true };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Claude/Project CRUD
// ---------------------------------------------------------------------------

function addToMcpJson(projectPath: string, name: string, config: unknown) {
  try {
    const p = normalizePathForFS(projectPath);
    const fp = join(p, '.mcp.json');
    const mj = safeReadJson(fp) ?? { mcpServers: {} };
    if (!mj.mcpServers) mj.mcpServers = {};
    (mj.mcpServers as Record<string, unknown>)[name] = config;
    writeFileSync(fp, JSON.stringify(mj, null, 2), 'utf-8');
    return { success: true, serverName: name, scope: 'project-mcp-json', path: fp };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function removeFromMcpJson(projectPath: string, name: string) {
  try {
    const p = normalizePathForFS(projectPath);
    const fp = join(p, '.mcp.json');
    if (!existsSync(fp)) return { error: '.mcp.json not found' };
    const mj = safeReadJson(fp);
    if (!(mj?.mcpServers as Record<string, unknown> | undefined)?.[name]) return { error: `Server not found: ${name}` };
    delete (mj!.mcpServers as Record<string, unknown>)[name];
    writeFileSync(fp, JSON.stringify(mj, null, 2), 'utf-8');
    return { success: true, serverName: name, scope: 'project-mcp-json' };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function addProjectServer(projectPath: string, name: string, config: unknown, legacy = false) {
  if (!legacy) return addToMcpJson(projectPath, name, config);
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) return { error: '.claude.json not found' };
    const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    const np = normalizeProjectPath(projectPath);
    if (!cc.projects) cc.projects = {};
    if (!cc.projects[np]) cc.projects[np] = { mcpServers: {} };
    if (!cc.projects[np].mcpServers) cc.projects[np].mcpServers = {};
    cc.projects[np].mcpServers[name] = config;
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
    return { success: true, serverName: name, scope: 'project-legacy' };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function removeProjectServer(projectPath: string, name: string) {
  try {
    const pfs = normalizePathForFS(projectPath);
    const mcpFp = join(pfs, '.mcp.json');
    let removedMcp = false;
    let removedClaude = false;

    if (existsSync(mcpFp)) {
      const mj = safeReadJson(mcpFp);
      if ((mj?.mcpServers as Record<string, unknown> | undefined)?.[name]) {
        const r = removeFromMcpJson(projectPath, name);
        if ('success' in r && r.success) removedMcp = true;
      }
    }

    if (existsSync(CLAUDE_CONFIG_PATH)) {
      const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
      const np = normalizeProjectPath(projectPath);
      let matchedKey: string | null = null;
      if (cc.projects) {
        for (const k of Object.keys(cc.projects)) {
          if (normalizeProjectPath(k) === np) { matchedKey = k; break; }
        }
      }
      if (matchedKey && cc.projects[matchedKey]?.mcpServers?.[name]) {
        delete cc.projects[matchedKey].mcpServers[name];
        if (cc.projects[matchedKey].disabledMcpServers) {
          cc.projects[matchedKey].disabledMcpServers = cc.projects[matchedKey].disabledMcpServers.filter((s: string) => s !== name);
        }
        writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
        removedClaude = true;
      }
    }

    if (removedMcp || removedClaude) {
      return { success: true, serverName: name, removedFrom: removedMcp && removedClaude ? 'both' : removedMcp ? '.mcp.json' : '.claude.json' };
    }
    return { error: `Server not found: ${name}` };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function addGlobalServer(name: string, config: unknown) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) return { error: '.claude.json not found' };
    const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    if (!cc.mcpServers) cc.mcpServers = {};
    cc.mcpServers[name] = config;
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
    return { success: true, serverName: name, scope: 'global' };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function removeGlobalServer(name: string) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) return { error: '.claude.json not found' };
    const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    if (!cc.mcpServers?.[name]) return { error: `Global server not found: ${name}` };
    delete cc.mcpServers[name];
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
    return { success: true, serverName: name, scope: 'global' };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function toggleProjectServer(projectPath: string, name: string, enable: boolean) {
  try {
    if (!existsSync(CLAUDE_CONFIG_PATH)) return { error: '.claude.json not found' };
    const cc = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    const np = normalizeProjectPath(projectPath);
    let matchedKey: string | null = null;
    if (cc.projects) {
      for (const k of Object.keys(cc.projects)) {
        if (normalizeProjectPath(k) === np) { matchedKey = k; break; }
      }
    }
    if (!matchedKey || !cc.projects[matchedKey]) return { error: `Project not found: ${np}` };
    const pc = cc.projects[matchedKey];
    if (!pc.disabledMcpServers) pc.disabledMcpServers = [];
    if (enable) {
      pc.disabledMcpServers = pc.disabledMcpServers.filter((s: string) => s !== name);
    } else if (!pc.disabledMcpServers.includes(name)) {
      pc.disabledMcpServers.push(name);
    }
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf-8');
    return { success: true, serverName: name, enabled: enable };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createMcpRoutes(): Hono {
  const app = new Hono();

  // -----------------------------------------------------------------------
  // Config retrieval
  // -----------------------------------------------------------------------

  app.get('/api/mcp-config', (c) => {
    const mcpData = getMcpConfig();
    const codexData = getCodexMcpConfig();
    return c.json({ ...mcpData, codex: codexData });
  });

  app.get('/api/codex-mcp-config', (c) => {
    return c.json(getCodexMcpConfig());
  });

  // -----------------------------------------------------------------------
  // Codex CRUD
  // -----------------------------------------------------------------------

  app.post('/api/codex-mcp-add', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const { serverName, serverConfig } = body;
    if (typeof serverName !== 'string' || !serverName.trim()) return c.json({ error: 'serverName required' }, 400);
    if (!serverConfig || typeof serverConfig !== 'object') return c.json({ error: 'serverConfig required' }, 400);
    return c.json(addCodexServer(serverName, serverConfig as Record<string, unknown>));
  });

  app.post('/api/codex-mcp-remove', async (c) => {
    const { serverName } = await c.req.json<{ serverName?: string }>();
    if (typeof serverName !== 'string' || !serverName.trim()) return c.json({ error: 'serverName required' }, 400);
    return c.json(removeCodexServer(serverName));
  });

  app.post('/api/codex-mcp-toggle', async (c) => {
    const { serverName, enabled } = await c.req.json<{ serverName?: string; enabled?: boolean }>();
    if (typeof serverName !== 'string' || typeof enabled !== 'boolean') return c.json({ error: 'serverName and enabled required' }, 400);
    return c.json(toggleCodexServer(serverName, enabled));
  });

  // -----------------------------------------------------------------------
  // Project / Global server CRUD
  // -----------------------------------------------------------------------

  app.post('/api/mcp-toggle', async (c) => {
    const { projectPath, serverName, enable } = await c.req.json<{ projectPath?: string; serverName?: string; enable?: boolean }>();
    if (typeof projectPath !== 'string' || typeof serverName !== 'string' || typeof enable !== 'boolean')
      return c.json({ error: 'projectPath, serverName, enable required' }, 400);
    return c.json(toggleProjectServer(projectPath, serverName, enable));
  });

  app.post('/api/mcp-copy-server', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const { projectPath, serverName, serverConfig, configType } = body;
    if (typeof projectPath !== 'string' || typeof serverName !== 'string' || !serverConfig)
      return c.json({ error: 'projectPath, serverName, serverConfig required' }, 400);
    return c.json(addProjectServer(projectPath as string, serverName as string, serverConfig, configType === 'claude'));
  });

  app.post('/api/mcp-remove-server', async (c) => {
    const { projectPath, serverName } = await c.req.json<{ projectPath?: string; serverName?: string }>();
    if (typeof projectPath !== 'string' || typeof serverName !== 'string')
      return c.json({ error: 'projectPath, serverName required' }, 400);
    return c.json(removeProjectServer(projectPath, serverName));
  });

  app.post('/api/mcp-add-global-server', async (c) => {
    const { serverName, serverConfig } = await c.req.json<{ serverName?: string; serverConfig?: unknown }>();
    if (typeof serverName !== 'string' || !serverConfig)
      return c.json({ error: 'serverName, serverConfig required' }, 400);
    return c.json(addGlobalServer(serverName, serverConfig));
  });

  app.post('/api/mcp-remove-global-server', async (c) => {
    const { serverName } = await c.req.json<{ serverName?: string }>();
    if (typeof serverName !== 'string') return c.json({ error: 'serverName required' }, 400);
    return c.json(removeGlobalServer(serverName));
  });

  app.post('/api/mcp-update-server', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const { scope, serverName, serverConfig, projectPath } = body;
    if (typeof serverName !== 'string' || !serverName.trim()) return c.json({ error: 'serverName required' }, 400);
    if (!serverConfig || typeof serverConfig !== 'object') return c.json({ error: 'serverConfig required' }, 400);

    if (scope === 'global') {
      return c.json(addGlobalServer(serverName, serverConfig));
    }
    if (scope === 'project') {
      if (typeof projectPath !== 'string' || !projectPath.trim()) return c.json({ error: 'projectPath required for project scope' }, 400);
      return c.json(addProjectServer(projectPath, serverName, serverConfig));
    }
    if (scope === 'codex') {
      return c.json(addCodexServer(serverName, serverConfig as Record<string, unknown>));
    }
    return c.json({ error: 'Invalid scope' }, 400);
  });

  // -----------------------------------------------------------------------
  // Maestro MCP install (replaces ccw-tools install)
  // -----------------------------------------------------------------------

  app.post('/api/mcp-install-maestro', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const rawScope = body.scope as string | undefined;
    const projectPath = body.projectPath as string | undefined;
    const envInput = (typeof body.env === 'object' && body.env ? body.env : body) as Record<string, unknown>;

    const enabledToolsRaw = envInput.enabledTools;
    let enabledToolsEnv: string;
    if (enabledToolsRaw === undefined || enabledToolsRaw === null) {
      enabledToolsEnv = 'write_file,edit_file,read_file,read_many_files,team_msg';
    } else if (Array.isArray(enabledToolsRaw)) {
      enabledToolsEnv = enabledToolsRaw.filter((t): t is string => typeof t === 'string').join(',');
    } else if (typeof enabledToolsRaw === 'string') {
      enabledToolsEnv = enabledToolsRaw;
    } else {
      enabledToolsEnv = 'write_file,edit_file,read_file,read_many_files,team_msg';
    }

    const isWin = process.platform === 'win32';
    const env: Record<string, string> = { MAESTRO_ENABLED_TOOLS: enabledToolsEnv };
    const projectRoot = typeof envInput.projectRoot === 'string' ? envInput.projectRoot : undefined;
    if (projectRoot) env.MAESTRO_PROJECT_ROOT = projectRoot;

    const mcpConfig: Record<string, unknown> = {
      command: isWin ? 'cmd' : 'npx',
      args: isWin ? ['/c', 'npx', '-y', 'maestro-mcp'] : ['-y', 'maestro-mcp'],
      env,
    };

    const scope = rawScope === 'global' || rawScope === 'project' ? rawScope : (projectPath ? 'project' : 'global');
    if (scope === 'project') {
      if (!projectPath?.trim()) return c.json({ error: 'projectPath required for project scope' }, 400);
      return c.json(addProjectServer(projectPath, 'maestro-tools', mcpConfig));
    }
    return c.json(addGlobalServer('maestro-tools', mcpConfig));
  });

  // -----------------------------------------------------------------------
  // Templates CRUD
  // -----------------------------------------------------------------------

  app.get('/api/mcp-templates', async (c) => {
    return c.json({ success: true, templates: await TemplateStore.getAllTemplates() });
  });

  app.post('/api/mcp-templates', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const { name, serverConfig, description, tags, category } = body;
    if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'name required' }, 400);
    if (!serverConfig || typeof (serverConfig as Record<string, unknown>).command !== 'string')
      return c.json({ error: 'serverConfig.command required' }, 400);
    return c.json(
      await TemplateStore.saveTemplate({
        name: name as string,
        description: typeof description === 'string' ? description : undefined,
        serverConfig: serverConfig as TemplateStore.McpTemplate['serverConfig'],
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : undefined,
        category: typeof category === 'string' ? category : undefined,
      }),
    );
  });

  app.get('/api/mcp-templates/search', async (c) => {
    const q = c.req.query('q') ?? '';
    return c.json({ success: true, templates: await TemplateStore.searchTemplates(q) });
  });

  app.get('/api/mcp-templates/categories', async (c) => {
    return c.json({ success: true, categories: await TemplateStore.getAllCategories() });
  });

  app.get('/api/mcp-templates/category/:cat', async (c) => {
    return c.json({ success: true, templates: await TemplateStore.getTemplatesByCategory(c.req.param('cat')) });
  });

  app.get('/api/mcp-templates/:name', async (c) => {
    const t = await TemplateStore.getTemplateByName(c.req.param('name'));
    if (!t) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, template: t });
  });

  app.delete('/api/mcp-templates/:name', async (c) => {
    const result = await TemplateStore.deleteTemplate(c.req.param('name'));
    return c.json(result, result.success ? 200 : 404);
  });

  app.post('/api/mcp-templates/install', async (c) => {
    const { templateName, projectPath, scope } = await c.req.json<{ templateName?: string; projectPath?: string; scope?: string }>();
    if (typeof templateName !== 'string' || !templateName.trim()) return c.json({ error: 'templateName required' }, 400);
    const tpl = await TemplateStore.getTemplateByName(templateName);
    if (!tpl) return c.json({ error: 'Template not found' }, 404);
    if (scope === 'global') return c.json(addGlobalServer(templateName, tpl.serverConfig));
    if (typeof projectPath !== 'string' || !projectPath.trim()) return c.json({ error: 'projectPath required for project scope' }, 400);
    return c.json(addProjectServer(projectPath, templateName, tpl.serverConfig));
  });

  // -----------------------------------------------------------------------
  // Platform utilities
  // -----------------------------------------------------------------------

  app.post('/api/mcp/detect-commands', (_c) => {
    const isWin = process.platform === 'win32';
    const whichCmd = isWin ? 'where' : 'which';

    const cmds = [
      { name: 'npm', installUrl: 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm' },
      { name: 'node', installUrl: 'https://nodejs.org/' },
      { name: 'python', installUrl: 'https://www.python.org/downloads/' },
      { name: 'npx', installUrl: 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm' },
      { name: 'claude', installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
      { name: 'codex', installUrl: 'https://github.com/openai/codex' },
    ];

    function detectCommand(name: string): boolean {
      // 1. Try which/where
      try {
        execSync(`${whichCmd} ${name}`, { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch { /* not found via PATH */ }

      // 2. For codex: also check npm global + config existence
      if (name === 'codex') {
        // Check if codex config dir exists (indicates prior use)
        const configDir = join(homedir(), '.codex');
        if (existsSync(configDir)) return true;
        // Check npm global
        try {
          execSync(`npm list -g @openai/codex --depth=0`, { stdio: 'ignore', timeout: 10000 });
          return true;
        } catch { /* not installed globally */ }
      }

      // 3. For claude: also check npm global + config existence
      if (name === 'claude') {
        const configPath = join(homedir(), '.claude.json');
        if (existsSync(configPath)) return true;
        try {
          execSync(`npm list -g @anthropic-ai/claude-code --depth=0`, { stdio: 'ignore', timeout: 10000 });
          return true;
        } catch { /* not installed globally */ }
      }

      return false;
    }

    const results = cmds.map((cmd) => {
      const available = detectCommand(cmd.name);
      return { command: cmd.name, available, installUrl: available ? undefined : cmd.installUrl };
    });
    return _c.json(results);
  });

  return app;
}
