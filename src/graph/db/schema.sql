-- CodeGraph SQLite Schema for Maestro Knowledge Graph
-- Adapted from codegraph project

-- ── Schema Versioning ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_versions (
  version   INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- ── Project Metadata ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_metadata (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Nodes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  name            TEXT NOT NULL,
  qualified_name  TEXT,
  file_path       TEXT,
  language        TEXT,
  start_line      INTEGER,
  end_line        INTEGER,
  start_column    INTEGER,
  end_column      INTEGER,
  docstring       TEXT,
  signature       TEXT,
  visibility      TEXT,
  is_exported     INTEGER DEFAULT 0,
  is_async        INTEGER DEFAULT 0,
  is_static       INTEGER DEFAULT 0,
  is_abstract     INTEGER DEFAULT 0,
  decorators      TEXT,   -- JSON array
  type_parameters TEXT,   -- JSON array
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Edges ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  metadata  TEXT,   -- JSON object
  line      INTEGER,
  col       INTEGER,
  provenance TEXT
);

-- ── Files ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  path          TEXT PRIMARY KEY,
  content_hash  TEXT,
  language      TEXT,
  size          INTEGER,
  modified_at   TEXT,
  indexed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  node_count    INTEGER DEFAULT 0,
  errors        TEXT   -- JSON array
);

-- ── Unresolved References ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unresolved_refs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  reference_name TEXT NOT NULL,
  reference_kind TEXT,
  line           INTEGER,
  col            INTEGER,
  candidates     TEXT,   -- JSON array
  file_path      TEXT,
  language       TEXT
);

-- ── Indexes: Nodes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_language ON nodes(language);
CREATE INDEX IF NOT EXISTS idx_nodes_file_line ON nodes(file_path, start_line);
CREATE INDEX IF NOT EXISTS idx_nodes_lower_name ON nodes(lower(name));

-- ── Indexes: Edges ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target_kind ON edges(target, kind);

-- ── Indexes: Files ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_files_language ON files(language);
CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);

-- ── Indexes: Unresolved Refs ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_unresolved_from ON unresolved_refs(from_node_id);
CREATE INDEX IF NOT EXISTS idx_unresolved_file ON unresolved_refs(file_path);
CREATE INDEX IF NOT EXISTS idx_unresolved_name ON unresolved_refs(reference_name);

-- ── FTS5 Full-Text Search ─────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id,
  name,
  qualified_name,
  docstring,
  signature,
  content='nodes',
  content_rowid='rowid'
);

-- FTS sync triggers
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
  VALUES (new.rowid, new.id, new.name, new.qualified_name, new.docstring, new.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
  VALUES ('delete', old.rowid, old.id, old.name, old.qualified_name, old.docstring, old.signature);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, docstring, signature)
  VALUES ('delete', old.rowid, old.id, old.name, old.qualified_name, old.docstring, old.signature);
  INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
  VALUES (new.rowid, new.id, new.name, new.qualified_name, new.docstring, new.signature);
END;
