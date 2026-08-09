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

export type ImpactDirection = 'outgoing' | 'incoming';

export interface ImpactResult extends TraversalResult {
  depth: number;
  traversalDirection: ImpactDirection;
  truncated: boolean;
}

export type HierarchyDirection = 'parents' | 'children' | 'both';

export interface TypeHierarchyResult extends TraversalResult {
  root: UnifiedNode | null;
  parents: UnifiedNode[];
  children: UnifiedNode[];
  rawEdges: UnifiedEdge[];
  depth: number;
  direction: HierarchyDirection;
  truncated: boolean;
}

export function normalizeTraversalDepth(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  const candidate = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(0, Math.min(candidate, max));
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
  direction: ImpactDirection = 'outgoing',
): ImpactResult {
  const maxDepth = normalizePublicDepth(depth, 3);
  const edgeKinds = new Set(['calls', 'imports', 'extends', 'implements', 'references']);
  const visited = new Set<string>([nodeId]);
  const nodes = new Map<string, UnifiedNode>();
  const rawEdges = new Map<string, UnifiedEdge>();
  const startNode = queries.getNode(nodeId);
  if (startNode) nodes.set(nodeId, startNode);
  let truncated = false;

  let frontier = [nodeId];
  for (let level = 0; level < maxDepth && frontier.length > 0; level++) {
    const edgesByNode = direction === 'outgoing'
      ? queries.getOutgoingEdgesBatch(frontier)
      : queries.getIncomingEdgesBatch(frontier);
    const next: string[] = [];
    scanLevel: for (const currentId of frontier) {
      const adjacent = (edgesByNode.get(currentId) ?? []).slice().sort(compareEdges);
      for (const edge of adjacent) {
        if (!edgeKinds.has(edge.kind)) continue;
        const neighborId = direction === 'outgoing' ? edge.target : edge.source;
        const isNew = !visited.has(neighborId);
        if (isNew && visited.size >= 200) {
          truncated = true;
          break scanLevel;
        }
        rawEdges.set(edgeIdentity(edge), edge);
        if (!isNew) continue;
        visited.add(neighborId);
        next.push(neighborId);
      }
    }
    queries.getNodesByIds(next).forEach((node, id) => nodes.set(id, node));
    frontier = next.sort(compareBytes);
    if (truncated) break;
  }

  if (!truncated && frontier.length > 0) {
    truncated = hasUnvisitedNeighbor(queries, frontier, direction, edgeKinds, visited);
  }

  return {
    nodes,
    edges: [...rawEdges.values()].sort(compareEdges),
    visited,
    depth: maxDepth,
    traversalDirection: direction,
    truncated,
  };
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
  options: { direction?: HierarchyDirection; depth?: number; maxNodes?: number } = {},
): TypeHierarchyResult {
  const direction = options.direction ?? 'both';
  // 旧版 API 默认遍历到可达边界；省略 depth 时保留该语义。
  // CLI/MCP 会显式传入深度上限，并通过 truncated 暴露未遍历完的路径。
  const requestedDepth = options.depth === undefined
    ? null
    : normalizePublicDepth(options.depth, 10);
  const depthLimit = requestedDepth ?? Number.POSITIVE_INFINITY;
  const nodeLimit = normalizeOptionalNodeLimit(options.maxNodes);
  const edgeKindSet = new Set(['extends', 'implements']);
  const allVisited = new Set<string>([nodeId]);
  const nodes = new Map<string, UnifiedNode>();
  const rawEdges = new Map<string, UnifiedEdge>();
  const parentIds = new Set<string>();
  const childIds = new Set<string>();
  let nodeLimitTruncated = false;
  let depthTruncated = false;
  let reachedDepth = 0;

  const startNode = queries.getNode(nodeId);
  if (startNode) nodes.set(nodeId, startNode);

  // inheritance edges are stored child(source) -> parent(target).
  if (direction === 'parents' || direction === 'both') {
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    for (let level = 0; level < depthLimit && frontier.length > 0 && !nodeLimitTruncated; level++) {
      const outgoingByNode = queries.getOutgoingEdgesBatch(frontier);
      const next: string[] = [];
      scanParents: for (const currentId of frontier) {
        const outgoing = (outgoingByNode.get(currentId) ?? []).slice().sort(compareEdges);
        for (const edge of outgoing) {
          if (!edgeKindSet.has(edge.kind)) continue;
          const isNewToDirection = !visited.has(edge.target);
          const isNewToHierarchy = !allVisited.has(edge.target);
          if (
            isNewToDirection
            && isNewToHierarchy
            && nodeLimit !== null
            && allVisited.size >= nodeLimit
          ) {
            nodeLimitTruncated = true;
            break scanParents;
          }
          rawEdges.set(edgeIdentity(edge), edge);
          if (!isNewToDirection) continue;
          visited.add(edge.target);
          if (isNewToHierarchy) allVisited.add(edge.target);
          parentIds.add(edge.target);
          next.push(edge.target);
        }
      }
      queries.getNodesByIds(next).forEach((node, id) => nodes.set(id, node));
      frontier = next.sort(compareBytes);
      if (frontier.length > 0) reachedDepth = Math.max(reachedDepth, level + 1);
    }
    if (requestedDepth !== null && !nodeLimitTruncated && frontier.length > 0) {
      depthTruncated ||= hasUnvisitedNeighbor(
        queries,
        frontier,
        'outgoing',
        edgeKindSet,
        visited,
      );
    }
  }

  if ((direction === 'children' || direction === 'both') && !nodeLimitTruncated) {
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    for (let level = 0; level < depthLimit && frontier.length > 0 && !nodeLimitTruncated; level++) {
      const incomingByNode = queries.getIncomingEdgesBatch(frontier);
      const next: string[] = [];
      scanChildren: for (const currentId of frontier) {
        const incoming = (incomingByNode.get(currentId) ?? []).slice().sort(compareEdges);
        for (const edge of incoming) {
          if (!edgeKindSet.has(edge.kind)) continue;
          const isNewToDirection = !visited.has(edge.source);
          const isNewToHierarchy = !allVisited.has(edge.source);
          if (
            isNewToDirection
            && isNewToHierarchy
            && nodeLimit !== null
            && allVisited.size >= nodeLimit
          ) {
            nodeLimitTruncated = true;
            break scanChildren;
          }
          rawEdges.set(edgeIdentity(edge), edge);
          if (!isNewToDirection) continue;
          visited.add(edge.source);
          if (isNewToHierarchy) allVisited.add(edge.source);
          childIds.add(edge.source);
          next.push(edge.source);
        }
      }
      queries.getNodesByIds(next).forEach((node, id) => nodes.set(id, node));
      frontier = next.sort(compareBytes);
      if (frontier.length > 0) reachedDepth = Math.max(reachedDepth, level + 1);
    }
    if (requestedDepth !== null && !nodeLimitTruncated && frontier.length > 0) {
      depthTruncated ||= hasUnvisitedNeighbor(
        queries,
        frontier,
        'incoming',
        edgeKindSet,
        visited,
      );
    }
  }

  const parents = [...parentIds]
    .map(id => nodes.get(id))
    .filter((node): node is UnifiedNode => Boolean(node))
    .sort((left, right) => compareBytes(left.id, right.id));
  const children = [...childIds]
    .map(id => nodes.get(id))
    .filter((node): node is UnifiedNode => Boolean(node))
    .sort((left, right) => compareBytes(left.id, right.id));
  const edges = [...rawEdges.values()].sort(compareEdges);

  return {
    root: startNode,
    parents,
    children,
    rawEdges: edges,
    depth: requestedDepth ?? reachedDepth,
    direction,
    truncated: nodeLimitTruncated || depthTruncated,
    nodes,
    edges,
    visited: allVisited,
  };
}

