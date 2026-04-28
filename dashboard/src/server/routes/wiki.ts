import { Hono } from 'hono';

import type { DashboardEventBus } from '../state/event-bus.js';
import { WikiIndexer } from '../wiki/wiki-indexer.js';
import type { WikiFilters, WikiStatus, WikiNodeType, WikiScope } from '../wiki/wiki-types.js';
import { computeHealth, detectHubs, detectOrphans } from '../wiki/graph-analysis.js';
import { WikiWriter, WikiWriteError } from '../wiki/writer.js';

/**
 * /api/wiki — unified wiki endpoint backed by WikiIndexer.
 *
 * Reads files under `.workflow/` (specs, project.md, roadmap.md,
 * memory/) plus virtual entries adapted from JSONL sources (issues,
 * learning). JSONL rows are read-only reflections; never mutated by this
 * route.
 *
 * Capabilities (turbovault-inspired):
 *   - Graph analysis (backlinks, forward links, orphans, hubs, broken links)
 *   - BM25 full-text search (replaces naive substring filter when `q` is set)
 *   - Health audit (/api/wiki/health)
 *   - Scoped markdown write ops (POST/PUT/DELETE for real `.md` entries)
 *
 * The indexer is recreated on `workspace:switched` events so subsequent
 * requests see the new workflow root.
 */
export function createWikiRoutes(
  workflowRoot: () => string,
  eventBus: DashboardEventBus,
): Hono {
  const app = new Hono();

  let indexer = new WikiIndexer({ workflowRoot: workflowRoot() });
  let writer = new WikiWriter(workflowRoot(), indexer);

  eventBus.on('workspace:switched', () => {
    indexer = new WikiIndexer({ workflowRoot: workflowRoot() });
    writer = new WikiWriter(workflowRoot(), indexer);
  });

  eventBus.on('wiki:invalidated', (event) => {
    // Skip re-entrant notify() emissions (those carry no `path`).
    const data = event.data as { at: number; path?: string };
    if (data && data.path) {
      indexer.invalidate(data.path);
    }
  });

  // Warm the cache on mount and emit a fresh invalidation signal.
  const notify = async () => {
    const index = await indexer.get();
    eventBus.emit('wiki:invalidated', { at: index.generatedAt });
  };

  // -------------------------------------------------------------------------
  // Read routes
  // -------------------------------------------------------------------------

  app.get('/api/wiki', async (c) => {
    const filters = parseFilters(c.req.query());
    const group = c.req.query('group') === 'true';
    if (group) {
      const groups = await indexer.groups(filters);
      return c.json({ groups });
    }
    const entries = await indexer.query(filters);
    return c.json({ entries });
  });

  app.get('/api/wiki/stats', async (c) => {
    const index = await indexer.get();
    const totals: Record<WikiNodeType, number> = {
      project: 0,
      roadmap: 0,
      spec: 0,
      issue: 0,
      lesson: 0,
      knowhow: 0,
      note: 0,
    };
    const tagCounts: Record<string, number> = {};
    for (const d of index.entries) {
      totals[d.type]++;
      for (const t of d.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
    return c.json({ totals, tagCounts, lastUpdated: index.generatedAt });
  });

  app.get('/api/wiki/health', async (c) => {
    const index = await indexer.get();
    const graph = await indexer.getGraph();
    const health = computeHealth(index, graph);
    return c.json(health);
  });

  app.get('/api/wiki/graph', async (c) => {
    const graph = await indexer.getGraph();
    return c.json(graph);
  });

  app.get('/api/wiki/orphans', async (c) => {
    const index = await indexer.get();
    const graph = await indexer.getGraph();
    const ids = detectOrphans(graph, index.entries);
    return c.json({ orphans: ids.map((id) => index.byId[id]).filter(Boolean) });
  });

  app.get('/api/wiki/hubs', async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 10) || 10, 1), 100);
    const graph = await indexer.getGraph();
    const hubs = detectHubs(graph, limit);
    return c.json({ hubs });
  });

  app.get('/api/wiki/:id/backlinks', async (c) => {
    const id = c.req.param('id');
    if (!isValidId(id)) return c.json({ error: 'Invalid wiki id' }, 400);
    const index = await indexer.get();
    const ids = index.backlinks[id] ?? [];
    const backlinks = ids.map((sourceId) => index.byId[sourceId]).filter(Boolean);
    return c.json({ backlinks });
  });

  app.get('/api/wiki/:id/forward', async (c) => {
    const id = c.req.param('id');
    if (!isValidId(id)) return c.json({ error: 'Invalid wiki id' }, 400);
    const index = await indexer.get();
    const graph = await indexer.getGraph();
    const ids = graph.forwardLinks[id] ?? [];
    const forward = ids.map((targetId) => index.byId[targetId]).filter(Boolean);
    return c.json({ forward });
  });

  app.get('/api/wiki/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidId(id)) return c.json({ error: 'Invalid wiki id' }, 400);
    const index = await indexer.get();
    const entry = index.byId[id];
    if (!entry) return c.json({ error: 'Entry not found' }, 404);
    return c.json({ entry });
  });

  // -------------------------------------------------------------------------
  // Write routes (real markdown files only)
  // -------------------------------------------------------------------------

  app.post('/api/wiki', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid json body' }, 400);
    }
    try {
      const entry = await writer.create(body as never);
      eventBus.emit('wiki:invalidated', { at: Date.now(), path: entry.source.path });
      return c.json({ entry }, 201);
    } catch (err) {
      return handleWriteError(c, err);
    }
  });

  app.put('/api/wiki/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidId(id)) return c.json({ error: 'Invalid wiki id' }, 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid json body' }, 400);
    }
    try {
      const entry = await writer.update(id, body as never);
      eventBus.emit('wiki:invalidated', { at: Date.now(), path: entry.source.path });
      return c.json({ entry });
    } catch (err) {
      return handleWriteError(c, err);
    }
  });

  app.delete('/api/wiki/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidId(id)) return c.json({ error: 'Invalid wiki id' }, 400);
    try {
      await writer.remove(id);
      eventBus.emit('wiki:invalidated', { at: Date.now() });
      return c.json({ ok: true });
    } catch (err) {
      return handleWriteError(c, err);
    }
  });

  // Fire-and-forget: warm the cache on first mount. Errors surfaced via logs.
  notify().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[wiki] initial scan failed', err);
  });

  return app;
}

