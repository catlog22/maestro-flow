import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const [mode, projectRootArg, sessionId = 'durability-session', boundaryArg = '1', writerArg = '0'] = process.argv.slice(2);
const projectRoot = resolve(projectRootArg);
const authorityNames = new Set(['session.json', 'gates.json', 'artifacts.json', 'evidence.json']);

function sha256(path) {
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

async function loadCurrentSourceStore() {
  const storeModuleUrl = process.env.MAESTRO_DURABILITY_STORE_URL;
  const sourcePath = process.env.MAESTRO_DURABILITY_SOURCE_PATH;
  const expectedSourceSha256 = process.env.MAESTRO_DURABILITY_SOURCE_SHA256;
  const expectedCompiledSha256 = process.env.MAESTRO_DURABILITY_COMPILED_SHA256;
  if (!storeModuleUrl || !sourcePath || !expectedSourceSha256 || !expectedCompiledSha256) {
    throw new Error('Durability child requires an isolated current-source store build');
  }
  const sourceSha256 = sha256(sourcePath);
  if (sourceSha256 !== expectedSourceSha256) {
    throw new Error(`SessionStore source changed after the isolated durability build: expected ${expectedSourceSha256}, got ${sourceSha256}`);
  }
  const compiledSha256 = sha256(fileURLToPath(storeModuleUrl));
  if (compiledSha256 !== expectedCompiledSha256) {
    throw new Error(`Isolated durability store changed after compilation: expected ${expectedCompiledSha256}, got ${compiledSha256}`);
  }
  const storeModule = await import(storeModuleUrl);
  return {
    SessionStore: storeModule.SessionStore,
    provenance: {
      store_module_url: storeModuleUrl,
      source_path: sourcePath,
      source_sha256: sourceSha256,
      compiled_sha256: compiledSha256,
    },
  };
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function waitSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function deterministicDelay(seed, writer) {
  let value = (Number(seed) ^ Math.imul(Number(writer) + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) % 16;
}

if (mode === 'crash-after-partial-shell') {
  const sessionDir = join(projectRoot, '.workflow', 'sessions', sessionId);
  fs.mkdirSync(join(sessionDir, 'runs'), { recursive: true });
  fs.writeFileSync(join(sessionDir, 'events.ndjson'), '');
  emit({ ready: true, sessionDir });
  process.kill(process.pid, 'SIGKILL');
} else if (mode === 'persistent-lock-stat-error') {
  const lock = join(projectRoot, '.workflow', 'sessions', '.session-store.lock');
  fs.mkdirSync(join(projectRoot, '.workflow', 'sessions'), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({
    schema_version: 'session-store-lock/1.0',
    pid: process.pid,
    token: 'persistent-windows-lock-1234567890',
    acquired_at: Date.now(),
  }), { flag: 'wx' });
  const originalStat = fs.statSync;
  fs.statSync = function patchedStat(path, ...args) {
    if (String(path).endsWith('.session-store.lock')) {
      throw Object.assign(new Error(`injected EACCES: ${path}`), { code: 'EACCES' });
    }
    return originalStat(path, ...args);
  };
  syncBuiltinESMExports();
  const { SessionStore } = await loadCurrentSourceStore();
  const started = Date.now();
  let error = null;
  try {
    new SessionStore(projectRoot).withLock(() => undefined);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  emit({ elapsed_ms: Date.now() - started, error });
} else if (mode === 'hold-lock') {
  const lock = join(projectRoot, '.workflow', 'sessions', '.session-store.lock');
  fs.mkdirSync(join(projectRoot, '.workflow', 'sessions'), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }), { flag: 'wx' });
  emit({ ready: true, pid: process.pid, lock });
  setInterval(() => {}, 1_000);
} else {
  if (mode === 'crash-after-rename') {
    const boundary = Number(boundaryArg);
    const originalRename = fs.renameSync;
    let promoted = 0;
    fs.renameSync = function patchedRename(src, dest) {
      originalRename(src, dest);
      if (authorityNames.has(String(dest).split(/[\\/]/).at(-1))) {
        promoted += 1;
        if (promoted === boundary) process.kill(process.pid, 'SIGKILL');
      }
    };
    syncBuiltinESMExports();
  }

  if (mode === 'crash-after-unlink') {
    const originalRename = fs.renameSync;
    const originalUnlink = fs.unlinkSync;
    fs.renameSync = function patchedRename(src, dest) {
      if (authorityNames.has(String(dest).split(/[\\/]/).at(-1))) {
        throw Object.assign(new Error(`injected EPERM: ${dest}`), { code: 'EPERM' });
      }
      return originalRename(src, dest);
    };
    fs.unlinkSync = function patchedUnlink(path) {
      const result = originalUnlink(path);
      if (authorityNames.has(String(path).split(/[\\/]/).at(-1))) process.kill(process.pid, 'SIGKILL');
      return result;
    };
    syncBuiltinESMExports();
  }

  const { SessionStore, provenance } = await loadCurrentSourceStore();
  const store = new SessionStore(projectRoot);

  if (mode === 'report-store-source') {
    emit(provenance);
  } else if (mode === 'update-counter' || mode === 'update-counter-stress') {
    let stress = null;
    if (mode === 'update-counter-stress') {
      const barrierDir = resolve(sessionId);
      const seed = Number(boundaryArg) >>> 0;
      const writer = Number(writerArg);
      fs.mkdirSync(barrierDir, { recursive: true });
      fs.writeFileSync(join(barrierDir, `ready-${writer}.json`), JSON.stringify({
        pid: process.pid,
        seed,
        writer,
        ready_at: Date.now(),
      }), { flag: 'wx' });
      const releasePath = join(barrierDir, 'release');
      const deadline = Date.now() + 15_000;
      while (!fs.existsSync(releasePath)) {
        if (Date.now() >= deadline) throw new Error(`stress barrier timeout: ${releasePath}`);
        waitSync(2);
      }
      const delayMs = deterministicDelay(seed, writer);
      waitSync(delayMs);
      stress = { seed, writer, delay_ms: delayMs, started_at: Date.now() };
    }
    const counterPath = join(projectRoot, '.workflow', 'durability-counter.json');
    store.updateJsonFile(counterPath, z.object({ value: z.number().int().nonnegative() }).strict(), { value: 0 }, draft => {
      draft.value += 1;
    });
    emit({ ok: true, ...stress, finished_at: Date.now() });
  } else if (mode === 'update-bundle' || mode === 'crash-after-rename' || mode === 'crash-after-unlink') {
    store.update(sessionId, draft => {
      draft.session.activity_revision += 1;
      draft.gates.revision += 1;
      draft.artifacts.revision += 1;
      draft.evidence.revision += 1;
    });
    emit({ ok: true });
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}
