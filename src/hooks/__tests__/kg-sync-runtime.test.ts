import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectSourceChanges,
  evaluateKgSync,
  gitEntriesContainSupportedSource,
  kgSyncCooldownKey,
  parseGitPorcelainZ,
} from '../kg-sync-hook.js';
import {
  acquireKgSyncWorkerToken,
  inspectKgSyncWorkerMarker,
  KG_SYNC_WORKER_MARKER_MAX_BYTES,
  kgSyncWorkerMarkerPath,
  parseKgSyncWorkerMarker,
  releaseKgSyncWorkerToken,
  serializeKgSyncWorkerMarker,
  waitForKgSyncWorkerQuiescence,
  withKgSyncMaintenanceToken,
} from '../kg-sync-worker-state.js';
import { workerAlreadyRunningV063 } from './fixtures/kg-sync-hook-v0.5.63-worker-already-running.js';
import { prepareExternalSurfaceScan } from '../../graph/kg/extraction/code/code-extractor.js';
import {
  getSyncStateHealth,
  isSyncStateFresh,
  readSyncState,
  writeSyncState,
} from '../../graph/kg/sync-state.js';
import {
  COOLDOWN_MARKER_MAX_BYTES,
  CooldownGuard,
  kgSyncGuard,
} from '../../utils/cooldown-guard.js';

