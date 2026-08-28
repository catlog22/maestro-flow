import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  indexers: [] as Array<{
    workflowRoot: string;
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
  }>,
  writers: [] as Array<{
    workflowRoot: string;
    create: ReturnType<typeof vi.fn>;
    appendEntry: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../wiki/wiki-indexer.js', () => {
  class WikiIndexer {
    readonly workflowRoot: string;
    readonly get = vi.fn(async () => ({
      entries: [],
      byId: {},
      backlinks: {},
      generatedAt: Date.now(),
    }));
    readonly query = vi.fn(async () => [{ id: `entry:${this.workflowRoot}` }]);
    readonly invalidate = vi.fn();

    constructor(config: { workflowRoot: string }) {
      this.workflowRoot = config.workflowRoot;
      fakes.indexers.push(this);
    }
  }

  return { WikiIndexer };
});

vi.mock('../wiki/writer.js', () => {
  class WikiWriteError extends Error {
    constructor(
      readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN',
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  }

  class WikiWriter {
    readonly create = vi.fn(async () => ({
      id: `created:${this.workflowRoot}`,
      source: { path: `specs/${this.workflowRoot}.md` },
    }));
    readonly appendEntry = vi.fn(async () => ({ id: `appended:${this.workflowRoot}` }));

    constructor(
      readonly workflowRoot: string,
      _indexer: unknown,
    ) {
      fakes.writers.push(this);
    }
  }

  return { WikiWriter, WikiWriteError };
});

import { DashboardEventBus } from '../state/event-bus.js';
import { createSpecsRoutes } from './specs.js';
import { createSharedWikiWriter } from './wiki.js';

describe('shared wiki workspace runtime', () => {
  beforeEach(() => {
    fakes.indexers.length = 0;
    fakes.writers.length = 0;
  });

  it('creates one runtime and resolves the switched context for wiki and specs requests', async () => {
    let workflowRoot = 'workspace-a';
    const bus = new DashboardEventBus();
    const shared = createSharedWikiWriter(() => workflowRoot, bus);
    const specsRoutes = createSpecsRoutes(() => workflowRoot, shared.getContext);

    try {
      expect(fakes.indexers).toHaveLength(1);
      expect(fakes.writers).toHaveLength(1);

      const oldIndexer = fakes.indexers[0];
      const oldWriter = fakes.writers[0];

      const firstWiki = await shared.routes.request('/api/wiki');
      expect(firstWiki.status).toBe(200);
      expect(oldIndexer.query).toHaveBeenCalledTimes(1);

      const firstSpec = await specsRoutes.request('/api/specs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'learning', content: 'first', file: 'learnings' }),
      });
      expect(firstSpec.status).toBe(201);
      expect(oldWriter.appendEntry).toHaveBeenCalledTimes(1);

      workflowRoot = 'workspace-b';
      bus.emit('workspace:switched', { workspace: workflowRoot });

      expect(fakes.indexers).toHaveLength(2);
      expect(fakes.writers).toHaveLength(2);
      const currentIndexer = fakes.indexers[1];
      const currentWriter = fakes.writers[1];
      expect(shared.getContext().workflowRoot).toBe('workspace-b');

      const secondWiki = await shared.routes.request('/api/wiki');
      expect(secondWiki.status).toBe(200);
      expect(oldIndexer.query).toHaveBeenCalledTimes(1);
      expect(currentIndexer.query).toHaveBeenCalledTimes(1);

      const secondSpec = await specsRoutes.request('/api/specs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'learning', content: 'second', file: 'learnings' }),
      });
      expect(secondSpec.status).toBe(201);
      expect(oldWriter.appendEntry).toHaveBeenCalledTimes(1);
      expect(currentWriter.appendEntry).toHaveBeenCalledTimes(1);
    } finally {
      shared.dispose();
    }
  });

  it('unsubscribes workspace and invalidation listeners on dispose', () => {
    let workflowRoot = 'workspace-a';
    const bus = new DashboardEventBus();
    const shared = createSharedWikiWriter(() => workflowRoot, bus);
    const contextAtDispose = shared.getContext();
    const indexerAtDispose = fakes.indexers[0];

    shared.dispose();
    shared.dispose();
    workflowRoot = 'workspace-b';
    bus.emit('workspace:switched', { workspace: workflowRoot });
    bus.emit('wiki:invalidated', { at: Date.now(), path: 'specs/change.md' });

    expect(shared.getContext()).toBe(contextAtDispose);
    expect(fakes.indexers).toHaveLength(1);
    expect(fakes.writers).toHaveLength(1);
    expect(indexerAtDispose.invalidate).not.toHaveBeenCalled();
  });
});
