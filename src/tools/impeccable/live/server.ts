/**
 * Live variant mode server (self-contained, zero dependencies).
 *
 * Serves the browser script (/live.js), the detection overlay (/detect.js),
 * uses Server-Sent Events (SSE) for server->browser push, and HTTP POST for
 * browser->server events. Agent communicates via HTTP long-poll (/poll).
 *
 * Converted from live-server.mjs to TypeScript.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseDesignMd } from '../design-parser.js';
import { resolveContextDir } from '../load-context.js';
import { createLiveSessionStore } from './session-store.js';
import {
  getDesignSidecarPath,
  getLiveAnnotationsDir,
  readLiveServerInfo,
  removeLiveServerInfo,
  resolveDesignSidecarPath,
  writeLiveServerInfo,
} from '../paths.js';
import type { LiveServerInfo } from '../paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, 'static');

// PRODUCT.md / DESIGN.md live wherever load-context resolves. The generated
// DESIGN sidecar is project-local at .impeccable/design.json, with legacy
// DESIGN.json fallback for existing projects.
const CONTEXT_DIR = resolveContextDir(process.cwd());
const DEFAULT_POLL_TIMEOUT = 600_000;   // 10 min — agent re-polls on timeout anyway
const SSE_HEARTBEAT_INTERVAL = 30_000;  // keepalive ping every 30s

export interface ServerOpts {
  background?: boolean;
  port?: string;
}

// ---------------------------------------------------------------------------
// Port detection
// ---------------------------------------------------------------------------

async function findOpenPort(start = 8400): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = srv.address();
      const p = typeof port === 'object' && port !== null ? port.port : start;
      srv.close(() => resolve(p));
    });
    srv.on('error', () => resolve(findOpenPort(start + 1)));
  });
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface PendingEntry {
  event: Record<string, unknown>;
  leaseUntil: number;
}

interface PendingPoll {
  resolve: (event: Record<string, unknown>) => void;
  leaseMs: number;
}

interface ServerState {
  token: string | null;
  port: number | null;
  sseClients: Set<http.ServerResponse>;
  pendingEvents: PendingEntry[];
  pendingPolls: PendingPoll[];
  exitTimer: ReturnType<typeof setTimeout> | null;
  sessionDir: string | null;
  sessionStore: ReturnType<typeof createLiveSessionStore> | null;
  leaseTimer: ReturnType<typeof setTimeout> | null;
}

const state: ServerState = {
  token: null,
  port: null,
  sseClients: new Set(),
  pendingEvents: [],
  pendingPolls: [],
  exitTimer: null,
  sessionDir: null,
  sessionStore: null,
  leaseTimer: null,
};

// Cap per-annotation upload size. A full 1920x1080 PNG is typically <1 MB;
// cap at 10 MB to guard against runaway writes from a misbehaving client.
const MAX_ANNOTATION_BYTES = 10 * 1024 * 1024;

function enqueueEvent(event: Record<string, unknown>): void {
  if (!event || (event.id && state.pendingEvents.some((entry) => entry.event?.id === event.id && entry.event?.type === event.type))) return;
  state.pendingEvents.push({ event, leaseUntil: 0 });
  flushPendingPolls();
}

function restorePendingEventsFromStore(): void {
  if (!state.sessionStore) return;
  for (const snapshot of state.sessionStore.listActiveSessions()) {
    if (snapshot.pendingEvent) enqueueEvent(snapshot.pendingEvent as unknown as Record<string, unknown>);
  }
}

function findAvailablePendingEvent(now = Date.now()): PendingEntry | undefined {
  return state.pendingEvents.find((entry) => !entry.leaseUntil || entry.leaseUntil <= now);
}

function leaseEvent(entry: PendingEntry, leaseMs: number): Record<string, unknown> {
  if (!entry.event?.id) {
    const idx = state.pendingEvents.indexOf(entry);
    if (idx !== -1) state.pendingEvents.splice(idx, 1);
    return entry.event;
  }
  entry.leaseUntil = Date.now() + leaseMs;
  return entry.event;
}

function acknowledgePendingEvent(id: unknown): boolean {
  if (!id) return false;
  const idx = state.pendingEvents.findIndex((entry) => entry.event?.id === id);
  if (idx === -1) return false;
  state.pendingEvents.splice(idx, 1);
  scheduleLeaseFlush();
  return true;
}

function scheduleLeaseFlush(): void {
  if (state.leaseTimer) {
    clearTimeout(state.leaseTimer);
    state.leaseTimer = null;
  }
  if (state.pendingPolls.length === 0) return;
  const now = Date.now();
  const nextLeaseUntil = state.pendingEvents
    .map((entry) => entry.leaseUntil || 0)
    .filter((leaseUntil) => leaseUntil > now)
    .sort((a, b) => a - b)[0];
  if (!nextLeaseUntil) return;
  state.leaseTimer = setTimeout(() => {
    state.leaseTimer = null;
    flushPendingPolls();
  }, Math.max(0, nextLeaseUntil - now));
}

function flushPendingPolls(): void {
  while (state.pendingPolls.length > 0) {
    const entry = findAvailablePendingEvent();
    if (!entry) {
      scheduleLeaseFlush();
      return;
    }
    const poll = state.pendingPolls.shift()!;
    poll.resolve(leaseEvent(entry, poll.leaseMs));
  }
  scheduleLeaseFlush();
}

/** Push a message to all connected SSE clients. */
function broadcast(msg: Record<string, unknown>): void {
  const data = 'data: ' + JSON.stringify(msg) + '\n\n';
  for (const res of state.sseClients) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

// ---------------------------------------------------------------------------
// Load scripts
// ---------------------------------------------------------------------------

function loadBrowserScripts(): { detectScript: string; sessionPath: string; livePath: string } {
  // Detection script: look relative to the package, then fall back
  // to the npm package location.
  // This one IS cached — detect.js rarely changes during a session.
  const detectPaths = [
    path.join(__dirname, '..', '..', '..', '..', 'cli', 'engine', 'detect-antipatterns-browser.js'),
    path.join(process.cwd(), 'node_modules', 'impeccable', 'cli', 'engine', 'detect-antipatterns-browser.js'),
  ];
  let detectScript = '';
  for (const p of detectPaths) {
    try { detectScript = fs.readFileSync(p, 'utf-8'); break; } catch { /* try next */ }
  }

  // live-browser.js: DO NOT cache. Return the path so the /live.js handler
  // can re-read on every request. Editing the browser script during iteration
  // should land on the next tab reload, not require a server restart.
  const sessionPath = path.join(staticDir, 'live-browser-session.js');
  const livePath = path.join(staticDir, 'live-browser.js');
  for (const p of [sessionPath, livePath]) {
    if (!fs.existsSync(p)) {
      process.stderr.write('Error: live browser script not found at ' + p + '\n');
      process.exit(1);
    }
  }

  return { detectScript, sessionPath, livePath };
}

function hasProjectContext(): boolean {
  // PRODUCT.md carries brand voice / anti-references — that's what determines
  // whether variants are brand-aware. DESIGN.md (visual tokens) is a separate
  // concern, surfaced by the design panel's own empty state. Legacy
  // .impeccable.md is auto-migrated to PRODUCT.md by load-context.
  try {
    fs.accessSync(path.join(CONTEXT_DIR, 'PRODUCT.md'), fs.constants.R_OK);
    return true;
  } catch { return false; }
}

function statOrNull(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Validation (inline — no external import needed for self-contained server)
// ---------------------------------------------------------------------------

const VISUAL_ACTIONS = [
  'impeccable', 'bolder', 'quieter', 'distill', 'polish', 'typeset',
  'colorize', 'layout', 'adapt', 'animate', 'delight', 'overdrive',
];

// Browser generates ids via crypto.randomUUID().slice(0, 8) (8 hex chars)
// and variantIds via String(small integer). Restrict to those shapes so
// any value that reaches a downstream child_process or DOM selector is
// inert by construction.
const ID_PATTERN = /^[0-9a-f]{8}$/;
const VARIANT_ID_PATTERN = /^[0-9]{1,3}$/;

function isValidId(v: unknown): v is string { return typeof v === 'string' && ID_PATTERN.test(v); }
function isValidVariantId(v: unknown): v is string { return typeof v === 'string' && VARIANT_ID_PATTERN.test(v); }

function validateEvent(msg: Record<string, unknown>): string | null {
  if (!msg || typeof msg !== 'object' || !msg.type) return 'Missing or invalid message';
  switch (msg.type) {
    case 'generate':
      if (!isValidId(msg.id)) return 'generate: missing or malformed id';
      if (!msg.action || !VISUAL_ACTIONS.includes(msg.action as string)) return 'generate: invalid action';
      if (!Number.isInteger(msg.count) || (msg.count as number) < 1 || (msg.count as number) > 8) return 'generate: count must be 1-8';
      if (!msg.element || !(msg.element as Record<string, unknown>).outerHTML) return 'generate: missing element context';
      // Optional annotation fields (all-or-nothing: if any present, all must be well-formed).
      if (msg.screenshotPath !== undefined && typeof msg.screenshotPath !== 'string') return 'generate: screenshotPath must be string';
      if (msg.comments !== undefined && !Array.isArray(msg.comments)) return 'generate: comments must be array';
      if (msg.strokes !== undefined && !Array.isArray(msg.strokes)) return 'generate: strokes must be array';
      return null;
    case 'accept':
      if (!isValidId(msg.id)) return 'accept: missing or malformed id';
      if (!isValidVariantId(msg.variantId)) return 'accept: missing or malformed variantId';
      if (msg.paramValues !== undefined) {
        if (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues)) {
          return 'accept: paramValues must be an object';
        }
      }
      return null;
    case 'discard':
      return isValidId(msg.id) ? null : 'discard: missing or malformed id';
    case 'checkpoint':
      if (!isValidId(msg.id)) return 'checkpoint: missing or malformed id';
      if (!Number.isInteger(msg.revision) || (msg.revision as number) < 0) return 'checkpoint: revision must be a non-negative integer';
      if (msg.paramValues !== undefined && (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues))) {
        return 'checkpoint: paramValues must be an object';
      }
      return null;
    case 'exit':
      return null;
    case 'prefetch':
      if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return 'prefetch: missing pageUrl';
      return null;
    default:
      return 'Unknown event type: ' + msg.type;
  }
}

