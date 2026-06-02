import type Database from 'better-sqlite3';
import type { DatabaseConnection } from './connection.js';
import type {
  EnhancedNode, EnhancedEdge, FileRecord, UnresolvedReference,
  NodeKind, EdgeKind, Language, GraphStats,
} from '../types.js';

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
  start_line: number | null;
  end_line: number | null;
  start_column: number | null;
  end_column: number | null;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  updated_at: string;
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
  modified_at: string | null;
  indexed_at: string;
  node_count: number;
  errors: string | null;
}

function rowToNode(row: NodeRow): EnhancedNode {
  return {
    id: row.id,
    kind: row.kind as NodeKind,
    name: row.name,
    qualifiedName: row.qualified_name ?? '',
    filePath: row.file_path ?? '',
    language: (row.language ?? 'unknown') as Language,
    startLine: row.start_line ?? 0,
    endLine: row.end_line ?? 0,
    startColumn: row.start_column ?? 0,
    endColumn: row.end_column ?? 0,
    docstring: row.docstring ?? '',
    signature: row.signature ?? '',
    visibility: (row.visibility ?? '') as EnhancedNode['visibility'],
    isExported: row.is_exported === 1,
    isAsync: row.is_async === 1,
    isStatic: row.is_static === 1,
    isAbstract: row.is_abstract === 1,
    decorators: row.decorators ? JSON.parse(row.decorators) : [],
    typeParameters: row.type_parameters ? JSON.parse(row.type_parameters) : [],
    updatedAt: row.updated_at,
  };
}

function rowToEdge(row: EdgeRow): EnhancedEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    kind: row.kind as EdgeKind,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    line: row.line ?? undefined,
    column: row.col ?? undefined,
    provenance: row.provenance ?? undefined,
  };
}

function rowToFile(row: FileRow): FileRecord {
  return {
    path: row.path,
    contentHash: row.content_hash ?? '',
    language: (row.language ?? 'unknown') as Language,
    size: row.size ?? 0,
    modifiedAt: row.modified_at ?? '',
    indexedAt: row.indexed_at,
    nodeCount: row.node_count,
    errors: row.errors ? JSON.parse(row.errors) : [],
  };
}

// ---------------------------------------------------------------------------
// QueryBuilder
// ---------------------------------------------------------------------------

export class QueryBuilder {
  private conn: DatabaseConnection;
  private stmtCache = new Map<string, Database.Statement>();

  constructor(conn: DatabaseConnection) {
    this.conn = conn;
  }

