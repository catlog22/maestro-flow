import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsFault = vi.hoisted(() => ({
  renameCode: null as string | null,
  renameDestination: null as string | null,
  restoreDestination: null as string | null,
  disappearLockOnOpen: false,
  disappearLockOnStat: false,
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: ((path: Parameters<typeof actual.openSync>[0], ...args: unknown[]) => {
      if (fsFault.disappearLockOnOpen && String(path).endsWith('.session-store.lock')) {
        fsFault.disappearLockOnOpen = false;
        try { actual.unlinkSync(path); } catch { /* another contender removed it */ }
        throw Object.assign(new Error(`injected ENOENT: ${String(path)}`), { code: 'ENOENT' });
      }
      return (actual.openSync as (...openArgs: unknown[]) => number)(path, ...args);
    }) as typeof actual.openSync,
    renameSync: (src: string, dest: string) => {
      if (fsFault.renameCode && (!fsFault.renameDestination || dest.endsWith(fsFault.renameDestination))) {
        const error = Object.assign(new Error(`injected rename ${fsFault.renameCode}: ${dest}`), {
          code: fsFault.renameCode,
        });
        throw error;
      }
      return actual.renameSync(src, dest);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const [path, data] = args;
      if (fsFault.restoreDestination && String(path).endsWith(fsFault.restoreDestination) && Buffer.isBuffer(data)) {
        throw Object.assign(new Error(`injected rollback EPERM: ${String(path)}`), { code: 'EPERM' });
      }
      return (actual.writeFileSync as (...writeArgs: typeof args) => void)(...args);
    },
    statSync: ((path: Parameters<typeof actual.statSync>[0], ...args: unknown[]) => {
      if (fsFault.disappearLockOnStat && String(path).endsWith('.session-store.lock')) {
        fsFault.disappearLockOnStat = false;
        try { actual.unlinkSync(path); } catch { /* another contender removed it */ }
        throw Object.assign(new Error(`injected ENOENT: ${String(path)}`), { code: 'ENOENT' });
      }
      return (actual.statSync as (...statArgs: unknown[]) => unknown)(path, ...args);
    }) as typeof actual.statSync,
  };
});

import { SessionStore } from './store.js';
import { safeRename } from '../utils/state-schema.js';

const roots: string[] = [];
const authorityFiles = ['session.json', 'gates.json', 'artifacts.json', 'evidence.json'];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-store-durability-'));
  roots.push(root);
  return root;
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshot(store: SessionStore, sessionId: string): Record<string, string> {
  const dir = store.sessionDir(sessionId);
  return Object.fromEntries(authorityFiles.map(file => [file, sha(join(dir, file))]));
}

function mutateAll(store: SessionStore, sessionId: string): void {
  store.update(sessionId, draft => {
    draft.session.activity_revision += 1;
    draft.gates.revision += 1;
    draft.artifacts.revision += 1;
    draft.evidence.revision += 1;
  });
}

function lockPath(store: SessionStore): string {
  return join(store.sessionsRoot, '.session-store.lock');
}

