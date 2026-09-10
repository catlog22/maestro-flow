// src/graph/kg/db/connection.ts — MaestroGraph SQLite 连接管理
// D1.4: WAL + busy_timeout 5000 + FileLock 保护写操作

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language, SourceType } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** applyMigrations 完成后应达到的最新 schema 版本。 */
export const KG_SCHEMA_VERSION = 8 as const;

export class KgDatabaseConnection {
  private db: DatabaseSync | null = null;
  private dbPath: string = '';
  private readOnly = false;

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
    this.readOnly = false;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.applyPragmas();
    this.transaction(() => {
      this.loadSchema();
      // 保留 v2 baseline，让 fresh DB 与历史 DB 统一走可审计的 migration 链。
      // 同时补记 v1 审计行：fresh DB 直接加载了完整 schema.sql (含 v1 结构)，
      // 但若不记 v1，schema_versions 会缺失该行，使审计历史不完整。
      this.setSchemaVersion(1, 'Initial CodeGraph-compatible schema');
      this.setSchemaVersion(2, 'MaestroGraph unified schema v2');
    });
  }

  /** 打开已有 DB */
  open(dbPath: string): void {
    if (!existsSync(dbPath)) {
      throw new Error(`MaestroGraph database not found: ${dbPath}. Run "maestro kg init" first.`);
    }
    this.dbPath = dbPath;
    this.readOnly = false;
    this.db = new DatabaseSync(dbPath);
    this.applyPragmas();
  }

  /** 以 SQLite read-only 模式打开已有 DB，不应用任何 write-like PRAGMA。 */
  openReadOnly(dbPath: string): void {
    if (!existsSync(dbPath)) {
      throw new Error(`MaestroGraph database not found: ${dbPath}.`);
    }
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath, { readOnly: true });
    this.readOnly = true;
    // busy_timeout 让只读连接在写事务 (sync) 持锁时等待而非立即 SQLITE_BUSY。
    // read-only 安全，不改变数据。
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  close(): void {
    if (this.db) {
      const db = this.db;
      if (!this.readOnly) {
        try {
          db.exec('ROLLBACK');
        } catch { /* ignore if no active transaction */ }
        // PASSIVE checkpoint lets readers continue and does not force a full
        // WAL merge — TRUNCATE blocks writers for 50-500ms on medium DBs and
        // runs on every close() (2-4x per prompt). Auto-checkpointing handles
        // routine merging; explicit TRUNCATE is reserved for maintenance.
        try {
          db.exec('PRAGMA wal_checkpoint(PASSIVE)');
        } catch (err) {
          console.warn('[MaestroGraph] checkpoint failed on close:', (err as Error).message);
        }
      }
      try {
        db.close();
      } finally {
        this.db = null;
        this.readOnly = false;
      }
    }
  }

  private applyPragmas(): void {
    const db = this.raw;
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    // 16MB page cache (was -64000 = 64MB). Each open() allocates a fresh
    // DatabaseSync + page cache; with 2-3 concurrent opens per prompt
    // (worker + derived-index builder) the 64MB default multiplied to
    // 128-192MB of heap on top of tree-sitter WASM + embedding model memory.
    // 16MB is sufficient for typical codegraph queries; auto-checkpoint
    // keeps the WAL bounded. Revisit if query-heavy paths show cache misses.
    db.exec('PRAGMA cache_size = -16000');
    db.exec('PRAGMA temp_store = MEMORY');
    // Windows 上 mmap 会锁定文件阻止扩容，导致 WAL checkpoint 失败 → DB 损坏
    if (process.platform !== 'win32') {
      db.exec('PRAGMA mmap_size = 268435456');
    }
  }

  private loadSchema(): void {
    // 尝试多个可能路径: 源码目录、dist 目录、上级目录。
    // 所有候选必须解析到包内 (pkgRoot 之下),拒绝项目本地 schema.sql 覆盖
    // (CWE-494: 防止项目树中的伪造 schema.sql 被 exec 为任意 DDL/DML)。
    const pkgRoot = resolve(__dirname, '..', '..', '..', '..'); // .../maestro-flow
    const candidates = [
      resolve(__dirname, '..', 'schema.sql'),           // src/graph/kg/schema.sql (源码)
      resolve(__dirname, 'schema.sql'),                  // dist/src/graph/kg/db/schema.sql (dist)
      resolve(__dirname, '..', '..', '..', '..', 'src', 'graph', 'kg', 'schema.sql'),  // 相对源码
    ];
    let sql: string | null = null;
    let usedCandidate: string | null = null;
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const real = realpathSync(candidate);
      // Reject any candidate that escapes the package root — a project-local
      // schema.sql planted at a resolved path must not be executed.
      const rel = relative(pkgRoot, real);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      sql = readFileSync(real, 'utf-8');
      usedCandidate = real;
      break;
    }
    if (!sql) {
      throw new Error(`MaestroGraph schema file not found in package. Tried: ${candidates.join(', ')}`);
    }
    void usedCandidate;
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
      // SQLite may auto-rollback on certain errors (SQLITE_FULL, SQLITE_IOERR,
      // constraint failures); a bare ROLLBACK then throws 'no transaction is
      // active', masking the original root cause. Guard the rollback so the
      // original error propagates cleanly.
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* transaction may have auto-rolled back; propagate original error */
      }
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
export const FILE_LEVEL_ONLY_LANGUAGES: Set<string> = new Set(['yaml', 'twig', 'xml', 'properties']);

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
    // Guard rollback so an auto-rolled-back transaction does not mask the
    // original error with 'no transaction is active'.
    try {
      db.exec('ROLLBACK');
    } catch {
      /* transaction may have auto-rolled back; propagate original error */
    }
    throw err;
  }
}
