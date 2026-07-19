import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWorkspaceCommand } from './workspace.js';

let projectRoot: string;
let linkedRoot: string;
let originalCwd: string;

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerWorkspaceCommand(program);
  await program.parseAsync(['node', 'maestro', 'workspace', ...args]);
}

beforeEach(() => {
  originalCwd = process.cwd();
  projectRoot = mkdtempSync(join(tmpdir(), 'workspace-share-local-'));
  linkedRoot = mkdtempSync(join(tmpdir(), 'workspace-share-linked-'));
  mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
  mkdirSync(join(linkedRoot, '.workflow', 'sessions', 'S-001'), { recursive: true });
  writeFileSync(join(linkedRoot, '.workflow', 'sessions', 'S-001', 'session.json'), '{}');
  process.chdir(projectRoot);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(linkedRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('workspace linked Session sharing', () => {
  it('does not share Session history by default', async () => {
    await run('link', linkedRoot, '--name', 'linked');
    const config = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'config.json'), 'utf-8'));
    expect(config.workspaces.linked[0].share).toEqual(['spec', 'knowhow', 'domain']);
  });

  it('requires the explicit session share surface and reports its count', async () => {
    await run('link', linkedRoot, '--name', 'linked', '--share', 'session');
    const config = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'config.json'), 'utf-8'));
    expect(config.workspaces.linked[0].share).toEqual(['session']);
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation(value => { logs.push(String(value)); });
    await run('status', '--json');
    const status = JSON.parse(logs.at(-1) ?? '[]');
    expect(status[0].counts.session).toBe(1);
  });
});
