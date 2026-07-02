// src/graph/kg/db/queries.ts — MaestroGraph 统一 CRUD
// 扩展 CodeGraph QueryBuilder 以支持知识节点 + 双 FTS5

import type { DatabaseSync } from 'node:sqlite';
import type { KgDatabaseConnection } from './connection.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord,
  UnifiedNodeKind, UnifiedEdgeKind, Language,
  SourceType, EdgeProvenance, UnifiedGraphStats, Visibility,
} from './types.js';
import { tokenize as camelTokenize } from '../resolution/name-matcher.js';

// ---------------------------------------------------------------------------
// Row ↔ Object mappers
// ---------------------------------------------------------------------------

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string | null;
  file_path: string | null;
  language: string | null;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  source_type: string;
  definition: string | null;
  aliases: string | null;
  keywords: string | null;
  category: string | null;
  roles: string | null;
  priority: string | null;
  status: string | null;
  body: string | null;
  metadata: string | null;
  updated_at: number;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
}

interface FileRow {
  path: string;
  content_hash: string | null;
  language: string | null;
  size: number | null;
  modified_at: number | null;
  indexed_at: number | null;
  node_count: number;
  errors: string | null;
  source_type: string | null;
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; }
  catch { return fallback; }
}

function rowToNode(row: NodeRow): UnifiedNode {
  return {
    id: row.id,
    kind: row.kind as UnifiedNodeKind,
    name: row.name,
    qualifiedName: row.qualified_name ?? '',
    filePath: row.file_path ?? '',
    language: (row.language ?? 'unknown') as Language,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    docstring: row.docstring ?? '',
    signature: row.signature ?? '',
    visibility: (row.visibility ?? '') as Visibility | '',
    isExported: Boolean(row.is_exported),
    isAsync: Boolean(row.is_async),
    isStatic: Boolean(row.is_static),
    isAbstract: Boolean(row.is_abstract),
    decorators: safeJsonParse<string[]>(row.decorators, []),
    typeParameters: safeJsonParse<string[]>(row.type_parameters, []),
    sourceType: (row.source_type ?? 'codegraph') as SourceType,
    definition: row.definition ?? '',
    aliases: safeJsonParse<string[]>(row.aliases, []),
    keywords: safeJsonParse<string[]>(row.keywords, []),
    category: row.category ?? '',
    roles: safeJsonParse<string[]>(row.roles, []),
    priority: row.priority ?? '',
    status: row.status ?? 'active',
    body: row.body ?? '',
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    updatedAt: row.updated_at,
  };
}

function nodeToRow(node: UnifiedNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    qualified_name: node.qualifiedName,
    file_path: node.filePath,
    language: node.language,
    start_line: node.startLine,
    end_line: node.endLine,
    start_column: node.startColumn,
    end_column: node.endColumn,
    docstring: node.docstring || null,
    signature: node.signature || null,
    visibility: node.visibility || null,
    is_exported: node.isExported ? 1 : 0,
    is_async: node.isAsync ? 1 : 0,
    is_static: node.isStatic ? 1 : 0,
    is_abstract: node.isAbstract ? 1 : 0,
    decorators: node.decorators.length > 0 ? JSON.stringify(node.decorators) : null,
    type_parameters: node.typeParameters.length > 0 ? JSON.stringify(node.typeParameters) : null,
    source_type: node.sourceType,
    definition: node.definition || null,
    aliases: node.aliases.length > 0 ? JSON.stringify(node.aliases) : null,
    keywords: node.keywords.length > 0 ? JSON.stringify(node.keywords) : null,
    category: node.category || null,
    roles: node.roles.length > 0 ? JSON.stringify(node.roles) : null,
    priority: node.priority || null,
    status: node.status || null,
    body: node.body || null,
    metadata: Object.keys(node.metadata).length > 0 ? JSON.stringify(node.metadata) : null,
    updated_at: node.updatedAt,
  };
}

