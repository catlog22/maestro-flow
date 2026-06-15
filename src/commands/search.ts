/**
 * Search Command — Unified knowledge search across specs, knowhow, issues, and more.
 *
 * Uses WikiIndexer BM25F search with deduplication and type filtering.
 * Optional --code flag adds CodeGraph AST results in a separate section.
 */

import type { Command } from 'commander';
import { resolve } from 'node:path';

import { truncate, extractSnippet, highlightTerms } from '../utils/cli-format.js';
import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry, WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';

// Valid type filter values — matches WikiNodeType.
const VALID_TYPES = ['project', 'roadmap', 'spec', 'issue', 'knowhow', 'note', 'domain'] as const;

/** A single unified search result with BM25 score and snippet. */
export interface SearchResult {
  id: string;
  type: WikiNodeType;
  title: string;
  category: string | null;
  summary: string;
  score: number | null;
  snippet: string | null;
  source: WikiEntry['source'];
}

/** A code search result from CodeGraph. */
export interface CodeSearchResult {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  score: number | null;
  signature?: string;
}

/** Options for runUnifiedSearch — type/category filters and result cap. */
export interface UnifiedSearchOptions {
  type?: string;
  category?: string;
  limit: number;
}

// ── Lazy offline client ────────────────────────────────────────────────

let _indexer: WikiIndexer | null = null;

function getIndexer(): WikiIndexer {
  if (!_indexer) {
    const workflowRoot = resolve('.workflow');
    _indexer = new WikiIndexer({ workflowRoot });
  }
  return _indexer;
}

/**
 * Unified knowledge search — BM25F ranking via WikiIndexer, with type/category
 * filtering and per-source deduplication.
 */
export async function runUnifiedSearch(q: string, opts: UnifiedSearchOptions): Promise<SearchResult[]> {
  const limit = opts.limit > 0 ? opts.limit : 20;
  const indexer = getIndexer();

  const candidateLimit = Math.max(limit * 3, 60);
  const scored = await indexer.searchWithScores(q, candidateLimit);

  let filtered = scored;
  if (opts.type) {
    filtered = filtered.filter(r => r.entry.type === opts.type);
  }
  if (opts.category) {
    filtered = filtered.filter(r => r.entry.category === opts.category);
  }

  const seen = new Map<string, typeof scored[number]>();
  for (const r of filtered) {
    const sourceKey = r.entry.source?.path || r.entry.id;
    if (!seen.has(sourceKey)) {
      seen.set(sourceKey, r);
    }
  }
  const deduped = [...seen.values()].slice(0, limit);

  return deduped.map(({ entry, score }) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    category: entry.category,
    summary: entry.summary,
    score,
    snippet: extractSnippet(entry.body, q),
    source: entry.source,
  }));
}

/**
 * Search MaestroGraph for code nodes matching the query. Gracefully returns
 * empty when MaestroGraph is not initialized.
 */