beforeEach(() => {
  fsFault.renameCode = null;
  fsFault.renameDestination = null;
  fsFault.restoreDestination = null;
  fsFault.disappearLockOnOpen = false;
  fsFault.disappearLockOnStat = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('SessionStore durability adversarial harness', () => {
  it('INV-03 keeps all authority bytes old after a caught rename failure', () => {
    const store = new SessionStore(createRoot());
    const sessionId = 'caught-rename';
    store.createSession(sessionId, 'old');
    const before = snapshot(store, sessionId);

    fsFault.renameDestination = 'gates.json';
    fsFault.renameCode = 'EIO';

    expect(() => mutateAll(store, sessionId)).toThrow(/injected rename EIO/);
    expect(snapshot(store, sessionId)).toEqual(before);
    expect(existsSync(lockPath(store))).toBe(false);
    expect(readdirSync(store.sessionDir(sessionId)).filter(name => name.includes('.tmp-'))).toEqual([]);
    expect(new SessionStore(store.projectRoot).readBundle(sessionId).session.session_id).toBe(sessionId);
  });

  it('INV-03 remains all-old or fails closed when rollback restoration receives EPERM', () => {
    const store = new SessionStore(createRoot());
    const sessionId = 'rollback-restore';
    store.createSession(sessionId, 'old');
    const before = snapshot(store, sessionId);

    fsFault.renameDestination = 'gates.json';
    fsFault.renameCode = 'EIO';
    fsFault.restoreDestination = 'session.json';

    expect(() => mutateAll(store, sessionId)).toThrow(/injected rename EIO/);
    const after = snapshot(store, sessionId);
    expect(after).toEqual(before);
    expect(existsSync(lockPath(store))).toBe(false);
    expect(readdirSync(store.sessionDir(sessionId)).filter(name => name.includes('.tmp-'))).toEqual([]);
    expect(() => new SessionStore(store.projectRoot).readBundle(sessionId)).not.toThrow();
  });

  it('INV-04 commits all-new bytes without lock or temp residue', () => {
    const store = new SessionStore(createRoot());
    const sessionId = 'successful-commit';
    store.createSession(sessionId, 'old');
    const before = snapshot(store, sessionId);

    mutateAll(store, sessionId);

    const after = snapshot(store, sessionId);
    for (const file of authorityFiles) expect(after[file]).not.toBe(before[file]);
    expect(existsSync(lockPath(store))).toBe(false);
    expect(readdirSync(store.sessionDir(sessionId)).filter(name => name.includes('.tmp-'))).toEqual([]);
  });

  it('INV-01 refuses a young lock owned by a live process', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({ pid: process.pid, acquired_at: Date.now() }));
    let entered = false;

    expect(() => store.withLock(() => { entered = true; })).toThrow(/SessionStore locked by PID/);
    expect(entered).toBe(false);
  });

  it('INV-01 requires an aged live owner to retain exclusivity', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({ pid: process.pid, acquired_at: Date.now() - 60_000 }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath(store), old, old);
    let entered = false;

    let error: unknown;
    try { store.withLock(() => { entered = true; }); } catch (caught) { error = caught; }

    expect({ entered, error: error instanceof Error ? error.message : null }, 'age alone displaced a live lock owner')
      .toEqual({ entered: false, error: expect.stringContaining('SessionStore locked by PID') });
  });

  it('INV-02 treats process.kill EPERM as alive or unknown-safe', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({ pid: 424242, acquired_at: Date.now() }));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    let entered = false;

    let error: unknown;
    try { store.withLock(() => { entered = true; }); } catch (caught) { error = caught; }

    expect({ entered, error: error instanceof Error ? error.message : null }, 'EPERM was classified as a dead owner')
      .toEqual({ entered: false, error: expect.stringContaining('SessionStore locked by PID') });
  });

  it('INV-02 reclaims a recent lock whose owner is provably dead', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({ pid: 424242, acquired_at: Date.now() }));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    let entered = false;

    store.withLock(() => { entered = true; });

    expect(entered).toBe(true);
    expect(existsSync(lockPath(store))).toBe(false);
  });

  it('INV-01 retries when the lock path disappears between fd read and path stat', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({
      schema_version: 'session-store-lock/1.0',
      pid: 424242,
      token: 'dead-owner-token-1234567890',
      acquired_at: Date.now(),
    }));
    fsFault.disappearLockOnStat = true;
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    let entered = false;

    store.withLock(() => { entered = true; });

    expect(entered).toBe(true);
    expect(existsSync(lockPath(store))).toBe(false);
  });

  it('INV-01 retries when the lock path disappears before fd open', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    writeFileSync(lockPath(store), JSON.stringify({
      schema_version: 'session-store-lock/1.0',
      pid: 424242,
      token: 'dead-owner-token-1234567890',
      acquired_at: Date.now(),
    }));
    fsFault.disappearLockOnOpen = true;
    let entered = false;

    store.withLock(() => { entered = true; });

    expect(entered).toBe(true);
    expect(existsSync(lockPath(store))).toBe(false);
  });

  it('INV-01 never reclaims a replacement lock installed during owner probing', () => {
    const store = new SessionStore(createRoot());
    mkdirSync(store.sessionsRoot, { recursive: true });
    const replacementToken = 'replacement-live-token-1234567890';
    writeFileSync(lockPath(store), JSON.stringify({
      schema_version: 'session-store-lock/1.0',
      pid: 424242,
      token: 'dead-owner-token-1234567890',
      acquired_at: Date.now(),
    }));
    let replaced = false;
    vi.spyOn(process, 'kill').mockImplementation(pid => {
      if (!replaced && pid === 424242) {
        replaced = true;
        writeFileSync(lockPath(store), JSON.stringify({
          schema_version: 'session-store-lock/1.0',
          pid: process.pid,
          token: replacementToken,
          acquired_at: Date.now(),
        }));
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }
      return undefined as never;
    });
    let entered = false;

    expect(() => store.withLock(() => { entered = true; })).toThrow(/SessionStore locked by PID/);

    expect(entered).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(store), 'utf8')).token).toBe(replacementToken);
  });

  it('INV-01 release leaves a same-PID replacement lock with a different token intact', () => {
    const store = new SessionStore(createRoot());
    const replacementToken = 'replacement-release-token-123456';

    store.withLock(() => {
      writeFileSync(lockPath(store), JSON.stringify({
        schema_version: 'session-store-lock/1.0',
        pid: process.pid,
        token: replacementToken,
        acquired_at: Date.now(),
      }));
    });

    expect(JSON.parse(readFileSync(lockPath(store), 'utf8')).token).toBe(replacementToken);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('INV-06 preserves the last-good destination after exhausted %s retries', code => {
    const root = createRoot();
    const src = join(root, 'new.tmp');
    const dest = join(root, 'authority.json');
    writeFileSync(src, 'new');
    writeFileSync(dest, 'old');
    fsFault.renameCode = code;
    fsFault.renameDestination = basename(dest);

    expect(() => safeRename(src, dest)).toThrow(`injected rename ${code}`);
    expect({ destination_exists: existsSync(dest), source_exists: existsSync(src) }, `${code} retry removed the only committed destination`)
      .toEqual({ destination_exists: true, source_exists: true });
  });
});
