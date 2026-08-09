import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { KgDatabaseConnection } from '../db/connection.js';
import { applyMigrations } from '../db/migrations.js';
import { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode } from '../db/types.js';
import {
  makeStructuralReferenceKey,
  type StructuralReference,
} from '../resolution/structural-reference.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDb(name: string): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), `maestro-${name}-`));
  tempRoots.push(root);
  return { root, dbPath: join(root, 'maestro.db') };
}

function openFresh(name: string): KgDatabaseConnection {
  const { dbPath } = tempDb(name);
  const conn = new KgDatabaseConnection();
  conn.initialize(dbPath);
  applyMigrations(conn);
  return conn;
}

function reopenAndMigrate(conn: KgDatabaseConnection): KgDatabaseConnection {
  const dbPath = conn.path;
  conn.close();
  const reopened = new KgDatabaseConnection();
  reopened.open(dbPath);
  try {
    applyMigrations(reopened);
    return reopened;
  } catch (err) {
    reopened.close();
    throw err;
  }
}

function createCopiedV4Fixture(): KgDatabaseConnection {
  const source = tempDb('schema-v4-source');
  const copy = tempDb('schema-v4-copy');
  const db = new DatabaseSync(source.dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    );
    INSERT INTO schema_versions VALUES (4, 1, 'v4 fixture');
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      start_line INTEGER NOT NULL DEFAULT 0,
      end_line INTEGER NOT NULL DEFAULT 0,
      start_column INTEGER NOT NULL DEFAULT 0,
      end_column INTEGER NOT NULL DEFAULT 0,
      docstring TEXT,
      signature TEXT,
      visibility TEXT,
      is_exported INTEGER DEFAULT 0,
      is_async INTEGER DEFAULT 0,
      is_static INTEGER DEFAULT 0,
      is_abstract INTEGER DEFAULT 0,
      decorators TEXT,
      type_parameters TEXT,
      source_type TEXT NOT NULL DEFAULT 'codegraph',
      definition TEXT,
      aliases TEXT,
      keywords TEXT,
      category TEXT,
      roles TEXT,
      priority TEXT,
      status TEXT,
      body TEXT,
      metadata TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL,
      metadata TEXT,
      line INTEGER,
      col INTEGER,
      provenance TEXT,
      FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
    );
    CREATE TABLE credibility (
      node_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      search_hits INTEGER NOT NULL DEFAULT 0,
      consumption_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at INTEGER,
      last_consumed_at INTEGER,
      content_changed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.close();
  copyFileSync(source.dbPath, copy.dbPath);

  const conn = new KgDatabaseConnection();
  conn.open(copy.dbPath);
  applyMigrations(conn);
  return conn;
}

function createLegacyStructuralV5Fixture(): KgDatabaseConnection {
  const { dbPath } = tempDb('legacy-structural-v5');
  const conn = new KgDatabaseConnection();
  conn.initialize(dbPath);
  conn.raw.exec(`
    DROP TRIGGER IF EXISTS nodes_ai;
    DROP TRIGGER IF EXISTS nodes_ad;
    DROP TRIGGER IF EXISTS nodes_au;
    DROP TABLE code_fts;
    DROP TABLE knowledge_fts;

    CREATE VIRTUAL TABLE code_fts USING fts5(
      id, name, qualified_name, docstring, signature, keywords,
      tokenize = 'unicode61 remove_diacritics 2',
      content = 'nodes', content_rowid = 'rowid'
    );
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      id, name, definition, body, aliases, keywords,
      tokenize = 'trigram',
      content = 'nodes', content_rowid = 'rowid'
    );

    CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
      INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
      SELECT NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature, NEW.keywords
      WHERE NEW.source_type = 'codegraph';
      INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
      SELECT NEW.rowid, NEW.id, NEW.name, NEW.definition, NEW.body, NEW.aliases, NEW.keywords
      WHERE NEW.source_type != 'codegraph';
    END;

    INSERT INTO nodes (
      id, kind, name, qualified_name, file_path, language, source_type, updated_at
    ) VALUES
      ('code:legacy', 'class', 'CodeThing', 'CodeThing', '/project/Code.swift', 'swift', 'codegraph', 1),
      ('spec:legacy', 'spec_entry', 'KnowledgeThing', 'KnowledgeThing', '', 'unknown', 'spec', 1);

    DELETE FROM schema_versions;
    INSERT INTO schema_versions (version, applied_at, description)
    VALUES (5, 1, 'Replayable structural references and origin-bound resolver edges');
  `);
  return conn;
}

