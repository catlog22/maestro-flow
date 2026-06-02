import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { DatabaseConnection } from '../db/connection.js';
import { QueryBuilder } from '../db/queries.js';
import { GraphTraverser } from '../traversal.js';
import { GraphQueryManager } from '../graph-queries.js';
import { parseQuery, boundedEditDistance } from '../search/query-parser.js';
import {
  extractSearchTerms, getStemVariants, scorePathRelevance,
  nameMatchBonus, kindBonus, isTestFile, isGeneratedFile, STOP_WORDS,
} from '../search/query-utils.js';
import { computeFileHash, computeFileHashes, isFileTooLarge } from '../sync/content-hash.js';
import type { EnhancedNode, EnhancedEdge } from '../types.js';

const TEST_DIR = resolve('__test_tmp_graph__');
const DB_PATH = join(TEST_DIR, 'test.db');

function makeNode(overrides: Partial<EnhancedNode> & { id: string; name: string }): EnhancedNode {
  return {
    kind: 'function',
    qualifiedName: overrides.name,
    filePath: 'test.ts',
    language: 'typescript',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 0,
    docstring: '',
    signature: '',
    visibility: '',
    isExported: false,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ==========================================================================
// 1. DatabaseConnection + QueryBuilder
// ==========================================================================

describe('DatabaseConnection', () => {
  let conn: DatabaseConnection;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    conn = new DatabaseConnection();
    if (existsSync(DB_PATH)) rmSync(DB_PATH);
  });

  it('initialize creates DB with WAL mode', () => {
    conn.initialize(DB_PATH);
    expect(conn.isOpen).toBe(true);
    expect(conn.getJournalMode()).toBe('wal');
    expect(conn.getSchemaVersion()).toBe(1);
    conn.close();
  });

  it('open reopens existing DB', () => {
    conn.initialize(DB_PATH);
    conn.close();

    conn.open(DB_PATH);
    expect(conn.isOpen).toBe(true);
    expect(conn.getSchemaVersion()).toBe(1);
    conn.close();
  });

  it('open throws on missing file', () => {
    expect(() => conn.open(join(TEST_DIR, 'nonexistent.db'))).toThrow('not found');
  });

  it('close then raw throws', () => {
    conn.initialize(DB_PATH);
    conn.close();
    expect(() => conn.raw).toThrow('not open');
  });

  it('transaction commits on success', () => {
    conn.initialize(DB_PATH);
    const queries = new QueryBuilder(conn);
    const node = makeNode({ id: 'fn:a', name: 'a' });
    conn.transaction(() => {
      queries.insertNode(node);
    });
    expect(queries.getNodeById('fn:a')).not.toBeNull();
    conn.close();
  });

  it('getSize returns positive value after initialize', () => {
    conn.initialize(DB_PATH);
    expect(conn.getSize()).toBeGreaterThan(0);
    conn.close();
  });
});

// ==========================================================================
// 2. QueryBuilder CRUD
// ==========================================================================

