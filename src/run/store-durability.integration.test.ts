import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SessionStore } from './store.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const childFixture = join(repoRoot, 'src', 'run', '__fixtures__', 'session-store-crash-child.mjs');
const sourceStore = join(repoRoot, 'src', 'run', 'store.ts');
const repositoryDistStore = join(repoRoot, 'dist', 'src', 'run', 'store.js');
const staleBuildSentinel = 'MAESTRO_STALE_DURABILITY_STORE_SENTINEL';
const roots: string[] = [];
const authorityFiles = ['session.json', 'gates.json', 'artifacts.json', 'evidence.json'];
let sourceBuildRoot = '';
let sourceBuildStore = '';
let sourceStoreSha256 = '';
let sourceBuildStoreSha256 = '';
let staleBuildStoreSha256 = '';

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface StressRound {
  round: number;
  seed: number;
  writers: number;
  duration_ms: number;
  ready_wait_ms: number;
  failure_count: number;
  failures: Array<{ writer: number; code: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string }>;
  expected_counter: number;
  observed_counter: number | null;
  lost_writes: number | null;
  counter_json_valid: boolean;
  authority_valid: boolean;
  authority_unchanged: boolean;
  lock_absent_after: boolean;
  transaction_intent_absent_after: boolean;
  lock_watch_events: number;
  lock_present_transitions: number;
  lock_absent_transitions: number;
  lock_tokens_observed: number;
  observer_errors: Array<{ code: string | null; message: string }>;
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-store-integration-'));
  roots.push(root);
  return root;
}

