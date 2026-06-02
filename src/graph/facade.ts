import { existsSync } from 'node:fs';
import { loadGraph } from './loader.js';
import { searchNodes as searchNodesJson, findPath as findPathJson, diffChanges as diffChangesJson } from './query.js';
import { DatabaseConnection, getDatabasePath } from './db/connection.js';
import { QueryBuilder } from './db/queries.js';
import { GraphTraverser } from './traversal.js';
import { GraphQueryManager } from './graph-queries.js';
import { IncrementalSync } from './sync/incremental-sync.js';
import { parseQuery } from './search/query-parser.js';
import type {
  KnowledgeGraph, GraphNode, EnhancedNode, EnhancedEdge,
  Subgraph, GraphStats, NodeKind, NodeContext,
  PathResult, DiffResult,
} from './types.js';

export type GraphBackend = 'sqlite' | 'json' | 'none';

export function detectBackend(projectRoot?: string): GraphBackend {
  const dbPath = getDatabasePath(projectRoot);
  if (existsSync(dbPath)) return 'sqlite';
  try {
    loadGraph();
    return 'json';
  } catch {
    return 'none';
  }
}

export class GraphFacade {
  private backend: GraphBackend;
  private conn: DatabaseConnection | null = null;
  private queries: QueryBuilder | null = null;
  private manager: GraphQueryManager | null = null;
  private traverser: GraphTraverser | null = null;
  private jsonGraph: KnowledgeGraph | null = null;

  constructor(projectRoot?: string) {
    this.backend = detectBackend(projectRoot);

    if (this.backend === 'sqlite') {
      this.conn = new DatabaseConnection();
      this.conn.open(getDatabasePath(projectRoot));
      this.queries = new QueryBuilder(this.conn);
      this.manager = new GraphQueryManager(this.queries);
      this.traverser = new GraphTraverser(this.queries);
    } else if (this.backend === 'json') {
      this.jsonGraph = loadGraph();
    }
  }

  getBackend(): GraphBackend {
    return this.backend;
  }

  close(): void {
    this.conn?.close();
    this.conn = null;
  }

  search(query: string, opts?: { limit?: number; type?: string }): Array<{ id: string; kind: string; name: string; filePath?: string; summary?: string }> {
    if (this.backend === 'sqlite' && this.queries) {
      const parsed = parseQuery(query);
      const nodes = this.queries.searchNodes(parsed.text || query, {
        kinds: parsed.kinds.length > 0 ? parsed.kinds : undefined,
        languages: parsed.languages.length > 0 ? parsed.languages : undefined,
        pathFilters: parsed.pathFilters.length > 0 ? parsed.pathFilters : undefined,
        nameFilters: parsed.nameFilters.length > 0 ? parsed.nameFilters : undefined,
        limit: opts?.limit ?? 10,
      });
      return nodes.map(n => ({
        id: n.id, kind: n.kind, name: n.name, filePath: n.filePath,
        summary: n.signature || n.docstring,
      }));
    }

    if (this.jsonGraph) {
      const results = searchNodesJson(this.jsonGraph, query, { limit: opts?.limit, type: opts?.type });
      return results.map(n => ({
        id: n.id, kind: n.type, name: n.name, filePath: n.filePath,
        summary: n.summary,
      }));
    }
    return [];
  }

  findPath(fromId: string, toId: string): PathResult | null {
    if (this.jsonGraph) {
      const result = findPathJson(this.jsonGraph, fromId, toId);
      return result.found ? result : null;
    }
    if (this.traverser) {
      const path = this.traverser.findPath(fromId, toId);
      if (!path) return null;
      return {
        from: fromId,
        to: toId,
        found: true,
        length: path.length - 1,
        steps: path.map((step, i) => ({
          node: step.node.id,
          type: step.node.kind,
          name: step.node.name,
          edgeToNext: i < path.length - 1 ? path[i + 1]?.edge?.kind : undefined,
        })),
      };
    }
    return null;
  }

  diffChanges(changedFiles: string[]): DiffResult {
    if (this.jsonGraph) return diffChangesJson(this.jsonGraph, changedFiles);

    if (this.queries && this.traverser) {
      const direct: GraphNode[] = [];
      const impactedIds = new Set<string>();

      for (const file of changedFiles) {
        const nodes = this.queries.getNodesByFile(file);
        for (const n of nodes) {
          direct.push({ id: n.id, type: n.kind, name: n.name, filePath: n.filePath, summary: n.signature || n.docstring, tags: [n.kind] });
          const impact = this.traverser.getImpactRadius(n.id, 1);
          for (const impacted of impact.nodes.values()) {
            if (!direct.some(d => d.id === impacted.id)) impactedIds.add(impacted.id);
          }
        }
      }

      const impacted: GraphNode[] = [];
      if (impactedIds.size > 0) {
        const impactedNodes = this.queries.getNodesByIds([...impactedIds]);
        for (const n of impactedNodes.values()) {
          impacted.push({ id: n.id, type: n.kind, name: n.name, filePath: n.filePath, summary: n.signature || n.docstring, tags: [n.kind] });
        }
      }
      return { changedFiles, direct, impacted };
    }
    return { changedFiles, direct: [], impacted: [] };
  }

  stats(): GraphStats | null {
    if (this.queries && this.conn) {
      return this.queries.getStats(this.conn.getSize());
    }
    return null;
  }

  // SQLite-only methods

  getCallers(nodeId: string, depth?: number): Array<{ node: EnhancedNode; edge: EnhancedEdge }> {
    this.requireSqlite('getCallers');
    return this.traverser!.getCallers(nodeId, depth ?? 2);
  }

  getCallees(nodeId: string, depth?: number): Array<{ node: EnhancedNode; edge: EnhancedEdge }> {
    this.requireSqlite('getCallees');
    return this.traverser!.getCallees(nodeId, depth ?? 2);
  }

  getImpactRadius(nodeId: string, depth?: number): Subgraph {
    this.requireSqlite('getImpactRadius');
    return this.traverser!.getImpactRadius(nodeId, depth ?? 3);
  }

  findDeadCode(kinds?: NodeKind[]): EnhancedNode[] {
    this.requireSqlite('findDeadCode');
    return this.manager!.findDeadCode(kinds);
  }

  findCircularDependencies(): string[][] {
    this.requireSqlite('findCircularDependencies');
    return this.manager!.findCircularDependencies();
  }

  getContext(nodeId: string): NodeContext {
    this.requireSqlite('getContext');
    return this.manager!.getContext(nodeId);
  }

  getNodeMetrics(nodeId: string) {
    this.requireSqlite('getNodeMetrics');
    return this.manager!.getNodeMetrics(nodeId);
  }

  sync(): { filesChanged: number; durationMs: number } {
    this.requireSqlite('sync');
    const sync = new IncrementalSync(process.cwd(), this.conn!);
    const result = sync.sync();
    return { filesChanged: result.filesChanged, durationMs: result.durationMs };
  }

  private requireSqlite(method: string): void {
    if (this.backend !== 'sqlite') {
      throw new Error(`${method}() requires SQLite backend. Run "maestro kg index --sqlite" first.`);
    }
  }
}
