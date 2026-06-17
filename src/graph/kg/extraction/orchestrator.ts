// src/graph/kg/extraction/orchestrator.ts — 统一编排: code + knowledge → 同一 DB
// 参考: plan-maestrograph.md 第三节 Unified Extraction Pipeline

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { MaestroGraph } from '../engine.js';
import { extractDomain } from './knowledge/domain-extractor.js';
import { extractSpec } from './knowledge/spec-extractor.js';
import { extractWiki } from './knowledge/wiki-extractor.js';
import { extractCodebase } from './knowledge/codebase-extractor.js';
import { extractIssues } from './knowledge/issue-extractor.js';
import { extractCode } from './code/code-extractor.js';
import { resolveKnowledgeEdges } from '../resolution/knowledge-resolver.js';
import type { SyncResult, SourceType } from '../db/types.js';

export async function syncKnowledgeGraph(
  projectPath: string,
  options?: { full?: boolean; sources?: SourceType[] },
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
    // 同步前清理旧节点（ON DELETE CASCADE 会级联删除关联 edges）
    const queries = mg.getQueryBuilder();

    if (shouldSync('domain')) {
      const startMs = Date.now();
      const domainResult = extractDomain(
        resolve(workflowRoot, 'domain', 'glossary.json'),
        workflowRoot,
      );
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType('domain');
        if (domainResult.nodes.length > 0) {
          mg.insertExtractionResults(domainResult);
        }
        return n;
      });
      results.push({
        source: 'domain',
        nodesAdded: domainResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: removed,
        edgesAdded: domainResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('spec')) {
      const startMs = Date.now();
      const specDir = resolve(workflowRoot, 'specs');
      const specResult = extractSpec(specDir, workflowRoot);
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType('spec');
        if (specResult.nodes.length > 0) {
          mg.insertExtractionResults(specResult);
        }
        return n;
      });
      results.push({
        source: 'spec',
        nodesAdded: specResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: removed,
        edgesAdded: specResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('knowhow')) {
      const startMs = Date.now();
      const knowhowDir = resolve(workflowRoot, 'knowhow');
      const wikiResult = extractWiki(knowhowDir, workflowRoot);
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType('knowhow');
        if (wikiResult.nodes.length > 0) {
          mg.insertExtractionResults(wikiResult);
        }
        return n;
      });
      results.push({
        source: 'knowhow',
        nodesAdded: wikiResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: removed,
        edgesAdded: wikiResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('codebase')) {
      const startMs = Date.now();
      const codebaseDir = resolve(workflowRoot, 'codebase');
      const codebaseResult = extractCodebase(codebaseDir, workflowRoot);
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType('codebase');
        if (codebaseResult.nodes.length > 0) {
          mg.insertExtractionResults(codebaseResult);
        }
        return n;
      });
      results.push({
        source: 'codebase',
        nodesAdded: codebaseResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: removed,
        edgesAdded: codebaseResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('issue')) {
      const startMs = Date.now();
      const issuesPath = resolve(workflowRoot, 'issues', 'issues.jsonl');
      const issueResult = extractIssues(issuesPath, workflowRoot);
      const removed = mg.getConnection().transaction(() => {
        const n = queries.deleteNodesBySourceType('issue');
        if (issueResult.nodes.length > 0) {
          mg.insertExtractionResults(issueResult);
        }
        return n;
      });
      results.push({
        source: 'issue',
        nodesAdded: issueResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: removed,
        edgesAdded: issueResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    // ── Code extraction (R3) ───────────────────────────────────────

    if (shouldSync('codegraph')) {
      const startMs = Date.now();
      const removedCode = queries.deleteNodesBySourceType('codegraph');
      const preferredDirs = ['src', 'lib', 'app', 'packages', 'apps', 'dashboard/src'];
      const srcDirs = preferredDirs
        .map(d => resolve(projectPath, d))
        .filter(d => existsSync(d));
      if (srcDirs.length === 0) {
        srcDirs.push(projectPath);
      }

      let totalNodes = 0;
      let totalEdges = 0;

      for (const srcDir of srcDirs) {
        if (!existsSync(srcDir)) continue;
        const codeResult = await extractCode({
          srcDir,
          projectRoot: projectPath,
          includeTests: false,
          maxFileSize: 500 * 1024,
        });

        for (const result of codeResult.results) {
          if (result.nodes.length > 0) {
            try {
              mg.insertExtractionResults(result);
            } catch {
              // FK or unique constraint — insert nodes only, skip edges
              try {
                mg.getQueryBuilder().insertNodes(result.nodes);
                mg.getQueryBuilder().upsertFile(result.fileRecord);
              } catch { /* skip this file entirely */ }
            }
          }
        }

        totalNodes += codeResult.stats.nodesCreated;
        totalEdges += codeResult.stats.edgesCreated;
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
      for (const node of knowledgeNodes) {
        store.upsert(node.id, contentHash(node.body), nowMs);
      }
    } catch {
      // Credibility sync is best-effort — never fail the extraction pipeline
    }

    return results;
  } finally {
    mg.close();
  }
}