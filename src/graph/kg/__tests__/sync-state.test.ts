import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  KG_SYNC_STATE_SCHEMA_VERSION,
  getSyncStateHealth,
  isSyncStateFresh,
  readSyncState,
  writeSyncState,
  writeSyncStateFailure,
  getGitHead,
} from '../sync-state.js';

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
    const persisted = JSON.parse(readFileSync(path, 'utf-8'));
    expect(Object.keys(persisted).sort()).toEqual([
      'lastAttempt',
      'lastSuccessful',
      'schema_version',
    ]);
    expect(persisted).toMatchObject({
      schema_version: KG_SYNC_STATE_SCHEMA_VERSION,
      lastSuccessful: { head: 'head' },
      lastAttempt: { status: 'succeeded', error: null },
    });
  });

  it('returns null on corrupt state file instead of throwing', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'ok');
    const path = resolve(dir, '.workflow', 'kg', 'sync-state.json');
    writeFileSync(path, '{not json', 'utf-8');
    expect(readSyncState(dir)).toBeNull();
    expect(getSyncStateHealth(dir)).toMatchObject({
      status: 'error',
      stale: true,
      error: 'sync state is malformed or unreadable',
    });
  });

  it('getGitHead returns null outside a git repository', () => {
    expect(getGitHead(makeProjectDir())).toBeNull();
  });

  it('reads legacy state as requiring one v2 refresh', () => {
    const dir = makeProjectDir();
    const path = resolve(dir, '.workflow', 'kg', 'sync-state.json');
    mkdirSync(resolve(dir, '.workflow', 'kg'), { recursive: true });
    writeFileSync(path, JSON.stringify({ lastSyncHead: 'legacy', lastSyncAt: 10 }), 'utf-8');
    expect(readSyncState(dir)).toMatchObject({
      lastSyncHead: 'legacy',
      requiresRefresh: true,
    });
    expect(getSyncStateHealth(dir)).toMatchObject({ status: 'stale', stale: true });
    expect(isSyncStateFresh(readSyncState(dir), {
      head: 'legacy', manifestDigest: null, externalFingerprint: '',
    })).toBe(false);
    writeSyncState(dir, 'legacy', 'manifest', 'headers');
    expect(readSyncState(dir)?.requiresRefresh).toBe(false);
    expect(isSyncStateFresh(readSyncState(dir), {
      head: 'legacy', manifestDigest: 'manifest', externalFingerprint: 'headers',
    })).toBe(true);
  });

  it('requires HEAD, manifest digest and exact header fingerprint to all match', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'head', 'manifest', 'headers');
    const state = readSyncState(dir);
    expect(isSyncStateFresh(state, {
      head: 'head', manifestDigest: 'manifest', externalFingerprint: 'headers',
    })).toBe(true);
    expect(isSyncStateFresh(state, {
      head: 'next', manifestDigest: 'manifest', externalFingerprint: 'headers',
    })).toBe(false);
    expect(isSyncStateFresh(state, {
      head: 'head', manifestDigest: 'changed', externalFingerprint: 'headers',
    })).toBe(false);
    expect(isSyncStateFresh(state, {
      head: 'head', manifestDigest: 'manifest', externalFingerprint: 'changed',
    })).toBe(false);
  });

  it('preserves lastSuccessful and exposes a failed attempt when success write faults', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'old', 'manifest-old', 'external-old', { startedAt: 1 });
    const prior = readSyncState(dir)?.lastSuccessful;
    expect(() => writeSyncState(dir, 'new', 'manifest-new', 'external-new', {
      startedAt: 2,
      beforeSuccessWrite: () => { throw new Error('fault'); },
    })).toThrow('fault');
    expect(readSyncState(dir)).toMatchObject({
      lastSuccessful: prior,
      lastAttempt: { status: 'failed', error: 'fault' },
    });
    expect(getSyncStateHealth(dir)).toMatchObject({ status: 'error', stale: true });
  });

  it('records a pre-COMMIT failure without advancing lastSuccessful', () => {
    const dir = makeProjectDir();
    writeSyncState(dir, 'old', 'manifest-old', 'external-old', { startedAt: 1 });
    const prior = readSyncState(dir)?.lastSuccessful;
    writeSyncStateFailure(dir, 2, new Error('worker-fault'));
    expect(readSyncState(dir)).toMatchObject({
      lastSuccessful: prior,
      lastAttempt: {
        status: 'failed',
        startedAt: 2,
        error: 'worker-fault',
      },
    });
    expect(getSyncStateHealth(dir)).toMatchObject({ status: 'error', stale: true });
  });
});