// ---------------------------------------------------------------------------
// HTTP request handler
// ---------------------------------------------------------------------------

function createRequestHandler(scriptInfo: { detectScript: string; sessionPath: string; livePath: string }): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { detectScript, sessionPath, livePath } = scriptInfo;
  return (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${state.port}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const p = url.pathname;

    // --- Scripts ---
    if (p === '/live.js') {
      // Re-read from disk each request so edits to live-browser.js land on
      // the next tab reload. No-store headers prevent browser caching across
      // sessions — during iteration, a cached old script silently breaks
      // every subsequent session.
      let sessionScript: string;
      let liveScript: string;
      try {
        sessionScript = fs.readFileSync(sessionPath, 'utf-8');
        liveScript = fs.readFileSync(livePath, 'utf-8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error reading live browser scripts: ' + (err as Error).message);
        return;
      }
      const body =
        `window.__IMPECCABLE_TOKEN__ = '${state.token}';\n` +
        `window.__IMPECCABLE_PORT__ = ${state.port};\n` +
        sessionScript + '\n' +
        liveScript;
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
      });
      res.end(body);
      return;
    }
    if (p === '/detect.js' || p === '/') {
      if (!detectScript) { res.writeHead(404); res.end('Not available'); return; }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(detectScript);
      return;
    }

    // --- Vendored modern-screenshot (UMD build) ---
    // Lazy-loaded by live.js when the user clicks Go; exposes
    // window.modernScreenshot.domToBlob(...) for capture.
    if (p === '/modern-screenshot.js') {
      const vendorPath = path.join(staticDir, 'modern-screenshot.umd.js');
      try {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(fs.readFileSync(vendorPath));
      } catch {
        res.writeHead(404); res.end('Vendor script not found');
      }
      return;
    }

    // --- Annotation upload (browser -> server, raw PNG body) ---
    if (p === '/annotation' && req.method === 'POST') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const eventId = url.searchParams.get('eventId');
      if (!eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid eventId' }));
        return;
      }
      if ((req.headers['content-type'] ?? '').toLowerCase() !== 'image/png') {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Content-Type must be image/png' }));
        return;
      }
      if (!state.sessionDir) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session dir unavailable' }));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;
      req.on('data', (c: Buffer) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX_ANNOTATION_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        const absPath = path.join(state.sessionDir!, eventId + '.png');
        try {
          fs.writeFileSync(absPath, Buffer.concat(chunks));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Write failed: ' + (err as Error).message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: absPath }));
      });
      req.on('error', () => {
        if (!aborted) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upload failed' }));
        }
      });
      return;
    }

    // --- Health ---
    if (p === '/status') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      const sessions = state.sessionStore ? state.sessionStore.listActiveSessions() : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        port: state.port,
        connectedClients: state.sseClients.size,
        pendingEvents: state.pendingEvents.map((entry) => ({
          id: entry.event?.id,
          type: entry.event?.type,
          leased: !!(entry.leaseUntil && entry.leaseUntil > Date.now()),
          leaseUntil: entry.leaseUntil || null,
        })),
        activeSessions: sessions,
      }));
      return;
    }

    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok', port: state.port, mode: 'variant',
        hasProjectContext: hasProjectContext(),
        connectedClients: state.sseClients.size,
      }));
      return;
    }

    // --- Design system (unified v2 response) + raw ---
    if (p === '/design-system.json' || p === '/design-system/raw') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }

      const mdPath = path.join(CONTEXT_DIR, 'DESIGN.md');
      const jsonPath = resolveDesignSidecarPath(process.cwd(), CONTEXT_DIR) || getDesignSidecarPath(process.cwd());
      const mdStat = statOrNull(mdPath);
      const jsonStat = statOrNull(jsonPath);

      if (p === '/design-system/raw') {
        if (!mdStat) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(fs.readFileSync(mdPath, 'utf-8'));
        return;
      }

      if (!mdStat && !jsonStat) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ present: false }));
        return;
      }

      const response: Record<string, unknown> = {
        present: true,
        hasMd: !!mdStat,
        hasSidecar: !!jsonStat,
        mdNewerThanJson: !!(mdStat && jsonStat && mdStat.mtimeMs > jsonStat.mtimeMs + 1000),
      };

      if (mdStat) {
        try {
          response.parsed = parseDesignMd(fs.readFileSync(mdPath, 'utf-8'));
        } catch (err) {
          response.parseError = (err as Error).message;
        }
      }

      if (jsonStat) {
        try {
          response.sidecar = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        } catch (err) {
          response.sidecarError = 'Failed to parse .impeccable/design.json: ' + (err as Error).message;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    // --- Source file (no-HMR fallback) ---
    if (p === '/source') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      const filePath = url.searchParams.get('path');
      if (!filePath || filePath.includes('..')) { res.writeHead(400); res.end('Bad path'); return; }
      const absPath = path.resolve(process.cwd(), filePath);
      if (!absPath.startsWith(process.cwd())) { res.writeHead(403); res.end('Forbidden'); return; }
      let content: string;
      try { content = fs.readFileSync(absPath, 'utf-8'); }
      catch { res.writeHead(404); res.end('File not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    // --- SSE: server->browser push ---
    if (p === '/events' && req.method === 'GET') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: ' + JSON.stringify({
        type: 'connected',
        hasProjectContext: hasProjectContext(),
      }) + '\n\n');

      state.sseClients.add(res);
      if (state.exitTimer) clearTimeout(state.exitTimer);

      // Keepalive: SSE comment every 30s prevents silent connection drops.
      const heartbeat = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); }
      }, SSE_HEARTBEAT_INTERVAL);

      req.on('close', () => {
        clearInterval(heartbeat);
        state.sseClients.delete(res);
        if (state.sseClients.size === 0) {
          if (state.exitTimer) clearTimeout(state.exitTimer);
          state.exitTimer = setTimeout(() => {
            if (state.sseClients.size === 0) enqueueEvent({ type: 'exit' });
          }, 8000);
        }
      });
      return;
    }

    // --- Browser->server events ---
    if (p === '/events' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => { body += c; });
      req.on('end', () => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        if (msg.token !== state.token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        const error = validateEvent(msg);
        if (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error }));
          return;
        }
        if (state.sessionStore && msg.id) {
          try {
            state.sessionStore.appendEvent(msg as unknown as import('./session-store.js').LiveEvent);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'session_store_append_failed', message: (err as Error).message }));
            return;
          }
        }
        if (msg.type !== 'checkpoint') enqueueEvent(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // --- Stop ---
    if (p === '/stop') {
      const token = url.searchParams.get('token');
      if (token !== state.token) { res.writeHead(401); res.end('Unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('stopping');
      shutdown();
      return;
    }

    // --- Agent poll ---
    if (p === '/poll' && req.method === 'GET') {
      handlePollGet(req, res, url);
      return;
    }
    if (p === '/poll' && req.method === 'POST') {
      handlePollPost(req, res);
      return;
    }

    res.writeHead(404); res.end('Not found');
  };
}

// ---------------------------------------------------------------------------
// Agent poll endpoints
// ---------------------------------------------------------------------------

function handlePollGet(_req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const token = url.searchParams.get('token');
  if (token !== state.token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  const timeout = parseInt(url.searchParams.get('timeout') ?? String(DEFAULT_POLL_TIMEOUT), 10);
  const leaseMs = parseInt(url.searchParams.get('leaseMs') ?? '30000', 10);
  const available = findAvailablePendingEvent();
  if (available) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(leaseEvent(available, leaseMs)));
    return;
  }
  const poll: PendingPoll = { resolve: doResolve, leaseMs };
  const timer = setTimeout(() => {
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'timeout' }));
  }, timeout);
  function doResolve(event: Record<string, unknown>): void {
    clearTimeout(timer);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(event));
  }
  poll.resolve = doResolve;
  state.pendingPolls.push(poll);
  scheduleLeaseFlush();
  _req.on('close', () => {
    clearTimeout(timer);
    const idx = state.pendingPolls.indexOf(poll);
    if (idx !== -1) state.pendingPolls.splice(idx, 1);
  });
}

