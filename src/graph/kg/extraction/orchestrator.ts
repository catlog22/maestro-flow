// src/graph/kg/extraction/orchestrator.ts — 统一编排: code + knowledge → 同一 DB
// 参考: plan-maestrograph.md 第三节 Unified Extraction Pipeline
//
// CYCLE GUARD: MaestroGraph (../engine.js) is imported TYPE-ONLY here and
// via dynamic import() for value access. Do NOT add a value import of
// MaestroGraph — engine.ts statically imports this module's
// syncKnowledgeGraph via dynamic import, and a static back-edge would
// re-materialize a circular dependency that fails at runtime (TDZ).

import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { MaestroGraph } from '../engine.js';
import { KnowledgeExtractorRegistry } from './knowledge-extractor-registry.js';
import {
  forEachCodeExtractionResult,
  prepareExternalSurfaceScan,
  type PreparedExternalSurfaceScan,
} from './code/code-extractor.js';
import { materializeAppleExternalCatalog } from './code/external/apple-catalog.js';
import {
  emptyCoverageTotals,
  addUnsupportedExtensions,
  summarizeCodeSyncCoverage,
  unsupportedLanguageWarning,
  partialParseWarning,
} from './code-sync-coverage.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';
import { resolveCodeReferences } from '../resolution/code-resolver.js';
import type { SyncResult, SourceType } from '../db/types.js';
import type { StructuralReference } from '../resolution/structural-reference.js';
import { resolveCodeStructuralReferences } from '../resolution/code-reference-resolver.js';
import { FileLock } from '../sync/file-lock.js';
import { writeSyncState, writeSyncStateFailure, getGitHead } from '../sync-state.js';

export interface CodegraphSyncOptions {
  srcDirs?: string[];
  includeTests?: boolean;
  maxFileSize?: number;
  excludeDirs?: string[];
  excludeFiles?: string[];
  createMaestroIgnore?: boolean;
  allowExtractorScripts?: boolean;
  onProgress?: (file: string, count: number, total: number) => void;
}

export interface SyncKnowledgeGraphOptions {
  full?: boolean;
  sources?: SourceType[];
  codegraph?: CodegraphSyncOptions;
  /** Existing graph connection. The caller retains lifecycle ownership. */
  graph?: MaestroGraph;
  /** Deterministic failure points for atomicity regression tests. */
  faultInjection?: {
    beforeSourceScan?: (srcDir: string, index: number) => void;
    beforeStructuralResolution?: () => void;
    beforeFtsRebuild?: () => void;
    beforeTransactionCommit?: () => void;
    beforeSyncStateCommit?: () => void;
  };
}

interface CodegraphPreflight {
  canonicalProjectRoot: string;
  srcDirs: string[];
  startHead: string | null;
  startedAt: number;
  externalScan: PreparedExternalSurfaceScan;
}

export class CodegraphSyncCommittedError extends Error {
  readonly graphCommitted = true;
  readonly retryable = true;

