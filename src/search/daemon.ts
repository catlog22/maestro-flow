/**
 * Search daemon — resident process that keeps WikiIndexer + ONNX model warm.
 *
 * Protocol: one line-delimited JSON request per TCP connection on localhost.
 * Descriptor: .workflow/search-daemon.json (authenticated protocol v2 identity).
 * Idle timeout: gracefully drain after a configurable period of work inactivity.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { WikiIndexer, type WikiIndexerConfig } from '#maestro-dashboard/wiki/wiki-indexer.js';
import {
  acquireWikiPublisherLease,
  releaseWikiPublisherLease,
} from './publisher-lease.js';

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
  boundedSearchDiagnostics,
  createSearchDiagnostics,
  finishSearchDiagnostics,
} from './diagnostics.js';
import {
  DAEMON_MAX_REQUEST_BYTES,
  DAEMON_MAX_RESPONSE_BYTES,
  SEARCH_DAEMON_PROTOCOL,
  canonicalWorkflowRoot,
  deleteDaemonInfoIfOwned,
  deleteDaemonInfoIfStale,
  deleteDaemonSpawnLocksIfOwned,
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

const DEFAULT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SOCKET_TIMEOUT_MS = 10_000;
const DRAIN_TIMEOUT_MS = 15_000;
const MAX_CONNECTIONS = 32;
const MAX_ACTIVE_REQUESTS = 8;
const SPAWN_TOKEN_ENV = 'MAESTRO_SEARCH_DAEMON_SPAWN_TOKEN';

export interface SearchDaemonRuntimeOptions {
  socketTimeoutMs?: number;
  drainTimeoutMs?: number;
  maxConnections?: number;
  maxActiveRequests?: number;
  /** 0 disables idle shutdown; otherwise the daemon drains after this work-idle period. */
  idleTimeoutMs?: number;
  /** Dedicated daemon commands may hard-exit after cleanup exceeds its deadline. */
  exitOnDrainTimeout?: boolean;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function configuredIdleTimeoutMs(override: number | undefined): number {
  if (Number.isSafeInteger(override) && override! >= 0) return override!;
  const configured = Number.parseInt(process.env.MAESTRO_SEARCH_DAEMON_IDLE_MS ?? '', 10);
  return Number.isSafeInteger(configured) && configured >= 0
    ? configured
    : DEFAULT_IDLE_TIMEOUT_MS;
}