function handlePollPost(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', (c: Buffer) => { body += c; });
  req.on('end', () => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    if (msg.token !== state.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    acknowledgePendingEvent(msg.id);
    if (state.sessionStore && msg.id) {
      try {
        const eventType = msg.type === 'discard' || msg.type === 'discarded'
          ? 'discarded'
          : msg.type === 'complete'
            ? 'complete'
            : msg.type === 'error'
              ? 'agent_error'
              : 'agent_done';
        state.sessionStore.appendEvent({
          type: eventType,
          id: String(msg.id ?? ''),
          file: typeof msg.file === 'string' ? msg.file : undefined,
          message: typeof msg.message === 'string' ? msg.message : undefined,
          carbonize: (msg.data as Record<string, unknown> | undefined)?.carbonize === true,
        });
      } catch { /* keep reply path best-effort; browser still needs SSE */ }
    }
    flushPendingPolls();
    // Forward the reply to the browser via SSE
    broadcast({ type: (msg.type as string) || 'done', id: msg.id, message: msg.message, file: msg.file, data: msg.data });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let httpServer: http.Server | null = null;

function shutdown(): void {
  removeLiveServerInfo(process.cwd());
  if (state.leaseTimer) clearTimeout(state.leaseTimer);
  state.leaseTimer = null;
  if (state.sessionDir) {
    try { fs.rmSync(state.sessionDir, { recursive: true, force: true }); } catch {}
  }
  for (const res of state.sseClients) { try { res.end(); } catch {} }
  state.sseClients.clear();
  for (const poll of state.pendingPolls) poll.resolve({ type: 'exit' });
  state.pendingPolls.length = 0;
  if (httpServer) httpServer.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main CLI entry
// ---------------------------------------------------------------------------

export async function serverCli(action?: string, opts?: ServerOpts): Promise<void> {
  const args: string[] = [];
  if (action) args.push(action);
  if (opts?.background) args.push('--background');
  if (opts?.port) args.push(`--port=${opts.port}`);

  if (args.includes('stop')) {
    const keepInject = args.includes('--keep-inject');
    try {
      const record = readLiveServerInfo(process.cwd());
      const info = record?.info as LiveServerInfo | undefined;
      if (info) {
        const res = await fetch(`http://localhost:${info.port}/stop?token=${info.token}`);
        if (res.ok) console.log(`Stopped live server on port ${info.port}.`);
      }
    } catch {
      console.log('No running live server found.');
    }
    if (!keepInject) {
      try {
        const { injectCli } = await import('./inject.js');
        // Capture injectCli output by replacing console.log temporarily
        let captured = '';
        const origLog = console.log;
        console.log = (...a: unknown[]) => { captured = a.map(String).join(' '); };
        await injectCli({ remove: true });
        console.log = origLog;

        const line = captured.trim().split('\n').filter(Boolean).pop();
        if (line) {
          try {
            const j = JSON.parse(line) as Record<string, unknown>;
            if (j.removed === true) {
              console.log(`Removed live script tag from ${j.file}.`);
            }
          } catch {
            /* ignore non-JSON lines */
          }
        }
      } catch (err) {
        const error = err as Error & { stderr?: { toString(): string }; stdout?: { toString(): string } };
        const detail = error.stderr?.toString?.().trim?.()
          || error.stdout?.toString?.().trim?.()
          || error.message
          || String(err);
        console.warn(`Note: could not remove live script tag (${detail.split('\n')[0]})`);
      }
    }
    process.exit(0);
  }

  // --background: spawn a detached child server, wait for it to be ready,
  // print the connection JSON, then exit.
  if (args.includes('--background')) {
    const childArgs = args.filter(a => a !== '--background');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });
    child.unref();

    // Poll for the PID file (the child writes it once the HTTP server is listening).
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const record = readLiveServerInfo(process.cwd());
        const info = record?.info;
        if (info && info.pid !== process.pid) {
          // Output JSON so the agent can read port + token from stdout.
          console.log(JSON.stringify(info));
          process.exit(0);
        }
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 200));
    }
    console.error('Timed out waiting for live server to start.');
    process.exit(1);
  }

  // Check for existing session
  const existingRecord = readLiveServerInfo(process.cwd());
  if (existingRecord?.info) {
    const existing = existingRecord.info;
    try {
      process.kill(existing.pid, 0);
      console.error(`Live server already running on port ${existing.port} (pid ${existing.pid}).`);
      console.error('Stop it first with: maestro impeccable live-server stop');
      process.exit(1);
    } catch {
      try { fs.unlinkSync(existingRecord.path); } catch {}
    }
  }

  state.token = randomUUID();
  state.sessionStore = createLiveSessionStore({ cwd: process.cwd() });
  restorePendingEventsFromStore();
  const portArg = args.find(a => a.startsWith('--port='));
  state.port = portArg ? parseInt(portArg.split('=')[1], 10) : await findOpenPort();
  // Annotation screenshots live in the project root so the agent's Read tool
  // doesn't trip a per-file permission prompt. Sessioned by token so concurrent
  // projects (or quick restarts) don't collide.
  const annotRoot = getLiveAnnotationsDir(process.cwd());
  fs.mkdirSync(annotRoot, { recursive: true });
  state.sessionDir = fs.mkdtempSync(path.join(annotRoot, 'session-'));

  const scriptInfo = loadBrowserScripts();
  httpServer = http.createServer(createRequestHandler(scriptInfo));

  httpServer.listen(state.port, '127.0.0.1', () => {
    writeLiveServerInfo(process.cwd(), { pid: process.pid, port: state.port!, token: state.token! });
    const url = `http://localhost:${state.port}`;
    console.log(`\nImpeccable live server running on ${url}`);
    console.log(`Token: ${state.token}\n`);
    console.log(`Inject: <script src="${url}/live.js"><\/script>`);
    console.log(`Stop:   maestro impeccable live-server stop`);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