describe('QueryBuilder', () => {
  let conn: DatabaseConnection;
  let qb: QueryBuilder;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    conn = new DatabaseConnection();
    conn.initialize(DB_PATH);
    qb = new QueryBuilder(conn);
  });

  afterAll(() => {
    conn.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    qb.clear();
  });

  // -- Node CRUD --

  it('insertNode + getNodeById round-trips', () => {
    const node = makeNode({ id: 'fn:test.ts:foo', name: 'foo', isExported: true, isAsync: true });
    qb.insertNode(node);
    const got = qb.getNodeById('fn:test.ts:foo');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('foo');
    expect(got!.isExported).toBe(true);
    expect(got!.isAsync).toBe(true);
    expect(got!.kind).toBe('function');
  });

  it('getNodeById returns null for missing', () => {
    expect(qb.getNodeById('nonexistent')).toBeNull();
  });

  it('insertNodes batch', () => {
    const nodes = [
      makeNode({ id: 'fn:a:x', name: 'x' }),
      makeNode({ id: 'fn:a:y', name: 'y' }),
      makeNode({ id: 'fn:a:z', name: 'z' }),
    ];
    qb.insertNodes(nodes);
    const map = qb.getNodesByIds(['fn:a:x', 'fn:a:y', 'fn:a:z']);
    expect(map.size).toBe(3);
  });

  it('getNodesByFile filters correctly', () => {
    qb.insertNode(makeNode({ id: 'fn:a.ts:f', name: 'f', filePath: 'a.ts' }));
    qb.insertNode(makeNode({ id: 'fn:b.ts:g', name: 'g', filePath: 'b.ts' }));
    expect(qb.getNodesByFile('a.ts')).toHaveLength(1);
    expect(qb.getNodesByFile('a.ts')[0]!.name).toBe('f');
  });

  it('getNodesByKind filters correctly', () => {
    qb.insertNode(makeNode({ id: 'fn:a:h', name: 'h', kind: 'function' }));
    qb.insertNode(makeNode({ id: 'cls:a:C', name: 'C', kind: 'class' }));
    expect(qb.getNodesByKind('class')).toHaveLength(1);
    expect(qb.getNodesByKind('class')[0]!.name).toBe('C');
  });

  it('deleteNode removes node', () => {
    qb.insertNode(makeNode({ id: 'fn:del', name: 'del' }));
    expect(qb.getNodeById('fn:del')).not.toBeNull();
    qb.deleteNode('fn:del');
    expect(qb.getNodeById('fn:del')).toBeNull();
  });

  it('deleteNodesByFile removes all nodes for file', () => {
    qb.insertNode(makeNode({ id: 'fn:f1:a', name: 'a', filePath: 'f1.ts' }));
    qb.insertNode(makeNode({ id: 'fn:f1:b', name: 'b', filePath: 'f1.ts' }));
    qb.insertNode(makeNode({ id: 'fn:f2:c', name: 'c', filePath: 'f2.ts' }));
    qb.deleteNodesByFile('f1.ts');
    expect(qb.getNodesByFile('f1.ts')).toHaveLength(0);
    expect(qb.getNodesByFile('f2.ts')).toHaveLength(1);
  });

  // -- Edge CRUD --

  it('insertEdge + getOutgoing/getIncoming', () => {
    qb.insertNode(makeNode({ id: 'A', name: 'A' }));
    qb.insertNode(makeNode({ id: 'B', name: 'B' }));
    const edge: EnhancedEdge = { source: 'A', target: 'B', kind: 'calls' };
    qb.insertEdge(edge);

    const out = qb.getOutgoingEdges('A');
    expect(out).toHaveLength(1);
    expect(out[0]!.target).toBe('B');
    expect(out[0]!.kind).toBe('calls');

    const inc = qb.getIncomingEdges('B');
    expect(inc).toHaveLength(1);
    expect(inc[0]!.source).toBe('A');
  });

  it('getOutgoingEdges with kind filter', () => {
    qb.insertNode(makeNode({ id: 'X', name: 'X' }));
    qb.insertNode(makeNode({ id: 'Y', name: 'Y' }));
    qb.insertNode(makeNode({ id: 'Z', name: 'Z' }));
    qb.insertEdge({ source: 'X', target: 'Y', kind: 'calls' });
    qb.insertEdge({ source: 'X', target: 'Z', kind: 'imports' });

    expect(qb.getOutgoingEdges('X', ['calls'])).toHaveLength(1);
    expect(qb.getOutgoingEdges('X', ['imports'])).toHaveLength(1);
    expect(qb.getOutgoingEdges('X')).toHaveLength(2);
  });

  it('deleteEdgesFrom removes outgoing edges', () => {
    qb.insertNode(makeNode({ id: 'P', name: 'P' }));
    qb.insertNode(makeNode({ id: 'Q', name: 'Q' }));
    qb.insertEdge({ source: 'P', target: 'Q', kind: 'calls' });
    expect(qb.getOutgoingEdges('P')).toHaveLength(1);
    qb.deleteEdgesFrom('P');
    expect(qb.getOutgoingEdges('P')).toHaveLength(0);
  });

  // -- File CRUD --

  it('upsertFile + getFile round-trips', () => {
    qb.upsertFile({
      path: 'src/main.ts',
      contentHash: 'abc123',
      language: 'typescript',
      size: 1024,
      modifiedAt: '2025-01-01',
      indexedAt: '2025-01-01',
      nodeCount: 5,
      errors: [],
    });
    const file = qb.getFile('src/main.ts');
    expect(file).not.toBeNull();
    expect(file!.contentHash).toBe('abc123');
    expect(file!.language).toBe('typescript');
    expect(file!.nodeCount).toBe(5);
  });

  it('getAllFiles returns all files', () => {
    qb.upsertFile({ path: 'a.ts', contentHash: 'h1', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 1, errors: [] });
    qb.upsertFile({ path: 'b.ts', contentHash: 'h2', language: 'typescript', size: 200, modifiedAt: '', indexedAt: '', nodeCount: 2, errors: [] });
    expect(qb.getAllFiles()).toHaveLength(2);
  });

  it('getStaleFiles detects added/modified/deleted', () => {
    qb.upsertFile({ path: 'existing.ts', contentHash: 'old', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 1, errors: [] });
    qb.upsertFile({ path: 'removed.ts', contentHash: 'r', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 1, errors: [] });

    const current = new Map([
      ['existing.ts', 'new_hash'],
      ['brand_new.ts', 'fresh'],
    ]);

    const result = qb.getStaleFiles(current);
    expect(result.added).toContain('brand_new.ts');
    expect(result.modified).toContain('existing.ts');
    expect(result.deleted).toContain('removed.ts');
  });

  // -- Search --

  it('searchNodes via FTS5', () => {
    qb.insertNode(makeNode({ id: 'fn:auth', name: 'authenticateUser', signature: 'function authenticateUser(token: string)' }));
    qb.insertNode(makeNode({ id: 'fn:validate', name: 'validateInput', signature: 'function validateInput(data: any)' }));

    const results = qb.searchNodes('authenticate');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.name === 'authenticateUser')).toBe(true);
  });

  it('searchNodes with kind filter', () => {
    qb.insertNode(makeNode({ id: 'fn:search', name: 'search', kind: 'function' }));
    qb.insertNode(makeNode({ id: 'cls:search', name: 'SearchService', kind: 'class' }));

    const fns = qb.searchNodes('search', { kinds: ['function'] });
    expect(fns.every(n => n.kind === 'function')).toBe(true);
  });

  it('searchNodes empty query returns nodes up to limit', () => {
    qb.insertNode(makeNode({ id: 'n1', name: 'alpha' }));
    qb.insertNode(makeNode({ id: 'n2', name: 'beta' }));
    const results = qb.searchNodes('', { limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  // -- Statistics --

  it('getStats returns correct counts', () => {
    qb.insertNode(makeNode({ id: 's1', name: 's1', kind: 'function' }));
    qb.insertNode(makeNode({ id: 's2', name: 's2', kind: 'class' }));
    qb.insertEdge({ source: 's1', target: 's2', kind: 'calls' });

    const stats = qb.getStats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.nodesByKind['function']).toBe(1);
    expect(stats.nodesByKind['class']).toBe(1);
    expect(stats.edgesByKind['calls']).toBe(1);
  });

  it('getNodeAndEdgeCount matches getStats', () => {
    qb.insertNode(makeNode({ id: 'c1', name: 'c1' }));
    qb.insertNode(makeNode({ id: 'c2', name: 'c2' }));
    const { nodes, edges } = qb.getNodeAndEdgeCount();
    expect(nodes).toBe(2);
    expect(edges).toBe(0);
  });

  // -- Metadata --

  it('setMetadata + getMetadata round-trips', () => {
    qb.setMetadata('project_name', 'maestro');
    expect(qb.getMetadata('project_name')).toBe('maestro');
  });

  it('getMetadata returns null for missing', () => {
    expect(qb.getMetadata('nope')).toBeNull();
  });

  // -- Clear --

  it('clear removes all data', () => {
    qb.insertNode(makeNode({ id: 'clr', name: 'clr' }));
    qb.clear();
    expect(qb.getNodeById('clr')).toBeNull();
    const { nodes, edges } = qb.getNodeAndEdgeCount();
    expect(nodes).toBe(0);
    expect(edges).toBe(0);
  });
});

// ==========================================================================
// 3. GraphTraverser
// ==========================================================================

describe('GraphTraverser', () => {
  let conn: DatabaseConnection;
  let qb: QueryBuilder;
  let traverser: GraphTraverser;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    conn = new DatabaseConnection();
    conn.initialize(join(TEST_DIR, 'traverser.db'));
    qb = new QueryBuilder(conn);
    traverser = new GraphTraverser(qb);

    // Build graph:
    //   file:app.ts --contains--> fn:app.ts:main --calls--> fn:app.ts:helper
    //   file:app.ts --contains--> fn:app.ts:helper --calls--> fn:lib.ts:util
    //   file:lib.ts --contains--> fn:lib.ts:util
    //   cls:app.ts:Base --extends--> cls:app.ts:Child
    qb.insertNode(makeNode({ id: 'file:app.ts', name: 'app.ts', kind: 'file', filePath: 'app.ts' }));
    qb.insertNode(makeNode({ id: 'fn:app.ts:main', name: 'main', kind: 'function', filePath: 'app.ts', isExported: true }));
    qb.insertNode(makeNode({ id: 'fn:app.ts:helper', name: 'helper', kind: 'function', filePath: 'app.ts' }));
    qb.insertNode(makeNode({ id: 'file:lib.ts', name: 'lib.ts', kind: 'file', filePath: 'lib.ts' }));
    qb.insertNode(makeNode({ id: 'fn:lib.ts:util', name: 'util', kind: 'function', filePath: 'lib.ts', isExported: true }));
    qb.insertNode(makeNode({ id: 'cls:app.ts:Base', name: 'Base', kind: 'class', filePath: 'app.ts' }));
    qb.insertNode(makeNode({ id: 'cls:app.ts:Child', name: 'Child', kind: 'class', filePath: 'app.ts' }));

    qb.insertEdge({ source: 'file:app.ts', target: 'fn:app.ts:main', kind: 'contains' });
    qb.insertEdge({ source: 'file:app.ts', target: 'fn:app.ts:helper', kind: 'contains' });
    qb.insertEdge({ source: 'file:lib.ts', target: 'fn:lib.ts:util', kind: 'contains' });
    qb.insertEdge({ source: 'fn:app.ts:main', target: 'fn:app.ts:helper', kind: 'calls' });
    qb.insertEdge({ source: 'fn:app.ts:helper', target: 'fn:lib.ts:util', kind: 'calls' });
    qb.insertEdge({ source: 'cls:app.ts:Child', target: 'cls:app.ts:Base', kind: 'extends' });
    qb.insertEdge({ source: 'file:app.ts', target: 'file:lib.ts', kind: 'imports' });
  });

  afterAll(() => {
    conn.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('traverseBFS reaches transitive nodes', () => {
    const sub = traverser.traverseBFS('fn:app.ts:main', { maxDepth: 3, direction: 'outgoing' });
    expect(sub.nodes.has('fn:app.ts:main')).toBe(true);
    expect(sub.nodes.has('fn:app.ts:helper')).toBe(true);
    expect(sub.nodes.has('fn:lib.ts:util')).toBe(true);
  });

  it('traverseBFS respects maxDepth', () => {
    const sub = traverser.traverseBFS('fn:app.ts:main', { maxDepth: 1, direction: 'outgoing' });
    expect(sub.nodes.has('fn:app.ts:helper')).toBe(true);
    expect(sub.nodes.has('fn:lib.ts:util')).toBe(false);
  });

  it('traverseBFS returns empty for non-existent node', () => {
    const sub = traverser.traverseBFS('nonexistent');
    expect(sub.nodes.size).toBe(0);
  });

  it('traverseDFS reaches all reachable nodes', () => {
    const sub = traverser.traverseDFS('fn:app.ts:main', { maxDepth: 5, direction: 'outgoing' });
    expect(sub.nodes.has('fn:app.ts:helper')).toBe(true);
    expect(sub.nodes.has('fn:lib.ts:util')).toBe(true);
  });

  it('getCallers finds direct callers', () => {
    const callers = traverser.getCallers('fn:app.ts:helper', 1);
    expect(callers.some(c => c.node.id === 'fn:app.ts:main')).toBe(true);
  });

  it('getCallers with depth 2 finds transitive callers', () => {
    const callers = traverser.getCallers('fn:lib.ts:util', 2);
    const ids = callers.map(c => c.node.id);
    expect(ids).toContain('fn:app.ts:helper');
    expect(ids).toContain('fn:app.ts:main');
  });

  it('getCallees finds direct callees', () => {
    const callees = traverser.getCallees('fn:app.ts:main', 1);
    expect(callees.some(c => c.node.id === 'fn:app.ts:helper')).toBe(true);
  });

  it('getCallGraph includes both directions', () => {
    const graph = traverser.getCallGraph('fn:app.ts:helper', 2);
    expect(graph.nodes.has('fn:app.ts:main')).toBe(true);
    expect(graph.nodes.has('fn:lib.ts:util')).toBe(true);
    expect(graph.nodes.has('fn:app.ts:helper')).toBe(true);
  });

  it('getTypeHierarchy finds ancestors and descendants', () => {
    const hierarchy = traverser.getTypeHierarchy('cls:app.ts:Child');
    expect(hierarchy.nodes.has('cls:app.ts:Base')).toBe(true);
    expect(hierarchy.nodes.has('cls:app.ts:Child')).toBe(true);
  });

  it('findUsages returns incoming references', () => {
    const usages = traverser.findUsages('fn:lib.ts:util');
    expect(usages.some(u => u.node.id === 'fn:app.ts:helper')).toBe(true);
  });

  it('getImpactRadius finds transitive dependents', () => {
    const impact = traverser.getImpactRadius('fn:lib.ts:util', 3);
    expect(impact.nodes.has('fn:app.ts:helper')).toBe(true);
  });

  it('findPath finds shortest path', () => {
    const path = traverser.findPath('fn:app.ts:main', 'fn:lib.ts:util');
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0]!.node.id).toBe('fn:app.ts:main');
    expect(path![path!.length - 1]!.node.id).toBe('fn:lib.ts:util');
  });

  it('findPath returns null when no path exists', () => {
    const path = traverser.findPath('fn:lib.ts:util', 'fn:app.ts:main');
    // util doesn't call main, so no outgoing path
    expect(path).toBeNull();
  });

  it('getAncestors returns containing chain', () => {
    const ancestors = traverser.getAncestors('fn:app.ts:main');
    expect(ancestors.some(a => a.id === 'file:app.ts')).toBe(true);
  });

  it('getChildren returns contained nodes', () => {
    const children = traverser.getChildren('file:app.ts');
    expect(children.length).toBeGreaterThanOrEqual(2);
    expect(children.some(c => c.id === 'fn:app.ts:main')).toBe(true);
  });
});