function schemaShape(db: DatabaseSync): unknown {
  const tableInfo = (table: string): unknown[] => db.prepare(`PRAGMA table_info(${table})`).all()
    .map((row: unknown) => {
      const value = row as Record<string, unknown>;
      return {
        name: value.name,
        type: value.type,
        notnull: value.notnull,
        dflt_value: value.dflt_value,
        pk: value.pk,
      };
    });
  const foreignKeys = (table: string): unknown[] => db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    .map((row: unknown) => {
      const value = row as Record<string, unknown>;
      return {
        table: value.table,
        from: value.from,
        to: value.to,
        on_update: value.on_update,
        on_delete: value.on_delete,
      };
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const indexes = (table: string): unknown[] => db.prepare(`PRAGMA index_list(${table})`).all()
    .map((row: unknown) => {
      const value = row as Record<string, unknown>;
      const name = String(value.name);
      const definition = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?"
      ).get(name) as { sql: string | null } | undefined;
      return {
        name,
        unique: value.unique,
        partial: value.partial,
        columns: db.prepare(`PRAGMA index_info(${JSON.stringify(name)})`).all()
          .map((column: unknown) => (column as { name: string }).name),
        sql: definition?.sql?.replace(/\s+/g, ' ').trim() ?? null,
      };
    })
    .filter((row: unknown) => !(row as { name: string }).name.startsWith('sqlite_autoindex_'))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    structuralRefs: {
      columns: tableInfo('structural_refs'),
      foreignKeys: foreignKeys('structural_refs'),
      indexes: indexes('structural_refs'),
    },
    edges: {
      columns: tableInfo('edges'),
      foreignKeys: foreignKeys('edges'),
      indexes: indexes('edges').filter((row: unknown) => (row as { name: string }).name.includes('origin_ref')),
    },
  };
}

function makeNode(id: string, name: string): UnifiedNode {
  return {
    id,
    kind: 'class',
    name,
    qualifiedName: name,
    filePath: `/project/${name}.swift`,
    language: 'swift',
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: 'public',
    isExported: true,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'codegraph',
    definition: '',
    aliases: [],
    keywords: [],
    category: '',
    roles: [],
    priority: '',
    status: 'active',
    body: '',
    metadata: {},
    updatedAt: 1,
  };
}

function makeRef(anchorNodeId: string, targetName = 'Parent'): StructuralReference {
  const originFilePath = '/project/Child.swift';
  const identity = {
    normalizedOriginPath: originFilePath,
    anchorNodeId,
    relationHint: 'extends' as const,
    edgeOrientation: 'anchor-to-target' as const,
    rawTargetName: targetName,
    line: 1,
    column: 14,
  };
  return {
    kind: 'type',
    refKey: makeStructuralReferenceKey(identity),
    anchorNodeId,
    anchorQualifiedName: 'Child',
    rawTargetName: targetName,
    sourceDeclarationKind: 'class',
    lookupScope: 'project-and-external',
    relationHint: 'extends',
    edgeOrientation: 'anchor-to-target',
    targetKindHints: ['class'],
    targetLanguageHints: ['swift', 'objc'],
    moduleHints: [],
    targetFileHints: [],
    origin: { filePath: originFilePath, language: 'swift', line: 1, column: 14 },
    evidenceProvenance: 'tree-sitter',
  };
}