describe('KG sync runtime', () => {
  const roots: string[] = [];

  function root(): string {
    const value = mkdtempSync(join(tmpdir(), 'maestro-kg-hook-'));
    roots.push(value);
    mkdirSync(join(value, '.workflow', 'kg'), { recursive: true });
    writeFileSync(join(value, '.workflow', 'kg', 'maestro.db'), 'fixture');
    return value;
  }

  afterEach(() => {
    const cleanupErrors: unknown[] = [];
    for (const value of roots.splice(0)) {
      // Windows can briefly retain a just-closed SQLite file. Retry boundedly,
      // but keep persistent cleanup errors visible and attempt every root.
      try {
        rmSync(value, {
          recursive: true,
          force: true,
          maxRetries: process.platform === 'win32' ? 10 : 0,
          retryDelay: 25,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Failed to clean KG sync runtime fixtures');
    }
  });

  it('parses modified, untracked, deleted, copy and both rename paths from NUL porcelain', () => {
    const entries = parseGitPorcelainZ(Buffer.from([
      ' M Sources/A.h',
      '?? Sources/B.m',
      ' D Sources/C.mm',
      'R  Notes/new.txt', 'Sources/Old.swift',
      'C  Sources/Copy.swift', 'Sources/Original.swift',
      '',
    ].join('\0')));
    expect(entries).toEqual([
      { status: ' M', paths: ['Sources/A.h'] },
      { status: '??', paths: ['Sources/B.m'] },
      { status: ' D', paths: ['Sources/C.mm'] },
      { status: 'R ', paths: ['Notes/new.txt', 'Sources/Old.swift'] },
      { status: 'C ', paths: ['Sources/Copy.swift', 'Sources/Original.swift'] },
    ]);
    expect(gitEntriesContainSupportedSource(entries)).toBe(true);
    expect(gitEntriesContainSupportedSource(parseGitPorcelainZ(' M README.md\0'))).toBe(false);
    expect(gitEntriesContainSupportedSource(parseGitPorcelainZ(' M src/module.luau\0'))).toBe(true);
  });

  it('triggers every Apple-language extension for modified, untracked, delete and rename', () => {
    for (const extension of ['.h', '.m', '.mm', '.swift']) {
      const fixtures = [
        ` M Sources/File${extension}\0`,
        `?? Sources/File${extension}\0`,
        ` D Sources/File${extension}\0`,
        `R  Sources/File.txt\0Sources/File${extension}\0`,
      ];
      for (const fixture of fixtures) {
        expect(gitEntriesContainSupportedSource(parseGitPorcelainZ(fixture)), fixture).toBe(true);
      }
    }
  });

  it('preserves spaces, non-ASCII and newlines in NUL-delimited paths', () => {
    const paths = [
      'Sources/a file.swift',
      'Sources/相机.mm',
      'Sources/line\nbreak.h',
      'Sources/nested/new.m',
    ];
    const parsed = parseGitPorcelainZ(paths.map(path => `?? ${path}\0`).join(''));
    expect(parsed.flatMap(entry => entry.paths)).toEqual(paths);
    expect(gitEntriesContainSupportedSource(parsed)).toBe(true);
  });

  it('detects all Apple-language worktree states with real git porcelain', () => {
    const project = root();
    const git = (args: string[]) => requireExec('git', args, project);
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['config', 'user.name', 'Fixture']);
    for (const name of ['A.h', 'B.m', 'C.mm', 'D.swift']) writeFileSync(join(project, name), '// v1\n');
    git(['add', '.']);
    git(['commit', '-qm', 'fixture']);

    writeFileSync(join(project, 'A.h'), '// modified\n');
    expect(detectSourceChanges(project)).toBe(true);
    git(['checkout', '--', 'A.h']);
    writeFileSync(join(project, 'New.swift'), '// untracked\n');
    expect(detectSourceChanges(project)).toBe(true);
    rmSync(join(project, 'New.swift'));
    rmSync(join(project, 'B.m'));
    expect(detectSourceChanges(project)).toBe(true);
    git(['checkout', '--', 'B.m']);
    git(['mv', 'D.swift', 'D.txt']);
    expect(detectSourceChanges(project)).toBe(true);
  });

  it('canonicalizes nested cwd and returns the one project root', async () => {
    const project = root();
    const canonicalProject = realpathSync(project);
    const nested = join(project, 'Sources', 'Feature');
    mkdirSync(nested, { recursive: true });
    const external = prepareExternalSurfaceScan(project);
    writeSyncState(project, null, external.manifest.digest, external.externalFingerprint);
    const result = await evaluateKgSync(nested, `nested-${Date.now()}`);
    expect(result).toMatchObject({
      synced: false,
      reason: 'no-changes',
      projectRoot: canonicalProject,
    });
  });

  it('uses project-scoped cooldown keys', () => {
    const first = kgSyncCooldownKey(`session-${Date.now()}`, '/one');
    const second = kgSyncCooldownKey(`session-${Date.now()}`, '/two');
    expect(first).not.toBe(second);
    expect(kgSyncCooldownKey('session', '/one')).toBe(kgSyncCooldownKey('session', '/one'));
    kgSyncGuard.markDone(first);
    expect(kgSyncGuard.shouldRun(first)).toBe(false);
    kgSyncGuard.clear(first);
    expect(kgSyncGuard.shouldRun(first)).toBe(true);
  });

  it('confines hostile cooldown keys to the hashed tmpdir namespace', () => {
    const nonce = `${process.pid}-${Date.now()}`;
    const prefix = `maestro-cooldown-${nonce}-`;
    const escapeName = `maestro-cooldown-outside-${nonce}`;
    const rawPrefixDir = join(tmpdir(), prefix);
    const escapeDir = join(tmpdir(), escapeName);
    const key = `/../${escapeName}/bridge`;
    const bridgePath = join(
      tmpdir(),
      `${prefix}${createHash('sha256').update(key).digest('hex')}.json`,
    );
    const escapedPath = join(escapeDir, 'bridge.json');
    const guard = new CooldownGuard({ prefix, cooldownMs: 30_000 });
    try {
      mkdirSync(rawPrefixDir);
      mkdirSync(escapeDir);
      guard.markDone(key);

      expect(existsSync(bridgePath)).toBe(true);
      expect(existsSync(escapedPath)).toBe(false);
      if (process.platform !== 'win32') {
        expect(statSync(bridgePath).mode & 0o777).toBe(0o600);
      }
      expect(guard.shouldRun(key)).toBe(false);
      guard.clear(key);
      expect(guard.shouldRun(key)).toBe(true);
    } finally {
      guard.clear(key);
      rmSync(rawPrefixDir, { recursive: true, force: true });
      rmSync(escapeDir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('does not follow cooldown marker symlinks', () => {
    const nonce = `${process.pid}-${Date.now()}`;
    const prefix = `maestro-cooldown-symlink-${nonce}-`;
    const key = 'symlink-session';
    const bridgePath = join(
      tmpdir(),
      `${prefix}${createHash('sha256').update(key).digest('hex')}.json`,
    );
    const target = join(root(), 'outside-cooldown.json');
    const guard = new CooldownGuard({ prefix, cooldownMs: 30_000 });
    writeFileSync(target, JSON.stringify({ last_trigger: Date.now(), session_id: key }));
    symlinkSync(target, bridgePath);
    try {
      expect(guard.shouldRun(key)).toBe(true);
      expect(guard.timeSinceLastMs(key)).toBeNull();
      expect(readFileSync(target, 'utf8')).toContain(key);
    } finally {
      guard.clear(key);
    }
    expect(existsSync(target)).toBe(true);
  });

  it('fails cooldown open for oversized, malformed, mismatched, and future markers', () => {
    const nonce = `${process.pid}-${Date.now()}`;
    const prefix = `maestro-cooldown-invalid-${nonce}-`;
    const key = 'strict-session';
    const bridgePath = join(
      tmpdir(),
      `${prefix}${createHash('sha256').update(key).digest('hex')}.json`,
    );
    const guard = new CooldownGuard({ prefix, cooldownMs: 30_000 });
    const invalidMarkers = [
      Buffer.alloc(COOLDOWN_MARKER_MAX_BYTES + 1, 0x20),
      Buffer.from(`{"last_trigger":NaN,"session_id":"${key}"}`),
      Buffer.from(`{"last_trigger":1e999,"session_id":"${key}"}`),
      Buffer.from(JSON.stringify({ last_trigger: Date.now() + 60_000, session_id: key })),
      Buffer.from(JSON.stringify({ last_trigger: Date.now(), session_id: 'different-session' })),
      Buffer.from(JSON.stringify({ last_trigger: Date.now(), session_id: key, extra: [] })),
      Buffer.from(JSON.stringify({ last_trigger: Date.now(), session_id: key, unknown: true })),
    ];
    try {
      for (const marker of invalidMarkers) {
        writeFileSync(bridgePath, marker);
        expect(guard.shouldRun(key)).toBe(true);
        expect(guard.timeSinceLastMs(key)).toBeNull();
      }
    } finally {
      guard.clear(key);
    }
  });

  it('marks manifest and ignored exact-header changes stale after a successful snapshot', () => {
    const project = root();
    const header = join(project, 'Pods', 'Fixture', 'Public.h');
    mkdirSync(join(project, 'Pods', 'Fixture'), { recursive: true });
    writeFileSync(header, '@interface Public : NSObject\n@end\n');
    writeFileSync(join(project, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
      schema_version: 'kg-external-surfaces/1.0',
      files: [{ module: 'Fixture', language: 'objc', path: 'Pods/Fixture/Public.h' }],
    }));
    const before = prepareExternalSurfaceScan(project);
    writeSyncState(project, null, before.manifest.digest, before.externalFingerprint);
    expect(isSyncStateFresh(readSyncState(project), {
      head: null,
      manifestDigest: before.manifest.digest,
      externalFingerprint: before.externalFingerprint,
    })).toBe(true);

    writeFileSync(header, '@interface Public : ChangedParent\n@end\n');
    const afterHeader = prepareExternalSurfaceScan(project);
    expect(afterHeader.externalFingerprint).not.toBe(before.externalFingerprint);
    expect(isSyncStateFresh(readSyncState(project), {
      head: null,
      manifestDigest: afterHeader.manifest.digest,
      externalFingerprint: afterHeader.externalFingerprint,
    })).toBe(false);

    writeFileSync(join(project, '.workflow', 'kg', 'external-surfaces.json'), JSON.stringify({
      schema_version: 'kg-external-surfaces/1.0',
      files: [],
    }));
    const afterManifest = prepareExternalSurfaceScan(project);
    expect(afterManifest.manifest.digest).not.toBe(before.manifest.digest);
    expect(isSyncStateFresh(readSyncState(project), {
      head: null,
      manifestDigest: afterManifest.manifest.digest,
      externalFingerprint: afterManifest.externalFingerprint,
    })).toBe(false);
  });

  it('serializes exact PID-first bytes and parses only legacy or versioned records', () => {
    const token = '11111111-1111-4111-8111-111111111111';
    const bytes = serializeKgSyncWorkerMarker(42, token, 123, 'maintenance');
    expect(bytes).toBe(`42\n{"schema_version":"kg-sync-worker-marker/1.0","pid":42,"token":"${token}","started_at":123,"mode":"maintenance"}\n`);
    expect(parseKgSyncWorkerMarker('42')).toMatchObject({ pid: 42, legacy: true, mode: 'worker' });
    expect(parseKgSyncWorkerMarker('42\n')).toMatchObject({ pid: 42, legacy: true });
    expect(parseKgSyncWorkerMarker(bytes)).toMatchObject({ pid: 42, token, legacy: false });
    expect(parseKgSyncWorkerMarker('42\n{"pid":42}\n')).toBeNull();
    expect(parseKgSyncWorkerMarker('42\nextra\nextra\n')).toBeNull();
    expect(parseKgSyncWorkerMarker(`42\n{"schema_version":"kg-sync-worker-marker/1.0","pid":42,"token":"${token}","started_at":NaN,"mode":"worker"}\n`)).toBeNull();
    expect(parseKgSyncWorkerMarker(`42\n{"schema_version":"kg-sync-worker-marker/1.0","pid":42,"token":"${token}","started_at":1e999,"mode":"worker"}\n`)).toBeNull();
    expect(parseKgSyncWorkerMarker(`42\n{"schema_version":"kg-sync-worker-marker/1.0","pid":42,"token":"${token}","started_at":null,"mode":"worker"}\n`)).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('does not follow worker marker symlinks and fails visibly', () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    const target = join(project, 'foreign-worker.pid');
    writeFileSync(target, `${process.pid}\n`);
    symlinkSync(target, path);

    const inspection = inspectKgSyncWorkerMarker(project, {
      now: Date.now() + 10_000,
      isPidLive: () => { throw new Error('symlink target PID must not be inspected'); },
    });
    expect(inspection).toMatchObject({
      exists: true,
      live: false,
      owner: null,
      foreignPid: null,
      invalidReason: 'symlink',
    });

    expect(() => acquireKgSyncWorkerToken(project, 'worker', {
      now: Date.now() + 10_000,
      isPidLive: () => false,
    })).toThrow('marker is symlink');
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(`${process.pid}\n`);
  });

  it('reports a directory marker as unsafe and never removes it recursively', () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    mkdirSync(path);
    writeFileSync(join(path, 'sentinel.txt'), 'preserve');

    expect(inspectKgSyncWorkerMarker(project)).toMatchObject({
      exists: true,
      live: false,
      invalidReason: 'not-regular',
    });
    expect(() => acquireKgSyncWorkerToken(project, 'worker')).toThrow('marker is not-regular');
    expect(lstatSync(path).isDirectory()).toBe(true);
    expect(readFileSync(join(path, 'sentinel.txt'), 'utf8')).toBe('preserve');
  });

  it.runIf(process.platform !== 'win32')('rejects a symlinked .workflow ancestor before marker mutation', () => {
    const project = root();
    const outside = root();
    const workflowPath = join(project, '.workflow');
    const outsideWorkflow = join(outside, '.workflow');
    const outsideMarker = join(outsideWorkflow, 'kg-sync-worker.pid');
    rmSync(workflowPath, { recursive: true, force: true });
    writeFileSync(outsideMarker, `${process.pid}\n`);
    symlinkSync(outsideWorkflow, workflowPath, 'dir');

    expect(inspectKgSyncWorkerMarker(project)).toMatchObject({
      exists: true,
      live: false,
      invalidReason: 'unsafe-parent',
    });
    expect(() => acquireKgSyncWorkerToken(project, 'worker')).toThrow('marker parent must be a real directory');
    expect(readFileSync(outsideMarker, 'utf8')).toBe(`${process.pid}\n`);
  });

  it('expires live versioned and legacy PID leases after staleMs', () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    const base = Date.now();
    const token = '44444444-4444-4444-8444-444444444444';

    writeFileSync(path, serializeKgSyncWorkerMarker(1, token, base - 360_000, 'worker'));
    const versionedOld = new Date(base - 360_000);
    utimesSync(path, versionedOld, versionedOld);
    expect(inspectKgSyncWorkerMarker(project, {
      now: base,
      isPidLive: pid => pid === 1,
    })).toMatchObject({ live: false, owner: { pid: 1 } });
    const versioned = acquireKgSyncWorkerToken(project, 'worker', {
      now: base,
      staleMs: 100,
      isPidLive: pid => pid === 1,
    });
    expect(versioned.acquired).toBe(true);
    if (versioned.acquired) releaseKgSyncWorkerToken(versioned.token);

    writeFileSync(path, '1\n');
    const old = new Date(base - 10_000);
    utimesSync(path, old, old);
    const legacy = acquireKgSyncWorkerToken(project, 'worker', {
      now: base,
      staleMs: 100,
      isPidLive: pid => pid === 1,
    });
    expect(legacy.acquired).toBe(true);
    if (legacy.acquired) releaseKgSyncWorkerToken(legacy.token);
  });

  it('heartbeats a long-running token before its finite lease expires', async () => {
    const project = root();
    const base = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(base);
    const first = acquireKgSyncWorkerToken(project, 'worker', { staleMs: 600 });
    try {
      expect(first.acquired).toBe(true);
      await vi.advanceTimersByTimeAsync(800);
      expect(inspectKgSyncWorkerMarker(project, {
        now: Date.now(),
        isPidLive: pid => pid === process.pid,
      })).toMatchObject({ live: true, owner: { pid: process.pid } });
      expect(acquireKgSyncWorkerToken(project, 'maintenance', {
        now: Date.now(),
        staleMs: 600,
        isPidLive: pid => pid === process.pid,
      })).toMatchObject({ acquired: false, ownerMode: 'worker' });
    } finally {
      if (first.acquired) releaseKgSyncWorkerToken(first.token);
      vi.useRealTimers();
    }
  });

  it('fails visibly instead of reclaiming a malformed mutation guard', () => {
    const project = root();
    const guardPath = join(project, '.workflow', '.kg-sync-worker-mutation.lock');
    mkdirSync(guardPath);

    expect(() => acquireKgSyncWorkerToken(project, 'worker'))
      .toThrow('mutation guard is malformed or requires manual cleanup');
    expect(lstatSync(guardPath).isDirectory()).toBe(true);
  });

  it('serializes a stale reclaim against a deterministic second contender', async () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    const base = Date.now();
    const staleToken = '55555555-5555-4555-8555-555555555555';
    const firstToken = '66666666-6666-4666-8666-666666666666';
    const startedPath = join(project, 'contender-started');
    const resultPath = join(project, 'contender-result.json');
    writeFileSync(path, serializeKgSyncWorkerMarker(process.pid, staleToken, base - 10_000, 'worker'));
    const staleTime = new Date(base - 10_000);
    utimesSync(path, staleTime, staleTime);

    let contender: ReturnType<typeof spawn> | null = null;
    let callbackCount = 0;
    const moduleUrl = new URL('../kg-sync-worker-state.ts', import.meta.url).href;
    const childSource = [
      `import { writeFileSync } from 'node:fs';`,
      `import { acquireKgSyncWorkerToken } from ${JSON.stringify(moduleUrl)};`,
      `writeFileSync(${JSON.stringify(startedPath)}, 'ready');`,
      `const result = acquireKgSyncWorkerToken(${JSON.stringify(project)}, 'worker', { now: ${base + 1_000}, staleMs: 60_000 });`,
      `writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));`,
    ].join('\n');

    const first = acquireKgSyncWorkerToken(project, 'worker', {
      token: firstToken,
      now: base,
      staleMs: 100,
      isPidLive: pid => {
        callbackCount += 1;
        if (callbackCount === 1) {
          contender = spawn(process.execPath, [
            '--no-warnings',
            '--experimental-strip-types',
            '--input-type=module',
            '-e',
            childSource,
          ], { stdio: ['ignore', 'ignore', 'pipe'] });
          waitForPathSync(startedPath);
          sleepTestSync(100);
          expect(existsSync(resultPath)).toBe(false);
        }
        return pid === process.pid;
      },
    });
    expect(first.acquired).toBe(true);
    expect(contender).not.toBeNull();
    if (!contender) throw new Error('contender was not spawned');
    const stderr: Buffer[] = [];
    contender.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
    const exitCode = await waitForChildExit(contender);
    expect(exitCode, Buffer.concat(stderr).toString('utf8')).toBe(0);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      acquired: false,
      reason: 'already-running',
      ownerPid: process.pid,
    });
    expect(inspectKgSyncWorkerMarker(project).owner).toMatchObject({ token: firstToken });
    if (first.acquired) releaseKgSyncWorkerToken(first.token);
  });

  it('bounds worker marker reads and reclaims old malformed or future records', () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    const base = Date.now();
    const token = '33333333-3333-4333-8333-333333333333';

    writeFileSync(path, Buffer.alloc(KG_SYNC_WORKER_MARKER_MAX_BYTES + 1, 0x20));
    expect(inspectKgSyncWorkerMarker(project, { now: base + 10_000 })).toMatchObject({
      exists: true,
      live: false,
      invalidReason: 'too-large',
    });
    const afterOversized = acquireKgSyncWorkerToken(project, 'worker', {
      now: base + 10_000,
      isPidLive: () => false,
    });
    expect(afterOversized.acquired).toBe(true);
    if (afterOversized.acquired) releaseKgSyncWorkerToken(afterOversized.token);

    writeFileSync(path, `88\n{"schema_version":"kg-sync-worker-marker/1.0","pid":88,"token":"${token}","started_at":NaN,"mode":"worker"}\n`);
    expect(inspectKgSyncWorkerMarker(project, {
      now: base + 20_000,
      isPidLive: pid => pid === 88,
    })).toMatchObject({ live: false, foreignPid: 88, invalidReason: 'malformed' });
    const afterMalformed = acquireKgSyncWorkerToken(project, 'worker', {
      now: base + 20_000,
      isPidLive: pid => pid === 88,
    });
    expect(afterMalformed.acquired).toBe(true);
    if (afterMalformed.acquired) releaseKgSyncWorkerToken(afterMalformed.token);

    writeFileSync(path, serializeKgSyncWorkerMarker(99, token, base + 3_600_000, 'worker'));
    expect(inspectKgSyncWorkerMarker(project, {
      now: base + 30_000,
      isPidLive: pid => pid === 99,
    })).toMatchObject({
      live: false,
      owner: null,
      foreignPid: 99,
      invalidReason: 'future-timestamp',
    });
    const afterFuture = acquireKgSyncWorkerToken(project, 'worker', {
      now: base + 30_000,
      isPidLive: pid => pid === 99,
    });
    expect(afterFuture.acquired).toBe(true);
    if (afterFuture.acquired) releaseKgSyncWorkerToken(afterFuture.token);
  });

  it('keeps live owners, fences fresh foreign records, and cleans expired markers', () => {
    const project = root();
    const path = kgSyncWorkerMarkerPath(project);
    writeFileSync(path, '77\n');
    const legacy = acquireKgSyncWorkerToken(project, 'worker', { isPidLive: pid => pid === 77 });
    expect(legacy).toMatchObject({ acquired: false, ownerMode: 'worker', ownerPid: 77, legacy: true });
    expect(readFileSync(path, 'utf8')).toBe('77\n');

    writeFileSync(path, '88\n{malformed}\n');
    const foreign = inspectKgSyncWorkerMarker(project, { isPidLive: pid => pid === 88 });
    expect(foreign).toMatchObject({
      live: false,
      owner: null,
      foreignPid: 88,
      invalidReason: 'malformed',
    });
    expect(acquireKgSyncWorkerToken(project, 'maintenance', {
      isPidLive: pid => pid === 88,
    })).toMatchObject({ acquired: false, ownerMode: 'foreign', ownerPid: 88 });

    writeFileSync(path, '99\n');
    const old = new Date(Date.now() - 10_000);
    utimesSync(path, old, old);
    const replaced = acquireKgSyncWorkerToken(project, 'worker', {
      staleMs: 100,
      isPidLive: () => false,
    });
    expect(replaced.acquired).toBe(true);
    if (replaced.acquired) releaseKgSyncWorkerToken(replaced.token);
  });

  it('provides exclusive single-flight and token/inode ownership cleanup', () => {
    const project = root();
    const first = acquireKgSyncWorkerToken(project, 'worker');
    expect(first.acquired).toBe(true);
    const inode = statSync(kgSyncWorkerMarkerPath(project)).ino;
    const second = acquireKgSyncWorkerToken(project, 'worker');
    expect(second).toMatchObject({ acquired: false, ownerMode: 'worker' });
    expect(statSync(kgSyncWorkerMarkerPath(project)).ino).toBe(inode);
    if (!first.acquired) throw new Error('fixture token was not acquired');
    if (!first.token.generation) throw new Error('fixture token generation was not captured');
    expect(releaseKgSyncWorkerToken({ ...first.token, token: 'wrong' })).toBe(false);
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(true);
    expect(releaseKgSyncWorkerToken({
      ...first.token,
      generation: {
        ...first.token.generation,
        // Windows file IDs can exceed Number.MAX_SAFE_INTEGER, where +1 may
        // round back to the same value. Use a guaranteed-distinct sentinel.
        inode: first.token.generation.inode === 0 ? 1 : 0,
      },
    })).toBe(false);
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(true);
    expect(releaseKgSyncWorkerToken(first.token)).toBe(true);
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(false);
  });

  it('blocks auto sync under maintenance and remains compatible with v0.5.63 parseInt', async () => {
    const project = root();
    await withKgSyncMaintenanceToken(project, async () => {
      const path = kgSyncWorkerMarkerPath(project);
      const bytes = readFileSync(path, 'utf8');
      const inode = statSync(path).ino;
      expect(workerAlreadyRunningV063(project)).toBe(true);
      const result = await evaluateKgSync(project, `maintenance-${Date.now()}`);
      expect(result).toMatchObject({
        synced: false,
        reason: 'already-running/maintenance',
        workerMode: 'maintenance',
      });
      expect(readFileSync(path, 'utf8')).toBe(bytes);
      expect(statSync(path).ino).toBe(inode);
    });
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(false);
  });

  it('releases a maintenance token when the protected operation fails', async () => {
    const project = root();
    await expect(withKgSyncMaintenanceToken(project, async () => {
      throw new Error('maintenance-fault');
    })).rejects.toThrow('maintenance-fault');
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(false);
  });

  it('keeps worker failures health-visible, token-clean and immediately retryable', async () => {
    const project = root();
    const canonicalProject = realpathSync(project);
    writeSyncState(project, 'old-head', 'old-manifest', 'old-headers');
    const prior = readSyncState(project)?.lastSuccessful;
    const faultToken = '22222222-2222-4222-8222-222222222222';
    const acquired = acquireKgSyncWorkerToken(project, 'worker', { token: faultToken });
    if (!acquired.acquired) throw new Error('fixture worker token was not acquired');
    const priorWorker = process.env.MAESTRO_KG_SYNC_WORKER;
    const priorToken = process.env.MAESTRO_KG_SYNC_WORKER_TOKEN;
    process.env.MAESTRO_KG_SYNC_WORKER = '1';
    process.env.MAESTRO_KG_SYNC_WORKER_TOKEN = faultToken;
    const cooldownKey = kgSyncCooldownKey('fault-session', canonicalProject);
    kgSyncGuard.markDone(cooldownKey);
    try {
      const result = await evaluateKgSync(project, 'fault-session');
      expect(result).toMatchObject({ synced: false, reason: 'sync-error' });
    } finally {
      if (priorWorker === undefined) delete process.env.MAESTRO_KG_SYNC_WORKER;
      else process.env.MAESTRO_KG_SYNC_WORKER = priorWorker;
      if (priorToken === undefined) delete process.env.MAESTRO_KG_SYNC_WORKER_TOKEN;
      else process.env.MAESTRO_KG_SYNC_WORKER_TOKEN = priorToken;
    }
    expect(existsSync(kgSyncWorkerMarkerPath(project))).toBe(false);
    expect(readSyncState(project)).toMatchObject({
      lastSuccessful: prior,
      lastAttempt: { status: 'failed' },
    });
    expect(getSyncStateHealth(project)).toMatchObject({ status: 'error', stale: true });
    expect(kgSyncGuard.shouldRun(cooldownKey)).toBe(true);

    // A failed worker open must release DatabaseSync before callers delete a
    // broken database and retry. Keeping this assertion inside the test makes
    // a leaked handle the primary failure rather than an afterEach EBUSY.
    const dbPath = join(project, '.workflow', 'kg', 'maestro.db');
    rmSync(dbPath);
    writeFileSync(dbPath, 'retry-fixture');
  });

  it('waits for a live owner without deleting its marker', async () => {
    const project = root();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
    if (!child.pid) throw new Error('child PID unavailable');
    const path = kgSyncWorkerMarkerPath(project);
    writeFileSync(path, `${child.pid}\n`);
    const waiting = waitForKgSyncWorkerQuiescence(project, 2000);
    setTimeout(() => child.kill(), 40);
    await waiting;
    expect(readFileSync(path, 'utf8')).toBe(`${child.pid}\n`);
  });
});

function requireExec(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: 'ignore' });
}

function waitForPathSync(path: string, timeoutMs = 2_000): void {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    sleepTestSync(10);
  }
}

function sleepTestSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise<number | null>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('Timed out waiting for marker contender'));
    }, 5_000);
    child.once('error', error => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });
}
