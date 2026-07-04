import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WikiIndexer } from './wiki-indexer.js';
import { buildGraph, detectOrphans, detectHubs, computeHealth } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, tokenize } from './search.js';
import { WikiWriter, WikiWriteError } from './writer.js';

let tmpRoot: string;

async function write(rel: string, body: string): Promise<void> {
  const abs = join(tmpRoot, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf-8');
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wiki-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
});

describe('WikiIndexer', () => {
  it('indexes files across workflow subtrees', async () => {
    await write(
      'project.md',
      `---\ntitle: Project\n---\n# Project\nBody`,
    );
    await write(
      'specs/one.md',
      `---\ntitle: Spec One\ntags:\n  - auth\n---\n# Spec One\nAbout [[Spec Two]]`,
    );
    await write(
      'specs/two.md',
      `---\ntitle: Spec Two\n---\n# Spec Two\nRefs [[Spec One]]`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const ids = index.entries.map((d) => d.id).sort();
    expect(ids).toContain('spec:project:one');
    expect(ids).toContain('spec:project:two');
    expect(index.byId['spec:project:one'].tags).toEqual(['auth']);
    expect(index.backlinks['spec:project:one']).toContain('spec:project:two');
    expect(index.backlinks['spec:project:two']).toContain('spec:project:one');
  });

  it('filters by type and tag', async () => {
    await write('specs/a.md', `---\ntitle: A\ntags:\n  - x\n---\n# A`);
    await write('specs/b.md', `---\ntitle: B\ntags:\n  - y\n---\n# B`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const xTagged = await indexer.query({ type: 'spec', tag: 'x' });
    expect(xTagged.map((d) => d.id)).toEqual(['spec:project:a']);
  });
});

describe('WikiIndexer ref links keep knowhow type prefix', () => {
  it('spec-entry ref resolves to the prefixed container id (no broken link)', async () => {
    // Container id keeps the prefix: knowhow-rcp-... — the ref target must match.
    await write(
      'knowhow/RCP-stripe-min-amount-stripe-minimum-guard.md',
      `---\ntitle: Stripe minimum guard\n---\n# Stripe minimum guard\nBody`,
    );
    // QRF is not in the old strip-list — used to coincidentally work; must stay correct.
    await write(
      'knowhow/QRF-linked-listings-fast-path.md',
      `---\ntitle: Linked listings fast path\n---\n# Linked listings\nBody`,
    );
    await write(
      'specs/payments.md',
      `---\ntitle: Payments\n---\n# Payments\n\n` +
        `<spec-entry title="Stripe min amount guard" type="coding" ` +
        `ref="knowhow/RCP-stripe-min-amount-stripe-minimum-guard.md">\n` +
        `### Stripe min amount guard\nEnforce Stripe minimum charge amount.\n</spec-entry>\n\n` +
        `<spec-entry title="Linked listings fast path" type="coding" ` +
        `ref="knowhow/QRF-linked-listings-fast-path.md">\n` +
        `### Linked listings fast path\nFast path for linked listings.\n</spec-entry>\n`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const rcpSub = index.entries.find((e) => e.type === 'spec' && e.title === 'Stripe min amount guard');
    expect(rcpSub?.related).toContain('knowhow-rcp-stripe-min-amount-stripe-minimum-guard');
    expect(index.byId['knowhow-rcp-stripe-min-amount-stripe-minimum-guard']).toBeDefined();

    const qrfSub = index.entries.find((e) => e.type === 'spec' && e.title === 'Linked listings fast path');
    expect(qrfSub?.related).toContain('knowhow-qrf-linked-listings-fast-path');
    expect(index.byId['knowhow-qrf-linked-listings-fast-path']).toBeDefined();

    const broken = buildGraph(index).brokenLinks.map((b) => b.target);
    expect(broken).not.toContain('knowhow-stripe-min-amount-stripe-minimum-guard');
    expect(broken).not.toContain('knowhow-rcp-stripe-min-amount-stripe-minimum-guard');
    expect(broken).not.toContain('knowhow-qrf-linked-listings-fast-path');
  });

  it('knowhow-entry ref resolves to the prefixed container id (no broken link)', async () => {
    await write(
      'knowhow/REF-payment-architecture.md',
      `---\ntitle: Payment architecture\n---\n# Payment architecture\nBody`,
    );
    await write(
      'knowhow/KNW-session-notes.md',
      `---\ntitle: Session notes\n---\n# Session notes\n\n` +
        `<knowhow-entry title="See payment arch" type="reference" ` +
        `ref="knowhow/REF-payment-architecture.md">\n` +
        `### See payment arch\nRelated reference.\n</knowhow-entry>\n`,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();

    const sub = index.entries.find((e) => e.title === 'See payment arch');
    expect(sub?.related).toContain('knowhow-ref-payment-architecture');
    expect(index.byId['knowhow-ref-payment-architecture']).toBeDefined();

    const broken = buildGraph(index).brokenLinks.map((b) => b.target);
    expect(broken).not.toContain('knowhow-payment-architecture');
    expect(broken).not.toContain('knowhow-ref-payment-architecture');
  });
});

describe('graph-analysis', () => {
  it('detects orphans as entries with no in and no out edges', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\nLinks [[B]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B`);
    await write('specs/c.md', `---\ntitle: C\n---\n# C`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const orphans = detectOrphans(graph, index.entries);

    expect(orphans).toContain('spec:project:c');
    expect(orphans).not.toContain('spec:project:a');
    expect(orphans).not.toContain('spec:project:b');
  });

  it('reports broken links', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[does-not-exist]]`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    expect(graph.brokenLinks).toEqual(
      expect.arrayContaining([{ sourceId: 'spec:project:a', target: 'does-not-exist' }]),
    );
  });

  it('ranks hubs by incoming link count', async () => {
    await write('specs/hub.md', `---\ntitle: Hub\n---\n# Hub`);
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[Hub]]`);
    await write('specs/b.md', `---\ntitle: B\n---\n# B\n[[Hub]]`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const hubs = detectHubs(graph, 5);
    expect(hubs[0]).toEqual({ id: 'spec:project:hub', inDegree: 2 });
  });

  it('computes health score with penalties', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A\n[[missing]]`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const graph = buildGraph(index);
    const health = computeHealth(index, graph);
    expect(health.score).toBeLessThan(100);
    expect(health.totals.brokenLinks).toBe(1);
  });
});

describe('search (BM25)', () => {
  it('tokenizes lowercase and drops stop words', () => {
    expect(tokenize('The Quick Brown Fox')).toEqual(['quick', 'brown', 'fox']);
  });

  it('ranks exact title match first', async () => {
    await write('specs/auth.md', `---\ntitle: Authentication Guide\n---\n# Auth\nJWT bearer tokens`);
    await write('specs/misc.md', `---\ntitle: Misc\n---\n# Misc\nNothing about auth here`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    const results = searchBM25(inv, 'authentication');
    expect(results[0].docId).toBe('spec:project:auth');
  });

  it('returns empty for stop-word-only query', async () => {
    await write('specs/a.md', `---\ntitle: A\n---\n# A`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    expect(searchBM25(inv, 'the and or')).toEqual([]);
  });

  it('emits CJK 2/3-grams', () => {
    const tokens = tokenize('用户认证');
    // 2-grams: 用户, 户认, 认证 ; 3-grams: 用户认, 户认证
    expect(tokens).toEqual(expect.arrayContaining(['用户', '户认', '认证', '用户认', '户认证']));
    // No 4-gram explosion
    expect(tokens.every((t) => t.length <= 3)).toBe(true);
  });

  it('mixed CJK + Latin tokenization', () => {
    const tokens = tokenize('用户auth流程');
    expect(tokens).toEqual(expect.arrayContaining(['用户', 'auth', '流程']));
  });

  it('CJK BM25 matches partial substrings (regression: previously failed)', async () => {
    await write('specs/auth.md', `---\ntitle: 用户认证流程\n---\n# 认证\n关于用户的 JWT 认证`);
    await write('specs/misc.md', `---\ntitle: 杂项\n---\n# 杂项\n无关内容`);

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const inv = buildInvertedIndex(index.entries);
    const results = searchBM25(inv, '认证');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toContain('auth');
  });
});

describe('WikiWriter', () => {
  it('creates a new spec markdown file', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.create({
      type: 'spec',
      slug: 'new-spec',
      title: 'Fresh Spec',
      body: '# Fresh Spec\nHello',
    });
    expect(entry.id).toBe('spec:project:new-spec');
    expect(entry.source.path).toBe('specs/new-spec.md');
  });

  it('rejects slug with traversal attempts', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(
      writer.create({
        type: 'spec',
        slug: '../../../etc/hosts',
        title: 'evil',
        body: 'x',
      }),
    ).rejects.toThrow(WikiWriteError);
  });

  it('returns 409 on stale expectedHash', async () => {
    // Use knowhow path for body-update hash test (spec body updates are blocked)
    await write('knowhow/KNW-s.md', `---\ntitle: S\n---\n# S\norig`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    try {
      await writer.update('knowhow-knw-s', {
        body: 'updated',
        expectedHash: 'deadbeef',
      });
      expect.fail('expected CONFLICT');
    } catch (err) {
      expect(err).toBeInstanceOf(WikiWriteError);
      expect((err as WikiWriteError).code).toBe('CONFLICT');
    }
  });

  it('updates existing entry preserving frontmatter', async () => {
    // Use knowhow path for body-update test (spec body updates are blocked)
    await write('knowhow/KNW-s.md', `---\ntitle: Old\ntags:\n  - a\n---\n# Old\nbody`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    const entry = await writer.update('knowhow-knw-s', {
      title: 'New',
      body: 'new body',
    });
    expect(entry.title).toBe('New');
    expect(entry.tags).toEqual(['a']);
  });

  it('removes an existing spec file', async () => {
    await write('specs/gone.md', `---\ntitle: Gone\n---\n# Gone`);
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const writer = new WikiWriter(tmpRoot, indexer);
    await writer.remove('spec:project:gone');
    const index = await indexer.get();
    expect(index.byId['spec:project:gone']).toBeUndefined();
  });

  it('rejects writes on virtual entries', async () => {
    await mkdir(join(tmpRoot, 'issues'), { recursive: true });
    await writeFile(
      join(tmpRoot, 'issues', 'current.jsonl'),
      JSON.stringify({ id: 'I1', title: 'Test Issue', status: 'open' }) + '\n',
      'utf-8',
    );
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const virtualId = index.entries.find((d) => d.source.kind === 'virtual')?.id;
    expect(virtualId).toBeDefined();
    const writer = new WikiWriter(tmpRoot, indexer);
    await expect(writer.update(virtualId!, { body: 'x' })).rejects.toThrow(WikiWriteError);
  });
});

describe('virtual adapters: codebase doc-index', () => {
  it('emits component / feature / requirement / ADR virtual entries with stable ids', async () => {
    await write(
      'codebase/doc-index.json',
      JSON.stringify({
        version: '1.0',
        project: 'test',
        last_updated: '2026-05-24T00:00:00.000Z',
        components: [
          { id: 'TC-001', name: 'AuthService', type: 'service', code_locations: ['src/auth/service.ts'], feature_ids: ['FT-001'], symbols: ['login', 'logout'] },
        ],
        features: [
          { id: 'FT-001', name: 'Authentication', status: 'active', component_ids: ['TC-001'], requirement_ids: ['REQ-001'], phase: null },
        ],
        requirements: [
          { id: 'REQ-001', title: 'User login', priority: 'must', feature_id: 'FT-001', status: 'pending', acceptance_criteria: ['Returns JWT'] },
        ],
        architecture_decisions: [
          { id: 'ADR-001', title: 'Use JWT', component_ids: ['TC-001'], decision: 'Adopt JWT', rationale: 'Stateless' },
        ],
      }),
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const ids = index.entries.map((d) => d.id);

    expect(ids).toContain('codebase-comp-tc-001');
    expect(ids).toContain('codebase-feat-ft-001');
    expect(ids).toContain('codebase-req-req-001');
    expect(ids).toContain('codebase-adr-adr-001');

    const comp = index.byId['codebase-comp-tc-001'];
    expect(comp.type).toBe('knowhow');
    expect(comp.category).toBe('arch');
    expect(comp.source.kind).toBe('virtual');
    expect(comp.source.path).toBe('codebase/tech-registry/authservice.md');
    expect(comp.related).toContain('codebase-feat-ft-001');

    const req = index.byId['codebase-req-req-001'];
    expect(req.category).toBe('review');
    expect(req.parent).toBe('codebase-feat-ft-001');

    // Backlink: ADR → component via related[]
    expect(index.backlinks['codebase-comp-tc-001']).toContain('codebase-adr-adr-001');
  });

  it('survives missing doc-index.json silently', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('codebase-'))).toEqual([]);
  });

  it('survives malformed doc-index.json without throwing', async () => {
    await write('codebase/doc-index.json', 'not json');
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('codebase-'))).toEqual([]);
  });
});

