// Windows MCP/hook hosts spawn the configured command with piped stdio and
// typically without CREATE_NO_WINDOW. npm's *.cmd shims are console programs,
// so `cmd /c maestro-mcp` allocates a visible conhost that flashes then exits.
// Launch node.exe + the package JS entry instead; Unix keeps PATH binaries.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface McpLaunch {
  command: string;
  args: string[];
}

export interface McpLaunchOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  packageRoot?: string;
}

function isMaestroFlowRoot(dir: string): boolean {
  if (!existsSync(join(dir, 'bin', 'maestro-mcp.js'))) return false;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { name?: string };
    return pkg.name === 'maestro-flow' || pkg.name === 'maestro';
  } catch {
    return false;
  }
}

export function resolveMaestroPackageRoot(fromFile = fileURLToPath(import.meta.url)): string {
  let dir = dirname(fromFile);
  for (let i = 0; i < 10; i++) {
    if (isMaestroFlowRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Cannot resolve maestro-flow package root (bin/maestro-mcp.js missing)');
}

export function resolveMaestroMcpLaunch(opts: McpLaunchOptions = {}): McpLaunch {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') {
    return { command: 'maestro-mcp', args: [] };
  }
  const root = opts.packageRoot ?? resolveMaestroPackageRoot();
  const execPath = opts.execPath ?? process.execPath;
  return { command: execPath, args: [join(root, 'bin', 'maestro-mcp.js')] };
}

function quoteWin(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function winNodeScriptCommand(scriptName: string, extraArgs: string[], opts: McpLaunchOptions): string {
  const execPath = opts.execPath ?? process.execPath;
  const root = opts.packageRoot ?? resolveMaestroPackageRoot();
  return [quoteWin(execPath), quoteWin(join(root, 'bin', scriptName)), ...extraArgs].join(' ');
}

export function maestroHookCommand(name: string, opts: McpLaunchOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return `maestro hooks run ${name}`;
  return winNodeScriptCommand('maestro.js', ['hooks', 'run', name], opts);
}

export function maestroStatuslineCommand(opts: McpLaunchOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return 'maestro-statusline';
  return winNodeScriptCommand('maestro-statusline.js', [], opts);
}
