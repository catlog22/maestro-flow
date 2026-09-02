/**
 * Search daemon client — lightweight module for connecting to the resident
 * search daemon. No WikiIndexer or heavy dependencies.
 */

import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

export type {
  DaemonInfo,
  DaemonInfoV2,
  DaemonSearchRequest,
  DaemonSearchResponse,
  DaemonState,
} from './daemon-types.js';
export {
  canonicalWorkflowRoot,
  getDaemonPath,
  isDaemonAlive,
  isDaemonInfoV2,
  isDaemonReadyResponse,
  readDaemonInfo,
} from './daemon-types.js';

import {
  DAEMON_MAX_RESPONSE_BYTES,
  SEARCH_DAEMON_PROTOCOL,
  daemonIdentityRequest,
  deleteDaemonInfoIfOwned,
  deleteDaemonInfoIfStale,
  getDaemonPath,
  getDaemonSpawnLockPath,
  isDaemonAlive,
  isDaemonInfoV2,
  isResponseFromDaemon,
  readDaemonInfo,
  releaseDaemonSpawnLock,
} from './daemon-types.js';
import type {
  DaemonInfoV2,
  DaemonSearchRequest,
  DaemonSearchResponse,
} from './daemon-types.js';

const DEFAULT_DAEMON_TIMEOUT_MS = 5000;
const SPAWN_LOCK_TTL_MS = 60_000;
const SPAWN_RECLAIM_SUFFIX = '.reclaim';
const SPAWN_TOKEN_ENV = 'MAESTRO_SEARCH_DAEMON_SPAWN_TOKEN';

export interface DaemonQueryOptions {
  timeoutMs?: number;
  filters?: DaemonSearchRequest['filters'];
  /** Effective repository/link authority expected by this caller. */
  authorityKey?: string;
  /** Tests and memory-sensitive callers may lower, but never raise, the hard cap. */
  maxResponseBytes?: number;
}

function isDaemonResponse(value: unknown): value is DaemonSearchResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { ok?: unknown }).ok === 'boolean';
}

export function queryDaemon(
  port: number,
  req: DaemonSearchRequest,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let responseBytes = 0;
    let settled = false;
    const configuredCap = opts?.maxResponseBytes;
    const responseCap = Number.isSafeInteger(configuredCap) && configuredCap! > 0
      ? Math.min(configuredCap!, DAEMON_MAX_RESPONSE_BYTES)
      : DAEMON_MAX_RESPONSE_BYTES;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(opts?.timeoutMs ?? DEFAULT_DAEMON_TIMEOUT_MS);
    socket.on('connect', () => { socket.write(JSON.stringify(req) + '\n'); });
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      responseBytes += chunk.length;
      if (responseBytes > responseCap) {
        fail(new Error('response too large'));
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      if (settled) return;
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks, responseBytes).toString('utf-8').trim());
        if (!isDaemonResponse(parsed)) throw new Error('bad response');
        settled = true;
        socket.destroy();
        resolve(parsed);
      } catch {
        fail(new Error('bad response'));
      }
    });
    socket.on('error', (error) => { fail(error); });
    socket.on('timeout', () => { fail(new Error('timeout')); });
  });
}

function authenticatedRequest(
  info: DaemonInfoV2,
  request: DaemonSearchRequest,
): DaemonSearchRequest {
  return { ...request, ...daemonIdentityRequest(info) };
}

async function queryVerifiedDaemon(
  info: DaemonInfoV2,
  request: DaemonSearchRequest,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  try {
    const response = await queryDaemon(info.port, authenticatedRequest(info, request), opts);
    return isResponseFromDaemon(info, response) ? response : null;
  } catch { return null; }
}

export async function pingDaemon(
  workflowRoot: string,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonInfoV2(info, workflowRoot) || !isDaemonAlive(info)) return null;
  return queryVerifiedDaemon(info, { action: 'ping' }, opts);
}

export async function healthDaemon(
  workflowRoot: string,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonInfoV2(info, workflowRoot) || !isDaemonAlive(info)) return null;
  return queryVerifiedDaemon(info, { action: 'health' }, opts);
}

