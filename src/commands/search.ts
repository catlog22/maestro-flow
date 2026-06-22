/**
 * Search Command — Unified knowledge search across wiki + code.
 *
 * Default: mixed results (wiki + code interleaved by normalized score).
 * --code: separate section display (backward compat).
 * --wiki-only: wiki results only (no code search).
 *
 * Scoring: multi-signal normalization inspired by codebase-memory-mcp.
 *   Wiki:  BM25F score + type boost (spec > knowhow > note)
 *   Code:  BM25 score + kind boost + name-match bonus
 *   Merge: percentile-aware normalization + source weight
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';

import { truncate, extractSnippet, highlightTerms } from '../utils/cli-format.js';
import { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry, WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';

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
  workspace?: string;
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
  workspace?: string;
  limit: number;
}

// ── Lazy offline client ────────────────────────────────────────────────

let _indexer: WikiIndexer | null = null;

function getIndexer(): WikiIndexer {
  if (!_indexer) {
    const workflowRoot = resolve('.workflow');
    const projectPath = process.cwd();
    const wsConfig = loadWorkspaceConfig(projectPath);
    const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
    const linkedWorkspaces = resolved
      .filter(lw => lw.valid)
      .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
    _indexer = new WikiIndexer({ workflowRoot, linkedWorkspaces });
  }
  return _indexer;
}

/**
 * Unified knowledge search — BM25F ranking via WikiIndexer, with type/category
 * filtering and per-source deduplication.
 */
export interface SearchMeta {
  embeddingUsed: boolean;
  embeddingDocs: number;
}

let _lastSearchMeta: SearchMeta = { embeddingUsed: false, embeddingDocs: 0 };
export function getLastSearchMeta(): SearchMeta { return _lastSearchMeta; }

export async function runUnifiedSearch(q: string, opts: UnifiedSearchOptions): Promise<SearchResult[]> {
  const limit = opts.limit > 0 ? opts.limit : 20;
  const indexer = getIndexer();

  const candidateLimit = Math.max(limit * 3, 60);
  const { results: scored, embeddingUsed, embeddingDocs } = await indexer.searchWithMeta(q, candidateLimit);
  _lastSearchMeta = { embeddingUsed, embeddingDocs };

  let filtered = scored;
  if (opts.type) {
    filtered = filtered.filter(r => r.entry.type === opts.type);
  }
  if (opts.category) {
    filtered = filtered.filter(r => r.entry.category === opts.category);
  }
  if (opts.workspace) {
    filtered = filtered.filter(r => r.entry.source.workspace === opts.workspace);
  }

  const seen = new Set<string>();
  const deduped: typeof filtered = [];
  for (const r of filtered) {
    if (seen.has(r.entry.id)) continue;
    seen.add(r.entry.id);
    deduped.push(r);
    if (deduped.length >= limit) break;
  }

  const maxScore = deduped.length > 0 ? deduped[0].score : 1;
  const results = deduped.map(({ entry, score }) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    category: entry.category,
    summary: entry.summary,
    score: maxScore > 0 ? score / maxScore : score,
    snippet: extractSnippet(entry.body, q),
    source: entry.source,
    workspace: entry.source.workspace,
  }));

  // Async credibility search_hits increment (best-effort, never blocks)
  if (results.length > 0) {
    incrementSearchHitsAsync(results.map(r => r.id));
  }

  return results;
}

