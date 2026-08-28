/**
 * Search daemon — resident process that keeps WikiIndexer + ONNX model warm.
 *
 * Protocol: one line-delimited JSON request per TCP connection on localhost.
 * Descriptor: .workflow/search-daemon.json (authenticated protocol v2 identity).
 * Idle timeout: gracefully drain after 30 min of completed-request inactivity.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { WikiIndexer, type WikiIndexerConfig } from '#maestro-dashboard/wiki/wiki-indexer.js';

export type {
  DaemonInfo,
  DaemonInfoV2,
  DaemonSearchRequest,
  DaemonSearchResponse,
  DaemonState,
} from './daemon-types.js';
export {
  getDaemonPath,
  isDaemonAlive,
  isDaemonInfoV2,
  readDaemonInfo,
} from './daemon-types.js';

import {
  DAEMON_MAX_REQUEST_BYTES,
  DAEMON_MAX_RESPONSE_BYTES,
  SEARCH_DAEMON_PROTOCOL,
  canonicalWorkflowRoot,
  deleteDaemonInfoIfOwned,
  deleteDaemonInfoIfStale,
  getDaemonPath,
  isDaemonAlive,
  isDaemonInfoV2,
  readDaemonInfo,
  releaseDaemonSpawnLock,
  validateDaemonRequest,
} from './daemon-types.js';
import type {
  DaemonInfoV2,
  DaemonSearchRequest,
  DaemonSearchResponse,
  DaemonState,
} from './daemon-types.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SOCKET_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 32;
const SPAWN_TOKEN_ENV = 'MAESTRO_SEARCH_DAEMON_SPAWN_TOKEN';

function startupDescriptorCheck(workflowRoot: string): void {
  const path = getDaemonPath(workflowRoot);
  if (!existsSync(path)) return;
  const existing = readDaemonInfo(workflowRoot);
  if (!existing) {
    throw new Error(`Unverified or malformed daemon descriptor exists at ${path}; refusing to replace it`);
  }
  if (isDaemonInfoV2(existing) && !isDaemonInfoV2(existing, workflowRoot)) {
    throw new Error(`Daemon descriptor belongs to a different workflow; refusing to replace it`);
  }
  if (isDaemonAlive(existing)) {
    if (!isDaemonInfoV2(existing, workflowRoot)) {
      throw new Error(`Unverified legacy daemon descriptor is live (pid=${existing.pid}); refusing to replace or kill it`);
    }
    throw new Error(`Daemon already running or starting (pid=${existing.pid}, port=${existing.port})`);
  }
  if (!deleteDaemonInfoIfStale(workflowRoot, existing)) {
    throw new Error(`Daemon descriptor changed during startup; refusing to replace it`);
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => { rejectListen(error); };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectListen(new Error('bad addr'));
        return;
      }
      resolveListen(address.port);
    });
  });
}

function isAuthenticatedRequest(request: DaemonSearchRequest, info: DaemonInfoV2): boolean {
  return request.protocol === SEARCH_DAEMON_PROTOCOL
    && request.instanceId === info.instanceId
    && request.workflowRoot === info.workflowRoot;
}

// ── Server ──────────────────────────────────────────────────────────────

export async function startDaemon(
  workflowRoot: string,
  config: WikiIndexerConfig,
): Promise<{ port: number; server: Server }> {
  startupDescriptorCheck(workflowRoot);

  const canonicalRoot = canonicalWorkflowRoot(workflowRoot);
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  const indexer = new WikiIndexer(config);
  const closeIndexer = async (): Promise<void> => {
    const close = (indexer as unknown as { close?: () => Promise<void> }).close;
    if (typeof close === 'function') await close.call(indexer);
  };
  const spawnToken = process.env[SPAWN_TOKEN_ENV];

  let info: DaemonInfoV2 | null = null;
  let state: DaemonState = 'starting';
  let activeConnections = 0;
  let activeRequests = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let startupSettled = false;
  let serverClosed = false;
  let backgroundSettled = false;
  let finalized = false;
  const backgroundTasks = new Set<Promise<void>>();
  let resolveStopped!: () => void;
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });

  const clearIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const trackBackground = (work: Promise<unknown>): void => {
    let tracked!: Promise<void>;
    tracked = work.then(
      () => undefined,
      error => {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[daemon] background work failed: ${error instanceof Error ? error.message : error}`);
        }
      },
    ).finally(() => { backgroundTasks.delete(tracked); });
    backgroundTasks.add(tracked);
  };

  let beginDrain: (reason: string) => void = () => {};
  const server = createServer((socket: Socket) => {
    if (!info) {
      socket.destroy();
      return;
    }
    if (activeConnections >= MAX_CONNECTIONS) {
      socket.end(JSON.stringify({
        ok: false,
        error: 'too many connections',
        protocol: SEARCH_DAEMON_PROTOCOL,
        instanceId: info.instanceId,
        workflowRoot: info.workflowRoot,
        pid: info.pid,
        state,
      } satisfies DaemonSearchResponse) + '\n');
      return;
    }

    activeConnections++;
    socket.setTimeout(SOCKET_TIMEOUT_MS);
    let buffer = Buffer.alloc(0);
    let handled = false;

    const identityResponse = (response: DaemonSearchResponse): DaemonSearchResponse => ({
      ...response,
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId: info!.instanceId,
      workflowRoot: info!.workflowRoot,
      pid: info!.pid,
      startedAt: info!.startedAt,
      state,
    });
    const sendResponse = (response: DaemonSearchResponse): void => {
      let serialized: string;
      try { serialized = JSON.stringify(response); }
      catch { serialized = JSON.stringify(identityResponse({ ok: false, error: 'response serialization failed' })); }
      if (Buffer.byteLength(serialized, 'utf-8') + 1 > DAEMON_MAX_RESPONSE_BYTES) {
        serialized = JSON.stringify(identityResponse({ ok: false, error: 'response too large' }));
      }
      socket.end(`${serialized}\n`);
    };

    const finishRequest = (): void => {
      activeRequests = Math.max(0, activeRequests - 1);
      if (state === 'ready' && activeRequests === 0) scheduleIdle();
    };

    const dispatch = async (request: DaemonSearchRequest): Promise<DaemonSearchResponse> => {
      const authenticated = isAuthenticatedRequest(request, info!);
      // Search/invalidate without identity remain accepted for older clients.
      // Lifecycle requests always require the v2 descriptor nonce.
      const legacyDataRequest = (request.action === 'search' || request.action === 'invalidate')
        && request.protocol === undefined
        && request.instanceId === undefined
        && request.workflowRoot === undefined;
      if (!authenticated && !legacyDataRequest) {
        return identityResponse({ ok: false, error: 'daemon identity mismatch' });
      }

      if (request.action === 'ping') {
        return identityResponse({ ok: true, activeRequests, activeConnections });
      }
      if (request.action === 'health') {
        return identityResponse({
          ok: state === 'starting' || state === 'ready' || state === 'draining',
          activeRequests,
          activeConnections,
        });
      }
      if (request.action === 'shutdown') {
        beginDrain('shutdown');
        return identityResponse({ ok: true, activeRequests, activeConnections });
      }
      if (state !== 'ready') {
        return identityResponse({ ok: false, error: `daemon is ${state}` });
      }
      if (request.action === 'search') {
        const { results, embeddingUsed, embeddingDocs } = await indexer.searchWithMeta(
          request.query!,
          request.limit!,
          { skipEmbedding: request.skipEmbedding, filters: request.filters },
        );
        return identityResponse({
          ok: true,
          results,
          embeddingUsed,
          embeddingDocs,
          filtersApplied: true,
        });
      }

      indexer.invalidate();
      trackBackground((async () => {
        await indexer.rebuild();
        if (state === 'ready') await indexer.getEmbeddingIndex();
      })());
      return identityResponse({ ok: true });
    };

    const processLine = async (line: string): Promise<void> => {
      clearIdle();
      activeRequests++;
      let response: DaemonSearchResponse;
      try {
        let raw: unknown;
        try { raw = JSON.parse(line); }
        catch { raw = null; }
        const validation = validateDaemonRequest(raw);
        response = validation.ok
          ? await dispatch(validation.request)
          : identityResponse({ ok: false, error: validation.error });
      } catch (error: unknown) {
        response = identityResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        finishRequest();
      }
      sendResponse(response);
    };

    socket.on('data', (chunk: Buffer) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > DAEMON_MAX_REQUEST_BYTES) {
        handled = true;
        sendResponse(identityResponse({ ok: false, error: 'request too large' }));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline === -1) return;
      handled = true;
      const trailing = buffer.subarray(newline + 1).toString('utf-8').trim();
      if (trailing.length > 0) {
        sendResponse(identityResponse({ ok: false, error: 'one request per connection' }));
        return;
      }
      socket.pause();
      void processLine(buffer.subarray(0, newline).toString('utf-8'));
    });
    socket.on('timeout', () => { socket.destroy(); });
    socket.on('error', () => { socket.destroy(); });
    socket.on('close', () => { activeConnections = Math.max(0, activeConnections - 1); });
  });

  const releaseSpawnLock = (): void => {
    releaseDaemonSpawnLock(workflowRoot, spawnToken);
  };
  const onSignal = (): void => { beginDrain('signal'); };
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    state = 'stopped';
    clearIdle();
    if (info) deleteDaemonInfoIfOwned(workflowRoot, info);
    releaseSpawnLock();
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    resolveStopped();
  };
  const maybeFinalize = (): void => {
    // Keep ownership until startup, accepted background work, and embedding
    // abort/join have all settled. A successor cannot race final cache writes.
    if (serverClosed && startupSettled && backgroundSettled) finalize();
  };
  const markServerClosed = (): void => {
    serverClosed = true;
    maybeFinalize();
  };
  beginDrain = (_reason: string): void => {
    if (state === 'draining' || state === 'stopped') return;
    state = 'draining';
    clearIdle();
    void (async () => {
      await closeIndexer();
      while (backgroundTasks.size > 0) {
        await Promise.allSettled([...backgroundTasks]);
      }
      backgroundSettled = true;
      maybeFinalize();
    })();
    try { server.close(markServerClosed); }
    catch { markServerClosed(); }
  };
  const scheduleIdle = (): void => {
    clearIdle();
    if (state !== 'ready' || activeRequests !== 0) return;
    idleTimer = setTimeout(() => { beginDrain('idle'); }, IDLE_TIMEOUT_MS);
  };

  let port: number;
  try {
    port = await listen(server);
    info = {
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId,
      workflowRoot: canonicalRoot,
      pid: process.pid,
      port,
      startedAt,
    };
    // Claim before the expensive rebuild. Competing starts either observe this
    // starting instance or lose the atomic create; neither can become orphaned.
    writeFileSync(getDaemonPath(workflowRoot), JSON.stringify(info), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    startupSettled = true;
    await closeIndexer().catch(() => undefined);
    backgroundSettled = true;
    try { server.close(markServerClosed); } catch { markServerClosed(); }
    await stopped;
    throw error;
  }

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  server.on('error', (error) => {
    if (process.env.MAESTRO_DEBUG === '1') {
      console.error(`[daemon] server error: ${error instanceof Error ? error.message : error}`);
    }
    beginDrain('server-error');
  });

  // The descriptor now linearizes later spawn attempts; the parent lock no
  // longer needs to remain held through the rebuild.
  releaseSpawnLock();

  try {
    await indexer.rebuild();
    startupSettled = true;
    if (state !== 'starting') {
      maybeFinalize();
      throw new Error('daemon startup was cancelled while draining');
    }
    state = 'ready';
    scheduleIdle();
    trackBackground(indexer.getEmbeddingIndex());
    return { port, server };
  } catch (error) {
    startupSettled = true;
    beginDrain('startup-failure');
    maybeFinalize();
    await stopped;
    throw error;
  }
}
