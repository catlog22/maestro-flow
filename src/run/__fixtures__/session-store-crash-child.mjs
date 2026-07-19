import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const [mode, projectRootArg, sessionId = 'durability-session', boundaryArg = '1', writerArg = '0'] = process.argv.slice(2);
const projectRoot = resolve(projectRootArg);
const distStoreUrl = new URL('../../../dist/src/run/store.js', import.meta.url);
const authorityNames = new Set(['session.json', 'gates.json', 'artifacts.json', 'evidence.json']);

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

if (mode === 'hold-lock') {
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

  const { SessionStore } = await import(distStoreUrl.href);
  const store = new SessionStore(projectRoot);

  if (mode === 'update-counter' || mode === 'update-counter-stress') {
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
