/**
 * Search Command — Unified knowledge search across wiki + code.
 *
 * Default: mixed results (wiki + code interleaved by normalized score).
 * --code: code graph results only (no wiki).
 * --wiki-only: wiki results only (no code search).
 *
 * Scoring: multi-signal normalization inspired by codebase-memory-mcp.
 *   Wiki:  BM25F score + type boost (spec > knowhow > note)
 *   Code:  BM25 score + kind boost + name-match bonus
 *   Merge: percentile-aware normalization + source weight
 *
 * Per-source caps: session ≤3, scratch ≤3 to prevent low-value source spam.
 */

import type { Command } from 'commander';
import { resolve, join } from 'node:path';

import { truncate, extractSnippet, highlightTerms } from '../utils/cli-format.js';
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type { WikiEntry, WikiNodeType } from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { tryDaemonSearch, stopDaemon, spawnDaemon, readDaemonInfo, isDaemonAlive, getDaemonPath } from '../search/daemon-client.js';

// Valid type filter values — matches WikiNodeType + virtual aliases.
const VALID_TYPES = ['project', 'roadmap', 'spec', 'issue', 'knowhow', 'note', 'domain', 'session', 'scratch'] as const;

// Per-category result caps — prevents low-value sources from dominating.
const CATEGORY_CAPS: Record<string, number> = {
  session: 3,
  scratch: 3,
};

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

let _indexer: InstanceType<typeof import('#maestro-dashboard/wiki/wiki-indexer.js').WikiIndexer> | null = null;

