// src/graph/kg/query/search.ts — FTS5 统一搜索
// 参考: plan-maestrograph.md Gap 修补 6 — 搜索策略链: FTS5 → LIKE → Fuzzy

import type { KgQueryBuilder } from '../db/queries.js';
import type { UnifiedNode, UnifiedSearchResult, SourceType } from '../db/types.js';
import type { VectorSearchResult } from '../embedding/code-embedding.js';
import { sanitizeFtsQuery } from '../db/queries.js';
import { computeScore, extractSearchTerms, removeStopWords, expandCodeQuery, getStemVariants } from './scoring.js';

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
      languages: options?.languages,
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
        languages: options?.languages,
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

    // 策略 3: 代码同义词扩展查询（auth→authentication 等缩写映射 + 词干变体）
    const expandedQuery = expandCodeQuery(effectiveQuery);
    if (expandedQuery !== effectiveQuery && expandedQuery !== query) {
      const expandedResults = queries.searchCodeFTS(expandedQuery, {
        limit: limit * 2,
        kinds: codeKinds,
        languages: options?.languages,
      });
      for (const node of expandedResults) {
        if (seenIds.has(node.id)) continue;
        seenIds.add(node.id);
        allResults.push({
          node,
          score: computeScore(node, query),
          matchReason: { kind: 'direct', field: 'name' },
        });
      }
    }

    // 策略 4: 词干变体独立搜索 — 覆盖 morphological variants (e.g. "validate" → "valid")
    if (allResults.length < limit) {
      const stemTerms = new Set<string>();
      for (const term of meaningfulTerms) {
        for (const stem of getStemVariants(term)) {
          if (stem.length >= 3 && !meaningfulTerms.includes(stem)) stemTerms.add(stem);
        }
      }
      if (stemTerms.size > 0) {
        const stemQuery = [...stemTerms].join(' ');
        const stemResults = queries.searchCodeFTS(stemQuery, {
          limit: limit,
          kinds: codeKinds,
          languages: options?.languages,
        });
        for (const node of stemResults) {
          if (seenIds.has(node.id)) continue;
          seenIds.add(node.id);
          allResults.push({
            node,
            score: computeScore(node, query) * 0.8,
            matchReason: { kind: 'direct', field: 'name' },
          });
        }
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

  // 统计 — 基于返回的 directMatches，保持数据一致性
  let codeSymbols = 0, domainTerms = 0, specRules = 0, knowhowDocs = 0;
  for (const r of directMatches) {
    switch (r.node.sourceType) {
      case 'codegraph': codeSymbols++; break;
      case 'domain': domainTerms++; break;
      case 'spec': specRules++; break;
      case 'knowhow': knowhowDocs++; break;
    }
  }
  const summary = { codeSymbols, domainTerms, specRules, knowhowDocs, total: directMatches.length };

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
    kinds: options?.kinds,
    languages: options?.languages,
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

// ---------------------------------------------------------------------------
// Hybrid merge — RRF fusion of FTS5 + vector search results for code search
// ---------------------------------------------------------------------------

/**
 * Merge FTS5 search results with vector search results using RRF (Reciprocal Rank Fusion).
 * Imports mergeHybrid from the wiki embedding module and maps between UnifiedSearchResult
 * and RankedResult formats.
 */
export function mergeCodeSearchResults(
  ftsResults: UnifiedSearchResult[],
  vecResults: VectorSearchResult[],
  queries: KgQueryBuilder,
  limit: number,
): UnifiedSearchResult[] {
  // Lazy import mergeHybrid at call site would be async — but mergeHybrid is a pure
  // computation function. We inline the RRF logic here to keep this function synchronous,
  // matching the same algorithm as mergeHybrid in wiki/embedding.ts.
  const RRF_K = 10;
  const BM25_WEIGHT = 0.6;
  const VECTOR_WEIGHT = 0.4;
  const ALPHA = 0.4;

  // Phase 1: RRF score accumulation
  const rrfScores = new Map<string, number>();

  for (let i = 0; i < ftsResults.length; i++) {
    const rrf = BM25_WEIGHT / (RRF_K + i + 1);
    rrfScores.set(ftsResults[i].node.id, (rrfScores.get(ftsResults[i].node.id) ?? 0) + rrf);
  }
  for (let i = 0; i < vecResults.length; i++) {
    const rrf = VECTOR_WEIGHT / (RRF_K + i + 1);
    rrfScores.set(vecResults[i].nodeId, (rrfScores.get(vecResults[i].nodeId) ?? 0) + rrf);
  }

  // Sort by RRF score descending, take top limit*3 for normalization
  const rrfSorted = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 3);

  const maxRrf = rrfSorted.length > 0 ? rrfSorted[0][1] : 1;
  const rrfNorm = new Map(rrfSorted.map(([id, s]) => [id, maxRrf > 0 ? s / maxRrf : 0]));

  // Phase 2: BM25 normalization
  const maxBm25 = ftsResults.length > 0 ? ftsResults[0].score : 1;
  const bm25Norm = new Map(ftsResults.map(r => [r.node.id, maxBm25 > 0 ? r.score / maxBm25 : 0]));

  // Phase 3: Final score = alpha * rrfNorm + (1-alpha) * bm25Norm
  const ftsNodeMap = new Map(ftsResults.map(r => [r.node.id, r]));

  // Collect vector-only nodeIds that need DB lookup
  const vecOnlyIds = rrfSorted
    .map(([id]) => id)
    .filter(id => !ftsNodeMap.has(id));

  // Batch-fetch vector-only nodes from DB
  const vecNodeMap = vecOnlyIds.length > 0
    ? queries.getNodesByIds(vecOnlyIds)
    : new Map<string, import('../db/types.js').UnifiedNode>();

  const merged: UnifiedSearchResult[] = [];
  const seen = new Set<string>();

  for (const [id] of rrfSorted) {
    if (seen.has(id)) continue;
    seen.add(id);

    const rn = rrfNorm.get(id) ?? 0;
    const bn = bm25Norm.get(id) ?? 0;
    const finalScore = ALPHA * rn + (1 - ALPHA) * bn;

    // Look up node: prefer FTS result (already has matchReason), fall back to DB
    const ftsHit = ftsNodeMap.get(id);
    if (ftsHit) {
      merged.push({ node: ftsHit.node, score: finalScore, matchReason: ftsHit.matchReason });
    } else {
      const node = vecNodeMap.get(id);
      if (node) {
        merged.push({ node, score: finalScore, matchReason: { kind: 'vector', field: 'embedding' } });
      }
    }
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}