function buildCurrentSourceStore(): void {
  const sourceBuildBase = join(repoRoot, '.workflow', 'tmp');
  mkdirSync(sourceBuildBase, { recursive: true });
  sourceBuildRoot = mkdtempSync(join(sourceBuildBase, 'maestro-store-source-build-'));
  sourceBuildStore = join(sourceBuildRoot, 'src', 'run', 'store.js');
  sourceStoreSha256 = sha(sourceStore);
  mkdirSync(dirname(sourceBuildStore), { recursive: true });
  writeFileSync(sourceBuildStore, `throw new Error('${staleBuildSentinel}');\n`);
  staleBuildStoreSha256 = sha(sourceBuildStore);

  const compiler = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [
    compiler,
    '--project', join(repoRoot, 'tsconfig.json'),
    '--outDir', sourceBuildRoot,
    '--declaration', 'false',
    '--declarationMap', 'false',
    '--sourceMap', 'false',
    '--incremental', 'false',
    '--pretty', 'false',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed to compile current SessionStore source for durability tests (exit ${result.status ?? 'unknown'}):\n${result.stdout}${result.stderr}`);
  }
  if (!existsSync(sourceBuildStore)) {
    throw new Error(`TypeScript compiler did not emit the durability test store: ${sourceBuildStore}`);
  }
  const emitted = readFileSync(sourceBuildStore, 'utf8');
  if (emitted.includes(staleBuildSentinel)) {
    throw new Error(`TypeScript compiler left the stale durability test store in place: ${sourceBuildStore}`);
  }
  const sourceSha256AfterBuild = sha(sourceStore);
  if (sourceSha256AfterBuild !== sourceStoreSha256) {
    throw new Error(`SessionStore source changed during the isolated durability build: expected ${sourceStoreSha256}, got ${sourceSha256AfterBuild}`);
  }
  sourceBuildStoreSha256 = sha(sourceBuildStore);
}

function runChild(args: string[], timeoutMs = 20_000): Promise<ChildResult> {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [childFixture, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MAESTRO_DURABILITY_STORE_URL: pathToFileURL(sourceBuildStore).href,
        MAESTRO_DURABILITY_SOURCE_PATH: sourceStore,
        MAESTRO_DURABILITY_SOURCE_SHA256: sourceStoreSha256,
        MAESTRO_DURABILITY_COMPILED_SHA256: sourceBuildStoreSha256,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function waitForReady(child: ChildProcess, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(`child ready timeout; stdout=${stdout}`)), timeoutMs);
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.includes('\n')) {
        clearTimeout(timer);
        resolveReady(stdout);
      }
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function snapshot(store: SessionStore, sessionId: string): Record<string, string | null> {
  const dir = store.sessionDir(sessionId);
  return Object.fromEntries(authorityFiles.map(file => {
    const path = join(dir, file);
    return [file, existsSync(path) ? sha(path) : null];
  }));
}

async function waitForReadyFiles(barrierDir: string, writers: number, timeoutMs = 15_000): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = readdirSync(barrierDir).filter(name => name.startsWith('ready-') && name.endsWith('.json'));
    if (ready.length === writers) return Date.now() - started;
    await new Promise(resolveWait => setTimeout(resolveWait, 2));
  }
  throw new Error(`stress ready timeout: ${barrierDir}; expected=${writers}`);
}

function startLockLifecycleMonitor(lock: string, directory: string): {
  stop: () => { watchEvents: number; presentTransitions: number; absentTransitions: number; tokens: string[]; errors: Array<{ code: string | null; message: string }> };
} {
  let watchEvents = 0;
  let presentTransitions = 0;
  let absentTransitions = 0;
  let lastPresent = existsSync(lock);
  const tokens = new Set<string>();
  const errors: Array<{ code: string | null; message: string }> = [];
  const watcher = watch(directory, (_event, filename) => {
    if (filename === '.session-store.lock') watchEvents += 1;
  });
  const interval = setInterval(() => {
    const present = existsSync(lock);
    if (present !== lastPresent) {
      if (present) presentTransitions += 1;
      else absentTransitions += 1;
      lastPresent = present;
    }
    if (!present) return;
    try {
      const record = JSON.parse(readFileSync(lock, 'utf8')) as { token?: string };
      if (record.token) tokens.add(record.token);
    } catch (error) {
      const value = error as NodeJS.ErrnoException;
      errors.push({ code: value.code ?? null, message: value.stack ?? value.message });
    }
  }, 1);
  return {
    stop: () => {
      clearInterval(interval);
      watcher.close();
      return { watchEvents, presentTransitions, absentTransitions, tokens: [...tokens], errors };
    },
  };
}

beforeAll(() => {
  buildCurrentSourceStore();
}, 60_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  if (sourceBuildRoot) rmSync(sourceBuildRoot, { recursive: true, force: true });
});

describe('SessionStore multi-process and crash durability', () => {
  it('binds child processes to a fresh isolated build of the current source revision', async () => {
    const result = await runChild(['report-store-source', createRoot()]);
    const line = result.stdout.trim().split(/\r?\n/).at(-1);
    const observation = line ? JSON.parse(line) as {
      store_module_url: string;
      source_path: string;
      source_sha256: string;
      compiled_sha256: string;
    } : null;

    expect(result).toMatchObject({ code: 0, timedOut: false, stderr: '' });
    expect(sourceBuildStoreSha256).not.toBe(staleBuildStoreSha256);
    expect(readFileSync(sourceBuildStore, 'utf8')).not.toContain(staleBuildSentinel);
    expect(observation).toEqual({
      store_module_url: pathToFileURL(sourceBuildStore).href,
      source_path: sourceStore,
      source_sha256: sourceStoreSha256,
      compiled_sha256: sourceBuildStoreSha256,
    });
    expect(observation?.store_module_url).not.toBe(pathToFileURL(repositoryDistStore).href);
  });

  it('INV-01 refuses a live child owner while its lock is young', async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const child = spawn(process.execPath, [childFixture, 'hold-lock', root], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(child);
    let entered = false;
    let error: unknown;
    try { store.withLock(() => { entered = true; }); } catch (caught) { error = caught; }
    child.kill('SIGKILL');

    expect({ entered, error: error instanceof Error ? error.message : null })
      .toEqual({ entered: false, error: expect.stringContaining('SessionStore locked by PID') });
  }, 15_000);

  it('INV-01 never steals an aged lock from a still-live child owner', async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const child = spawn(process.execPath, [childFixture, 'hold-lock', root], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(child);
    const lock = join(store.sessionsRoot, '.session-store.lock');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let entered = false;
    let error: unknown;
    try { store.withLock(() => { entered = true; }); } catch (caught) { error = caught; }
    child.kill('SIGKILL');

    expect({ entered, error: error instanceof Error ? error.message : null }, 'parent displaced a live child solely because mtime exceeded 30s')
      .toEqual({ entered: false, error: expect.stringContaining('SessionStore locked by PID') });
  }, 15_000);

  it('INV-02 reclaims a recent lock after the child owner is dead', async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const child = spawn(process.execPath, [childFixture, 'hold-lock', root], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(child);
    child.kill('SIGKILL');
    await new Promise<void>(resolveClose => child.once('close', () => resolveClose()));
    let entered = false;

    store.withLock(() => { entered = true; });

    expect(entered).toBe(true);
  });

  it('INV-01/04 serializes deterministic high-frequency writers without lock races or loss', async () => {
    const root = createRoot();
    const store = new SessionStore(root);
    const authoritySession = 'stress-authority';
    store.createSession(authoritySession, 'contention control');
    const authorityBefore = snapshot(store, authoritySession);
    const rounds: StressRound[] = [];
    const totalRounds = 24;
    const writers = 8;
    const baseSeed = 0x5eed2026;
    let expectedCounter = 0;

    for (let round = 0; round < totalRounds; round += 1) {
      const seed = (baseSeed + Math.imul(round + 1, 0x9e3779b1)) >>> 0;
      const barrierDir = join(root, '.workflow', 'stress-barriers', `round-${String(round).padStart(2, '0')}-${seed}`);
      mkdirSync(barrierDir, { recursive: true });
      const lock = join(store.sessionsRoot, '.session-store.lock');
      const monitor = startLockLifecycleMonitor(lock, store.sessionsRoot);
      const started = Date.now();
      const pending = Array.from({ length: writers }, (_, writer) =>
        runChild(['update-counter-stress', root, barrierDir, String(seed), String(writer)], 30_000)
          .then(result => ({ writer, result })));
      const readyWaitMs = await waitForReadyFiles(barrierDir, writers);
      writeFileSync(join(barrierDir, 'release'), JSON.stringify({ round, seed, released_at: Date.now() }), { flag: 'wx' });
      const results = await Promise.all(pending);
      const lifecycle = monitor.stop();
      expectedCounter += writers;

      let observedCounter: number | null = null;
      let counterJsonValid = false;
      try {
        const counter = JSON.parse(readFileSync(join(root, '.workflow', 'durability-counter.json'), 'utf8')) as { value?: unknown };
        if (typeof counter.value === 'number') {
          observedCounter = counter.value;
          counterJsonValid = true;
        }
      } catch { /* reported below */ }
      let authorityValid = true;
      try { new SessionStore(root).readBundle(authoritySession); } catch { authorityValid = false; }
      const authorityAfter = snapshot(store, authoritySession);
      const failures = results
        .filter(item => item.result.code !== 0)
        .map(item => ({
          writer: item.writer,
          code: item.result.code,
          signal: item.result.signal,
          stderr: item.result.stderr,
          stdout: item.result.stdout,
        }));
      const summary: StressRound = {
        round,
        seed,
        writers,
        duration_ms: Date.now() - started,
        ready_wait_ms: readyWaitMs,
        failure_count: failures.length,
        failures,
        expected_counter: expectedCounter,
        observed_counter: observedCounter,
        lost_writes: observedCounter === null ? null : expectedCounter - observedCounter,
        counter_json_valid: counterJsonValid,
        authority_valid: authorityValid,
        authority_unchanged: JSON.stringify(authorityAfter) === JSON.stringify(authorityBefore),
        lock_absent_after: !existsSync(lock),
        transaction_intent_absent_after: !existsSync(join(store.sessionsRoot, '.session-store-transaction.json')),
        lock_watch_events: lifecycle.watchEvents,
        lock_present_transitions: lifecycle.presentTransitions,
        lock_absent_transitions: lifecycle.absentTransitions,
        lock_tokens_observed: lifecycle.tokens.length,
        observer_errors: lifecycle.errors,
      };
      rounds.push(summary);
      console.log(`DURABILITY_STRESS_ROUND ${JSON.stringify(summary)}`);
    }

    const failedRounds = rounds.filter(round => (
      round.failure_count > 0
      || round.lost_writes !== 0
      || !round.counter_json_valid
      || !round.authority_valid
      || !round.authority_unchanged
      || !round.lock_absent_after
      || !round.transaction_intent_absent_after
    ));
    const totalChildFailures = rounds.reduce((total, round) => total + round.failure_count, 0);
    const finalCounter = rounds.at(-1)?.observed_counter ?? null;
    const compactFailures = failedRounds.map(round => ({
      round: round.round,
      seed: round.seed,
      failure_count: round.failure_count,
      lost_writes: round.lost_writes,
      error_heads: round.failures.map(failure => failure.stderr.split(/\r?\n/).find(line => line.startsWith('Error:')) ?? failure.stderr),
    }));
    console.log(`DURABILITY_STRESS_SUMMARY ${JSON.stringify({ totalRounds, writers, totalWriters: totalRounds * writers, totalChildFailures, finalCounter, compactFailures })}`);
    expect({ totalRounds, writers, totalChildFailures, finalCounter, failed_round_count: failedRounds.length, compactFailures }, 'deterministic contention reproduced a lock race, lost write, residue, or authority corruption')
      .toEqual({ totalRounds: 24, writers: 8, totalChildFailures: 0, finalCounter: 192, failed_round_count: 0, compactFailures: [] });
  }, 180_000);

  it('INV-05 rejects a silently mixed bundle after a crash following rename 1', async () => {
    const controlRoot = createRoot();
    const crashRoot = createRoot();
    const sessionId = 'crash-boundary';
    const controlStore = new SessionStore(controlRoot);
    const crashStore = new SessionStore(crashRoot);
    controlStore.createSession(sessionId, 'control');
    crashStore.createSession(sessionId, 'control');
    const oldState = snapshot(crashStore, sessionId);
    const control = await runChild(['update-bundle', controlRoot, sessionId]);
    expect(control).toMatchObject({ code: 0, timedOut: false });
    const newState = snapshot(controlStore, sessionId);

    const crashed = await runChild(['crash-after-rename', crashRoot, sessionId, '1']);
    const after = snapshot(crashStore, sessionId);
    const oldFiles = authorityFiles.filter(file => after[file] === oldState[file]);
    const newFiles = authorityFiles.filter(file => after[file] === newState[file]);
    const mixed = oldFiles.length > 0 && newFiles.length > 0;

    expect({ child: crashed, mixed, oldFiles, newFiles, after }, 'startup accepted or left a mixed authority bundle after child termination')
      .toMatchObject({ mixed: false });
  }, 60_000);

  it('INV-06 keeps the last-good authority readable across the unlink-before-retry crash window', async () => {
    const root = createRoot();
    const sessionId = 'unlink-boundary';
    const store = new SessionStore(root);
    store.createSession(sessionId, 'control');

    const crashed = await runChild(['crash-after-unlink', root, sessionId]);
    const after = snapshot(store, sessionId);

    expect({ child: crashed, after }, 'EPERM retry crash removed an authoritative destination without reconciliation')
      .toSatisfy((value: { after: Record<string, string | null> }) => authorityFiles.every(file => value.after[file] !== null));
  }, 60_000);

  it('INV-07 reconciles orphan lock and temp residue before the next authoritative read', async () => {
    const root = createRoot();
    const sessionId = 'residue-boundary';
    const store = new SessionStore(root);
    store.createSession(sessionId, 'control');

    const crashed = await runChild(['crash-after-rename', root, sessionId, '1']);
    const fresh = new SessionStore(root);
    let readError: string | null = null;
    try { fresh.readBundle(sessionId); } catch (error) { readError = (error as Error).message; }
    const tempFiles = readdirSync(store.sessionDir(sessionId)).filter(name => name.includes('.tmp-'));
    const lockExists = existsSync(join(store.sessionsRoot, '.session-store.lock'));

    expect({ child: crashed, lockExists, tempFiles, readError }, 'startup read did not reconcile crash residue')
      .toEqual({ child: expect.any(Object), lockExists: false, tempFiles: [], readError: null });
  }, 60_000);
});

const windowsIt = process.platform === 'win32' ? it : it.skip;

it('reconciles a whitelisted partial shell after a pre-authority child crash', async () => {
  const root = createRoot();
  const sessionId = 'partial-shell-crash';

  const crashed = await runChild(['crash-after-partial-shell', root, sessionId]);
  const store = new SessionStore(root);
  expect(crashed.timedOut).toBe(false);
  expect(store.sessionExists(sessionId)).toBe(false);

  const recovered = store.createSession(sessionId, 'partial shell recovery');

  expect(recovered.session.session_id).toBe(sessionId);
  expect(authorityFiles.every(file => existsSync(join(store.sessionDir(sessionId), file)))).toBe(true);
  expect(['runs', 'specs', 'knowhow'].every(name => existsSync(join(store.sessionDir(sessionId), name)))).toBe(true);
  expect(readFileSync(join(store.sessionDir(sessionId), 'events.ndjson'), 'utf8')).toBe('');
  expect(readFileSync(join(store.sessionDir(sessionId), 'context.md'), 'utf8')).toBe('# partial shell recovery\n');
});

windowsIt('bounds persistent Windows lock errors', async () => {
  const result = await runChild(['persistent-lock-stat-error', createRoot()], 15_000);
  const line = result.stdout.trim().split(/\r?\n/).at(-1);
  const observation = line ? JSON.parse(line) as { elapsed_ms: number; error: string | null } : null;

  expect(result).toMatchObject({ code: 0, timedOut: false });
  expect(observation?.error).toMatch(/Cannot safely inspect SessionStore lock/);
  expect(observation?.elapsed_ms).toBeGreaterThanOrEqual(4_500);
  expect(observation?.elapsed_ms).toBeLessThanOrEqual(7_500);
}, 20_000);

windowsIt('INV-06 Windows capability: injected EPERM unlink window retains every authority file', async () => {
  const root = createRoot();
  const sessionId = 'windows-unlink-boundary';
  const store = new SessionStore(root);
  store.createSession(sessionId, 'control');

  await runChild(['crash-after-unlink', root, sessionId]);

  expect(authorityFiles.every(file => existsSync(join(store.sessionDir(sessionId), file)))).toBe(true);
}, 60_000);
