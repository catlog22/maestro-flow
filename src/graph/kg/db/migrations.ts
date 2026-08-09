// src/graph/kg/db/migrations.ts — Schema 版本迁移

import type { KgDatabaseConnection } from './connection.js';
import { CREDIBILITY_MIGRATION_SQL } from '../credibility.js';

const INTERNAL_FTS_TRIGGER_DEFINITIONS = {
  nodes_ai: `CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
    WHERE NEW.source_type = 'codegraph';
    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type != 'codegraph';
  END`,
  nodes_ad: `CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM code_fts WHERE rowid = OLD.rowid;
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
  END`,
  nodes_au: `CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
    DELETE FROM code_fts WHERE rowid = OLD.rowid;
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
    WHERE NEW.source_type = 'codegraph';
    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type != 'codegraph';
  END`,
} as const;

const INTERNAL_FTS_TRIGGERS_SQL = `
  DROP TRIGGER IF EXISTS nodes_ai;
  DROP TRIGGER IF EXISTS nodes_ad;
  DROP TRIGGER IF EXISTS nodes_au;

  ${INTERNAL_FTS_TRIGGER_DEFINITIONS.nodes_ai};
  ${INTERNAL_FTS_TRIGGER_DEFINITIONS.nodes_ad};
  ${INTERNAL_FTS_TRIGGER_DEFINITIONS.nodes_au};
`;

const REBUILD_INTERNAL_FTS_SQL = `
  DELETE FROM code_fts;
  DELETE FROM knowledge_fts;
  INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
  SELECT rowid, id, name, qualified_name, docstring, signature, keywords
  FROM nodes WHERE source_type = 'codegraph';
  INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
  SELECT rowid, id, name, definition, body, aliases, keywords
  FROM nodes WHERE source_type != 'codegraph';
`;

const CREATE_INTERNAL_FTS_STORAGE_SQL = `
  CREATE VIRTUAL TABLE code_fts USING fts5(
    id, name, qualified_name, docstring, signature, keywords,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE VIRTUAL TABLE knowledge_fts USING fts5(
    id, name, definition, body, aliases, keywords,
    tokenize = 'trigram'
  );

  INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
  SELECT rowid, id, name, qualified_name, docstring, signature, keywords
  FROM nodes WHERE source_type = 'codegraph';
  INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
  SELECT rowid, id, name, definition, body, aliases, keywords
  FROM nodes WHERE source_type != 'codegraph';
  ${INTERNAL_FTS_TRIGGERS_SQL}
`;

const INTERNAL_FTS_STORAGE_SQL = `
  -- content='nodes' 外部内容表模式下 FTS5 忽略触发器 WHERE 过滤 (按 rowid 读 content 表),
  -- 导致 code_fts/knowledge_fts 各索引全部节点。改为内部存储表, 触发器过滤恢复生效。
  DROP TRIGGER IF EXISTS nodes_ai;
  DROP TRIGGER IF EXISTS nodes_ad;
  DROP TRIGGER IF EXISTS nodes_au;
  DROP TABLE IF EXISTS code_fts;
  DROP TABLE IF EXISTS knowledge_fts;
  ${CREATE_INTERNAL_FTS_STORAGE_SQL}
`;

const INTERNAL_FTS_TABLES = ['code_fts', 'knowledge_fts'] as const;
const INTERNAL_FTS_SHADOW_SUFFIXES = ['data', 'idx', 'content', 'docsize', 'config'] as const;
// FTS5 默认使用格式 4；SQLite 3.42+ 在 secure-delete 真正删改索引后升为格式 5。
const SUPPORTED_FTS_CONFIG_VERSIONS = new Set([4, 5]);
type InternalFtsTable = typeof INTERNAL_FTS_TABLES[number];
type InternalFtsTrigger = keyof typeof INTERNAL_FTS_TRIGGER_DEFINITIONS;