  constructor(cause: unknown) {
    super(
      `Codegraph committed but sync watermark failed; graphCommitted=true retryable=true: `
      + `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'CodegraphSyncCommittedError';
  }
}

export async function syncKnowledgeGraph(
  projectPath: string,
  options?: SyncKnowledgeGraphOptions,
): Promise<SyncResult[]> {
  const lockPath = resolve(projectPath, '.workflow', 'kg', 'maestro.db.lock');
  return new FileLock(lockPath).withLock(() => syncKnowledgeGraphUnlocked(projectPath, options));
}

async function syncKnowledgeGraphUnlocked(
  projectPath: string,
  options?: SyncKnowledgeGraphOptions,
): Promise<SyncResult[]> {
  const workflowRoot = resolve(projectPath, '.workflow');
  const results: SyncResult[] = [];

  // 初始化或打开 DB。传入 graph 时由调用方持有生命周期。
  let mg = options?.graph;
  const ownsGraph = !mg;
  const dbPath = resolve(workflowRoot, 'kg', 'maestro.db');
  if (!mg) {
    const { MaestroGraph: MaestroGraphImpl } = await import('../engine.js');
    mg = existsSync(dbPath)
      ? await MaestroGraphImpl.open(projectPath)
      : await MaestroGraphImpl.init(projectPath);
  }

  let codegraphAttempt: {
    canonicalProjectRoot: string;
    startedAt: number;
    committed: boolean;
  } | null = null;

  try {
    const shouldSync = (source: string): boolean => {
      if (!options?.sources) return true;
      return options.sources.includes(source as SourceType);
    };

    // All manifest parsing, exact-file realpath/identity validation, exact byte
    // reads, and watermarks are captured before any source replacement starts.
    let codegraphPreflight: CodegraphPreflight | null = null;
    if (shouldSync('codegraph')) {
      const canonicalProjectRoot = realpathSync(projectPath);
      const startedAt = Date.now();
      codegraphAttempt = { canonicalProjectRoot, startedAt, committed: false };
      const candidateDirs = options?.codegraph?.srcDirs?.length
        ? options.codegraph.srcDirs
        : [canonicalProjectRoot];
      const srcDirs = [...new Set(candidateDirs.map((inputPath) => {
        const sourceDirectory = resolveSourceDirectory(canonicalProjectRoot, inputPath);
        if (!sourceDirectory) {
          throw new Error(`Code source directory does not exist: ${inputPath}`);
        }
        return sourceDirectory;
      }))];
      codegraphPreflight = {
        canonicalProjectRoot,
        srcDirs,
        startHead: getGitHead(canonicalProjectRoot),
        startedAt,
        externalScan: prepareExternalSurfaceScan(canonicalProjectRoot),
      };
    }

    // ── Knowledge sources (优先同步) ───────────────────────────────
    const queries = mg.getQueryBuilder();

    const changedKnowledgeNodes = new Map<string, string>();
    for (const entry of KnowledgeExtractorRegistry.getAll()) {
      if (!shouldSync(entry.sourceType)) continue;

      const startMs = Date.now();
      try {
        const sourcePath = entry.resolvePath(workflowRoot);
        const extractionResult = entry.extractFn(sourcePath, workflowRoot);
        for (const node of extractionResult.nodes) {
          if (node.body) changedKnowledgeNodes.set(node.id, node.body);
        }
        const removed = mg.getConnection().transaction(() => {
          const n = queries.deleteNodesBySourceType(entry.sourceType);
          if (extractionResult.nodes.length > 0) {
            queries.insertNodes(extractionResult.nodes);
            queries.insertEdges(extractionResult.edges);
            queries.upsertFile(extractionResult.fileRecord);
          }
          return n;
        });
        results.push({
          source: entry.sourceType,
          nodesAdded: extractionResult.nodes.length,
          nodesUpdated: 0,
          nodesRemoved: removed,
          edgesAdded: extractionResult.edges.length,
          edgesRemoved: 0,
          durationMs: Date.now() - startMs,
        });
      } catch (err) {
        process.stderr.write(`[MaestroGraph] Failed to sync ${entry.sourceType}: ${err instanceof Error ? err.message : String(err)}\n`);
        results.push({
          source: entry.sourceType,
          nodesAdded: 0,
          nodesUpdated: 0,
          nodesRemoved: 0,
          edgesAdded: 0,
          edgesRemoved: 0,
          durationMs: Date.now() - startMs,
        });
      }
    }

    // ── Code extraction (R3) ───────────────────────────────────────

    if (shouldSync('codegraph')) {
      if (!codegraphPreflight) throw new Error('Codegraph preflight was not prepared');
      if (!codegraphAttempt) throw new Error('Codegraph attempt was not initialized');
      const activeCodegraphAttempt = codegraphAttempt;
      const startMs = Date.now();
      let totalNodes = 0;
      let directEdges = 0;
      let stagedEdges = 0;
      let genericReferenceCount = 0;
      let structuralReferenceCount = 0;
      let removedFiles = 0;
      const coverageTotals = emptyCoverageTotals();
      const connection = mg.getConnection();
      const queries = mg.getQueryBuilder();
      const seenFilePaths = new Set<string>();
      const replacement = await connection.transactionAsync(async () => {
        // Internal-storage FTS keeps rows when nodes_ad is intentionally a no-op.
        // Clear it before node rowids can be reused by the replacement inserts.
        connection.raw.exec('DELETE FROM code_fts');
        const removed = queries.deleteNodesBySourceType('codegraph');
        removedFiles = queries.deleteFilesBySourceType('codegraph');
        connection.raw.exec(`
          DROP TABLE IF EXISTS temp._kg_pending_edges;
          DROP TABLE IF EXISTS temp._kg_pending_structural_refs;
          CREATE TEMP TABLE _kg_pending_edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            metadata TEXT,
            line INTEGER,
            col INTEGER,
            provenance TEXT
          );
          CREATE TEMP TABLE _kg_pending_structural_refs (
            ref_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL
          );
        `);
        const stageEdge = connection.raw.prepare(`
          INSERT INTO _kg_pending_edges (source, target, kind, metadata, line, col, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const stageRef = connection.raw.prepare(`
          INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_path, language)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const stageStructuralRef = connection.raw.prepare(`
          INSERT INTO _kg_pending_structural_refs (ref_key, payload)
          VALUES (?, ?)
        `);

        for (let index = 0; index < codegraphPreflight.srcDirs.length; index++) {
          const srcDir = codegraphPreflight.srcDirs[index];
          options?.faultInjection?.beforeSourceScan?.(srcDir, index);
          const stats = await forEachCodeExtractionResult({
            projectRoot: codegraphPreflight.canonicalProjectRoot,
            srcDir,
            includeTests: options?.codegraph?.includeTests ?? false,
            maxFileSize: options?.codegraph?.maxFileSize ?? 1024 * 1024,
            excludeDirs: options?.codegraph?.excludeDirs,
            excludeFiles: options?.codegraph?.excludeFiles,
            createMaestroIgnore: options?.codegraph?.createMaestroIgnore,
            allowExtractorScripts: options?.codegraph?.allowExtractorScripts,
            externalSurfaceScan: codegraphPreflight.externalScan,
            includeExternalSurfaces: index === 0,
            failOnSkippedFile: true,
            onProgress: options?.codegraph?.onProgress,
          }, (result) => {
            if (seenFilePaths.has(result.fileRecord.path)) return;
            seenFilePaths.add(result.fileRecord.path);
            totalNodes += queries.insertNodes(result.nodes);
            queries.upsertFile(result.fileRecord);
            for (const ref of result.references ?? []) {
              stageRef.run(
                ref.fromSymbolId,
                ref.referenceName,
                ref.referenceKind,
                ref.line ?? 0,
                ref.col ?? 0,
                ref.filePath,
                ref.language,
              );
              genericReferenceCount++;
            }
            for (const reference of result.structuralReferences ?? []) {
              stageStructuralRef.run(reference.refKey, JSON.stringify(reference));
              structuralReferenceCount++;
            }
            for (const edge of result.edges) {
              stageEdge.run(
                edge.source,
                edge.target,
                edge.kind,
                edge.metadata && Object.keys(edge.metadata).length > 0 ? JSON.stringify(edge.metadata) : null,
                edge.line ?? null,
                edge.column ?? null,
                edge.provenance ?? null,
              );
              stagedEdges++;
            }
          });
          if (stats.filesExtracted !== stats.filesScanned || stats.filesSkipped !== 0) {
            throw new Error(
              `Scheduled code extraction omitted files in ${srcDir}: `
              + `${stats.filesExtracted}/${stats.filesScanned} extracted, ${stats.filesSkipped} skipped`,
            );
          }
          coverageTotals.filesScanned += stats.filesScanned;
          coverageTotals.filesExtracted += stats.filesExtracted;
          coverageTotals.filesUnsupported += stats.filesUnsupported;
          coverageTotals.filesPartialParse += stats.filesPartialParse;
          addUnsupportedExtensions(coverageTotals, stats.unsupportedExtensions);
        }

        const missingExactFiles = codegraphPreflight.externalScan.files
          .map(item => item.file.canonicalPath)
          .filter(filePath => !seenFilePaths.has(filePath));
        if (missingExactFiles.length > 0) {
          throw new Error(`Exact external files produced no FileRecord: ${missingExactFiles.join(', ')}`);
        }

        const structuralReferences = (connection.raw.prepare(
          'SELECT payload FROM _kg_pending_structural_refs ORDER BY ref_key'
        ).all() as unknown as Array<{ payload: string }>).map(row => (
          JSON.parse(row.payload) as StructuralReference
        ));
        const apple = materializeAppleExternalCatalog(structuralReferences);
        totalNodes += queries.insertNodes(apple.nodes);
        for (const edge of apple.edges) {
          stageEdge.run(
            edge.source,
            edge.target,
            edge.kind,
            edge.metadata && Object.keys(edge.metadata).length > 0 ? JSON.stringify(edge.metadata) : null,
            edge.line ?? null,
            edge.column ?? null,
            edge.provenance ?? null,
          );
          stagedEdges++;
        }

        directEdges = Number(connection.raw.prepare(`
          INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
          SELECT p.source, p.target, p.kind, p.metadata, p.line, p.col, p.provenance
          FROM _kg_pending_edges p
          JOIN nodes source_node ON source_node.id = p.source
          JOIN nodes target_node ON target_node.id = p.target
        `).run().changes);
        queries.stageStructuralReferences(structuralReferences);
        options?.faultInjection?.beforeStructuralResolution?.();
        const structural = resolveCodeStructuralReferences(queries);
        const generic = resolveCodeReferences(connection.raw, {
          projectPath: codegraphPreflight.canonicalProjectRoot,
          transactionMode: 'caller-owned',
        });

        options?.faultInjection?.beforeFtsRebuild?.();
        queries.rebuildCodeFtsStrict();
        const liveNodeCount = Number((connection.raw.prepare(
          "SELECT COUNT(*) AS count FROM nodes WHERE source_type = 'codegraph'"
        ).get() as unknown as { count: number }).count);
        totalNodes = liveNodeCount;
        options?.faultInjection?.beforeTransactionCommit?.();
        connection.raw.exec(`
          DROP TABLE _kg_pending_edges;
          DROP TABLE _kg_pending_structural_refs;
        `);
        return { removed, generic, structural };
      });
      activeCodegraphAttempt.committed = true;
      if (directEdges !== stagedEdges) {
        process.stderr.write(`[MaestroGraph] Skipped ${stagedEdges - directEdges} unresolved direct code edge(s) during atomic replacement.\n`);
      }

      results.push({
        source: 'codegraph',
        nodesAdded: totalNodes,
        nodesUpdated: 0,
        nodesRemoved: replacement.removed,
        edgesAdded: directEdges,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
        coverage: summarizeCodeSyncCoverage(coverageTotals),
      });
      // 索引完全没发生时必须顶到 stderr：--json 消费者读 coverage，人读告警。
      for (const warning of [
        unsupportedLanguageWarning(coverageTotals),
        partialParseWarning(coverageTotals),
      ]) {
        if (warning) process.stderr.write(`[MaestroGraph] ${warning}\n`);
      }
      results.push({
        source: 'code-resolution',
        nodesAdded: 0,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: replacement.generic.edgesCreated,
        edgesRemoved: 0,
        durationMs: replacement.generic.durationMs,
      });
      results.push({
        source: 'code-structural-resolution',
        nodesAdded: 0,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: replacement.structural.edgesCreated,
        edgesRemoved: 0,
        durationMs: replacement.structural.durationMs,
      });

      // This is intentionally post-COMMIT. A watermark failure must remain
      // visible and retryable without pretending the committed graph rolled back.
      try {
        writeSyncState(
          codegraphPreflight.canonicalProjectRoot,
          codegraphPreflight.startHead,
          codegraphPreflight.externalScan.manifest.digest,
          codegraphPreflight.externalScan.externalFingerprint,
          {
            startedAt: codegraphPreflight.startedAt,
            beforeSuccessWrite: options?.faultInjection?.beforeSyncStateCommit,
          },
        );
      } catch (error) {
        throw new CodegraphSyncCommittedError(error);
      }
      if (process.env.MAESTRO_DEBUG === '1') {
        process.stderr.write(
          `[MaestroGraph] codegraph inputs: ${seenFilePaths.size} files, `
          + `${genericReferenceCount} generic refs, ${structuralReferenceCount} structural refs, `
          + `${removedFiles} replaced file records.\n`,
        );
      }
    }

    // ── Cross-source edge resolution ────────────────────────────────

    const resolveStartMs = Date.now();
    const resolveResult = resolveKnowledgeEdges(mg.getConnection().raw, { projectPath });
    results.push({
      source: 'knowledge-resolution',
      nodesAdded: 0,
      nodesUpdated: 0,
      nodesRemoved: 0,
      edgesAdded: resolveResult.totalEdgesCreated,
      edgesRemoved: 0,
      durationMs: resolveResult.durationMs,
    });

    // ── Credibility hash sync (incremental) ────────────────────────
    try {
      const { CredibilityStore, contentHash } = await import('../credibility.js');
      const store = new CredibilityStore(mg.getConnection().raw);
      const knowledgeSources: SourceType[] = ['domain', 'spec', 'knowhow', 'codebase', 'issue'];
      const nowMs = Date.now();
      mg.getConnection().transaction(() => {
        for (const [nodeId, body] of changedKnowledgeNodes) {
          store.upsert(nodeId, contentHash(body), nowMs);
        }
        // 清理陈旧 codegraph 消费痕迹 — 指向已不存在节点的 credibility 记录
        mg.getConnection().raw.prepare(
          `DELETE FROM credibility WHERE node_id LIKE 'code:%' AND node_id NOT IN (SELECT id FROM nodes)`
        ).run();
        store.cleanOrphans();
      });
    } catch (err) {
      process.stderr.write(`[MaestroGraph] Credibility sync skipped: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    // ── FTS 一致性校验 + 修复 (code_fts/knowledge_fts 必须按 source_type 过滤回填) ──
    // 历史版本曾无过滤全表回填导致两表各含全部节点 (99.6% 为跨类空壳), 此处重建为过滤版。
    try {
      ensureFtsConsistency(mg.getConnection().raw);
      // ensureFtsConsistency may DROP+recreate FTS tables; invalidate the
      // process-level v8-verification cache so the next open() re-checks.
      const { invalidateFtsV8Cache } = await import('../db/index.js');
      invalidateFtsV8Cache(mg.getConnection().path);
    } catch (err) {
      process.stderr.write(`[MaestroGraph] FTS consistency check failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    // ── Project metadata (审计/健康度) ─────────────────────────────
    try {
      const now = Date.now();
      const upsertMeta = mg.getConnection().raw.prepare(
        `INSERT OR REPLACE INTO project_metadata (key, value, updated_at) VALUES (?, ?, ?)`
      );
      upsertMeta.run('last_sync_at', String(now), now);
      upsertMeta.run('last_sync_head', getGitHead(projectPath) ?? '', now);
      // schema_version is the authoritative source in the schema_versions table
      // (read via conn.getSchemaVersion / getHealth). Do NOT mirror it into
      // project_metadata — it is write-only there (no reader) and can drift.
      const stats = mg.getStats();
      if (stats.detectedFrameworks.length > 0) {
        upsertMeta.run('detected_frameworks', JSON.stringify(stats.detectedFrameworks), now);
      }
    } catch (err) {
      process.stderr.write(`[MaestroGraph] project_metadata sync skipped: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    return results;
  } catch (error) {
    if (codegraphAttempt && !codegraphAttempt.committed) {
      try {
        writeSyncStateFailure(
          codegraphAttempt.canonicalProjectRoot,
          codegraphAttempt.startedAt,
          error,
        );
      } catch (stateError) {
        throw new AggregateError(
          [error, stateError],
          `Codegraph failed before COMMIT and failure state could not be recorded: `
          + `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    throw error;
  } finally {
    if (ownsGraph) mg.close();
  }
}

function resolveSourceDirectory(canonicalProjectRoot: string, inputPath: string): string | null {
  const candidate = resolve(canonicalProjectRoot, inputPath);
  if (!existsSync(candidate)) return null;
  const actual = realpathSync(candidate);
  const rel = relative(canonicalProjectRoot, actual);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return actual;
  throw new Error(`Code source directory must be inside project root: ${inputPath}`);
}

// ── FTS 一致性校验 + 重建 ───────────────────────────────────────────────
// 语义 (schema.sql): code_fts 只含 codegraph 节点, knowledge_fts 只含知识节点。
// 历史版本曾无过滤全表回填 (两表各 = 全部节点); 外部内容表模式又忽略触发器 WHERE。
// 现在 FTS 为内部存储表，触发器负责正常 INSERT/UPDATE/DELETE；这里保留
// count-level repair，处理表丢失、历史迁移或外部写入造成的结构性漂移。
function ensureFtsConsistency(db: import('node:sqlite').DatabaseSync): void {
  const codeNodes = Number(db.prepare(
    "SELECT COUNT(*) FROM nodes WHERE source_type = 'codegraph'"
  ).get()?.['COUNT(*)'] ?? 0);
  const knowledgeNodes = Number(db.prepare(
    "SELECT COUNT(*) FROM nodes WHERE source_type != 'codegraph'"
  ).get()?.['COUNT(*)'] ?? 0);
  const codeFts = Number(db.prepare('SELECT COUNT(*) FROM code_fts').get()?.['COUNT(*)'] ?? -1);
  const knowledgeFts = Number(db.prepare('SELECT COUNT(*) FROM knowledge_fts').get()?.['COUNT(*)'] ?? -1);

  if (codeFts === codeNodes && knowledgeFts === knowledgeNodes) return;

  process.stderr.write(
    `[MaestroGraph] FTS drift detected (code_fts=${codeFts}/${codeNodes}, knowledge_fts=${knowledgeFts}/${knowledgeNodes}) — rebuilding filtered indexes\n`
  );
  db.exec(`
    DROP TABLE IF EXISTS code_fts;
    CREATE VIRTUAL TABLE code_fts USING fts5(
      id, name, qualified_name, docstring, signature, keywords,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    INSERT INTO code_fts(rowid, id, name, qualified_name, docstring, signature, keywords)
    SELECT rowid, id, name, qualified_name, docstring, signature, keywords
    FROM nodes WHERE source_type = 'codegraph';

    DROP TABLE IF EXISTS knowledge_fts;
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      id, name, definition, body, aliases, keywords,
      tokenize = 'trigram'
    );
    INSERT INTO knowledge_fts(rowid, id, name, definition, body, aliases, keywords)
    SELECT rowid, id, name, definition, body, aliases, keywords
    FROM nodes WHERE source_type != 'codegraph';
  `);
}

