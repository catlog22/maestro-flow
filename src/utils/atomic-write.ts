/**
 * Lock-guarded atomic file update — Protected Data Store write primitive.
 *
 * Synchronous by design so callers with sync public APIs (spec-writer) can
 * use it without signature changes. Self-contained: mirrors the O_EXCL
 * lock-file protocol of `src/graph/kg/sync/file-lock.ts` (which is async and
 * lives in the kg layer — importing it here would invert the dependency
 * direction).
 *
 * Guarantees:
 * - Cross-process exclusion via `<file>.lock` (O_EXCL create, stale reclaim).
 * - Read-modify-write is atomic as a whole: the callback reads current
 *   content INSIDE the lock, so concurrent updates never lose entries.
 * - The write goes to `<file>.tmp` then renames over the target. Windows
 *   rename-over-existing can throw EPERM transiently (AV / indexer holding
 *   the target) — retried with a tiny backoff.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 60_000;
const RENAME_EPERM_RETRIES = 2;

/** Synchronous sleep without busy-waiting (no async allowed here). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLockSync(lockPath: string): void {
  const startedAt = Date.now();
  mkdirSync(dirname(lockPath), { recursive: true });
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf-8');
      } finally {
        closeSync(fd);
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // Reclaim locks left behind by crashed processes.
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Lost the race with another process — just retry.
    }
    if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
      throw new Error(`Timed out acquiring lock: ${lockPath}`);
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= RENAME_EPERM_RETRIES) {
        throw err;
      }
      sleepSync(20 * (attempt + 1));
    }
  }
}

/**
 * Read-modify-write `filePath` atomically under a cross-process lock.
 *
 * `update` receives the current content (`null` when the file does not
 * exist) and returns the full new content — or `null` to skip the write
 * (e.g. duplicate detected). Returns the callback's result.
 */
export function updateFileAtomic(
  filePath: string,
  update: (current: string | null) => string | null,
): string | null {
  const lockPath = `${filePath}.lock`;
  acquireLockSync(lockPath);
  try {
    const current = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
    const next = update(current);
    if (next === null || next === current) return next;
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, next, 'utf-8');
    renameWithRetry(tmpPath, filePath);
    return next;
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort release — stale reclaim covers the crash case.
    }
  }
}
