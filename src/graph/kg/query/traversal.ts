// src/graph/kg/query/traversal.ts — 图遍历 (BFS/DFS)
// 参考: codegraph/src/graph/traversal.ts

import type { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode, UnifiedEdge } from '../db/types.js';

// ---------------------------------------------------------------------------
// 遍历结果
// ---------------------------------------------------------------------------

export interface TraversalResult {
  nodes: Map<string, UnifiedNode>;
  edges: UnifiedEdge[];
  visited: Set<string>;
}

export interface TraversalOptions {
  /** 最大深度 */
  maxDepth?: number;
  /** 边类型过滤 */
  edgeKinds?: string[];
  /** 方向: outgoing/incoming/both */
  direction?: 'outgoing' | 'incoming' | 'both';
  /** 最大节点数限制 */
  maxNodes?: number;
}

// ---------------------------------------------------------------------------
// BFS 广度优先遍历
// ---------------------------------------------------------------------------

export function bfs(
  queries: KgQueryBuilder,
  startNodeId: string,
  options?: TraversalOptions,
): TraversalResult {
  const maxDepth = options?.maxDepth ?? 2;
  const direction = options?.direction ?? 'both';
  const maxNodes = options?.maxNodes ?? 200;
  const edgeKinds = options?.edgeKinds ? new Set(options.edgeKinds) : null;

  const visited = new Set<string>([startNodeId]);
  const nodes = new Map<string, UnifiedNode>();
  const edges: UnifiedEdge[] = [];

  // 加载起始节点
  const startNode = queries.getNode(startNodeId);
  if (startNode) nodes.set(startNodeId, startNode);

  let frontier = [startNodeId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    if (nodes.size >= maxNodes) break;

    // 批量获取整层 frontier 的邻居边
    const neighbors = getNeighborsBatch(queries, frontier, direction, edgeKinds);

    const nextFrontier: string[] = [];
    const neighborIdsToLoad: string[] = [];

    for (const { edge, neighborId } of neighbors) {
      if (nodes.size + neighborIdsToLoad.length >= maxNodes) break;
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      nextFrontier.push(neighborId);
      neighborIdsToLoad.push(neighborId);
      edges.push(edge);
    }

    // 批量加载邻居节点
    if (neighborIdsToLoad.length > 0) {
      const loadedNodes = queries.getNodesByIds(neighborIdsToLoad);
      loadedNodes.forEach((node, id) => {
        nodes.set(id, node);
      });
    }

    frontier = nextFrontier;
  }

  return { nodes, edges, visited };
}

// ---------------------------------------------------------------------------
// 调用链追踪 (A→B→C→D)
// ---------------------------------------------------------------------------

export function traceCallChain(
  queries: KgQueryBuilder,
  startSymbol: string,
  options?: { maxDepth?: number; edgeKinds?: string[] },
): TraversalResult {
  return bfs(queries, startSymbol, {
    maxDepth: options?.maxDepth ?? 5,
    direction: 'outgoing',
    edgeKinds: options?.edgeKinds ?? ['calls', 'imports'],
    maxNodes: 100,
  });
}

// ---------------------------------------------------------------------------
// 调用方/被调用方
// ---------------------------------------------------------------------------

export function getCallers(
  queries: KgQueryBuilder,
  nodeId: string,
  depth: number = 1,
): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
  const result = bfs(queries, nodeId, {
    maxDepth: depth,
    direction: 'incoming',
    edgeKinds: ['calls'],
    maxNodes: 50,
  });

  const callers: Array<{ node: UnifiedNode; edge: UnifiedEdge }> = [];
  for (const edge of result.edges) {
    const node = result.nodes.get(edge.source);
    if (node) callers.push({ node, edge });
  }
  return callers;
}

export function getCallees(
  queries: KgQueryBuilder,
  nodeId: string,
  depth: number = 1,
): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
  const result = bfs(queries, nodeId, {
    maxDepth: depth,
    direction: 'outgoing',
    edgeKinds: ['calls'],
    maxNodes: 50,
  });

  const callees: Array<{ node: UnifiedNode; edge: UnifiedEdge }> = [];
  for (const edge of result.edges) {
    const node = result.nodes.get(edge.target);
    if (node) callees.push({ node, edge });
  }
  return callees;
}

// ---------------------------------------------------------------------------
// 影响半径分析
// ---------------------------------------------------------------------------

export function getImpactRadius(
  queries: KgQueryBuilder,
  nodeId: string,
  depth: number = 3,
): TraversalResult {
  return bfs(queries, nodeId, {
    maxDepth: depth,
    direction: 'outgoing',
    edgeKinds: ['calls', 'imports', 'extends', 'implements', 'references'],
    maxNodes: 200,
  });
}

