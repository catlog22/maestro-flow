import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Server } from 'node:net';

const indexer = vi.hoisted(() => ({
  get: vi.fn(),
  rebuild: vi.fn(),
  searchWithMeta: vi.fn(),
  invalidate: vi.fn(),
  getEmbeddingIndex: vi.fn(),
  close: vi.fn(),
}));

vi.mock('#maestro-dashboard/wiki/wiki-indexer.js', () => ({
  WikiIndexer: class {
    get = indexer.get;
    rebuild = indexer.rebuild;
    searchWithMeta = indexer.searchWithMeta;
    invalidate = indexer.invalidate;
    getEmbeddingIndex = indexer.getEmbeddingIndex;
    close = indexer.close;
  },
}));

import { startDaemon } from '../daemon.js';
import {
  healthDaemon,
  invalidateSearchIndex,
  queryDaemon,
  stopDaemon,
  tryDaemonLoad,
  tryDaemonSearch,
} from '../daemon-client.js';
import {
  daemonIdentityRequest,
  getDaemonPath,
  getDaemonSpawnLockPath,
  isDaemonInfoV2,
  readDaemonInfo,
} from '../daemon-types.js';
import {
  acquireWikiPublisherLease,
  releaseWikiPublisherLease,
} from '../publisher-lease.js';
import type { DaemonInfoV2 } from '../daemon-types.js';

const roots: string[] = [];
const running: Array<{ root: string; server: Server }> = [];

function workflowRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-daemon-server-'));
  roots.push(root);
  return root;
}

async function waitUntil(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function currentInfo(root: string): DaemonInfoV2 {
  const value = readDaemonInfo(root);
  if (!isDaemonInfoV2(value, root)) throw new Error('expected v2 descriptor');
  return value;
}

function loadEntry(id: string, title: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    id, type: 'knowhow', title, summary: `summary ${id}`, tags: ['performance'],
    status: 'active', created: '2026-09-02T00:00:00.000Z', updated: '2026-09-02T00:00:00.000Z',
    related: [], source: { kind: 'file', path: `knowhow/${id}.md` }, body, ext: {},
    scope: 'project', category: 'performance', specCategory: null,
    createdBy: null, sourceRef: null, parent: null, ...overrides,
  };
}

