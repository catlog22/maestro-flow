import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  invalidateSearchIndex,
  queryDaemon,
  stopDaemon,
} from '../daemon-client.js';
import {
  SEARCH_DAEMON_PROTOCOL,
  canonicalWorkflowRoot,
  getDaemonPath,
} from '../daemon-types.js';
import type { DaemonInfoV2, DaemonSearchRequest } from '../daemon-types.js';

let server: Server | null = null;
const roots: string[] = [];

afterEach(() => {
  server?.close();
  server = null;
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function listenWithSilentServer(): Promise<number> {
  server = createServer(() => {
    // Intentionally keep the socket open so the client-side timeout is tested.
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('bad test server address');
  return addr.port;
}

async function listenWithHandler(handler: Parameters<typeof createServer>[0]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bad test server address');
  return address.port;
}

function workflowRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-daemon-client-'));
  roots.push(root);
  return root;
}

function descriptor(root: string, port: number): DaemonInfoV2 {
  return {
    protocol: SEARCH_DAEMON_PROTOCOL,
    instanceId: '12345678-1234-4123-8123-123456789abc',
    workflowRoot: canonicalWorkflowRoot(root),
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
}

describe('daemon client protocol boundaries', () => {
  it('serializes facet filters in the search request', async () => {
    let received: DaemonSearchRequest | null = null;
    const port = await listenWithHandler(socket => {
      let body = '';
      socket.on('data', chunk => {
        body += chunk.toString();
        if (!body.includes('\n')) return;
        received = JSON.parse(body.trim()) as DaemonSearchRequest;
        socket.end(JSON.stringify({ ok: true, results: [], filtersApplied: true }) + '\n');
      });
    });

    await queryDaemon(port, {
      action: 'search',
      query: 'transaction',
      limit: 5,
      filters: {
        type: 'spec',
        category: 'arch',
        tag: 'storage',
        keyword: 'atomic',
        workspace: 'shared',
        includeDeprecated: true,
      },
    });

    expect(received).toMatchObject({
      action: 'search',
      filters: {
        type: 'spec',
        category: 'arch',
        tag: 'storage',
        keyword: 'atomic',
        workspace: 'shared',
        includeDeprecated: true,
      },
    });
  });

  it('honors per-query timeout options', async () => {
    const port = await listenWithSilentServer();

    const start = Date.now();
    await expect(
      queryDaemon(port, { action: 'search', query: 'slow', limit: 1 }, { timeoutMs: 25 }),
    ).rejects.toThrow('timeout');

    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('rejects a response above the client byte cap', async () => {
    const port = await listenWithHandler(socket => {
      socket.end(JSON.stringify({ ok: true, padding: 'x'.repeat(128) }) + '\n');
    });

    await expect(queryDaemon(
      port,
      { action: 'search', query: 'bounded', limit: 1 },
      { maxResponseBytes: 32 },
    )).rejects.toThrow('response too large');
  });

  it('never signals or deletes an unverified legacy descriptor on stop', async () => {
    const root = workflowRoot();
    writeFileSync(getDaemonPath(root), JSON.stringify({
      pid: process.pid,
      port: 12345,
      startedAt: 'legacy',
    }));
    const kill = vi.spyOn(process, 'kill');

    await expect(stopDaemon(root)).resolves.toBe(false);

    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(getDaemonPath(root))).toBe(true);
  });

  it('authenticates shutdown against the descriptor instance', async () => {
    let received: DaemonSearchRequest | null = null;
    const root = workflowRoot();
    const port = await listenWithHandler(socket => {
      let body = '';
      socket.on('data', chunk => {
        body += chunk.toString();
        if (!body.includes('\n')) return;
        received = JSON.parse(body.trim()) as DaemonSearchRequest;
        const info = descriptor(root, port);
        socket.end(JSON.stringify({
          ok: true,
          state: 'draining',
          protocol: info.protocol,
          instanceId: info.instanceId,
          workflowRoot: info.workflowRoot,
          pid: info.pid,
        }) + '\n');
      });
    });
    const info = descriptor(root, port);
    writeFileSync(getDaemonPath(root), JSON.stringify(info));

    await expect(stopDaemon(root)).resolves.toBe(true);
    expect(received).toMatchObject({
      action: 'shutdown',
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId: info.instanceId,
      workflowRoot: info.workflowRoot,
    });
  });

  it('delivers invalidation with authenticated identity inside a caller budget', async () => {
    let received: DaemonSearchRequest | null = null;
    const root = workflowRoot();
    const port = await listenWithHandler(socket => {
      let body = '';
      socket.on('data', chunk => {
        body += chunk.toString();
        if (!body.includes('\n')) return;
        received = JSON.parse(body.trim()) as DaemonSearchRequest;
        const info = descriptor(root, port);
        socket.end(JSON.stringify({
          ok: true,
          protocol: info.protocol,
          instanceId: info.instanceId,
          workflowRoot: info.workflowRoot,
          pid: info.pid,
        }) + '\n');
      });
    });
    const info = descriptor(root, port);
    writeFileSync(getDaemonPath(root), JSON.stringify(info));

    await invalidateSearchIndex(root, { timeoutMs: 100 });

    expect(received).toMatchObject({
      action: 'invalidate',
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId: info.instanceId,
      workflowRoot: info.workflowRoot,
    });
  });

  it('falls back to cache deletion when invalidate returns ok:false', async () => {
    const root = workflowRoot();
    const port = await listenWithHandler(socket => {
      const info = descriptor(root, port);
      socket.end(JSON.stringify({
        ok: false,
        error: 'rebuild failed',
        protocol: info.protocol,
        instanceId: info.instanceId,
        workflowRoot: info.workflowRoot,
        pid: info.pid,
      }) + '\n');
    });
    writeFileSync(getDaemonPath(root), JSON.stringify(descriptor(root, port)));
    writeFileSync(join(root, 'search-cache.json'), 'cache');
    writeFileSync(join(root, 'wiki-index.json'), 'index');

    await invalidateSearchIndex(root);

    expect(existsSync(join(root, 'search-cache.json'))).toBe(false);
    expect(existsSync(join(root, 'wiki-index.json'))).toBe(false);
  });
});