function rowToEdge(row: EdgeRow): UnifiedEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    kind: row.kind as UnifiedEdgeKind,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
    line: row.line ?? undefined,
    column: row.col ?? undefined,
    provenance: row.provenance as EdgeProvenance | undefined,
  };
}

// ---------------------------------------------------------------------------
// KgQueryBuilder — 统一 CRUD 操作
// ---------------------------------------------------------------------------

export class KgQueryBuilder {
  private conn: KgDatabaseConnection;

  constructor(conn: KgDatabaseConnection) {
    this.conn = conn;
  }

  private get db(): DatabaseSync {
    return this.conn.raw;
  }

  // ── Node CRUD ──────────────────────────────────────────────────────

  insertNode(node: UnifiedNode): void {
    const row = nodeToRow(node);
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(',');
    this.db.prepare(
      `INSERT OR REPLACE INTO nodes (${cols.join(',')}) VALUES (${placeholders})`
    ).run(...cols.map(c => row[c] as string | number | null));
  }

  insertNodes(nodes: UnifiedNode[]): number {
    if (nodes.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO nodes (
        id, kind, name, qualified_name, file_path, language,
        start_line, end_line, start_column, end_column,
        docstring, signature, visibility, is_exported, is_async, is_static, is_abstract,
        decorators, type_parameters, source_type, definition, aliases, keywords,
        category, roles, priority, status, body, metadata, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`
    );
    let count = 0;
    this.conn.transaction(() => {
      for (const node of nodes) {
        let keywords = node.keywords;
        if (node.sourceType === 'codegraph' && keywords.length === 0) {
          const nameTokens = camelTokenize(node.name);
          const qnTokens = node.qualifiedName ? camelTokenize(node.qualifiedName.split('.').pop() || '') : [];
          const merged = [...new Set([...nameTokens, ...qnTokens])];
          if (merged.length > 1) keywords = merged;
        }
        stmt.run(
          node.id, node.kind, node.name, node.qualifiedName, node.filePath, node.language,
          node.startLine, node.endLine, node.startColumn, node.endColumn,
          node.docstring || null, node.signature || null, node.visibility || null,
          node.isExported ? 1 : 0, node.isAsync ? 1 : 0, node.isStatic ? 1 : 0, node.isAbstract ? 1 : 0,
          node.decorators.length > 0 ? JSON.stringify(node.decorators) : null,
          node.typeParameters.length > 0 ? JSON.stringify(node.typeParameters) : null,
          node.sourceType, node.definition || null,
          node.aliases.length > 0 ? JSON.stringify(node.aliases) : null,
          keywords.length > 0 ? JSON.stringify(keywords) : null,
          node.category || null, node.roles.length > 0 ? JSON.stringify(node.roles) : null,
          node.priority || null, node.status || null,
          node.body || null, Object.keys(node.metadata).length > 0 ? JSON.stringify(node.metadata) : null,
          node.updatedAt,
        );
        count++;
      }
    });
    return count;
  }

  getNode(id: string): UnifiedNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as unknown as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  getNodesByIds(ids: string[]): Map<string, UnifiedNode> {
    if (ids.length === 0) return new Map();
    // 分批查询，每批 500 参数 (D2.3: IN-clause 批量匹配)
    const BATCH_SIZE = 500;
    const result = new Map<string, UnifiedNode>();
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM nodes WHERE id IN (${placeholders})`
      ).all(...batch) as unknown as NodeRow[];
      for (const row of rows) {
        result.set(row.id, rowToNode(row));
      }
    }
    return result;
  }

