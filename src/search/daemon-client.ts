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
const SPAWN_TOKEN_ENV = 'MAESTRO_SEARCH_DAEMON_SPAWN_TOKEN';

export interface DaemonQueryOptions {
  timeoutMs?: number;
  filters?: DaemonSearchRequest['filters'];
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
  return queryVerifiedDaemon(info, {
    action: 'search',
    query,
    limit,
    skipEmbedding,
    filters: opts?.filters,
  }, opts);
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
 * The opaque token makes both immediate spawn failure and child cleanup
 * owner-aware; one process cannot remove a successor's lock.
 */
function claimSpawnLock(workflowRoot: string): string | null {
  const lockPath = getDaemonSpawnLockPath(workflowRoot);
  const token = `${Date.now()}:${process.pid}:${randomUUID()}`;
  const take = (): boolean => {
    try {
      const fd = openSync(lockPath, 'wx');
      try { writeFileSync(fd, token); } finally { closeSync(fd); }
      return true;
    } catch { return false; }
  };
  if (take()) return token;
  try {
    const age = Date.now() - Number.parseInt(readFileSync(lockPath, 'utf-8').split(':', 1)[0], 10);
    if (age >= 0 && age < SPAWN_LOCK_TTL_MS) return null;
  } catch { /* unreadable — treat as stale */ }
  // Stale lock: only unlinking is racy, so immediately re-race with `wx`.
  try { unlinkSync(lockPath); } catch { /* another caller may have changed it */ }
  return take() ? token : null;
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
