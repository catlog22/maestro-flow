-- ============================================================================
-- MaestroGraph Unified Schema v2 (审核修订版)
-- ============================================================================
-- 参考: guide/plan-maestrograph.md Gap 修补 1 + 附录 A 设计漏洞修复
-- 存储位置: .workflow/kg/maestro.db

-- Schema 版本追踪
CREATE TABLE IF NOT EXISTS schema_versions (
    version       INTEGER PRIMARY KEY,
    applied_at    INTEGER NOT NULL,
    description   TEXT
);

-- ---------------------------------------------------------------------------
-- 统一节点表
-- 完整复用 CodeGraph 全部代码字段 + 知识扩展字段
-- 修订: source_type NOT NULL DEFAULT 'codegraph' (D3.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,           -- UnifiedNodeKind
    name            TEXT NOT NULL,
    qualified_name  TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    language        TEXT NOT NULL,
    start_line      INTEGER NOT NULL DEFAULT 0,
    end_line        INTEGER NOT NULL DEFAULT 0,
    start_column    INTEGER NOT NULL DEFAULT 0,
    end_column      INTEGER NOT NULL DEFAULT 0,

    -- CodeGraph 代码字段 (完整保留)
    docstring       TEXT,
    signature       TEXT,
    visibility      TEXT,
    is_exported     INTEGER DEFAULT 0,
    is_async        INTEGER DEFAULT 0,
    is_static       INTEGER DEFAULT 0,
    is_abstract     INTEGER DEFAULT 0,
    decorators      TEXT,                       -- JSON array
    type_parameters TEXT,                       -- JSON array

    -- 知识扩展字段 (知识节点使用)
    source_type     TEXT NOT NULL DEFAULT 'codegraph', -- 'codegraph'|'domain'|'spec'|'knowhow'|'codebase'|'issue'
    definition      TEXT,
    aliases         TEXT,                       -- JSON array
    keywords        TEXT,                       -- JSON array
    category        TEXT,
    roles           TEXT,                       -- JSON array
    priority        TEXT,                       -- 'must'|'should'|'may'
    status          TEXT,                       -- 'active'|'locked'|'deprecated'|'superseded'
    body            TEXT,
    metadata        TEXT,                       -- JSON catch-all

    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 可重放结构引用：syntax fact 与 materialized edge 分离
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 统一边表
-- 修订: 移除 UNIQUE 约束 → 保留多处 call site (不同行号的同一调用)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    kind        TEXT NOT NULL,               -- UnifiedEdgeKind
    metadata    TEXT,                        -- JSON
    line        INTEGER,
    col         INTEGER,
    provenance  TEXT,                        -- 细粒度来源追踪
    origin_ref_key TEXT,                     -- structural_refs owns resolver edges
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (origin_ref_key) REFERENCES structural_refs(ref_key) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 未解析引用表 — 解析管道的核心中间存储
-- CodeGraph 两阶段模型: extraction → unresolved_refs → resolution → edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unresolved_refs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id    TEXT NOT NULL,
    reference_name  TEXT NOT NULL,
    reference_kind  TEXT NOT NULL,
    line            INTEGER NOT NULL,
    col             INTEGER NOT NULL,
    candidates      TEXT,                    -- JSON array of possible qualified names
    file_path       TEXT NOT NULL DEFAULT '',
    language        TEXT NOT NULL DEFAULT 'unknown',
    FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 文件追踪表
-- 修订: 补充 errors 字段
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    path            TEXT PRIMARY KEY,
    content_hash    TEXT NOT NULL,
    language        TEXT,
    size            INTEGER,
    modified_at     INTEGER,
    indexed_at      INTEGER,
    node_count      INTEGER DEFAULT 0,
    errors          TEXT,                    -- JSON array, CodeGraph 原有
    source_type     TEXT DEFAULT 'codegraph'
);

-- ---------------------------------------------------------------------------
-- 项目元数据表 — CodeGraph 原有
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_metadata (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- ============================================================================
-- 索引
-- ============================================================================

-- 节点索引
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line);
CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));
CREATE INDEX IF NOT EXISTS idx_nodes_source_type ON nodes(source_type);
CREATE INDEX IF NOT EXISTS idx_nodes_category ON nodes(category);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

-- 边索引 (复合索引, 不设单列索引 — CodeGraph migration v4 经验)
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);
CREATE INDEX IF NOT EXISTS idx_edges_provenance ON edges(provenance);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_origin_ref_key_unique
    ON edges(origin_ref_key) WHERE origin_ref_key IS NOT NULL;

-- 结构引用索引
CREATE INDEX IF NOT EXISTS idx_structural_refs_anchor ON structural_refs(anchor_node_id);
CREATE INDEX IF NOT EXISTS idx_structural_refs_resolved ON structural_refs(resolved_node_id);
CREATE INDEX IF NOT EXISTS idx_structural_refs_status ON structural_refs(status);
CREATE INDEX IF NOT EXISTS idx_structural_refs_target ON structural_refs(raw_target_name);
CREATE INDEX IF NOT EXISTS idx_structural_refs_origin_file ON structural_refs(origin_file_path);

-- 文件索引
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);

-- 未解析引用索引
CREATE INDEX IF NOT EXISTS idx_unresolved_from_node ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);
CREATE INDEX IF NOT EXISTS idx_unresolved_file_path ON unresolved_refs(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved_from_name ON unresolved_refs(from_node_id, reference_name);

-- ============================================================================
-- FTS5 分离索引 — 代码和知识各一套, 避免 BM25 权重失衡
-- D7.1: code_fts 使用 unicode61 (适合代码标识符)
--        knowledge_fts 使用 trigram (支持 CJK 子串匹配)
-- ============================================================================

-- 代码 FTS5 (keywords 列存放 camelCase 分词，unicode61 自动按 JSON 标点拆分)
-- 注意: 必须为内部存储表 (不带 content=), 外部内容表会忽略触发器 WHERE 过滤,
--       导致 code_fts/knowledge_fts 各索引全部节点 (v5 迁移修复)。
CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
    id,
    name,
    qualified_name,
    docstring,
    signature,
    keywords,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- 知识 FTS5
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    id,
    name,
    definition,
    body,
    aliases,
    keywords,
    tokenize = 'trigram'
);

-- FTS5 v8 同步触发器 — 按 source_type 路由到不同索引。
-- 内部存储表支持普通 DELETE；UPDATE 必须先清理旧 rowid，再按 NEW.source_type 回填。
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
    WHERE NEW.source_type = 'codegraph';

    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type != 'codegraph';
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM code_fts WHERE rowid = OLD.rowid;
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    DELETE FROM code_fts WHERE rowid = OLD.rowid;
    DELETE FROM knowledge_fts WHERE rowid = OLD.rowid;

    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
    WHERE NEW.source_type = 'codegraph';

    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
    WHERE NEW.source_type != 'codegraph';
END;
