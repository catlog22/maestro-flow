import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readSyncState, writeSyncState, getGitHead } from '../sync-state.js';

describe('sync-state', () => {
  const dirs: string[] = [];

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kg-sync-state-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no state file exists', () => {
    expect(readSyncState(makeProjectDir())).toBeNull();
  });

  it('round-trips head through write and read', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'abc123');
    const state = readSyncState(dir);
    expect(state?.lastSyncHead).toBe('abc123');
    expect(typeof state?.lastSyncAt).toBe('number');
  });

  it('stores null head for non-git projects', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, null);
    expect(readSyncState(dir)?.lastSyncHead).toBeNull();
  });

  it('creates the .workflow/kg directory when missing', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'head');
    const path = resolve(dir, '.workflow', 'kg', 'sync-state.json');
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8')).lastSyncHead).toBe('head');
  });

  it('returns null on corrupt state file instead of throwing', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'ok');
    const path = resolve(dir, '.workflow', 'kg', 'sync-state.json');
    writeFileSync(path, '{not json', 'utf-8');
    expect(readSyncState(dir)).toBeNull();
  });

  it('getGitHead returns null outside a git repository', () => {
    expect(getGitHead(makeProjectDir())).toBeNull();
  });
});
