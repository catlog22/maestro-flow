import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWorkspaceCommand } from './workspace.js';
import { initializeRepositoryIdentity } from '../repository/context.js';

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
    expect(config.workspaces.linked[0].write).toEqual([]);
    expect(config.workspaces.linked[0].repo_id).toBeUndefined();
  });

  it('caches a persisted target identity and keeps write separate from read sharing', async () => {
    const identity = initializeRepositoryIdentity(linkedRoot, { repoName: 'Linked Repository' });
    await run('link', linkedRoot, '--name', 'linked', '--share', 'spec,session', '--write', 'spec');
    const config = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'config.json'), 'utf-8'));
    expect(config.workspaces.linked[0]).toMatchObject({
      repo_id: identity.repo_id,
      share: ['spec', 'session'],
      write: ['spec'],
    });
  });

  it('explicitly grants, reports, and immediately revokes type-level write authority', async () => {
    initializeRepositoryIdentity(projectRoot, { repoName: 'Host' });
    initializeRepositoryIdentity(linkedRoot, { repoName: 'Linked' });
    await run('link', linkedRoot, '--name', 'linked', '--share', 'spec,knowhow');
    await run('write', 'grant', 'linked', 'spec');
    let config = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'config.json'), 'utf-8'));
    expect(config.workspaces.linked[0].write).toEqual(['spec']);

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation(value => { logs.push(String(value)); });
    await run('write', 'status', 'linked', '--json');
    expect(JSON.parse(logs.at(-1) ?? '[]')[0]).toMatchObject({
      name: 'linked', shared: ['spec', 'knowhow'], write: ['spec'], identity_persisted: true,
    });

    await run('revoke', 'linked', '--write', 'spec');
    config = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'config.json'), 'utf-8'));
    expect(config.workspaces.linked[0].write).toEqual([]);
  });

  it('initializes, shows, and explicitly reseeds repository identity', async () => {
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation(value => { logs.push(String(value)); });
    await run('identity', 'init', '--name', 'Host Repository', '--json');
    const initial = JSON.parse(logs.at(-1) ?? '{}');
    expect(initial.schema_version).toBe('repository-identity/1.0');
    await run('identity', 'show', '--json');
    expect(JSON.parse(logs.at(-1) ?? '{}').repo_id).toBe(initial.repo_id);
    await run('identity', 'reseed', '--force', '--json');
    const reseeded = JSON.parse(logs.at(-1) ?? '{}');
    expect(reseeded.previous.repo_id).toBe(initial.repo_id);
    expect(reseeded.current.repo_id).not.toBe(initial.repo_id);
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
