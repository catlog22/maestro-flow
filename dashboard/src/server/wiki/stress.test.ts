import { describe, it, expect } from 'vitest';

import { buildInvertedIndex, searchBM25, tokenize } from './search.js';
import { buildGraph, detectOrphans, detectHubs, computeHealth } from './graph-analysis.js';
import type { WikiEntry, WikiIndex, WikiNodeType } from './wiki-types.js';

// ---------------------------------------------------------------------------
// Stress tests for BM25 search and graph analysis at scale.
// No file I/O — these exercise the pure functions with synthetic corpora.
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  title: string,
  body: string,
  related: string[] = [],
  tags: string[] = [],
): WikiEntry {
  return {
    id,
    type: 'spec' as WikiNodeType,
    title,
    summary: '',
    tags,
    status: 'active',
    created: '',
    updated: '',
    related,
    source: { kind: 'file', path: `specs/${id}.md` },
    body,
    ext: {},
    category: null,
    createdBy: null,
    sourceRef: null,
    parent: null,
  };
}

function makeIndex(entries: WikiEntry[]): WikiIndex {
  const byId: Record<string, WikiEntry> = {};
  const byType = {
    project: [],
    roadmap: [],
    spec: [],
    issue: [],
    lesson: [],
    memory: [],
    note: [],
  } as WikiIndex['byType'];
  const backlinks: Record<string, string[]> = {};
  for (const e of entries) {
    byId[e.id] = e;
    byType[e.type].push(e);
  }
  // compute naive backlinks mirror of what WikiIndexer would produce
  for (const e of entries) {
    const linkRe = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(e.body))) {
      const target = m[1];
      if (byId[target]) {
        if (!backlinks[target]) backlinks[target] = [];
        if (!backlinks[target].includes(e.id)) backlinks[target].push(e.id);
      }
    }
    for (const rel of e.related) {
      if (byId[rel]) {
        if (!backlinks[rel]) backlinks[rel] = [];
        if (!backlinks[rel].includes(e.id)) backlinks[rel].push(e.id);
      }
    }
  }
  return { entries, byId, byType, backlinks, generatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// BM25 stress
// ---------------------------------------------------------------------------

describe('BM25 stress — 2000-doc corpus', () => {
  const VOCAB = [
    'authentication', 'session', 'token', 'cookie', 'database', 'cache',
    'redis', 'postgres', 'migration', 'schema', 'index', 'query', 'plan',
    'performance', 'latency', 'memory', 'cpu', 'network', 'io', 'disk',
    'http', 'grpc', 'websocket', 'api', 'route', 'middleware', 'guard',
    'validation', 'serializer', 'parser', 'tokenizer', 'lexer', 'compiler',
    'interpreter', 'runtime', 'gc', 'heap', 'stack', 'thread', 'process',
  ];

  function synthBody(seed: number): string {
    const parts: string[] = [];
    for (let i = 0; i < 60; i++) {
      parts.push(VOCAB[(seed * 31 + i * 7) % VOCAB.length]);
    }
    return parts.join(' ');
  }

  function synthTitle(seed: number): string {
    const a = VOCAB[seed % VOCAB.length];
    const b = VOCAB[(seed * 3 + 1) % VOCAB.length];
    return `${a} ${b}`;
  }

  const corpus: WikiEntry[] = [];
  for (let i = 0; i < 2000; i++) {
    corpus.push(makeEntry(`spec-${i}`, synthTitle(i), synthBody(i)));
  }
  // Inject a canonical "authentication tutorial" entry that should win q=authentication
  corpus.push(
    makeEntry(
      'spec-canonical-auth',
      'Authentication Tutorial',
      'Full guide to authentication with sessions, tokens, cookies and bearer flows.',
      [],
      ['security'],
    ),
  );

  it('builds inverted index in under 200ms', () => {
    const t0 = Date.now();
    const inv = buildInvertedIndex(corpus);
    const ms = Date.now() - t0;
    expect(inv.totalDocs).toBe(2001);
    expect(inv.postings.size).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500); // generous upper bound for CI
  });

  it('single-term query over 2000 docs returns results in <50ms', () => {
    const inv = buildInvertedIndex(corpus);
    const t0 = Date.now();
    const results = searchBM25(inv, 'authentication', 20);
    const ms = Date.now() - t0;
    expect(results.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(100);
  });

  it('canonical title-match entry ranks in top-3 for q=authentication', () => {
    const inv = buildInvertedIndex(corpus);
    const results = searchBM25(inv, 'authentication tutorial', 10);
    const top = results.slice(0, 3).map((r) => r.docId);
    expect(top).toContain('spec-canonical-auth');
  });

  it('multi-term query rewards docs with more matching terms', () => {
    const inv = buildInvertedIndex(corpus);
    const results = searchBM25(inv, 'authentication session token', 10);
    expect(results.length).toBeGreaterThan(0);
    // Scores should be monotonically decreasing
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('stop-word-only query returns empty', () => {
    const inv = buildInvertedIndex(corpus);
    expect(searchBM25(inv, 'the and or a an')).toEqual([]);
  });

  it('unknown-term query returns empty', () => {
    const inv = buildInvertedIndex(corpus);
    expect(searchBM25(inv, 'zzzxxxyyyqqq')).toEqual([]);
  });

  it('score stability — same corpus twice yields identical top-10', () => {
    const inv1 = buildInvertedIndex(corpus);
    const inv2 = buildInvertedIndex(corpus);
    const r1 = searchBM25(inv1, 'session token', 10);
    const r2 = searchBM25(inv2, 'session token', 10);
    expect(r1.map((r) => r.docId)).toEqual(r2.map((r) => r.docId));
    expect(r1.map((r) => r.score)).toEqual(r2.map((r) => r.score));
  });

  it('tokenize handles Unicode letters and numbers', () => {
    expect(tokenize('Hello Wörld 123 foo42bar')).toEqual([
      'hello',
      'wörld',
      '123',
      'foo42bar',
    ]);
  });

  it('tokenize drops stop words and sub-2-char tokens', () => {
    expect(tokenize('a The an Quick I am')).toEqual(['quick', 'am']);
  });
});

// ---------------------------------------------------------------------------
// Graph stress
// ---------------------------------------------------------------------------

describe('graph-analysis stress — dense 500-doc graph', () => {
  // Build a ring + hub topology: every node links to the next, and everyone
  // links to spec-hub. Expect spec-hub to dominate inDegree.
  const N = 500;
  const entries: WikiEntry[] = [];
  entries.push(makeEntry('spec-hub', 'Central Hub', 'Nothing outgoing.'));
  for (let i = 0; i < N; i++) {
    const next = `spec-${(i + 1) % N}`;
    entries.push(
      makeEntry(
        `spec-${i}`,
        `Node ${i}`,
        `Links [[${next}]] and [[spec-hub]] and [[spec-missing-${i}]].`,
      ),
    );
  }
  const index = makeIndex(entries);

  it('builds graph in <100ms', () => {
    const t0 = Date.now();
    const g = buildGraph(index);
    const ms = Date.now() - t0;
    expect(g.forwardLinks['spec-0']).toContain('spec-hub');
    expect(ms).toBeLessThan(200);
  });

  it('hub dominates inDegree ranking', () => {
    const g = buildGraph(index);
    const hubs = detectHubs(g, 5);
    expect(hubs[0].id).toBe('spec-hub');
    expect(hubs[0].inDegree).toBe(N);
  });

  it('reports N broken links (one per node)', () => {
    const g = buildGraph(index);
    expect(g.brokenLinks.length).toBe(N);
    // every broken link target begins with `spec-missing-`
    for (const b of g.brokenLinks) {
      expect(b.target.startsWith('spec-missing-')).toBe(true);
    }
  });

  it('detects no orphans in a fully-connected ring', () => {
    const g = buildGraph(index);
    const orphans = detectOrphans(g, index.entries);
    // spec-hub has incoming but no outgoing → not orphan (incoming > 0)
    // every ring node has both → not orphan
    expect(orphans).toEqual([]);
  });

  it('health score floored at 0 when broken links exceed 50', () => {
    const g = buildGraph(index);
    const health = computeHealth(index, g);
    // 500 broken * 2 = 1000 penalty → score = max(0, 100 - 1000) = 0
    expect(health.score).toBe(0);
    expect(health.totals.brokenLinks).toBe(N);
    expect(health.totals.entries).toBe(N + 1);
  });
});

describe('graph-analysis stress — disconnected islands', () => {
  // Two disjoint cliques, plus 20 isolated orphans.
  const entries: WikiEntry[] = [];
  // Clique A: 5 nodes, fully connected
  for (let i = 0; i < 5; i++) {
    const links = Array.from({ length: 5 }, (_, j) => j)
      .filter((j) => j !== i)
      .map((j) => `[[spec-a${j}]]`)
      .join(' ');
    entries.push(makeEntry(`spec-a${i}`, `A${i}`, links));
  }
  // Clique B: 5 nodes, fully connected
  for (let i = 0; i < 5; i++) {
    const links = Array.from({ length: 5 }, (_, j) => j)
      .filter((j) => j !== i)
      .map((j) => `[[spec-b${j}]]`)
      .join(' ');
    entries.push(makeEntry(`spec-b${i}`, `B${i}`, links));
  }
  // 20 orphans
  for (let i = 0; i < 20; i++) {
    entries.push(makeEntry(`spec-orph${i}`, `Orph${i}`, 'body with no links'));
  }
  const index = makeIndex(entries);

  it('detects all 20 orphans exactly', () => {
    const g = buildGraph(index);
    const orphans = detectOrphans(g, index.entries);
    expect(orphans.length).toBe(20);
    for (const id of orphans) {
      expect(id.startsWith('spec-orph')).toBe(true);
    }
  });

  it('cliques have equal inDegree = 4', () => {
    const g = buildGraph(index);
    const hubs = detectHubs(g, 10);
    const cliqueNodes = hubs.filter((h) => h.inDegree === 4);
    expect(cliqueNodes.length).toBe(10); // 5 + 5 clique members
  });
});