beforeEach(() => {
  indexer.get.mockReset().mockResolvedValue({});
  indexer.rebuild.mockReset().mockResolvedValue({});
  indexer.searchWithMeta.mockReset().mockResolvedValue({
    results: [],
    embeddingUsed: false,
    embeddingDocs: 0,
  });
  indexer.invalidate.mockReset();
  indexer.getEmbeddingIndex.mockReset().mockResolvedValue(null);
  indexer.close.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const item of running.splice(0)) {
    await stopDaemon(item.root).catch(() => false);
    if (item.server.listening) {
      await new Promise<void>(resolve => item.server.close(() => resolve()));
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.sequential('search daemon lifecycle state machine', () => {
  it('publishes a starting descriptor before cache-aware load and allows authenticated cancellation', async () => {
    let finishLoad!: (value: object) => void;
    indexer.get.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    const root = workflowRoot();

    const starting = startDaemon(root, { workflowRoot: root });
    await waitUntil(() => readDaemonInfo(root) !== null, 'starting descriptor was not published');

    const descriptor = currentInfo(root);
    const health = await healthDaemon(root);
    expect(descriptor).toMatchObject({
      protocol: 'maestro-search-daemon/v2',
      pid: process.pid,
      workflowRoot: expect.any(String),
      instanceId: expect.any(String),
    });
    expect(health).toMatchObject({ ok: true, state: 'starting' });
    await expect(stopDaemon(root)).resolves.toBe(true);

    finishLoad({});
    await expect(starting).rejects.toThrow(/cancelled|draining/);
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'cancelled descriptor was not removed');
  });

  it('converges concurrent starts to one descriptor owner', async () => {
    const root = workflowRoot();
    const attempts = await Promise.allSettled([
      startDaemon(root, { workflowRoot: root }),
      startDaemon(root, { workflowRoot: root }),
    ]);
    const started = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof startDaemon>>> =>
        attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(attempt => attempt.status === 'rejected');

    expect(started).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(currentInfo(root).pid).toBe(process.pid);
    running.push({ root, server: started[0].value.server });
  });

  it('holds the publisher lease against Dashboard until daemon shutdown', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });

    // Dashboard's one-shot fallback is a second lease contender while the
    // resident daemon owns publication; it must fail closed rather than write.
    const dashboardAttempt = acquireWikiPublisherLease(root);
    expect(dashboardAttempt).toBeNull();

    await expect(stopDaemon(root)).resolves.toBe(true);
    const afterShutdown = acquireWikiPublisherLease(root);
    expect(afterShutdown).not.toBeNull();
    releaseWikiPublisherLease(afterShutdown);
  });

  it('cleans stale spawn artifacts after atomically claiming the descriptor', async () => {
    const root = workflowRoot();
    const lockPath = getDaemonSpawnLockPath(root);
    writeFileSync(lockPath, '0:1:stale-primary');
    writeFileSync(`${lockPath}.reclaim`, '0:2:stale-reclaimer');

    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.reclaim`)).toBe(false);
  });

  it('rejects malformed and out-of-bound search requests before indexer work', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    const descriptor = currentInfo(root);

    const missingIdentity = await queryDaemon(descriptor.port, { action: 'shutdown' });
    expect(missingIdentity).toMatchObject({ ok: false, error: 'invalid daemon protocol', state: 'ready' });
    expect(started.server.listening).toBe(true);

    const response = await queryDaemon(descriptor.port, {
      action: 'search',
      query: 'bounded',
      limit: 501,
      ...daemonIdentityRequest(descriptor),
    });
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining('limit') });
    expect(indexer.searchWithMeta).not.toHaveBeenCalled();

    await expect(tryDaemonSearch(root, 'valid', 5, true)).resolves.toMatchObject({
      ok: true,
      state: 'ready',
    });
    expect(indexer.searchWithMeta).toHaveBeenCalledTimes(1);
  });

  it('returns bounded request-scoped diagnostics and accepts old-style callers', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    const descriptor = currentInfo(root);

    const response = await queryDaemon(descriptor.port, {
      action: 'search',
      query: 'diagnostic request',
      limit: 1,
      diagnostics: true,
      ...daemonIdentityRequest(descriptor),
    });

    expect(response).toMatchObject({
      ok: true,
      diagnostics: {
        schemaVersion: 'maestro-search-diagnostics/1.0',
        requestId: expect.any(String),
        phases: expect.any(Array),
        fallbacks: expect.any(Array),
      },
    });
    expect(indexer.searchWithMeta).toHaveBeenCalledWith(
      'diagnostic request',
      1,
      expect.objectContaining({ diagnostics: expect.objectContaining({ requestId: expect.any(String) }) }),
    );

    // A response without diagnostics remains a valid protocol response for
    // clients that predate the optional field.
    const legacy = await queryDaemon(descriptor.port, {
      action: 'search',
      query: 'old caller',
      limit: 1,
      ...daemonIdentityRequest(descriptor),
    });
    expect(legacy.ok).toBe(true);
    expect(legacy.diagnostics).toBeUndefined();
  });

  it('serves the warm full index to authenticated load clients', async () => {
    const root = workflowRoot();
    const entry = {
      id: 'knowhow-fast-load', type: 'knowhow', title: 'Fast load', summary: '',
      tags: [], status: 'active', created: '', updated: '', related: [],
      source: { kind: 'file', path: 'knowhow/fast-load.md' }, body: 'warm body',
      ext: {}, scope: 'project', category: 'performance', specCategory: null,
      createdBy: null, sourceRef: null, parent: null,
    };
    indexer.get.mockResolvedValue({ entries: [entry], generatedAt: 42 });
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });

    await expect(tryDaemonLoad(root)).resolves.toMatchObject({
      ok: true,
      entries: [{ id: 'knowhow-fast-load', body: 'warm body' }],
      generatedAt: 42,
      state: 'ready',
    });
    expect(indexer.searchWithMeta).not.toHaveBeenCalled();
  });

  it('bounds selected load transfer, applies selectors, and omits list bodies', async () => {
    const root = workflowRoot();
    indexer.get.mockResolvedValue({
      entries: [
        loadEntry('knowhow-huge-irrelevant', 'Huge irrelevant', 'x'.repeat(17 * 1024 * 1024), {
          category: 'other', tags: ['other'],
        }),
        loadEntry('knowhow-selected', 'Selected', 'needle in body'),
      ],
      generatedAt: 43,
    });
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });

    const selected = await tryDaemonLoad(root, {
      selection: {
        type: 'knowhow', category: 'performance', keyword: 'needle', tag: 'performance',
        includeDeprecated: false, limit: 1, projection: 'metadata', originExplicit: false,
      },
    });

    expect(selected).toMatchObject({
      ok: true,
      selectionApplied: true,
      entries: [{ id: 'knowhow-selected' }],
    });
    expect(selected?.entries?.[0]).not.toHaveProperty('body');
    expect(JSON.stringify(selected).length).toBeLessThan(10_000);

    await expect(tryDaemonLoad(root, {
      selection: {
        type: 'knowhow', ids: ['SELECTED'], includeDeprecated: false,
        limit: 1, projection: 'full', originExplicit: false,
      },
    })).resolves.toMatchObject({
      ok: true,
      entries: [{ id: 'knowhow-selected', body: 'needle in body' }],
    });
  });

  it('drains an authenticated daemon whose repository authority is stale', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, {
      workflowRoot: root,
      repository: { repoId: 'old-repo', repoName: 'old', alias: 'current' },
    });
    running.push({ root, server: started.server });

    await expect(tryDaemonLoad(root, { authorityKey: 'new-authority' })).resolves.toMatchObject({
      ok: false,
      error: 'daemon authority mismatch',
      state: 'draining',
    });
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'stale-authority daemon retained its descriptor');
  });

  it('releases a timed-out load request while tracking its shared index work', async () => {
    const root = workflowRoot();
    let finishLoad!: (value: { entries: never[]; generatedAt: number }) => void;
    indexer.get
      .mockResolvedValueOnce({})
      .mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    const started = await startDaemon(
      root,
      { workflowRoot: root },
      { maxActiveRequests: 1 },
    );
    running.push({ root, server: started.server });
    const descriptor = currentInfo(root);

    await expect(queryDaemon(
      descriptor.port,
      { action: 'load', ...daemonIdentityRequest(descriptor) },
      { timeoutMs: 25 },
    )).rejects.toThrow(/timeout/);
    await new Promise(resolve => setTimeout(resolve, 50));
    await expect(tryDaemonSearch(root, 'slot released', 1, true)).resolves.toMatchObject({
      ok: true,
    });

    finishLoad({ entries: [], generatedAt: 1 });
  });

  it('reports configurable retention without letting health probes extend it', async () => {
    const root = workflowRoot();
    const started = await startDaemon(
      root,
      { workflowRoot: root },
      { idleTimeoutMs: 1_000 },
    );
    running.push({ root, server: started.server });

    const first = await healthDaemon(root);
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await healthDaemon(root);
    expect(first).toMatchObject({ ok: true, idleTimeoutMs: 1_000 });
    expect(second?.idleDeadline).toBe(first?.idleDeadline);

    await tryDaemonSearch(root, 'refresh work activity', 1, true);
    const refreshed = await healthDaemon(root);
    expect(Date.parse(refreshed?.idleDeadline ?? '')).toBeGreaterThan(
      Date.parse(first?.idleDeadline ?? ''),
    );
  });

  it('drains an in-flight search before deleting its owned descriptor', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });

    let finishSearch!: (value: { results: never[]; embeddingUsed: boolean; embeddingDocs: number }) => void;
    indexer.searchWithMeta.mockImplementationOnce(() => new Promise(resolve => { finishSearch = resolve; }));
    const search = tryDaemonSearch(root, 'in flight', 5, true);
    await waitUntil(() => indexer.searchWithMeta.mock.calls.length === 1, 'search did not become active');

    await expect(stopDaemon(root)).resolves.toBe(true);
    expect(existsSync(getDaemonPath(root))).toBe(true);

    finishSearch({ results: [], embeddingUsed: false, embeddingDocs: 0 });
    await expect(search).resolves.toMatchObject({ ok: true });
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'drained daemon kept its descriptor');
    expect(started.server.listening).toBe(false);
  });

  it('acknowledges authenticated invalidation delivery before its rebuild completes', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    let releaseRebuild!: (value: object) => void;
    indexer.rebuild.mockImplementationOnce(() => new Promise(resolve => { releaseRebuild = resolve; }));

    await expect(Promise.all(Array.from(
      { length: 5 },
      () => invalidateSearchIndex(root, { timeoutMs: 100 }),
    ))).resolves.toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(indexer.get).toHaveBeenCalledTimes(1);
    expect(indexer.invalidate).toHaveBeenCalledTimes(5);
    expect(indexer.rebuild).toHaveBeenCalledTimes(1);

    releaseRebuild({});
  });

  it('aborts an in-flight search when its client disconnects', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    const descriptor = currentInfo(root);
    let observedSignal: AbortSignal | undefined;
    indexer.searchWithMeta.mockImplementationOnce((...args: unknown[]) => {
      observedSignal = (args[2] as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      });
    });

    const socket = connect(descriptor.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(JSON.stringify({
      action: 'search',
      query: 'disconnect',
      limit: 1,
      ...daemonIdentityRequest(descriptor),
    }) + '\n');
    await waitUntil(() => observedSignal !== undefined, 'search did not receive an abort signal');

    socket.destroy();
    await waitUntil(() => observedSignal?.aborted === true, 'disconnected search was not aborted');
  });

  it('rejects excess work while preserving lifecycle requests', async () => {
    const root = workflowRoot();
    const started = await startDaemon(
      root,
      { workflowRoot: root },
      { maxActiveRequests: 1 },
    );
    running.push({ root, server: started.server });
    let releaseSearch!: (value: { results: never[]; embeddingUsed: boolean; embeddingDocs: number }) => void;
    indexer.searchWithMeta.mockImplementationOnce(() => new Promise(resolve => { releaseSearch = resolve; }));

    const first = tryDaemonSearch(root, 'first', 1, true);
    await waitUntil(() => indexer.searchWithMeta.mock.calls.length === 1, 'first search did not start');
    await expect(tryDaemonSearch(root, 'second', 1, true)).resolves.toMatchObject({
      ok: false,
      error: 'too many active requests',
    });
    await expect(healthDaemon(root)).resolves.toMatchObject({ ok: true, state: 'ready' });

    releaseSearch({ results: [], embeddingUsed: false, embeddingDocs: 0 });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it('tracks and closes sockets rejected by the connection cap', async () => {
    const root = workflowRoot();
    const started = await startDaemon(
      root,
      { workflowRoot: root },
      { maxConnections: 1 },
    );
    running.push({ root, server: started.server });
    const descriptor = currentInfo(root);
    const blocker = connect(descriptor.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      blocker.once('connect', resolve);
      blocker.once('error', reject);
    });
    blocker.write('{"action":');

    await expect(queryDaemon(descriptor.port, {
      action: 'search', query: 'over cap', limit: 1,
    })).resolves.toMatchObject({ ok: false, error: 'too many connections' });

    blocker.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(stopDaemon(root)).resolves.toBe(true);
  });

  it('finalizes descriptor cleanup when indexer close rejects', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    indexer.close.mockRejectedValueOnce(new Error('close failed'));

    await expect(stopDaemon(root)).resolves.toBe(true);
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'failed close retained daemon ownership');
  });

  it('destroys stuck sockets but retains ownership for embedded callers until cleanup settles', async () => {
    const root = workflowRoot();
    const started = await startDaemon(
      root,
      { workflowRoot: root },
      { drainTimeoutMs: 30 },
    );
    running.push({ root, server: started.server });
    let releaseClose!: () => void;
    indexer.close.mockImplementationOnce(() => new Promise<void>(resolve => { releaseClose = resolve; }));
    const descriptor = currentInfo(root);
    const socket = connect(descriptor.port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write('{"action":');

    await expect(stopDaemon(root)).resolves.toBe(true);
    await waitUntil(() => socket.destroyed, 'drain deadline did not destroy open sockets');
    expect(existsSync(getDaemonPath(root))).toBe(true);

    releaseClose();
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'settled cleanup retained daemon ownership');
  });

  it('hard-exits a dedicated daemon only after synchronously releasing ownership', async () => {
    const root = workflowRoot();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);
    try {
      const started = await startDaemon(
        root,
        { workflowRoot: root },
        { drainTimeoutMs: 30, exitOnDrainTimeout: true },
      );
      running.push({ root, server: started.server });
      indexer.close.mockImplementationOnce(() => new Promise<void>(() => {}));

      await expect(stopDaemon(root)).resolves.toBe(true);
      await waitUntil(() => exit.mock.calls.length === 1, 'dedicated daemon did not hard-exit');
      expect(existsSync(getDaemonPath(root))).toBe(false);
    } finally {
      exit.mockRestore();
    }
  });

  it('joins indexer background shutdown before releasing the descriptor', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    let releaseClose!: () => void;
    indexer.close.mockImplementationOnce(() => new Promise<void>(resolve => { releaseClose = resolve; }));

    await expect(stopDaemon(root)).resolves.toBe(true);
    expect(indexer.close).toHaveBeenCalledWith({ disposeEmbeddingPipeline: true });
    expect(existsSync(getDaemonPath(root))).toBe(true);

    releaseClose();
    await waitUntil(() => !existsSync(getDaemonPath(root)), 'descriptor released before background join');
  });

  it('replaces an oversized search payload with a bounded authenticated protocol error', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    indexer.searchWithMeta.mockResolvedValueOnce({
      results: [{
        entry: {
          id: 'huge', type: 'note', title: 'huge', summary: '', tags: [], status: 'active',
          created: '', updated: '', related: [], source: { kind: 'virtual', path: 'huge' },
          body: 'x'.repeat(16 * 1024 * 1024), ext: {}, scope: null, category: null,
          specCategory: null, createdBy: null, sourceRef: null, parent: null,
        },
        score: 1,
      }],
      embeddingUsed: false,
      embeddingDocs: 0,
    });

    await expect(tryDaemonSearch(root, 'huge', 1, true)).resolves.toMatchObject({
      ok: false,
      error: 'response too large',
      protocol: 'maestro-search-daemon/v2',
      instanceId: currentInfo(root).instanceId,
      state: 'ready',
    });
  });
});
