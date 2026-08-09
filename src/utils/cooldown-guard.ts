// src/utils/cooldown-guard.ts — Cross-process cooldown via tmpdir bridge files
//
// Shared abstraction for time-based throttling across subprocess invocations.
// Each guard writes a JSON bridge file in tmpdir; subsequent calls within the
// cooldown window are skipped.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface BridgeData {
  last_trigger: number;
  session_id: string;
  extra?: Record<string, unknown>;
}

export const COOLDOWN_MARKER_MAX_BYTES = 64 * 1024;

export interface CooldownGuardOptions {
  prefix: string;
  cooldownMs: number;
}

export class CooldownGuard {
  private readonly prefix: string;
  private readonly cooldownMs: number;

  constructor(opts: CooldownGuardOptions) {
    if (!/^[A-Za-z0-9._-]+$/.test(opts.prefix)) {
      throw new Error('CooldownGuard prefix must be a filename-safe token');
    }
    this.prefix = opts.prefix;
    this.cooldownMs = opts.cooldownMs;
  }

  shouldRun(sessionId: string): boolean {
    const now = Date.now();
    const bridge = this.read(sessionId, now);
    if (!bridge) return true;
    return (now - bridge.last_trigger) >= this.cooldownMs;
  }

  markDone(sessionId: string, extra?: Record<string, unknown>): void {
    const data: BridgeData = {
      last_trigger: Date.now(),
      session_id: sessionId,
      extra,
    };
    const path = this.path(sessionId);
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const serialized = JSON.stringify(data);
      if (Buffer.byteLength(serialized, 'utf8') > COOLDOWN_MARKER_MAX_BYTES) return;
      writeFileSync(tempPath, serialized, {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx',
      });
      try {
        renameSync(tempPath, path);
      } catch (error) {
        // Windows cannot atomically replace an existing destination. The final
        // path is hash-confined to tmpdir, so unlinking it cannot escape there.
        if (process.platform !== 'win32') throw error;
        try { unlinkSync(path); } catch { /* destination may not exist */ }
        renameSync(tempPath, path);
      }
    } catch {
      // Best-effort
    } finally {
      try { unlinkSync(tempPath); } catch { /* renamed or never created */ }
    }
  }

  timeSinceLastMs(sessionId: string): number | null {
    const now = Date.now();
    const bridge = this.read(sessionId, now);
    if (!bridge) return null;
    return now - bridge.last_trigger;
  }

  /** Failed or racing work must remain immediately retryable. */
  clear(sessionId: string): void {
    try {
      unlinkSync(this.path(sessionId));
    } catch {
      // Missing/unwritable bridge files are already equivalent to no cooldown.
    }
  }

  private read(sessionId: string, now: number): BridgeData | null {
    try {
      const value: unknown = JSON.parse(readBoundedRegularFile(this.path(sessionId)));
      if (!isRecord(value)) return null;
      const keys = Object.keys(value);
      if (keys.some(key => key !== 'last_trigger' && key !== 'session_id' && key !== 'extra')) {
        return null;
      }
      if (
        !Number.isSafeInteger(value.last_trigger)
        || (value.last_trigger as number) < 0
        || (value.last_trigger as number) > now
        || value.session_id !== sessionId
        || (value.extra !== undefined && !isRecord(value.extra))
      ) return null;
      return value as unknown as BridgeData;
    } catch {
      // Cooldown is advisory: unsafe, corrupt, or racing files fail open.
      return null;
    }
  }

  private path(sessionId: string): string {
    const key = createHash('sha256').update(sessionId).digest('hex');
    return join(tmpdir(), `${this.prefix}${key}.json`);
  }
}

/** Read a stable regular file generation without following a final symlink. */
function readBoundedRegularFile(path: string): string {
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size > COOLDOWN_MARKER_MAX_BYTES) {
    throw new Error('Unsafe cooldown marker');
  }

  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, safeReadFlags());
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new Error('Cooldown marker changed before open');
    }

    const buffer = Buffer.allocUnsafe(COOLDOWN_MARKER_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > COOLDOWN_MARKER_MAX_BYTES) throw new Error('Cooldown marker is too large');

    const afterRead = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (
      afterPath.isSymbolicLink()
      || !sameStableFile(opened, afterRead)
      || !sameStableFile(afterRead, afterPath)
    ) throw new Error('Cooldown marker changed while reading');
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function safeReadFlags(): number {
  return constants.O_RDONLY
    | (constants.O_NOFOLLOW ?? 0)
    | (constants.O_NONBLOCK ?? 0);
}

function sameFileIdentity(
  left: Stats,
  right: Stats,
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.isFile() === right.isFile();
}

function sameStableFile(
  left: Stats,
  right: Stats,
): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Pre-configured guards for common use cases
export const kgSyncGuard = new CooldownGuard({ prefix: 'maestro-kg-sync-', cooldownMs: 30_000 });
export const kgInitGuard = new CooldownGuard({ prefix: 'maestro-kg-init-', cooldownMs: 300_000 });
