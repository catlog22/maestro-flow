// src/graph/kg/extraction/knowledge/domain-extractor.ts
// 从 .workflow/domain/glossary.yaml (或 .json 回退) 提取 domain_term nodes + relates_to edges + aliases edges

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import YAML from 'yaml';
import { makeNodeId } from '../../db/connection.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  SourceType, Language,
} from '../../db/types.js';

// Domain glossary 结构 (参考 plan-domain-knowledge.md)
interface DomainTerm {
  id: string;
  canonical: string;
  definition: string;
  aliases: string[];
  keywords: string[];
  relationships: string[];
  category?: string;
  status?: string;
}

interface DomainGlossary {
  version: string;
  terms: DomainTerm[];
}

export function extractDomain(
  glossaryPath: string,
  workflowRoot: string,
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];

  if (!existsSync(glossaryPath)) {
    return { nodes, edges, fileRecord: createEmptyFileRecord(glossaryPath), references: [], structuralReferences: [] };
  }

  const raw = readFileSync(glossaryPath, 'utf-8');
  const glossary: DomainGlossary = glossaryPath.endsWith('.yaml') ? YAML.parse(raw) : JSON.parse(raw);
  const now = Date.now();

  for (const term of glossary.terms) {
    const nodeId = makeNodeId('domain', term.id);

    // 1. 创建 domain_term node
    nodes.push({
      id: nodeId,
      kind: 'domain_term',
      name: term.canonical,
      qualifiedName: `domain:${term.canonical}`,
      filePath: glossaryPath,
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
      sourceType: 'domain' as SourceType,
      definition: term.definition,
      aliases: term.aliases,
      keywords: term.keywords,
      category: term.category ?? '',
      roles: [],
      priority: '',
      status: term.status ?? 'active',
      body: '',
      metadata: {},
      updatedAt: now,
    });

    // 2. 创建 relates_to edges (从 relationships 字段)
    for (const relId of term.relationships) {
      const targetId = makeNodeId('domain', relId);
      edges.push({
        source: nodeId,
        target: targetId,
        kind: 'relates_to',
        provenance: 'domain',
      });
    }

    // 3. aliases edges (同义词关系)
    for (const alias of term.aliases) {
      edges.push({
        source: nodeId,
        target: nodeId,  // aliases 是自身属性, 不产生独立节点
        kind: 'aliases',
        provenance: 'domain',
        metadata: { alias },
      });
    }
  }

  return {
    nodes,
    edges,
    references: [],
    structuralReferences: [],
    fileRecord: {
      path: glossaryPath,
      contentHash: computeContentHash(glossaryPath),
      language: 'json' as Language,
      size: 0,
      modifiedAt: now,
      indexedAt: now,
      nodeCount: nodes.length,
      errors: [],
      sourceType: 'domain' as SourceType,
    },
  };
}

// 删除级联清理 (D3.2)
export function purgeDomainTerm(db: import('node:sqlite').DatabaseSync, termId: string): void {
  const nodeId = makeNodeId('domain', termId);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
    db.prepare('DELETE FROM edges WHERE source = ?').run(nodeId);
    db.prepare('DELETE FROM edges WHERE target = ?').run(nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 辅助函数
function createEmptyFileRecord(path: string): FileRecord {
  return {
    path, contentHash: '', language: 'json' as Language,
    size: 0, modifiedAt: 0, indexedAt: 0, nodeCount: 0,
    errors: [], sourceType: 'domain' as SourceType,
  };
}

function computeContentHash(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // 简易 hash — 生产环境应使用 crypto.createHash
    return String(content.length);
  } catch {
    return '';
  }
}
