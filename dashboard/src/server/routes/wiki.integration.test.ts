import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWikiRoutes } from './wiki.js';
import { DashboardEventBus } from '../state/event-bus.js';
import type { WikiEntry } from '../wiki/wiki-types.js';

// ---------------------------------------------------------------------------
// L2 Integration: /api/wiki routes end-to-end with tmpdir workflow root.
// Covers all 12 endpoints + failure modes + event emission.
// ---------------------------------------------------------------------------

let workflowRoot: string;
let bus: DashboardEventBus;
let app: ReturnType<typeof createWikiRoutes>;
let appReady = false;

async function seed(rel: string, body: string): Promise<void> {
  const abs = join(workflowRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf-8');
}

/**
 * Build the routes app lazily on first request so the on-mount `notify()`
 * reads a populated workflow root. Tests must finish all file seeding before
 * the first `req()` call.
 */
async function req(path: string, init?: RequestInit): Promise<Response> {
  if (!appReady) {
    app = createWikiRoutes(() => workflowRoot, bus);
    appReady = true;
  }
  return app.request(path, init);
}

async function seedCorpus(): Promise<void> {
  // Specs forming a small graph: auth → session, session ← token, orphan
  await seed(
    'specs/auth.md',
    `---\ntitle: Authentication\ntags:\n  - security\n  - auth\n---\n# Auth\nUses [[spec-session]] and [[spec-token]] for JWT flow.\nAuthentication bearer tokens.`,
  );
  await seed(
    'specs/session.md',
    `---\ntitle: Session Management\ntags:\n  - security\n---\n# Session\nLinked from [[spec-auth]]. Stores session state.`,
  );
  await seed(
    'specs/token.md',
    `---\ntitle: JWT Token\ntags:\n  - security\n---\n# Token\nBacks [[spec-auth]] via signed JWTs.`,
  );
  await seed(
    'specs/orphan.md',
    `---\ntitle: Orphan Note\n---\n# Orphan\nNobody links here and it links nowhere.`,
  );
  await seed(
    'specs/broken.md',
    `---\ntitle: Broken Links\n---\n# Broken\nReferences [[spec-missing]] which does not exist.`,
  );
  // Virtual JSONL entries
  await mkdir(join(workflowRoot, 'issues'), { recursive: true });
  await writeFile(
    join(workflowRoot, 'issues', 'current.jsonl'),
    JSON.stringify({ id: 'I-42', title: 'Test Issue', status: 'open' }) + '\n',
    'utf-8',
  );
}

beforeEach(async () => {
  workflowRoot = join(
    tmpdir(),
    `wiki-int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await mkdir(workflowRoot, { recursive: true });
  bus = new DashboardEventBus();
  appReady = false;
});

afterEach(async () => {
  await rm(workflowRoot, { recursive: true, force: true, maxRetries: 3 });
});

// ---------------------------------------------------------------------------
// GET /api/wiki
// ---------------------------------------------------------------------------

describe('GET /api/wiki — listing + filters + BM25', () => {
  it('lists entries and supports filter by type', async () => {
    await seedCorpus();
    const res = await req('/api/wiki?type=spec');
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: WikiEntry[] };
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toContain('spec-auth');
    expect(ids).toContain('spec-session');
    expect(ids).toContain('spec-token');
    expect(ids).toContain('spec-orphan');
    expect(ids).toContain('spec-broken');
    for (const e of entries) expect(e.type).toBe('spec');
  });

  it('filters by tag', async () => {
    await seedCorpus();
    const res = await req('/api/wiki?tag=auth');
    const { entries } = (await res.json()) as { entries: WikiEntry[] };
    expect(entries.map((e) => e.id)).toEqual(['spec-auth']);
  });

  it('BM25 ranks title match first for q=authentication', async () => {
    await seedCorpus();
    const res = await req('/api/wiki?q=authentication');
    const { entries } = (await res.json()) as { entries: WikiEntry[] };
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].id).toBe('spec-auth');
  });

  it('returns grouped output when group=true', async () => {
    await seedCorpus();
    const res = await req('/api/wiki?group=true');
    const body = (await res.json()) as { groups: Record<string, WikiEntry[]> };
    expect(body.groups).toBeDefined();
    expect(Array.isArray(body.groups.spec)).toBe(true);
    expect(body.groups.spec.length).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(body.groups.issue)).toBe(true);
    expect(body.groups.issue.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stats / Health / Graph / Orphans / Hubs
// ---------------------------------------------------------------------------

describe('GET /api/wiki/stats', () => {
  it('returns totals per type and tag counts', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: Record<string, number>;
      tagCounts: Record<string, number>;
      lastUpdated: number;
    };
    expect(body.totals.spec).toBe(5);
    expect(body.totals.issue).toBe(1);
    expect(body.tagCounts.security).toBe(3);
    expect(body.tagCounts.auth).toBe(1);
    expect(typeof body.lastUpdated).toBe('number');
  });
});

describe('GET /api/wiki/health', () => {
  it('penalizes broken links and orphans', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      score: number;
      totals: { entries: number; brokenLinks: number; orphans: number; missingTitles: number };
    };
    expect(body.score).toBeLessThan(100);
    expect(body.totals.brokenLinks).toBeGreaterThanOrEqual(1);
    expect(body.totals.orphans).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/wiki/graph', () => {
  it('returns forwardLinks, backlinks, brokenLinks', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/graph');
    const graph = (await res.json()) as {
      forwardLinks: Record<string, string[]>;
      backlinks: Record<string, string[]>;
      brokenLinks: Array<{ sourceId: string; target: string }>;
    };
    expect(graph.forwardLinks['spec-auth']).toEqual(
      expect.arrayContaining(['spec-session', 'spec-token']),
    );
    expect(graph.backlinks['spec-auth']).toEqual(
      expect.arrayContaining(['spec-session', 'spec-token']),
    );
    expect(graph.brokenLinks).toEqual(
      expect.arrayContaining([{ sourceId: 'spec-broken', target: 'spec-missing' }]),
    );
  });
});

describe('GET /api/wiki/orphans', () => {
  it('returns entries with no incoming or outgoing resolved links', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/orphans');
    const { orphans } = (await res.json()) as { orphans: WikiEntry[] };
    const ids = orphans.map((e) => e.id);
    expect(ids).toContain('spec-orphan');
  });
});

describe('GET /api/wiki/hubs', () => {
  it('ranks by incoming link count', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/hubs?limit=5');
    const { hubs } = (await res.json()) as { hubs: Array<{ id: string; inDegree: number }> };
    expect(hubs[0].id).toBe('spec-auth');
    expect(hubs[0].inDegree).toBe(2);
  });

  it('clamps limit to [1,100]', async () => {
    await seedCorpus();
    const res1 = await req('/api/wiki/hubs?limit=0');
    expect(res1.status).toBe(200);
    const res2 = await req('/api/wiki/hubs?limit=9999');
    expect(res2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// :id / :id/backlinks / :id/forward
// ---------------------------------------------------------------------------

describe('GET /api/wiki/:id', () => {
  it('returns a single entry', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/spec-auth');
    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as { entry: WikiEntry };
    expect(entry.title).toBe('Authentication');
  });

  it('returns 404 for unknown id', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/spec-nope');
    expect(res.status).toBe(404);
  });

  it('rejects invalid id chars', async () => {
    const res = await req('/api/wiki/..%2Fetc');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/wiki/:id/backlinks', () => {
  it('returns incoming edges', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/spec-auth/backlinks');
    const { backlinks } = (await res.json()) as { backlinks: WikiEntry[] };
    const ids = backlinks.map((e) => e.id).sort();
    expect(ids).toEqual(['spec-session', 'spec-token']);
  });
});

describe('GET /api/wiki/:id/forward', () => {
  it('returns outgoing resolved edges', async () => {
    await seedCorpus();
    const res = await req('/api/wiki/spec-auth/forward');
    const { forward } = (await res.json()) as { forward: WikiEntry[] };
    const ids = forward.map((e) => e.id).sort();
    expect(ids).toEqual(['spec-session', 'spec-token']);
  });
});

// ---------------------------------------------------------------------------
// POST /api/wiki
// ---------------------------------------------------------------------------

describe('POST /api/wiki', () => {
  it('creates a new spec and emits wiki:invalidated', async () => {
    const events: Array<{ at: number; path?: string }> = [];
    bus.on('wiki:invalidated', (evt) => {
      events.push(evt.data as { at: number; path?: string });
    });

    const res = await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'spec',
        slug: 'fresh',
        title: 'Fresh Spec',
        body: '# Fresh Spec\nHello world',
      }),
    });
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: WikiEntry };
    expect(entry.id).toBe('spec-fresh');
    expect(entry.source.path).toBe('specs/fresh.md');

    // At least one event mentions the new file path
    expect(events.some((e) => e.path && e.path.endsWith('fresh.md'))).toBe(true);
  });

  it('rejects invalid slug with 400', async () => {
    const res = await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'spec',
        slug: '../../../etc/hosts',
        title: 'evil',
        body: 'x',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-writable type with 400', async () => {
    const res = await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'issue',
        slug: 'x',
        title: 'y',
        body: 'z',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON body with 400', async () => {
    const res = await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 when creating a duplicate slug', async () => {
    await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'spec', slug: 'dup', title: 'Dup', body: 'a' }),
    });
    const res = await req('/api/wiki', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'spec', slug: 'dup', title: 'Dup', body: 'b' }),
    });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/wiki/:id
// ---------------------------------------------------------------------------

describe('PUT /api/wiki/:id', () => {
  it('updates spec title (frontmatter-only) preserving tags', async () => {
    await seed('specs/s.md', `---\ntitle: Old\ntags:\n  - a\n---\n# Old\nbody`);
    const res = await req('/api/wiki/spec-s', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    });
    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as { entry: WikiEntry };
    expect(entry.title).toBe('New');
    expect(entry.tags).toEqual(['a']);
  });

  it('rejects spec body update with 403 (use spec API)', async () => {
    await seed('specs/s.md', `---\ntitle: S\n---\n# S\norig`);
    const res = await req('/api/wiki/spec-s', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'overwritten' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates knowhow entry with body + title', async () => {
    await seed('knowhow/KNW-m.md', `---\ntitle: Old Mem\n---\n# Old\nknowhow body`);
    const res = await req('/api/wiki/knowhow-m', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New Mem', body: 'new knowhow body' }),
    });
    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as { entry: WikiEntry };
    expect(entry.title).toBe('New Mem');
    expect(entry.body).toContain('new knowhow body');
  });

  it('returns 409 on stale expectedHash', async () => {
    await seed('knowhow/KNW-h.md', `---\ntitle: Hash Test\n---\n# H\norig`);
    const res = await req('/api/wiki/knowhow-h', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'updated', expectedHash: 'deadbeef' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details: unknown };
    expect(body.error).toContain('hash');
    expect(body.details).toBeTruthy();
  });

  it('returns 404 for unknown id', async () => {
    const res = await req('/api/wiki/spec-nope', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects writes on virtual entries with 403', async () => {
    await seedCorpus();
    const idxRes = await req('/api/wiki?type=issue');
    const { entries } = (await idxRes.json()) as { entries: WikiEntry[] };
    expect(entries.length).toBeGreaterThan(0);
    const virtualId = entries[0].id;
    const res = await req(`/api/wiki/${virtualId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/wiki/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/wiki/:id', () => {
  it('removes an existing spec', async () => {
    await seed('specs/gone.md', `---\ntitle: Gone\n---\n# Gone`);
    const res = await req('/api/wiki/spec-gone', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const getRes = await req('/api/wiki/spec-gone');
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await req('/api/wiki/spec-nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('rejects deleting virtual entries with 403', async () => {
    await seedCorpus();
    const idxRes = await req('/api/wiki?type=issue');
    const { entries } = (await idxRes.json()) as { entries: WikiEntry[] };
    const virtualId = entries[0].id;
    const res = await req(`/api/wiki/${virtualId}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Workspace switch — indexer rebinds
// ---------------------------------------------------------------------------

describe('workspace:switched', () => {
  it('rebinds indexer to new workflow root', async () => {
    const originalRoot = workflowRoot;
    await seed('specs/a.md', `---\ntitle: A\n---\n# A`);
    const res1 = await req('/api/wiki?type=spec');
    const body1 = (await res1.json()) as { entries: WikiEntry[] };
    expect(body1.entries.map((e) => e.id)).toContain('spec-a');

    const newRoot = join(
      tmpdir(),
      `wiki-int-switch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    await mkdir(join(newRoot, 'specs'), { recursive: true });
    await writeFile(
      join(newRoot, 'specs', 'b.md'),
      `---\ntitle: B\n---\n# B`,
      'utf-8',
    );

    try {
      // Mutate the closure-backed binding then emit the switch event
      workflowRoot = newRoot;
      bus.emit('workspace:switched', { workspace: newRoot });

      const res2 = await req('/api/wiki?type=spec');
      const body2 = (await res2.json()) as { entries: WikiEntry[] };
      const ids = body2.entries.map((e) => e.id);
      expect(ids).toContain('spec-b');
      expect(ids).not.toContain('spec-a');
    } finally {
      await rm(newRoot, { recursive: true, force: true, maxRetries: 3 });
      await rm(originalRoot, { recursive: true, force: true, maxRetries: 3 });
      // Restore so afterEach's rm is a no-op
      workflowRoot = newRoot;
    }
  });
});
