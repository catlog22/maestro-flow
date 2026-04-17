// ---------------------------------------------------------------------------
// Brainstorm visualizer server (runnable as a detached Node process).
//
// Spawned by `maestro brainstorm-visualize start`. Serves the HTML prototypes
// from BRAINSTORM_DIR. Selection is done out-of-band via AskUserQuestion in
// the parent conversation — this server only renders.
//
// Lifecycle:
//   * parent sends SIGTERM/SIGINT (via `maestro brainstorm-visualize stop`)
//   * BRAINSTORM_OWNER_PID is set and that process exits
//   * no HTTP activity for IDLE_TIMEOUT_MS
//
// Wire protocol (stable — the command wrapper depends on it):
//   stdout line: {"type":"server-started","port":N,"host":...,"url_host":...,
//                 "url":"...","screen_dir":"..."}
//   HTTP  GET  /              → index of all .html files in BRAINSTORM_DIR
//   HTTP  GET  /screen/<name> → single screen by filename
//   HTTP  GET  /healthz       → {"ok":true}
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { comparePage, emptyPage, indexPage, wrapScreen } from './frame.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const OWNER_CHECK_MS = 5_000;
const IDLE_CHECK_MS = 60_000;

function fail(msg: string): never {
  process.stderr.write(`[brainstorm-visualize] ${msg}\n`);
  process.exit(1);
}

const contentDir: string = process.env.BRAINSTORM_DIR ?? fail('BRAINSTORM_DIR env var is required');
if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });

const host = process.env.BRAINSTORM_HOST ?? '127.0.0.1';
const urlHost = process.env.BRAINSTORM_URL_HOST ?? (host === '127.0.0.1' || host === 'localhost' ? 'localhost' : host);
const desiredPort = process.env.BRAINSTORM_PORT ? Number.parseInt(process.env.BRAINSTORM_PORT, 10) : 0;
const ownerPidRaw = process.env.BRAINSTORM_OWNER_PID ? Number.parseInt(process.env.BRAINSTORM_OWNER_PID, 10) : 0;
const ownerPid = Number.isFinite(ownerPidRaw) && ownerPidRaw > 0 ? ownerPidRaw : 0;

let lastActivity = Date.now();

function listScreens(): string[] {
  try {
    return readdirSync(contentDir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => ({ f, mtime: statSync(join(contentDir, f)).mtimeMs }))
      .sort((a, b) => a.f.localeCompare(b.f))
      .map((e) => e.f);
  } catch {
    return [];
  }
}

function readScreen(name: string): string | null {
  const safe = normalize(name);
  if (safe.includes('..') || safe.includes('/') || safe.includes('\\')) return null;
  try {
    return readFileSync(join(contentDir, safe), 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function respond(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-brainstorm-visualizer': '1',
  });
  res.end(body);
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  lastActivity = Date.now();
  const url = req.url ?? '/';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
    return;
  }

  if (url === '/' || url === '/index.html') {
    const screens = listScreens();
    if (screens.length === 0) {
      respond(res, 200, 'text/html; charset=utf-8', emptyPage());
      return;
    }
    respond(res, 200, 'text/html; charset=utf-8', indexPage(screens));
    return;
  }

  if (url.startsWith('/screen/')) {
    const name = decodeURIComponent(url.slice('/screen/'.length));
    const body = readScreen(name);
    if (body === null) {
      respond(res, 404, 'text/plain; charset=utf-8', 'screen not found');
      return;
    }
    respond(res, 200, 'text/html; charset=utf-8', wrapScreen(name, body));
    return;
  }

  if (url.startsWith('/compare')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const files = params.get('files')?.split(',').map((f) => decodeURIComponent(f.trim())).filter(Boolean);
    if (!files || files.length === 0) {
      respond(res, 400, 'text/plain; charset=utf-8', 'missing ?files=a.html,b.html');
      return;
    }
    const screens: { name: string; body: string }[] = [];
    for (const f of files) {
      const body = readScreen(f);
      if (body !== null) screens.push({ name: f, body });
    }
    if (screens.length === 0) {
      respond(res, 404, 'text/plain; charset=utf-8', 'none of the requested screens found');
      return;
    }
    respond(res, 200, 'text/html; charset=utf-8', comparePage(screens));
    return;
  }

  if (url === '/healthz') {
    respond(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
    return;
  }

  respond(res, 404, 'text/plain; charset=utf-8', 'not found');
}

const httpServer = createServer(handleRequest);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function shutdown(reason: string): void {
  try { httpServer.close(); } catch { /* ignore */ }
  setTimeout(() => {
    process.stderr.write(`[brainstorm-visualize] shutdown: ${reason}\n`);
    process.exit(0);
  }, 500).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (ownerPid > 0) {
  const ownerTimer = setInterval(() => {
    try {
      process.kill(ownerPid, 0);
    } catch {
      clearInterval(ownerTimer);
      shutdown(`owner pid ${ownerPid} exited`);
    }
  }, OWNER_CHECK_MS);
  ownerTimer.unref();
}

const idleTimer = setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    clearInterval(idleTimer);
    shutdown('idle timeout');
  }
}, IDLE_CHECK_MS);
idleTimer.unref();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(desiredPort, host, () => {
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    fail('server address is unavailable after listen()');
  }
  const actualPort = address.port;
  const announcement = {
    type: 'server-started',
    port: actualPort,
    host,
    url_host: urlHost,
    url: `http://${urlHost}:${actualPort}`,
    screen_dir: contentDir,
  };
  process.stdout.write(JSON.stringify(announcement) + '\n');
});
