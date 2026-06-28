// src/graph/kg/query/scoring.ts — 搜索评分系统
// 参考: plan-maestrograph.md Gap 修补 6 + codegraph/src/search/query-utils.ts

import type { UnifiedNodeKind } from '../db/types.js';

// ---------------------------------------------------------------------------
// 1. 停用词过滤 (78 个英语词 + 代码噪声词)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  // 英语停用词
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who', 'boy',
  'did', 'let', 'put', 'say', 'she', 'too', 'use',
  // 代码噪声词
  'function', 'class', 'import', 'export', 'const', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'true', 'false', 'null', 'undefined', 'string', 'number', 'boolean',
  'void', 'any', 'never', 'unknown', 'type', 'interface',
]);

export function removeStopWords(tokens: string[]): string[] {
  return tokens.filter(t => !STOP_WORDS.has(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// 2. 词干变体生成 (简化版)
// ---------------------------------------------------------------------------

export function getStemVariants(term: string): string[] {
  const variants = new Set<string>();
  const lower = term.toLowerCase();
  variants.add(lower);

  // 去除常见后缀
  const suffixes: Array<[RegExp, string]> = [
    [/ies$/, 'y'], [/tion$/, ''], [/sion$/, ''], [/ment$/, ''],
    [/ness$/, ''], [/ing$/, ''], [/ed$/, ''], [/er$/, ''], [/es$/, ''], [/s$/, ''],
  ];
  for (const [pattern, replacement] of suffixes) {
    if (pattern.test(lower)) {
      variants.add(lower.replace(pattern, replacement));
    }
  }

  return [...variants];
}

// ---------------------------------------------------------------------------
// 3. 驼峰/蛇形分词
// ---------------------------------------------------------------------------

export function extractSearchTerms(query: string): string[] {
  const terms: string[] = [];

  for (const part of query.split(/[_.\s\-/]+/)) {
    if (!part) continue;

    // CamelCase / PascalCase 分词
    const camelParts = part.replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    for (const cp of camelParts.split('_')) {
      const lower = cp.toLowerCase();
      if (lower.length > 0) terms.push(lower);
    }

    // 保留原始复合标识符
    if (part.length > 2) terms.push(part.toLowerCase());
  }

  return [...new Set(terms)];
}

// ---------------------------------------------------------------------------
// 4. 代码查询扩展 (缩写 ↔ 全称同义词)
// ---------------------------------------------------------------------------

const CODE_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['auth', ['authentication', 'authorization']],
  ['authentication', ['auth']],
  ['authorization', ['auth']],
  ['db', ['database']],
  ['database', ['db']],
  ['config', ['configuration', 'settings']],
  ['configuration', ['config']],
  ['settings', ['config', 'options']],
  ['btn', ['button']],
  ['button', ['btn']],
  ['msg', ['message']],
  ['message', ['msg']],
  ['req', ['request']],
  ['request', ['req']],
  ['res', ['response']],
  ['response', ['res']],
  ['err', ['error', 'exception']],
  ['error', ['err', 'exception']],
  ['exception', ['err', 'error']],
  ['fn', ['function']],
  ['cb', ['callback']],
  ['callback', ['cb']],
  ['ctx', ['context']],
  ['context', ['ctx']],
  ['env', ['environment']],
  ['environment', ['env']],
  ['param', ['parameter', 'arg', 'argument']],
  ['parameter', ['param']],
  ['arg', ['argument', 'param']],
  ['argument', ['arg', 'param']],
  ['init', ['initialize', 'initialization', 'setup']],
  ['initialize', ['init']],
  ['setup', ['init', 'configure']],
  ['util', ['utility', 'helper']],
  ['utility', ['util', 'helper']],
  ['helper', ['util', 'utility']],
  ['repo', ['repository']],
  ['repository', ['repo']],
  ['info', ['information']],
  ['information', ['info']],
  ['mgr', ['manager']],
  ['manager', ['mgr']],
  ['svc', ['service']],
  ['service', ['svc']],
  ['cmd', ['command']],
  ['command', ['cmd']],
  ['nav', ['navigation']],
  ['navigation', ['nav']],
  ['idx', ['index']],
  ['val', ['validate', 'validation']],
  ['validate', ['val', 'validation']],
  ['validation', ['val', 'validate']],
  ['sync', ['synchronize']],
  ['synchronize', ['sync']],
  ['async', ['asynchronous']],
  ['middleware', ['mw']],
  ['mw', ['middleware']],
]);

/**
 * 代码查询扩展 — 基于 extractSearchTerms 分词 + 缩写同义词 + 词干变体
 * 返回包含原始 term、同义词和词干变体的扩展查询字符串
 */
export function expandCodeQuery(query: string): string {
  const terms = extractSearchTerms(query);
  const expanded = new Set(terms);

  for (const term of terms) {
    const lower = term.toLowerCase();
    const synonyms = CODE_SYNONYMS.get(lower);
    if (synonyms) {
      for (const syn of synonyms) expanded.add(syn);
    }
    const stems = getStemVariants(lower);
    for (const stem of stems) {
      if (stem.length >= 3) expanded.add(stem);
    }
  }

  return [...expanded].join(' ');
}

// ---------------------------------------------------------------------------
// 5. 多信号评分
// ---------------------------------------------------------------------------

export function kindBonus(kind: UnifiedNodeKind): number {
  switch (kind) {
    case 'function': case 'method': return 10;
    case 'interface': case 'trait': case 'protocol': case 'route': return 9;
    case 'class': case 'component': return 8;
    case 'type_alias': case 'struct': return 6;
    case 'enum': case 'constant': return 5;
    case 'variable': case 'field': case 'property': return 4;
    // 知识节点 — 在独立 FTS5 中不与代码竞争
    case 'domain_term': return 12;
    case 'spec_entry': return 8;
    case 'knowhow_entry': return 6;
    case 'decision': case 'requirement': return 7;
    case 'issue': return 5;
    default: return 0;
  }
}

export function scorePathRelevance(filePath: string, query: string): number {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const queryLower = query.toLowerCase();
  const queryTokens = extractSearchTerms(query);

  let score = 0;

  // 文件名匹配: +10
  const fileName = normalized.split('/').pop() ?? '';
  if (fileName.includes(queryLower)) score += 10;

  // 目录匹配: +5
  const parts = normalized.split('/');
  for (const part of parts) {
    if (queryTokens.some(t => part.includes(t))) score += 5;
  }

  // 路径匹配: +3
  if (normalized.includes(queryLower)) score += 3;

  // 测试文件: -15 (降权)
  if (isTestPath(normalized)) score -= 15;

  return score;
}

function isTestPath(path: string): boolean {
  return (
    /\.test\.[jt]sx?$/.test(path) ||
    /\.spec\.[jt]sx?$/.test(path) ||
    /\b__tests__\//.test(path) ||
    /\btests?\//.test(path)
  );
}

export function nameMatchBonus(name: string, query: string): number {
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();
  const queryTokens = extractSearchTerms(query);
  const nameTokens = extractSearchTerms(name);

  // 精确匹配: +80
  if (nameLower === queryLower) return 80;

  // 令牌精确: +60
  if (nameTokens.some(nt => queryTokens.includes(nt))) return 60;

  // 前缀匹配: +10~40 (按长度比例)
  if (nameLower.startsWith(queryLower)) {
    return Math.floor(10 + 30 * (queryLower.length / nameLower.length));
  }

  // 全分词包含: +15
  if (queryTokens.every(qt => nameTokens.some(nt => nt.includes(qt)))) return 15;

  // 子串匹配: +10
  if (nameLower.includes(queryLower)) return 10;

  return 0;
}

// ---------------------------------------------------------------------------
// 6. 综合评分
// ---------------------------------------------------------------------------

export interface ScoredResult {
  id: string;
  score: number;
}

export function computeScore(
  node: { id: string; kind: UnifiedNodeKind; name: string; filePath: string; _bm25Score?: number },
  query: string,
  credibilityFactor?: number,
): number {
  let score = 0;

  const bm25 = node._bm25Score;
  if (typeof bm25 === 'number' && bm25 > 0) {
    score += Math.min(bm25 * 2, 30);
  }

  score += kindBonus(node.kind);
  score += scorePathRelevance(node.filePath, query);
  score += nameMatchBonus(node.name, query);

  if (typeof credibilityFactor === 'number') {
    score *= credibilityFactor;
  }

  return score;
}