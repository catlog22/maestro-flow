// src/graph/kg/extraction/knowledge/codebase-extractor.ts
// 从 .workflow/codebase/*.md 提取 codebase_section nodes

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { makeNodeId } from '../../db/connection.js';
import type {
  UnifiedNode, UnifiedEdge, FileRecord, ExtractionResult,
  SourceType, Language,
} from '../../db/types.js';

export function extractCodebase(
  codebaseDir: string,
  workflowRoot: string,
): ExtractionResult {
  const nodes: UnifiedNode[] = [];
  const edges: UnifiedEdge[] = [];
  const now = Date.now();

  if (!existsSync(codebaseDir)) {
    return { nodes, edges, fileRecord: createEmptyFileRecord(codebaseDir), references: [], structuralReferences: [] };
  }

  const mdFiles = readdirSync(codebaseDir)
    .filter(f => extname(f) === '.md')
    .map(f => resolve(codebaseDir, f));

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = basename(filePath, '.md');

    // 解析 sections — 以标题分割
    const sections = parseSections(content, filePath);

    for (const section of sections) {
      const nodeId = makeNodeId('codebase', filePath, section.headingSlug);

      nodes.push({
        id: nodeId,
        kind: 'codebase_section',
        name: section.heading,
        qualifiedName: `codebase:${fileName}:${section.headingSlug}`,
        filePath: filePath,
        language: 'markdown' as Language,
        startLine: section.lineStart,
        endLine: section.lineEnd,
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
        sourceType: 'codebase' as SourceType,
        definition: section.summary,
        aliases: [],
        keywords: [],
        category: '',
        roles: [],
        priority: '',
        status: 'active',
        body: section.content,
        metadata: { sourceFile: fileName },
        updatedAt: now,
      });

      // contains edges — 子节到父节
      if (section.parentHeading) {
        edges.push({
          source: makeNodeId('codebase', filePath, section.parentHeading),
          target: nodeId,
          kind: 'contains',
          provenance: 'harvest',
        });
      }
    }
  }

  return {
    nodes,
    edges,
    references: [],
    structuralReferences: [],
    fileRecord: {
      path: codebaseDir,
      contentHash: '',
      language: 'markdown' as Language,
      size: 0,
      modifiedAt: now,
      indexedAt: now,
      nodeCount: nodes.length,
      errors: [],
      sourceType: 'codebase' as SourceType,
    },
  };
}

// ---------------------------------------------------------------------------
// Section 解析 — 以标题分割 Markdown 文件
// ---------------------------------------------------------------------------

interface ParsedSection {
  heading: string;
  headingSlug: string;
  parentHeading: string | null;
  content: string;
  summary: string;
  lineStart: number;
  lineEnd: number;
}

function parseSections(content: string, filePath: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = content.split('\n');
  let current: ParsedSection | null = null;
  let lastH2Heading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^#{1,3}\s+(.+)/);
    if (match) {
      if (current) {
        current.lineEnd = i;
        current.summary = current.content.split('\n')[0]?.substring(0, 200) ?? '';
        sections.push(current);
      }
      const heading = match[1].trim();
      const headingSlug = slugify(heading);
      const level = line.match(/^(#{1,3})/)?.[1]?.length ?? 1;
      const parentHeading = level >= 3 && lastH2Heading ? lastH2Heading : null;
      if (level === 2) lastH2Heading = headingSlug;

      current = {
        heading,
        headingSlug,
        parentHeading,
        content: '',
        summary: '',
        lineStart: i + 1,
        lineEnd: lines.length,
      };
    } else if (current) {
      current.content += line + '\n';
    }
  }

  if (current) {
    current.lineEnd = lines.length;
    current.summary = current.content.split('\n')[0]?.substring(0, 200) ?? '';
    sections.push(current);
  }

  // 如果没有标题，创建整体 section
  if (sections.length === 0 && content.trim()) {
    sections.push({
      heading: basename(filePath, '.md'),
      headingSlug: slugify(basename(filePath, '.md')),
      parentHeading: null,
      content: content,
      summary: content.split('\n')[0]?.substring(0, 200) ?? '',
      lineStart: 1,
      lineEnd: lines.length,
    });
  }

  return sections;
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
}

function createEmptyFileRecord(path: string): FileRecord {
  return {
    path, contentHash: '', language: 'markdown' as Language,
    size: 0, modifiedAt: 0, indexedAt: 0, nodeCount: 0,
    errors: [], sourceType: 'codebase' as SourceType,
  };
}
