import { existsSync, readdirSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface MemoryMcpLaunch {
  command: string;
  args: string[];
  server: string;
}

let cachedDefault: MemoryMcpLaunch | null | undefined;

function spawnEnv(env: NodeJS.Dict<string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...env };
}

function whichPython(env: NodeJS.Dict<string | undefined>): string | null {
  const merged = spawnEnv(env);
  for (const command of ['python3', 'python']) {
    try {
      const result = spawnSync(command, ['-c', 'import sys; print(sys.version)'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        env: merged,
      });
      if (result.status === 0 && (result.stdout ?? '').trim()) return command;
    } catch {
      /* try next */
    }
  }
  return null;
}

function findStdioServer(home: string): string | null {
  const roots = [
    join(home, '.grok', 'installed-plugins'),
    join(home, '.claude', 'plugins'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const candidate = join(root, name, 'lib', 'mcp_server.py');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** True unless remote is off, discover is disabled, or we are in Vitest without an explicit opt-in. */
export function shouldDiscoverMemoryMcp(env: NodeJS.Dict<string | undefined> = process.env): boolean {
  const flag = (env.MAESTRO_MEMORY_MCP_DISCOVER ?? process.env.MAESTRO_MEMORY_MCP_DISCOVER ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if ((env.MAESTRO_MEMORY_REMOTE ?? '').trim() === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  if (env.VITEST || process.env.VITEST) return false;
  return true;
}

/**
 * Resolve a host-installed memory MCP stdio server (command + args).
 * Does not name a vendor; any plugin that ships lib/mcp_server.py qualifies.
 */
export function discoverMemoryMcpLaunch(options: {
  env?: NodeJS.Dict<string | undefined>;
  home?: string;
  python?: string | null;
} = {}): MemoryMcpLaunch | null {
  const env = options.env ?? process.env;
  const useCache = options.home === undefined && options.python === undefined && options.env === undefined;
  if (useCache && cachedDefault !== undefined) return cachedDefault;

  const home = options.home ?? env.MAESTRO_MEMORY_MCP_HOME ?? osHomedir();
  const serverPy = findStdioServer(home);
  const python = options.python !== undefined ? options.python : whichPython(env);
  const found = serverPy && python
    ? { command: python, args: [serverPy], server: 'memory' }
    : null;
  if (useCache) cachedDefault = found;
  return found;
}

export function resetMemoryMcpDiscoveryCache(): void {
  cachedDefault = undefined;
}