// ==========================================================================
// 4. GraphQueryManager
// ==========================================================================

describe('GraphQueryManager', () => {
  let conn: DatabaseConnection;
  let qb: QueryBuilder;
  let gqm: GraphQueryManager;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    conn = new DatabaseConnection();
    conn.initialize(join(TEST_DIR, 'gqm.db'));
    qb = new QueryBuilder(conn);
    gqm = new GraphQueryManager(qb);

    // file:a.ts --contains--> fn:a.ts:foo (exported)
    // file:a.ts --imports--> file:b.ts
    // file:b.ts --contains--> fn:b.ts:bar (exported)
    // fn:a.ts:foo --calls--> fn:b.ts:bar
    // fn:a.ts:unused (not exported, no incoming refs besides contains)
    qb.insertNode(makeNode({ id: 'file:a.ts', name: 'a.ts', kind: 'file', filePath: 'a.ts' }));
    qb.insertNode(makeNode({ id: 'fn:a.ts:foo', name: 'foo', kind: 'function', filePath: 'a.ts', isExported: true }));
    qb.insertNode(makeNode({ id: 'fn:a.ts:unused', name: 'unused', kind: 'function', filePath: 'a.ts', isExported: false }));
    qb.insertNode(makeNode({ id: 'file:b.ts', name: 'b.ts', kind: 'file', filePath: 'b.ts' }));
    qb.insertNode(makeNode({ id: 'fn:b.ts:bar', name: 'bar', kind: 'function', filePath: 'b.ts', isExported: true }));

    // file:c.ts --imports--> file:a.ts (creates cycle potential)
    // file:a.ts --imports--> file:c.ts (creates actual cycle: a -> c -> a)
    qb.insertNode(makeNode({ id: 'file:c.ts', name: 'c.ts', kind: 'file', filePath: 'c.ts' }));

    qb.insertEdge({ source: 'file:a.ts', target: 'fn:a.ts:foo', kind: 'contains' });
    qb.insertEdge({ source: 'file:a.ts', target: 'fn:a.ts:unused', kind: 'contains' });
    qb.insertEdge({ source: 'file:b.ts', target: 'fn:b.ts:bar', kind: 'contains' });
    qb.insertEdge({ source: 'fn:a.ts:foo', target: 'fn:b.ts:bar', kind: 'calls' });
    qb.insertEdge({ source: 'file:a.ts', target: 'file:b.ts', kind: 'imports' });
    qb.insertEdge({ source: 'file:a.ts', target: 'file:c.ts', kind: 'imports' });
    qb.insertEdge({ source: 'file:c.ts', target: 'file:a.ts', kind: 'imports' });

    qb.upsertFile({ path: 'a.ts', contentHash: 'ha', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 2, errors: [] });
    qb.upsertFile({ path: 'b.ts', contentHash: 'hb', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 1, errors: [] });
    qb.upsertFile({ path: 'c.ts', contentHash: 'hc', language: 'typescript', size: 100, modifiedAt: '', indexedAt: '', nodeCount: 0, errors: [] });
  });

  afterAll(() => {
    conn.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('getContext returns full node context', () => {
    const ctx = gqm.getContext('fn:a.ts:foo');
    expect(ctx.focal.name).toBe('foo');
    expect(ctx.ancestors.some(a => a.id === 'file:a.ts')).toBe(true);
    expect(ctx.outgoingRefs.some(r => r.node.id === 'fn:b.ts:bar')).toBe(true);
  });

  it('getContext throws for non-existent node', () => {
    expect(() => gqm.getContext('nonexistent')).toThrow('not found');
  });

  it('getFileDependencies returns imported files', () => {
    const deps = gqm.getFileDependencies('a.ts');
    expect(deps).toContain('b.ts');
    expect(deps).toContain('c.ts');
  });

  it('getFileDependents returns files that import this file', () => {
    const dependents = gqm.getFileDependents('a.ts');
    expect(dependents).toContain('c.ts');
  });

  it('getExportedSymbols returns exported nodes', () => {
    const exports = gqm.getExportedSymbols('a.ts');
    expect(exports.some(n => n.name === 'foo')).toBe(true);
    expect(exports.every(n => n.isExported)).toBe(true);
  });

  it('findDeadCode finds unreferenced non-exported symbols', () => {
    const dead = gqm.findDeadCode(['function']);
    expect(dead.some(n => n.name === 'unused')).toBe(true);
    expect(dead.every(n => !n.isExported)).toBe(true);
  });

  it('findCircularDependencies detects cycles', () => {
    const cycles = gqm.findCircularDependencies();
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const cyclePaths = cycles.map(c => c.join(' -> '));
    const hasAC = cyclePaths.some(p => p.includes('a.ts') && p.includes('c.ts'));
    expect(hasAC).toBe(true);
  });

  it('getNodeMetrics returns correct metrics', () => {
    const metrics = gqm.getNodeMetrics('fn:a.ts:foo');
    expect(metrics.outgoingEdgeCount).toBeGreaterThanOrEqual(1);
    expect(metrics.depth).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// 5. Query Parser
// ==========================================================================

describe('parseQuery', () => {
  it('extracts kind filter', () => {
    const q = parseQuery('kind:function auth');
    expect(q.kinds).toEqual(['function']);
    expect(q.text).toBe('auth');
  });

  it('extracts multiple filters', () => {
    const q = parseQuery('kind:class lang:typescript path:src/api MyClass');
    expect(q.kinds).toEqual(['class']);
    expect(q.languages).toEqual(['typescript']);
    expect(q.pathFilters).toEqual(['src/api']);
    expect(q.text).toBe('MyClass');
  });

  it('extracts name filter', () => {
    const q = parseQuery('name:authenticate');
    expect(q.nameFilters).toEqual(['authenticate']);
    expect(q.text).toBe('');
  });

  it('invalid kind becomes text', () => {
    const q = parseQuery('kind:bogus');
    expect(q.kinds).toEqual([]);
    expect(q.text).toBe('kind:bogus');
  });

  it('handles quoted values', () => {
    const q = parseQuery('path:"src/my app" test');
    expect(q.pathFilters).toEqual(['src/my app']);
    expect(q.text).toBe('test');
  });

  it('plain text passes through', () => {
    const q = parseQuery('hello world');
    expect(q.text).toBe('hello world');
    expect(q.kinds).toEqual([]);
    expect(q.languages).toEqual([]);
  });
});

describe('boundedEditDistance', () => {
  it('identical strings = 0', () => {
    expect(boundedEditDistance('abc', 'abc', 3)).toBe(0);
  });

  it('one substitution = 1', () => {
    expect(boundedEditDistance('abc', 'axc', 3)).toBe(1);
  });

  it('one insertion = 1', () => {
    expect(boundedEditDistance('ac', 'abc', 3)).toBe(1);
  });

  it('exceeds max returns > max', () => {
    expect(boundedEditDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });

  it('empty vs non-empty', () => {
    expect(boundedEditDistance('', 'abc', 5)).toBe(3);
    expect(boundedEditDistance('abc', '', 5)).toBe(3);
  });
});

// ==========================================================================
// 6. Search Utils
// ==========================================================================

describe('extractSearchTerms', () => {
  it('splits camelCase', () => {
    const terms = extractSearchTerms('authenticateUser', { stems: false });
    expect(terms).toContain('authenticate');
    expect(terms).toContain('user');
  });

  it('splits snake_case', () => {
    const terms = extractSearchTerms('validate_input', { stems: false });
    expect(terms).toContain('validate');
    expect(terms).toContain('input');
  });

  it('preserves compound identifiers', () => {
    const terms = extractSearchTerms('authenticateUser', { stems: false });
    expect(terms).toContain('authenticateuser');
  });

  it('filters stop words', () => {
    const terms = extractSearchTerms('the function is called', { stems: false });
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
  });

  it('includes stem variants when enabled', () => {
    const terms = extractSearchTerms('authenticating', { stems: true });
    expect(terms.some(t => t === 'authenticate' || t === 'authenticat')).toBe(true);
  });
});

describe('getStemVariants', () => {
  it('removes -ing suffix', () => {
    const variants = getStemVariants('running');
    expect(variants).toContain('runn');
    expect(variants).toContain('run');
  });

  it('removes -tion suffix', () => {
    const variants = getStemVariants('authentication');
    expect(variants).toContain('authenticat');
  });

  it('handles -ies → -y', () => {
    const variants = getStemVariants('queries');
    expect(variants).toContain('query');
  });

  it('handles -ed suffix', () => {
    const variants = getStemVariants('validated');
    expect(variants.some(v => v === 'validat' || v === 'validate')).toBe(true);
  });

  it('short words return empty', () => {
    expect(getStemVariants('run')).toEqual([]);
  });
});

describe('scorePathRelevance', () => {
  it('filename match scores higher', () => {
    const score = scorePathRelevance('src/auth/login.ts', 'login');
    expect(score).toBeGreaterThan(0);
  });

  it('test file gets penalty for non-test query', () => {
    const testScore = scorePathRelevance('src/__tests__/auth.test.ts', 'auth');
    const srcScore = scorePathRelevance('src/auth.ts', 'auth');
    expect(srcScore).toBeGreaterThan(testScore);
  });

  it('test query on test file no penalty', () => {
    const score = scorePathRelevance('src/__tests__/auth.test.ts', 'test auth');
    expect(score).toBeGreaterThan(0);
  });
});

describe('nameMatchBonus', () => {
  it('exact match = 80', () => {
    expect(nameMatchBonus('auth', 'auth')).toBe(80);
  });

  it('prefix match > 10', () => {
    const bonus = nameMatchBonus('authenticate', 'auth');
    expect(bonus).toBeGreaterThan(10);
  });

  it('contains match = 10', () => {
    expect(nameMatchBonus('preAuthenticate', 'auth')).toBe(10);
  });

  it('no match = 0', () => {
    expect(nameMatchBonus('login', 'auth')).toBe(0);
  });
});

describe('kindBonus', () => {
  it('function gets high bonus', () => {
    expect(kindBonus('function')).toBe(10);
  });

  it('file gets zero', () => {
    expect(kindBonus('file')).toBe(0);
  });
});

describe('isTestFile', () => {
  it('detects .test.ts', () => expect(isTestFile('src/auth.test.ts')).toBe(true));
  it('detects .spec.ts', () => expect(isTestFile('src/auth.spec.ts')).toBe(true));
  it('detects __tests__ dir', () => expect(isTestFile('src/__tests__/auth.ts')).toBe(true));
  it('detects test_ prefix', () => expect(isTestFile('test_auth.py')).toBe(true));
  it('rejects normal file', () => expect(isTestFile('src/auth.ts')).toBe(false));
});

describe('isGeneratedFile', () => {
  it('detects .pb.go', () => expect(isGeneratedFile('api/proto.pb.go')).toBe(true));
  it('detects .min.js', () => expect(isGeneratedFile('dist/bundle.min.js')).toBe(true));
  it('detects generated dir', () => expect(isGeneratedFile('src/generated/types.ts')).toBe(true));
  it('detects lock files', () => expect(isGeneratedFile('package-lock.json')).toBe(true));
  it('rejects normal file', () => expect(isGeneratedFile('src/auth.ts')).toBe(false));
});

// ==========================================================================
// 7. Content Hash
// ==========================================================================

describe('computeFileHash', () => {
  const hashDir = join(TEST_DIR, 'hash_test');

  beforeAll(() => {
    mkdirSync(hashDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(hashDir, { recursive: true, force: true });
  });

  it('returns SHA256 hex for small file', () => {
    const file = join(hashDir, 'small.ts');
    writeFileSync(file, 'export const x = 1;');
    const hash = computeFileHash(file);
    expect(hash).not.toBeNull();
    expect(hash!).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same content = same hash', () => {
    const f1 = join(hashDir, 'a.ts');
    const f2 = join(hashDir, 'b.ts');
    writeFileSync(f1, 'same');
    writeFileSync(f2, 'same');
    expect(computeFileHash(f1)).toBe(computeFileHash(f2));
  });

  it('different content = different hash', () => {
    const f1 = join(hashDir, 'c.ts');
    const f2 = join(hashDir, 'd.ts');
    writeFileSync(f1, 'content1');
    writeFileSync(f2, 'content2');
    expect(computeFileHash(f1)).not.toBe(computeFileHash(f2));
  });

  it('returns null for non-existent file', () => {
    expect(computeFileHash(join(hashDir, 'nope.ts'))).toBeNull();
  });
});

describe('computeFileHashes', () => {
  const hashDir = join(TEST_DIR, 'hashes_test');

  beforeAll(() => {
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(join(hashDir, 'x.ts'), 'x');
    writeFileSync(join(hashDir, 'y.ts'), 'y');
  });

  afterAll(() => {
    rmSync(hashDir, { recursive: true, force: true });
  });

  it('returns map of hashes', () => {
    const files = [
      { absolutePath: join(hashDir, 'x.ts'), relPath: 'x.ts' },
      { absolutePath: join(hashDir, 'y.ts'), relPath: 'y.ts' },
    ];
    const map = computeFileHashes(files);
    expect(map.size).toBe(2);
    expect(map.has('x.ts')).toBe(true);
    expect(map.has('y.ts')).toBe(true);
  });
});

describe('isFileTooLarge', () => {
  const sizeDir = join(TEST_DIR, 'size_test');

  beforeAll(() => {
    mkdirSync(sizeDir, { recursive: true });
    writeFileSync(join(sizeDir, 'small.ts'), 'x');
  });

  afterAll(() => {
    rmSync(sizeDir, { recursive: true, force: true });
  });

  it('small file is not too large', () => {
    expect(isFileTooLarge(join(sizeDir, 'small.ts'))).toBe(false);
  });

  it('non-existent file returns false', () => {
    expect(isFileTooLarge(join(sizeDir, 'nope.ts'))).toBe(false);
  });
});
