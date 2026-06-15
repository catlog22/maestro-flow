// src/graph/kg/extraction/knowledge/issue-extractor.ts
// 从 .workflow/issues/issues.jsonl 提取 issue nodes + resolves edges

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeNodeId } from '../../db/connection.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  SourceType, Language,
} from '../../db/types.js';

interface IssueEntry {
  id: string;
  title: string;
  description: string;
  severity?: string;
  status?: string;
  resolution?: string;
  created_at?: string;
  updated_at?: string;
  fix_direction?: string;
  labels?: string[];
}

export function extractIssues(
  issuesPath: string,
  workflowRoot: string,
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const now = Date.now();

  if (!existsSync(issuesPath)) {
    return { nodes, edges, fileRecord: createEmptyFileRecord(issuesPath) };
  }

  const content = readFileSync(issuesPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const issue: IssueEntry = JSON.parse(line);
      const nodeId = makeNodeId('issue', issue.id);

      nodes.push({
        id: nodeId,
        kind: 'issue',
        name: issue.title,
        qualifiedName: `issue:${issue.id}`,
        filePath: issuesPath,
        language: 'unknown' as Language,
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
        sourceType: 'issue' as SourceType,
        definition: issue.description,
        aliases: [],
        keywords: issue.labels ?? [],
        category: issue.severity ?? '',
        roles: [],
        priority: issue.severity === 'critical' ? 'must' : issue.severity === 'high' ? 'should' : 'may',
        status: issue.status ?? 'open',
        body: issue.description,
        metadata: {
          severity: issue.severity ?? '',
          fixDirection: issue.fix_direction ?? '',
          resolution: issue.resolution ?? '',
        },
        updatedAt: now,
      });

      // resolves edges 由 knowledge-resolver 负责建立
      // 不在提取阶段创建 pending edges（FK 约束要求 target 必须是有效 nodeId）
    } catch {
      // 解析失败的行跳过
    }
  }

  return {
    nodes,
    edges,
    fileRecord: {
      path: issuesPath,
      contentHash: '',
      language: 'json' as Language,
      size: 0,
      modifiedAt: now,
      indexedAt: now,
      nodeCount: nodes.length,
      errors: [],
      sourceType: 'issue' as SourceType,
    },
  };
}

function createEmptyFileRecord(path: string): FileRecord {
  return {
    path, contentHash: '', language: 'json' as Language,
    size: 0, modifiedAt: 0, indexedAt: 0, nodeCount: 0,
    errors: [], sourceType: 'issue' as SourceType,
  };
}