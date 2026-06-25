/**
 * Search daemon — resident process that keeps WikiIndexer + ONNX model warm.
 *
 * Protocol: line-delimited JSON over TCP on localhost.
 * Lock: .workflow/search-daemon.json with PID + port.
 * Idle timeout: auto-shutdown after 30 min of inactivity.
 */

import { createServer, type Server, connect } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { WikiIndexer, type WikiIndexerConfig } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
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

// ── Client ──────────────────────────────────────────────────────────────

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

// ── Server ──────────────────────────────────────────────────────────────

export async function startDaemon(
  workflowRoot: string,
  config: WikiIndexerConfig,
): Promise<{ port: number; server: Server }> {
  // Check existing daemon
  const existing = readDaemonInfo(workflowRoot);
  if (existing && isDaemonAlive(existing)) {
    throw new Error(`Daemon already running (pid=${existing.pid}, port=${existing.port})`);
  }

  const indexer = new WikiIndexer(config);

  // Pre-warm: build wiki/BM25 index synchronously, then start TCP server immediately
  await indexer.rebuild();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = (server: Server) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { shutdown(server, workflowRoot); }, IDLE_TIMEOUT_MS);
  };

  const server = createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const nlIdx = buf.indexOf('\n');
      if (nlIdx === -1) return;
      const line = buf.slice(0, nlIdx);
      buf = buf.slice(nlIdx + 1);
      handleRequest(line, indexer, socket).then(() => {
        resetIdle(server);
      });
    });
  });

  // Warm embedding in background — don't block TCP server startup
  indexer.getEmbeddingIndex().catch(() => null);

  return new Promise((res, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('bad addr')); return; }
      const port = addr.port;
      const info: DaemonInfo = { pid: process.pid, port, startedAt: new Date().toISOString() };
      writeFileSync(getDaemonPath(workflowRoot), JSON.stringify(info));
      try { unlinkSync(join(workflowRoot, 'search-daemon-spawning')); } catch {}
      resetIdle(server);
      res({ port, server });
    });
    server.on('error', reject);
  });
}

async function handleRequest(
  line: string,
  indexer: WikiIndexer,
  socket: import('node:net').Socket,
): Promise<void> {
  let resp: DaemonSearchResponse;
  try {
    const req = JSON.parse(line) as DaemonSearchRequest;
    if (req.action === 'search') {
      const { results, embeddingUsed, embeddingDocs } = await indexer.searchWithMeta(
        req.query!, req.limit!, { skipEmbedding: req.skipEmbedding },
      );
      resp = { ok: true, results, embeddingUsed, embeddingDocs };
    } else if (req.action === 'invalidate') {
      indexer.invalidate();
      await indexer.rebuild();
      indexer.getEmbeddingIndex().catch(() => null);
      resp = { ok: true };
    } else {
      resp = { ok: false, error: `unknown action` };
    }
  } catch (e: unknown) {
    resp = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  socket.end(JSON.stringify(resp) + '\n');
}

function shutdown(server: Server, workflowRoot: string): void {
  try { unlinkSync(getDaemonPath(workflowRoot)); } catch {}
  server.close();
  process.exit(0);
}

// ── Stop ────────────────────────────────────────────────────────────────

export function stopDaemon(workflowRoot: string): boolean {
  const info = readDaemonInfo(workflowRoot);
  if (!info) return false;
  try { unlinkSync(getDaemonPath(workflowRoot)); } catch {}
  if (isDaemonAlive(info)) {
    try { process.kill(info.pid, 'SIGTERM'); return true; } catch { return false; }
  }
  return false;
}

// ── Spawn (detached, for hooks) ─────────────────────────────────────────

export async function spawnDaemon(workflowRoot: string): Promise<void> {
  const existing = readDaemonInfo(workflowRoot);
  if (existing && isDaemonAlive(existing)) return;

  // Clean stale PID file
  if (existing) try { unlinkSync(getDaemonPath(workflowRoot)); } catch {}

  const { spawn: spawnProc } = await import('node:child_process');
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const binPath = resolve(selfDir, '..', 'cli.js');
  const child = spawnProc(
    process.execPath,
    [binPath, 'search-start-daemon'],
    { cwd: resolve(workflowRoot, '..'), detached: true, stdio: 'ignore' },
  );
  child.unref();
}
