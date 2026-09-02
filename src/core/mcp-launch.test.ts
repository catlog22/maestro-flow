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

  it('quotes node and the JS entry on Windows so hosts do not go through maestro.cmd', () => {
    const execPath = 'C:\\Program Files\\nodejs\\node.exe';
    const packageRoot = 'C:\\Program Files\\nodejs\\node_global\\node_modules\\maestro-flow';
    const command = maestroHookCommand('session-context', { platform: 'win32', execPath, packageRoot });
    expect(command).toBe(
      `"${execPath}" "${join(packageRoot, 'bin', 'maestro.js')}" hooks run session-context`,
    );
    expect(command).not.toMatch(/^maestro /);
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
      `"${execPath}" "${join(packageRoot, 'bin', 'maestro-statusline.js')}"`,
    );
  });
});
