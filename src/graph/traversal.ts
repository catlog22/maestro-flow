import type { EnhancedNode, EnhancedEdge, Subgraph, TraversalOptions, EdgeKind } from './types.js';
import type { QueryBuilder } from './db/queries.js';

const DEFAULT_OPTIONS: Required<TraversalOptions> = {
  maxDepth: Infinity,
  edgeKinds: [],
  nodeKinds: [],
  direction: 'outgoing',
  limit: 1000,
  includeStart: true,
};

export class GraphTraverser {
  private queries: QueryBuilder;

  constructor(queries: QueryBuilder) {
    this.queries = queries;
  }

  traverseBFS(startId: string, options: TraversalOptions = {}): Subgraph {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startNode = this.queries.getNodeById(startId);
    if (!startNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, EnhancedNode>();
    const edges: EnhancedEdge[] = [];
    const visited = new Set<string>();
    const queue: Array<{ node: EnhancedNode; edge: EnhancedEdge | null; depth: number }> = [
      { node: startNode, edge: null, depth: 0 },
    ];

    if (opts.includeStart) nodes.set(startNode.id, startNode);

    while (queue.length > 0 && nodes.size < opts.limit) {
      const { node, edge, depth } = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (edge) edges.push(edge);
      if (depth >= opts.maxDepth) continue;

      const adjacentEdges = this.getAdjacentEdges(node.id, opts.direction, opts.edgeKinds);
      adjacentEdges.sort((a, b) => {
        const priority = (e: EnhancedEdge) => e.kind === 'contains' ? 0 : e.kind === 'calls' ? 1 : 2;
        return priority(a) - priority(b);
      });

      const wantIds = adjacentEdges
        .map(e => e.source === node.id ? e.target : e.source)
        .filter(id => !visited.has(id));
      const neighborNodes = wantIds.length > 0 ? this.queries.getNodesByIds(wantIds) : new Map();

      for (const adjEdge of adjacentEdges) {
        const nextId = adjEdge.source === node.id ? adjEdge.target : adjEdge.source;
        if (visited.has(nextId)) continue;
        const nextNode = neighborNodes.get(nextId);
        if (!nextNode) continue;
        if (opts.nodeKinds.length > 0 && !opts.nodeKinds.includes(nextNode.kind)) continue;
        nodes.set(nextNode.id, nextNode);
        queue.push({ node: nextNode, edge: adjEdge, depth: depth + 1 });
      }
    }

    return { nodes, edges, roots: [startId] };
  }

  traverseDFS(startId: string, options: TraversalOptions = {}): Subgraph {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startNode = this.queries.getNodeById(startId);
    if (!startNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, EnhancedNode>();
    const edges: EnhancedEdge[] = [];
    const visited = new Set<string>();
    if (opts.includeStart) nodes.set(startNode.id, startNode);
    this.dfsRecursive(startNode, 0, opts, nodes, edges, visited);
    return { nodes, edges, roots: [startId] };
  }

  private dfsRecursive(
    node: EnhancedNode, depth: number, opts: Required<TraversalOptions>,
    nodes: Map<string, EnhancedNode>, edges: EnhancedEdge[], visited: Set<string>,
  ): void {
    if (visited.has(node.id) || nodes.size >= opts.limit || depth >= opts.maxDepth) return;
    visited.add(node.id);

    const adjacentEdges = this.getAdjacentEdges(node.id, opts.direction, opts.edgeKinds);
    const wantIds = adjacentEdges
      .map(e => e.source === node.id ? e.target : e.source)
      .filter(id => !visited.has(id));
    const neighborNodes = wantIds.length > 0 ? this.queries.getNodesByIds(wantIds) : new Map();

    for (const edge of adjacentEdges) {
      const nextId = edge.source === node.id ? edge.target : edge.source;
      if (visited.has(nextId)) continue;
      const nextNode = neighborNodes.get(nextId);
      if (!nextNode) continue;
      if (opts.nodeKinds.length > 0 && !opts.nodeKinds.includes(nextNode.kind)) continue;
      nodes.set(nextNode.id, nextNode);
      edges.push(edge);
      this.dfsRecursive(nextNode, depth + 1, opts, nodes, edges, visited);
    }
  }

  private getAdjacentEdges(
    nodeId: string, direction: 'outgoing' | 'incoming' | 'both', edgeKinds: EdgeKind[],
  ): EnhancedEdge[] {
    const kinds = edgeKinds.length > 0 ? edgeKinds : undefined;
    if (direction === 'outgoing') return this.queries.getOutgoingEdges(nodeId, kinds);
    if (direction === 'incoming') return this.queries.getIncomingEdges(nodeId, kinds);
    return [
      ...this.queries.getOutgoingEdges(nodeId, kinds),
      ...this.queries.getIncomingEdges(nodeId, kinds),
    ];
  }

  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: EnhancedNode; edge: EnhancedEdge }> {
    const result: Array<{ node: EnhancedNode; edge: EnhancedEdge }> = [];
    const visited = new Set<string>();
    this.getCallersRecursive(nodeId, maxDepth, 0, result, visited);
    return result;
  }

  private getCallersRecursive(
    nodeId: string, maxDepth: number, currentDepth: number,
    result: Array<{ node: EnhancedNode; edge: EnhancedEdge }>, visited: Set<string>,
  ): void {
    if (currentDepth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);
    const incomingEdges = this.queries.getIncomingEdges(nodeId, ['calls', 'references', 'imports']);
    if (incomingEdges.length === 0) return;
    const callerNodes = this.queries.getNodesByIds(incomingEdges.map(e => e.source));
    for (const edge of incomingEdges) {
      const callerNode = callerNodes.get(edge.source);
      if (callerNode && !visited.has(callerNode.id)) {
        result.push({ node: callerNode, edge });
        this.getCallersRecursive(callerNode.id, maxDepth, currentDepth + 1, result, visited);
      }
    }
  }

  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: EnhancedNode; edge: EnhancedEdge }> {
    const result: Array<{ node: EnhancedNode; edge: EnhancedEdge }> = [];
    const visited = new Set<string>();
    this.getCalleesRecursive(nodeId, maxDepth, 0, result, visited);
    return result;
  }

