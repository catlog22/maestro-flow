// src/graph/kg/extraction/knowledge/wiki-extractor.ts
// 从 .workflow/knowhow/*.md 提取 knowhow_entry nodes + documents edges

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { makeNodeId } from '../../db/connection.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  SourceType, Language,
} from '../../db/types.js';

interface KnowhowFrontmatter {
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  specCategory?: string;
  category?: string;
  status?: string;
  lang?: string;
  source?: string;
  keywords?: string[];
}

export function extractWiki(
  knowhowDir: string,
  workflowRoot: string,
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const now = Date.now();

  if (!existsSync(knowhowDir)) {
    return { nodes, edges, fileRecord: createEmptyFileRecord(knowhowDir) };
  }

  const mdFiles = readdirSync(knowhowDir)
    .filter(f => extname(f) === '.md')
    .map(f => resolve(knowhowDir, f));

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseKnowhowFrontmatter(content);
    const slug = basename(filePath, '.md');
    const nodeId = makeNodeId('knowhow', slug);

    // 解析 body (去掉 frontmatter)
    const body = extractBody(content);

    nodes.push({
      id: nodeId,
      kind: 'knowhow_entry',
      name: fm.title ?? slug,
      qualifiedName: `knowhow:${slug}`,
      filePath: filePath,
      language: 'markdown' as Language,
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
      definition: fm.description ?? '',
      aliases: [],
      keywords: fm.keywords ?? fm.tags ?? [],
      category: fm.specCategory ?? fm.category ?? fm.type ?? '',
      roles: [],
      priority: '',
      status: fm.status ?? 'active',
      body: body,
      metadata: {
        type: fm.type ?? '',
        lang: fm.lang ?? '',
        source: fm.source ?? '',
      },
      updatedAt: now,
    });

    // documents edges 由 knowledge-resolver 的 resolveDocumentsEdges 负责建立
    // 不在提取阶段创建 pending edges（FK 约束要求 target 必须是有效 nodeId）
  }

  return {
    nodes,
    edges,
    fileRecord: {
      path: knowhowDir,
      contentHash: '',
      language: 'markdown' as Language,
      size: 0,
      modifiedAt: now,
      indexedAt: now,
      nodeCount: nodes.length,
      errors: [],
      sourceType: 'knowhow' as SourceType,
    },
  };
}

// ---------------------------------------------------------------------------
// Frontmatter 解析
// ---------------------------------------------------------------------------

function parseKnowhowFrontmatter(content: string): KnowhowFrontmatter {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return {};

  const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (endIdx <= 0) return {};

  const fmLines = lines.slice(1, endIdx);
  const result: KnowhowFrontmatter = {};

  for (const line of fmLines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = match[1];
      let value: unknown = match[2].trim();
      // 尝试解析 JSON 数组/对象
      if (typeof value === 'string') {
        const str = value as string;
        if (str.startsWith('[') || str.startsWith('{')) {
          try { value = JSON.parse(str); } catch { /* keep as string */ }
        }
        // 处理 YAML 风格的数组 ["a", "b"]
        else if (str.startsWith('[')) {
          try { value = JSON.parse(str); } catch { /* keep */ }
        }
      }
      // 映射到 KnowhowFrontmatter 字段
      switch (key) {
        case 'type': result.type = value as string; break;
        case 'title': result.title = value as string; break;
        case 'description': result.description = value as string; break;
        case 'tags': result.tags = Array.isArray(value) ? value as string[] : [value as string]; break;
        case 'specCategory': result.specCategory = value as string; break;
        case 'category': result.category = value as string; break;
        case 'status': result.status = value as string; break;
        case 'lang': result.lang = value as string; break;
        case 'source': result.source = value as string; break;
        case 'keywords': result.keywords = Array.isArray(value) ? value as string[] : [value as string]; break;
      }
    }
  }

  return result;
}

function extractBody(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return content;

  const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (endIdx <= 0) return content;

  return lines.slice(endIdx + 1).join('\n');
}

function createEmptyFileRecord(path: string): FileRecord {
  return {
    path, contentHash: '', language: 'markdown' as Language,
    size: 0, modifiedAt: 0, indexedAt: 0, nodeCount: 0,
    errors: [], sourceType: 'knowhow' as SourceType,
  };
}