function contentHash(db: DatabaseSync): string {
  const snapshot = {
    nodes: db.prepare('SELECT id FROM nodes ORDER BY id').all(),
    refs: db.prepare('SELECT * FROM structural_refs ORDER BY ref_key').all(),
    edges: db.prepare('SELECT source, target, kind, provenance, origin_ref_key FROM edges ORDER BY id').all(),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

describe('structural schema v7 and FTS schema v8', () => {
  it('makes fresh and copied-v4 databases converge on one schema authority', () => {
    const fresh = openFresh('schema-v8-fresh');
    const migrated = createCopiedV4Fixture();
    try {
      expect(fresh.getSchemaVersion()).toBe(8);
      expect(migrated.getSchemaVersion()).toBe(8);
      expect((fresh.raw.prepare('SELECT MAX(version) AS version FROM schema_versions').get() as { version: number }).version).toBe(8);
      expect((migrated.raw.prepare('SELECT MAX(version) AS version FROM schema_versions').get() as { version: number }).version).toBe(8);
      expect(schemaShape(migrated.raw)).toEqual(schemaShape(fresh.raw));
    } finally {
      fresh.close();
      migrated.close();
    }
  });

  it('repairs the legacy structural-v5 external-content FTS collision', () => {
    const conn = createLegacyStructuralV5Fixture();
    try {
      const beforeSql = conn.raw.prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'code_fts'"
      ).get() as { sql: string };
      expect(beforeSql.sql).toMatch(/content\s*=\s*'nodes'/i);

      applyMigrations(conn);

      expect(conn.getSchemaVersion()).toBe(8);
      const ftsDefinitions = conn.raw.prepare(`
        SELECT name, sql
        FROM sqlite_master
        WHERE name IN ('code_fts', 'knowledge_fts')
        ORDER BY name
      `).all() as unknown as Array<{ name: string; sql: string }>;
      expect(ftsDefinitions).toHaveLength(2);
      for (const definition of ftsDefinitions) {
        expect(definition.sql).not.toMatch(/\bcontent\s*=/i);
      }
      expect(conn.raw.prepare('SELECT COUNT(*) AS count FROM code_fts').get()).toEqual({ count: 1 });
      expect(conn.raw.prepare('SELECT COUNT(*) AS count FROM knowledge_fts').get()).toEqual({ count: 1 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'KnowledgeThing'"
      ).get()).toEqual({ count: 0 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'CodeThing'"
      ).get()).toEqual({ count: 0 });

      for (const triggerName of ['nodes_ad', 'nodes_au']) {
        const trigger = conn.raw.prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?"
        ).get(triggerName) as { sql: string };
        expect(trigger.sql).toMatch(/DELETE\s+FROM\s+code_fts/i);
        expect(trigger.sql).toMatch(/DELETE\s+FROM\s+knowledge_fts/i);
        if (triggerName === 'nodes_au') {
          expect(trigger.sql).toMatch(/INSERT\s+INTO\s+code_fts/i);
          expect(trigger.sql).toMatch(/INSERT\s+INTO\s+knowledge_fts/i);
        }
      }
      const reference = openFresh('schema-v8-legacy-reference');
      try {
        expect(schemaShape(conn.raw)).toEqual(schemaShape(reference.raw));
      } finally {
        reference.close();
      }
      expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(conn.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      conn.close();
    }
  });

  it('repairs stale internal FTS state in databases already stamped v7', () => {
    const conn = openFresh('schema-v7-stale-fts');
    try {
      const queries = new KgQueryBuilder(conn);
      const node = makeNode('code:/project/Stale.swift:Stale', 'BeforeMigration');
      queries.insertNode(node);
      conn.raw.exec(`
        DELETE FROM schema_versions WHERE version = 8;
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
        CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN SELECT 1; END;
        CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN SELECT 1; END;

        UPDATE nodes
        SET name = 'AfterMigration', qualified_name = 'AfterMigration'
        WHERE id = 'code:/project/Stale.swift:Stale';
      `);

      expect(conn.getSchemaVersion()).toBe(7);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'BeforeMigration'"
      ).get()).toEqual({ count: 1 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'AfterMigration'"
      ).get()).toEqual({ count: 0 });

      applyMigrations(conn);

      expect(conn.getSchemaVersion()).toBe(8);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'BeforeMigration'"
      ).get()).toEqual({ count: 0 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'AfterMigration'"
      ).get()).toEqual({ count: 1 });
      const trigger = conn.raw.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'nodes_au'"
      ).get() as { sql: string };
      expect(trigger.sql).toMatch(/DELETE\s+FROM\s+code_fts/i);
      expect(trigger.sql).toMatch(/INSERT\s+INTO\s+knowledge_fts/i);
    } finally {
      conn.close();
    }
  });

  it.each(['code_fts', 'knowledge_fts'] as const)(
    'recreates both internal FTS indexes when a v6 database is missing %s',
    (missingTable) => {
      const conn = openFresh(`schema-v6-missing-${missingTable}`);
      try {
        const queries = new KgQueryBuilder(conn);
        queries.insertNode(makeNode('code:/project/Recovered.swift:RecoveredCode', 'RecoveredCode'));
        queries.insertNode({
          ...makeNode('spec:recovered', 'RecoveredKnowledge'),
          kind: 'spec_entry',
          language: 'unknown',
          sourceType: 'spec',
          definition: 'RecoveredGuidance',
        });
        conn.raw.exec(`
          DELETE FROM schema_versions WHERE version > 6;
          DROP TABLE ${missingTable};
        `);

        expect(conn.getSchemaVersion()).toBe(6);
        applyMigrations(conn);

        expect(conn.getSchemaVersion()).toBe(8);
        const definitions = conn.raw.prepare(`
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'table' AND name IN ('code_fts', 'knowledge_fts')
          ORDER BY name
        `).all() as unknown as Array<{ name: string; sql: string }>;
        expect(definitions).toHaveLength(2);
        for (const definition of definitions) {
          expect(definition.sql).not.toMatch(/\bcontent\s*=/i);
        }
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'RecoveredCode'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'RecoveredGuidance'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      } finally {
        conn.close();
      }
    },
  );

  it.each([
    'code_fts_config',
    'knowledge_fts_data',
    'code_fts_content',
  ] as const)(
    'recreates both internal FTS indexes after reopening a v7 database missing shadow table %s',
    (missingTable) => {
      let conn = openFresh(`schema-v7-missing-${missingTable}`);
      try {
        const queries = new KgQueryBuilder(conn);
        queries.insertNode(makeNode('code:/project/Recovered.swift:RecoveredCode', 'RecoveredCode'));
        queries.insertNode({
          ...makeNode('spec:recovered', 'RecoveredKnowledge'),
          kind: 'spec_entry',
          language: 'unknown',
          sourceType: 'spec',
          definition: 'RecoveredGuidance',
        });
        conn.raw.exec(`
          DELETE FROM schema_versions WHERE version = 8;
          DROP TABLE ${missingTable};
        `);

        expect(conn.getSchemaVersion()).toBe(7);
        conn = reopenAndMigrate(conn);

        expect(conn.getSchemaVersion()).toBe(8);
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'RecoveredCode'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'RecoveredGuidance'"
        ).get()).toEqual({ count: 1 });
        const reopenedQueries = new KgQueryBuilder(conn);
        reopenedQueries.insertNode(makeNode('code:/project/AfterRepair.swift:AfterRepair', 'AfterRepair'));
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'AfterRepair'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      } finally {
        conn.close();
      }
    },
  );

  it('repairs an invalid v7 FTS config after reopening the database', () => {
    let conn = openFresh('schema-v7-invalid-config');
    try {
      new KgQueryBuilder(conn).insertNode(
        makeNode('code:/project/InvalidConfig.swift:InvalidConfig', 'InvalidConfigRecovered'),
      );
      conn.raw.exec(`
        DELETE FROM schema_versions WHERE version = 8;
        UPDATE code_fts_config SET v = 0 WHERE k = 'version';
      `);

      conn = reopenAndMigrate(conn);

      expect(conn.getSchemaVersion()).toBe(8);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'InvalidConfigRecovered'"
      ).get()).toEqual({ count: 1 });
      expect(conn.raw.prepare('SELECT v FROM code_fts_config WHERE k = ?').get('version')).toEqual({ v: 4 });
      expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    } finally {
      conn.close();
    }
  });

  it.each([
    'code_fts',
    'code_fts_data',
    'code_fts_idx',
    'code_fts_content',
    'code_fts_docsize',
    'code_fts_config',
    'knowledge_fts',
    'knowledge_fts_data',
    'knowledge_fts_idx',
    'knowledge_fts_content',
    'knowledge_fts_docsize',
    'knowledge_fts_config',
  ] as const)(
    'repairs an already-stamped v8 database after reopening with missing FTS table %s',
    (missingTable) => {
      let conn = openFresh(`schema-v8-missing-${missingTable}`);
      try {
        const queries = new KgQueryBuilder(conn);
        queries.insertNode(makeNode('code:/project/V8Recovered.swift:V8Recovered', 'V8Recovered'));
        queries.insertNode({
          ...makeNode('spec:v8-recovered', 'V8RecoveredKnowledge'),
          kind: 'spec_entry',
          language: 'unknown',
          sourceType: 'spec',
          definition: 'V8RecoveredGuidance',
        });
        conn.raw.exec(`DROP TABLE ${missingTable};`);

        expect(conn.getSchemaVersion()).toBe(8);
        conn = reopenAndMigrate(conn);

        expect(conn.getSchemaVersion()).toBe(8);
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'V8Recovered'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'V8RecoveredGuidance'"
        ).get()).toEqual({ count: 1 });

        const reopenedQueries = new KgQueryBuilder(conn);
        reopenedQueries.insertNode(makeNode('code:/project/V8AfterRepair.swift:V8AfterRepair', 'V8AfterRepair'));
        reopenedQueries.insertNode({
          ...makeNode('spec:v8-after-repair', 'V8AfterRepairKnowledge'),
          kind: 'spec_entry',
          language: 'unknown',
          sourceType: 'spec',
          definition: 'V8AfterRepairGuidance',
        });
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'V8AfterRepair'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare(
          "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'V8AfterRepairGuidance'"
        ).get()).toEqual({ count: 1 });
        expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      } finally {
        conn.close();
      }
    },
  );

  it.each([
    [
      'missing nodes_ai',
      'DROP TRIGGER nodes_ai;',
      'insert',
    ],
    [
      'corrupt nodes_ad',
      'DROP TRIGGER nodes_ad; CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN SELECT 1; END;',
      'delete',
    ],
    [
      'corrupt nodes_au',
      'DROP TRIGGER nodes_au; CREATE TRIGGER nodes_au AFTER UPDATE ON nodes BEGIN SELECT 1; END;',
      'update',
    ],
  ] as const)(
    'repairs stamped-v8 trigger state after reopening with %s',
    (_caseName, corruptSql, driftKind) => {
      let conn = openFresh(`schema-v8-trigger-${driftKind}`);
      try {
        const originalCode = makeNode(
          'code:/project/TriggerOriginal.swift:TriggerOriginal',
          'TriggerOriginalCode',
        );
        const originalKnowledge = {
          ...makeNode('spec:trigger-original', 'KnowledgeOriginalNode'),
          kind: 'spec_entry' as const,
          language: 'unknown' as const,
          sourceType: 'spec' as const,
          definition: 'TriggerOriginalKnowledge',
        };
        const queries = new KgQueryBuilder(conn);
        queries.insertNode(originalCode);
        queries.insertNode(originalKnowledge);
        conn.raw.exec(corruptSql);

        if (driftKind === 'insert') {
          queries.insertNode(makeNode(
            'code:/project/TriggerDrift.swift:TriggerDrift',
            'TriggerDriftInsertedCode',
          ));
          queries.insertNode({
            ...makeNode('spec:trigger-drift', 'TriggerDriftKnowledgeNode'),
            kind: 'spec_entry',
            language: 'unknown',
            sourceType: 'spec',
            definition: 'TriggerDriftInsertedKnowledge',
          });
        } else if (driftKind === 'delete') {
          queries.deleteNode(originalCode.id);
          queries.deleteNode(originalKnowledge.id);
        } else {
          queries.insertNode({
            ...originalCode,
            name: 'TriggerDriftUpdatedCode',
            qualifiedName: 'TriggerDriftUpdatedCode',
          });
          queries.insertNode({
            ...originalKnowledge,
            definition: 'TriggerDriftUpdatedKnowledge',
          });
        }

        conn = reopenAndMigrate(conn);
        const ftsCount = (table: 'code_fts' | 'knowledge_fts', term: string): number => (
          conn.raw.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table} MATCH ?`)
            .get(term) as { count: number }
        ).count;

        if (driftKind === 'insert') {
          expect(ftsCount('code_fts', 'TriggerDriftInsertedCode')).toBe(1);
          expect(ftsCount('knowledge_fts', 'TriggerDriftInsertedKnowledge')).toBe(1);
        } else if (driftKind === 'delete') {
          expect(ftsCount('code_fts', 'TriggerOriginalCode')).toBe(0);
          expect(ftsCount('knowledge_fts', 'TriggerOriginalKnowledge')).toBe(0);
        } else {
          expect(ftsCount('code_fts', 'TriggerOriginalCode')).toBe(0);
          expect(ftsCount('knowledge_fts', 'TriggerOriginalKnowledge')).toBe(0);
          expect(ftsCount('code_fts', 'TriggerDriftUpdatedCode')).toBe(1);
          expect(ftsCount('knowledge_fts', 'TriggerDriftUpdatedKnowledge')).toBe(1);
        }

        const repairedQueries = new KgQueryBuilder(conn);
        const afterRepairCode = makeNode(
          'code:/project/TriggerAfterRepair.swift:TriggerAfterRepair',
          'TriggerAfterRepairInsertedCode',
        );
        const afterRepairKnowledge = {
          ...makeNode('spec:trigger-after-repair', 'TriggerAfterRepairKnowledgeNode'),
          kind: 'spec_entry' as const,
          language: 'unknown' as const,
          sourceType: 'spec' as const,
          definition: 'TriggerAfterRepairInsertedKnowledge',
        };
        repairedQueries.insertNode(afterRepairCode);
        repairedQueries.insertNode(afterRepairKnowledge);
        expect(ftsCount('code_fts', 'TriggerAfterRepairInsertedCode')).toBe(1);
        expect(ftsCount('knowledge_fts', 'TriggerAfterRepairInsertedKnowledge')).toBe(1);

        repairedQueries.insertNode({
          ...afterRepairCode,
          name: 'TriggerAfterRepairUpdatedCode',
          qualifiedName: 'TriggerAfterRepairUpdatedCode',
        });
        repairedQueries.insertNode({
          ...afterRepairKnowledge,
          definition: 'TriggerAfterRepairUpdatedKnowledge',
        });
        expect(ftsCount('code_fts', 'TriggerAfterRepairInsertedCode')).toBe(0);
        expect(ftsCount('knowledge_fts', 'TriggerAfterRepairInsertedKnowledge')).toBe(0);
        expect(ftsCount('code_fts', 'TriggerAfterRepairUpdatedCode')).toBe(1);
        expect(ftsCount('knowledge_fts', 'TriggerAfterRepairUpdatedKnowledge')).toBe(1);

        repairedQueries.deleteNode(afterRepairCode.id);
        repairedQueries.deleteNode(afterRepairKnowledge.id);
        expect(ftsCount('code_fts', 'TriggerAfterRepairUpdatedCode')).toBe(0);
        expect(ftsCount('knowledge_fts', 'TriggerAfterRepairUpdatedKnowledge')).toBe(0);
        expect(conn.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      } finally {
        conn.close();
      }
    },
  );

  it('keeps the stamped-v8 reopen path read-only when FTS storage is healthy', () => {
    let conn = openFresh('schema-v8-healthy-reopen');
    try {
      const dbPath = conn.path;
      new KgQueryBuilder(conn).insertNode(
        makeNode('code:/project/Healthy.swift:Healthy', 'HealthyIndex'),
      );
      conn.raw.exec(`
        INSERT INTO code_fts(code_fts, rank) VALUES ('secure-delete', 1);
        UPDATE nodes SET signature = 'updated' WHERE id = 'code:/project/Healthy.swift:Healthy';
      `);
      expect(conn.raw.prepare('SELECT v FROM code_fts_config WHERE k = ?').get('version')).toEqual({ v: 5 });
      conn.close();

      conn = new KgDatabaseConnection();
      conn.open(dbPath);
      const before = conn.raw.prepare('SELECT total_changes() AS count').get() as { count: number };
      applyMigrations(conn);
      const after = conn.raw.prepare('SELECT total_changes() AS count').get() as { count: number };

      expect(after.count).toBe(before.count);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'HealthyIndex'"
      ).get()).toEqual({ count: 1 });
      expect(conn.raw.prepare('SELECT v FROM code_fts_config WHERE k = ?').get('version')).toEqual({ v: 5 });
    } finally {
      conn.close();
    }
  });

  it('keeps internal FTS content current across UPSERT and source-type changes', () => {
    const conn = openFresh('schema-v8-fts-upsert');
    try {
      const queries = new KgQueryBuilder(conn);
      const node = makeNode('code:/project/Feature.swift:Feature', 'OldFeatureName');
      queries.insertNode(node);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'OldFeatureName'"
      ).get()).toEqual({ count: 1 });

      queries.insertNode({
        ...node,
        name: 'NewFeatureName',
        qualifiedName: 'NewFeatureName',
      });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'OldFeatureName'"
      ).get()).toEqual({ count: 0 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'NewFeatureName'"
      ).get()).toEqual({ count: 1 });

      const knowledgeNode = {
        ...node,
        kind: 'spec_entry' as const,
        name: 'KnowledgeEntry',
        qualifiedName: 'KnowledgeEntry',
        language: 'unknown' as const,
        sourceType: 'spec' as const,
        definition: 'DurableRecipe',
      };
      queries.insertNode(knowledgeNode);
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM code_fts WHERE code_fts MATCH 'NewFeatureName'"
      ).get()).toEqual({ count: 0 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'DurableRecipe'"
      ).get()).toEqual({ count: 1 });

      queries.insertNode({ ...knowledgeNode, definition: 'UpdatedGuidance' });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'DurableRecipe'"
      ).get()).toEqual({ count: 0 });
      expect(conn.raw.prepare(
        "SELECT COUNT(*) AS count FROM knowledge_fts WHERE knowledge_fts MATCH 'UpdatedGuidance'"
      ).get()).toEqual({ count: 1 });

      queries.deleteNode(node.id);
      expect(conn.raw.prepare('SELECT COUNT(*) AS count FROM code_fts').get()).toEqual({ count: 0 });
      expect(conn.raw.prepare('SELECT COUNT(*) AS count FROM knowledge_fts').get()).toEqual({ count: 0 });
    } finally {
      conn.close();
    }
  });

  it('enforces anchor/target lifecycle and one materialized edge per syntax fact', () => {
    const conn = openFresh('schema-v7-lifecycle');
    try {
      const queries = new KgQueryBuilder(conn);
      const child = makeNode('code:/project/Child.swift:Child', 'Child');
      const parent = makeNode('code:/project/Parent.h:Parent', 'Parent');
      queries.insertNodes([child, parent]);
      const ref = makeRef(child.id);
      expect(queries.stageStructuralReferences([ref], 10)).toBe(1);
      expect(() => queries.stageStructuralReferences([{ ...ref, status: 'resolved' }])).toThrow(
        'cannot already be resolved',
      );
      expect(queries.getStructuralReferenceStatusCounts()).toEqual({
        pending: 1,
        resolved: 0,
        ambiguous: 0,
        not_found: 0,
      });

      queries.updateStructuralReferenceResolution(ref.refKey, {
        status: 'resolved',
        resolvedNodeId: parent.id,
        candidates: [parent.id],
        strategy: 'unique-exact',
        confidence: 1,
      }, 11);
      const edge = {
        source: child.id,
        target: parent.id,
        kind: 'extends' as const,
        originRefKey: ref.refKey,
      };
      expect(() => queries.upsertStructuralEdge({ ...edge, target: child.id })).toThrow(
        'endpoints do not match',
      );
      expect(() => queries.upsertStructuralEdge({ ...edge, kind: 'implements' })).toThrow(
        'kind does not match',
      );
      queries.upsertStructuralEdge(edge);
      queries.upsertStructuralEdge(edge);
      expect((conn.raw.prepare(
        'SELECT COUNT(*) AS count FROM edges WHERE origin_ref_key = ?'
      ).get(ref.refKey) as { count: number }).count).toBe(1);
      expect(queries.getOutgoingEdges(child.id)[0]).toMatchObject({
        target: parent.id,
        provenance: 'structural-resolver',
        originRefKey: ref.refKey,
      });
      queries.insertNode({ ...child, signature: 'updated child' });
      queries.insertNodes([{ ...parent, signature: 'updated parent' }]);
      expect(queries.getStructuralReference(ref.refKey)).toMatchObject({
        resolvedNodeId: parent.id,
        status: 'resolved',
      });
      expect(conn.raw.prepare('SELECT * FROM edges WHERE origin_ref_key = ?').all(ref.refKey)).toHaveLength(1);
      expect(queries.listStructuralReferences({ refKeys: [ref.refKey] })).toHaveLength(1);
      expect(queries.resetStructuralReferenceStatuses({ refKeys: [ref.refKey] }, 12)).toBe(1);
      expect(queries.getStructuralReference(ref.refKey)).toMatchObject({
        resolvedNodeId: null,
        status: 'pending',
        candidates: [],
      });
      expect(conn.raw.prepare('SELECT * FROM edges WHERE origin_ref_key = ?').all(ref.refKey)).toHaveLength(0);

      queries.updateStructuralReferenceResolution(ref.refKey, {
        status: 'resolved',
        resolvedNodeId: parent.id,
        candidates: [parent.id],
      });
      queries.upsertStructuralEdge(edge);

      const replacement = makeNode('code:/project/Parent2.h:Parent', 'Parent');
      queries.insertNode(replacement);
      queries.deleteNode(parent.id);
      expect(queries.getStructuralReference(ref.refKey)).toMatchObject({ resolvedNodeId: null, status: 'resolved' });
      expect(conn.raw.prepare('SELECT * FROM edges WHERE origin_ref_key = ?').all(ref.refKey)).toHaveLength(0);

      queries.updateStructuralReferenceResolution(ref.refKey, {
        status: 'resolved',
        resolvedNodeId: replacement.id,
        candidates: [replacement.id],
      });
      queries.upsertStructuralEdge({ ...edge, target: replacement.id });
      queries.deleteNode(child.id);
      expect(queries.getStructuralReference(ref.refKey)).toBeNull();
      expect(conn.raw.prepare('SELECT * FROM edges WHERE origin_ref_key = ?').all(ref.refKey)).toHaveLength(0);
    } finally {
      conn.close();
    }
  });

  it('leaves nodes, refs and edges byte-logically unchanged after a transaction fault', () => {
    const conn = openFresh('schema-v7-rollback');
    try {
      const queries = new KgQueryBuilder(conn);
      const child = makeNode('code:/project/Child.swift:Child', 'Child');
      const parent = makeNode('code:/project/Parent.h:Parent', 'Parent');
      queries.insertNodes([child, parent]);
      const ref = makeRef(child.id);
      queries.stageStructuralReferences([ref], 1);
      const beforeCounts = [
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM nodes').get() as { count: number }).count,
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM structural_refs').get() as { count: number }).count,
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM edges').get() as { count: number }).count,
      ];
      const beforeHash = contentHash(conn.raw);

      expect(() => conn.transaction(() => {
        queries.updateStructuralReferenceResolution(ref.refKey, {
          status: 'resolved',
          resolvedNodeId: parent.id,
          candidates: [parent.id],
        });
        queries.upsertStructuralEdge({
          source: child.id,
          target: parent.id,
          kind: 'extends',
          originRefKey: ref.refKey,
        });
        queries.insertNode(makeNode('code:/project/Fault.swift:Fault', 'Fault'));
        throw new Error('fault injection');
      })).toThrow('fault injection');

      const afterCounts = [
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM nodes').get() as { count: number }).count,
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM structural_refs').get() as { count: number }).count,
        (conn.raw.prepare('SELECT COUNT(*) AS count FROM edges').get() as { count: number }).count,
      ];
      expect(afterCounts).toEqual(beforeCounts);
      expect(contentHash(conn.raw)).toBe(beforeHash);
      expect((conn.raw.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
      expect(conn.raw.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    } finally {
      conn.close();
    }
  });
});