async function rejectStaleAuthority(
  workflowRoot: string,
  info: DaemonInfoV2,
  expectedAuthorityKey: string | undefined,
): Promise<DaemonSearchResponse | null> {
  if (!expectedAuthorityKey || info.authorityKey === expectedAuthorityKey) return null;
  // Drain only the exact authenticated instance. The caller safely falls back
  // to a live-authority local index and its normal spawn path starts a fresh
  // daemon once this descriptor is released.
  await stopDaemon(workflowRoot).catch(() => false);
  return {
    ok: false,
    error: 'daemon authority mismatch',
    protocol: info.protocol,
    instanceId: info.instanceId,
    workflowRoot: info.workflowRoot,
    pid: info.pid,
    startedAt: info.startedAt,
    state: 'draining',
    authorityKey: info.authorityKey,
  };
}

export async function tryDaemonSearch(
  workflowRoot: string,
  query: string,
  limit: number,
  skipEmbedding?: boolean,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  // Legacy descriptors are deliberately stale/unverified. Connecting by their
  // PID+port would reintroduce PID-reuse and cross-workflow confusion.
  if (!info || !isDaemonInfoV2(info, workflowRoot) || !isDaemonAlive(info)) return null;
  const mismatch = await rejectStaleAuthority(workflowRoot, info, opts?.authorityKey);
  if (mismatch) return mismatch;
  return queryVerifiedDaemon(info, {
    action: 'search',
    query,
    limit,
    skipEmbedding,
    filters: opts?.filters,
  }, opts);
}

/** Retrieve the daemon's warm full-text index for `maestro load`. */
export async function tryDaemonLoad(
  workflowRoot: string,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonInfoV2(info, workflowRoot) || !isDaemonAlive(info)) return null;
  const mismatch = await rejectStaleAuthority(workflowRoot, info, opts?.authorityKey);
  if (mismatch) return mismatch;
  return queryVerifiedDaemon(info, { action: 'load' }, opts);
}

/**
 * Ask the exact v2 instance in the descriptor to shut down. This function never
 * sends a process signal and never removes an unverified/legacy descriptor.
 */
export async function stopDaemon(workflowRoot: string): Promise<boolean> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonInfoV2(info, workflowRoot)) return false;
  if (!isDaemonAlive(info)) {
    deleteDaemonInfoIfOwned(workflowRoot, info);
    return false;
  }
  const response = await queryVerifiedDaemon(info, { action: 'shutdown' });
  return response?.ok === true
    && (response.state === 'draining' || response.state === 'stopped');
}

/**
 * Claim the right to spawn a daemon, or return null if someone else holds it.
 * A short-lived reclaim lock serializes stale-primary removal so a contender
 * can never unlink a fresh successor lock between its read and unlink.
 */
export function claimSpawnLock(workflowRoot: string): string | null {
  const lockPath = getDaemonSpawnLockPath(workflowRoot);
  const reclaimPath = `${lockPath}${SPAWN_RECLAIM_SUFFIX}`;
  const token = `${Date.now()}:${process.pid}:${randomUUID()}`;
  const take = (): boolean => {
    try {
      const fd = openSync(lockPath, 'wx');
      try { writeFileSync(fd, token); } finally { closeSync(fd); }
      return true;
    } catch { return false; }
  };
  const ageOf = (path: string): number | null => {
    try {
      const createdAt = Number.parseInt(readFileSync(path, 'utf-8').split(':', 1)[0], 10);
      const age = Date.now() - createdAt;
      return Number.isFinite(age) ? age : null;
    } catch { return null; }
  };
  const releaseOwned = (path: string, owner: string): void => {
    try {
      if (readFileSync(path, 'utf-8') === owner) unlinkSync(path);
    } catch { /* ownership changed or path already removed */ }
  };

  if (take()) return token;
  const primaryAge = ageOf(lockPath);
  if (primaryAge !== null && primaryAge >= 0 && primaryAge < SPAWN_LOCK_TTL_MS) return null;

  const reclaimToken = `${Date.now()}:${process.pid}:${randomUUID()}`;
  try {
    const fd = openSync(reclaimPath, 'wx');
    try { writeFileSync(fd, reclaimToken); } finally { closeSync(fd); }
  } catch {
    const reclaimAge = ageOf(reclaimPath);
    if (reclaimAge !== null && reclaimAge >= 0 && reclaimAge < SPAWN_LOCK_TTL_MS) return null;
    // A crashed reclaimer must not block startup forever. Fall back to the
    // descriptor's atomic `wx` arbitration without deleting either lock.
    return token;
  }

  try {
    const guardedAge = ageOf(lockPath);
    if (guardedAge !== null && guardedAge >= 0 && guardedAge < SPAWN_LOCK_TTL_MS) return null;
    try { unlinkSync(lockPath); } catch { return null; }
    return take() ? token : null;
  } finally {
    releaseOwned(reclaimPath, reclaimToken);
  }
}