function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

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
  runtime?: SearchDaemonRuntimeOptions,
): Promise<{ port: number; server: Server }> {
  startupDescriptorCheck(workflowRoot);

  const canonicalRoot = canonicalWorkflowRoot(workflowRoot);
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  const authorityKey = JSON.stringify({
    linkedWorkspaces: config.linkedWorkspaces ?? [],
    repository: config.repository ?? null,
  });
  // The resident daemon is the preferred and durable publisher. A Dashboard
  // fallback may take only a one-shot lease when this owner is absent.
  const publisherLease = acquireWikiPublisherLease(workflowRoot);
  if (!publisherLease) {
    throw new Error('wiki publisher lease unavailable');
  }
  const indexerConfig: WikiIndexerConfig = {
    ...config,
    role: 'publisher',
    persistence: 'filesystem',
  };
  let indexer: WikiIndexer;
  try {
    indexer = new WikiIndexer(indexerConfig);
  } catch (error) {
    releaseWikiPublisherLease(publisherLease);
    throw error;
  }
  let publisherLeaseReleased = false;
  const releasePublisherLease = (): void => {
    if (publisherLeaseReleased) return;
    publisherLeaseReleased = true;
    releaseWikiPublisherLease(publisherLease);
  };
  const closeIndexer = async (): Promise<void> => {
    const close = (indexer as unknown as {
      close?: (options?: { disposeEmbeddingPipeline?: boolean }) => Promise<void>;
    }).close;
    try {
      if (typeof close === 'function') {
        await close.call(indexer, { disposeEmbeddingPipeline: true });
      }
    } finally {
      releasePublisherLease();
    }
  };
  const spawnToken = process.env[SPAWN_TOKEN_ENV];
  const socketTimeoutMs = positiveInteger(runtime?.socketTimeoutMs, SOCKET_TIMEOUT_MS);
  const drainTimeoutMs = positiveInteger(runtime?.drainTimeoutMs, DRAIN_TIMEOUT_MS);
  const maxConnections = positiveInteger(runtime?.maxConnections, MAX_CONNECTIONS);
  const maxActiveRequests = positiveInteger(runtime?.maxActiveRequests, MAX_ACTIVE_REQUESTS);
  const idleTimeoutMs = configuredIdleTimeoutMs(runtime?.idleTimeoutMs);

  let info: DaemonInfoV2 | null = null;
  let state: DaemonState = 'starting';
  let activeConnections = 0;
  let activeRequests = 0;
  let activeWorkRequests = 0;
  let idleRefreshPending = false;
  let idleDeadlineMs: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let startupSettled = false;
  let serverClosed = false;
  let backgroundSettled = false;
  let finalized = false;
  let invalidationTask: Promise<void> | null = null;
  const backgroundTasks = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const requestControllers = new Set<AbortController>();
  const requestIdleWaiters = new Set<() => void>();
  let resolveStopped!: () => void;
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });

  const clearIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    idleDeadlineMs = null;
  };

  const waitForRequestsIdle = (): Promise<void> => {
    if (activeRequests === 0) return Promise.resolve();
    return new Promise<void>(resolve => { requestIdleWaiters.add(resolve); });
  };

  const resolveRequestIdle = (): void => {
    if (activeRequests !== 0) return;
    for (const resolve of requestIdleWaiters) resolve();
    requestIdleWaiters.clear();
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
    const requestAbort = new AbortController();
    let buffer = Buffer.alloc(0);
    let handled = false;
    let requestStarted = false;
    const abortRequest = (message: string): void => {
      if (!requestAbort.signal.aborted) requestAbort.abort(new Error(message));
    };

    activeConnections++;
    sockets.add(socket);
    socket.setTimeout(socketTimeoutMs);
    socket.on('timeout', () => {
      abortRequest('search daemon socket timed out');
      socket.destroy();
    });
    socket.on('error', () => {
      abortRequest('search daemon socket failed');
      socket.destroy();
    });
    socket.on('close', () => {
      sockets.delete(socket);
      activeConnections = Math.max(0, activeConnections - 1);
      if (requestStarted) abortRequest('search daemon client disconnected');
    });

    if (!info) {
      socket.destroy();
      return;
    }
    if (activeConnections > maxConnections) {
      const rejection = JSON.stringify({
        ok: false,
        error: 'too many connections',
        protocol: SEARCH_DAEMON_PROTOCOL,
        instanceId: info.instanceId,
        workflowRoot: info.workflowRoot,
        pid: info.pid,
        state,
      } satisfies DaemonSearchResponse) + '\n';
      socket.end(rejection, () => { socket.destroy(); });
      return;
    }

    const identityResponse = (response: DaemonSearchResponse): DaemonSearchResponse => ({
      ...response,
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId: info!.instanceId,
      workflowRoot: info!.workflowRoot,
      pid: info!.pid,
      startedAt: info!.startedAt,
      state,
      idleTimeoutMs,
      idleDeadline: idleDeadlineMs === null ? null : new Date(idleDeadlineMs).toISOString(),
      authorityKey,
    });
    const sendResponse = (response: DaemonSearchResponse): void => {
      if (socket.destroyed) return;
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
      resolveRequestIdle();
      if (state === 'ready' && activeRequests === 0 && idleRefreshPending) {
        idleRefreshPending = false;
        scheduleIdle();
      }
    };

    const dispatch = async (
      request: DaemonSearchRequest,
      signal: AbortSignal,
    ): Promise<DaemonSearchResponse> => {
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
          idleTimeoutMs,
          idleDeadline: idleDeadlineMs === null ? null : new Date(idleDeadlineMs).toISOString(),
        });
      }
      if (request.action === 'shutdown') {
        beginDrain('shutdown');
        return identityResponse({ ok: true, activeRequests, activeConnections });
      }
      if (state !== 'ready') {
        return identityResponse({ ok: false, error: `daemon is ${state}` });
      }
      if (request.action === 'load') {
        const loadWork = indexer.get();
        let index: Awaited<ReturnType<typeof indexer.get>>;
        try {
          index = await awaitAbortable(loadWork, signal);
        } catch (error) {
          // A disconnected load client must release its active-request slot.
          // The shared rebuild continues as tracked work so drain either joins
          // it or applies the dedicated daemon's hard cleanup deadline.
          if (signal.aborted) trackBackground(loadWork);
          throw error;
        }
        return identityResponse({
          ok: true,
          entries: index.entries,
          generatedAt: index.generatedAt,
        });
      }
      if (request.action === 'search') {
        // Diagnostics are opt-in and request-local. A fresh recorder per
        // connection prevents concurrent daemon requests from sharing timing,
        // fallback, or result metadata.
        const diagnosticsRequested = request.diagnostics === true
          || (typeof request.diagnostics === 'object' && request.diagnostics !== null);
        const diagnostics = diagnosticsRequested
          ? createSearchDiagnostics({
            requestId: typeof request.diagnostics === 'object'
              ? request.diagnostics.requestId
              : undefined,
          })
          : undefined;
        // Keep root compilation compatible with the last built dashboard
        // declaration while dashboard compilation publishes the new signal field.
        const searchOptions = {
          skipEmbedding: request.skipEmbedding,
          filters: request.filters,
          signal,
          ...(request.candidateBudget ? { candidateBudget: request.candidateBudget } : {}),
          ...(diagnostics ? { diagnostics } : {}),
        };
        const { results, embeddingUsed, embeddingDocs } = await indexer.searchWithMeta(
          request.query!,
          request.limit!,
          searchOptions,
        );
        diagnostics?.setProvider('daemon');
        diagnostics?.setEmbedding(embeddingUsed, embeddingDocs);
        diagnostics?.setResultCount(results.length);
        return identityResponse({
          ok: true,
          results,
          embeddingUsed,
          embeddingDocs,
          filtersApplied: true,
          ...(diagnostics
            ? { diagnostics: boundedSearchDiagnostics(finishSearchDiagnostics(diagnostics)) ?? undefined }
            : {}),
        });
      }

      indexer.invalidate();
      if (!invalidationTask) {
        let work!: Promise<void>;
        work = (async () => {
          await indexer.rebuild();
          if (state === 'ready') await indexer.getEmbeddingIndex();
        })().finally(() => {
          if (invalidationTask === work) invalidationTask = null;
        });
        invalidationTask = work;
        trackBackground(work);
      }
      return identityResponse({ ok: true });
    };

    const processLine = async (line: string): Promise<void> => {
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch { raw = null; }
      const validation = validateDaemonRequest(raw);
      if (!validation.ok) {
        sendResponse(identityResponse({ ok: false, error: validation.error }));
        return;
      }

      const workRequest = validation.request.action === 'search'
        || validation.request.action === 'load'
        || validation.request.action === 'invalidate';
      if (workRequest && activeWorkRequests >= maxActiveRequests) {
        sendResponse(identityResponse({ ok: false, error: 'too many active requests' }));
        return;
      }

      if (workRequest) {
        clearIdle();
        idleRefreshPending = true;
      }
      requestStarted = true;
      requestControllers.add(requestAbort);
      activeRequests++;
      if (workRequest) activeWorkRequests++;
      let response: DaemonSearchResponse;
      try {
        response = await dispatch(validation.request, requestAbort.signal);
      } catch (error: unknown) {
        response = identityResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        requestControllers.delete(requestAbort);
        if (workRequest) activeWorkRequests = Math.max(0, activeWorkRequests - 1);
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
  });

  const releaseSpawnLock = (): void => {
    releaseDaemonSpawnLock(workflowRoot, spawnToken);
    if (info) deleteDaemonSpawnLocksIfOwned(workflowRoot, info);
  };
  const onSignal = (): void => { beginDrain('signal'); };
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    state = 'stopped';
    clearIdle();
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = null;
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
    if (serverClosed) return;
    serverClosed = true;
    maybeFinalize();
  };
  const forceDrain = (): void => {
    for (const controller of requestControllers) {
      if (!controller.signal.aborted) controller.abort(new Error('search daemon drain timed out'));
    }
    for (const socket of sockets) socket.destroy();
    markServerClosed();
    if (runtime?.exitOnDrainTimeout) {
      // Dedicated daemon processes terminate all native/index/cache work after
      // synchronously releasing their descriptor. Embedded callers retain
      // ownership until their cleanup really settles, preventing overlap.
      finalize();
      process.exit(0);
    }
  };
  beginDrain = (_reason: string): void => {
    if (state === 'draining' || state === 'stopped') return;
    state = 'draining';
    clearIdle();
    // Keep the deadline referenced: a pending Promise alone does not keep the
    // Node event loop alive, and exiting early would leave a stale descriptor.
    drainTimer = setTimeout(forceDrain, drainTimeoutMs);
    void (async () => {
      try {
        // Let already accepted requests settle before disposing their shared
        // ONNX pipeline. The drain deadline remains the hard upper bound.
        await waitForRequestsIdle();
        await closeIndexer();
        while (backgroundTasks.size > 0) {
          await Promise.allSettled([...backgroundTasks]);
        }
      } catch (error: unknown) {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[daemon] shutdown cleanup failed: ${error instanceof Error ? error.message : error}`);
        }
      } finally {
        backgroundSettled = true;
        maybeFinalize();
      }
    })();
    try { server.close(markServerClosed); }
    catch { markServerClosed(); }
  };
  const scheduleIdle = (): void => {
    clearIdle();
    if (state !== 'ready' || activeRequests !== 0 || idleTimeoutMs === 0) return;
    idleDeadlineMs = Date.now() + idleTimeoutMs;
    idleTimer = setTimeout(() => { beginDrain('idle'); }, idleTimeoutMs);
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
      authorityKey,
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
    // Consume a valid persisted cache when one exists. Explicit invalidation
    // still rebuilds, but startup must not duplicate the foreground fallback's
    // just-completed whole-corpus work.
    await indexer.get();
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