async function getIndexer(): Promise<WikiIndexer> {
  if (!_indexer) {
    const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    const workflowRoot = resolve('.workflow');
    const projectPath = process.cwd();
    const wsConfig = loadWorkspaceConfig(projectPath);
    const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
    const linkedWorkspaces = resolved
      .filter(lw => lw.valid)
      .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
    _indexer = new Cls({ workflowRoot, linkedWorkspaces });
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

export async function runUnifiedSearch(q: string, opts: UnifiedSearchOptions & { skipEmbedding?: boolean }): Promise<SearchResult[]> {
  const limit = opts.limit > 0 ? opts.limit : 20;
  const candidateLimit = Math.max(limit * 3, 60);

  // Try daemon first (warm ONNX model, no cold-start penalty)
  const workflowRoot = resolve('.workflow');
  const daemonResult = await tryDaemonSearch(workflowRoot, q, candidateLimit, opts.skipEmbedding);
  let scored: Array<{ entry: WikiEntry; score: number }>;
  let embeddingUsed: boolean;
  let embeddingDocs: number;

  if (daemonResult?.ok && daemonResult.results) {
    scored = daemonResult.results;
    embeddingUsed = daemonResult.embeddingUsed ?? false;
    embeddingDocs = daemonResult.embeddingDocs ?? 0;
  } else {
    // Daemon unavailable — use BM25-only to avoid ONNX cold-start (~1800ms).
    // Spawn daemon in background so future searches get embedding.
    const indexer = await getIndexer();
    const result = await indexer.searchWithMeta(q, candidateLimit, { skipEmbedding: true });
    scored = result.results;
    embeddingUsed = result.embeddingUsed;
    embeddingDocs = result.embeddingDocs;
    spawnDaemon(workflowRoot).catch(() => {});
  }
  _lastSearchMeta = { embeddingUsed, embeddingDocs };

  let filtered = scored;
  if (opts.type) {
    // Virtual type aliases: session/scratch map to category filter
    if (opts.type === 'session') {
      filtered = filtered.filter(r => r.entry.category === 'session');
    } else if (opts.type === 'scratch') {
      filtered = filtered.filter(r => r.entry.category === 'scratch');
    } else {
      filtered = filtered.filter(r => r.entry.type === opts.type);
    }
  }
  if (opts.category) {
    filtered = filtered.filter(r => r.entry.category === opts.category);
  }
  if (opts.workspace) {
    filtered = filtered.filter(r => r.entry.source.workspace === opts.workspace);
  }

  // CATEGORY_CAPS only when user didn't explicitly filter by type/category
  const applyCaps = !opts.type && !opts.category;
  const seen = new Set<string>();
  const deduped: typeof filtered = [];
  const catCounts = new Map<string, number>();
  for (const r of filtered) {
    if (seen.has(r.entry.id)) continue;
    if (applyCaps) {
      const cat = r.entry.category ?? '';
      const cap = CATEGORY_CAPS[cat];
      if (cap !== undefined) {
        const count = catCounts.get(cat) ?? 0;
        if (count >= cap) continue;
        catCounts.set(cat, count + 1);
      }
    }
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

/** A KG unified search result from MaestroGraph. */
export interface KgSearchResult {
  id: string;
  sourceType: string;
  kind: string;
  name: string;
  definition: string;
  filePath: string;
  score: number;
}

async function runKgSearch(q: string, limit: number): Promise<{ results: KgSearchResult[]; summary: Record<string, number> }> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(resolve('.'))) return { results: [], summary: {} };
    const mg = await MaestroGraph.open(resolve('.'));
    try {
      const output = mg.searchUnified(q, { limit });
      const results: KgSearchResult[] = output.directMatches.map(r => ({
        id: r.node.id,
        sourceType: r.node.sourceType,
        kind: r.node.kind,
        name: r.node.name,
        definition: r.node.definition?.substring(0, 120) || '',
        filePath: r.node.filePath,
        score: r.score,
      }));
      return { results, summary: output.summary };
    } finally {
      mg.close();
    }
  } catch {
    return { results: [], summary: {} };
  }
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
    .option('--code', 'Code graph results only (no wiki)')
    .option('--kg', 'KG unified search (MaestroGraph full-source)')
    .option('--all', 'Alias for default mixed mode (backward compat)')
    .option('--wiki-only', 'Search wiki only, skip code results')
    .option('--workspace <name>', 'Filter results to a specific linked workspace')
    .option('--no-emb', 'Skip embedding, use BM25 only')
    .option('--limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      const limit = parseInt(opts.limit, 10) || 20;
      const wikiOnly = opts.wikiOnly === true;
      const codeOnly = opts.code === true && !opts.all;
      const kgMode = opts.kg === true;

      if (opts.type && !VALID_TYPES.includes(opts.type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${opts.type}")`);
        process.exit(1);
      }

      const skipEmbedding = opts.emb === false;
      const isTTY = process.stdout.isTTY === true;
      const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);

      // --kg: MaestroGraph unified search
      if (kgMode) {
        const { results: kgResults, summary } = await runKgSearch(q, limit);
        if (opts.json) {
          console.log(JSON.stringify({ query: q, engine: 'maestrograph', count: kgResults.length, summary, results: kgResults }, null, 2));
          return;
        }
        const parts: string[] = [];
        if (summary.codeSymbols) parts.push(`codegraph ${summary.codeSymbols}`);
        if (summary.domainTerms) parts.push(`domain ${summary.domainTerms}`);
        if (summary.specRules) parts.push(`spec ${summary.specRules}`);
        if (summary.knowhowDocs) parts.push(`knowhow ${summary.knowhowDocs}`);
        const headerSummary = parts.length > 0 ? `${parts.join(' + ')} = ${kgResults.length}` : `${kgResults.length}`;
        console.log(`Search: "${q}" (${headerSummary}, KG)`);
        if (kgResults.length === 0) {
          console.log('  No matches found.');
          return;
        }
        for (const r of kgResults) {
          const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
          const def = r.definition ? `  ${truncate(r.definition, 70)}` : '';
          const scoreTag = `  (${r.score.toFixed(1)})`;
          console.log(`  [${r.sourceType}:${r.kind}]  ${name}${def}${scoreTag}`);
        }
        return;
      }

      // Parallel: wiki + code search (skip irrelevant source based on flags)
      const [wikiResults, codeResults] = await Promise.all([
        codeOnly ? [] : runUnifiedSearch(q, { type: opts.type, category: opts.category, workspace: opts.workspace, limit, skipEmbedding }),
        wikiOnly ? [] : runCodeSearch(q, limit),
      ]);

      const meta = getLastSearchMeta();
      const embTag = meta.embeddingUsed ? `+emb(${meta.embeddingDocs})` : 'bm25';

      // --code: code graph results only
      if (codeOnly) {
        if (opts.json) {
          console.log(JSON.stringify({ query: q, count: codeResults.length, results: codeResults }, null, 2));
          return;
        }
        console.log(`Search: "${q}" (code ${codeResults.length}, ${embTag})`);
        if (codeResults.length === 0) {
          console.log('  No matches found.');
          return;
        }
        for (const r of codeResults) {
          printCodeResult(r, '  ', isTTY, qTerms);
        }
        return;
      }

      // Default / --all / --wiki-only: mixed interleaved results
      const merged = mergeAndNormalize(wikiResults, codeResults, limit, q);
      const wikiCount = merged.filter(r => r.source === 'wiki').length;
      const codeCount = merged.filter(r => r.source === 'code').length;

      if (opts.json) {
        const typeCountsJson: Record<string, number> = {};
        for (const r of merged) {
          let dt: string;
          if (r.source === 'code') dt = 'code';
          else if (r.category === 'session') dt = 'session';
          else if (r.category === 'scratch') dt = 'scratch';
          else dt = r.kind;
          typeCountsJson[dt] = (typeCountsJson[dt] ?? 0) + 1;
        }
        console.log(JSON.stringify({ query: q, wikiCount, codeCount, typeCounts: typeCountsJson, count: merged.length, results: merged }, null, 2));
        return;
      }

      // Per-type breakdown header
      const TYPE_DISPLAY_ORDER = ['spec', 'domain', 'knowhow', 'issue', 'project', 'roadmap', 'note', 'session', 'scratch', 'code'];
      const typeCounts = new Map<string, number>();
      for (const r of merged) {
        let displayType: string;
        if (r.source === 'code') displayType = 'code';
        else if (r.category === 'session') displayType = 'session';
        else if (r.category === 'scratch') displayType = 'scratch';
        else displayType = r.kind;
        typeCounts.set(displayType, (typeCounts.get(displayType) ?? 0) + 1);
      }
      const countParts: string[] = [];
      for (const t of TYPE_DISPLAY_ORDER) {
        const c = typeCounts.get(t);
        if (c) countParts.push(`${t} ${c}`);
      }
      for (const [t, c] of typeCounts) {
        if (!TYPE_DISPLAY_ORDER.includes(t)) countParts.push(`${t} ${c}`);
      }
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
        const displayName = truncate(r.name, 60);
        const name = isTTY ? highlightTerms(displayName, qTerms) : displayName;
        const scoreTag = `  (${r.normalizedScore.toFixed(4)})`;
        if (r.source === 'wiki') {
          console.log(`  [wiki:${r.kind}]  ${name}  ${r.detail}${scoreTag}`);
          const subtitle = pickSubtitle(r);
          if (subtitle) {
            const text = isTTY ? highlightTerms(subtitle, qTerms) : subtitle;
            console.log(`    ${text}`);
          }
        } else {
          const sigTag = r.signature ? `  ${truncate(r.signature, 60)}` : '';
          console.log(`  [code:${r.kind}]  ${name}  ${r.detail}${sigTag}${scoreTag}`);
        }
      }
    });

  // ── Search daemon management ───────────────────────────────────────────

  program
    .command('search-daemon')
    .description('Manage the resident search daemon (warm ONNX model)')
    .argument('<action>', 'start | stop | status')
    .action(async (action: string) => {
      const workflowRoot = resolve('.workflow');

      if (action === 'start' || action === 'start-daemon') {
        const info = readDaemonInfo(workflowRoot);
        if (info && isDaemonAlive(info)) {
          console.log(`Search daemon already running (pid=${info.pid}, port=${info.port})`);
          return;
        }
        console.log('Starting search daemon...');
        const projectPath = process.cwd();
        const wsConfig = loadWorkspaceConfig(projectPath);
        const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
        const linkedWorkspaces = resolved
          .filter(lw => lw.valid)
          .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
        const { startDaemon } = await import('../search/daemon.js');
        const { port } = await startDaemon(workflowRoot, { workflowRoot, linkedWorkspaces });
        console.log(`Search daemon started (pid=${process.pid}, port=${port})`);
        // Keep process alive
        return;
      }

      if (action === 'stop') {
        const stopped = stopDaemon(workflowRoot);
        console.log(stopped ? 'Search daemon stopped.' : 'No daemon running.');
        return;
      }

      if (action === 'status') {
        const info = readDaemonInfo(workflowRoot);
        if (!info) { console.log('Search daemon: not running'); return; }
        const alive = isDaemonAlive(info);
        console.log(`Search daemon: ${alive ? 'running' : 'stale (pid dead)'}  pid=${info.pid}  port=${info.port}  started=${info.startedAt}`);
        if (!alive) try { const { unlinkSync } = await import('node:fs'); unlinkSync(getDaemonPath(workflowRoot)); } catch {}
        return;
      }

      console.error(`Unknown action: ${action}. Use: start, stop, status`);
    });

  // Hidden flag for hook-spawned daemon startup
  program
    .command('search-start-daemon', { hidden: true })
    .action(async () => {
      const workflowRoot = resolve('.workflow');
      const projectPath = process.cwd();
      const wsConfig = loadWorkspaceConfig(projectPath);
      const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
      const linkedWorkspaces = resolved
        .filter(lw => lw.valid)
        .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
      try {
        const { startDaemon } = await import('../search/daemon.js');
        await startDaemon(workflowRoot, { workflowRoot, linkedWorkspaces });
      } catch { process.exit(0); }
    });

  program
    .command('embedding')
    .description('Embedding model status, warmup, and rebuild')
    .argument('[action]', 'status (default), warmup, rebuild', 'status')
    .action(async (action: string) => {
      const workflowRoot = resolve('.workflow');
      const { isAvailable, getUnavailableReason, loadEmbeddingIndex, embedTexts, getDeviceSummary, detectDevice, setProgressCallback, DEFAULT_MODEL_ID, isApiMode, getModelId, loadEmbeddingApiConfig } = await import('#maestro-dashboard/wiki/embedding.js');

      if (action === 'status') {
        const apiMode = isApiMode();
        const apiConf = loadEmbeddingApiConfig();
        if (apiMode && apiConf) {
          console.log(`Mode: API (external)`);
          console.log(`Endpoint: ${apiConf.baseUrl}`);
          console.log(`Model: ${apiConf.model}`);
          if (apiConf.dimensions) console.log(`Dimensions: ${apiConf.dimensions}`);
          const batchInfo = apiConf.batchSize
            ? `fixed ${apiConf.batchSize}`
            : `dynamic (ctx ${apiConf.contextLength ?? 8192} tokens)`;
          console.log(`Batching: ${batchInfo}, concurrency: ${apiConf.concurrency ?? 4}`);
        } else {
          const avail = await isAvailable();
          console.log(`Transformers: ${avail ? 'available' : 'NOT available (' + (getUnavailableReason?.() ?? 'unknown') + ')'}`);
          if (avail) {
            await detectDevice();
            console.log(`Device: ${getDeviceSummary()}`);
          }
          console.log(`Model: ${DEFAULT_MODEL_ID} (~465 MB)`);
        }
        console.log(`Active model: ${getModelId()}`);
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

        if (isApiMode()) {
          console.log(`Warming up API embedding (${getModelId()})...`);
          const t0 = Date.now();
          await embedTexts(['warmup']);
          console.log(`API embedding ready (${Date.now() - t0}ms)`);
          return;
        }

        const isTTY = process.stderr.isTTY === true;
        let downloadStarted = false;
        let lastPct = -1;
        setProgressCallback((info) => {
          if (info.status === 'progress' && info.file === 'onnx/model.onnx' && !downloadStarted) {
            downloadStarted = true;
            console.error(`Downloading model ${DEFAULT_MODEL_ID} (~465 MB)...`);
          }
          if (info.status === 'progress' && info.file === 'onnx/model.onnx' && typeof info.progress === 'number') {
            const pct = Math.round(info.progress);
            if (pct === lastPct) return;
            lastPct = pct;
            const loaded = info.loaded ? `${(info.loaded / 1024 / 1024).toFixed(0)}` : '0';
            const total = info.total ? `${(info.total / 1024 / 1024).toFixed(0)}` : '?';
            if (isTTY) {
              const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
              process.stderr.write(`  [${bar}] ${pct}% ${loaded}/${total} MB\r`);
            } else if (pct % 25 === 0) {
              console.error(`  ${pct}% (${loaded}/${total} MB)`);
            }
          }
          if (info.status === 'done' && info.file === 'onnx/model.onnx' && downloadStarted) {
            if (isTTY) process.stderr.write('\x1b[2K\r');
            console.error(`  ✓ model.onnx downloaded`);
          }
        });

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

function isDuplicate(text: string, title: string): boolean {
  const a = text.replace(/^#+\s+/, '').replace(/^[-*]\s+/, '').trim();
  const b = title.trim();
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.startsWith(b.slice(0, 30)) || b.startsWith(a.slice(0, 30))) return true;
  return false;
}

function pickSubtitle(r: MergedResult): string | null {
  if (r.snippet) {
    const content = r.snippet.replace(/^L\d+:\s*/, '');
    if (!isDuplicate(content, r.name)) return r.snippet;
  }
  if (r.summary) {
    const cleaned = r.summary.replace(/^#+\s+/, '').trim();
    if (!isDuplicate(cleaned, r.name)) return truncate(cleaned, 80);
  }
  return null;
}

function printCodeResult(r: CodeSearchResult, indent: string, isTTY: boolean, qTerms: string[]): void {
  const scoreTag = r.score !== null ? `  (${r.score.toFixed(4)})` : '';
  const name = isTTY ? highlightTerms(r.name, qTerms) : r.name;
  const sigTag = r.signature ? `  ${truncate(r.signature, 60)}` : '';
  console.log(`${indent}[${r.kind}] ${name}  ${r.filePath}${sigTag}${scoreTag}`);
}

// ── Multi-signal score normalization ────────────────────────────────
// Three-layer scoring:
//   1. Source-level boost (wiki type / code kind)
//   2. Name-match bonus for code results (exact > prefix > contains)
//   3. Dynamic source weight based on query type (identifier → boost code)
//   4. Rank-based normalization (position-aware, handles ties)

export interface MergedResult {
  source: 'wiki' | 'code';
  kind: string;
  name: string;
  detail: string;
  normalizedScore: number;
  snippet?: string;
  summary?: string;
  signature?: string;
  category?: string;
}

const WIKI_TYPE_BOOST: Record<string, number> = {
  spec: 1.15,
  domain: 1.10,
  knowhow: 1.05,
  project: 0.95,
  roadmap: 0.95,
  issue: 0.85,
  note: 0.80,
};

const CODE_KIND_BOOST: Record<string, number> = {
  class: 1.20,
  interface: 1.15,
  function: 1.10,
  method: 1.10,
  component: 1.08,
  route: 1.12,
  type_alias: 1.05,
  enum: 1.05,
  constant: 1.00,
  variable: 0.90,
  field: 0.85,
  property: 0.80,
};

function isCodeIdentifier(query: string): boolean {
  const trimmed = query.trim();
  if (/^[a-z]+[A-Z]/.test(trimmed)) return true;
  if (/^[A-Z][a-z]+[A-Z]/.test(trimmed)) return true;
  if (/^[A-Z]{2,}[a-z]/.test(trimmed)) return true;
  if (/^[a-z]+_[a-z]+/.test(trimmed)) return true;
  if (/^[A-Z][a-zA-Z]+$/.test(trimmed) && !trimmed.includes(' ')) return true;
  return false;
}

function splitCamelSnake(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length > 0);
}

function codeNameMatchBonus(codeName: string, query: string): number {
  const nameLower = codeName.toLowerCase();
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return 0;
  if (nameLower === queryLower) return 50;
  if (nameLower.startsWith(queryLower)) return 30;
  if (queryLower.startsWith(nameLower)) return 20;
  if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) return 10;
  const queryTokens = splitCamelSnake(query);
  const nameTokens = splitCamelSnake(codeName);
  if (queryTokens.length === 0) return 0;
  const matched = queryTokens.filter(qt => nameTokens.some(nt => nt.includes(qt) || qt.includes(nt)));
  if (matched.length === queryTokens.length) return 15 + 5 * matched.length;
  if (matched.length > 0) return 5 * matched.length;
  return 0;
}

function rankNormalize(items: Array<{ index: number; score: number }>): number[] {
  if (items.length === 0) return [];
  const n = items.length;
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const result = new Array<number>(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && sorted[j + 1].score === sorted[j].score) j++;
    const avgRank = (i + j) / 2;
    const normalizedRank = 1 - avgRank / n;
    for (let k = i; k <= j; k++) {
      result[sorted[k].index] = normalizedRank;
    }
    i = j + 1;
  }
  return result;
}

function mergeAndNormalize(wiki: SearchResult[], code: CodeSearchResult[], limit: number, query?: string): MergedResult[] {
  const q = query ?? '';
  const isIdQuery = isCodeIdentifier(q);
  const hasStrongCodeMatch = code.length > 0 && code.some(r =>
    codeNameMatchBonus(r.name, q) >= 15,
  );
  const WIKI_WEIGHT = isIdQuery ? 0.4 : hasStrongCodeMatch ? 0.5 : 0.6;
  const CODE_WEIGHT = isIdQuery ? 0.6 : hasStrongCodeMatch ? 0.5 : 0.4;

  const codeNames = new Set(code.map(r => r.name.toLowerCase()));

  const wikiScored = wiki.map((r, i) => {
    const raw = r.score ?? 0;
    let typeBoost = WIKI_TYPE_BOOST[r.type] ?? 1.0;
    if (r.id.startsWith('kg-') && codeNames.has(r.title.toLowerCase())) {
      typeBoost *= 0.7;
    }
    return { ...r, finalScore: raw * typeBoost, index: i };
  });

  const codeScored = code.map((r, i) => {
    const raw = r.score ?? 0;
    const kindBoost = CODE_KIND_BOOST[r.kind] ?? 1.0;
    const nameBonus = codeNameMatchBonus(r.name, q);
    return { ...r, finalScore: raw * kindBoost + nameBonus, index: i };
  });

  const wikiRanks = rankNormalize(wikiScored.map(r => ({ index: r.index, score: r.finalScore })));
  const codeRanks = rankNormalize(codeScored.map(r => ({ index: r.index, score: r.finalScore })));

  const merged: MergedResult[] = [];
  for (let i = 0; i < wikiScored.length; i++) {
    const r = wikiScored[i];
    merged.push({
      source: 'wiki',
      kind: r.type,
      name: r.title,
      detail: r.category ? `${r.category}  ${r.id}` : r.id,
      normalizedScore: wikiRanks[i] * WIKI_WEIGHT,
      snippet: r.snippet ?? undefined,
      summary: r.summary || undefined,
      category: r.category ?? undefined,
    });
  }
  for (let i = 0; i < codeScored.length; i++) {
    const r = codeScored[i];
    merged.push({
      source: 'code',
      kind: r.kind,
      name: r.name,
      detail: r.filePath,
      normalizedScore: codeRanks[i] * CODE_WEIGHT,
      signature: r.signature,
    });
  }

  merged.sort((a, b) => b.normalizedScore - a.normalizedScore);
  return merged.slice(0, limit);
}