  private stmt(sql: string): Database.Statement {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.conn.raw.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  // ── Node CRUD ──────────────────────────────────────────────────────

  getNodeById(id: string): EnhancedNode | null {
    const row = this.stmt('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  getNodesByIds(ids: string[]): Map<string, EnhancedNode> {
    const result = new Map<string, EnhancedNode>();
    if (ids.length === 0) return result;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.conn.raw.prepare(
      `SELECT * FROM nodes WHERE id IN (${placeholders})`
    ).all(...ids) as NodeRow[];
    for (const row of rows) {
      result.set(row.id, rowToNode(row));
    }
    return result;
  }

  getNodesByFile(filePath: string): EnhancedNode[] {
    const rows = this.stmt(
      'SELECT * FROM nodes WHERE file_path = ?'
    ).all(filePath) as NodeRow[];
    return rows.map(rowToNode);
  }

  getNodesByKind(kind: NodeKind): EnhancedNode[] {
    const rows = this.stmt(
      'SELECT * FROM nodes WHERE kind = ?'
    ).all(kind) as NodeRow[];
    return rows.map(rowToNode);
  }

  insertNode(node: EnhancedNode): void {
    this.stmt(`
      INSERT OR REPLACE INTO nodes
        (id, kind, name, qualified_name, file_path, language,
         start_line, end_line, start_column, end_column,
         docstring, signature, visibility, is_exported, is_async,
         is_static, is_abstract, decorators, type_parameters, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      node.id, node.kind, node.name, node.qualifiedName || null,
      node.filePath || null, node.language || null,
      node.startLine || null, node.endLine || null,
      node.startColumn || null, node.endColumn || null,
      node.docstring || null, node.signature || null,
      node.visibility || null, node.isExported ? 1 : 0, node.isAsync ? 1 : 0,
      node.isStatic ? 1 : 0, node.isAbstract ? 1 : 0,
      node.decorators.length > 0 ? JSON.stringify(node.decorators) : null,
      node.typeParameters.length > 0 ? JSON.stringify(node.typeParameters) : null,
    );
  }

  insertNodes(nodes: EnhancedNode[]): void {
    this.conn.transaction(() => {
      for (const node of nodes) {
        this.insertNode(node);
      }
    });
  }

  deleteNode(id: string): void {
    this.stmt('DELETE FROM nodes WHERE id = ?').run(id);
  }

  deleteNodesByFile(filePath: string): void {
    this.stmt('DELETE FROM nodes WHERE file_path = ?').run(filePath);
  }

  // ── Edge CRUD ──────────────────────────────────────────────────────

  getOutgoingEdges(nodeId: string, kinds?: EdgeKind[]): EnhancedEdge[] {
    if (kinds && kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(',');
      return (this.conn.raw.prepare(
        `SELECT * FROM edges WHERE source = ? AND kind IN (${placeholders})`
      ).all(nodeId, ...kinds) as EdgeRow[]).map(rowToEdge);
    }
    return (this.stmt('SELECT * FROM edges WHERE source = ?')
      .all(nodeId) as EdgeRow[]).map(rowToEdge);
  }

  getIncomingEdges(nodeId: string, kinds?: EdgeKind[]): EnhancedEdge[] {
    if (kinds && kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(',');
      return (this.conn.raw.prepare(
        `SELECT * FROM edges WHERE target = ? AND kind IN (${placeholders})`
      ).all(nodeId, ...kinds) as EdgeRow[]).map(rowToEdge);
    }
    return (this.stmt('SELECT * FROM edges WHERE target = ?')
      .all(nodeId) as EdgeRow[]).map(rowToEdge);
  }

  insertEdge(edge: EnhancedEdge): void {
    this.stmt(`
      INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      edge.source, edge.target, edge.kind,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
      edge.line ?? null, edge.column ?? null, edge.provenance ?? null,
    );
  }

  insertEdges(edges: EnhancedEdge[]): void {
    this.conn.transaction(() => {
      for (const edge of edges) {
        this.insertEdge(edge);
      }
    });
  }

  deleteEdgesFrom(source: string): void {
    this.stmt('DELETE FROM edges WHERE source = ?').run(source);
  }

  deleteEdgesForFile(filePath: string): void {
    this.conn.raw.exec(`
      DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = '${filePath.replace(/'/g, "''")}')
        OR target IN (SELECT id FROM nodes WHERE file_path = '${filePath.replace(/'/g, "''")}')
    `);
  }

  // ── File CRUD ──────────────────────────────────────────────────────

  getFile(path: string): FileRecord | null {
    const row = this.stmt('SELECT * FROM files WHERE path = ?').get(path) as FileRow | undefined;
    return row ? rowToFile(row) : null;
  }

  getAllFiles(): FileRecord[] {
    return (this.stmt('SELECT * FROM files').all() as FileRow[]).map(rowToFile);
  }

  upsertFile(file: FileRecord): void {
    this.stmt(`
      INSERT OR REPLACE INTO files
        (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)
    `).run(
      file.path, file.contentHash, file.language, file.size,
      file.modifiedAt, file.nodeCount,
      file.errors.length > 0 ? JSON.stringify(file.errors) : null,
    );
  }

  deleteFile(path: string): void {
    this.stmt('DELETE FROM files WHERE path = ?').run(path);
  }

  getStaleFiles(currentHashes: Map<string, string>): { added: string[]; modified: string[]; deleted: string[] } {
    const existing = new Map<string, string>();
    for (const file of this.getAllFiles()) {
      existing.set(file.path, file.contentHash);
    }

    const added: string[] = [];
    const modified: string[] = [];
    for (const [path, hash] of currentHashes) {
      const old = existing.get(path);
      if (!old) added.push(path);
      else if (old !== hash) modified.push(path);
    }

    const deleted: string[] = [];
    for (const path of existing.keys()) {
      if (!currentHashes.has(path)) deleted.push(path);
    }

    return { added, modified, deleted };
  }

  // ── Unresolved Refs ────────────────────────────────────────────────

  insertUnresolvedRef(ref: UnresolvedReference): void {
    this.stmt(`
      INSERT INTO unresolved_refs
        (from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ref.fromNodeId, ref.referenceName, ref.referenceKind,
      ref.line, ref.column,
      ref.candidates.length > 0 ? JSON.stringify(ref.candidates) : null,
      ref.filePath, ref.language,
    );
  }

  deleteUnresolvedRefsForFile(filePath: string): void {
    this.stmt('DELETE FROM unresolved_refs WHERE file_path = ?').run(filePath);
  }

  getUnresolvedReferencesCount(): number {
    const row = this.stmt('SELECT COUNT(*) as c FROM unresolved_refs').get() as { c: number };
    return row.c;
  }

  // ── Search ─────────────────────────────────────────────────────────

  searchNodes(
    query: string,
    options?: { kinds?: NodeKind[]; languages?: Language[]; pathFilters?: string[]; nameFilters?: string[]; limit?: number }
  ): EnhancedNode[] {
    const limit = options?.limit ?? 20;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.kinds && options.kinds.length > 0) {
      conditions.push(`kind IN (${options.kinds.map(() => '?').join(',')})`);
      params.push(...options.kinds);
    }
    if (options?.languages && options.languages.length > 0) {
      conditions.push(`language IN (${options.languages.map(() => '?').join(',')})`);
      params.push(...options.languages);
    }
    if (options?.pathFilters) {
      for (const pf of options.pathFilters) {
        conditions.push('LOWER(file_path) LIKE ?');
        params.push(`%${pf.toLowerCase()}%`);
      }
    }
    if (options?.nameFilters) {
      for (const nf of options.nameFilters) {
        conditions.push('LOWER(name) LIKE ?');
        params.push(`%${nf.toLowerCase()}%`);
      }
    }

    if (query && query.trim()) {
      const ftsQuery = query.trim().split(/\s+/).map(t => `"${t}"*`).join(' OR ');
      const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT nodes.* FROM nodes_fts
        JOIN nodes ON nodes.id = nodes_fts.id
        WHERE nodes_fts MATCH ? ${whereClause}
        ORDER BY rank
        LIMIT ?
      `;
      try {
        const rows = this.conn.raw.prepare(sql).all(ftsQuery, ...params, limit) as NodeRow[];
        if (rows.length > 0) return rows.map(rowToNode);
      } catch {
        // FTS5 match failure — fall through to LIKE
      }

      // LIKE fallback
      const likeWhere = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      const likeSql = `
        SELECT * FROM nodes
        WHERE (LOWER(name) LIKE ? OR LOWER(qualified_name) LIKE ? OR LOWER(signature) LIKE ?)
        ${likeWhere}
        LIMIT ?
      `;
      const pattern = `%${query.toLowerCase()}%`;
      const likeRows = this.conn.raw.prepare(likeSql).all(
        pattern, pattern, pattern, ...params, limit
      ) as NodeRow[];
      return likeRows.map(rowToNode);
    }

    // No text query — just filters
    if (conditions.length === 0) {
      return (this.stmt('SELECT * FROM nodes LIMIT ?').all(limit) as NodeRow[]).map(rowToNode);
    }
    const sql = `SELECT * FROM nodes WHERE ${conditions.join(' AND ')} LIMIT ?`;
    return (this.conn.raw.prepare(sql).all(...params, limit) as NodeRow[]).map(rowToNode);
  }

  // ── Statistics ─────────────────────────────────────────────────────

  getStats(dbSizeBytes?: number): GraphStats {
    const nodeCount = (this.stmt('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    const edgeCount = (this.stmt('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    const fileCount = (this.stmt('SELECT COUNT(*) as c FROM files').get() as { c: number }).c;
    const unresolvedRefCount = this.getUnresolvedReferencesCount();

    const nodesByKind: Record<string, number> = {};
    for (const row of this.stmt('SELECT kind, COUNT(*) as c FROM nodes GROUP BY kind').all() as Array<{ kind: string; c: number }>) {
      nodesByKind[row.kind] = row.c;
    }

    const edgesByKind: Record<string, number> = {};
    for (const row of this.stmt('SELECT kind, COUNT(*) as c FROM edges GROUP BY kind').all() as Array<{ kind: string; c: number }>) {
      edgesByKind[row.kind] = row.c;
    }

    const nodesByLanguage: Record<string, number> = {};
    for (const row of this.stmt('SELECT language, COUNT(*) as c FROM nodes WHERE language IS NOT NULL GROUP BY language').all() as Array<{ language: string; c: number }>) {
      nodesByLanguage[row.language] = row.c;
    }

    return {
      nodeCount, edgeCount, fileCount, unresolvedRefCount,
      nodesByKind, edgesByKind, nodesByLanguage,
      dbSizeBytes: dbSizeBytes ?? 0,
    };
  }

  getNodeAndEdgeCount(): { nodes: number; edges: number } {
    const nodes = (this.stmt('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
    const edges = (this.stmt('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
    return { nodes, edges };
  }

  // ── Project Metadata ───────────────────────────────────────────────

  setMetadata(key: string, value: string): void {
    this.stmt(
      'INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))'
    ).run(key, value);
  }

  getMetadata(key: string): string | null {
    const row = this.stmt('SELECT value FROM project_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ── Bulk Operations ────────────────────────────────────────────────

  clear(): void {
    this.conn.raw.exec('DELETE FROM edges');
    this.conn.raw.exec('DELETE FROM unresolved_refs');
    this.conn.raw.exec('DELETE FROM nodes');
    this.conn.raw.exec('DELETE FROM files');
  }
}