function hasUnvisitedNeighbor(
  queries: KgQueryBuilder,
  nodeIds: string[],
  direction: 'outgoing' | 'incoming' | 'both',
  edgeKinds: Set<string> | null,
  visited: Set<string>,
): boolean {
  return getNeighborsBatch(queries, nodeIds, direction, edgeKinds)
    .some(({ neighborId }) => !visited.has(neighborId));
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
  typeHierarchy: TypeHierarchyResult;
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
  traversalDirection?: 'outgoing' | 'incoming' | null;
}

export interface PathSearchResult {
  path: PathStep[] | null;
  truncated: boolean;
  visitedCount: number;
}

export function findShortestPath(
  queries: KgQueryBuilder,
  fromId: string,
  toId: string,
  maxDepth: number = 10,
): PathStep[] | null {
  return findShortestPathResult(queries, fromId, toId, maxDepth).path;
}

export function findShortestPathResult(
  queries: KgQueryBuilder,
  fromId: string,
  toId: string,
  maxDepth: number = 10,
  maxNodes?: number,
): PathSearchResult {
  if (fromId === toId) {
    const exists = Boolean(queries.getNode(fromId));
    return {
      path: exists ? [{ nodeId: fromId, edge: null, traversalDirection: null }] : null,
      truncated: false,
      visitedCount: exists ? 1 : 0,
    };
  }
  const visited = new Set<string>([fromId]);
  const parent = new Map<string, {
    from: string;
    edge: UnifiedEdge;
    traversalDirection: 'outgoing' | 'incoming';
  }>();
  const depthLimit = normalizePublicDepth(maxDepth, 10);
  const nodeLimit = normalizeOptionalNodeLimit(maxNodes);
  let frontier = [fromId];

  for (let depth = 0; depth < depthLimit && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];

    const neighbors = getNeighborsBatch(queries, frontier, 'both', null)
      .sort((left, right) => (
        compareBytes(left.neighborId, right.neighborId)
        || compareEdges(left.edge, right.edge)
        || compareBytes(left.fromNodeId, right.fromNodeId)
    ));
    for (const { neighborId, edge, fromNodeId, traversalDirection } of neighbors) {
      if (visited.has(neighborId)) continue;
      if (nodeLimit !== null && visited.size >= nodeLimit) {
        return { path: null, truncated: true, visitedCount: visited.size };
      }
      visited.add(neighborId);
      parent.set(neighborId, { from: fromNodeId, edge, traversalDirection });
      nextFrontier.push(neighborId);

      if (neighborId === toId) {
        const reversePath: PathStep[] = [];
        let current = toId;
        while (parent.has(current)) {
          const previous = parent.get(current)!;
          reversePath.push({
            nodeId: current,
            edge: previous.edge,
            traversalDirection: previous.traversalDirection,
          });
          current = previous.from;
        }
        reversePath.push({ nodeId: fromId, edge: null, traversalDirection: null });
        return {
          path: reversePath.reverse(),
          truncated: false,
          visitedCount: visited.size,
        };
      }
    }

    frontier = nextFrontier;
  }

  return {
    path: null,
    // 达到深度上限后仅在仍有未访问邻居时标记截断，叶子 frontier 不算截断。
    truncated: frontier.length > 0
      && hasUnvisitedNeighbor(queries, frontier, 'both', null, visited),
    visitedCount: visited.size,
  };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