  getNodesByKind(kinds: UnifiedNodeKind[]): UnifiedNode[] {
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM nodes WHERE kind IN (${placeholders})`
    ).all(...kinds) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  getNodesByFile(filePath: string): UnifiedNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM nodes WHERE file_path = ? ORDER BY start_line'
    ).all(filePath) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  getNodesBySourceType(sourceType: SourceType): UnifiedNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM nodes WHERE source_type = ?'
    ).all(sourceType) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  deleteNode(id: string): void {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
  }

  deleteNodesBySourceTypeAndFile(sourceType: SourceType, filePath: string): number {
    return Number(this.db.prepare(
      'DELETE FROM nodes WHERE source_type = ? AND file_path = ?'
    ).run(sourceType, filePath).changes);
  }

  deleteNodesBySourceType(sourceType: SourceType): number {
    return Number(this.db.prepare(
      'DELETE FROM nodes WHERE source_type = ?'
    ).run(sourceType).changes);
  }

  // ── Edge CRUD ──────────────────────────────────────────────────────

  insertEdge(edge: UnifiedEdge): void {
    this.db.prepare(
      `INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      edge.source, edge.target, edge.kind,
      edge.metadata && Object.keys(edge.metadata).length > 0 ? JSON.stringify(edge.metadata) : null,
      edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
    );
  }

  insertEdges(edges: UnifiedEdge[]): number {
    if (edges.length === 0) return 0;
    const stmt = this.db.prepare(
      `INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let count = 0;
    this.conn.transaction(() => {
      for (const edge of edges) {
        stmt.run(
          edge.source, edge.target, edge.kind,
          edge.metadata && Object.keys(edge.metadata).length > 0 ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
        );
        count++;
      }
    });
    return count;
  }

  getOutgoingEdges(nodeId: string, kind?: UnifiedEdgeKind): UnifiedEdge[] {
    if (kind) {
      const rows = this.db.prepare(
        'SELECT * FROM edges WHERE source = ? AND kind = ?'
      ).all(nodeId, kind) as unknown as EdgeRow[];
      return rows.map(rowToEdge);
    }
    const rows = this.db.prepare(
      'SELECT * FROM edges WHERE source = ?'
    ).all(nodeId) as unknown as EdgeRow[];
    return rows.map(rowToEdge);
  }

  getIncomingEdges(nodeId: string, kind?: UnifiedEdgeKind): UnifiedEdge[] {
    if (kind) {
      const rows = this.db.prepare(
        'SELECT * FROM edges WHERE target = ? AND kind = ?'
      ).all(nodeId, kind) as unknown as EdgeRow[];
      return rows.map(rowToEdge);
    }
    const rows = this.db.prepare(
      'SELECT * FROM edges WHERE target = ?'
    ).all(nodeId) as unknown as EdgeRow[];
    return rows.map(rowToEdge);
  }

  getOutgoingEdgesBatch(nodeIds: string[]): Map<string, UnifiedEdge[]> {
    const result = new Map<string, UnifiedEdge[]>();
    if (nodeIds.length === 0) return result;
    for (const id of nodeIds) result.set(id, []);
    const BATCH_SIZE = 500;
    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM edges WHERE source IN (${placeholders})`
      ).all(...batch) as unknown as EdgeRow[];
      for (const row of rows) {
        const edge = rowToEdge(row);
        result.get(edge.source)?.push(edge);
      }
    }
    return result;
  }

  getIncomingEdgesBatch(nodeIds: string[]): Map<string, UnifiedEdge[]> {
    const result = new Map<string, UnifiedEdge[]>();
    if (nodeIds.length === 0) return result;
    for (const id of nodeIds) result.set(id, []);
    const BATCH_SIZE = 500;
    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM edges WHERE target IN (${placeholders})`
      ).all(...batch) as unknown as EdgeRow[];
      for (const row of rows) {
        const edge = rowToEdge(row);
        result.get(edge.target)?.push(edge);
      }
    }
    return result;
  }

  deleteEdgesByProvenanceAndSource(provenance: string, sourcePrefix: string): number {
    return Number(this.db.prepare(
      "DELETE FROM edges WHERE provenance = ? AND source LIKE ? ESCAPE '\\'"
    ).run(provenance, `${escapeLikePattern(sourcePrefix)}%`).changes);
  }

  // ── Unresolved Refs CRUD ──────────────────────────────────────────

  insertUnresolvedRef(ref: {
    fromNodeId: string;
    referenceName: string;
    referenceKind: string;
    line: number;
    col: number;
    filePath: string;
    language: string;
    candidates?: string[];
  }): void {
    this.db.prepare(
      `INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_path, language, candidates)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ref.fromNodeId, ref.referenceName, ref.referenceKind,
      ref.line, ref.col, ref.filePath, ref.language,
      ref.candidates ? JSON.stringify(ref.candidates) : null,
    );
  }

  getUnresolvedRefsByFile(filePath: string): Array<{
    id: number;
    fromNodeId: string;
    referenceName: string;
    referenceKind: string;
    line: number;
    col: number;
    filePath: string;
    language: string;
    candidates: string[];
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM unresolved_refs WHERE file_path = ?'
    ).all(filePath) as unknown as Array<{
      id: number; from_node_id: string; reference_name: string; reference_kind: string;
      line: number; col: number; file_path: string; language: string; candidates: string | null;
    }>;
    return rows.map(r => ({
      id: r.id, fromNodeId: r.from_node_id, referenceName: r.reference_name,
      referenceKind: r.reference_kind, line: r.line, col: r.col,
      filePath: r.file_path, language: r.language,
      candidates: safeJsonParse<string[]>(r.candidates, []),
    }));
  }

  deleteUnresolvedRefsByFile(filePath: string): number {
    return Number(this.db.prepare(
      'DELETE FROM unresolved_refs WHERE file_path = ?'
    ).run(filePath).changes);
  }

  // ── File CRUD ──────────────────────────────────────────────────────

  upsertFile(record: FileRecord): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors, source_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.path, record.contentHash, record.language,
      record.size, record.modifiedAt, record.indexedAt,
      record.nodeCount,
      record.errors.length > 0 ? JSON.stringify(record.errors) : null,
      record.sourceType,
    );
  }

  getFile(filePath: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as unknown as FileRow | undefined;
    if (!row) return null;
    return {
      path: row.path,
      contentHash: row.content_hash ?? '',
      language: (row.language ?? 'unknown') as Language,
      size: row.size ?? 0,
      modifiedAt: row.modified_at ?? 0,
      indexedAt: row.indexed_at ?? 0,
      nodeCount: row.node_count,
      errors: safeJsonParse<string[]>(row.errors, []),
      sourceType: (row.source_type ?? 'codegraph') as SourceType,
    };
  }

  getStaleFiles(): FileRow[] {
    return this.db.prepare(
      'SELECT * FROM files WHERE modified_at > indexed_at'
    ).all() as unknown as FileRow[];
  }

  // ── Stats ──────────────────────────────────────────────────────────

  getStats(dbSizeBytes: number): UnifiedGraphStats {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as n FROM nodes').get() as unknown as { n: number }).n;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as n FROM edges').get() as unknown as { n: number }).n;
    const fileCount = (this.db.prepare('SELECT COUNT(*) as n FROM files').get() as unknown as { n: number }).n;

    const nodesByKind: Record<string, number> = {};
    const kindRows = this.db.prepare('SELECT kind, COUNT(*) as n FROM nodes GROUP BY kind').all() as unknown as Array<{ kind: string; n: number }>;
    for (const r of kindRows) nodesByKind[r.kind] = r.n;

    const edgesByKind: Record<string, number> = {};
    const edgeKindRows = this.db.prepare('SELECT kind, COUNT(*) as n FROM edges GROUP BY kind').all() as unknown as Array<{ kind: string; n: number }>;
    for (const r of edgeKindRows) edgesByKind[r.kind] = r.n;

    const nodesBySourceType: Record<string, number> = {};
    const sourceRows = this.db.prepare('SELECT source_type, COUNT(*) as n FROM nodes GROUP BY source_type').all() as unknown as Array<{ source_type: string; n: number }>;
    for (const r of sourceRows) nodesBySourceType[r.source_type] = r.n;

    const staleCount = (this.db.prepare('SELECT COUNT(*) as n FROM files WHERE modified_at > indexed_at').get() as unknown as { n: number }).n;
    const stalenessRatio = fileCount > 0 ? staleCount / fileCount : 0;

    const detectedFrameworks: string[] = [];
    try {
      const fwStr = this.db.prepare("SELECT value FROM project_metadata WHERE key = 'detected_frameworks'").get() as unknown as { value: string } | undefined;
      if (fwStr) detectedFrameworks.push(...safeJsonParse<string[]>(fwStr.value, []));
    } catch { /* ignore */ }

    const schemaVersion = this.conn.getSchemaVersion();

    return {
      nodeCount, edgeCount, fileCount, dbSizeBytes,
      nodesByKind, edgesByKind, nodesBySourceType,
      detectedFrameworks, schemaVersion, stalenessRatio,
    };
  }

  // ── Search — FTS5 统一搜索 (D1.5: 输入消毒) ───────────────────────

  searchCodeFTS(query: string, opts: { limit?: number; kinds?: string[]; languages?: string[]; pathFilters?: string[] }): Array<UnifiedNode & { _bm25Score?: number }> {
    if (hasCjkChars(query)) {
      return this.searchNodesLike(query, opts);
    }
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const results = this.runCodeFtsQuery(sanitized, opts);
    if (results.length > 0) return results;

    // Multi-word AND returned 0 — retry with OR semantics
    const tokens = sanitized.match(/"[^"]+"/g);
    if (tokens && tokens.length > 1) {
      const orQuery = tokens.join(' OR ');
      const orResults = this.runCodeFtsQuery(orQuery, opts);
      if (orResults.length > 0) return orResults;
    }

    return this.searchNodesLike(query, opts);
  }

  private runCodeFtsQuery(matchExpr: string, opts: { limit?: number; kinds?: string[]; languages?: string[] }): Array<UnifiedNode & { _bm25Score?: number }> {
    try {
      let sql = `
        SELECT n.*, bm25(code_fts, 0, 20, 5, 1, 2, 10) AS score
        FROM code_fts JOIN nodes n ON code_fts.id = n.id
        WHERE code_fts MATCH ? AND n.source_type = 'codegraph'
      `;
      const params: (string | number | null)[] = [matchExpr];
      if (opts.kinds && opts.kinds.length > 0) {
        sql += ` AND n.kind IN (${opts.kinds.map(() => '?').join(',')})`;
        params.push(...opts.kinds);
      }
      if (opts.languages && opts.languages.length > 0) {
        sql += ` AND n.language IN (${opts.languages.map(() => '?').join(',')})`;
        params.push(...opts.languages);
      }
      sql += ` ORDER BY score LIMIT ?`;
      params.push(opts.limit ?? 20);

      const rows = this.db.prepare(sql).all(...params) as unknown as Array<NodeRow & { score?: number }>;
      return rows.map(r => {
        const node = rowToNode(r) as UnifiedNode & { _bm25Score?: number };
        if (typeof r.score === 'number') node._bm25Score = -r.score;
        return node;
      });
    } catch (err) {
      if (this.tryRebuildCodeFts()) {
        try {
          return this.runCodeFtsQuery(matchExpr, opts);
        } catch { /* rebuild didn't help — fall through */ }
      }
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] code FTS5 failed, LIKE fallback:', err);
      return [];
    }
  }

  private codeFtsRebuilt = false;
  private tryRebuildCodeFts(): boolean {
    if (this.codeFtsRebuilt) return false;
    this.codeFtsRebuilt = true;
    try {
      this.db.exec(`
        DROP TABLE IF EXISTS code_fts;
        CREATE VIRTUAL TABLE code_fts USING fts5(
          id, name, qualified_name, docstring, signature, keywords,
          tokenize = 'unicode61 remove_diacritics 2',
          content = 'nodes', content_rowid = 'rowid'
        );
        INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT rowid, id, name, qualified_name, docstring, signature, keywords
        FROM nodes WHERE source_type = 'codegraph';
      `);
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] code_fts recreated from nodes table');
      return true;
    } catch (err) {
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] code_fts rebuild failed:', err);
      return false;
    }
  }

  searchKnowledgeFTS(query: string, opts: { limit?: number; sourceTypes?: SourceType[] }): Array<UnifiedNode & { _bm25Score?: number }> {
    const isCjkShort = /^[㐀-䶿一-鿿぀-ヿ가-힯]{1,2}$/.test(query.trim());
    if (isCjkShort) {
      return this.searchKnowledgeLike(query, opts);
    }
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const results = this.runKnowledgeFtsQuery(sanitized, opts);
    if (results.length > 0) return results;

    const tokens = sanitized.match(/"[^"]+"/g);
    if (tokens && tokens.length > 1) {
      const orQuery = tokens.join(' OR ');
      const orResults = this.runKnowledgeFtsQuery(orQuery, opts);
      if (orResults.length > 0) return orResults;
    }

    return this.searchKnowledgeLike(query, opts);
  }

  private runKnowledgeFtsQuery(matchExpr: string, opts: { limit?: number; sourceTypes?: SourceType[] }): Array<UnifiedNode & { _bm25Score?: number }> {
    try {
      let sql = `
        SELECT n.*, bm25(knowledge_fts, 0, 20, 10, 1, 15, 10) AS score
        FROM knowledge_fts JOIN nodes n ON knowledge_fts.id = n.id
        WHERE knowledge_fts MATCH ? AND n.source_type != 'codegraph'
      `;
      const params: (string | number | null)[] = [matchExpr];
      if (opts.sourceTypes && opts.sourceTypes.length > 0) {
        sql += ` AND n.source_type IN (${opts.sourceTypes.map(() => '?').join(',')})`;
        params.push(...opts.sourceTypes);
      }
      sql += ` ORDER BY score LIMIT ?`;
      params.push(opts.limit ?? 20);

      const rows = this.db.prepare(sql).all(...params) as unknown as Array<NodeRow & { score?: number }>;
      return rows.map(r => {
        const node = rowToNode(r) as UnifiedNode & { _bm25Score?: number };
        if (typeof r.score === 'number') node._bm25Score = -r.score;
        return node;
      });
    } catch (err) {
      if (this.tryRebuildKnowledgeFts()) {
        try {
          return this.runKnowledgeFtsQuery(matchExpr, opts);
        } catch { /* rebuild didn't help */ }
      }
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] knowledge FTS5 failed, LIKE fallback:', err);
      return [];
    }
  }

  private knowledgeFtsRebuilt = false;
  private tryRebuildKnowledgeFts(): boolean {
    if (this.knowledgeFtsRebuilt) return false;
    this.knowledgeFtsRebuilt = true;
    try {
      this.db.exec(`
        DROP TABLE IF EXISTS knowledge_fts;
        CREATE VIRTUAL TABLE knowledge_fts USING fts5(
          id, name, definition, body, aliases, keywords,
          tokenize = 'trigram',
          content = 'nodes', content_rowid = 'rowid'
        );
        INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
        SELECT rowid, id, name, definition, body, aliases, keywords
        FROM nodes WHERE source_type != 'codegraph';
      `);
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] knowledge_fts recreated from nodes table');
      return true;
    } catch (err) {
      if (process.env.MAESTRO_DEBUG === '1') console.warn('[KG] knowledge_fts rebuild failed:', err);
      return false;
    }
  }

  searchUnified(query: string, opts: { limit?: number; sourceTypes?: SourceType[] }): UnifiedNode[] {
    const codeResults = this.searchCodeFTS(query, { limit: opts.limit ?? 10 });
    const knowledgeResults = this.searchKnowledgeFTS(query, { limit: opts.limit ?? 10, sourceTypes: opts.sourceTypes });
    return [...codeResults, ...knowledgeResults];
  }

  private searchNodesLike(query: string, opts: { limit?: number; kinds?: string[]; languages?: string[] }): UnifiedNode[] {
    const words = query.split(/\s+/).filter(w => w.length > 0);
    const FIELDS = ['name', 'qualified_name', 'docstring', 'signature'] as const;

    let whereClause: string;
    const params: (string | number | null)[] = [];

    if (words.length <= 1) {
      const escaped = escapeLikePattern(query);
      const fieldConds = FIELDS.map(f => `${f} LIKE ? ESCAPE '\\'`).join(' OR ');
      whereClause = `(${fieldConds})`;
      params.push(...FIELDS.map(() => `%${escaped}%`));
    } else {
      // Each word must match at least one field (AND across words, OR across fields)
      const wordClauses = words.map(w => {
        const escaped = escapeLikePattern(w);
        const fieldConds = FIELDS.map(f => `${f} LIKE ? ESCAPE '\\'`).join(' OR ');
        params.push(...FIELDS.map(() => `%${escaped}%`));
        return `(${fieldConds})`;
      });
      whereClause = wordClauses.join(' AND ');
    }

    let sql = `SELECT * FROM nodes WHERE source_type = 'codegraph' AND ${whereClause}`;
    if (opts.kinds && opts.kinds.length > 0) {
      sql += ` AND kind IN (${opts.kinds.map(() => '?').join(',')})`;
      params.push(...opts.kinds);
    }
    if (opts.languages && opts.languages.length > 0) {
      sql += ` AND language IN (${opts.languages.map(() => '?').join(',')})`;
      params.push(...opts.languages);
    }
    sql += ` ORDER BY name LIMIT ?`;
    params.push(opts.limit ?? 20);
    const rows = this.db.prepare(sql).all(...params) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  private searchKnowledgeLike(query: string, opts: { limit?: number; sourceTypes?: SourceType[] }): UnifiedNode[] {
    const words = query.split(/\s+/).filter(w => w.length > 0);
    const FIELDS = ['name', 'definition', 'aliases', 'keywords', 'body'] as const;

    let whereClause: string;
    const params: (string | number | null)[] = [];

    if (words.length <= 1) {
      const escaped = escapeLikePattern(query);
      const fieldConds = FIELDS.map(f => `${f} LIKE ? ESCAPE '\\'`).join(' OR ');
      whereClause = `(${fieldConds})`;
      params.push(...FIELDS.map(() => `%${escaped}%`));
    } else {
      const wordClauses = words.map(w => {
        const escaped = escapeLikePattern(w);
        const fieldConds = FIELDS.map(f => `${f} LIKE ? ESCAPE '\\'`).join(' OR ');
        params.push(...FIELDS.map(() => `%${escaped}%`));
        return `(${fieldConds})`;
      });
      whereClause = wordClauses.join(' AND ');
    }

    let sql = `SELECT * FROM nodes WHERE source_type != 'codegraph' AND ${whereClause}`;
    if (opts.sourceTypes && opts.sourceTypes.length > 0) {
      sql += ` AND source_type IN (${opts.sourceTypes.map(() => '?').join(',')})`;
      params.push(...opts.sourceTypes);
    }
    sql += ` ORDER BY name LIMIT ?`;
    params.push(opts.limit ?? 20);
    const rows = this.db.prepare(sql).all(...params) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }
}

// ---------------------------------------------------------------------------
// LIKE 通配符转义 (AC13)
// ---------------------------------------------------------------------------

function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// FTS5 输入消毒 (D1.5)
// ---------------------------------------------------------------------------

function hasCjkChars(input: string): boolean {
  return /[㐀-䶿一-鿿぀-ヿ가-힯]/.test(input);
}

const FTS5_SPECIAL_CHARS = /[*"(){}[\]:^~+\-!\\]/g;
const FTS5_OPERATORS = new Set(['and', 'or', 'not', 'near']);

export function sanitizeFtsQuery(input: string): string {
  const tokens = input.replace(FTS5_SPECIAL_CHARS, ' ').split(/\s+/)
    .filter(t => t.length > 0)
    .filter(t => !FTS5_OPERATORS.has(t.toLowerCase()));
  if (tokens.length === 0) return '';
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}