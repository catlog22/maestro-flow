import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KnowledgeGraph } from './types.js';
import { DatabaseConnection, getDatabasePath } from './db/connection.js';
import { QueryBuilder } from './db/queries.js';

const DEFAULT_KG_PATH = '.workflow/codebase/knowledge-graph.json';

export type DetectedBackend = 'sqlite' | 'json' | 'none';

export function loadGraph(kgPath: string = DEFAULT_KG_PATH): KnowledgeGraph {
  const fullPath = resolve(kgPath);
  if (!existsSync(fullPath)) {
    throw new Error(`Knowledge graph not found: ${fullPath}`);
  }
  const raw = readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw) as KnowledgeGraph;
}

export function loadGraphSqlite(projectRoot?: string): { conn: DatabaseConnection; queries: QueryBuilder } {
  const dbPath = getDatabasePath(projectRoot);
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite graph not found: ${dbPath}`);
  }
  const conn = new DatabaseConnection();
  conn.open(dbPath);
  return { conn, queries: new QueryBuilder(conn) };
}

export function detectBackend(projectRoot?: string): DetectedBackend {
  const dbPath = getDatabasePath(projectRoot);
  if (existsSync(dbPath)) return 'sqlite';
  const jsonPath = resolve(projectRoot ?? process.cwd(), DEFAULT_KG_PATH);
  if (existsSync(jsonPath)) return 'json';
  return 'none';
}