  private getCalleesRecursive(
    nodeId: string, maxDepth: number, currentDepth: number,
    result: Array<{ node: EnhancedNode; edge: EnhancedEdge }>, visited: Set<string>,
  ): void {
    if (currentDepth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);
    const outgoingEdges = this.queries.getOutgoingEdges(nodeId, ['calls', 'references', 'imports']);
    if (outgoingEdges.length === 0) return;
    const calleeNodes = this.queries.getNodesByIds(outgoingEdges.map(e => e.target));
    for (const edge of outgoingEdges) {
      const calleeNode = calleeNodes.get(edge.target);
      if (calleeNode && !visited.has(calleeNode.id)) {
        result.push({ node: calleeNode, edge });
        this.getCalleesRecursive(calleeNode.id, maxDepth, currentDepth + 1, result, visited);
      }
    }
  }

  getCallGraph(nodeId: string, depth: number = 2): Subgraph {
    const focalNode = this.queries.getNodeById(nodeId);
    if (!focalNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, EnhancedNode>();
    const edges: EnhancedEdge[] = [];
    nodes.set(focalNode.id, focalNode);

    for (const { node, edge } of this.getCallers(nodeId, depth)) {
      nodes.set(node.id, node);
      edges.push(edge);
    }
    for (const { node, edge } of this.getCallees(nodeId, depth)) {
      nodes.set(node.id, node);
      edges.push(edge);
    }
    return { nodes, edges, roots: [nodeId] };
  }

  getTypeHierarchy(nodeId: string): Subgraph {
    const focalNode = this.queries.getNodeById(nodeId);
    if (!focalNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, EnhancedNode>();
    const edges: EnhancedEdge[] = [];
    const visited = new Set<string>();
    nodes.set(focalNode.id, focalNode);
    this.getTypeAncestors(nodeId, nodes, edges, visited);
    this.getTypeDescendants(nodeId, nodes, edges, visited);
    return { nodes, edges, roots: [nodeId] };
  }

  private getTypeAncestors(
    nodeId: string, nodes: Map<string, EnhancedNode>,
    edges: EnhancedEdge[], visited: Set<string>,
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const outEdges = this.queries.getOutgoingEdges(nodeId, ['extends', 'implements']);
    if (outEdges.length === 0) return;
    const parents = this.queries.getNodesByIds(outEdges.map(e => e.target));
    for (const edge of outEdges) {
      const parentNode = parents.get(edge.target);
      if (parentNode && !nodes.has(parentNode.id)) {
        nodes.set(parentNode.id, parentNode);
        edges.push(edge);
        this.getTypeAncestors(parentNode.id, nodes, edges, visited);
      }
    }
  }

  private getTypeDescendants(
    nodeId: string, nodes: Map<string, EnhancedNode>,
    edges: EnhancedEdge[], visited: Set<string>,
  ): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const inEdges = this.queries.getIncomingEdges(nodeId, ['extends', 'implements']);
    if (inEdges.length === 0) return;
    const children = this.queries.getNodesByIds(inEdges.map(e => e.source));
    for (const edge of inEdges) {
      const childNode = children.get(edge.source);
      if (childNode && !nodes.has(childNode.id)) {
        nodes.set(childNode.id, childNode);
        edges.push(edge);
        this.getTypeDescendants(childNode.id, nodes, edges, visited);
      }
    }
  }

  findUsages(nodeId: string): Array<{ node: EnhancedNode; edge: EnhancedEdge }> {
    const incomingEdges = this.queries.getIncomingEdges(nodeId);
    if (incomingEdges.length === 0) return [];
    const sources = this.queries.getNodesByIds(incomingEdges.map(e => e.source));
    const result: Array<{ node: EnhancedNode; edge: EnhancedEdge }> = [];
    for (const edge of incomingEdges) {
      const sourceNode = sources.get(edge.source);
      if (sourceNode) result.push({ node: sourceNode, edge });
    }
    return result;
  }

  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    const focalNode = this.queries.getNodeById(nodeId);
    if (!focalNode) return { nodes: new Map(), edges: [], roots: [] };

    const nodes = new Map<string, EnhancedNode>();
    const edges: EnhancedEdge[] = [];
    nodes.set(focalNode.id, focalNode);
    this.getImpactRecursive(nodeId, maxDepth, 0, nodes, edges, new Set());
    return { nodes, edges, roots: [nodeId] };
  }

