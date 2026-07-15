// src/graph/kg/extraction/orchestrator.ts — 统一编排: code + knowledge → 同一 DB
// 参考: plan-maestrograph.md 第三节 Unified Extraction Pipeline

import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import type { MaestroGraph } from '../engine.js';
import { KnowledgeExtractorRegistry } from './knowledge-extractor-registry.js';
import { forEachCodeExtractionResult } from './code/code-extractor.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';
import type { SyncResult, SourceType } from '../db/types.js';
import { FileLock } from '../sync/file-lock.js';
import { writeSyncState, getGitHead } from '../sync-state.js';

export interface CodegraphSyncOptions {
  srcDirs?: string[];
  includeTests?: boolean;
  maxFileSize?: number;
  excludeDirs?: string[];
  excludeFiles?: string[];
  createMaestroIgnore?: boolean;
  allowExtractorScripts?: boolean;
}

export interface SyncKnowledgeGraphOptions {
  full?: boolean;
  sources?: SourceType[];
  codegraph?: CodegraphSyncOptions;
  /** Existing graph connection. The caller retains lifecycle ownership. */
  graph?: MaestroGraph;
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

  try {
    const shouldSync = (source: string): boolean => {
      if (!options?.sources) return true;
      return options.sources.includes(source as SourceType);
    };

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
      const startMs = Date.now();
      const candidateDirs = options?.codegraph?.srcDirs?.length
        ? options.codegraph.srcDirs
        : [projectPath];
      const srcDirs = candidateDirs
        .map(d => resolveSourceDirectory(projectPath, d))
        .filter((d): d is string => d !== null);

      let totalNodes = 0;
      let totalEdges = 0;
      let stagedEdges = 0;
      const connection = mg.getConnection();
      const removedCode = await connection.transactionAsync(async () => {
        const removed = queries.deleteNodesBySourceType('codegraph');
        connection.raw.exec(`
          DROP TABLE IF EXISTS temp._kg_pending_edges;
          CREATE TEMP TABLE _kg_pending_edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            metadata TEXT,
            line INTEGER,
            col INTEGER,
            provenance TEXT
          );
        `);
        const stageEdge = connection.raw.prepare(`
          INSERT INTO _kg_pending_edges (source, target, kind, metadata, line, col, provenance)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const srcDir of srcDirs) {
          await forEachCodeExtractionResult({
            projectRoot: projectPath,
            srcDir,
            includeTests: options?.codegraph?.includeTests ?? false,
            maxFileSize: options?.codegraph?.maxFileSize ?? 1024 * 1024,
            excludeDirs: options?.codegraph?.excludeDirs,
            excludeFiles: options?.codegraph?.excludeFiles,
            createMaestroIgnore: options?.codegraph?.createMaestroIgnore,
            allowExtractorScripts: options?.codegraph?.allowExtractorScripts,
          }, (result) => {
            if (result.nodes.length === 0) return;
            totalNodes += queries.insertNodes(result.nodes);
            queries.upsertFile(result.fileRecord);
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
        }

        totalEdges = Number(connection.raw.prepare(`
          INSERT INTO edges (source, target, kind, metadata, line, col, provenance)
          SELECT p.source, p.target, p.kind, p.metadata, p.line, p.col, p.provenance
          FROM _kg_pending_edges p
          JOIN nodes source_node ON source_node.id = p.source
          JOIN nodes target_node ON target_node.id = p.target
        `).run().changes);
        connection.raw.exec('DROP TABLE _kg_pending_edges');
        return removed;
      });
      if (totalEdges !== stagedEdges) {
        process.stderr.write(`[MaestroGraph] Skipped ${stagedEdges - totalEdges} unresolved code edge(s) during atomic replacement.\n`);
      }

      results.push({
        source: 'codegraph',
        nodesAdded: totalNodes,
        nodesUpdated: 0,
        nodesRemoved: removedCode,
        edgesAdded: totalEdges,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });

      // 记录同步水位 — kg-sync hook 据此发现"已提交但未同步"的变更
      writeSyncState(projectPath, getGitHead(projectPath));
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
        store.cleanOrphans();
      });
    } catch (err) {
      process.stderr.write(`[MaestroGraph] Credibility sync skipped: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    return results;
  } finally {
    if (ownsGraph) mg.close();
  }
}

function resolveSourceDirectory(projectPath: string, inputPath: string): string | null {
  const candidate = resolve(projectPath, inputPath);
  if (!existsSync(candidate)) return null;
  const root = realpathSync(projectPath);
  const actual = realpathSync(candidate);
  const rel = relative(root, actual);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return actual;
  throw new Error(`Code source directory must be inside project root: ${inputPath}`);
}
