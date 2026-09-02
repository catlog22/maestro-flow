import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:net';

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
  tryDaemonSearch,
} from '../daemon-client.js';
import {
  daemonIdentityRequest,
  getDaemonPath,
  isDaemonInfoV2,
  readDaemonInfo,
} from '../daemon-types.js';
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

    await expect(invalidateSearchIndex(root, { timeoutMs: 100 })).resolves.toBeUndefined();
    expect(indexer.get).toHaveBeenCalledTimes(1);
    expect(indexer.invalidate).toHaveBeenCalledTimes(1);
    expect(indexer.rebuild).toHaveBeenCalledTimes(1);

    releaseRebuild({});
  });

  it('joins indexer background shutdown before releasing the descriptor', async () => {
    const root = workflowRoot();
    const started = await startDaemon(root, { workflowRoot: root });
    running.push({ root, server: started.server });
    let releaseClose!: () => void;
    indexer.close.mockImplementationOnce(() => new Promise<void>(resolve => { releaseClose = resolve; }));

    await expect(stopDaemon(root)).resolves.toBe(true);
    expect(indexer.close).toHaveBeenCalledTimes(1);
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
