/**
 * Search daemon — resident process that keeps WikiIndexer + ONNX model warm.
 *
 * Protocol: line-delimited JSON over TCP on localhost.
 * Lock: .workflow/search-daemon.json with PID + port.
 * Idle timeout: auto-shutdown after 30 min of inactivity.
 */

import { createServer, type Server } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, unlinkSync } from 'node:fs';
import { WikiIndexer, type WikiIndexerConfig } from '#maestro-dashboard/wiki/wiki-indexer.js';

export type { DaemonInfo, DaemonSearchRequest, DaemonSearchResponse } from './daemon-types.js';
export { getDaemonPath, readDaemonInfo, isDaemonAlive } from './daemon-types.js';

import { getDaemonPath, readDaemonInfo, isDaemonAlive } from './daemon-types.js';
import type { DaemonInfo, DaemonSearchRequest, DaemonSearchResponse } from './daemon-types.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SOCKET_TIMEOUT_MS = 10_000;
const MAX_BUF_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 32;

// ── Server ──────────────────────────────────────────────────────────────

export async function startDaemon(
  workflowRoot: string,
  config: WikiIndexerConfig,
): Promise<{ port: number; server: Server }> {
  const existing = readDaemonInfo(workflowRoot);
  if (existing && isDaemonAlive(existing)) {
    throw new Error(`Daemon already running (pid=${existing.pid}, port=${existing.port})`);
  }

  const indexer = new WikiIndexer(config);

  await indexer.rebuild();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = (server: Server) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { shutdown(server, workflowRoot); }, IDLE_TIMEOUT_MS);
  };

  let activeConnections = 0;

  const server = createServer((socket) => {
    if (activeConnections >= MAX_CONNECTIONS) {
      socket.end(JSON.stringify({ ok: false, error: 'too many connections' }) + '\n');
      return;
    }
    activeConnections++;
    socket.setTimeout(SOCKET_TIMEOUT_MS);

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.length > MAX_BUF_BYTES) {
        socket.end(JSON.stringify({ ok: false, error: 'request too large' }) + '\n');
        return;
      }
      const nlIdx = buf.indexOf('\n');
      if (nlIdx === -1) return;
      const line = buf.slice(0, nlIdx);
      buf = buf.slice(nlIdx + 1);
      handleRequest(line, indexer, socket).then(() => {
        resetIdle(server);
      });
    });
    socket.on('timeout', () => { socket.destroy(); });
    socket.on('error', () => { socket.destroy(); });
    socket.on('close', () => { activeConnections--; });
  });

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
