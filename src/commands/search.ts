/**
 * Search Command — Unified knowledge search across specs, knowhow, issues, and more.
 *
 * Uses WikiIndexer BM25 search with deduplication and type filtering.
 * Replaces per-domain search subcommands with a single top-level entry point.
 */

import type { Command } from 'commander';
import { resolve } from 'node:path';

import { truncate, extractSnippet } from '../utils/cli-format.js';
import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import { searchBM25 } from '#maestro-dashboard/wiki/search.js';
import type { WikiEntry, WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';

// Valid type filter values — matches WikiNodeType.
const VALID_TYPES = ['project', 'roadmap', 'spec', 'issue', 'knowhow', 'note'] as const;

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
 * Unified knowledge search — BM25 ranking via WikiIndexer, with type/category
 * filtering and per-source deduplication. Each result carries its BM25 score
 * and a query-matched snippet.
 *
 * Returns an empty array when the index has no matches (callers handle the
 * empty case gracefully). Async because the indexer reads `.workflow/` files.
 */
export async function runUnifiedSearch(q: string, opts: UnifiedSearchOptions): Promise<SearchResult[]> {
  const limit = opts.limit > 0 ? opts.limit : 20;
  const indexer = getIndexer();

  // BM25 search — fetch extra candidates so dedup + filtering don't shrink
  // the result set below `limit`. Compute scores via the inverted index so
  // each result carries its BM25 relevance score.
  const candidateLimit = Math.max(limit * 3, 60);
  const results = await indexer.search(q, candidateLimit);

  // Map docId -> BM25 score for the same query (scores are otherwise
  // discarded by indexer.search, which returns plain entries).
  const bm25 = await indexer.getSearchIndex();
  const scoreById = new Map<string, number>();
  for (const r of searchBM25(bm25, q, candidateLimit)) {
    scoreById.set(r.docId, r.score);
  }

  // Apply type filter
  let filtered: WikiEntry[] = results;
  if (opts.type) {
    filtered = filtered.filter(r => r.type === opts.type);
  }

  // Apply category filter
  if (opts.category) {
    filtered = filtered.filter(r => r.category === opts.category);
  }

  // Deduplicate: same source path keeps only the first (highest-ranked)
  // entry. Dedup runs BEFORE the limit slice so we never return fewer than
  // `limit` results when duplicates exist.
  const seen = new Map<string, WikiEntry>();
  for (const r of filtered) {
    const sourceKey = r.source?.path || r.id;
    if (!seen.has(sourceKey)) {
      seen.set(sourceKey, r);
    }
  }
  const deduped = [...seen.values()].slice(0, limit);

  return deduped.map(r => ({
    id: r.id,
    type: r.type,
    title: r.title,
    category: r.category,
    summary: r.summary,
    score: scoreById.get(r.id) ?? null,
    snippet: extractSnippet(r.body, q),
    source: r.source,
  }));
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query...>')
    .description('Unified knowledge search across specs, knowhow, issues, and more')
    .option('--type <type>', `Filter by type: ${VALID_TYPES.join(', ')}`)
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, test, review, learning)')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      const limit = parseInt(opts.limit, 10) || 20;

      // Validate --type if provided
      if (opts.type && !VALID_TYPES.includes(opts.type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${opts.type}")`);
        process.exit(1);
      }

      const deduped = await runUnifiedSearch(q, { type: opts.type, category: opts.category, limit });

      if (opts.json) {
        console.log(JSON.stringify({
          query: q,
          count: deduped.length,
          results: deduped,
        }, null, 2));
        return;
      }

      console.log(`Search: "${q}" (${deduped.length} results)`);
      if (deduped.length === 0) {
        console.log('  No matches found.');
        return;
      }
      for (const r of deduped) {
        const typeTag = `[${r.type}]`;
        const catTag = r.category ? ` ${r.category}` : '';
        const scoreTag = r.score !== null ? `  (${r.score.toFixed(2)})` : '';
        console.log(`  ${typeTag}${catTag}  ${r.id}  ${r.title}${scoreTag}`);
        if (r.snippet) {
          console.log(`    ${r.snippet}`);
        } else if (r.summary) {
          console.log(`    ${truncate(r.summary, 80)}`);
        }
      }
    });
}
