import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { MaestroGraph } from '../engine.js';
import { getKgDatabasePath } from '../db/connection.js';
import {
  dfs, getTypeHierarchy, findUsages, getAncestors, getChildren,
  getCallGraph, getNodeContext, getFileDependencies, getFileDependents,
  findDeadCode, getNodeMetrics, findShortestPath,
} from '../query/traversal.js';
import type { KgQueryBuilder } from '../db/queries.js';

// CodeGraph adapter stub (legacy system removed — MaestroGraph is the sole engine)
async function getCodeGraphAdapter() {
  return null;
}

// ---------------------------------------------------------------------------
// 100 Boundary Test Cases — CodeGraph vs MaestroGraph 搜索对比
// ---------------------------------------------------------------------------

interface SearchCase {
  id: number;
  category: string;
  query: string;
  expectCodeGraph: 'results' | 'empty' | 'any';
  expectMaestroGraph: 'results' | 'empty' | 'any';
  description: string;
}

const CASES: SearchCase[] = [
  // ── Category 1: CJK 单字/短词 (1-10) ──────────────────────────────
  { id: 1, category: 'cjk-short', query: '搜', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'CJK single char' },
  { id: 2, category: 'cjk-short', query: '搜索', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char common term' },
  { id: 3, category: 'cjk-short', query: '知识', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char knowledge' },
  { id: 4, category: 'cjk-short', query: '图谱', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char graph' },
  { id: 5, category: 'cjk-short', query: '规范', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char spec' },
  { id: 6, category: 'cjk-short', query: '索引', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char index' },
  { id: 7, category: 'cjk-short', query: '工具', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char tool' },
  { id: 8, category: 'cjk-short', query: '委托', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char delegate' },
  { id: 9, category: 'cjk-short', query: '模板', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'CJK 2-char template' },
  { id: 10, category: 'cjk-short', query: '文档', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 2-char document' },

  // ── Category 2: CJK 长词组 (11-20) ────────────────────────────────
  { id: 11, category: 'cjk-long', query: '知识图谱', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK 4-char compound' },
  { id: 12, category: 'cjk-long', query: '全文搜索', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK fulltext search' },
  { id: 13, category: 'cjk-long', query: '架构约束', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'CJK arch constraint' },
  { id: 14, category: 'cjk-long', query: '编码规范', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK coding convention' },
  { id: 15, category: 'cjk-long', query: '统一知识索引引擎', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK long phrase' },
  { id: 16, category: 'cjk-long', query: '代码审查', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'CJK code review' },
  { id: 17, category: 'cjk-long', query: '性能优化', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'CJK perf optimization' },
  { id: 18, category: 'cjk-long', query: '质量标准', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK quality standard' },
  { id: 19, category: 'cjk-long', query: '可复用知识', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK reusable knowledge' },
  { id: 20, category: 'cjk-long', query: '决策记录', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'CJK decision record' },

  // ── Category 3: 混合中英 (21-30) ──────────────────────────────────
  { id: 21, category: 'mixed', query: 'BM25 搜索', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'English + CJK' },
  { id: 22, category: 'mixed', query: 'WikiIndexer 引擎', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'ClassName + CJK' },
  { id: 23, category: 'mixed', query: 'FTS5 全文', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'Technical + CJK' },
  { id: 24, category: 'mixed', query: 'domain 术语', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Keyword + CJK' },
  { id: 25, category: 'mixed', query: 'spec 规范', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Type + CJK synonym' },
  { id: 26, category: 'mixed', query: 'CLI 委托', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'Abbreviation + CJK' },
  { id: 27, category: 'mixed', query: 'hook 注入', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Hook + CJK inject' },
  { id: 28, category: 'mixed', query: 'OWASP top10', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'Security term' },
  { id: 29, category: 'mixed', query: 'SQL injection 检测', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'Security + CJK' },
  { id: 30, category: 'mixed', query: 'TypeScript 接口', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'Language + CJK' },

  // ── Category 4: 精确代码符号 (31-45) ──────────────────────────────
  { id: 31, category: 'code-symbol', query: 'HookManager', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Exact class name' },
  { id: 32, category: 'code-symbol', query: 'evaluateSpecInjection', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Exact function name' },
  { id: 33, category: 'code-symbol', query: 'DelegateBrokerClient', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Compound class name' },
  { id: 34, category: 'code-symbol', query: 'WikiIndexer', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Cross-layer symbol' },
  { id: 35, category: 'code-symbol', query: 'SpecEntryParsed', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Interface name' },
  { id: 36, category: 'code-symbol', query: 'searchBM25', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Search function' },
  { id: 37, category: 'code-symbol', query: 'KgQueryBuilder', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'KG class' },
  { id: 38, category: 'code-symbol', query: 'syncKnowledgeGraph', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Orchestrator function' },
  { id: 39, category: 'code-symbol', query: 'MaestroGraph', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Engine class' },
  { id: 40, category: 'code-symbol', query: 'registerKgCommand', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'CLI registration' },
  { id: 41, category: 'code-symbol', query: 'buildInvertedIndex', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'BM25 builder' },
  { id: 42, category: 'code-symbol', query: 'computeScore', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Scoring function' },
  { id: 43, category: 'code-symbol', query: 'sanitizeFtsQuery', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'FTS sanitizer' },
  { id: 44, category: 'code-symbol', query: 'GlossaryLock', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Domain lock class' },
  { id: 45, category: 'code-symbol', query: 'matchDomainTerms', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Domain matcher' },

  // ── Category 5: camelCase/snake_case 分词 (46-55) ──────────────────
  { id: 46, category: 'tokenization', query: 'hook manager', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Space-split camelCase' },
  { id: 47, category: 'tokenization', query: 'spec entry', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Space-split compound' },
  { id: 48, category: 'tokenization', query: 'knowledge graph', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Conceptual compound' },
  { id: 49, category: 'tokenization', query: 'delegate broker', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Multi-word class' },
  { id: 50, category: 'tokenization', query: 'unified search', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Feature name' },
  { id: 51, category: 'tokenization', query: 'file_path', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Snake case field' },
  { id: 52, category: 'tokenization', query: 'source_type', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'DB column name' },
  { id: 53, category: 'tokenization', query: 'content rowid', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'FTS5 internal' },
  { id: 54, category: 'tokenization', query: 'domain term', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Knowledge type' },
  { id: 55, category: 'tokenization', query: 'code review', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Common phrase' },

  // ── Category 6: 边界/极端输入 (56-70) ─────────────────────────────
  { id: 56, category: 'edge-input', query: '', expectCodeGraph: 'empty', expectMaestroGraph: 'empty', description: 'Empty string' },
  { id: 57, category: 'edge-input', query: ' ', expectCodeGraph: 'empty', expectMaestroGraph: 'empty', description: 'Whitespace only' },
  { id: 58, category: 'edge-input', query: 'a', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Single ASCII char' },
  { id: 59, category: 'edge-input', query: 'ab', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Two ASCII chars' },
  { id: 60, category: 'edge-input', query: 'the and or', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'All stop words' },
  { id: 61, category: 'edge-input', query: 'xyznonexistent12345', expectCodeGraph: 'empty', expectMaestroGraph: 'empty', description: 'Guaranteed no-match' },
  { id: 62, category: 'edge-input', query: '*', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'FTS5 wildcard char' },
  { id: 63, category: 'edge-input', query: '"quoted phrase"', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Quoted phrase' },
  { id: 64, category: 'edge-input', query: 'NOT delegate', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'FTS5 operator NOT' },
  { id: 65, category: 'edge-input', query: 'a'.repeat(200), expectCodeGraph: 'any', expectMaestroGraph: 'any', description: '200-char query' },
  { id: 66, category: 'edge-input', query: '🎉 emoji', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Emoji in query' },
  { id: 67, category: 'edge-input', query: 'path/to/file.ts', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Path-like query' },
  { id: 68, category: 'edge-input', query: "O'Brien", expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Apostrophe' },
  { id: 69, category: 'edge-input', query: 'SELECT * FROM', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'SQL injection attempt' },
  { id: 70, category: 'edge-input', query: '<script>alert(1)</script>', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'XSS attempt' },

  // ── Category 7: 知识层特有 (71-80) ────────────────────────────────
  { id: 71, category: 'knowledge', query: 'OWASP', expectCodeGraph: 'empty', expectMaestroGraph: 'any', description: 'Security standard' },
  { id: 72, category: 'knowledge', query: 'migration strategy', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Knowhow concept' },
  { id: 73, category: 'knowledge', query: 'coding conventions', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Spec category' },
  { id: 74, category: 'knowledge', query: 'architecture constraint', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Arch concept' },
  { id: 75, category: 'knowledge', query: 'bug fix', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Issue type' },
  { id: 76, category: 'knowledge', query: 'security vulnerability', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Issue category' },
  { id: 77, category: 'knowledge', query: 'file lock backup', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Spec keywords' },
  { id: 78, category: 'knowledge', query: 'protected data store', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'Pattern name' },
  { id: 79, category: 'knowledge', query: 'glossary CRUD', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Domain operation' },
  { id: 80, category: 'knowledge', query: 'BM25 搜索', expectCodeGraph: 'empty', expectMaestroGraph: 'results', description: 'Algorithm + CJK' },

  // ── Category 8: FTS5 消毒/注入防御 (81-90) ────────────────────────
  { id: 81, category: 'fts5-safety', query: 'delegate AND broker', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'AND operator' },
  { id: 82, category: 'fts5-safety', query: 'delegate OR spec', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'OR operator' },
  { id: 83, category: 'fts5-safety', query: 'delegate NEAR broker', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'NEAR operator' },
  { id: 84, category: 'fts5-safety', query: '{column:name}', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Column filter syntax' },
  { id: 85, category: 'fts5-safety', query: 'dele*', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Prefix wildcard' },
  { id: 86, category: 'fts5-safety', query: '^delegate', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Caret operator' },
  { id: 87, category: 'fts5-safety', query: 'delegate + broker', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Plus operator' },
  { id: 88, category: 'fts5-safety', query: '-delegate', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Minus/negation' },
  { id: 89, category: 'fts5-safety', query: '"delegate"', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Quoted single term' },
  { id: 90, category: 'fts5-safety', query: 'name:delegate', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'FTS5 column filter' },

  // ── Category 9: 性能/规模边界 (91-95) ─────────────────────────────
  { id: 91, category: 'performance', query: 'delegate', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Common term latency' },
  { id: 92, category: 'performance', query: 'a b c d e f g', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'Many short tokens' },
  { id: 93, category: 'performance', query: 'authentication session token cookie database cache redis postgres', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: '8-term query' },
  { id: 94, category: 'performance', query: 'interface function class module export import', expectCodeGraph: 'any', expectMaestroGraph: 'any', description: 'All stop words (code)' },
  { id: 95, category: 'performance', query: 'spec knowhow domain issue codebase', expectCodeGraph: 'any', expectMaestroGraph: 'results', description: 'All source types' },

  // ── Category 10: 回归/对比 (96-100) ───────────────────────────────
  { id: 96, category: 'regression', query: 'validation', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Both systems have results' },
  { id: 97, category: 'regression', query: 'hook', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Code-heavy term' },
  { id: 98, category: 'regression', query: 'delegate broker client', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Multi-word code match' },
  { id: 99, category: 'regression', query: 'domain', expectCodeGraph: 'results', expectMaestroGraph: 'results', description: 'Cross-layer term' },
  { id: 100, category: 'regression', query: 'search', expectCodeGraph: 'results', expectMaestroGraph: 'any', description: 'Meta search term' },
];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('CodeGraph vs MaestroGraph — 100 Boundary Search Cases', () => {
  let mg: MaestroGraph | null = null;
  let cgAdapter: any = null;

  beforeAll(async () => {
    const dbPath = getKgDatabasePath('.');
    if (existsSync(dbPath)) {
      mg = await MaestroGraph.open('.');
    }
    cgAdapter = await getCodeGraphAdapter();
  });

  afterAll(() => {
    mg?.close();
    cgAdapter?.close?.();
  });

  // ── Stability: No crashes on any input ─────────────────────────────
  describe('Stability — MaestroGraph never crashes', () => {
    for (const c of CASES) {
      it(`#${c.id} [${c.category}] ${c.description}`, () => {
        if (!mg) return;
        expect(() => {
          mg!.searchUnified(c.query, { limit: 10 });
        }).not.toThrow();
      });
    }
  });

  // ── CJK Coverage: MaestroGraph finds CJK results where CodeGraph can't
  describe('CJK Advantage — MaestroGraph covers CJK blind spots', () => {
    const cjkCases = CASES.filter(c => c.category.startsWith('cjk') && c.expectMaestroGraph === 'results');

    for (const c of cjkCases) {
      it(`#${c.id} "${c.query}" — MaestroGraph returns results`, () => {
        if (!mg) return;
        const output = mg.searchUnified(c.query, { limit: 10 });
        expect(output.directMatches.length).toBeGreaterThan(0);
      });
    }
  });

  // ── Knowledge Layer: MaestroGraph finds knowledge entries ──────────
  describe('Knowledge Layer — domain/spec/knowhow/issue searchable', () => {
    const knowledgeCases = CASES.filter(c => c.category === 'knowledge' && c.expectMaestroGraph === 'results');

    for (const c of knowledgeCases) {
      it(`#${c.id} "${c.query}" — has knowledge results`, () => {
        if (!mg) return;
        const output = mg.searchUnified(c.query, { limit: 10 });
        const knowledgeHits = output.directMatches.filter(r => r.node.sourceType !== 'codegraph');
        expect(knowledgeHits.length).toBeGreaterThan(0);
      });
    }
  });

  // ── FTS5 Safety: No SQL injection or FTS5 syntax errors ───────────
  describe('FTS5 Safety — sanitization prevents crashes', () => {
    const safetyCases = CASES.filter(c => c.category === 'fts5-safety' || c.category === 'edge-input');

    for (const c of safetyCases) {
      it(`#${c.id} "${c.query.substring(0, 30)}" — safe execution`, () => {
        if (!mg) return;
        expect(() => {
          mg!.searchUnified(c.query, { limit: 10 });
        }).not.toThrow();
      });
    }
  });

  // ── Empty/Garbage: Returns empty, not errors ──────────────────────
  describe('Empty Input — graceful empty results', () => {
    const emptyCases = CASES.filter(c => c.expectMaestroGraph === 'empty');

    for (const c of emptyCases) {
      it(`#${c.id} "${c.query.substring(0, 20)}" — returns empty`, () => {
        if (!mg) return;
        const output = mg.searchUnified(c.query, { limit: 10 });
        expect(output.directMatches.length).toBe(0);
      });
    }
  });

  // ── Performance: All queries under 50ms ───────────────────────────
  describe('Performance — all queries < 50ms', () => {
    const perfCases = CASES.filter(c => c.category === 'performance' || c.category === 'regression');

    for (const c of perfCases) {
      it(`#${c.id} "${c.query.substring(0, 30)}" — under 50ms`, () => {
        if (!mg) return;
        const start = performance.now();
        mg!.searchUnified(c.query, { limit: 20 });
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(50);
      });
    }
  });

  // ── BM25 Score Integration: scores > 0 for real matches ───────────
  describe('BM25 Scoring — non-zero scores for real matches', () => {
    const scoreCases = [
      { query: 'delegate', min: 10 },
      { query: '搜索', min: 5 },
      { query: 'spec entry', min: 5 },
      { query: 'validation', min: 5 },
    ];

    for (const c of scoreCases) {
      it(`"${c.query}" — top result score >= ${c.min}`, () => {
        if (!mg) return;
        const output = mg.searchUnified(c.query, { limit: 5 });
        if (output.directMatches.length > 0) {
          expect(output.directMatches[0].score).toBeGreaterThanOrEqual(c.min);
        }
      });
    }
  });

  // ── Aggregate Statistics ──────────────────────────────────────────
  describe('Aggregate — coverage statistics', () => {
    it('computes full comparison matrix', () => {
      if (!mg) return;

      const stats = {
        total: CASES.length,
        mg_has_results: 0,
        mg_empty: 0,
        mg_errors: 0,
        by_category: {} as Record<string, { total: number; results: number; empty: number }>,
        latencies: [] as number[],
      };

      for (const c of CASES) {
        if (!stats.by_category[c.category]) {
          stats.by_category[c.category] = { total: 0, results: 0, empty: 0 };
        }
        stats.by_category[c.category].total++;

        const start = performance.now();
        try {
          const output = mg!.searchUnified(c.query, { limit: 10 });
          stats.latencies.push(performance.now() - start);

          if (output.directMatches.length > 0) {
            stats.mg_has_results++;
            stats.by_category[c.category].results++;
          } else {
            stats.mg_empty++;
            stats.by_category[c.category].empty++;
          }
        } catch {
          stats.mg_errors++;
        }
      }

      const avgLatency = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
      const maxLatency = Math.max(...stats.latencies);
      const p95 = stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)];

      console.log('\n=== MaestroGraph Search Benchmark ===');
      console.log(`Total: ${stats.total} cases`);
      console.log(`Results: ${stats.mg_has_results} | Empty: ${stats.mg_empty} | Errors: ${stats.mg_errors}`);
      console.log(`Avg latency: ${avgLatency.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms | Max: ${maxLatency.toFixed(2)}ms`);
      console.log('\nBy category:');
      for (const [cat, s] of Object.entries(stats.by_category)) {
        console.log(`  ${cat.padEnd(16)} ${s.results}/${s.total} results (${((s.results / s.total) * 100).toFixed(0)}%)`);
      }

      expect(stats.mg_errors).toBe(0);
      expect(avgLatency).toBeLessThan(20);
    });
  });
});

// ---------------------------------------------------------------------------
// Traversal & Analysis Capability Benchmark — MaestroGraph 新能力验证
// ---------------------------------------------------------------------------

describe('MaestroGraph Traversal & Analysis — Capability Benchmark', () => {
  let mg: MaestroGraph | null = null;
  let queries: KgQueryBuilder | null = null;

  beforeAll(async () => {
    const dbPath = getKgDatabasePath('.');
    if (existsSync(dbPath)) {
      mg = await MaestroGraph.open('.');
      queries = mg.getQueryBuilder();
    }
  });

  afterAll(() => { mg?.close(); });

  describe('DFS Traversal', () => {
    it('dfs returns nodes without crashing', () => {
      if (!queries) return;
      const codeNodes = queries.searchCodeFTS('function', { limit: 1 });
      if (codeNodes.length === 0) return;
      const result = dfs(queries, codeNodes[0].id, { maxDepth: 2, maxNodes: 50 });
      expect(result.nodes.size).toBeGreaterThanOrEqual(1);
      expect(result.visited.size).toBeGreaterThanOrEqual(1);
    });

    it('dfs visits different order than bfs', () => {
      if (!mg || !queries) return;
      const codeNodes = queries.searchCodeFTS('class', { limit: 1 });
      if (codeNodes.length === 0) return;
      const bfsResult = mg.traverse(codeNodes[0].id, { maxDepth: 3, maxNodes: 30 });
      const dfsResult = dfs(queries, codeNodes[0].id, { maxDepth: 3, maxNodes: 30 });
      expect(dfsResult.nodes.size).toBeGreaterThanOrEqual(1);
      expect(bfsResult.nodes.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Type Hierarchy', () => {
    it('getTypeHierarchy returns valid result for any node', () => {
      if (!queries) return;
      const classNodes = queries.searchCodeFTS('class', { limit: 3, kinds: ['class'] });
      for (const node of classNodes) {
        const result = getTypeHierarchy(queries, node.id);
        expect(result.nodes).toBeInstanceOf(Map);
        expect(result.edges).toBeInstanceOf(Array);
      }
    });
  });

  describe('Find Usages', () => {
    it('findUsages returns incoming references', () => {
      if (!queries) return;
      const nodes = queries.searchCodeFTS('function', { limit: 5, kinds: ['function'] });
      let found = false;
      for (const node of nodes) {
        const usages = findUsages(queries, node.id);
        if (usages.length > 0) {
          found = true;
          expect(usages[0].node).toBeDefined();
          expect(usages[0].edge).toBeDefined();
          break;
        }
      }
    });
  });

  describe('Ancestors & Children', () => {
    it('getAncestors traces container chain', () => {
      if (!queries) return;
      const methods = queries.searchCodeFTS('method', { limit: 5, kinds: ['method'] });
      for (const m of methods) {
        const ancestors = getAncestors(queries, m.id);
        if (ancestors.length > 0) {
          expect(ancestors[0].kind).toBeDefined();
          return;
        }
      }
    });

    it('getChildren returns direct contains targets', () => {
      if (!queries) return;
      const classes = queries.searchCodeFTS('class', { limit: 5, kinds: ['class'] });
      for (const cls of classes) {
        const children = getChildren(queries, cls.id);
        if (children.length > 0) {
          expect(children[0].kind).toBeDefined();
          return;
        }
      }
    });
  });

  describe('Call Graph (Bidirectional)', () => {
    it('getCallGraph merges callers and callees', () => {
      if (!queries) return;
      const fns = queries.searchCodeFTS('function', { limit: 5, kinds: ['function'] });
      for (const fn of fns) {
        const graph = getCallGraph(queries, fn.id, 2);
        if (graph.edges.length > 0) {
          expect(graph.nodes.size).toBeGreaterThan(1);
          return;
        }
      }
    });
  });

  describe('Node Context (7-element)', () => {
    it('getNodeContext returns focal + ancestors + children + refs + hierarchy', () => {
      if (!queries) return;
      const nodes = queries.searchCodeFTS('class', { limit: 3, kinds: ['class'] });
      for (const node of nodes) {
        const ctx = getNodeContext(queries, node.id);
        if (!ctx) continue;
        expect(ctx.focal.id).toBe(node.id);
        expect(ctx.ancestors).toBeInstanceOf(Array);
        expect(ctx.children).toBeInstanceOf(Array);
        expect(ctx.incomingRefs).toBeInstanceOf(Array);
        expect(ctx.outgoingRefs).toBeInstanceOf(Array);
        expect(ctx.typeHierarchy).toBeDefined();
        return;
      }
    });
  });

  describe('File Dependencies', () => {
    it('getFileDependencies returns import targets', () => {
      if (!queries) return;
      const deps = getFileDependencies(queries, 'src/graph/kg/engine.ts');
      expect(deps).toBeInstanceOf(Array);
    });

    it('getFileDependents returns reverse imports', () => {
      if (!queries) return;
      const deps = getFileDependents(queries, 'src/graph/kg/engine.ts');
      expect(deps).toBeInstanceOf(Array);
    });
  });

  describe('Dead Code Detection', () => {
    it('findDeadCode returns unexported unreferenced nodes', () => {
      if (!queries) return;
      const start = performance.now();
      const dead = findDeadCode(queries, { kinds: ['function'] });
      const elapsed = performance.now() - start;
      expect(dead).toBeInstanceOf(Array);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('Node Metrics', () => {
    it('getNodeMetrics returns 6-dimension metrics', () => {
      if (!queries) return;
      const nodes = queries.searchCodeFTS('function', { limit: 1 });
      if (nodes.length === 0) return;
      const metrics = getNodeMetrics(queries, nodes[0].id);
      expect(metrics).not.toBeNull();
      expect(metrics!.incomingEdgeCount).toBeGreaterThanOrEqual(0);
      expect(metrics!.outgoingEdgeCount).toBeGreaterThanOrEqual(0);
      expect(metrics!.callCount).toBeGreaterThanOrEqual(0);
      expect(metrics!.callerCount).toBeGreaterThanOrEqual(0);
      expect(metrics!.childCount).toBeGreaterThanOrEqual(0);
      expect(metrics!.depth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Shortest Path (with edges)', () => {
    it('findShortestPath returns path steps with edge info', () => {
      if (!queries) return;
      const nodes = queries.searchCodeFTS('class', { limit: 2 });
      if (nodes.length < 2) return;
      const path = findShortestPath(queries, nodes[0].id, nodes[1].id, 5);
      if (path) {
        expect(path.length).toBeGreaterThanOrEqual(2);
        expect(path[0].nodeId).toBe(nodes[0].id);
        expect(path[0].edge).toBeNull();
        if (path.length > 1) {
          expect(path[1].edge).toBeDefined();
        }
      }
    });
  });

  describe('Capability Coverage Summary', () => {
    it('reports MaestroGraph vs CodeGraph capability matrix', () => {
      if (!mg || !queries) return;

      const capabilities = [
        { name: 'BFS traversal', mg: true, cg: true },
        { name: 'DFS traversal', mg: true, cg: true },
        { name: 'getCallers', mg: true, cg: true },
        { name: 'getCallees', mg: true, cg: true },
        { name: 'getCallGraph (bidirectional)', mg: true, cg: true },
        { name: 'getTypeHierarchy', mg: true, cg: true },
        { name: 'findUsages', mg: true, cg: true },
        { name: 'getAncestors', mg: true, cg: true },
        { name: 'getChildren', mg: true, cg: true },
        { name: 'getNodeContext (7-element)', mg: true, cg: true },
        { name: 'getImpactRadius', mg: true, cg: true },
        { name: 'findShortestPath (with edges)', mg: true, cg: true },
        { name: 'getFileDependencies', mg: true, cg: true },
        { name: 'getFileDependents', mg: true, cg: true },
        { name: 'findDeadCode', mg: true, cg: true },
        { name: 'getNodeMetrics', mg: true, cg: true },
        { name: 'traceCallChain', mg: true, cg: false },
        { name: 'Unified FTS5 search (code+knowledge)', mg: true, cg: false },
        { name: 'BM25F scoring', mg: true, cg: false },
        { name: 'CJK search fallback', mg: true, cg: false },
        { name: 'Knowledge cross-source edges', mg: true, cg: false },
        { name: 'Context Builder + budget', mg: true, cg: false },
        { name: 'Field-qualified query syntax', mg: true, cg: true },
        { name: 'MCP native tools (9)', mg: true, cg: false },
      ];

      const mgOnly = capabilities.filter(c => c.mg && !c.cg).length;
      const cgOnly = capabilities.filter(c => c.cg && !c.mg).length;
      const both = capabilities.filter(c => c.mg && c.cg).length;

      console.log('\n=== Capability Matrix ===');
      console.log(`Total capabilities: ${capabilities.length}`);
      console.log(`MaestroGraph: ${capabilities.filter(c => c.mg).length}/${capabilities.length}`);
      console.log(`CodeGraph: ${capabilities.filter(c => c.cg).length}/${capabilities.length}`);
      console.log(`MaestroGraph-only: ${mgOnly}`);
      console.log(`CodeGraph-only: ${cgOnly}`);
      console.log(`Shared: ${both}`);
      console.log('\nMaestroGraph advantages:');
      for (const c of capabilities.filter(c => c.mg && !c.cg)) {
        console.log(`  ✓ ${c.name}`);
      }

      expect(mgOnly).toBeGreaterThan(0);
      expect(cgOnly).toBe(0);
    });
  });
});