interface Neighbor {
  edge: UnifiedEdge;
  neighborId: string;
  fromNodeId: string;
  traversalDirection: 'outgoing' | 'incoming';
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
      neighbors.push({
        edge,
        neighborId: edge.target,
        fromNodeId: nodeId,
        traversalDirection: 'outgoing',
      });
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const incoming = queries.getIncomingEdges(nodeId);
    for (const edge of incoming) {
      if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
      neighbors.push({
        edge,
        neighborId: edge.source,
        fromNodeId: nodeId,
        traversalDirection: 'incoming',
      });
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
    outgoingMap.forEach((edges, fromNodeId) => {
      for (const edge of edges) {
        if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
        neighbors.push({
          edge,
          neighborId: edge.target,
          fromNodeId,
          traversalDirection: 'outgoing',
        });
      }
    });
  }

  if (direction === 'incoming' || direction === 'both') {
    const incomingMap = queries.getIncomingEdgesBatch(nodeIds);
    incomingMap.forEach((edges, fromNodeId) => {
      for (const edge of edges) {
        if (edgeKinds && !edgeKinds.has(edge.kind)) continue;
        neighbors.push({
          edge,
          neighborId: edge.source,
          fromNodeId,
          traversalDirection: 'incoming',
        });
      }
    });
  }

  return neighbors;
}

function edgeIdentity(edge: UnifiedEdge): string {
  return edge.id !== undefined
    ? `id:${edge.id}`
    : `${edge.source}\0${edge.target}\0${edge.kind}\0${edge.originRefKey ?? ''}\0${edge.line ?? ''}\0${edge.column ?? ''}`;
}

function compareEdges(left: UnifiedEdge, right: UnifiedEdge): number {
  return compareBytes(left.source, right.source)
    || compareBytes(left.target, right.target)
    || compareBytes(left.kind, right.kind)
    || compareBytes(left.originRefKey ?? '', right.originRefKey ?? '')
    || (left.id ?? 0) - (right.id ?? 0);
}

function compareBytes(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function normalizeNodeLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function normalizeOptionalNodeLimit(value: unknown): number | null {
  return value === undefined ? null : normalizeNodeLimit(value, 1_000);
}

function normalizePublicDepth(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}