/** Return true when an existing descriptor must not be replaced. */
function descriptorBlocksSpawn(workflowRoot: string): boolean {
  const path = getDaemonPath(workflowRoot);
  if (!existsSync(path)) return false;
  const existing = readDaemonInfo(workflowRoot);
  // Malformed, foreign-workflow, and live legacy descriptors are unverified.
  // Preserve them instead of guessing ownership.
  if (!existing) return true;
  if (isDaemonInfoV2(existing) && !isDaemonInfoV2(existing, workflowRoot)) return true;
  if (isDaemonAlive(existing)) return true;
  return !deleteDaemonInfoIfStale(workflowRoot, existing);
}

export async function spawnDaemon(workflowRoot: string): Promise<void> {
  if (descriptorBlocksSpawn(workflowRoot)) return;

  const token = claimSpawnLock(workflowRoot);
  if (!token) return;

  // Linearize with a descriptor that appeared between the first check and lock.
  if (descriptorBlocksSpawn(workflowRoot)) {
    releaseDaemonSpawnLock(workflowRoot, token);
    return;
  }

  const { spawn: spawnProc } = await import('node:child_process');
  const { resolve: resolvePath, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const binPath = resolvePath(selfDir, '..', 'cli.js');
  try {
    const child = spawnProc(
      process.execPath,
      [binPath, 'search-start-daemon'],
      {
        cwd: resolvePath(workflowRoot, '..'),
        detached: true,
        stdio: process.env.MAESTRO_DEBUG === '1' ? ['ignore', 'ignore', 'inherit'] : 'ignore',
        windowsHide: true,
        env: { ...process.env, [SPAWN_TOKEN_ENV]: token },
      },
    );
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    // If the child fails before it publishes a descriptor and releases the
    // token itself, clean up while this parent is still alive.
    child.once('exit', () => { releaseDaemonSpawnLock(workflowRoot, token); });
    child.unref();
  } catch (error) {
    releaseDaemonSpawnLock(workflowRoot, token);
    throw error;
  }
}

/**
 * Invalidate the search index: signal a verified daemon to rebuild if alive,
 * otherwise delete its persisted caches so the next search rebuilds. An
 * explicit `{ ok: false }` is a failed invalidate, not an acknowledgement.
 */
export async function invalidateSearchIndex(
  workflowRoot: string,
  opts?: DaemonQueryOptions,
): Promise<void> {
  const info = readDaemonInfo(workflowRoot);
  if (info && isDaemonInfoV2(info, workflowRoot) && isDaemonAlive(info)) {
    const response = await queryVerifiedDaemon(info, { action: 'invalidate' }, opts);
    if (response?.ok === true) return;
  }
  for (const name of ['search-cache.json', 'wiki-index.json']) {
    try {
      const cachePath = join(workflowRoot, name);
      if (existsSync(cachePath)) unlinkSync(cachePath);
    } catch { /* best-effort */ }
  }
}

export { SEARCH_DAEMON_PROTOCOL };
