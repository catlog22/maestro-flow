/**
 * Search daemon client — lightweight module for connecting to the resident
 * search daemon. No WikiIndexer or heavy dependencies.
 */

import { connect } from 'node:net';
import { join } from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';

const DAEMON_FILE = 'search-daemon.json';

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export function getDaemonPath(workflowRoot: string): string {
  return join(workflowRoot, DAEMON_FILE);
}

export function readDaemonInfo(workflowRoot: string): DaemonInfo | null {
  const p = getDaemonPath(workflowRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch { return null; }
}

export function isDaemonAlive(info: DaemonInfo): boolean {
  try { process.kill(info.pid, 0); return true; } catch { return false; }
}

export interface DaemonSearchRequest {
  action: 'search' | 'invalidate';
  query?: string;
  limit?: number;
  skipEmbedding?: boolean;
}

export interface DaemonSearchResponse {
  ok: boolean;
  results?: Array<{ entry: WikiEntry; score: number }>;
  embeddingUsed?: boolean;
  embeddingDocs?: number;
  error?: string;
}

export function queryDaemon(port: number, req: DaemonSearchRequest): Promise<DaemonSearchResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let buf = '';
    socket.setTimeout(5000);
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
): Promise<DaemonSearchResponse | null> {
  const info = readDaemonInfo(workflowRoot);
  if (!info || !isDaemonAlive(info)) return null;
  try {
    return await queryDaemon(info.port, { action: 'search', query, limit, skipEmbedding });
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
const SPAWN_LOCK_TTL_MS = 30_000;

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
    const cachePath = join(workflowRoot, 'search-cache.json');
    if (existsSync(cachePath)) unlinkSync(cachePath);
  } catch { /* best-effort */ }
}
