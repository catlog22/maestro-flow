// src/graph/kg/engine.ts — MaestroGraph 主入口类
// 参考: plan-maestrograph.md Gap C8 — CodeGraph Public Lifecycle API

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { KgDatabaseConnection, KgQueryBuilder, getKgDatabasePath, applyMigrations } from './db/index.js';
import type { UnifiedNode, UnifiedEdge, UnifiedGraphStats, SyncResult, ResolutionResult, ExtractionResult, SourceType } from './db/types.js';
import { resolveKnowledgeEdges as resolveKnowledgeEdgesImpl } from './resolution/knowledge-resolver.js';
import type { KnowledgeResolutionResult } from './resolution/knowledge-resolver.js';
import {
  bfs, dfs as dfsImpl,
  getCallers as getCallersImpl, getCallees as getCalleesImpl,
  getImpactRadius, getCallGraph as getCallGraphImpl,
  getTypeHierarchy as getTypeHierarchyImpl,
  findUsages as findUsagesImpl,
  getAncestors as getAncestorsImpl, getChildren as getChildrenImpl,
  getNodeContext as getNodeContextImpl,
  getFileDependencies as getFileDependenciesImpl, getFileDependents as getFileDependentsImpl,
  findDeadCode as findDeadCodeImpl,
  getNodeMetrics as getNodeMetricsImpl,
  findShortestPath as findShortestPathImpl,
} from './query/traversal.js';
import type { TraversalResult, NodeContext, NodeMetrics, PathStep } from './query/traversal.js';
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
    try { applyMigrations(mg.conn); } catch { /* best-effort migration on open */ }
    mg.queries = new KgQueryBuilder(mg.conn);
    return mg;
  }

  static isInitialized(projectRoot: string): boolean {
    return existsSync(getKgDatabasePath(projectRoot));
  }

  static openSync(projectRoot: string): MaestroGraph | null {
    try {
      const dbPath = getKgDatabasePath(resolve(projectRoot));
      if (!existsSync(dbPath)) return null;
      const mg = new MaestroGraph(projectRoot);
      mg.conn = new KgDatabaseConnection();
      mg.conn.open(dbPath);
      try { applyMigrations(mg.conn); } catch { /* best-effort */ }
      mg.queries = new KgQueryBuilder(mg.conn);
      return mg;
    } catch {
      return null;
    }
  }

  get rawDb(): import('better-sqlite3').Database {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return this.conn.raw;
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

  searchUnified(query: string, options?: { sourceTypes?: SourceType[]; kinds?: string[]; limit?: number }): UnifiedSearchOutput {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return searchUnifiedImpl(this.queries, query, {
      sourceTypes: options?.sourceTypes,
      kinds: options?.kinds,
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

  traverseDFS(startId: string, options?: { maxDepth?: number; edgeKinds?: string[]; direction?: 'outgoing' | 'incoming' | 'both' }): TraversalResult {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return dfsImpl(this.queries, startId, options);
  }

  getTypeHierarchy(nodeId: string): TraversalResult {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getTypeHierarchyImpl(this.queries, nodeId);
  }

  findUsages(nodeId: string): Array<{ node: UnifiedNode; edge: UnifiedEdge }> {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return findUsagesImpl(this.queries, nodeId);
  }

  getAncestors(nodeId: string): UnifiedNode[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getAncestorsImpl(this.queries, nodeId);
  }

  getChildren(nodeId: string): UnifiedNode[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getChildrenImpl(this.queries, nodeId);
  }

  getCallGraph(nodeId: string, depth?: number): TraversalResult {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getCallGraphImpl(this.queries, nodeId, depth);
  }

  getNodeContext(nodeId: string): NodeContext | null {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getNodeContextImpl(this.queries, nodeId);
  }

  getFileDependencies(filePath: string): string[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getFileDependenciesImpl(this.queries, filePath);
  }

  getFileDependents(filePath: string): string[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getFileDependentsImpl(this.queries, filePath);
  }

  findDeadCode(options?: { kinds?: string[] }): UnifiedNode[] {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return findDeadCodeImpl(this.queries, options);
  }

  getNodeMetrics(nodeId: string): NodeMetrics | null {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return getNodeMetricsImpl(this.queries, nodeId);
  }

  findShortestPath(fromId: string, toId: string, maxDepth?: number): PathStep[] | null {
    if (!this.queries) throw new Error('MaestroGraph not open');
    return findShortestPathImpl(this.queries, fromId, toId, maxDepth);
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
    const write = (): void => {
      this.queries!.insertNodes(result.nodes);
      this.queries!.insertEdges(result.edges);
      this.queries!.upsertFile(result.fileRecord);
    };
    // 已身处事务时直接写入，避免 better-sqlite3 嵌套事务报错
    // (cannot start a transaction within a transaction)；独立调用时自开事务保证原子性。
    if (this.conn!.raw.inTransaction) {
      write();
    } else {
      this.conn!.transaction(write);
    }
  }
}