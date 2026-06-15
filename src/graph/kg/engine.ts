// src/graph/kg/engine.ts — MaestroGraph 主入口类
// 参考: plan-maestrograph.md Gap C8 — CodeGraph Public Lifecycle API

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { KgDatabaseConnection, KgQueryBuilder, getKgDatabasePath } from './db/index.js';
import type { UnifiedNode, UnifiedEdge, UnifiedGraphStats, SyncResult, ResolutionResult, ExtractionResult, SourceType } from './db/types.js';
import { resolveKnowledgeEdges as resolveKnowledgeEdgesImpl } from './resolution/knowledge-resolver.js';
import type { KnowledgeResolutionResult } from './resolution/knowledge-resolver.js';
import { bfs, getCallers as getCallersImpl, getCallees as getCalleesImpl, getImpactRadius } from './query/traversal.js';
import type { TraversalResult } from './query/traversal.js';
import { searchUnified as searchUnifiedImpl } from './query/search.js';
import type { UnifiedSearchOutput } from './query/search.js';
import { buildContext as buildContextImpl } from './query/context-builder.js';
import type { BuiltContext } from './query/context-builder.js';

export class MaestroGraph {
  private conn: KgDatabaseConnection | null = null;
  private queries: KgQueryBuilder | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  static async init(projectRoot: string): Promise<MaestroGraph> {
    const mg = new MaestroGraph(projectRoot);
    const dbPath = getKgDatabasePath(projectRoot);
    mg.conn = new KgDatabaseConnection();
    mg.conn.initialize(dbPath);
    mg.queries = new KgQueryBuilder(mg.conn);
    return mg;
  }

  static async open(projectRoot: string): Promise<MaestroGraph> {
    const mg = new MaestroGraph(projectRoot);
    const dbPath = getKgDatabasePath(projectRoot);
    if (!existsSync(dbPath)) {
      throw new Error(`MaestroGraph not initialized. Run "maestro kg init" first. Expected: ${dbPath}`);
    }
    mg.conn = new KgDatabaseConnection();
    mg.conn.open(dbPath);
    mg.queries = new KgQueryBuilder(mg.conn);
    return mg;
  }

  static isInitialized(projectRoot: string): boolean {
    return existsSync(getKgDatabasePath(projectRoot));
  }

  close(): void {
    this.conn?.close();
    this.conn = null;
    this.queries = null;
  }

  // ── Indexing ──────────────────────────────────────────────────────

  async indexAll(options?: { sources?: SourceType[] }): Promise<SyncResult[]> {
    const { syncKnowledgeGraph } = await import('./extraction/orchestrator.js');
    return syncKnowledgeGraph(this.projectRoot, { sources: options?.sources });
  }

  async indexKnowledge(options?: { sources?: SourceType[] }): Promise<SyncResult[]> {
    const knowledgeSources: SourceType[] = options?.sources
      ?? ['domain', 'spec', 'knowhow', 'codebase', 'issue'];
    const { syncKnowledgeGraph } = await import('./extraction/orchestrator.js');
    return syncKnowledgeGraph(this.projectRoot, { sources: knowledgeSources });
  }

  async sync(): Promise<SyncResult[]> {
    const { syncKnowledgeGraph } = await import('./extraction/orchestrator.js');
    return syncKnowledgeGraph(this.projectRoot);
  }

  resolveReferences(): ResolutionResult {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return { edgesCreated: 0, edges: [], durationMs: 0 };
  }

  resolveKnowledgeEdges(): KnowledgeResolutionResult {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return resolveKnowledgeEdgesImpl(this.conn.raw, { projectPath: this.projectRoot });
  }

  // ── Query ─────────────────────────────────────────────────────────

  searchUnified(query: string, options?: { sourceTypes?: SourceType[]; limit?: number }): UnifiedSearchOutput {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return searchUnifiedImpl(this.queries, query, {
      sourceTypes: options?.sourceTypes,
      limit: options?.limit ?? 20,
    });
  }

  searchCode(query: string, options?: { kinds?: string[]; languages?: string[]; limit?: number }): UnifiedNode[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return this.queries.searchCodeFTS(query, {
      kinds: options?.kinds,
      languages: options?.languages,
      limit: options?.limit ?? 20,
    });
  }

  searchKnowledge(query: string, options?: { sourceTypes?: SourceType[]; limit?: number }): UnifiedNode[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return this.queries.searchKnowledgeFTS(query, {
      sourceTypes: options?.sourceTypes,
      limit: options?.limit ?? 20,
    });
  }

  getNode(id: string): UnifiedNode | null {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return this.queries.getNode(id);
  }

  getStats(): UnifiedGraphStats {
    if (!this.queries || !this.conn) throw new Error('MaestroGraph not open');
    return this.queries.getStats(this.conn.getSize());
  }

  getDetectedFrameworks(): string[] {
    return this.getStats().detectedFrameworks;
  }

  // ── Traversal (C8 API) ────────────────────────────────────────────

  getCallers(nodeId: string, depth: number = 1): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getCallersImpl(this.queries, nodeId, depth);
  }

  getCallees(nodeId: string, depth: number = 1): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getCalleesImpl(this.queries, nodeId, depth);
  }

  getImpact(nodeId: string, depth: number = 3): TraversalResult {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getImpactRadius(this.queries, nodeId, depth);
  }

  traverse(startId: string, options?: { maxDepth?: number; edgeKinds?: string[]; direction?: 'outgoing' | 'incoming' | 'both' }): TraversalResult {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return bfs(this.queries, startId, options);
  }

  // ── Context (C8 API) ──────────────────────────────────────────────

  buildContext(query: string, options?: { expandDepth?: number; agentType?: string }): BuiltContext {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return buildContextImpl(this.queries, query, options);
  }

  // ── Internal Access (供 CLI/MCP 消费) ──────────────────────────────

  getQueryBuilder(): KgQueryBuilder {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return this.queries;
  }

  getConnection(): KgDatabaseConnection {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return this.conn;
  }

  // ── Insertion (供 extractor 使用) ──────────────────────────────────

  insertExtractionResults(result: ExtractionResult): void {
    if (!this.queries) throw new Error('MaestroGraph not open');
    this.conn!.transaction(() => {
      this.queries!.insertNodes(result.nodes);
      this.queries!.insertEdges(result.edges);
      this.queries!.upsertFile(result.fileRecord);
    });
  }
}