const STRUCTURAL_REFS_V7_SQL = `
  CREATE TABLE IF NOT EXISTS structural_refs (
      ref_key                  TEXT PRIMARY KEY,
      anchor_node_id           TEXT NOT NULL,
      anchor_qualified_name    TEXT NOT NULL,
      ref_kind                 TEXT NOT NULL CHECK (ref_kind IN ('type', 'owner')),
      raw_target_name          TEXT NOT NULL CHECK (length(trim(raw_target_name)) > 0),
      source_declaration_kind  TEXT NOT NULL,
      lookup_scope             TEXT NOT NULL CHECK (lookup_scope IN ('file', 'module', 'project', 'external', 'project-and-external')),
      relation_hint            TEXT NOT NULL CHECK (relation_hint IN ('inherits-or-conforms', 'extends', 'implements', 'decorates', 'contains-owner')),
      edge_orientation         TEXT NOT NULL CHECK (edge_orientation IN ('anchor-to-target', 'target-to-anchor')),
      target_kind_hints        TEXT NOT NULL DEFAULT '[]',
      target_language_hints    TEXT NOT NULL DEFAULT '[]',
      module_hints             TEXT NOT NULL DEFAULT '[]',
      target_file_hints        TEXT NOT NULL DEFAULT '[]',
      origin_file_path         TEXT NOT NULL,
      origin_language          TEXT NOT NULL,
      origin_line              INTEGER NOT NULL CHECK (origin_line > 0),
      origin_column            INTEGER NOT NULL CHECK (origin_column > 0),
      compilation_condition    TEXT,
      evidence_provenance      TEXT NOT NULL CHECK (evidence_provenance = 'tree-sitter'),
      resolved_node_id         TEXT,
      status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ambiguous', 'not_found')),
      candidates               TEXT NOT NULL DEFAULT '[]',
      resolution_strategy      TEXT,
      confidence               REAL,
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL,
      CHECK (
        (ref_kind = 'owner' AND relation_hint = 'contains-owner' AND edge_orientation = 'target-to-anchor')
        OR
        (ref_kind = 'type' AND relation_hint != 'contains-owner' AND edge_orientation = 'anchor-to-target')
      ),
      FOREIGN KEY (anchor_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_node_id) REFERENCES nodes(id) ON DELETE SET NULL
  );
`;

const STRUCTURAL_INDEXES_V7_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_origin_ref_key_unique
    ON edges(origin_ref_key) WHERE origin_ref_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_structural_refs_anchor ON structural_refs(anchor_node_id);
  CREATE INDEX IF NOT EXISTS idx_structural_refs_resolved ON structural_refs(resolved_node_id);
  CREATE INDEX IF NOT EXISTS idx_structural_refs_status ON structural_refs(status);
  CREATE INDEX IF NOT EXISTS idx_structural_refs_target ON structural_refs(raw_target_name);
  CREATE INDEX IF NOT EXISTS idx_structural_refs_origin_file ON structural_refs(origin_file_path);
