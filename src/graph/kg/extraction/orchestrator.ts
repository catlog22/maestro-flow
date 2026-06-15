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

    if (shouldSync('domain')) {
      const startMs = Date.now();
      const domainResult = extractDomain(
        resolve(workflowRoot, 'domain', 'glossary.json'),
        workflowRoot,
      );
      if (domainResult.nodes.length > 0) {
        mg.insertExtractionResults(domainResult);
      }
      results.push({
        source: 'domain',
        nodesAdded: domainResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: domainResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('spec')) {
      const startMs = Date.now();
      const specDir = resolve(workflowRoot, 'specs');
      const specResult = extractSpec(specDir, workflowRoot);
      if (specResult.nodes.length > 0) {
        mg.insertExtractionResults(specResult);
      }
      results.push({
        source: 'spec',
        nodesAdded: specResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: specResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('knowhow')) {
      const startMs = Date.now();
      const knowhowDir = resolve(workflowRoot, 'knowhow');
      const wikiResult = extractWiki(knowhowDir, workflowRoot);
      if (wikiResult.nodes.length > 0) {
        mg.insertExtractionResults(wikiResult);
      }
      results.push({
        source: 'knowhow',
        nodesAdded: wikiResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: wikiResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('codebase')) {
      const startMs = Date.now();
      const codebaseDir = resolve(workflowRoot, 'codebase');
      const codebaseResult = extractCodebase(codebaseDir, workflowRoot);
      if (codebaseResult.nodes.length > 0) {
        mg.insertExtractionResults(codebaseResult);
      }
      results.push({
        source: 'codebase',
        nodesAdded: codebaseResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: codebaseResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    if (shouldSync('issue')) {
      const startMs = Date.now();
      const issuesPath = resolve(workflowRoot, 'issues', 'issues.jsonl');
      const issueResult = extractIssues(issuesPath, workflowRoot);
      if (issueResult.nodes.length > 0) {
        mg.insertExtractionResults(issueResult);
      }
      results.push({
        source: 'issue',
        nodesAdded: issueResult.nodes.length,
        nodesUpdated: 0,
        nodesRemoved: 0,
        edgesAdded: issueResult.edges.length,
        edgesRemoved: 0,
        durationMs: Date.now() - startMs,
      });
    }

    // ── Code extraction (R3) ───────────────────────────────────────

    if (shouldSync('codegraph')) {
      const startMs = Date.now();
      const candidateDirs = ['src', 'lib', 'app', 'packages', 'apps'];
      const srcDirs = candidateDirs
        .map(d => resolve(projectPath, d))
        .filter(d => existsSync(d));
      if (srcDirs.length === 0) srcDirs.push(resolve(projectPath, 'src'));

      let totalNodes = 0;
      let totalEdges = 0;

      for (const srcDir of srcDirs) {
        if (!existsSync(srcDir)) continue;
        const codeResult = await extractCode({
          srcDir,
          includeTests: false,
          maxFileSize: 500 * 1024,
        });

        for (const result of codeResult.results) {
          if (result.nodes.length > 0) {
            mg.insertExtractionResults(result);
          }
        }

        totalNodes += codeResult.stats.nodesCreated;
        totalEdges += codeResult.stats.edgesCreated;
      }

      results.push({
        source: 'codegraph',
        nodesAdded: totalNodes,
        nodesUpdated: 0,
        nodesRemoved: 0,
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

    return results;
  } finally {
    mg.close();
  }
}