// ---------------------------------------------------------------------------
// DFS 深度优先遍历
// ---------------------------------------------------------------------------

export function dfs(
  queries: KgQueryBuilder,
  startNodeId: string,
  options?: TraversalOptions,
): TraversalResult {
  const maxDepth = options?.maxDepth ?? 2;
  const direction = options?.direction ?? 'both';
  const maxNodes = options?.maxNodes ?? 200;
  const edgeKinds = options?.edgeKinds ? new Set(options.edgeKinds) : null;

  const visited = new Set<string>([startNodeId]);
  const nodes = new Map<string, UnifiedNode>();
  const edges: UnifiedEdge[] = [];

  const startNode = queries.getNode(startNodeId);
  if (startNode) nodes.set(startNodeId, startNode);

  function visit(nodeId: string, depth: number): void {
    if (depth >= maxDepth || nodes.size >= maxNodes) return;
    const neighbors = getNeighbors(queries, nodeId, direction, edgeKinds);
    for (const { edge, neighborId } of neighbors) {
      if (nodes.size >= maxNodes) return;
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      edges.push(edge);
      const node = queries.getNode(neighborId);
      if (node) nodes.set(neighborId, node);
      visit(neighborId, depth + 1);
    }
  }

  visit(startNodeId, 0);
  return { nodes, edges, visited };
}

// ---------------------------------------------------------------------------
// 类型继承树 — extends/implements 双向完整遍历
// ---------------------------------------------------------------------------

export function getTypeHierarchy(
  queries: KgQueryBuilder,
  nodeId: string,
): TraversalResult {
  const edgeKindSet = new Set(['extends', 'implements']);
  const visited = new Set<string>([nodeId]);
  const nodes = new Map<string, UnifiedNode>();
  const edges: UnifiedEdge[] = [];

  const startNode = queries.getNode(nodeId);
  if (startNode) nodes.set(nodeId, startNode);

  // 向上遍历（parents: incoming extends/implements）
  let upFrontier = [nodeId];
  while (upFrontier.length > 0) {
    const next: string[] = [];
    const incomingByNode = queries.getIncomingEdgesBatch(upFrontier);
    for (const nid of upFrontier) {
      const incoming = incomingByNode.get(nid) ?? [];
      for (const edge of incoming) {
        if (!edgeKindSet.has(edge.kind)) continue;
        if (visited.has(edge.source)) continue;
        visited.add(edge.source);
        edges.push(edge);
        next.push(edge.source);
      }
    }
    queries.getNodesByIds(next).forEach((node, id) => nodes.set(id, node));
    upFrontier = next;
  }

  // 向下遍历（children: outgoing extends/implements）
  let downFrontier = [nodeId];
  while (downFrontier.length > 0) {
    const next: string[] = [];
    const outgoingByNode = queries.getOutgoingEdgesBatch(downFrontier);
    for (const nid of downFrontier) {
      const outgoing = outgoingByNode.get(nid) ?? [];
      for (const edge of outgoing) {
        if (!edgeKindSet.has(edge.kind)) continue;
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        edges.push(edge);
        next.push(edge.target);
      }
    }
    queries.getNodesByIds(next).forEach((node, id) => nodes.set(id, node));
    downFrontier = next;
  }

  return { nodes, edges, visited };
}

// ---------------------------------------------------------------------------
// 查找所有使用点 — 所有 incoming edge 的 source 节点
// ---------------------------------------------------------------------------