function incrementSearchHitsAsync(entryIds: string[]): void {
  import('../graph/kg/engine.js').then(({ MaestroGraph }) => {
    const projectRoot = resolve('.');
    if (!MaestroGraph.isInitialized(projectRoot)) return;
    const mg = MaestroGraph.openSync(projectRoot);
    if (!mg) return;
    try {
      import('../graph/kg/credibility.js').then(({ CredibilityStore, wikiIdToNodeId }) => {
        const store = new CredibilityStore(mg.rawDb);
        const nodeIds = entryIds.map(wikiIdToNodeId).filter(Boolean) as string[];
        store.incrementSearchHits(nodeIds);
        mg.close();
      }).catch(() => { mg.close(); });
    } catch {
      mg.close();
    }
  }).catch(() => {});
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
    .description('Unified knowledge search across wiki + code (mixed by default)')
    .option('--type <type>', `Filter by type: ${VALID_TYPES.join(', ')}`)
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, test, review, learning)')
    .option('--code', 'Show wiki and code in separate sections (legacy display)')
    .option('--all', 'Alias for default mixed mode (backward compat)')
    .option('--wiki-only', 'Search wiki only, skip code results')
    .option('--workspace <name>', 'Filter results to a specific linked workspace')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      const limit = parseInt(opts.limit, 10) || 20;
      const wikiOnly = opts.wikiOnly === true;
      const separateSections = opts.code === true && !opts.all;

      if (opts.type && !VALID_TYPES.includes(opts.type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${opts.type}")`);
        process.exit(1);
      }

      const wikiResults = await runUnifiedSearch(q, { type: opts.type, category: opts.category, workspace: opts.workspace, limit });
      const codeResults = wikiOnly ? [] : await runCodeSearch(q, limit);

      const meta = getLastSearchMeta();
      const embTag = meta.embeddingUsed ? `+emb(${meta.embeddingDocs})` : 'bm25';
      const isTTY = process.stdout.isTTY === true;
      const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);

      // --code (without --all): legacy separate-section display
      if (separateSections) {
        if (opts.json) {
          console.log(JSON.stringify({ query: q, wikiCount: wikiResults.length, codeCount: codeResults.length, wikiResults, codeResults }, null, 2));
          return;
        }
        console.log(`Search: "${q}" (${wikiResults.length} wiki + ${codeResults.length} code, ${embTag})`);
        if (wikiResults.length === 0 && codeResults.length === 0) {
          console.log('  No matches found.');
          return;
        }
        if (wikiResults.length > 0) {
          console.log('  [Wiki Results]');
          for (const r of wikiResults) {
            printWikiResult(r, '    ', isTTY, qTerms);
          }
        }
        if (codeResults.length > 0) {
          console.log('  [Code Results]');
          for (const r of codeResults) {
            printCodeResult(r, '    ', isTTY, qTerms);
          }
        }
        return;
      }

      // Default / --all / --wiki-only: mixed interleaved results
      const merged = mergeAndNormalize(wikiResults, codeResults, limit);
      const wikiCount = merged.filter(r => r.source === 'wiki').length;
      const codeCount = merged.filter(r => r.source === 'code').length;

      if (opts.json) {
        console.log(JSON.stringify({ query: q, wikiCount, codeCount, count: merged.length, results: merged }, null, 2));
        return;
      }

      const countParts: string[] = [];
      if (wikiCount > 0) countParts.push(`wiki ${wikiCount}个`);
      if (codeCount > 0) countParts.push(`代码 ${codeCount}个`);
      const countSummary = countParts.length > 0
        ? `${countParts.join(' + ')} = ${merged.length} results`
        : '0 results';
      console.log(`Search: "${q}" (${countSummary}, ${embTag})`);

      if (qTerms.length > 4) {
        console.log(`  Hint: ${qTerms.length} terms — split into 1-3 keyword queries for better precision`);
      }

      if (merged.length === 0) {
        console.log('  No matches found.');
        return;
      }

      for (const r of merged) {
        const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
        const scoreTag = `  (${r.normalizedScore.toFixed(4)})`;
        if (r.source === 'wiki') {
          console.log(`  [wiki:${r.kind}]  ${name}  ${r.detail}${scoreTag}`);
          if (r.snippet) {
            const snippet = isTTY ? highlightTerms(r.snippet, qTerms) : r.snippet;
            console.log(`    ${snippet}`);
          }
        } else {
          const sigTag = r.signature ? `  ${truncate(r.signature, 60)}` : '';
          console.log(`  [code:${r.kind}]  ${name}  ${r.detail}${sigTag}${scoreTag}`);
        }
      }
    });

  program
    .command('embedding')
    .description('Embedding model status, warmup, and rebuild')
    .argument('[action]', 'status (default), warmup, rebuild', 'status')
    .action(async (action: string) => {
      const workflowRoot = resolve('.workflow');
      const { isAvailable, getUnavailableReason, loadEmbeddingIndex, embedTexts, getDeviceSummary, detectDevice } = await import('#maestro-dashboard/wiki/embedding.js');

      if (action === 'status') {
        const avail = await isAvailable();
        console.log(`Transformers: ${avail ? 'available' : 'NOT available (' + (getUnavailableReason?.() ?? 'unknown') + ')'}`);
        if (avail) {
          await detectDevice();
          console.log(`Device: ${getDeviceSummary()}`);
        }
        const idx = loadEmbeddingIndex(workflowRoot);
        if (idx) {
          console.log(`Index: ${idx.docIds.length} docs, dim=${idx.dimension}, model=${idx.modelId}`);
          console.log(`Built: ${new Date(idx.builtAt).toISOString()}, device=${idx.deviceUsed}`);
          if (idx.buildTimeMs) console.log(`Build time: ${idx.buildTimeMs}ms`);
        } else {
          console.log('Index: not built (will build on first search)');
        }
        return;
      }

      if (action === 'warmup') {
        const avail = await isAvailable();
        if (!avail) {
          console.error(`Embedding unavailable: ${getUnavailableReason?.() ?? 'unknown'}`);
          process.exit(1);
        }
        console.log('Warming up model...');
        const t0 = Date.now();
        await embedTexts(['warmup']);
        console.log(`Model ready (${getDeviceSummary()}, ${Date.now() - t0}ms)`);
        return;
      }

      if (action === 'rebuild') {
        const avail = await isAvailable();
        if (!avail) {
          console.error(`Embedding unavailable: ${getUnavailableReason?.() ?? 'unknown'}`);
          process.exit(1);
        }
        console.log('Rebuilding embedding index...');
        const { WikiIndexer } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
        const { loadWorkspaceConfig, resolveWorkspaceLinks } = await import('../config/index.js');
        const projectPath = process.cwd();
        const wsConfig = loadWorkspaceConfig(projectPath);
        const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
        const linkedWorkspaces = resolved.filter(lw => lw.valid).map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
        const indexer = new WikiIndexer({ workflowRoot, linkedWorkspaces });
        const t0 = Date.now();
        const { results, embeddingUsed, embeddingDocs } = await indexer.searchWithMeta('warmup', 1);
        if (embeddingUsed) {
          console.log(`Index rebuilt: ${embeddingDocs} docs (${Date.now() - t0}ms)`);
        } else {
          console.log(`Rebuild failed — check with: maestro embedding status`);
        }
        return;
      }

      console.error(`Unknown action: ${action}. Use: status, warmup, rebuild`);
      process.exit(1);
    });
}

