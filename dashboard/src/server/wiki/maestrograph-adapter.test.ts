import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { adaptKnowledgeGraph, adaptKnowledgeGraphFromDb } from './virtual-wiki-adapters.js';
import { WikiIndexer } from './wiki-indexer.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('MaestroGraph Wiki projection', () => {
  it('stabilizes lossy ID collisions before projecting edge targets', () => {
    const entries = adaptKnowledgeGraph({
      project: { analyzedAt: '2026-01-01T00:00:00.000Z' },
      nodes: [
        { id: 'pkg/a-b', type: 'class', name: 'Slash', summary: '', tags: [] },
        { id: 'pkg-a/b', type: 'class', name: 'Dash', summary: '', tags: [] },
      ],
      edges: [{ source: 'pkg/a-b', target: 'pkg-a/b', type: 'calls' }],
    }, 'codebase/knowledge-graph.json');

    const slash = entries.find(entry => entry.title === 'Slash')!;
    const dash = entries.find(entry => entry.title === 'Dash')!;
    expect(slash.id).not.toBe(dash.id);
    expect(slash.related).toContain(dash.id);
    expect(slash.ext.kgEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: dash.id, type: 'calls' }),
    ]));
  });

  it('stabilizes layer IDs that normalize to the same slug', () => {
    const entries = adaptKnowledgeGraph({
      nodes: [{ id: 'node', type: 'class', name: 'Node', summary: '', tags: [] }],
      edges: [],
      layers: [
        { id: 'pkg/a-b', name: 'Slash Layer', description: '', nodeIds: ['node'] },
        { id: 'pkg-a/b', name: 'Dash Layer', description: '', nodeIds: ['node'] },
      ],
    }, 'codebase/knowledge-graph.json');

    const layerIds = entries.filter(entry => entry.ext.virtualKind === 'kg-layer').map(entry => entry.id);
    expect(new Set(layerIds).size).toBe(2);
  });

  it('prefers canonical maestro.db over the legacy JSON graph', async () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), 'maestro-wiki-db-'));
    roots.push(workflowRoot);
    mkdirSync(join(workflowRoot, 'kg'), { recursive: true });
    mkdirSync(join(workflowRoot, 'codebase'), { recursive: true });

    const db = new DatabaseSync(join(workflowRoot, 'kg', 'maestro.db'));
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        source_type TEXT NOT NULL,
        definition TEXT,
        body TEXT,
        category TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE edges (source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL);
      INSERT INTO nodes VALUES ('domain:canonical', 'domain_term', 'Canonical Node', NULL, 'domain', 'from sqlite', NULL, NULL, 1);
    `);
    db.close();

    writeFileSync(join(workflowRoot, 'codebase', 'knowledge-graph.json'), JSON.stringify({
      nodes: [{ id: 'legacy', type: 'class', name: 'Legacy Only', summary: '', tags: [] }],
      edges: [],
    }));

    const index = await new WikiIndexer({ workflowRoot }).get();
    expect(index.entries.some(entry => entry.title === 'Canonical Node')).toBe(true);
    expect(index.entries.some(entry => entry.title === 'Legacy Only')).toBe(false);
  });

  it('preserves full node body for spec/knowhow kg nodes and keeps codegraph stubs empty', async () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), 'maestro-wiki-body-'));
    roots.push(workflowRoot);
    mkdirSync(join(workflowRoot, 'kg'), { recursive: true });

    const db = new DatabaseSync(join(workflowRoot, 'kg', 'maestro.db'));
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        source_type TEXT NOT NULL,
        definition TEXT,
        body TEXT,
        category TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE edges (source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL);
      INSERT INTO nodes VALUES ('knowhow:recipe', 'recipe', 'Full Text Recipe', NULL, 'knowhow', 'def', 'FULL BODY CONTENT — the complete text must survive projection', NULL, 1);
      INSERT INTO nodes VALUES ('code:stub', 'function', 'NoBody', '/src/a.ts', 'codegraph', NULL, NULL, NULL, 1);
    `);
    db.close();

    const index = await new WikiIndexer({ workflowRoot }).get();
    const full = index.entries.find(entry => entry.title === 'Full Text Recipe')!;
    expect(full.body).toBe('FULL BODY CONTENT — the complete text must survive projection');
    expect(full.summary).toBe('def'); // summary still prefers definition over body
    const stub = index.entries.find(entry => entry.title === 'NoBody')!;
    expect(stub.body).toBe('');
    expect(stub.ext.filePath).toBe('/src/a.ts');
  });

  it('materializes the selected node set before projecting a large edge set', () => {
    const workflowRoot = mkdtempSync(join(tmpdir(), 'maestro-wiki-edges-'));
    roots.push(workflowRoot);
    mkdirSync(join(workflowRoot, 'kg'), { recursive: true });
    const dbPath = join(workflowRoot, 'kg', 'maestro.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        source_type TEXT NOT NULL,
        definition TEXT,
        body TEXT,
        category TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE edges (source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL);
      CREATE INDEX idx_nodes_source_type ON nodes(source_type);
      CREATE INDEX idx_nodes_name ON nodes(name);
      CREATE INDEX idx_edges_source_kind ON edges(source, kind);
      BEGIN;
    `);
    const insertNode = db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertEdge = db.prepare('INSERT INTO edges VALUES (?, ?, ?)');
    for (let index = 0; index < 5_000; index++) {
      const id = `code:${String(index).padStart(4, '0')}`;
      const target = `code:${String((index + 1) % 5_000).padStart(4, '0')}`;
      insertNode.run(id, 'function', `Node ${String(index).padStart(4, '0')}`, `/src/${index}.ts`, 'codegraph', null, null, null, 1);
      insertEdge.run(id, target, 'calls');
    }
    db.exec('COMMIT;');
    db.close();

    const startedAt = performance.now();
    const entries = adaptKnowledgeGraphFromDb(dbPath, 'kg/maestro.db');
    const elapsedMs = performance.now() - startedAt;

    expect(entries).toHaveLength(5_000);
    const first = entries.find(entry => entry.ext.kgNodeId === 'code:0000')!;
    const second = entries.find(entry => entry.ext.kgNodeId === 'code:0001')!;
    expect(first.related).toContain(second.id);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});