async function runCodeSearch(q: string, limit: number): Promise<CodeSearchResult[]> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(resolve('.'))) return [];
    const mg = await MaestroGraph.open(resolve('.'));
    try {
      const results = mg.searchCode(q, { limit });
      return results.map((n: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: n.id,
        kind: n.kind,
        name: n.name,
        filePath: n.filePath,
        score: typeof n._bm25Score === 'number' ? n._bm25Score : null,
        signature: n.signature || undefined,
      }));
    } finally {
      mg.close();
    }
  } catch {
    return [];
  }
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query...>')
    .description('Unified knowledge search across specs, knowhow, issues, and more')
    .option('--type <type>', `Filter by type: ${VALID_TYPES.join(', ')}`)
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, test, review, learning)')
    .option('--code', 'Include CodeGraph code results')
    .option('--all', 'Search all sources (wiki + code) with normalized ranking')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      const limit = parseInt(opts.limit, 10) || 20;
      const includeCode = opts.code || opts.all;

      if (opts.type && !VALID_TYPES.includes(opts.type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${opts.type}")`);
        process.exit(1);
      }

      const wikiResults = await runUnifiedSearch(q, { type: opts.type, category: opts.category, limit });
      const codeResults = includeCode ? await runCodeSearch(q, limit) : [];

      // --all: normalize and merge scores for unified ranking
      if (opts.all) {
        const merged = mergeAndNormalize(wikiResults, codeResults, limit);

        if (opts.json) {
          console.log(JSON.stringify({ query: q, count: merged.length, results: merged }, null, 2));
          return;
        }

        console.log(`Search: "${q}" (${merged.length} results, all sources)`);
        if (merged.length === 0) {
          console.log('  No matches found.');
          return;
        }
        const isTTY = process.stdout.isTTY === true;
        const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
        for (const r of merged) {
          const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
          const scoreTag = `  (${r.normalizedScore.toFixed(2)})`;
          console.log(`  [${r.source}] [${r.kind}]  ${name}  ${r.detail}${scoreTag}`);
        }
        return;
      }

      if (opts.json) {
        const output: Record<string, unknown> = { query: q };
        if (includeCode) {
          output.wikiResults = wikiResults;
          output.codeResults = codeResults;
          output.wikiCount = wikiResults.length;
          output.codeCount = codeResults.length;
        } else {
          output.count = wikiResults.length;
          output.results = wikiResults;
        }
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      const isTTY = process.stdout.isTTY === true;
      const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);

      if (includeCode && codeResults.length > 0) {
        console.log(`Search: "${q}" (${wikiResults.length} wiki + ${codeResults.length} code results)`);
      } else {
        console.log(`Search: "${q}" (${wikiResults.length} results)`);
      }

      if (wikiResults.length === 0 && codeResults.length === 0) {
        console.log('  No matches found.');
        return;
      }

      if (wikiResults.length > 0) {
        if (includeCode) console.log('  [Wiki Results]');
        for (const r of wikiResults) {
          const indent = includeCode ? '    ' : '  ';
          const typeTag = `[${r.type}]`;
          const catTag = r.category ? ` ${r.category}` : '';
          const scoreTag = r.score !== null ? `  (${r.score.toFixed(2)})` : '';
          const title = isTTY ? highlightTerms(r.title, qTerms) : r.title;
          console.log(`${indent}${typeTag}${catTag}  ${r.id}  ${title}${scoreTag}`);
          if (r.snippet) {
            const snippet = isTTY ? highlightTerms(r.snippet, qTerms) : r.snippet;
            console.log(`${indent}  ${snippet}`);
          } else if (r.summary) {
            const summary = isTTY ? highlightTerms(truncate(r.summary, 80), qTerms) : truncate(r.summary, 80);
            console.log(`${indent}  ${summary}`);
          }
        }
      }

      if (codeResults.length > 0) {
        console.log('  [Code Results]');
        for (const r of codeResults) {
          const scoreTag = r.score !== null ? `  (${r.score.toFixed(2)})` : '';
          const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
          console.log(`    [${r.kind}] ${name}  ${r.filePath}${scoreTag}`);
        }
      }
    });
}

// ── Score normalization for --all mode ────────────────────────────────

interface MergedResult {
  source: 'wiki' | 'code';
  kind: string;
  name: string;
  detail: string;
  normalizedScore: number;
}

function minMaxNormalize(scores: number[]): Map<number, number> {
  const norm = new Map<number, number>();
  if (scores.length === 0) return norm;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  for (const s of scores) norm.set(s, (s - min) / range);
  return norm;
}

function mergeAndNormalize(wiki: SearchResult[], code: CodeSearchResult[], limit: number): MergedResult[] {
  const WIKI_WEIGHT = 0.6;
  const CODE_WEIGHT = 0.4;

  const wikiScores = wiki.map(r => r.score ?? 0);
  const codeScores = code.map(r => r.score ?? 0);
  const wikiNorm = minMaxNormalize(wikiScores);
  const codeNorm = minMaxNormalize(codeScores);

  const merged: MergedResult[] = [];
  for (const r of wiki) {
    const raw = r.score ?? 0;
    merged.push({
      source: 'wiki',
      kind: r.type,
      name: r.title,
      detail: r.category ? `${r.category}  ${r.id}` : r.id,
      normalizedScore: (wikiNorm.get(raw) ?? 0) * WIKI_WEIGHT,
    });
  }
  for (const r of code) {
    const raw = r.score ?? 0;
    merged.push({
      source: 'code',
      kind: r.kind,
      name: r.name,
      detail: r.filePath,
      normalizedScore: (codeNorm.get(raw) ?? 0) * CODE_WEIGHT,
    });
  }

  merged.sort((a, b) => b.normalizedScore - a.normalizedScore);
  return merged.slice(0, limit);
}
