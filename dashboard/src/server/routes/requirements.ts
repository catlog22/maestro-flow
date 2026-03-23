// ---------------------------------------------------------------------------
// Requirement REST API routes -- expand, refine, commit requirements
// ---------------------------------------------------------------------------

import { Hono } from 'hono';

import type { RequirementExpander } from '../requirement/requirement-expander.js';
import type { ExpansionDepth } from '../../shared/requirement-types.js';

// ---------------------------------------------------------------------------
// Valid values
// ---------------------------------------------------------------------------

const VALID_DEPTHS = new Set<string>(['shallow', 'standard', 'deep']);
const VALID_COMMIT_MODES = new Set<string>(['issues', 'coordinate']);

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Requirement routes following the Hono factory pattern.
 *
 * GET    /api/requirements              - list all expanded requirements
 * POST   /api/requirements/expand       - expand user text into structured requirement
 * POST   /api/requirements/:id/refine   - refine an existing expansion with feedback
 * POST   /api/requirements/:id/commit   - commit requirement as issues or coordinate session
 * GET    /api/requirements/:id          - get a single expanded requirement by ID
 */
export function createRequirementRoutes(requirementExpander: RequirementExpander): Hono {
  const app = new Hono();

  // GET /api/requirements — list all (newest first)
  app.get('/api/requirements', (c) => {
    try {
      const all = requirementExpander.getAll();
      // Sort newest first
      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return c.json(all);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/requirements/expand
  app.post('/api/requirements/expand', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();

      // Validate required fields
      if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
        return c.json({ error: 'Missing or invalid "text" field' }, 400);
      }

      // Validate optional depth field
      if (body.depth !== undefined && !VALID_DEPTHS.has(body.depth as string)) {
        return c.json({ error: `Invalid "depth": ${String(body.depth)}. Must be one of: shallow, standard, deep` }, 400);
      }

      const depth = (body.depth as ExpansionDepth | undefined) ?? 'standard';
      const result = await requirementExpander.expand((body.text as string).trim(), depth);

      return c.json(result, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/requirements/:id/refine
  app.post('/api/requirements/:id/refine', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json<Record<string, unknown>>();

      // Validate required fields
      if (!body.feedback || typeof body.feedback !== 'string' || !body.feedback.trim()) {
        return c.json({ error: 'Missing or invalid "feedback" field' }, 400);
      }

      const result = await requirementExpander.refine(id, (body.feedback as string).trim());
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Map "not found" errors to 404
      if (message.includes('not found')) {
        return c.json({ error: message }, 404);
      }
      // Map state errors to 409
      if (message.includes('expected "reviewing"')) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // POST /api/requirements/:id/commit
  app.post('/api/requirements/:id/commit', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json<Record<string, unknown>>();

      // Validate required fields
      if (!body.mode || typeof body.mode !== 'string' || !VALID_COMMIT_MODES.has(body.mode)) {
        return c.json({ error: `Missing or invalid "mode" field. Must be one of: issues, coordinate` }, 400);
      }

      if (body.mode === 'issues') {
        const issueIds = await requirementExpander.commitAsIssues(id);
        return c.json({ ok: true, issueIds });
      } else {
        const sessionId = await requirementExpander.commitAsCoordinate(id);
        return c.json({ ok: true, sessionId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        return c.json({ error: message }, 404);
      }
      if (message.includes('expected "reviewing"')) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  // GET /api/requirements/:id
  app.get('/api/requirements/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const requirement = requirementExpander.get(id);

      if (!requirement) {
        return c.json({ error: `Requirement not found: ${id}` }, 404);
      }

      return c.json(requirement);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
