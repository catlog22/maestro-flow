// src/graph/kg/extraction/orchestrator.ts — 统一编排: code + knowledge → 同一 DB
// 参考: plan-maestrograph.md 第三节 Unified Extraction Pipeline

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { MaestroGraph } from '../engine.js';
import { KnowledgeExtractorRegistry } from './knowledge-extractor-registry.js';
import { forEachCodeExtractionResult } from './code/code-extractor.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';
import type { SyncResult, SourceType } from '../db/types.js';

export interface CodegraphSyncOptions {
  srcDirs?: string[];
  includeTests?: boolean;
  maxFileSize?: number;
  excludeDirs?: string[];
  excludeFiles?: string[];
  createMaestroIgnore?: boolean;
  allowExtractorScripts?: boolean;
}

export async function syncKnowledgeGraph(
  projectPath: string,
  options?: { full?: boolean; sources?: SourceType[]; codegraph?: CodegraphSyncOptions },
): Promise<SyncResult[]> {
  const workflowRoot = resolve(projectPath, '.workflow');
  const results: SyncResult[] = [];

  // 初始化或打开 DB
  let mg: MaestroGraph;
  const dbPath = resolve(workflowRoot, 'kg', 'maestro.db');
  if (existsSync(dbPath)) {
    mg = await MaestroGraph.open(projectPath);
  } else {
    mg = await MaestroGraph.init(projectPath);
  }

  try {
    const shouldSync = (source: string): boolean => {
      if (!options?.sources) return true;
      return options.sources.includes(source as SourceType);
    };

    // ── Knowledge sources (优先同步) ───────────────────────────────
    const queries = mg.getQueryBuilder();

    for (const entry of KnowledgeExtractorRegistry.getAll()) {
      if (!shouldSync(entry.sourceType)) continue;

      const startMs = Date.now();
      const sourcePath = entry.resolvePath(workflowRoot);
      const extractionResult = entry.extractFn(sourcePath, workflowRoot);
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType(entry.sourceType);
        if (extractionResult.nodes.length > 0) {
          mg.insertExtractionResults(extractionResult);
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
    }

    // ── Code extraction (R3) ───────────────────────────────────────

    if (shouldSync('codegraph')) {
      const startMs = Date.now();
      const candidateDirs = options?.codegraph?.srcDirs?.length
        ? options.codegraph.srcDirs
        : [projectPath];
      const srcDirs = candidateDirs
        .map(d => resolve(projectPath, d))
        .filter(d => existsSync(d));

      let totalNodes = 0;
      let totalEdges = 0;
      const allResults: import('../db/types.js').ExtractionResult[] = [];

      for (const srcDir of srcDirs) {
        if (!existsSync(srcDir)) continue;
        const stats = await forEachCodeExtractionResult({
          projectRoot: projectPath,
          srcDir,
          includeTests: options?.codegraph?.includeTests ?? false,
          maxFileSize: options?.codegraph?.maxFileSize ?? 1024 * 1024,
          excludeDirs: options?.codegraph?.excludeDirs,
          excludeFiles: options?.codegraph?.excludeFiles,
          createMaestroIgnore: options?.codegraph?.createMaestroIgnore,
          allowExtractorScripts: options?.codegraph?.allowExtractorScripts,
        }, async (result) => {
          if (result.nodes.length > 0) {
            allResults.push(result);
          }
        });

        totalNodes += stats.nodesCreated;
        totalEdges += stats.edgesCreated;
      }

      const removedCode = mg.getConnection().transaction(() => {
        const removed = queries.deleteNodesBySourceType('codegraph');
        for (const result of allResults) {
          try {
            mg.insertExtractionResults(result);
          } catch (err) {
            try {
              mg.getQueryBuilder().insertNodes(result.nodes);
              mg.getQueryBuilder().upsertFile(result.fileRecord);
              if (process.env.DEBUG) {
                process.stderr.write(`[MaestroGraph] Partial write for ${result.fileRecord.path}: edges skipped (${err instanceof Error ? err.message : String(err)})\n`);
              }
            } catch (innerErr) {
              process.stderr.write(`[MaestroGraph] Failed to index ${result.fileRecord.path}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}\n`);
            }
          }
        }
        return removed;
      });

      results.push({
        source: 'codegraph',
        nodesAdded: totalNodes,
        nodesUpdated: 0,
        nodesRemoved: removedCode,
        edgesAdded: totalEdges,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
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
      const knowledgeNodes = mg.getConnection().raw.prepare(
        `SELECT id, body FROM nodes WHERE source_type IN (${knowledgeSources.map(() => '?').join(',')}) AND body IS NOT NULL AND body != ''`
      ).all(...knowledgeSources) as Array<{ id: string; body: string }>;
      const nowMs = Date.now();
      mg.getConnection().transaction(() => {
        for (const node of knowledgeNodes) {
          store.upsert(node.id, contentHash(node.body), nowMs);
        }
      });
    } catch (err) {
      if (process.env.DEBUG) {
        process.stderr.write(`[MaestroGraph] Credibility sync skipped: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    return results;
  } finally {
    mg.close();
  }
}