// ── Display helpers ──────────────────────────────────────────────────

function printWikiResult(r: SearchResult, indent: string, isTTY: boolean, qTerms: string[]): void {
  const typeTag = `[${r.type}]`;
  const catTag = r.category ? ` ${r.category}` : '';
  const wsTag = r.workspace ? ` [ws:${r.workspace}]` : '';
  const scoreTag = r.score !== null ? `  (${r.score.toFixed(4)})` : '';
  const title = isTTY ? highlightTerms(r.title, qTerms) : r.title;
  console.log(`${indent}${typeTag}${catTag}${wsTag}  ${r.id}  ${title}${scoreTag}`);
  if (r.snippet) {
    const snippet = isTTY ? highlightTerms(r.snippet, qTerms) : r.snippet;
    console.log(`${indent}  ${snippet}`);
  } else if (r.summary) {
    const summary = isTTY ? highlightTerms(truncate(r.summary, 80), qTerms) : truncate(r.summary, 80);
    console.log(`${indent}  ${summary}`);
  }
}

function printCodeResult(r: CodeSearchResult, indent: string, isTTY: boolean, qTerms: string[]): void {
  const scoreTag = r.score !== null ? `  (${r.score.toFixed(4)})` : '';
  const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
  const sigTag = r.signature ? `  ${truncate(r.signature, 60)}` : '';
  console.log(`${indent}[${r.kind}] ${name}  ${r.filePath}${sigTag}${scoreTag}`);
}

// ── Multi-signal score normalization ────────────────────────────────
// Inspired by codebase-memory-mcp: type/kind boost + percentile-aware
// normalization + weighted source fusion.

export interface MergedResult {
  source: 'wiki' | 'code';
  kind: string;
  name: string;
  detail: string;
  normalizedScore: number;
  snippet?: string;
  signature?: string;
}

const WIKI_TYPE_BOOST: Record<string, number> = {
  spec: 1.15,
  knowhow: 1.10,
  domain: 1.05,
  issue: 1.00,
  project: 0.95,
  roadmap: 0.95,
  note: 0.90,
};

const CODE_KIND_BOOST: Record<string, number> = {
  function: 1.10,
  method: 1.10,
  class: 1.08,
  interface: 1.08,
  component: 1.05,
  route: 1.12,
  type_alias: 1.00,
  enum: 1.00,
  variable: 0.95,
  constant: 0.95,
  field: 0.90,
  property: 0.90,
};

function percentileNormalize(scores: number[]): Map<number, number> {
  if (scores.length === 0) return new Map();
  const sorted = [...scores].sort((a, b) => a - b);
  const result = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    result.set(sorted[i], (i + 1) / sorted.length);
  }
  return result;
}

function mergeAndNormalize(wiki: SearchResult[], code: CodeSearchResult[], limit: number): MergedResult[] {
  const WIKI_WEIGHT = 0.6;
  const CODE_WEIGHT = 0.4;

  const wikiBoosted = wiki.map(r => {
    const raw = r.score ?? 0;
    const typeBoost = WIKI_TYPE_BOOST[r.type] ?? 1.0;
    return { ...r, boostedScore: raw * typeBoost };
  });
  const codeBoosted = code.map(r => {
    const raw = r.score ?? 0;
    const kindBoost = CODE_KIND_BOOST[r.kind] ?? 1.0;
    return { ...r, boostedScore: raw * kindBoost };
  });

  const wikiPctMap = percentileNormalize(wikiBoosted.map(r => r.boostedScore));
  const codePctMap = percentileNormalize(codeBoosted.map(r => r.boostedScore));

  const merged: MergedResult[] = [];
  for (const r of wikiBoosted) {
    const pct = wikiPctMap.get(r.boostedScore) ?? 0;
    merged.push({
      source: 'wiki',
      kind: r.type,
      name: r.title,
      detail: r.category ? `${r.category}  ${r.id}` : r.id,
      normalizedScore: pct * WIKI_WEIGHT,
      snippet: r.snippet ?? undefined,
    });
  }
  for (const r of codeBoosted) {
    const pct = codePctMap.get(r.boostedScore) ?? 0;
    merged.push({
      source: 'code',
      kind: r.kind,
      name: r.name,
      detail: r.filePath,
      normalizedScore: pct * CODE_WEIGHT,
      signature: r.signature,
    });
  }

  merged.sort((a, b) => b.normalizedScore - a.normalizedScore);
  return merged.slice(0, limit);
}
