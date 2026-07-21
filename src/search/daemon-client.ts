/**
 * Search daemon client — lightweight module for connecting to the resident
 * search daemon. No WikiIndexer or heavy dependencies.
 */

import { connect } from 'node:net';
import { join } from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

export type { DaemonInfo, DaemonSearchRequest, DaemonSearchResponse } from './daemon-types.js';
export { getDaemonPath, readDaemonInfo, isDaemonAlive } from './daemon-types.js';

import { getDaemonPath, readDaemonInfo, isDaemonAlive } from './daemon-types.js';
import type { DaemonSearchRequest, DaemonSearchResponse } from './daemon-types.js';

const DEFAULT_DAEMON_TIMEOUT_MS = 5000;

export interface DaemonQueryOptions {
  timeoutMs?: number;
}

export function queryDaemon(
  port: number,
  req: DaemonSearchRequest,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let buf = '';
    socket.setTimeout(opts?.timeoutMs ?? DEFAULT_DAEMON_TIMEOUT_MS);
    socket.on('connect', () => { socket.write(JSON.stringify(req) + '\n'); });
    socket.on('data', (chunk) => { buf += chunk.toString(); });
    socket.on('end', () => {
      try { resolve(JSON.parse(buf)); } catch { reject(new Error('bad response')); }
    });
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
  });
}

export async function tryDaemonSearch(
  workflowRoot: string,
  query: string,
  limit: number,
  skipEmbedding?: boolean,
  opts?: DaemonQueryOptions,
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonAlive(info)) return null;
  try {
    return await queryDaemon(info.port, { action: 'search', query, limit, skipEmbedding }, opts);
  } catch { return null; }
}

export function stopDaemon(workflowRoot: string): boolean {
  const info = readDaemonInfo(workflowRoot);
  if (!info) return false;
  try { unlinkSync(getDaemonPath(workflowRoot)); } catch {}
  if (isDaemonAlive(info)) {
    try { process.kill(info.pid, 'SIGTERM'); return true; } catch { return false; }
  }
  return false;
}

const SPAWN_LOCK_FILE = 'search-daemon-spawning';
const SPAWN_LOCK_TTL_MS = 60_000;

export async function spawnDaemon(workflowRoot: string): Promise<void> {
  const existing = readDaemonInfo(workflowRoot);
  if (existing && isDaemonAlive(existing)) return;

  const lockPath = join(workflowRoot, SPAWN_LOCK_FILE);
  if (existsSync(lockPath)) {
    try {
      const lockContent = readFileSync(lockPath, 'utf-8');
      const lockTime = parseInt(lockContent, 10);
      if (Date.now() - lockTime < SPAWN_LOCK_TTL_MS) return;
    } catch { /* stale lock, proceed */ }
  }

  if (existing) try { unlinkSync(getDaemonPath(workflowRoot)); } catch {}

  try {
    const { writeFileSync: writeSync } = await import('node:fs');
    writeSync(lockPath, String(Date.now()));
  } catch { /* best-effort */ }

  const { spawn: spawnProc } = await import('node:child_process');
  const { resolve: resolvePath, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const binPath = resolvePath(selfDir, '..', 'cli.js');
  const child = spawnProc(
    process.execPath,
    [binPath, 'search-start-daemon'],
    { cwd: resolvePath(workflowRoot, '..'), detached: true, stdio: 'ignore' },
  );
  child.unref();
}

/**
 * Invalidate the search index: signal daemon to rebuild if alive,
 * otherwise delete the search-cache.json so next search rebuilds.
 */
export async function invalidateSearchIndex(workflowRoot: string): Promise<void> {
  const info = readDaemonInfo(workflowRoot);
  if (info && isDaemonAlive(info)) {
    try {
      await queryDaemon(info.port, { action: 'invalidate' });
      return;
    } catch { /* daemon unresponsive, fall through */ }
  }
  try {
    for (const name of ['search-cache.json', 'wiki-index.json']) {
      const p = join(workflowRoot, name);
      if (existsSync(p)) unlinkSync(p);
    }
  } catch { /* best-effort */ }
}
