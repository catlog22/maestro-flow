// src/graph/kg/engine.ts — MaestroGraph 主入口类
// 参考: plan-maestrograph.md Gap C8 — CodeGraph Public Lifecycle API

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { KgDatabaseConnection, KgQueryBuilder, getKgDatabasePath, applyMigrations } from './db/index.js';
import type { UnifiedNode, UnifiedEdge, UnifiedGraphStats, UnifiedSearchResult, SyncResult, ResolutionResult, ExtractionResult, SourceType } from './db/types.js';
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
import { searchUnified as searchUnifiedImpl, mergeCodeSearchResults } from './query/search.js';
import type { UnifiedSearchOutput } from './query/search.js';
import type { CodeEmbeddingIndex } from './embedding/code-embedding.js';
import { buildContext as buildContextImpl } from './query/context-builder.js';
import type { BuiltContext } from './query/context-builder.js';

export class MaestroGraph {
  private conn: KgDatabaseConnection | null = null;
  private queries: KgQueryBuilder | null = null;
  private projectRoot: string;
  private _codeEmbeddingCache: CodeEmbeddingIndex | null = null;

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

  get rawDb(): import('node:sqlite').DatabaseSync {
    if (!this.conn) throw new Error('MaestroGraph not open');
    return this.conn.raw;
  }

  close(): void {
    this.conn?.close();
    this.conn = null;
    this.queries = null;
    this._codeEmbeddingCache = null;
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

  // ── Code Embedding ────────────────────────────────────────────────

  private _getCodeEmbeddingDir(): string {
    return resolve(this.projectRoot, '.workflow', 'kg');
  }

  /**
   * Build (or incrementally rebuild) the code embedding index from all codegraph nodes.
   * Persists the index to .workflow/kg/code-embedding-index.bin and caches in memory.
   */
  async buildCodeEmbeddings(): Promise<CodeEmbeddingIndex> {
    if (!this.queries) throw new Error('MaestroGraph not open');

    const { buildCodeEmbeddingIndex, saveCodeEmbeddingIndex } = await import('./embedding/index.js');

    // Get all code nodes from the DB (only codegraph nodes are embeddable)
    const allCodeNodes = this.queries.getNodesBySourceType('codegraph');

    // Build index (incremental if cache exists)
    const index = await buildCodeEmbeddingIndex(allCodeNodes, this._codeEmbeddingCache);

    // Persist to disk
    const dir = this._getCodeEmbeddingDir();
    saveCodeEmbeddingIndex(index, dir);

    // Cache in memory
    this._codeEmbeddingCache = index;
    return index;
  }

  /**
   * Load the code embedding index from disk or return the in-memory cache.
   * Returns null if no persisted index exists.
   */
  async getCodeEmbeddingIndex(): Promise<CodeEmbeddingIndex | null> {
    if (this._codeEmbeddingCache) return this._codeEmbeddingCache;
    try {
      const { loadCodeEmbeddingIndex } = await import('./embedding/index.js');
      const dir = this._getCodeEmbeddingDir();
      const index = loadCodeEmbeddingIndex(dir);
      if (index) {
        const { getModelId } = await import('#maestro-dashboard/wiki/embedding.js');
        if (index.modelId !== getModelId()) return null;
        this._codeEmbeddingCache = index;
      }
      return index;
    } catch {
      return null;
    }
  }

  async searchHybrid(query: string, options?: { limit?: number; sourceTypes?: SourceType[] }): Promise<UnifiedSearchResult[]> {
    if (!this.queries) throw new Error('MaestroGraph not open');

    const limit = options?.limit ?? 20;

    const vecPromise = this._getVectorResults(query, limit * 2);

    const ftsOutput = searchUnifiedImpl(this.queries, query, {
      limit: limit * 2,
      sourceTypes: options?.sourceTypes,
    });

    const vecResults = await vecPromise;

    if (!vecResults || vecResults.length === 0) {
      return ftsOutput.directMatches.slice(0, limit);
    }

    return mergeCodeSearchResults(ftsOutput.directMatches, vecResults, this.queries, limit);
  }

  private async _getVectorResults(query: string, limit: number) {
    const embIdx = await this.getCodeEmbeddingIndex();
    if (!embIdx || embIdx.nodeIds.length === 0) return null;

    const { embedQuery } = await import('#maestro-dashboard/wiki/embedding.js');
    const queryVec = await embedQuery(query);
    if (!queryVec) return null;

    const { searchCodeVectors } = await import('./embedding/index.js');
    return searchCodeVectors(queryVec, embIdx, limit);
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
    this.conn!.transaction(() => {
      this.queries!.insertNodes(result.nodes);
      this.queries!.insertEdges(result.edges);
      this.queries!.upsertFile(result.fileRecord);
    });
  }
}