`;

export interface MigrationStep {
  version: number;
  description: string;
  sql: string;
}

const MIGRATIONS: MigrationStep[] = [
  {
    version: 1,
    description: 'Initial CodeGraph-compatible schema',
    sql: '',
  },
  {
    version: 2,
    description: 'MaestroGraph unified schema v2 — knowledge extensions + dual FTS5',
    sql: '',
  },
  {
    version: 3,
    description: 'Credibility tracking — decay scoring + usage counters',
    sql: CREDIBILITY_MIGRATION_SQL,
  },
  {
    version: 4,
    description: 'code_fts adds keywords column for camelCase sub-word search',
    sql: `
      -- Drop old triggers and FTS table
      DROP TRIGGER IF EXISTS nodes_ai;
      DROP TRIGGER IF EXISTS nodes_ad;
      DROP TRIGGER IF EXISTS nodes_au;
      DROP TABLE IF EXISTS code_fts;

      -- Recreate code_fts with keywords column
      CREATE VIRTUAL TABLE code_fts USING fts5(
        id, name, qualified_name, docstring, signature, keywords,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- Backfill existing codegraph nodes
      INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
      SELECT rowid, id, name, qualified_name, docstring, signature, keywords
      FROM nodes WHERE source_type = 'codegraph';

      -- Recreate triggers with keywords column
      CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
        WHERE NEW.source_type = 'codegraph';
        INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
        WHERE NEW.source_type != 'codegraph';
      END;

      CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO code_fts(code_fts, rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT 'delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature, OLD.keywords
        WHERE OLD.source_type = 'codegraph';
        INSERT INTO knowledge_fts(knowledge_fts, rowid, id, name, definition, body, aliases, keywords)
        SELECT 'delete', OLD.rowid, OLD.id, OLD.name, OLD.definition, OLD.body, OLD.aliases, OLD.keywords
        WHERE OLD.source_type != 'codegraph';
      END;

      CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO code_fts(code_fts, rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT 'delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.docstring, OLD.signature, OLD.keywords
        WHERE OLD.source_type = 'codegraph';
        INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
        WHERE NEW.source_type = 'codegraph';
        INSERT INTO knowledge_fts(knowledge_fts, rowid, id, name, definition, body, aliases, keywords)
        SELECT 'delete', OLD.rowid, OLD.id, OLD.name, OLD.definition, OLD.body, OLD.aliases, OLD.keywords
        WHERE OLD.source_type != 'codegraph';
        INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
        WHERE NEW.source_type != 'codegraph';
      END;
    `,
  },
  {
    version: 5,
    description: 'Dual FTS5 converted to internal storage — external content tables ignore trigger WHERE filters, indexing every node',
    sql: INTERNAL_FTS_STORAGE_SQL,
  },
  {
    version: 6,
    description: 'Repair nodes_ad/nodes_au triggers — FTS5 delete command is invalid inside INSERT...SELECT triggers',
    sql: `
      -- v5 曾用 SELECT 'delete' 形式的触发器 (FTS5 delete 命令在触发器内报错),
      -- 已被 v5 迁移提交到已存在的库。此处重装为安全版本:
      -- DELETE/UPDATE 不做 FTS 直删, 一致性由同步末尾 ensureFtsConsistency 重建保证。
      DROP TRIGGER IF EXISTS nodes_ai;
      DROP TRIGGER IF EXISTS nodes_ad;
      DROP TRIGGER IF EXISTS nodes_au;

      CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
        WHERE NEW.source_type = 'codegraph';
        INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
        SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
        WHERE NEW.source_type != 'codegraph';
      END;

      CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
        SELECT 1;
      END;

      CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN
        SELECT 1;
      END;
    `,
  },
  {
    version: 7,
    description: 'Replayable structural references and origin-bound resolver edges',
    sql: '',
  },
  {
    version: 8,
    description: 'Repair internal FTS storage and install UPSERT-safe synchronization triggers',
    sql: '',
  },
];

function getFtsTableDefinitions(conn: KgDatabaseConnection): Array<{ name: string; sql: string | null }> {
  return conn.raw.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('code_fts', 'knowledge_fts')
  `).all() as unknown as Array<{ name: string; sql: string | null }>;
}

function hasExternalContentFts(rows: Array<{ name: string; sql: string | null }>): boolean {
  return rows.some(row => /\bcontent\s*=\s*(['"])nodes\1/i.test(row.sql ?? ''));
}

function hasCompleteInternalFtsStorage(conn: KgDatabaseConnection): boolean {
  const rows = conn.raw.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND (
        name IN ('code_fts', 'knowledge_fts')
        OR name GLOB 'code_fts_*'
        OR name GLOB 'knowledge_fts_*'
      )
  `).all() as unknown as Array<{ name: string }>;
  const names = new Set(rows.map(row => row.name));
  return INTERNAL_FTS_TABLES.every(table => (
    names.has(table)
    && INTERNAL_FTS_SHADOW_SUFFIXES.every(suffix => names.has(`${table}_${suffix}`))
    && hasValidFtsConfigVersion(conn, table)
  ));
}

function hasValidFtsConfigVersion(conn: KgDatabaseConnection, table: InternalFtsTable): boolean {
  try {
    const row = conn.raw.prepare(`
      SELECT v
      FROM ${table}_config
      WHERE k = 'version'
    `).get() as { v?: unknown } | undefined;
    return typeof row?.v === 'number' && SUPPORTED_FTS_CONFIG_VERSIONS.has(row.v);
  } catch {
    return false;
  }
}

function normalizeSqlDefinition(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, ' ').trim().replace(/;+$/g, '').trim();
}

function hasExpectedInternalFtsTriggers(conn: KgDatabaseConnection): boolean {
  const rows = conn.raw.prepare(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND name IN ('nodes_ai', 'nodes_ad', 'nodes_au')
  `).all() as unknown as Array<{ name: string; tbl_name: string; sql: string | null }>;
  if (rows.length !== 3) return false;

  const definitions = new Map(rows.map(row => [row.name, row]));
  return (Object.keys(INTERNAL_FTS_TRIGGER_DEFINITIONS) as InternalFtsTrigger[]).every(name => {
    const actual = definitions.get(name);
    return actual?.tbl_name === 'nodes'
      && actual.sql !== null
      && normalizeSqlDefinition(actual.sql)
        === normalizeSqlDefinition(INTERNAL_FTS_TRIGGER_DEFINITIONS[name]);
  });
}

function needsInternalFtsStorageRepair(conn: KgDatabaseConnection): boolean {
  const rows = getFtsTableDefinitions(conn);
  if (rows.length !== 2) return true;
  return hasExternalContentFts(rows) || !hasCompleteInternalFtsStorage(conn);
}

function prepareFtsVirtualTableForDrop(conn: KgDatabaseConnection, table: InternalFtsTable): void {
  const exists = conn.raw.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table);
  if (!exists || hasValidFtsConfigVersion(conn, table)) return;

  // FTS5 在 reopen 后会先通过 *_config 构造 vtable。该 shadow table 缺失或异常时，
  // 直接 DROP 主表反而会报 "vtable constructor failed"。先补一个最小合法 config，
  // 让 SQLite 自己完成虚表与其余 shadow tables 的标准删除，无需改写 sqlite_master。
  conn.raw.exec(`
    DROP TABLE IF EXISTS ${table}_config;
    CREATE TABLE ${table}_config(k PRIMARY KEY, v) WITHOUT ROWID;
    INSERT INTO ${table}_config(k, v) VALUES ('version', 4);
  `);
}

function rebuildInternalFtsStorage(conn: KgDatabaseConnection): void {
  conn.raw.exec(`
    DROP TRIGGER IF EXISTS nodes_ai;
    DROP TRIGGER IF EXISTS nodes_ad;
    DROP TRIGGER IF EXISTS nodes_au;
  `);

  // 触发器同时访问两张索引表，因此缺失任一物理表时必须成对重建。
  for (const table of INTERNAL_FTS_TABLES) {
    prepareFtsVirtualTableForDrop(conn, table);
    conn.raw.exec(`DROP TABLE IF EXISTS ${table};`);
    // 主表已经丢失时可能留下孤立 shadow tables，显式清理后才能重建同名虚表。
    for (const suffix of INTERNAL_FTS_SHADOW_SUFFIXES) {
      conn.raw.exec(`DROP TABLE IF EXISTS ${table}_${suffix};`);
    }
  }

  conn.raw.exec(CREATE_INTERNAL_FTS_STORAGE_SQL);
}

function ensureInternalFtsV8(conn: KgDatabaseConnection): void {
  if (needsInternalFtsStorageRepair(conn)) {
    rebuildInternalFtsStorage(conn);
    return;
  }

  conn.raw.exec(INTERNAL_FTS_TRIGGERS_SQL);
  conn.raw.exec(REBUILD_INTERNAL_FTS_SQL);
}

function ensureStructuralSchemaV7(conn: KgDatabaseConnection): void {
  conn.raw.exec(STRUCTURAL_REFS_V7_SQL);
  const edgeColumns = conn.raw.prepare('PRAGMA table_info(edges)').all() as unknown as Array<{ name: string }>;
  if (!edgeColumns.some(column => column.name === 'origin_ref_key')) {
    conn.raw.exec(`
      ALTER TABLE edges
      ADD COLUMN origin_ref_key TEXT REFERENCES structural_refs(ref_key) ON DELETE CASCADE;
    `);
  }
  conn.raw.exec(STRUCTURAL_INDEXES_V7_SQL);
}

export function applyMigrations(conn: KgDatabaseConnection): void {
  const currentVersion = conn.getSchemaVersion();
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      conn.transaction(() => {
        if (migration.version === 7) {
          ensureStructuralSchemaV7(conn);
        }
        if (migration.version === 8) {
          // 按物理表形态兼容 legacy structural-v5，以及修复版本化前已标记 v7 的数据库。
          ensureInternalFtsV8(conn);
        }
        if (migration.sql) {
          conn.raw.exec(migration.sql);
        }
        conn.raw.prepare(
          'INSERT OR REPLACE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
        ).run(migration.version, Date.now(), migration.description);
      });
    }
  }

  // schema 版本只能表示逻辑迁移已执行，不能证明 FTS5 物理表和同步触发器仍完整。
  // 已 stamp v8 的库每次打开只做 sqlite_master/config 轻量检查，健康时不产生写入。
  if (currentVersion === 8
    && (needsInternalFtsStorageRepair(conn) || !hasExpectedInternalFtsTriggers(conn))) {
    conn.transaction(() => ensureInternalFtsV8(conn));
  }
}
