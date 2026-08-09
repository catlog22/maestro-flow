import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaestroGraph } from '../engine.js';
import { KG_SCHEMA_VERSION } from '../db/connection.js';
import type {
  ResolutionResult,
  UnifiedEdge,
  UnifiedGraphStats,
  UnifiedNode,
} from '../db/types.js';
import {
  makeStructuralReferenceKey,
  type StructuralReference,
} from '../resolution/structural-reference.js';
import type { PathStep } from '../query/traversal.js';
import { registerKgCommands } from '../surface/cli.js';
import { handleMcpTool, KG_MCP_TOOLS } from '../surface/mcp-tools.js';
import { writeSyncState } from '../sync-state.js';

const ids = {
  child: 'code:/project/Child.swift:Module.Child',
  base: 'code:/project/Base.h:Module.Base',
  grandBase: 'code:@external/apple/UIKit:UIResponder',
  caller: 'code:/project/Caller.swift:Module.Caller.run',
  callee: 'code:/project/Callee.swift:Module.Callee.run',
  importer: 'code:/project/Importer.swift:Module.Importer',
  module: 'code:/project/Module.swift:Module',
  referrer: 'code:/project/Referrer.swift:Module.Referrer',
  target: 'code:/project/Target.swift:Module.Target',
  duplicateA: 'code:/project/A.swift:A.Duplicate',
  duplicateB: 'code:/project/B.swift:B.Duplicate',
  exactSurface: 'code:/project/Pods/PodBase.h:Pod.PodBase',
} as const;

function node(
  id: string,
  name: string,
  qualifiedName: string,
  overrides: Partial<UnifiedNode> = {},
): UnifiedNode {
  return {
    id,
    kind: 'class',
    name,
    qualifiedName,
    filePath: id.includes('@external/apple') ? '@external/apple/UIKit' : `/project/${name}.swift`,
    language: 'swift',
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: '',
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {},
    updatedAt: 1,
    ...overrides,
  };
}

function edge(source: string, target: string, kind: UnifiedEdge['kind']): UnifiedEdge {
  return { source, target, kind, provenance: 'tree-sitter' };
}

function pendingReference(): StructuralReference {
  const input = {
    normalizedOriginPath: '/project/Child.swift',
    anchorNodeId: ids.child,
    relationHint: 'extends' as const,
    edgeOrientation: 'anchor-to-target' as const,
    rawTargetName: 'MissingBase',
    line: 1,
    column: 1,
  };
  return {
    kind: 'type',
    refKey: makeStructuralReferenceKey(input),
    anchorNodeId: ids.child,
    anchorQualifiedName: 'Module.Child',
    rawTargetName: 'MissingBase',
    sourceDeclarationKind: 'class',
    lookupScope: 'project',
    relationHint: 'extends',
    edgeOrientation: 'anchor-to-target',
    targetKindHints: ['class'],
    targetLanguageHints: ['swift', 'objc'],
    moduleHints: [],
    targetFileHints: [],
    origin: {
      filePath: '/project/Child.swift',
      language: 'swift',
      line: 1,
      column: 1,
    },
    evidenceProvenance: 'tree-sitter',
    status: 'pending',
  };
}