  private getImpactRecursive(
    nodeId: string, maxDepth: number, currentDepth: number,
    nodes: Map<string, EnhancedNode>, edges: EnhancedEdge[], visited: Set<string>,
  ): void {
    if (currentDepth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const containerKinds = new Set(['class', 'interface', 'struct', 'trait', 'protocol', 'module', 'enum']);
    const focalNode = this.queries.getNodeById(nodeId);
    if (focalNode && containerKinds.has(focalNode.kind)) {
      const containsEdges = this.queries.getOutgoingEdges(nodeId, ['contains']);
      if (containsEdges.length > 0) {
        const children = this.queries.getNodesByIds(containsEdges.map(e => e.target));
        for (const edge of containsEdges) {
          const childNode = children.get(edge.target);
          if (childNode && !visited.has(childNode.id)) {
            nodes.set(childNode.id, childNode);
            edges.push(edge);
            this.getImpactRecursive(childNode.id, maxDepth, currentDepth, nodes, edges, visited);
          }
        }
      }
    }

    const incomingEdges = this.queries.getIncomingEdges(nodeId);
    if (incomingEdges.length === 0) return;
    const sources = this.queries.getNodesByIds(incomingEdges.map(e => e.source));
    for (const edge of incomingEdges) {
      const sourceNode = sources.get(edge.source);
      if (sourceNode && !nodes.has(sourceNode.id)) {
        nodes.set(sourceNode.id, sourceNode);
        edges.push(edge);
        this.getImpactRecursive(sourceNode.id, maxDepth, currentDepth + 1, nodes, edges, visited);
      }
    }
  }

  findPath(
    fromId: string, toId: string, edgeKinds: EdgeKind[] = [],
  ): Array<{ node: EnhancedNode; edge: EnhancedEdge | null }> | null {
    const fromNode = this.queries.getNodeById(fromId);
    const toNode = this.queries.getNodeById(toId);
    if (!fromNode || !toNode) return null;

    const visited = new Set<string>();
    const queue: Array<{
      nodeId: string;
      path: Array<{ node: EnhancedNode; edge: EnhancedEdge | null }>;
    }> = [{ nodeId: fromId, path: [{ node: fromNode, edge: null }] }];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (nodeId === toId) return path;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outgoingEdges = this.queries.getOutgoingEdges(
        nodeId, edgeKinds.length > 0 ? edgeKinds : undefined,
      );
      if (outgoingEdges.length === 0) continue;
      const wantIds = outgoingEdges.map(e => e.target).filter(id => !visited.has(id));
      const nextNodes = wantIds.length > 0 ? this.queries.getNodesByIds(wantIds) : new Map();

      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          const nextNode = nextNodes.get(edge.target);
          if (nextNode) queue.push({ nodeId: edge.target, path: [...path, { node: nextNode, edge }] });
        }
      }
    }
    return null;
  }

  getAncestors(nodeId: string): EnhancedNode[] {
    const ancestors: EnhancedNode[] = [];
    const visited = new Set<string>();
    let currentId = nodeId;

    while (true) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const containingEdges = this.queries.getIncomingEdges(currentId, ['contains']);
      const firstEdge = containingEdges[0];
      if (!firstEdge) break;
      const parentNode = this.queries.getNodeById(firstEdge.source);
      if (parentNode) {
        ancestors.push(parentNode);
        currentId = parentNode.id;
      } else break;
    }
    return ancestors;
  }

  getChildren(nodeId: string): EnhancedNode[] {
    const containsEdges = this.queries.getOutgoingEdges(nodeId, ['contains']);
    if (containsEdges.length === 0) return [];
    const childNodes = this.queries.getNodesByIds(containsEdges.map(e => e.target));
    const children: EnhancedNode[] = [];
    for (const edge of containsEdges) {
      const childNode = childNodes.get(edge.target);
      if (childNode) children.push(childNode);
    }
    return children;
  }
}
