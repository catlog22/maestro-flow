import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  maestroHookCommand,
  maestroStatuslineCommand,
  resolveMaestroMcpLaunch,
  resolveMaestroPackageRoot,
} from './mcp-launch.js';

describe('resolveMaestroPackageRoot', () => {
  it('finds the package root that contains bin/maestro-mcp.js', () => {
    const root = resolveMaestroPackageRoot();
    expect(existsSync(join(root, 'bin', 'maestro-mcp.js'))).toBe(true);
    expect(existsSync(join(root, 'bin', 'maestro.js'))).toBe(true);
  });
});

describe('resolveMaestroMcpLaunch', () => {
  it('uses the PATH binary on POSIX', () => {
    expect(resolveMaestroMcpLaunch({ platform: 'linux' })).toEqual({
      command: 'maestro-mcp',
      args: [],
    });
  });

  it('launches node.exe + maestro-mcp.js on Windows instead of cmd /c', () => {
    const execPath = 'C:\\Program Files\\nodejs\\node.exe';
    const packageRoot = 'C:\\Program Files\\nodejs\\node_global\\node_modules\\maestro-flow';
    const launch = resolveMaestroMcpLaunch({ platform: 'win32', execPath, packageRoot });
    expect(launch.command).toBe(execPath);
    expect(launch.args).toEqual([join(packageRoot, 'bin', 'maestro-mcp.js')]);
    expect(launch.command).not.toBe('cmd');
    expect(launch.args).not.toContain('/c');
  });
});

describe('maestroHookCommand', () => {
  it('keeps the PATH form on POSIX', () => {
    expect(maestroHookCommand('session-context', { platform: 'linux' }))
      .toBe('maestro hooks run session-context');
  });

  it('does not lead with a quoted executable on Windows (PowerShell -Command ParserError)', () => {
    const execPath = 'C:\\Program Files\\nodejs\\node.exe';
    const packageRoot = 'C:\\Program Files\\nodejs\\node_global\\node_modules\\maestro-flow';
    const command = maestroHookCommand('session-context', { platform: 'win32', execPath, packageRoot });
    expect(command).toBe(
      `node "${join(packageRoot, 'bin', 'maestro.js')}" hooks run session-context`,
    );
    expect(command).not.toMatch(/^"/);
    expect(command).not.toMatch(/^maestro /);
  });

  it('keeps an unquoted absolute node path when it has no spaces', () => {
    const execPath = 'C:\\nodejs\\node.exe';
    const packageRoot = 'D:\\pkg';
    expect(maestroHookCommand('session-context', { platform: 'win32', execPath, packageRoot })).toBe(
      `${execPath} "${join(packageRoot, 'bin', 'maestro.js')}" hooks run session-context`,
    );
  });

  it('falls back to PATH node when execPath contains a shell metacharacter', () => {
    const execPath = 'C:\\nodejs\\node&more.exe';
    const packageRoot = 'D:\\pkg';
    expect(maestroHookCommand('session-context', { platform: 'win32', execPath, packageRoot })).toBe(
      `node "${join(packageRoot, 'bin', 'maestro.js')}" hooks run session-context`,
    );
  });

  it('survives PowerShell -Command and cmd shell:true on Windows', () => {
    if (process.platform !== 'win32') return;
    const command = maestroHookCommand('session-context', {
      platform: 'win32',
      execPath: process.execPath,
      packageRoot: resolveMaestroPackageRoot(),
    }).replace(' hooks run session-context', ' --version');
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    });
    expect(ps.status, ps.stderr).toBe(0);
    expect(ps.stdout).toMatch(/\d+\.\d+\.\d+/);
    const sh = spawnSync(command, { encoding: 'utf8', windowsHide: true, timeout: 15_000, shell: true });
    expect(sh.status, sh.stderr).toBe(0);
    expect(sh.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('maestroStatuslineCommand', () => {
  it('keeps the PATH form on POSIX', () => {
    expect(maestroStatuslineCommand({ platform: 'linux' })).toBe('maestro-statusline');
  });

  it('quotes node and maestro-statusline.js on Windows', () => {
    const execPath = 'C:\\Program Files\\nodejs\\node.exe';
    const packageRoot = 'D:\\pkg';
    expect(maestroStatuslineCommand({ platform: 'win32', execPath, packageRoot })).toBe(
      `node "${join(packageRoot, 'bin', 'maestro-statusline.js')}"`,
    );
  });
});