/**
 * Factory that creates wiki routes AND exposes a shared WikiWriter for use
 * by other route modules (e.g. specs). This avoids creating duplicate
 * WikiIndexer/WikiWriter instances.
 */
export function createSharedWikiWriter(
  workflowRoot: () => string,
  eventBus: DashboardEventBus,
): { routes: Hono; getWriter: () => WikiWriter } {
  // Create shared instances
  let indexer = new WikiIndexer({ workflowRoot: workflowRoot() });
  let sharedWriter = new WikiWriter(workflowRoot(), indexer);

  eventBus.on('workspace:switched', () => {
    indexer = new WikiIndexer({ workflowRoot: workflowRoot() });
    sharedWriter = new WikiWriter(workflowRoot(), indexer);
  });

  // Build wiki routes using the shared instances
  const routes = createWikiRoutes(workflowRoot, eventBus);

  return {
    routes,
    getWriter: () => sharedWriter,
  };
}

function parseFilters(q: Record<string, string>): WikiFilters {
  const out: WikiFilters = {};
  if (q.type) out.type = q.type as WikiNodeType;
  if (q.scope) out.scope = q.scope as WikiScope;
  if (q.tag) out.tag = q.tag;
  if (q.status) out.status = q.status as WikiStatus;
  if (q.q) out.q = q.q;
  if (q.category) out.category = q.category;
  if (q.createdBy) out.createdBy = q.createdBy;
  return out;
}

function isValidId(id: string): boolean {
  return /^[\w.:-]+$/.test(id) && !id.includes('/') && !id.includes('\\');
}

type CtxLike = {
  json: (body: unknown, status?: 400 | 403 | 404 | 409 | 500) => Response;
};

function handleWriteError(c: CtxLike, err: unknown): Response {
  if (err instanceof WikiWriteError) {
    const statusMap: Record<WikiWriteError['code'], 400 | 403 | 404 | 409> = {
      BAD_REQUEST: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
    };
    return c.json({ error: err.message, details: err.details }, statusMap[err.code]);
  }
  // eslint-disable-next-line no-console
  console.error('[wiki] unexpected write error', err);
  return c.json({ error: String(err) }, 500);
}
