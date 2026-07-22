import { describe, it, expect, vi } from 'vitest';
import { mergeCodeSearchResults, parseQuery } from '../query/search.js';
import type { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode, UnifiedSearchResult } from '../db/types.js';
import type { VectorSearchResult } from '../embedding/code-embedding.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, name = id): UnifiedNode {
  return {
    id,
    kind: 'function',
    name,
    qualifiedName: `mod.${name}`,
    filePath: `src/${id}.ts`,
    language: 'typescript',
    startLine: 1,
    endLine: 2,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: '',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'code',
    definition: '',
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: '',
    body: '',
    metadata: {},
    updatedAt: 0,
  } as UnifiedNode;
}

function fts(id: string, score: number): UnifiedSearchResult {
  return { node: makeNode(id), score, matchReason: { kind: 'direct', field: 'name' } };
}

function vec(nodeId: string, score: number): VectorSearchResult {
  return { nodeId, score };
}

function mockQueries(nodeMap: Map<string, UnifiedNode>): KgQueryBuilder {
  return {
    getNodesByIds: vi.fn((ids: string[]) => {
      const out = new Map<string, UnifiedNode>();
      for (const id of ids) {
        const n = nodeMap.get(id);
        if (n) out.set(id, n);
      }
      return out;
    }),
  } as unknown as KgQueryBuilder;
}

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

describe('parseQuery', () => {
  it('extracts kind: qualifier and free text', () => {
    const q = parseQuery('kind:function TenantService');
    expect(q.kinds).toEqual(['function']);
    expect(q.text).toBe('TenantService');
  });

  it('extracts lang/path/source qualifiers', () => {
    const q = parseQuery('lang:typescript path:src/auth source:code login');
    expect(q.languages).toEqual(['typescript']);
    expect(q.pathFilters).toEqual(['src/auth']);
    expect(q.sourceTypes).toEqual(['code']);
    expect(q.text).toBe('login');
  });

  it('treats everything as text when no qualifiers present', () => {
    const q = parseQuery('find user service');
    expect(q.text).toBe('find user service');
    expect(q.kinds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeCodeSearchResults — RRF fusion
// ---------------------------------------------------------------------------

describe('mergeCodeSearchResults', () => {
  it('returns empty array for empty inputs', () => {
    const q = mockQueries(new Map());
    expect(mergeCodeSearchResults([], [], q, 10)).toEqual([]);
  });

  it('fuses a node present in both FTS and vector lists to the top score', () => {
    const nodeB = makeNode('b');
    const q = mockQueries(new Map([['b', nodeB]]));

    const ftsResults = [fts('a', 5.0)];
    const vecResults = [vec('a', 0.9), vec('b', 0.8)];

    const merged = mergeCodeSearchResults(ftsResults, vecResults, q, 10);

    // 'a' appears in both lists → highest fused score, normalized to 1.0.
    expect(merged[0].node.id).toBe('a');
    expect(merged[0].score).toBeCloseTo(1.0, 5);
    // 'a' keeps its FTS matchReason (direct), not vector.
    expect(merged[0].matchReason.kind).toBe('direct');

    // 'b' is vector-only → resolved via DB lookup with vector matchReason.
    const bHit = merged.find((r) => r.node.id === 'b');
    expect(bHit).toBeDefined();
    expect(bHit!.matchReason.kind).toBe('vector');
    expect(bHit!.score).toBeLessThan(merged[0].score);

    // getNodesByIds called only for vector-only ids (not 'a', which is in FTS).
    expect(q.getNodesByIds).toHaveBeenCalledWith(['b']);
  });

  it('orders results by descending fused score', () => {
    const q = mockQueries(new Map([['b', makeNode('b')], ['c', makeNode('c')]]));
    const ftsResults = [fts('a', 5.0), fts('c', 1.0)];
    const vecResults = [vec('b', 0.9)];

    const merged = mergeCodeSearchResults(ftsResults, vecResults, q, 10);

    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
    }
  });

  it('respects the limit when trimming the RRF candidate pool', () => {
    const ftsResults = Array.from({ length: 20 }, (_, i) => fts(`n${i}`, 20 - i));
    const q = mockQueries(new Map());
    const merged = mergeCodeSearchResults(ftsResults, [], q, 5);
    // Candidate pool is limit*3 before final sort; output cannot exceed it.
    expect(merged.length).toBeLessThanOrEqual(15);
    expect(merged.length).toBeGreaterThan(0);
  });
});