export function findUsages(
  queries: KgQueryBuilder,
  nodeId: string,
): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
  const incoming = queries.getIncomingEdges(nodeId);
  const nodes = queries.getNodesByIds(incoming.map(edge => edge.source));
  const result: Array<{ node: UnifiedNode; edge: UnifiedEdge }> = [];
  for (const edge of incoming) {
    const node = nodes.get(edge.source);
    if (node) result.push({ node, edge });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 祖先链 — 沿 contains 边向上回溯
// ---------------------------------------------------------------------------

export function getAncestors(
  queries: KgQueryBuilder,
  nodeId: string,
): UnifiedNode[] {
  const ancestors: UnifiedNode[] = [];
  const seen = new Set<string>([nodeId]);
  let current = nodeId;

  while (true) {
    const incoming = queries.getIncomingEdges(current);
    const containsEdge = incoming.find(e => e.kind === 'contains' && !seen.has(e.source));
    if (!containsEdge) break;
    seen.add(containsEdge.source);
    const parent = queries.getNode(containsEdge.source);
    if (!parent) break;
    ancestors.push(parent);
    current = containsEdge.source;
  }

  return ancestors;
}

// ---------------------------------------------------------------------------
// 直接子节点 — contains 边的 target
// ---------------------------------------------------------------------------

export function getChildren(
  queries: KgQueryBuilder,
  nodeId: string,
): UnifiedNode[] {
  const outgoing = queries.getOutgoingEdges(nodeId);
  const nodes = queries.getNodesByIds(outgoing.filter(edge => edge.kind === 'contains').map(edge => edge.target));
  const children: UnifiedNode[] = [];
  for (const edge of outgoing) {
    if (edge.kind !== 'contains') continue;
    const child = nodes.get(edge.target);
    if (child) children.push(child);
  }
  return children;
}

// ---------------------------------------------------------------------------
// 双向调用图 — callers + callees 合并为完整子图
// ---------------------------------------------------------------------------

export function getCallGraph(
  queries: KgQueryBuilder,
  nodeId: string,
  depth: number = 2,
): TraversalResult {
  return bfs(queries, nodeId, {
    maxDepth: depth,
    direction: 'both',
    edgeKinds: ['calls', 'references', 'imports'],
    maxNodes: 200,
  });
}

// ---------------------------------------------------------------------------
// 完整上下文 — 七要素聚合
// ---------------------------------------------------------------------------

export interface NodeContext {
  focal: UnifiedNode;
  ancestors: UnifiedNode[];
  children: UnifiedNode[];
  incomingRefs: Array<{ node: UnifiedNode; edge: UnifiedEdge }>;
  outgoingRefs: Array<{ node: UnifiedNode; edge: UnifiedEdge }>;
  typeHierarchy: TraversalResult;
}

export function getNodeContext(
  queries: KgQueryBuilder,
  nodeId: string,
): NodeContext | null {
  const focal = queries.getNode(nodeId);
  if (!focal) return null;

  const ancestors = getAncestors(queries, nodeId);
  const children = getChildren(queries, nodeId);

  const incomingRefs: Array<{ node: UnifiedNode; edge: UnifiedEdge }> = [];
  for (const edge of queries.getIncomingEdges(nodeId)) {
    if (edge.kind === 'contains') continue;
    const node = queries.getNode(edge.source);
    if (node) incomingRefs.push({ node, edge });
  }

  const outgoingRefs: Array<{ node: UnifiedNode; edge: UnifiedEdge }> = [];
  for (const edge of queries.getOutgoingEdges(nodeId)) {
    if (edge.kind === 'contains') continue;
    const node = queries.getNode(edge.target);
    if (node) outgoingRefs.push({ node, edge });
  }

  const typeHierarchy = getTypeHierarchy(queries, nodeId);

  return { focal, ancestors, children, incomingRefs, outgoingRefs, typeHierarchy };
}

// ---------------------------------------------------------------------------
// 文件级依赖 — imports 边聚合到文件层
// ---------------------------------------------------------------------------

export function getFileDependencies(
  queries: KgQueryBuilder,
  filePath: string,
): string[] {
  const fileNodes = queries.getNodesByFile(filePath);
  const depFiles = new Set<string>();
  const outgoingByNode = queries.getOutgoingEdgesBatch(fileNodes.map(node => node.id));
  const targetIds: string[] = [];
  for (const outgoing of outgoingByNode.values()) {
    for (const edge of outgoing) {
      if (edge.kind === 'imports') targetIds.push(edge.target);
    }
  }
  for (const target of queries.getNodesByIds(targetIds).values()) {
    if (target.filePath && target.filePath !== filePath) depFiles.add(target.filePath);
  }
  return [...depFiles];
}

export function getFileDependents(
  queries: KgQueryBuilder,
  filePath: string,
): string[] {
  const fileNodes = queries.getNodesByFile(filePath);
  const depFiles = new Set<string>();
  const incomingByNode = queries.getIncomingEdgesBatch(fileNodes.map(node => node.id));
  const sourceIds: string[] = [];
  for (const incoming of incomingByNode.values()) {
    for (const edge of incoming) {
      if (edge.kind === 'imports') sourceIds.push(edge.source);
    }
  }
  for (const source of queries.getNodesByIds(sourceIds).values()) {
    if (source.filePath && source.filePath !== filePath) depFiles.add(source.filePath);
  }
  return [...depFiles];
}

// ---------------------------------------------------------------------------
// 死代码检测 — 无引用的非导出符号
// ---------------------------------------------------------------------------

export function findDeadCode(
  queries: KgQueryBuilder,
  options?: { kinds?: string[] },
): UnifiedNode[] {
  const allNodes = queries.searchCodeFTS('*', { limit: 10000 });
  const deadNodes: UnifiedNode[] = [];
  const kinds = options?.kinds ? new Set(options.kinds) : null;
  const incomingByNode = queries.getIncomingEdgesBatch(allNodes.map(node => node.id));

  for (const node of allNodes) {
    if (kinds && !kinds.has(node.kind)) continue;
    if (node.isExported) continue;
    const incoming = incomingByNode.get(node.id) ?? [];
    const hasExternalRef = incoming.some(e => e.kind !== 'contains');
    if (!hasExternalRef) deadNodes.push(node);
  }
  return deadNodes;
}

// ---------------------------------------------------------------------------
// 节点指标 — 六维度量
// ---------------------------------------------------------------------------

export interface NodeMetrics {
  incomingEdgeCount: number;
  outgoingEdgeCount: number;
  callCount: number;
  callerCount: number;
  childCount: number;
  depth: number;
}

export function getNodeMetrics(
  queries: KgQueryBuilder,
  nodeId: string,
): NodeMetrics | null {
  const node = queries.getNode(nodeId);
  if (!node) return null;

  const incoming = queries.getIncomingEdges(nodeId);
  const outgoing = queries.getOutgoingEdges(nodeId);

  return {
    incomingEdgeCount: incoming.length,
    outgoingEdgeCount: outgoing.length,
    callCount: outgoing.filter(e => e.kind === 'calls').length,
    callerCount: incoming.filter(e => e.kind === 'calls').length,
    childCount: outgoing.filter(e => e.kind === 'contains').length,
    depth: getAncestors(queries, nodeId).length,
  };
}

// ---------------------------------------------------------------------------
// 最短路径 (BFS) — 返回完整路径含边信息
// ---------------------------------------------------------------------------

export interface PathStep {
  nodeId: string;
  edge: UnifiedEdge | null;
}

export function findShortestPath(
  queries: KgQueryBuilder,
  fromId: string,
  toId: string,
  maxDepth: number = 10,
): PathStep[] | null {
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, { from: string; edge: UnifiedEdge }>();
  let frontier = [fromId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    const neighbors = getNeighborsBatch(queries, frontier, 'both', null);
    for (const { neighborId, edge } of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const from = frontier.includes(edge.source) ? edge.source : edge.target;
        parent.set(neighborId, { from, edge });
        nextFrontier.push(neighborId);

        if (neighborId === toId) {
          const path: PathStep[] = [{ nodeId: toId, edge: null }];
          let current = toId;
          while (parent.has(current)) {
            const p = parent.get(current)!;
            path.unshift({ nodeId: p.from, edge: p.edge });
            current = p.from;
          }
          return path;
        }
    }

    frontier = nextFrontier;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

interface Neighbor {
  edge: UnifiedEdge;
  neighborId: string;
}

function getNeighbors(
  queries: KgQueryBuilder,
  nodeId: string,
  direction: 'outgoing' | 'incoming' | 'both',
  edgeKinds: Set<string> | null,
): Neighbor[] {
  const neighbors: Neighbor[] = [];

  if (direction === 'outgoing' || direction === 'both') {
    const outgoing = queries.getOutgoingEdges(nodeId);
    for (const edge of outgoing) {
      if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
      neighbors.push({ edge, neighborId: edge.target });
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const incoming = queries.getIncomingEdges(nodeId);
    for (const edge of incoming) {
      if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
      neighbors.push({ edge, neighborId: edge.source });
    }
  }

  return neighbors;
}

/** 批量获取多个节点的邻居 — 整层 frontier 一次 SQL 查询 */
function getNeighborsBatch(
  queries: KgQueryBuilder,
  nodeIds: string[],
  direction: 'outgoing' | 'incoming' | 'both',
  edgeKinds: Set<string> | null,
): Neighbor[] {
  const neighbors: Neighbor[] = [];

  if (direction === 'outgoing' || direction === 'both') {
    const outgoingMap = queries.getOutgoingEdgesBatch(nodeIds);
    outgoingMap.forEach((edges) => {
      for (const edge of edges) {
        if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
        neighbors.push({ edge, neighborId: edge.target });
      }
    });
  }

  if (direction === 'incoming' || direction === 'both') {
    const incomingMap = queries.getIncomingEdgesBatch(nodeIds);
    incomingMap.forEach((edges) => {
      for (const edge of edges) {
        if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
        neighbors.push({ edge, neighborId: edge.source });
      }
    });
  }

  return neighbors;
}