describe('inheritance query direction and surface parity', () => {
  let root = '';
  let graph: MaestroGraph | null = null;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-query-direction-'));
    graph = await MaestroGraph.init(root);
    const queries = graph.getQueryBuilder();
    queries.insertNodes([
      node(ids.child, 'Child', 'Module.Child'),
      node(ids.base, 'Base', 'Module.Base', { language: 'objc', filePath: '/project/Base.h' }),
      node(ids.grandBase, 'UIResponder', 'UIKit.UIResponder', {
        language: 'objc',
        filePath: '@external/apple/UIKit',
        metadata: { provider: 'apple', module: 'UIKit' },
      }),
      node(ids.caller, 'run', 'Module.Caller.run', { kind: 'method' }),
      node(ids.callee, 'runCallee', 'Module.Callee.run', { kind: 'method' }),
      node(ids.importer, 'Importer', 'Module.Importer'),
      node(ids.module, 'Module', 'Module', { kind: 'module' }),
      node(ids.referrer, 'Referrer', 'Module.Referrer'),
      node(ids.target, 'Target', 'Module.Target'),
      node(ids.duplicateA, 'Duplicate', 'A.Duplicate'),
      node(ids.duplicateB, 'Duplicate', 'B.Duplicate'),
      node(ids.exactSurface, 'PodBase', 'Pod.PodBase', {
        language: 'objc',
        filePath: '/project/Pods/PodBase.h',
        metadata: { externalSurface: true, module: 'Pod' },
      }),
    ]);
    queries.insertEdges([
      {
        ...edge(ids.child, ids.base, 'extends'),
        metadata: { compilationCondition: '#if canImport(Module)' },
      },
      edge(ids.base, ids.grandBase, 'extends'),
      edge(ids.caller, ids.callee, 'calls'),
      edge(ids.importer, ids.module, 'imports'),
      edge(ids.referrer, ids.target, 'references'),
    ]);
    queries.stageStructuralReferences([pendingReference()], 1);
  });

  afterEach(() => {
    graph?.close();
    graph = null;
    vi.restoreAllMocks();
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('maps child-to-parent storage to parents outgoing and children incoming', () => {
    const childParents = graph!.getTypeHierarchy(ids.child, { direction: 'parents', depth: 1 });
    expect(childParents.root?.id).toBe(ids.child);
    expect(childParents.parents.map(item => item.id)).toEqual([ids.base]);
    expect(childParents.children).toEqual([]);
    expect(childParents.rawEdges).toHaveLength(1);
    expect(childParents.rawEdges[0]).toMatchObject({
      source: ids.child,
      target: ids.base,
      kind: 'extends',
      metadata: { compilationCondition: '#if canImport(Module)' },
    });

    const baseChildren = graph!.getTypeHierarchy(ids.base, { direction: 'children', depth: 1 });
    expect(baseChildren.parents).toEqual([]);
    expect(baseChildren.children.map(item => item.id)).toEqual([ids.child]);

    const transitive = graph!.getTypeHierarchy(ids.child, { direction: 'parents', depth: 2 });
    expect(transitive.parents.map(item => item.id)).toEqual([ids.grandBase, ids.base].sort());
  });

  it.each([
    ['extends', ids.base, ids.child],
    ['calls', ids.callee, ids.caller],
    ['imports', ids.module, ids.importer],
    ['references', ids.target, ids.referrer],
  ])('preserves outgoing impact by default and supports incoming downstream consumers', (_kind, target, consumer) => {
    const legacyDefault = graph!.getImpact(consumer, 1);
    expect(legacyDefault.traversalDirection).toBe('outgoing');
    expect(legacyDefault.nodes.has(target)).toBe(true);
    expect(graph!.getImpact(target, 1).nodes.has(consumer)).toBe(false);

    const downstream = graph!.getImpact(target, 1, 'incoming');
    expect(downstream.traversalDirection).toBe('incoming');
    expect(downstream.depth).toBe(1);
    expect(downstream.nodes.has(consumer)).toBe(true);
    expect(downstream.edges).toEqual([
      expect.objectContaining({ source: consumer, target }),
    ]);

    const reverse = graph!.getImpact(consumer, 1, 'incoming');
    expect(reverse.nodes.has(target)).toBe(false);
  });

  it('caps traversal without emitting dangling edges or claiming a truncated path is absent', async () => {
    const queries = graph!.getQueryBuilder();
    expect(graph!.findShortestPathResult(ids.child, ids.grandBase, 1, 3)).toEqual({
      path: null,
      truncated: true,
      visitedCount: 2,
    });
    expect(graph!.findShortestPath(ids.child, ids.grandBase, 2)).toHaveLength(3);
    expect(graph!.findShortestPathResult(ids.child, ids.grandBase, 2, 2)).toEqual({
      path: null,
      truncated: true,
      visitedCount: 2,
    });
    const consumers = Array.from({ length: 1_005 }, (_, index) => {
      const id = `code:/project/Consumer${String(index).padStart(3, '0')}.swift:Consumer${index}`;
      return node(id, `Consumer${index}`, `Consumer${index}`);
    });
    queries.insertNodes(consumers);
    queries.insertEdges(consumers.map(consumer => edge(consumer.id, ids.base, 'references')));

    const impact = graph!.getImpact(ids.base, 1, 'incoming');
    expect(impact.truncated).toBe(true);
    expect(impact.nodes.size).toBe(200);
    expect(impact.edges.every(item => (
      impact.nodes.has(item.source) && impact.nodes.has(item.target)
    ))).toBe(true);

    const hierarchy = graph!.getTypeHierarchy(ids.child, {
      direction: 'parents',
      depth: 2,
      maxNodes: 2,
    });
    expect(hierarchy.truncated).toBe(true);
    expect(hierarchy.nodes.size).toBe(2);

    const cli = await runCli(root, ['kg', 'path', 'Base', 'UIResponder', '--json']);
    expect(cli.exitCode).toBe(1);
    const mcp = await handleMcpTool('maestro_kg_path', {
      from: 'Base',
      to: 'UIResponder',
    }, root);
    expect(mcp.isError).toBe(true);
    expect(JSON.parse(mcp.content[0].text)).toEqual(JSON.parse(cli.stdout));
    expect(JSON.parse(cli.stdout)).toMatchObject({
      path: null,
      hops: null,
      truncated: true,
      visitedCount: 1_000,
    });
  });

  it('does not report depth truncation when the reachable frontier is exhausted', () => {
    expect(graph!.findShortestPathResult(ids.exactSurface, ids.child, 1, 3)).toEqual({
      path: null,
      truncated: false,
      visitedCount: 1,
    });
  });

  it('keeps additive resolution and stats fields optional for public type compatibility', () => {
    const legacyResolution: ResolutionResult = {
      edgesCreated: 0,
      edges: [],
      durationMs: 0,
    };
    const legacyStats: UnifiedGraphStats = {
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      dbSizeBytes: 0,
      nodesByKind: {},
      edgesByKind: {},
      nodesBySourceType: {},
      detectedFrameworks: [],
      schemaVersion: 7,
      stalenessRatio: 0,
    };

    expect(legacyResolution.codeStructuralEdgesCreated).toBeUndefined();
    expect(legacyResolution.knowledgeEdgesCreated).toBeUndefined();
    expect(legacyStats.structuralRefs).toBeUndefined();
    expect(legacyStats.externalNodes).toBeUndefined();
  });

  it('deduplicates diamond hierarchy nodes and terminates inheritance cycles', () => {
    const queries = graph!.getQueryBuilder();
    const diamondIds = ['DiamondA', 'DiamondB', 'DiamondC', 'DiamondD']
      .map(name => `code:/project/${name}.swift:${name}`);
    queries.insertNodes(diamondIds.map((id, index) => (
      node(id, `Diamond${String.fromCharCode(65 + index)}`, `Diamond${String.fromCharCode(65 + index)}`)
    )));
    queries.insertEdges([
      edge(diamondIds[0], diamondIds[1], 'extends'),
      edge(diamondIds[0], diamondIds[2], 'extends'),
      edge(diamondIds[1], diamondIds[3], 'extends'),
      edge(diamondIds[2], diamondIds[3], 'extends'),
      edge(diamondIds[3], diamondIds[0], 'extends'),
    ]);

    const hierarchy = graph!.getTypeHierarchy(diamondIds[0], { direction: 'parents', depth: 10 });
    expect(hierarchy.truncated).toBe(false);
    expect(hierarchy.parents.map(item => item.id)).toEqual(diamondIds.slice(1).sort());
    expect(hierarchy.rawEdges).toHaveLength(5);

    const both = graph!.getTypeHierarchy(diamondIds[0], {
      direction: 'both',
      depth: 10,
      maxNodes: 4,
    });
    expect(both.truncated).toBe(false);
    expect(both.parents.map(item => item.id)).toEqual(diamondIds.slice(1).sort());
    expect(both.children.map(item => item.id)).toEqual(diamondIds.slice(1).sort());
  });

  it('keeps the default hierarchy exhaustive and reports explicit depth truncation truthfully', () => {
    const queries = graph!.getQueryBuilder();
    const deepIds = Array.from(
      { length: 13 },
      (_, index) => `code:/project/Deep${index}.swift:Deep${index}`,
    );
    queries.insertNodes(deepIds.map((id, index) => node(id, `Deep${index}`, `Deep${index}`)));
    queries.insertEdges(deepIds.slice(0, -1).map((id, index) => (
      edge(id, deepIds[index + 1]!, 'extends')
    )));

    const legacyDefault = graph!.getTypeHierarchy(deepIds[0]!, { direction: 'parents' });
    expect(legacyDefault.parents).toHaveLength(12);
    expect(legacyDefault.depth).toBe(12);
    expect(legacyDefault.truncated).toBe(false);

    const bounded = graph!.getTypeHierarchy(deepIds[0]!, {
      direction: 'parents',
      depth: 10,
    });
    expect(bounded.parents).toHaveLength(10);
    expect(bounded.depth).toBe(10);
    expect(bounded.truncated).toBe(true);

    const exact = graph!.getTypeHierarchy(deepIds[0]!, {
      direction: 'parents',
      depth: 12,
    });
    expect(exact.parents).toHaveLength(12);
    expect(exact.truncated).toBe(false);

    const impact = graph!.getImpact(deepIds[0]!, 12);
    expect(impact.depth).toBe(12);
    expect(impact.nodes.has(deepIds[12]!)).toBe(true);
    expect(impact.truncated).toBe(false);
  });

  it('keeps legacy hierarchy and shortest-path APIs unbounded unless a cap is explicit', () => {
    const queries = graph!.getQueryBuilder();
    const deepIds = Array.from(
      { length: 1_002 },
      (_, index) => `code:/project/Unbounded${index}.swift:Unbounded${index}`,
    );
    queries.insertNodes(deepIds.map((id, index) => (
      node(id, `Unbounded${index}`, `Unbounded${index}`)
    )));
    queries.insertEdges(deepIds.slice(0, -1).map((id, index) => (
      edge(id, deepIds[index + 1]!, 'extends')
    )));

    const hierarchy = graph!.getTypeHierarchy(deepIds[0]!, { direction: 'parents' });
    expect(hierarchy.parents).toHaveLength(1_001);
    expect(hierarchy.depth).toBe(1_001);
    expect(hierarchy.truncated).toBe(false);

    const path = graph!.findShortestPath(deepIds[0]!, deepIds[1_001]!, 1_001);
    expect(path).toHaveLength(1_002);

    const capped = graph!.findShortestPathResult(
      deepIds[0]!,
      deepIds[1_001]!,
      1_001,
      1_000,
    );
    expect(capped).toMatchObject({
      path: null,
      truncated: true,
      visitedCount: 1_000,
    });
  });

  it('keeps legacy PathStep assignments compatible and normalizes unsafe depths', () => {
    const legacyStep: PathStep = { nodeId: ids.child, edge: null };
    expect(legacyStep.traversalDirection).toBeUndefined();

    expect(graph!.getImpact(ids.child, Number.NaN).depth).toBe(3);
    expect(graph!.getImpact(ids.child, Number.POSITIVE_INFINITY).depth).toBe(3);
    expect(graph!.getImpact(ids.child, -1)).toMatchObject({ depth: 0, truncated: true });
    expect(graph!.findShortestPathResult(ids.child, ids.grandBase, Number.NaN).truncated)
      .toBe(false);
    expect(graph!.findShortestPathResult(
      ids.child,
      ids.grandBase,
      Number.POSITIVE_INFINITY,
    ).truncated).toBe(false);
    expect(graph!.findShortestPath(ids.child, ids.base, -1)).toBeNull();
  });

  it('keeps raw edge direction and records per-hop traversal direction', () => {
    const outgoing = graph!.findShortestPath(ids.child, ids.base);
    expect(outgoing).toEqual([
      { nodeId: ids.child, edge: null, traversalDirection: null },
      {
        nodeId: ids.base,
        edge: expect.objectContaining({ source: ids.child, target: ids.base, kind: 'extends' }),
        traversalDirection: 'outgoing',
      },
    ]);

    const incoming = graph!.findShortestPath(ids.base, ids.child);
    expect(incoming).toEqual([
      { nodeId: ids.base, edge: null, traversalDirection: null },
      {
        nodeId: ids.child,
        edge: expect.objectContaining({ source: ids.child, target: ids.base, kind: 'extends' }),
        traversalDirection: 'incoming',
      },
    ]);
  });

  it('resolves exact ID, exact qualified name, or one simple name without FTS ranking', () => {
    expect(graph!.resolveNode(ids.child)).toMatchObject({ status: 'resolved', strategy: 'id' });
    expect(graph!.resolveNode('Module.Child')).toMatchObject({
      status: 'resolved',
      strategy: 'qualifiedName',
      node: { id: ids.child },
    });
    expect(graph!.resolveNode('Child')).toMatchObject({
      status: 'resolved',
      strategy: 'simpleName',
      node: { id: ids.child },
    });
    expect(graph!.resolveNode('Duplicate')).toMatchObject({
      status: 'ambiguous',
      strategy: 'simpleName',
      candidates: [{ id: ids.duplicateA }, { id: ids.duplicateB }],
    });
    expect(graph!.resolveNode('DoesNotExist')).toEqual({
      status: 'not_found',
      query: 'DoesNotExist',
      strategy: 'none',
      candidates: [],
    });
  });

  it('renders outgoing and incoming human path arrows with one hop', async () => {
    const outgoing = await runCli(root, ['kg', 'path', 'Child', 'Base']);
    expect(outgoing.exitCode).toBeUndefined();
    expect(outgoing.stdout).toContain('Path (1 hops):');
    expect(outgoing.stdout).toContain('--[extends]-->');

    const incoming = await runCli(root, ['kg', 'path', 'Base', 'Child']);
    expect(incoming.exitCode).toBeUndefined();
    expect(incoming.stdout).toContain('Path (1 hops):');
    expect(incoming.stdout).toContain('<--[extends]--');
  });

  it('returns stable ambiguity JSON and never starts hierarchy traversal', async () => {
    const traversal = vi.spyOn(MaestroGraph.prototype, 'getTypeHierarchy');
    const output = await runCli(root, ['kg', 'hierarchy', 'Duplicate', '--json']);

    expect(output.exitCode).toBe(1);
    expect(JSON.parse(output.stdout)).toEqual({
      error: {
        code: 'ambiguous_node',
        query: 'Duplicate',
        strategy: 'simpleName',
        candidates: [ids.duplicateA, ids.duplicateB],
      },
    });
    expect(traversal).not.toHaveBeenCalled();
  });

  it('keeps CLI and MCP hierarchy, impact, and path payloads identical', async () => {
    expect(KG_MCP_TOOLS.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'maestro_kg_hierarchy',
      'maestro_kg_impact',
      'maestro_kg_path',
    ]));

    const cases = [
      {
        cli: ['kg', 'hierarchy', 'Child', '--direction', 'parents', '--depth', '1', '--json'],
        tool: 'maestro_kg_hierarchy',
        input: { symbol: 'Child', direction: 'parents', depth: 1 },
      },
      {
        cli: ['kg', 'impact', 'Base', '--depth', '1', '--json'],
        tool: 'maestro_kg_impact',
        input: { symbol: 'Base', maxDepth: 1 },
      },
      {
        cli: ['kg', 'path', 'Child', 'Base', '--depth', '1', '--json'],
        tool: 'maestro_kg_path',
        input: { from: 'Child', to: 'Base', maxDepth: 1 },
      },
    ] as const;

    for (const item of cases) {
      const cli = await runCli(root, [...item.cli]);
      expect(cli.exitCode).toBeUndefined();
      const mcp = await handleMcpTool(item.tool, item.input, root);
      expect(mcp.isError).toBe(false);
      expect(JSON.parse(mcp.content[0].text)).toEqual(JSON.parse(cli.stdout));
    }
  });

  it('normalizes zero, fractional, negative, and oversized depth identically in CLI and MCP', async () => {
    const cases = [
      {
        cli: ['kg', 'hierarchy', 'Child', '--direction', 'parents', '--depth', '0', '--json'],
        tool: 'maestro_kg_hierarchy',
        input: { symbol: 'Child', direction: 'parents', depth: 0 },
      },
      {
        cli: ['kg', 'impact', 'Base', '--depth', '-2', '--json'],
        tool: 'maestro_kg_impact',
        input: { symbol: 'Base', maxDepth: -2 },
      },
      {
        cli: ['kg', 'path', 'Child', 'UIResponder', '--depth', '1.5', '--json'],
        tool: 'maestro_kg_path',
        input: { from: 'Child', to: 'UIResponder', maxDepth: 1.5 },
      },
      {
        cli: ['kg', 'impact', 'Base', '--depth', '999', '--json'],
        tool: 'maestro_kg_impact',
        input: { symbol: 'Base', maxDepth: 999 },
      },
    ] as const;

    for (const item of cases) {
      const cli = await runCli(root, [...item.cli]);
      const mcp = await handleMcpTool(item.tool, item.input, root);
      const cliPayload = JSON.parse(cli.stdout);
      expect(mcp.isError).toBe(
        item.tool === 'maestro_kg_path' && cliPayload.truncated === true,
      );
      expect(JSON.parse(mcp.content[0].text)).toEqual(cliPayload);
    }
  });

  it('returns the same structured ambiguity for every CLI and MCP traversal surface', async () => {
    const hierarchy = vi.spyOn(MaestroGraph.prototype, 'getTypeHierarchy');
    const impact = vi.spyOn(MaestroGraph.prototype, 'getImpact');
    const path = vi.spyOn(MaestroGraph.prototype, 'findShortestPath');
    const expected = {
      error: {
        code: 'ambiguous_node',
        query: 'Duplicate',
        strategy: 'simpleName',
        candidates: [ids.duplicateA, ids.duplicateB],
      },
    };
    const cases = [
      {
        cli: ['kg', 'hierarchy', 'Duplicate', '--json'],
        tool: 'maestro_kg_hierarchy',
        input: { symbol: 'Duplicate' },
      },
      {
        cli: ['kg', 'impact', 'Duplicate', '--json'],
        tool: 'maestro_kg_impact',
        input: { symbol: 'Duplicate' },
      },
      {
        cli: ['kg', 'path', 'Duplicate', 'Base', '--json'],
        tool: 'maestro_kg_path',
        input: { from: 'Duplicate', to: 'Base' },
      },
    ];

    for (const item of cases) {
      const cli = await runCli(root, item.cli);
      expect(cli.exitCode).toBe(1);
      expect(JSON.parse(cli.stdout)).toEqual(expected);
      const mcp = await handleMcpTool(item.tool, item.input, root);
      expect(mcp.isError).toBe(true);
      expect(JSON.parse(mcp.content[0].text)).toEqual(expected);
    }
    expect(hierarchy).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
    expect(path).not.toHaveBeenCalled();
  });

  it('reports structural/external stats and authoritative schema/integrity/worker health', async () => {
    const stats = graph!.getStats();
    expect(stats.structuralRefs).toMatchObject({
      total: 1,
      status: { pending: 1, resolved: 0, ambiguous: 0, not_found: 0 },
      relation: { extends: 1 },
      language: { swift: 1 },
    });
    expect(stats.externalNodes).toEqual({
      total: 2,
      appleCatalog: 1,
      exactSurfaces: 1,
      language: { objc: 2 },
    });
    const statsCli = await runCli(root, ['kg', 'stats', '--json']);
    expect(JSON.parse(statsCli.stdout)).toMatchObject({
      schemaVersion: KG_SCHEMA_VERSION,
      structuralRefs: stats.structuralRefs,
      externalNodes: stats.externalNodes,
    });

    expect(() => writeSyncState(root, null, null, '', {
      beforeSuccessWrite: () => { throw new Error('worker fault'); },
    })).toThrow('worker fault');
    const health = graph!.getHealth();
    expect(health).toMatchObject({
      status: 'fail',
      schemaVersion: KG_SCHEMA_VERSION,
      integrity: { ok: true, messages: ['ok'] },
      foreignKeys: { ok: true, violations: [] },
      syncState: { status: 'error', stale: true, error: 'worker fault' },
      lastAttempt: { status: 'failed', error: 'worker fault' },
      structuralRefs: {
        total: 1,
        unresolved: 1,
        unresolvedRatio: 1,
        ambiguousRatio: 0,
        notFoundRatio: 0,
      },
    });
    const healthCli = await runCli(root, ['kg', 'health', '--json']);
    expect(healthCli.exitCode).toBe(1);
    expect(JSON.parse(healthCli.stdout)).toMatchObject({
      status: 'fail',
      schemaVersion: KG_SCHEMA_VERSION,
      integrity: { ok: true, messages: ['ok'] },
      foreignKeys: { ok: true, violations: [] },
      lastAttempt: { status: 'failed', error: 'worker fault' },
      structuralRefs: { unresolvedRatio: 1 },
    });
  });

  it('fails health for a resolved reference whose target and origin edge were removed', () => {
    const queries = graph!.getQueryBuilder();
    const reference = pendingReference();
    queries.updateStructuralReferenceResolution(reference.refKey, {
      status: 'resolved',
      resolvedNodeId: ids.base,
      candidates: [ids.base],
      strategy: 'exact-qualified-name',
      confidence: 1,
    });
    queries.upsertStructuralEdge({
      source: ids.child,
      target: ids.base,
      kind: 'extends',
      originRefKey: reference.refKey,
      provenance: 'structural-resolver',
    });
    queries.deleteNode(ids.base);

    expect(graph!.getHealth()).toMatchObject({
      status: 'fail',
      foreignKeys: { ok: true },
      structuralRefs: {
        unresolved: 1,
        invariants: {
          invalidResolved: 1,
          resolvedWithoutTarget: 1,
          resolvedWithoutOriginEdge: 0,
          invalidOriginEdge: 0,
        },
      },
    });
  });

  it('fails health on a future schema and returns stable JSON when structural_refs is missing', async () => {
    const futureSchemaVersion = KG_SCHEMA_VERSION + 1;
    graph!.rawDb.prepare(
      'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
    ).run(futureSchemaVersion, Date.now(), 'future fixture');
    const future = await runCli(root, ['kg', 'health', '--json']);
    expect(future.exitCode).toBe(1);
    expect(JSON.parse(future.stdout)).toMatchObject({
      status: 'fail',
      schemaVersion: futureSchemaVersion,
      integrity: { ok: true },
      foreignKeys: { ok: true },
    });

    graph!.rawDb.exec('DROP TABLE structural_refs');
    const missingTable = await runCli(root, ['kg', 'health', '--json']);
    expect(missingTable.exitCode).toBe(1);
    const payload = JSON.parse(missingTable.stdout);
    expect(payload.status).toBe('fail');
    expect(payload.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/stats:.*structural_refs/i),
    ]));
  });
});

async function runCli(
  root: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation(value => { stdout.push(String(value)); });
  const error = vi.spyOn(console, 'error').mockImplementation(value => { stderr.push(String(value)); });
  process.exitCode = undefined;
  try {
    process.chdir(root);
    const program = new Command();
    program.exitOverride();
    registerKgCommands(program);
    await program.parseAsync(['node', 'maestro', ...args]);
    return {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exitCode: process.exitCode,
    };
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}
