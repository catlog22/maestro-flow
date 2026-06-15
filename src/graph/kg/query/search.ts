// src/graph/kg/query/search.ts — FTS5 统一搜索
// 参考: plan-maestrograph.md Gap 修补 6 — 搜索策略链: FTS5 → LIKE → Fuzzy

import type { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode, UnifiedSearchResult, SourceType } from '../db/types.js';
import { sanitizeFtsQuery } from '../db/queries.js';
import { computeScore, extractSearchTerms, removeStopWords } from './scoring.js';

// ---------------------------------------------------------------------------
// 搜索选项
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** 限定来源类型 */
  sourceTypes?: SourceType[];
  /** 限定节点类型 */
  kinds?: string[];
  /** 限定语言 */
  languages?: string[];
  /** 最大结果数 */
  limit?: number;
  /** 是否包含代码节点 */
  includeCode?: boolean;
  /** 是否包含知识节点 */
  includeKnowledge?: boolean;
  /** 图遍历深度 (从命中节点扩展) */
  expandDepth?: number;
}

// ---------------------------------------------------------------------------
// 统一搜索入口
// ---------------------------------------------------------------------------

export interface UnifiedSearchOutput {
  directMatches: UnifiedSearchResult[];
  summary: {
    codeSymbols: number;
    domainTerms: number;
    specRules: number;
    knowhowDocs: number;
    total: number;
  };
}

/**
 * 统一搜索 — 跨代码 + 知识层查询
 *
 * 策略链: FTS5 → LIKE → Fuzzy
 * 多信号评分: BM25 + kindBonus + pathRelevance + nameMatchBonus
 * CJK 短查询降级到 LIKE (trigram 最小 3 字符)
 */
export function searchUnified(
  queries: KgQueryBuilder,
  query: string,
  options?: SearchOptions,
): UnifiedSearchOutput {
  const limit = options?.limit ?? 20;
  const includeCode = options?.includeCode !== false;
  const includeKnowledge = options?.includeKnowledge !== false;

  // 清洗查询 — 保留原始查询 + camelCase 分词两种策略
  const searchTerms = extractSearchTerms(query);
  const meaningfulTerms = removeStopWords(searchTerms);
  const effectiveQuery = meaningfulTerms.length > 0 ? meaningfulTerms.join(' ') : query;

  const allResults: UnifiedSearchResult[] = [];

  // 代码 FTS5 搜索 — 双策略: 原始查询 + camelCase 分词
  if (includeCode) {
    const codeKinds = options?.kinds as string[] | undefined;
    const seenIds = new Set<string>();

    // 策略 1: 原始查询（精确匹配 camelCase 符号名）
    const exactResults = queries.searchCodeFTS(query, {
      limit: limit * 2,
      kinds: codeKinds,
      languages: options?.languages as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    for (const node of exactResults) {
      if (seenIds.has(node.id)) continue;
      seenIds.add(node.id);
      allResults.push({
        node,
        score: computeScore(node, query),
        matchReason: { kind: 'direct', field: 'name' },
      });
    }

    // 策略 2: 分词后查询（覆盖多词搜索场景）
    if (effectiveQuery !== query) {
      const tokenResults = queries.searchCodeFTS(effectiveQuery, {
        limit: limit * 2,
        kinds: codeKinds,
        languages: options?.languages as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      });
      for (const node of tokenResults) {
        if (seenIds.has(node.id)) continue;
        seenIds.add(node.id);
        allResults.push({
          node,
          score: computeScore(node, query),
          matchReason: { kind: 'direct', field: 'name' },
        });
      }
    }
  }

  // 知识 FTS5 搜索 (P2: _bm25Score 透传给 computeScore)
  if (includeKnowledge) {
    const knowledgeResults = queries.searchKnowledgeFTS(effectiveQuery, {
      limit: limit * 2,
      sourceTypes: options?.sourceTypes,
    });

    const kindFilter = options?.kinds;
    for (const node of knowledgeResults) {
      if (kindFilter && kindFilter.length > 0 && !kindFilter.includes(node.kind)) continue;
      allResults.push({
        node,
        score: computeScore(node, query),
        matchReason: { kind: 'direct', field: 'name' },
      });
    }
  }

  // 按综合评分排序, 取 top N
  allResults.sort((a, b) => b.score - a.score);
  const directMatches = allResults.slice(0, limit);

  // 统计
  const summary = {
    codeSymbols: allResults.filter(r => r.node.sourceType === 'codegraph').length,
    domainTerms: allResults.filter(r => r.node.sourceType === 'domain').length,
    specRules: allResults.filter(r => r.node.sourceType === 'spec').length,
    knowhowDocs: allResults.filter(r => r.node.sourceType === 'knowhow').length,
    total: allResults.length,
  };

  return { directMatches, summary };
}

// ---------------------------------------------------------------------------
// 单层搜索 (代码/知识分离)
// ---------------------------------------------------------------------------

export function searchCodeOnly(
  queries: KgQueryBuilder,
  query: string,
  options?: { kinds?: string[]; languages?: string[]; limit?: number },
): UnifiedNode[] {
  return queries.searchCodeFTS(query, {
    kinds: options?.kinds as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    languages: options?.languages as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    limit: options?.limit ?? 20,
  });
}

export function searchKnowledgeOnly(
  queries: KgQueryBuilder,
  query: string,
  options?: { sourceTypes?: SourceType[]; limit?: number },
): UnifiedNode[] {
  return queries.searchKnowledgeFTS(query, {
    sourceTypes: options?.sourceTypes,
    limit: options?.limit ?? 20,
  });
}

// ---------------------------------------------------------------------------
// Field-qualified 查询解析
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  text: string;
  kinds: string[];
  languages: string[];
  pathFilters: string[];
  sourceTypes: string[];
}

/**
 * 解析 field-qualified 查询
 * 例: "kind:function TenantService" → { text: "TenantService", kinds: ["function"] }
 * 支持: kind: lang: path: source:
 */
export function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    text: '',
    kinds: [],
    languages: [],
    pathFilters: [],
    sourceTypes: [],
  };

  const parts = query.split(/\s+/);
  const textParts: string[] = [];

  for (const part of parts) {
    const match = part.match(/^(kind|lang|path|source):(.+)$/i);
    if (match) {
      const field = match[1].toLowerCase();
      const value = match[2].toLowerCase();
      switch (field) {
        case 'kind': result.kinds.push(value); break;
        case 'lang': result.languages.push(value); break;
        case 'path': result.pathFilters.push(value); break;
        case 'source': result.sourceTypes.push(value as SourceType); break;
      }
    } else {
      textParts.push(part);
    }
  }

  result.text = textParts.join(' ');
  return result;
}