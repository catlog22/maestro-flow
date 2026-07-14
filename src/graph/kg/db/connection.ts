// src/graph/kg/db/connection.ts — MaestroGraph SQLite 连接管理
// D1.4: WAL + busy_timeout 5000 + FileLock 保护写操作

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import type { Language, SourceType } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class KgDatabaseConnection {
  private db: DatabaseSync | null = null;
  private dbPath: string = '';

  get raw(): DatabaseSync {
    if (!this.db) throw new Error('MaestroGraph database not open');
    return this.db;
  }

  get path(): string {
    return this.dbPath;
  }

  get isOpen(): boolean {
    return this.db !== null;
  }

  /** 初始化 — 创建 DB + 应用 Schema */
  initialize(dbPath: string): void {
    this.dbPath = dbPath;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.applyPragmas();
    this.transaction(() => {
      this.loadSchema();
      this.setSchemaVersion(2, 'MaestroGraph unified schema v2');
    });
  }

  /** 打开已有 DB */
  open(dbPath: string): void {
    if (!existsSync(dbPath)) {
      throw new Error(`MaestroGraph database not found: ${dbPath}. Run "maestro kg init" first.`);
    }
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.applyPragmas();
  }

  close(): void {
    if (this.db) {
      try {
        this.db.exec('ROLLBACK');
      } catch { /* ignore if no active transaction */ }
      try {
        this.db.exec('PRAGMA mmap_size = 0');
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (err) {
        console.warn('[MaestroGraph] checkpoint failed on close:', (err as Error).message);
      }
      this.db.close();
      this.db = null;
    }
  }

  private applyPragmas(): void {
    const db = this.raw;
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA cache_size = -64000');
    db.exec('PRAGMA temp_store = MEMORY');
    // Windows 上 mmap 会锁定文件阻止扩容，导致 WAL checkpoint 失败 → DB 损坏
    if (process.platform !== 'win32') {
      db.exec('PRAGMA mmap_size = 268435456');
    }
  }

  private loadSchema(): void {
    // 尝试多个可能路径: 源码目录、dist 目录、上级目录
    const candidates = [
      resolve(__dirname, '..', 'schema.sql'),           // src/graph/kg/schema.sql (源码)
      resolve(__dirname, 'schema.sql'),                  // dist/src/graph/kg/db/schema.sql (dist)
      resolve(__dirname, '..', '..', '..', '..', 'src', 'graph', 'kg', 'schema.sql'),  // 相对源码
    ];
    let sql: string | null = null;
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        sql = readFileSync(candidate, 'utf-8');
        break;
      }
    }
    if (!sql) {
      throw new Error(`MaestroGraph schema file not found. Tried: ${candidates.join(', ')}`);
    }
    this.raw.exec(sql);
  }

  private setSchemaVersion(version: number, description: string): void {
    this.raw.prepare(
      'INSERT OR REPLACE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
    ).run(version, Date.now(), description);
  }

  getSchemaVersion(): number {
    try {
      const row = this.raw.prepare(
        'SELECT MAX(version) as v FROM schema_versions'
      ).get() as unknown as { v: number } | undefined;
      return row?.v ?? 0;
    } catch (err) {
      if (err instanceof Error && /no such table:\s*schema_versions/i.test(err.message)) {
        return 0;
      }
      throw new Error(
        `Failed to read MaestroGraph schema version: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  transaction<T>(fn: () => T): T {
    return sqliteTransaction(this.raw, fn);
  }

  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  optimize(): void {
    this.raw.exec('PRAGMA optimize');
    this.raw.exec('VACUUM');
    this.raw.exec('ANALYZE');
  }

  runMaintenance(): void {
    this.raw.exec('PRAGMA optimize');
    this.raw.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }

  getSize(): number {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// DB 路径获取 — .workflow/kg/maestro.db
// ---------------------------------------------------------------------------
export function getKgDatabasePath(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return resolve(root, '.workflow', 'kg', 'maestro.db');
}

// ---------------------------------------------------------------------------
// Node ID 命名空间辅助 (D8.4) — re-export from types.ts (单一定义源)
// ---------------------------------------------------------------------------
export { makeNodeId, validateNodeId } from './types.js';

// ---------------------------------------------------------------------------
// 通用类型映射辅助
// ---------------------------------------------------------------------------
export const FILE_LEVEL_ONLY_LANGUAGES: Set<string> = new Set(['yaml', 'twig', 'properties']);

export function isFileLevelOnlyLanguage(lang: Language | string): boolean {
  return FILE_LEVEL_ONLY_LANGUAGES.has(lang);
}

export function isKnowledgeSourceType(sourceType: string): boolean {
  return sourceType !== 'codegraph' && sourceType !== '';
}

export function sqliteTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