describe('virtual adapters: session archive', () => {
  async function writeSession(
    location: 'scratch' | 'milestone',
    sessionDir: string,
    archive: object,
    contextPackage: object | null = null,
    milestone = 'M1',
  ): Promise<void> {
    const base = location === 'scratch'
      ? `scratch/${sessionDir}`
      : `milestones/${milestone}/artifacts/${sessionDir}`;
    await write(`${base}/archive.json`, JSON.stringify(archive));
    if (contextPackage !== null) {
      await write(`${base}/context-package.json`, JSON.stringify(contextPackage));
    }
  }

  it('skips active sessions (strategy 2: only sealed/archived enter index)', async () => {
    await writeSession('scratch', '20260520-analyze-auth', {
      $schema: 'session-archive/1.0',
      session_id: 'ANL-007',
      session_type: 'analyze',
      lifecycle: { status: 'active' },
    });

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('session-'))).toEqual([]);
  });

  it('treats missing archive.json as not-yet-sealed (legacy/active → skip)', async () => {
    await write('scratch/20260101-legacy/context-package.json', JSON.stringify({
      source: { type: 'brainstorm', artifact_id: 'BRN-legacy' },
    }));

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('session-'))).toEqual([]);
  });

  it('emits sealed session from scratch (no milestone required)', async () => {
    await writeSession(
      'scratch',
      '20260524-blueprint-payments',
      {
        $schema: 'session-archive/1.0',
        session_id: 'BLP-payments-2026-05-24',
        session_type: 'blueprint',
        session_path: 'scratch/20260524-blueprint-payments',
        lifecycle: { status: 'sealed', sealed_at: '2026-05-24T12:00:00.000Z', archived_at: null, linked_milestone: null },
        content_refs: [
          { type: 'context-package', path: 'context-package.json' },
          { type: 'brief', path: 'product-brief.md' },
        ],
        pruned: null,
      },
      {
        domain: { problem_statement: 'Design payment gateway architecture' },
        insights: [{ role: 'analyzer', area: 'security', summary: 'PCI-DSS scope minimization' }],
        constraints: [{ id: 'C-001', area: 'compliance', constraint: 'PCI-DSS L1', status: 'locked' }],
        open_questions: [{ area: 'fraud', question: 'In-house vs third-party?' }],
      },
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const entry = index.byId['session-blueprint-blp-payments-2026-05-24'];

    expect(entry).toBeDefined();
    expect(entry.type).toBe('knowhow');
    expect(entry.status).toBe('completed');
    expect(entry.category).toBe('arch');
    expect(entry.source.path).toBe('scratch/20260524-blueprint-payments/archive.json');
    expect(entry.tags).toEqual(expect.arrayContaining(['session', 'sealed', 'blueprint', 'compliance']));
    expect(entry.summary).toContain('Design payment gateway');
    expect(entry.summary).toContain('1 insights');
    expect(entry.ext.virtualKind).toBe('session');
    expect(entry.ext.sessionType).toBe('blueprint');
    expect(entry.ext.lifecycleStatus).toBe('sealed');
  });

  it('still emits sealed session when context-package.json is absent', async () => {
    await writeSession(
      'scratch',
      '20260520-brainstorm-only',
      {
        $schema: 'session-archive/1.0',
        session_id: 'BRN-001',
        session_type: 'brainstorm',
        lifecycle: { status: 'sealed', sealed_at: '2026-05-20T00:00:00.000Z' },
        content_refs: [{ type: 'guidance', path: 'guidance-specification.md' }],
        pruned: null,
      },
      null,
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const entry = index.byId['session-brainstorm-brn-001'];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('completed');
    expect(entry.ext.insightCount).toBe(0);
  });

  it('emits archived session from milestones/{M}/artifacts/ with linked_milestone', async () => {
    await writeSession(
      'milestone',
      '20260301-analyze-auth',
      {
        $schema: 'session-archive/1.0',
        session_id: 'ANL-003',
        session_type: 'analyze',
        lifecycle: { status: 'archived', sealed_at: '2026-03-01T00:00:00.000Z', archived_at: '2026-03-31T00:00:00.000Z', linked_milestone: 'M1' },
        content_refs: [],
        pruned: null,
      },
      null,
      'M1',
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const entry = index.byId['session-analyze-anl-003'];

    expect(entry).toBeDefined();
    expect(entry.status).toBe('archived');
    expect(entry.category).toBe('arch');
    expect(entry.source.path).toBe('milestones/M1/artifacts/20260301-analyze-auth/archive.json');
    expect(entry.related).toContain('milestone-M1');
    expect(entry.ext.linkedMilestone).toBe('M1');
  });

  it('surfaces pruning metadata in summary', async () => {
    await writeSession(
      'milestone',
      '20260301-pruned',
      {
        $schema: 'session-archive/1.0',
        session_id: 'ANL-004',
        session_type: 'analyze',
        lifecycle: { status: 'archived', archived_at: '2026-03-31T00:00:00.000Z', linked_milestone: 'M1' },
        pruned: {
          at: '2026-03-31T00:00:00.000Z',
          counts: { open_questions: 3, constraints: 2, insights: 0, references: 1 },
          ref: 'context-package.pruned.json',
        },
      },
      null,
      'M1',
    );

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    const entry = index.byId['session-analyze-anl-004'];
    expect(entry).toBeDefined();
    expect(entry.summary).toContain('pruned: 6 items');
    expect((entry.ext.pruned as { ref: string }).ref).toBe('context-package.pruned.json');
  });

  it('routes session type to spec category (verify → review, plan → coding)', async () => {
    await writeSession('scratch', '20260520-verify-001', {
      $schema: 'session-archive/1.0',
      session_id: 'VRF-001',
      session_type: 'verify',
      lifecycle: { status: 'sealed' },
    });
    await writeSession('scratch', '20260520-plan-001', {
      $schema: 'session-archive/1.0',
      session_id: 'PLN-001',
      session_type: 'plan',
      lifecycle: { status: 'sealed' },
    });

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.byId['session-verify-vrf-001'].category).toBe('review');
    expect(index.byId['session-plan-pln-001'].category).toBe('coding');
  });

  it('survives missing scratch and milestones dirs', async () => {
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('session-'))).toEqual([]);
  });

  it('skips session dirs without archive.json', async () => {
    await mkdir(join(tmpRoot, 'scratch', '20260520-empty'), { recursive: true });
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('session-'))).toEqual([]);
  });

  it('survives malformed archive.json without throwing', async () => {
    await write('scratch/20260520-bad/archive.json', '{ not json');
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.entries.filter((d) => d.id.startsWith('session-'))).toEqual([]);
  });

  it('survives malformed context-package.json (still emits archive entry)', async () => {
    await writeSession('scratch', '20260520-half-bad', {
      $schema: 'session-archive/1.0',
      session_id: 'ANL-005',
      session_type: 'analyze',
      lifecycle: { status: 'sealed' },
    });
    await write('scratch/20260520-half-bad/context-package.json', '{ not json');

    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const index = await indexer.get();
    expect(index.byId['session-analyze-anl-005']).toBeDefined();
  });
});
