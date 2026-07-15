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

describe('virtual adapters: run-mode sessions', () => {
  const SESSION_ID = '20260713-search';
  const SESSION_ENTRY_ID = 'session-20260713-search';
  const DEBUG_RUN_ID = 'RUN-002';
  const ANALYZE_RUN_ID = 'RUN-005';
  const REVIEW_RUN_ID = 'RUN-010';
  const DRAFT_RUN_ID = 'RUN-007';

  const runEntryId = (runId: string): string => `session-run-20260713-search-${runId.toLowerCase()}`;

  function v11Run(
    runId: string,
    command: string,
    status: 'running' | 'sealed',
    primary: string | null,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema_version: 'run/1.1',
      run_id: runId,
      parent_run_id: null,
      command,
      status,
      goal: null,
      input: { args: [], consumes: [] },
      gates: [],
      primary,
      handoff: null,
      started_at: '2026-07-13T00:00:00.000Z',
      ended_at: status === 'sealed' ? '2026-07-13T01:00:00.000Z' : null,
      ...overrides,
    };
  }

  async function writeRunModeFixture(sessionStatus: 'running' | 'sealed' | 'archived' = 'sealed'): Promise<void> {
    await write('specs/run-indexing-rule.md', [
      '---',
      'title: Run indexing rule',
      'status: active',
      'category: coding',
      `sourceRef: "${SESSION_ID}/${REVIEW_RUN_ID}"`,
      '---',
      '# Run indexing rule',
      'A promoted rule with session provenance.',
    ].join('\n'));

    await write('sessions/20260713-search/session.json', JSON.stringify({
      schema_version: 'session/1.1',
      session_id: SESSION_ID,
      intent: 'Optimize Maestro Search indexing',
      status: sessionStatus,
      revision: 7,
      active_run_id: sessionStatus === 'running' ? DRAFT_RUN_ID : null,
      boundary_contract: {
        in_scope: ['wiki index'], out_of_scope: [], constraints: [], definition_of_done: 'Searchable sealed Runs',
      },
      gates: [],
      orchestration: {
        engine: 'manual', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [],
      },
      requests: [],
      lifecycle: {
        sealed_at: sessionStatus === 'running' ? null : '2026-07-13T02:00:00.000Z',
        seal_summary: 'Session seal fallback summary',
        promoted: sessionStatus === 'running' ? [] : ['spec:project:run-indexing-rule'],
        forked_from: null,
      },
    }));
    await write('sessions/20260713-search/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.1',
      artifacts: {
        'ART-debug-notes': {
          kind: 'notes', role: 'attachment', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/notes.json', hash: '0'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-diagnosis': {
          kind: 'diagnosis', role: 'primary', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/diagnosis.json', hash: 'a'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-analysis': {
          kind: 'findings', role: 'primary', run_id: ANALYZE_RUN_ID,
          path: 'runs/20260713-005-analyze/outputs/findings.json', hash: 'b'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-review': {
          kind: 'review-findings', role: 'primary', run_id: REVIEW_RUN_ID,
          path: 'runs/20260713-010-review/outputs/review-findings.json', hash: 'c'.repeat(64),
          status: 'sealed', replaces: null,
        },
        'ART-draft': {
          kind: 'draft-notes', role: 'attachment', run_id: DEBUG_RUN_ID,
          path: 'runs/20260713-002-debug/outputs/draft-notes.json', hash: 'd'.repeat(64),
          status: 'draft', replaces: null,
        },
        'ART-running': {
          kind: 'running-output', role: 'primary', run_id: DRAFT_RUN_ID,
          path: 'runs/20260713-007-test/outputs/running-output.json', hash: 'e'.repeat(64),
          status: 'sealed', replaces: null,
        },
      },
      aliases: {
        'latest-debug': 'ART-diagnosis',
        'current-analysis': 'ART-analysis',
        'latest-review': 'ART-review',
        'draft-notes': 'ART-draft',
      },
    }));

    // Write Run directories in reverse sequence order. The adapter must choose
    // the latest sealed Run by the NNN directory sequence, not readdir order.
    await write('sessions/20260713-search/runs/20260713-010-review/run.json', JSON.stringify(v11Run(
      REVIEW_RUN_ID,
      'quality-review',
      'sealed',
      'ART-review',
      {
        gates: [
          { id: 'GATE-010-01', title: 'Legacy browser proof', blocking: false, status: 'waived', check: { type: 'manual', prompt: 'Verify browser' }, waiver: 'CI has no browser (qa-bot @ 2026-07-13)' },
          { id: 'GATE-010-02', title: 'Unit tests', blocking: true, status: 'passed', check: { type: 'command', argv: ['npm', 'test'], expect_exit: 0 }, waiver: null },
        ],
        handoff: {
          verdict: 'ready_with_concerns', summary: 'Review handoff fallback', constraints: [], decisions: [],
          concerns: [], artifact_refs: ['ART-review'], next: [],
        },
        started_at: '2026-07-13T01:30:00.000Z', ended_at: '2026-07-13T02:00:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-010-review/outputs/review-findings.json', JSON.stringify({
      summary: 'Latest review artifact summary', findings: [{ severity: 'low', title: 'No regression' }],
    }));
    await write('sessions/20260713-search/runs/20260713-010-review/report.md', [
      '---',
      'summary: Review projection fallback',
      '---',
      'Inline producer reference {{aref:latest-debug#/diagnosis/0/summary}}.',
      'Unknown reference {{aref:missing-alias#/ignored}}.',
      '',
      '```aref',
      'source: ART-analysis',
      'pointer: /findings',
      'as: table',
      '```',
      '',
      '```aref',
      'source: draft-notes',
      'pointer: /notes',
      'as: list',
      '```',
    ].join('\n'));

    await write('sessions/20260713-search/runs/20260713-005-analyze/run.json', JSON.stringify(v11Run(
      ANALYZE_RUN_ID,
      'analyze',
      'sealed',
      'ART-analysis',
      {
        handoff: {
          verdict: 'ready', summary: 'Analysis handoff fallback', constraints: [], decisions: [],
          concerns: [], artifact_refs: ['ART-analysis'], next: [],
        },
        started_at: '2026-07-13T01:00:00.000Z', ended_at: '2026-07-13T01:20:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-005-analyze/outputs/findings.json', JSON.stringify({
      summary: 'Analysis artifact summary', findings: [{ summary: 'Intermediate evidence' }],
    }));

    await write('sessions/20260713-search/runs/20260713-002-debug/run.json', JSON.stringify(v11Run(
      DEBUG_RUN_ID,
      'quality-debug',
      'sealed',
      'ART-diagnosis',
      {
        handoff: {
          verdict: 'ready',
          summary: 'Debug handoff fallback',
          constraints: [
            { text: 'Preserve locked search semantics', status: 'locked' },
            { text: 'Explore optional telemetry', status: 'open' },
          ],
          decisions: [
            { text: 'Adopt zephyrdecisionneedle for exact discovery', status: 'accepted' },
            { text: 'Discard rejecteddecisionneedle entirely', status: 'rejected' },
          ],
          concerns: ['Embedding fallback remains observable'],
          artifact_refs: ['ART-diagnosis'],
          next: [],
        },
        started_at: '2026-07-13T00:10:00.000Z', ended_at: '2026-07-13T00:40:00.000Z',
      },
    )));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/diagnosis.json', JSON.stringify({
      summary: 'Typed diagnosis is the preferred summary', diagnosis: [{ summary: 'Nested diagnosis evidence' }],
    }));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/notes.json', JSON.stringify({
      summary: 'Secondary attachment must not replace the primary summary',
    }));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/draft-notes.json', JSON.stringify({
      summary: 'MUST NOT INDEX DRAFT ARTIFACT',
    }));

    await write('sessions/20260713-search/runs/20260713-007-test/run.json', JSON.stringify(v11Run(
      DRAFT_RUN_ID,
      'quality-test',
      'running',
      'ART-running',
      { started_at: '2026-07-13T01:25:00.000Z' },
    )));
    await write('sessions/20260713-search/runs/20260713-007-test/outputs/running-output.json', JSON.stringify({
      summary: 'MUST NOT INDEX RUNNING RUN',
    }));
  }

  async function writeCategoryFixture(): Promise<Map<string, string>> {
    const cases = new Map<string, string>([
      ['grill', 'arch'], ['maestro-grill', 'arch'],
      ['brainstorm', 'arch'], ['maestro-brainstorm', 'arch'],
      ['blueprint', 'arch'], ['maestro-blueprint', 'arch'],
      ['roadmap', 'arch'], ['maestro-roadmap', 'arch'],
      ['analyze', 'arch'], ['maestro-analyze', 'arch'],
      ['plan', 'coding'], ['maestro-plan', 'coding'],
      ['execute', 'coding'], ['maestro-execute', 'coding'],
      ['verify', 'review'], ['review', 'review'], ['quality-review', 'review'],
      ['test', 'test'], ['quality-test', 'test'], ['auto-test', 'test'], ['quality-auto-test', 'test'],
      ['debug', 'debug'], ['quality-debug', 'debug'],
      ['retrospective', 'learning'], ['quality-retrospective', 'learning'],
    ]);
    await write('sessions/category-map/session.json', JSON.stringify({
      schema_version: 'session/1.1', session_id: 'category-map', intent: 'Category mapping', status: 'sealed',
      revision: 1, active_run_id: null,
      boundary_contract: { in_scope: [], out_of_scope: [], constraints: [], definition_of_done: 'All categories mapped' },
      gates: [], orchestration: { engine: 'manual', quality_mode: 'standard', auto_mode: false, chain: [], decision_points: [] },
      requests: [], lifecycle: { sealed_at: '2026-07-13T03:00:00.000Z', seal_summary: null, promoted: [], forked_from: null },
    }));
    await write('sessions/category-map/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.1', artifacts: {}, aliases: {},
    }));
    let sequence = 1;
    for (const command of cases.keys()) {
      const seq = String(sequence).padStart(3, '0');
      const runId = `RUN-CAT-${seq}`;
      await write(`sessions/category-map/runs/20260713-${seq}-${command}/run.json`, JSON.stringify(v11Run(
        runId, command, 'sealed', null, { ended_at: `2026-07-13T03:${seq.slice(-2)}:00.000Z` },
      )));
      sequence++;
    }
    return cases;
  }

  it('indexes v1.1 sealed Runs with structured handoff, kinds, provenance, aref edges, and waivers', async () => {
    await writeRunModeFixture();
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();

    const session = index.byId[SESSION_ENTRY_ID];
    const debugRun = index.byId[runEntryId(DEBUG_RUN_ID)];
    const analyzeRun = index.byId[runEntryId(ANALYZE_RUN_ID)];
    const reviewRun = index.byId[runEntryId(REVIEW_RUN_ID)];
    const promotedSpec = index.byId['spec:project:run-indexing-rule'];
    expect(session).toBeDefined();
    expect(debugRun).toBeDefined();
    expect(analyzeRun).toBeDefined();
    expect(reviewRun).toBeDefined();
    expect(index.byId[runEntryId(DRAFT_RUN_ID)]).toBeUndefined();

    expect(session.summary).toBe('Latest review artifact summary');
    expect(session.related).toEqual(expect.arrayContaining([
      runEntryId(DEBUG_RUN_ID), runEntryId(ANALYZE_RUN_ID), runEntryId(REVIEW_RUN_ID),
      'spec:project:run-indexing-rule',
    ]));
    expect(promotedSpec.related).toContain(SESSION_ENTRY_ID);

    expect(debugRun.summary).toContain('Typed diagnosis is the preferred summary');
    expect(debugRun.summary).toContain('Adopt zephyrdecisionneedle for exact discovery');
    expect(debugRun.summary).not.toContain('rejecteddecisionneedle');
    expect(debugRun.body).toContain('## 决策');
    expect(debugRun.body).toContain('Adopt zephyrdecisionneedle for exact discovery');
    expect(debugRun.body).not.toContain('Discard rejecteddecisionneedle entirely');
    expect(debugRun.body).toContain('## 约束');
    expect(debugRun.body).toContain('Preserve locked search semantics');
    expect(debugRun.body).not.toContain('Explore optional telemetry');
    expect(debugRun.body).toContain('## 关注点');
    expect(debugRun.body).toContain('Embedding fallback remains observable');
    expect(debugRun.body).toContain('Nested diagnosis evidence');
    expect(debugRun.body).not.toContain('MUST NOT INDEX DRAFT ARTIFACT');
    expect(debugRun.tags).toEqual(expect.arrayContaining(['quality-debug', 'verdict:ready', 'constraint', 'diagnosis']));
    expect(debugRun.category).toBe('debug');
    expect(debugRun.ext.kinds).toEqual(['diagnosis', 'notes']);
    expect(debugRun.ext.artifactIds).toEqual(['ART-diagnosis', 'ART-debug-notes']);

    expect(analyzeRun.category).toBe('arch');
    expect(analyzeRun.ext.kinds).toEqual(['findings']);
    expect(reviewRun.category).toBe('review');
    expect(reviewRun.tags).toEqual(expect.arrayContaining(['verdict:ready_with_concerns', 'review-findings']));
    expect(reviewRun.ext.kinds).toEqual(['review-findings']);
    expect(reviewRun.ext.arefArtifactIds).toEqual(['ART-diagnosis', 'ART-analysis']);
    expect(reviewRun.related).toEqual(expect.arrayContaining([runEntryId(DEBUG_RUN_ID), runEntryId(ANALYZE_RUN_ID)]));
    expect(index.backlinks[runEntryId(DEBUG_RUN_ID)]).toContain(runEntryId(REVIEW_RUN_ID));
    expect(index.backlinks[runEntryId(ANALYZE_RUN_ID)]).toContain(runEntryId(REVIEW_RUN_ID));
    expect(reviewRun.body).toContain('## 豁免');
    expect(reviewRun.body).toContain('Legacy browser proof');
    expect(reviewRun.body).toContain('CI has no browser');
    expect(reviewRun.body).not.toContain('Unit tests');
    expect(reviewRun.source.path).toBe('sessions/20260713-search/runs/20260713-010-review/run.json');
  });

  it('finds a Run by an accepted decision-only term', async () => {
    await writeRunModeFixture();
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const result = await indexer.searchWithMeta('zephyrdecisionneedle', 10, { skipEmbedding: true });
    expect(result.results.map(item => item.entry.id)).toContain(runEntryId(DEBUG_RUN_ID));
    expect(result.results[0]?.entry.id).toBe(runEntryId(DEBUG_RUN_ID));
  });

  it('maps every supported Run command to its search category', async () => {
    const cases = await writeCategoryFixture();
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    for (const [command, category] of cases) {
      const entry = index.entries.find(item => item.ext.virtualKind === 'session-run' && item.ext.command === command);
      expect(entry?.category, command).toBe(category);
    }
  });

  it('skips an unsealed session even when a child run claims sealed', async () => {
    await writeRunModeFixture('running');
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.entries.filter(e => e.source.path.startsWith('sessions/'))).toEqual([]);
  });

  it('skips a sealed session with an unsupported artifact registry instead of indexing empty Run shells', async () => {
    await writeRunModeFixture();
    await write('sessions/20260713-search/artifacts.json', JSON.stringify({
      schema_version: 'artifacts/1.0', artifacts: {}, aliases: {},
    }));

    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.entries.filter(e => e.source.path.startsWith('sessions/'))).toEqual([]);
  });

  it('preserves archived lifecycle status', async () => {
    await writeRunModeFixture('archived');
    const index = await new WikiIndexer({ workflowRoot: tmpRoot }).get();
    expect(index.byId['session-20260713-search'].status).toBe('archived');
  });

  it('invalidates the cached index when a nested session artifact changes in place', async () => {
    await writeRunModeFixture();
    const indexer = new WikiIndexer({ workflowRoot: tmpRoot });
    const first = await indexer.get();
    expect(first.byId[runEntryId(DEBUG_RUN_ID)].summary).toContain('preferred');

    await new Promise(resolve => setTimeout(resolve, 20));
    await write('sessions/20260713-search/runs/20260713-002-debug/outputs/diagnosis.json', JSON.stringify({
      summary: 'Updated nested diagnosis summary',
    }));
    const refreshed = await indexer.get();
    expect(refreshed.byId[runEntryId(DEBUG_RUN_ID)].summary).toContain('Updated nested diagnosis summary');
  });
});
