// src/graph/kg/extraction/knowledge/wiki-extractor.ts
// 从 .workflow/knowhow/*.md 提取 knowhow_entry nodes + documents edges

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { makeNodeId } from '../../db/connection.js';
import { parseFrontmatter } from '../../../../utils/frontmatter.js';
import { normalizeCanonicalKnowledgeContent } from '../../../../../shared/knowledge-content.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  SourceType, Language,
} from '../../db/types.js';

export function extractWiki(
  knowhowDir: string,
  workflowRoot: string,
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const now = Date.now();

  if (!existsSync(knowhowDir)) {
    return { nodes, edges, fileRecord: createEmptyFileRecord(knowhowDir), references: [], structuralReferences: [] };
  }

  const mdFiles = readdirSync(knowhowDir)
    .filter(f => extname(f) === '.md')
    .map(f => resolve(knowhowDir, f));

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);
    const canonical = normalizeCanonicalKnowledgeContent({
      ...parsed.data,
      content: parsed.body.trimStart(),
    });
    const slug = basename(filePath, '.md');
    const nodeId = makeNodeId('knowhow', slug.toLowerCase());
    const body = canonical.content;

    nodes.push({
      id: nodeId,
      kind: 'knowhow_entry',
      name: canonical.title || slug,
      qualifiedName: `knowhow:${slug}`,
      filePath: filePath,
      language: 'unknown',
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      docstring: '',
      signature: '',
      visibility: '',
      isExported: false,
      isAsync: false,
      isStatic: false,
      isAbstract: false,
      decorators: [],
      typeParameters: [],
      sourceType: 'knowhow' as SourceType,
      definition: canonical.summary,
      aliases: [],
      keywords: canonical.keywords,
      category: canonical.category ?? canonical.type ?? '',
      roles: [],
      priority: '',
      status: canonical.lifecycleStatus,
      body: body,
      metadata: {
        wikiId: `knowhow-${slug.toLowerCase()}`,
        type: canonical.type ?? '',
        language: canonical.language ?? '',
        sourceRef: canonical.sourceRef ?? '',
        relatedPaths: canonical.relatedPaths,
        appliesToRepoIds: canonical.appliesToRepoIds,
        decisionState: canonical.decisionState ?? '',
        lifecycleStatus: canonical.lifecycleStatus,
        canonicalAudit: canonical.auditMarkers,
      },
      updatedAt: now,
    });

    // documents edges 由 knowledge-resolver 的 resolveDocumentsEdges 负责建立
    // 不在提取阶段创建 pending edges（FK 约束要求 target 必须是有效 nodeId）
  }

  return {
    nodes,
    edges,
    references: [],
    structuralReferences: [],
    fileRecord: {
      path: knowhowDir,
      contentHash: '',
      language: 'unknown',
      size: 0,
      modifiedAt: now,
      indexedAt: now,
      nodeCount: nodes.length,
      errors: [],
      sourceType: 'knowhow' as SourceType,
    },
  };
}

function createEmptyFileRecord(path: string): FileRecord {
  return {
    path, contentHash: '', language: 'unknown',
    size: 0, modifiedAt: 0, indexedAt: 0, nodeCount: 0,
    errors: [], sourceType: 'knowhow' as SourceType,
  };
}
