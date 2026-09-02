import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceConfig } from '../types/index.js';
import {
  assertRepositoryCapability,
  findRepositoryRoot,
  initializeRepositoryIdentity,
  readRepositoryIdentity,
  reseedRepositoryIdentity,
  resolveRepositoryContext,
  resolveRepositoryId,
  resolveRepositorySelectorIds,
} from './context.js';

const roots: string[] = [];

function makeRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `maestro-repository-${name}-`));
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  return root;
}

function configFor(...linked: WorkspaceConfig['linked']): WorkspaceConfig {
  return { linked };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('repository identity', () => {
  it('persists a random stable UUID identity and only changes it on explicit reseed', () => {
    const root = makeRoot('identity');
    const first = initializeRepositoryIdentity(root, { repoName: 'Example' });
    const second = initializeRepositoryIdentity(root, { repoName: 'Ignored' });

    expect(first.schema_version).toBe('repository-identity/1.0');
    expect(first.repo_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toEqual(first);
    expect(readRepositoryIdentity(root)).toEqual(first);

    const reseeded = reseedRepositoryIdentity(root);
    expect(reseeded.previous?.repo_id).toBe(first.repo_id);
    expect(reseeded.current.repo_id).not.toBe(first.repo_id);
    expect(reseeded.current.repo_name).toBe('Example');
  });

  it('does not replace an identity created by a concurrent initializer', async () => {
    const root = makeRoot('identity-race');
    const manifestPath = join(root, '.workflow', 'repository.json');
    const lockPath = `${manifestPath}.lock`;
    const winner = {
      schema_version: 'repository-identity/1.0',
      repo_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      repo_name: 'Concurrent winner',
      created_at: '2026-08-13T00:00:00.000Z',
    };
    const script = `
      const fs = require('node:fs');
      const lockPath = ${JSON.stringify(lockPath)};
      const manifestPath = ${JSON.stringify(manifestPath)};
      const winner = ${JSON.stringify(winner)};
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: 'winner', createdAt: Date.now() }), { flag: 'wx' });
      setTimeout(() => {
        fs.writeFileSync(manifestPath, JSON.stringify(winner, null, 2) + '\\n');
        fs.unlinkSync(lockPath);
      }, 250);
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
    const exited = new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', resolveExit);
    });
    const waitArray = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 5_000;
    while (!existsSync(lockPath) && Date.now() < deadline) Atomics.wait(waitArray, 0, 0, 10);
    expect(existsSync(lockPath)).toBe(true);

    const initialized = initializeRepositoryIdentity(root, { repoName: 'Losing initializer' });

    expect(await exited).toBe(0);
    expect(initialized).toEqual(winner);
    expect(readRepositoryIdentity(root)).toEqual(winner);
  });

  it('keeps repo identity across copies while workspace identity remains path-specific', () => {
    const firstRoot = makeRoot('copy-a');
    const first = initializeRepositoryIdentity(firstRoot, { repoName: 'Shared' });
    const secondRoot = makeRoot('copy-b');
    cpSync(join(firstRoot, '.workflow', 'repository.json'), join(secondRoot, '.workflow', 'repository.json'));

    const firstContext = resolveRepositoryContext('current', { projectRoot: firstRoot });
    const secondContext = resolveRepositoryContext('current', { projectRoot: secondRoot });
    expect(secondContext.repoId).toBe(first.repo_id);
    expect(secondContext.repoId).toBe(firstContext.repoId);
    expect(secondContext.workspaceId).not.toBe(firstContext.workspaceId);
  });
});

describe('repository resolver', () => {
  it('uses current, exact ID, exact alias, then unique display name', () => {
    const currentRoot = makeRoot('current');
    const linkedRoot = makeRoot('linked');
    initializeRepositoryIdentity(currentRoot, { repoName: 'Host' });
    const linkedIdentity = initializeRepositoryIdentity(linkedRoot, { repoName: 'Library' });
    const config = configFor({
      name: 'lib',
      path: linkedRoot,
      repo_id: linkedIdentity.repo_id,
      share: ['spec'],
      write: ['spec'],
    });

    expect(resolveRepositoryContext('current', { projectRoot: currentRoot, config }).relation).toBe('current');
    expect(resolveRepositoryContext(linkedIdentity.repo_id, { projectRoot: currentRoot, config }).alias).toBe('lib');
    expect(resolveRepositoryContext('lib', { projectRoot: currentRoot, config }).repoId).toBe(linkedIdentity.repo_id);
    expect(resolveRepositoryContext('Library', { projectRoot: currentRoot, config }).projectRoot).toBe(linkedRoot);
  });

  it('fails closed for ambiguous names, reserved/duplicate aliases, and cached identity drift', () => {
    const currentRoot = makeRoot('ambiguous-current');
    const linkedA = makeRoot('ambiguous-a');
    const linkedB = makeRoot('ambiguous-b');
    initializeRepositoryIdentity(currentRoot, { repoName: 'Host' });
    const identityA = initializeRepositoryIdentity(linkedA, { repoName: 'Shared' });
    const identityB = initializeRepositoryIdentity(linkedB, { repoName: 'Shared' });

    expect(() => resolveRepositoryContext('Shared', {
      projectRoot: currentRoot,
      config: configFor(
        { name: 'a', path: linkedA, repo_id: identityA.repo_id, share: ['spec'] },
        { name: 'b', path: linkedB, repo_id: identityB.repo_id, share: ['spec'] },
      ),
    })).toThrow(/Ambiguous repository name/);

    expect(() => resolveRepositoryContext('current', {
      projectRoot: currentRoot,
      config: configFor({ name: 'current', path: linkedA, share: ['spec'] }),
    })).toThrow(/reserved/);

    expect(() => resolveRepositoryContext('a', {
      projectRoot: currentRoot,
      config: configFor({ name: 'a', path: linkedA, repo_id: identityB.repo_id, share: ['spec'] }),
    })).toThrow(/identity mismatch/);
  });

  it('fails closed for current/linked duplicate repo IDs through current, ID, and alias selectors', () => {
    const currentRoot = makeRoot('duplicate-id-current');
    const linkedRoot = makeRoot('duplicate-id-linked');
    const identity = initializeRepositoryIdentity(currentRoot, { repoName: 'Host' });
    cpSync(
      join(currentRoot, '.workflow', 'repository.json'),
      join(linkedRoot, '.workflow', 'repository.json'),
    );
    const config = configFor({
      name: 'copy', path: linkedRoot, repo_id: identity.repo_id, share: ['spec'],
    });

    for (const selector of ['current', identity.repo_id, 'copy']) {
      expect(() => resolveRepositoryContext(selector, { projectRoot: currentRoot, config }))
        .toThrow(/Duplicate repository identity/);
    }
    expect(() => resolveRepositorySelectorIds(['copy'], { projectRoot: currentRoot, config }))
      .toThrow(/Duplicate repository identity/);
  });

  it('resolves human applicability selectors to IDs but keeps tool contracts ID-only', () => {
    const currentRoot = makeRoot('selector-current');
    const linkedRoot = makeRoot('selector-linked');
    initializeRepositoryIdentity(currentRoot, { repoName: 'Host' });
    const linkedIdentity = initializeRepositoryIdentity(linkedRoot, { repoName: 'Library' });
    const config = configFor({
      name: 'lib', path: linkedRoot, repo_id: linkedIdentity.repo_id, share: ['knowhow'],
    });

    expect(resolveRepositorySelectorIds(['lib', 'Library'], { projectRoot: currentRoot, config }))
      .toEqual([linkedIdentity.repo_id]);
    expect(resolveRepositoryId(linkedIdentity.repo_id, { projectRoot: currentRoot, config }).alias).toBe('lib');
    expect(() => resolveRepositoryId('lib', { projectRoot: currentRoot, config })).toThrow(/exact persisted repository ID/);
    expect(() => resolveRepositorySelectorIds(['missing'], { projectRoot: currentRoot, config })).toThrow(/not found/);
  });

  it('allows legacy linked reads but grants no implicit write capability', () => {
    const currentRoot = makeRoot('legacy-current');
    const legacyRoot = makeRoot('legacy-linked');
    initializeRepositoryIdentity(currentRoot);
    const context = resolveRepositoryContext('legacy', {
      projectRoot: currentRoot,
      config: configFor({ name: 'legacy', path: legacyRoot, share: ['knowhow'] }),
    });

    expect(context.identityPersisted).toBe(false);
    expect(context.repoId).toBeNull();
    expect(() => assertRepositoryCapability(context, 'read', 'knowhow')).not.toThrow();
    expect(() => assertRepositoryCapability(context, 'write', 'knowhow')).toThrow(/does not grant write/);
  });

  it('rejects writes to legacy targets even if malformed config claims write access', () => {
    const currentRoot = makeRoot('legacy-write-current');
    const legacyRoot = makeRoot('legacy-write-linked');
    initializeRepositoryIdentity(currentRoot);
    expect(() => resolveRepositoryContext('legacy', {
      projectRoot: currentRoot,
      config: configFor({ name: 'legacy', path: legacyRoot, share: ['spec'], write: ['spec'] }),
      require: { mode: 'write', corpus: 'spec' },
    })).toThrow(/without a persisted repository identity/);
  });

  it('canonicalizes nested discovery and rejects a .workflow symlink escaping the root', () => {
    const root = makeRoot('nested');
    initializeRepositoryIdentity(root);
    const nested = join(root, 'src', 'deep');
    mkdirSync(nested, { recursive: true });
    expect(findRepositoryRoot(nested)).toBe(root);

    const unsafeRoot = mkdtempSync(join(tmpdir(), 'maestro-repository-unsafe-'));
    const outside = mkdtempSync(join(tmpdir(), 'maestro-repository-outside-'));
    roots.push(unsafeRoot, outside);
    writeFileSync(join(outside, 'repository.json'), readFileSync(join(root, '.workflow', 'repository.json')));
    try {
      symlinkSync(outside, join(unsafeRoot, '.workflow'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // The host may disallow symlink creation; production validation remains exercised elsewhere.
    }
    expect(findRepositoryRoot(unsafeRoot)).toBeNull();
    expect(() => readRepositoryIdentity(unsafeRoot)).toThrow(/escapes repository root/);
  });
});
