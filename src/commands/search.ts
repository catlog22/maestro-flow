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
 *   Merge: rank interleave (ordering) + per-source normalized relevance (display)
 *
 * Per-source caps: session ≤3, scratch ≤3 to prevent low-value source spam.
 */

import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

import { truncate, extractSnippet, highlightTerms } from '../utils/cli-format.js';
import { knowhowFileToWikiId } from '../utils/frontmatter.js';
import { isDeprecatedKnowledgeEntry } from '../utils/knowledge-lifecycle.js';
import { recordSearchUsage } from './search-usage.js';
import type { SourceType } from '../graph/kg/db/types.js';
import type { WikiIndexer } from '#maestro-dashboard/wiki/wiki-indexer.js';
import type {
  WikiEntry,
  WikiNodeType,
  WikiSearchFilters,
} from '#maestro-dashboard/wiki/wiki-types.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { searchArchKb, tokenize as tokenizeArchKb, type ScoredArchKbEntry } from '../arch-kb/index.js';
import {
  healthDaemon,
  isDaemonAlive,
  isDaemonInfoV2,
  isDaemonReadyResponse,
  readDaemonInfo,
  spawnDaemon,
  stopDaemon,
  tryDaemonSearch,
} from '../search/daemon-client.js';

// Valid type filter values — matches WikiNodeType + virtual aliases.
const VALID_TYPES = ['project', 'roadmap', 'spec', 'issue', 'knowhow', 'note', 'domain', 'session', 'scratch', 'template'] as const;

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
  sourceRef?: string | null;
  workspace?: string;
  confidence?: string;
  /** Session/Run topology — present only on run-mode session and run entries. */
  sessionId?: string;
  runId?: string;
  runCount?: number;
  related?: string[];
  /** Why this wiki candidate entered the final list; does not alter score. */
  selectionReason?: 'relevance' | 'diversity' | 'exploration';
}

/** A code search result from CodeGraph. */
export interface CodeSearchResult {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  line: number | null;
  score: number | null;
  signature?: string;
  /** Linked workspace provenance；本地 CodeGraph 结果不设置。 */
  workspace?: string;
  /** Linked 结果的稳定 workspace 边界。 */
  workspaceFence?: string;
}

/** Availability of the codegraph index backing code search. */
export type CodeIndexStatus = 'ok' | 'not-initialized' | 'empty' | 'error';
export type SearchExecutionMode = 'default' | 'read-only-probe';
export type SearchEvidenceEventName =
  | 'daemon-lookup'
  | 'daemon-start'
  | 'credibility-hit-write';

export interface SearchEvidenceEvent {
  event: SearchEvidenceEventName;
  site: string;
  queryId: string | null;
}

/** Code search results plus index availability for actionable feedback. */
export interface CodeSearchOutcome {
  results: CodeSearchResult[];
  status: CodeIndexStatus;
  linkedFailures?: LinkedCodeSearchFailure[];
}

export interface LinkedCodeSearchFailure {
  workspace: string;
  message: string;
}

export interface LinkedCodeSearchOutcome {
  results: CodeSearchResult[];
  failures: LinkedCodeSearchFailure[];
}

/** Actionable hint for a degraded code index, or null when healthy. */
export function codeIndexHint(status: CodeIndexStatus): string | null {
  switch (status) {
    case 'not-initialized':
      return 'code index not initialized — run "maestro kg init" to enable code search (hooks keep it synced afterwards)';
    case 'empty':
      return 'code index is empty — run "maestro kg sync --source codegraph"';
    case 'error':
      return 'code search failed — rerun with MAESTRO_DEBUG=1 for details';
    default:
      return null;
  }
}

/** Options for runUnifiedSearch — wiki facets and result cap. */
export interface UnifiedSearchOptions {
  type?: string;
  category?: string;
  tag?: string;
  /** Artifact kind projected by Session/Run virtual entries. */
  kind?: string;
  keyword?: string;
  workspace?: string;
  limit: number;
  /** 显式包含已授权的 linked CodeGraph 数据库；默认 false。 */
  includeLinkedCode?: boolean;
  /** Internal evaluation mode that forbids daemon, persistence, embeddings, and hit writes. */
  executionMode?: SearchExecutionMode;
  /** Include entries with status="deprecated" (superseded). Default: excluded. */
  includeDeprecated?: boolean;
  /** Optional raw recorder used by the built adapter; absent in normal CLI calls. */
  evidenceRecorder?: (event: SearchEvidenceEvent) => void;
  /** Query identity attached to raw evidence events. */
  evidenceQueryId?: string | null;
  /** Wiki candidate selection policy. Default: balanced. */
  diversity?: 'balanced' | 'off';
  /** Mixed search defers impressions until cross-source truncation is complete. */
  deferImpressions?: boolean;
  /** Final mixed display size used when reserving an exploration candidate. */
  explorationLimit?: number;
}

// ── Lazy offline client ────────────────────────────────────────────────

let _indexer: {
  workflowRoot: string;
  indexer: InstanceType<typeof import('#maestro-dashboard/wiki/wiki-indexer.js').WikiIndexer>;
} | null = null;
let _probeIndexer: {
  workflowRoot: string;
  indexer: InstanceType<typeof import('#maestro-dashboard/wiki/wiki-indexer.js').WikiIndexer>;
} | null = null;

async function getIndexer(executionMode: SearchExecutionMode = 'default'): Promise<WikiIndexer> {
  const workflowRoot = resolve('.workflow');
  if (executionMode === 'read-only-probe') {
    if (!_probeIndexer || _probeIndexer.workflowRoot !== workflowRoot) {
      const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
      const projectPath = process.cwd();
      const wsConfig = loadWorkspaceConfig(projectPath);
      const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
      const linkedWorkspaces = resolved
        .filter(lw => lw.valid)
        .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
      _probeIndexer = {
        workflowRoot,
        indexer: new Cls({
          workflowRoot,
          linkedWorkspaces,
          persistence: 'memory-only',
        }),
      };
    }
    return _probeIndexer.indexer;
  }
  if (!_indexer || _indexer.workflowRoot !== workflowRoot) {
    const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    const projectPath = process.cwd();
    const wsConfig = loadWorkspaceConfig(projectPath);
    const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
    const linkedWorkspaces = resolved
      .filter(lw => lw.valid)
      .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
    // The resident daemon is the sole persistent-cache publisher. A
    // short-lived fallback may consume an existing cache and preserve the
    // full source corpus, but must not keep the CLI alive to republish it.
    _indexer = {
      workflowRoot,
      indexer: new Cls({ workflowRoot, linkedWorkspaces, persistence: 'read-only' }),
    };
  }
  return _indexer.indexer;
}

/**
 * Unified knowledge search — BM25F ranking via WikiIndexer, with type/category
 * filtering and per-source deduplication.
 */
export interface SearchMeta {
  embeddingUsed: boolean;
  embeddingDocs: number;
  diversityApplied?: boolean;
  explorationUsed?: boolean;
}

let _lastSearchMeta: SearchMeta = { embeddingUsed: false, embeddingDocs: 0 };
export function getLastSearchMeta(): SearchMeta { return _lastSearchMeta; }

// One-shot attribution when a supposedly-running daemon can't be reached (G-C12).
let _daemonFallbackNoted = false;

interface ScoredWikiCandidate {
  entry: WikiEntry;
  score: number;
}

interface SelectedWikiCandidate extends ScoredWikiCandidate {
  selectionReason: 'relevance' | 'diversity' | 'exploration';
}

function familyKey(entry: WikiEntry): string {
  if (
    (entry.ext?.virtualKind === 'session' || entry.ext?.virtualKind === 'session-run')
    && entry.id.startsWith('session-')
  ) {
    return entry.id;
  }
  return (entry.parent ?? entry.id).replace(/-\d{2,3}$/, '');
}

function semanticTokens(entry: WikiEntry): Set<string> {
  const text = `${entry.title} ${entry.summary} ${entry.tags.join(' ')} ${entry.category ?? ''}`
    .normalize('NFKC')
    .toLowerCase();
  return new Set(text.match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function buildWikiCandidatePool(
  filtered: ScoredWikiCandidate[],
  applyCaps: boolean,
  familyCap = 2,
): ScoredWikiCandidate[] {
  const KG_CODE_CAP = 3;
  const seen = new Set<string>();
  const pool: ScoredWikiCandidate[] = [];
  const catCounts = new Map<string, number>();
  const parentCounts = new Map<string, number>();
  let kgCodeCount = 0;
  for (const candidate of filtered) {
    if (seen.has(candidate.entry.id)) continue;
    const parent = familyKey(candidate.entry);
    const parentCount = parentCounts.get(parent) ?? 0;
    if (parentCount >= familyCap) continue;
    if (applyCaps) {
      const category = candidate.entry.category ?? '';
      const cap = CATEGORY_CAPS[category];
      if (cap !== undefined) {
        const count = catCounts.get(category) ?? 0;
        if (count >= cap) continue;
        catCounts.set(category, count + 1);
      }
      if (candidate.entry.id.startsWith('kg-code')) {
        if (kgCodeCount >= KG_CODE_CAP) continue;
        kgCodeCount++;
      }
    }
    seen.add(candidate.entry.id);
    parentCounts.set(parent, parentCount + 1);
    pool.push(candidate);
  }
  return pool;
}

/**
 * Stable wiki selection: identity/family caps first, then high-lambda MMR.
 * One final slot may explore a lower-exposure candidate above a strict
 * relevance floor. Exposure never changes the relevance score.
 */
export function selectDiverseWikiCandidates(
  filtered: ScoredWikiCandidate[],
  options: {
    limit: number;
    applyCaps: boolean;
    diversity?: 'balanced' | 'off';
    impressions?: Map<string, number>;
    explorationLimit?: number;
  },
): SelectedWikiCandidate[] {
  const diversity = options.diversity ?? 'balanced';
  const pool = buildWikiCandidatePool(
    filtered,
    options.applyCaps,
    diversity === 'balanced' ? 1 : 2,
  );

  const limit = Math.max(0, options.limit);
  if (limit === 0 || pool.length === 0) return [];
  if (diversity === 'off') {
    return pool.slice(0, limit).map(candidate => ({
      ...candidate,
      selectionReason: 'relevance',
    }));
  }

  const maxScore = Math.max(pool[0].score, Number.EPSILON);
  const tokens = new Map(pool.map(candidate => [candidate.entry.id, semanticTokens(candidate.entry)]));
  const remaining = [...pool];
  const selected: SelectedWikiCandidate[] = [];
  const maxSimilarity = new Map(remaining.map(candidate => [candidate.entry.id, 0]));
  const lambda = 0.88;
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const relevance = candidate.score / maxScore;
      const similarity = maxSimilarity.get(candidate.entry.id) ?? 0;
      const value = lambda * relevance - (1 - lambda) * similarity;
      if (value > bestValue + Number.EPSILON) {
        bestIndex = index;
        bestValue = value;
      }
    }
    const [candidate] = remaining.splice(bestIndex, 1);
    maxSimilarity.delete(candidate.entry.id);
    selected.push({
      ...candidate,
      selectionReason: selected.length === 0 ? 'relevance' : 'diversity',
    });
    const selectedTokens = tokens.get(candidate.entry.id)!;
    for (const remainingCandidate of remaining) {
      const similarity = jaccard(tokens.get(remainingCandidate.entry.id)!, selectedTokens);
      if (similarity > (maxSimilarity.get(remainingCandidate.entry.id) ?? 0)) {
        maxSimilarity.set(remainingCandidate.entry.id, similarity);
      }
    }
  }

  // A bounded exploration slot prevents exposure feedback loops. It is only
  // used when counters exist and the candidate remains at least 35% as
  // relevant as the top result.
  const impressions = options.impressions;
  const explorationLimit = Math.min(limit, options.explorationLimit ?? limit);
  if (explorationLimit >= 4
    && pool.length > explorationLimit
    && impressions
    && impressions.size > 0) {
    const explorationBase = selected.slice(0, explorationLimit);
    const selectedIds = new Set(explorationBase.map(item => item.entry.id));
    const selectedFamilies = new Set(explorationBase.map(item => familyKey(item.entry)));
    const eligible = pool
      .filter(candidate =>
        !selectedIds.has(candidate.entry.id)
        && !selectedFamilies.has(familyKey(candidate.entry))
        && candidate.score / maxScore >= 0.35
        && impressions.has(candidate.entry.id)
      )
      .sort((left, right) =>
        (impressions.get(left.entry.id) ?? 0) - (impressions.get(right.entry.id) ?? 0)
        || right.score - left.score
        || left.entry.id.localeCompare(right.entry.id)
      );
    const explorer = eligible[0];
    const selectedMaxExposure = Math.max(
      ...explorationBase.map(item => impressions.get(item.entry.id) ?? 0),
    );
    if (explorer && (impressions.get(explorer.entry.id) ?? 0) < selectedMaxExposure) {
      const explorerIndex = selected.findIndex(item => item.entry.id === explorer.entry.id);
      if (explorerIndex >= 0) {
        selected[explorerIndex] = { ...explorer, selectionReason: 'exploration' };
      } else {
        selected[selected.length - 1] = { ...explorer, selectionReason: 'exploration' };
      }
    }
  }
  return selected;
}

export async function runUnifiedSearch(q: string, opts: UnifiedSearchOptions & { skipEmbedding?: boolean }): Promise<SearchResult[]> {
  const limit = Math.min(500, opts.limit > 0 ? Math.trunc(opts.limit) : 20);
  const executionMode = opts.executionMode ?? 'default';
  const readOnlyProbe = executionMode === 'read-only-probe';
  const filters: WikiSearchFilters = {
    ...(opts.type ? { type: opts.type as WikiSearchFilters['type'] } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.tag ? { tag: opts.tag.toLowerCase() } : {}),
    ...(opts.keyword ? { keyword: opts.keyword } : {}),
    ...(opts.workspace ? { workspace: opts.workspace } : {}),
    includeDeprecated: opts.includeDeprecated === true,
  };
  const hasFacet = Boolean(
    opts.type || opts.category || opts.tag || opts.keyword || opts.workspace || opts.includeDeprecated
  );
  const searchFilters = hasFacet ? filters : undefined;
  // Filters are applied inside BM25/vector candidate generation. Keep a
  // bounded oversample only for family caps and diversity selection.
  const candidateLimit = Math.min(500, Math.max(limit * 2, 40));

  // Try daemon first (warm ONNX model, no cold-start penalty)
  const workflowRoot = resolve('.workflow');
  if (!readOnlyProbe) {
    opts.evidenceRecorder?.({
      event: 'daemon-lookup',
      site: 'runUnifiedSearch.tryDaemonSearch',
      queryId: opts.evidenceQueryId ?? null,
    });
  }
  const daemonResult = readOnlyProbe
    ? null
    : await tryDaemonSearch(
        workflowRoot,
        q,
        candidateLimit,
        opts.skipEmbedding,
        { filters: searchFilters },
      );
  let scored: Array<{ entry: WikiEntry; score: number }>;
  let embeddingUsed: boolean;
  let embeddingDocs: number;

  if (!readOnlyProbe
    && daemonResult?.ok
    && daemonResult.results
    && (!hasFacet || daemonResult.filtersApplied === true)) {
    scored = daemonResult.results;
    embeddingUsed = daemonResult.embeddingUsed ?? false;
    embeddingDocs = daemonResult.embeddingDocs ?? 0;
  } else {
    // Daemon unavailable — use BM25-only to avoid ONNX cold-start (~1800ms).
    // Spawn daemon in background so future searches get embedding.
    if (!readOnlyProbe && daemonResult === null && !_daemonFallbackNoted && readDaemonInfo(workflowRoot)) {
      _daemonFallbackNoted = true;
      console.error('Note: search daemon unreachable — falling back to BM25-only (embedding disabled)');
    }
    const indexer = await getIndexer(executionMode);
    const result = await indexer.searchWithMeta(
      q,
      candidateLimit,
      { skipEmbedding: true, filters: searchFilters },
    );
    scored = result.results;
    embeddingUsed = result.embeddingUsed;
    embeddingDocs = result.embeddingDocs;
    if (!readOnlyProbe) {
      opts.evidenceRecorder?.({
        event: 'daemon-start',
        site: 'runUnifiedSearch.spawnDaemon',
        queryId: opts.evidenceQueryId ?? null,
      });
      spawnDaemon(workflowRoot).catch(() => {});
    }
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
  // Tags are lowercased at parse time — normalize user input to match (G-C10).
  const tag = opts.tag?.toLowerCase();
  if (tag) {
    filtered = filtered.filter(r => r.entry.tags.includes(tag));
  }
  if (opts.kind) {
    filtered = filtered.filter(r =>
      Array.isArray(r.entry.ext?.kinds) && r.entry.ext.kinds.includes(opts.kind),
    );
  }
  if (opts.keyword) {
    const kw = opts.keyword.toLowerCase();
    filtered = filtered.filter(r =>
      r.entry.title.toLowerCase().includes(kw) ||
      r.entry.body.toLowerCase().includes(kw),
    );
  }
  if (opts.workspace) {
    filtered = filtered.filter(r => r.entry.source.workspace === opts.workspace);
  }
  // Superseded entries are hidden by default — preserved in the chain, out of the way.
  if (!opts.includeDeprecated) {
    filtered = filtered.filter(r => !isDeprecatedKnowledgeEntry(r.entry));
  }

  // CATEGORY_CAPS only when user didn't explicitly select a wiki facet.
  const applyCaps = !opts.type && !opts.category && !opts.tag && !opts.kind && !opts.keyword;
  let impressions: Map<string, number> | undefined;
  const explorationLimit = Math.min(limit, opts.explorationLimit ?? limit);
  const explorationPossible = explorationLimit >= 4
    && buildWikiCandidatePool(filtered, applyCaps).length > explorationLimit;
  if (!readOnlyProbe
    && explorationPossible
    && (opts.diversity ?? 'balanced') === 'balanced'
    // Avoid loading the SQLite/KG module graph when no usage store exists.
    && existsSync(resolve('.workflow', 'kg', 'maestro.db'))) {
    try {
      const { readKnowledgeUsageSignals } = await import('../graph/kg/knowledge-usage.js');
      const signals = readKnowledgeUsageSignals(
        resolve('.'),
        filtered.map(candidate => ({
          id: candidate.entry.id,
          sourceRef: candidate.entry.sourceRef,
        })),
      );
      impressions = new Map(
        [...signals.entries()].map(([id, signal]) => [id, signal.impressions]),
      );
    } catch {
      // Missing/corrupt usage signals disable exploration, never search.
    }
  }
  const deduped = selectDiverseWikiCandidates(filtered, {
    limit,
    applyCaps,
    diversity: opts.diversity,
    impressions,
    explorationLimit,
  });
  _lastSearchMeta = {
    embeddingUsed,
    embeddingDocs,
    diversityApplied: (opts.diversity ?? 'balanced') === 'balanced',
    explorationUsed: deduped.some(candidate => candidate.selectionReason === 'exploration'),
  };

  const maxScore = deduped.length > 0 ? deduped[0].score : 1;
  const results = deduped.map(({ entry, score, selectionReason }) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    category: entry.category,
    summary: entry.summary,
    score: maxScore > 0 ? score / maxScore : score,
    snippet: extractSnippet(entry.body, q),
    source: entry.source,
    sourceRef: entry.sourceRef,
    workspace: entry.source.workspace,
    confidence: (entry.ext?.confidence as string) || undefined,
    selectionReason,
    ...sessionTopology(entry),
  }));

  // Async impression increment (best-effort, never blocks). A returned result
  // is exposure, not evidence that the caller opened or used the knowledge.
  if (!readOnlyProbe && !opts.deferImpressions && results.length > 0) {
    incrementSearchHitsAsync(
      results.map(result => ({ id: result.id, sourceRef: result.sourceRef })),
      opts.evidenceRecorder,
      opts.evidenceQueryId ?? null,
      [q],
    );
  }

  return results;
}

/** Session/Run topology fields for run-mode entries; empty for everything else. */
function sessionTopology(entry: WikiEntry): Pick<SearchResult, 'sessionId' | 'runId' | 'runCount' | 'related'> {
  const virtualKind = entry.ext?.virtualKind;
  if (virtualKind !== 'session' && virtualKind !== 'session-run') return {};
  return {
    sessionId: typeof entry.ext?.sessionId === 'string' ? entry.ext.sessionId : undefined,
    runId: typeof entry.ext?.runId === 'string' ? entry.ext.runId : undefined,
    runCount: typeof entry.ext?.runCount === 'number' ? entry.ext.runCount : undefined,
    related: entry.related.length > 0 ? entry.related : undefined,
  };
}

function incrementSearchHitsAsync(
  entries: Array<{ id: string; sourceRef?: string | null }>,
  evidenceRecorder?: (event: SearchEvidenceEvent) => void,
  queryId: string | null = null,
  contexts: string[] = [],
): void {
  const projectRoot = resolve('.');
  Promise.all([
    import('../graph/kg/engine.js'),
    import('../graph/kg/credibility.js'),
    import('../graph/kg/db/types.js'),
  ]).then(([{ MaestroGraph }, { CredibilityStore, wikiIdToNodeId }, { validateNodeId }]) => {
    if (!MaestroGraph.isInitialized(projectRoot)) return;
    const mg = MaestroGraph.openSync(projectRoot);
    if (!mg) return;
    try {
      const store = new CredibilityStore(mg.rawDb);
      const candidateIds = entries.map(entry =>
        entry.sourceRef && validateNodeId(entry.sourceRef)
          ? entry.sourceRef
          : wikiIdToNodeId(entry.id)
      ).filter(Boolean) as string[];
      const existingIds = [...mg.getQueryBuilder().getNodesByIds(candidateIds).keys()];
      if (existingIds.length === 0) return;
      evidenceRecorder?.({
        event: 'credibility-hit-write',
        site: 'incrementSearchHitsAsync.incrementSearchHits',
        queryId,
      });
      mg.getConnection().transaction(() => store.incrementImpressions(existingIds));
      // 搜索用量同步写入 learning 统计（高频知识面板数据源），best-effort
      recordSearchUsage(projectRoot, { success: true, contexts });
    } finally {
      mg.close();
    }
  }).catch(() => {});
}

/** A KG unified search result from MaestroGraph. */
export interface KgSearchResult {
  /** Canonical ID accepted by `maestro load` when one exists. */
  id: string;
  /** Stable MaestroGraph identity used for graph traversal and usage attribution. */
  graphId: string;
  /** Backward-compatible identities accepted as aliases by callers. */
  aliases: string[];
  sourceType: string;
  kind: string;
  name: string;
  definition: string;
  filePath: string;
  score: number;
  category: string;
  status: string;
  selectionReason: 'relevance' | 'diversity';
}

export interface KgSearchOptions {
  type?: string;
  codeOnly?: boolean;
  category?: string;
  includeDeprecated?: boolean;
  diversity?: 'balanced' | 'off';
}

function kgSourceTypes(type: string | undefined): SourceType[] | undefined {
  switch (type) {
    case undefined: return undefined;
    case 'spec': return ['spec'];
    case 'knowhow': return ['knowhow'];
    case 'issue': return ['issue'];
    case 'domain': return ['domain'];
    case 'project':
    case 'roadmap':
    case 'note':
      return ['codebase'];
    case 'session':
    case 'scratch':
      return [];
    default:
      return undefined;
  }
}

function slugifyKnowledgeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function canonicalKgId(
  sourceType: string,
  graphId: string,
  filePath: string,
  projectRoot: string,
): string {
  if (sourceType === 'knowhow' && filePath) {
    return knowhowFileToWikiId(basename(filePath));
  }
  if (sourceType === 'spec' && filePath) {
    if (graphId.startsWith('spec:project:')) return graphId;
    const normalizedFile = resolve(filePath).replace(/\\/g, '/').toLowerCase();
    const projectSpecs = resolve(projectRoot, '.workflow', 'specs').replace(/\\/g, '/').toLowerCase();
    if (normalizedFile.startsWith(`${projectSpecs}/`)) {
      return `spec:project:${slugifyKnowledgeId(basename(filePath, extname(filePath)))}`;
    }
  }
  if (sourceType === 'issue' && graphId.startsWith('issue:')) {
    return `issue-${graphId.slice('issue:'.length)}`;
  }
  if (sourceType === 'domain' && graphId.startsWith('domain:')) {
    return `domain-${graphId.slice('domain:'.length)}`;
  }
  return graphId;
}

function kgFamilyKey(result: KgSearchResult): string {
  if (result.sourceType === 'spec' || result.sourceType === 'knowhow') {
    return `${result.sourceType}:${resolve(result.filePath).replace(/\\/g, '/').toLowerCase()}`;
  }
  if (result.sourceType === 'codegraph') {
    return `code:${resolve(result.filePath).replace(/\\/g, '/').toLowerCase()}`;
  }
  return result.id;
}

export function selectDiverseKgResults(
  candidates: KgSearchResult[],
  limit: number,
  diversity: 'balanced' | 'off' = 'balanced',
): KgSearchResult[] {
  const boundedLimit = Math.max(0, limit);
  if (boundedLimit === 0) return [];
  if (diversity === 'off') {
    return candidates.slice(0, boundedLimit).map((candidate, index) => ({
      ...candidate,
      selectionReason: index === 0 ? 'relevance' : 'diversity',
    }));
  }

  const selected: KgSearchResult[] = [];
  const selectedGraphIds = new Set<string>();
  const familyCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const sourceCap = Math.max(1, Math.ceil(boundedLimit / 2));
  const take = (candidate: KgSearchResult, enforceSourceCap: boolean, familyCap: number): boolean => {
    if (selectedGraphIds.has(candidate.graphId)) return false;
    const family = kgFamilyKey(candidate);
    if ((familyCounts.get(family) ?? 0) >= familyCap) return false;
    if (enforceSourceCap && (sourceCounts.get(candidate.sourceType) ?? 0) >= sourceCap) return false;
    selected.push({
      ...candidate,
      selectionReason: selected.length === 0 ? 'relevance' : 'diversity',
    });
    selectedGraphIds.add(candidate.graphId);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    sourceCounts.set(candidate.sourceType, (sourceCounts.get(candidate.sourceType) ?? 0) + 1);
    return true;
  };

  for (const candidate of candidates) {
    take(candidate, true, 1);
    if (selected.length >= boundedLimit) return selected;
  }
  for (const candidate of candidates) {
    take(candidate, false, 1);
    if (selected.length >= boundedLimit) return selected;
  }
  for (const candidate of candidates) {
    take(candidate, false, 2);
    if (selected.length >= boundedLimit) return selected;
  }
  return selected;
}

export async function runKgSearch(
  q: string,
  limit: number,
  recordImpressions: boolean = true,
  projectRoot: string = resolve('.'),
  options: KgSearchOptions = {},
): Promise<{ results: KgSearchResult[]; summary: Record<string, number> }> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(projectRoot)) return { results: [], summary: {} };
    const sourceTypes = options.codeOnly ? ['codegraph'] as SourceType[] : kgSourceTypes(options.type);
    if (sourceTypes?.length === 0) return { results: [], summary: {} };
    const mg = recordImpressions
      ? await MaestroGraph.open(projectRoot)
      : await MaestroGraph.openReadOnly(projectRoot);
    try {
      const candidateLimit = Math.min(500, Math.max(limit * 4, 40));
      const includeCode = !sourceTypes || sourceTypes.includes('codegraph');
      const includeKnowledge = !sourceTypes || sourceTypes.some(sourceType => sourceType !== 'codegraph');
      const output = mg.searchUnified(q, {
        limit: candidateLimit,
        sourceTypes,
        includeCode,
        includeKnowledge,
      });
      const candidates: KgSearchResult[] = output.directMatches.map(r => {
        const id = canonicalKgId(r.node.sourceType, r.node.id, r.node.filePath, projectRoot);
        return {
        id,
        graphId: r.node.id,
        aliases: id === r.node.id ? [] : [r.node.id],
        sourceType: r.node.sourceType,
        kind: r.node.kind,
        name: r.node.name,
        definition: r.node.definition?.substring(0, 120) || '',
        filePath: r.node.filePath,
        score: r.score,
        category: r.node.category,
        status: r.node.status,
        selectionReason: 'diversity' as const,
      };
      }).filter(result =>
        (!sourceTypes || sourceTypes.includes(result.sourceType as SourceType))
        &&
        (!options.category || result.category === options.category)
        && (options.includeDeprecated || result.status !== 'deprecated')
      );
      const results = selectDiverseKgResults(
        candidates,
        limit,
        options.diversity ?? 'balanced',
      );
      if (recordImpressions && results.length > 0) {
        try {
          const { CredibilityStore } = await import('../graph/kg/credibility.js');
          const store = new CredibilityStore(mg.rawDb);
          const knowledgeIds = results
            .filter(result => result.sourceType !== 'codegraph')
            .map(result => result.graphId);
          const existingIds = [...mg.getQueryBuilder().getNodesByIds(knowledgeIds).keys()];
          mg.getConnection().transaction(() => store.incrementImpressions(existingIds));
          // 搜索用量同步写入 learning 统计（高频知识面板数据源），best-effort
          recordSearchUsage(projectRoot, { success: true, contexts: [q] });
        } catch (error) {
          if (process.env.MAESTRO_DEBUG === '1') {
            console.error(
              `[search] KG impression write failed: ${error instanceof Error ? error.message : error}`,
            );
          }
        }
      }
      const summary = {
        codeSymbols: results.filter(result => result.sourceType === 'codegraph').length,
        domainTerms: results.filter(result => result.sourceType === 'domain').length,
        specRules: results.filter(result => result.sourceType === 'spec').length,
        knowhowDocs: results.filter(result => result.sourceType === 'knowhow').length,
        total: results.length,
      };
      return { results, summary };
    } finally {
      mg.close();
    }
  } catch (e: unknown) {
    if (process.env.MAESTRO_DEBUG === '1') {
      console.error(`[search] KG search failed: ${e instanceof Error ? e.message : e}`);
    }
    return { results: [], summary: {} };
  }
}

/** Map raw FTS code nodes to the CLI result shape. */
function mapCodeNodes(nodes: Array<{ id: string; kind: string; name: string; filePath: string; startLine?: number; _bm25Score?: number; signature?: string }>): CodeSearchResult[] {
  return nodes.map(n => ({
    id: n.id,
    kind: n.kind,
    name: n.name,
    filePath: n.filePath,
    line: typeof n.startLine === 'number' && n.startLine > 0 ? n.startLine : null,
    score: typeof n._bm25Score === 'number' ? n._bm25Score : null,
    signature: n.signature || undefined,
  }));
}

/**
 * Search MaestroGraph for code nodes matching the query. Never throws —
 * a degraded index is reported via `status` so callers can surface a hint.
 *
 * Uses hybrid (vector + FTS fusion) search when the code embedding index is
 * available; degrades to FTS-only otherwise (G-C4).
 */
async function runLocalCodeSearch(
  q: string,
  limit: number,
  skipEmbedding: boolean | undefined,
  projectRoot: string,
  executionMode: SearchExecutionMode,
): Promise<CodeSearchOutcome> {
  try {
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    if (!MaestroGraph.isInitialized(projectRoot)) return { results: [], status: 'not-initialized' };
    const mg = executionMode === 'read-only-probe'
      ? await MaestroGraph.openReadOnly(projectRoot)
      : await MaestroGraph.open(projectRoot);
    try {
      let results: CodeSearchResult[] | null = null;
      if (!skipEmbedding && executionMode === 'default') {
        try {
          // sourceTypes: ['codegraph'] restricts the FTS side to code nodes.
          const hybrid = await mg.searchHybrid(q, { limit, sourceTypes: ['codegraph'] });
          results = hybrid.map(r => ({
            id: r.node.id,
            kind: r.node.kind,
            name: r.node.name,
            filePath: r.node.filePath,
            line: typeof r.node.startLine === 'number' && r.node.startLine > 0 ? r.node.startLine : null,
            score: typeof r.score === 'number' ? r.score : null,
            signature: r.node.signature || undefined,
          }));
        } catch { /* embedding path failed — fall back to FTS-only below */ }
      }
      if (results === null) {
        results = mapCodeNodes(mg.searchCode(q, { limit }));
      }
      if (results.length === 0) {
        const codeNodes = mg.getStats().nodesBySourceType['codegraph'] ?? 0;
        if (codeNodes === 0) return { results: [], status: 'empty' };
      }
      return { results, status: 'ok' };
    } finally {
      mg.close();
    }
  } catch (e: unknown) {
    if (process.env.MAESTRO_DEBUG === '1') {
      console.error(`[search] code search failed: ${e instanceof Error ? e.message : e}`);
    }
    return { results: [], status: 'error' };
  }
}

/**
 * 以确定性、单句柄生命周期搜索显式共享的 linked CodeGraph 数据库。
 * 每个数据库独立隔离。
 */
export async function runLinkedCodeSearch(
  q: string,
  limit: number,
  projectRoot: string = resolve('.'),
): Promise<LinkedCodeSearchOutcome> {
  const { MaestroGraph } = await import('../graph/kg/engine.js');
  const linkedWorkspaces = resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot))
    .filter(workspace => workspace.valid && workspace.share.includes('codebase'))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const results: CodeSearchResult[] = [];
  const failures: LinkedCodeSearchFailure[] = [];

  for (const workspace of linkedWorkspaces) {
    let graph: InstanceType<typeof MaestroGraph> | null = null;
    try {
      graph = await MaestroGraph.openReadOnly(workspace.resolvedPath);
      const workspaceFence = `linked:${workspace.name}`;
      results.push(...mapCodeNodes(graph.searchCode(q, { limit })).map(result => ({
        ...result,
        id: `ws:${workspace.name}:${result.id}`,
        workspace: workspace.name,
        workspaceFence,
      })));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ workspace: workspace.name, message });
      if (process.env.MAESTRO_DEBUG === '1') {
        console.error(`[search] linked code search failed for workspace "${workspace.name}": ${message}`);
      }
    } finally {
      graph?.close();
    }
  }

  return { results, failures };
}

export async function runCodeSearch(
  q: string,
  limit: number,
  skipEmbedding?: boolean,
  includeLinkedCode = false,
  projectRoot: string = resolve('.'),
  executionMode: SearchExecutionMode = 'default',
): Promise<CodeSearchOutcome> {
  const local = await runLocalCodeSearch(q, limit, skipEmbedding, projectRoot, executionMode);
  if (!includeLinkedCode) return local;

  const linked = await runLinkedCodeSearch(q, limit, projectRoot);
  const results = interleaveCodeProviders(local.results, linked.results, limit);
  return {
    results,
    status: results.length > 0 ? 'ok' : local.status,
    ...(linked.failures.length > 0 ? { linkedFailures: linked.failures } : {}),
  };
}

/**
 * 在互不校准 raw score 的 CodeGraph providers 之间按 ordinal 公平取样。
 * provider 顺序固定为 local，其后为 workspace name 升序的 linked groups。
 */
export function interleaveCodeProviders(
  localResults: CodeSearchResult[],
  linkedResults: CodeSearchResult[],
  limit: number,
): CodeSearchResult[] {
  const resultLimit = Math.max(0, Math.trunc(limit));
  if (resultLimit === 0) return [];

  const linkedByWorkspace = new Map<string, CodeSearchResult[]>();
  for (const result of linkedResults) {
    const workspace = result.workspace ?? '';
    const group = linkedByWorkspace.get(workspace) ?? [];
    group.push(result);
    linkedByWorkspace.set(workspace, group);
  }
  const providers = [
    localResults,
    ...[...linkedByWorkspace.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, results]) => results),
  ];

  const selected: CodeSearchResult[] = [];
  for (let ordinal = 0; selected.length < resultLimit; ordinal++) {
    let foundCandidate = false;
    for (const provider of providers) {
      const candidate = provider[ordinal];
      if (!candidate) continue;
      foundCandidate = true;
      selected.push(candidate);
      if (selected.length >= resultLimit) return selected;
    }
    if (!foundCandidate) break;
  }
  return selected;
}

export interface MixedSearchOutcome {
  candidateLimit: number;
  wikiResults: SearchResult[];
  codeOutcome: CodeSearchOutcome;
  templateResults: ScoredArchKbEntry[];
  results: MergedResult[];
}

export interface MixedSearchDependencies {
  wikiSearch: typeof runUnifiedSearch;
  codeSearch: typeof runCodeSearch;
  archKbSearch: typeof runArchKbSearch;
  merge: typeof mergeAndNormalize;
}

/** Search bundled architecture templates without touching the project index. */
export function runArchKbSearch(q: string, limit: number): ScoredArchKbEntry[] {
  return searchArchKb(q, { type: 'template', limit });
}

function hasDirectArchKbMatch(result: ScoredArchKbEntry, query: string): boolean {
  const queryTokens = tokenizeArchKb(query);
  if (queryTokens.length === 0) return false;
  const directText = [
    result.entry.title,
    result.entry.slug,
    result.entry.summary,
    ...result.entry.keywords,
  ].join(' ').toLowerCase();
  const directTokens = tokenizeArchKb(directText);
  // Mirror the scorer's substring + superstring semantics so plural/partial
  // matches (e.g. "workflows" vs "workflow", "payment,system") aren't dropped.
  return queryTokens.some(token =>
    directText.includes(token)
    || directTokens.some(dt => dt.includes(token) || token.includes(dt)),
  );
}

/**
 * 扩大 mixed 搜索的源内候选池，但只在 legacy rank fusion 后按用户 limit 截断。
 */
export async function runMixedSearch(
  q: string,
  options: UnifiedSearchOptions & { skipEmbedding?: boolean },
  dependencies: Partial<MixedSearchDependencies> = {},
): Promise<MixedSearchOutcome> {
  const limit = Math.min(500, options.limit > 0 ? Math.trunc(options.limit) : 20);
  const candidateLimit = Math.min(500, Math.max(limit * 3, 60));
  const wikiSearch = dependencies.wikiSearch ?? runUnifiedSearch;
  const codeSearch = dependencies.codeSearch ?? runCodeSearch;
  const archKbSearch = dependencies.archKbSearch ?? runArchKbSearch;
  const merge = dependencies.merge ?? mergeAndNormalize;
  const { includeLinkedCode = false, ...wikiOptions } = options;
  const executionMode = options.executionMode ?? 'default';

  const codePromise = executionMode === 'default'
    ? codeSearch(q, candidateLimit, options.skipEmbedding, includeLinkedCode)
    : codeSearch(
      q,
      candidateLimit,
      true,
      includeLinkedCode,
      resolve('.'),
      executionMode,
    );
  const templatePromise = !options.type
    && !options.category
    && !options.tag
    && !options.keyword
    && !options.workspace
    ? Promise.resolve(archKbSearch(q, candidateLimit)).then(results =>
      results.filter(result => hasDirectArchKbMatch(result, q)))
    : Promise.resolve([] as ScoredArchKbEntry[]);
  const [wikiResults, codeOutcome, templateResults] = await Promise.all([
    wikiSearch(q, {
      ...wikiOptions,
      limit: candidateLimit,
      executionMode,
      deferImpressions: dependencies.wikiSearch === undefined,
      explorationLimit: limit,
    }),
    codePromise,
    templatePromise,
  ]);
  const results = templateResults.length > 0
    ? merge(wikiResults, codeOutcome.results, limit, q, templateResults)
    : merge(wikiResults, codeOutcome.results, limit, q);

  if (executionMode === 'default' && dependencies.wikiSearch === undefined) {
    const exposedWiki = results
      .filter(result => result.source === 'wiki')
      .map(result => ({ id: result.id, sourceRef: result.sourceRef }));
    if (exposedWiki.length > 0) {
      incrementSearchHitsAsync(
        exposedWiki,
        options.evidenceRecorder,
        options.evidenceQueryId ?? null,
        [q],
      );
    }
  }

  return {
    candidateLimit,
    wikiResults,
    codeOutcome,
    templateResults,
    results,
  };
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query...>')
    .description('Unified knowledge search across wiki + code (mixed by default)')
    .option('--type <type>', `Filter by type: ${VALID_TYPES.join(', ')}`)
    .option('--category <cat>', 'Filter by category (e.g. coding, arch, debug, test, review, learning)')
    .option('--tag <tag>', 'Filter wiki entries by exact tag match (wiki only)')
    .option('--kind <kind>', 'Alias for --tag (deprecated)')
    .option('--code', 'Code graph results only (no wiki)')
    .option('--kg', 'KG unified search (MaestroGraph full-source)')
    .option('--wiki-only', 'Search wiki only, skip code results')
    .option('--workspace <name>', 'Filter results to a specific linked workspace')
    .option('--include-linked-code', 'Include explicitly shared linked CodeGraph results')
    .option('--read-only-probe', 'Run a hermetic no-daemon, no-persistence search probe')
    .option('--include-deprecated', 'Include superseded/deprecated knowledge entries (hidden by default)')
    .option('--no-emb', 'Skip embedding, use BM25 only')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Max results', '20')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      if (opts.workflowRoot && resolve(opts.workflowRoot) !== process.cwd()) {
        process.chdir(resolve(opts.workflowRoot));
      }
      const limit = Math.min(500, opts.limit > 0 ? Math.trunc(opts.limit) : 20);
      const resolvedTag = opts.tag ?? opts.kind;
      const wikiOnly = opts.wikiOnly === true || typeof resolvedTag === 'string';
      const codeOnly = opts.code === true;
      const kgMode = opts.kg === true;

      if (opts.type && !VALID_TYPES.includes(opts.type)) {
        console.error(`Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${opts.type}")`);
        process.exit(1);
      }
      if (opts.type === 'template' && (codeOnly || kgMode)) {
        console.error('Error: --type template is an Arch-KB source and cannot be combined with --code or --kg');
        process.exit(1);
      }
      if (resolvedTag && opts.code) {
        console.error('Error: --tag is a wiki facet and cannot be combined with --code');
        process.exit(1);
      }
      if (resolvedTag && kgMode) {
        console.error('Error: --tag is a wiki facet and cannot be combined with --kg');
        process.exit(1);
      }
      if (opts.workspace && kgMode) {
        console.error('Error: --workspace is not available in local --kg mode');
        process.exit(1);
      }

      const skipEmbedding = opts.emb === false;
      const isTTY = process.stdout.isTTY === true;
      const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const isDevelopmentQuery = /(?:\b(?:implement|implementation|develop|development|build|feature|refactor|fix|bug|api|class|function|code)\b|组件|开发|实现|功能|重构|修复|代码|接口)/i.test(q);
      const templateSearchCommand = `maestro arch-kb search ${JSON.stringify(q)} --type template`;
      const codeSearchCommand = `maestro search ${JSON.stringify(q)} --code`;

      // --type template: exact architecture-template search. This bypasses
      // project Wiki/CodeGraph providers but uses the same result contract.
      if (opts.type === 'template') {
        const templateResults = runArchKbSearch(q, limit);
        const merged = mergeAndNormalize([], [], limit, q, templateResults);
        const templateHint = `For exact template lookup, use: ${templateSearchCommand}`;
        if (opts.json) {
          console.log(JSON.stringify({
            query: q,
            wikiCount: 0,
            codeCount: 0,
            templateCount: merged.length,
            typeCounts: { template: merged.length },
            count: merged.length,
            results: merged,
          }, null, 2));
          return;
        }
        console.log(`Search: "${q}" (template ${merged.length} results)`);
        if (merged.length === 0) {
          console.log('  No matches found.');
          console.log(`  Hint: ${templateHint}`);
          return;
        }
        console.log(`  Hint: ${templateHint}`);
        for (const result of merged) {
          const name = isTTY ? highlightTerms(truncate(result.name, 60), qTerms) : truncate(result.name, 60);
          console.log(`  [arch-kb:template] [reference only; not current project]  ${name}  ${result.detail}  (${result.score.toFixed(4)})`);
          if (result.summary) console.log(`    ${result.summary}`);
        }
        return;
      }

      // --kg: MaestroGraph unified search
      if (kgMode) {
        const { results: kgResults, summary } = await runKgSearch(
          q,
          limit,
          opts.readOnlyProbe !== true,
          resolve('.'),
          {
            type: opts.type,
            codeOnly: opts.code === true,
            category: opts.category,
            includeDeprecated: opts.includeDeprecated === true,
          },
        );
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
          console.log(`  [${r.sourceType}:${r.kind}]  ${r.id}  ${name}${def}${scoreTag}`);
        }
        return;
      }

      const searchOptions = {
        type: opts.type,
        category: opts.category,
        tag: resolvedTag,
        workspace: opts.workspace,
        limit,
        skipEmbedding,
        includeLinkedCode: opts.includeLinkedCode === true,
        executionMode: opts.readOnlyProbe === true
          ? 'read-only-probe' as const
          : 'default' as const,
        includeDeprecated: opts.includeDeprecated === true,
      };
      let wikiResults: SearchResult[];
      let codeOutcome: CodeSearchOutcome;
      let mixedResults: MergedResult[] | null = null;

      if (!codeOnly && !wikiOnly) {
        const mixed = await runMixedSearch(q, searchOptions);
        wikiResults = mixed.wikiResults;
        codeOutcome = mixed.codeOutcome;
        mixedResults = mixed.results;
      } else {
        [wikiResults, codeOutcome] = await Promise.all([
          codeOnly ? [] : runUnifiedSearch(q, searchOptions),
          wikiOnly
            ? { results: [], status: 'ok' as CodeIndexStatus }
            : runCodeSearch(
              q,
              limit,
              skipEmbedding,
              opts.includeLinkedCode === true,
              resolve('.'),
              searchOptions.executionMode,
            ),
        ]);
      }
      const codeResults = codeOutcome.results;
      const codeHint = wikiOnly ? null : codeIndexHint(codeOutcome.status);

      const meta = getLastSearchMeta();
      const embTag = meta.embeddingUsed ? `+emb(${meta.embeddingDocs})` : 'bm25';

      // --code: code graph results only
      if (codeOnly) {
        if (opts.json) {
          console.log(JSON.stringify({
            query: q,
            count: codeResults.length,
            codeIndex: codeOutcome.status,
            ...(codeHint ? { hint: codeHint } : {}),
            results: codeResults,
          }, null, 2));
          return;
        }
        console.log(`Search: "${q}" (code ${codeResults.length}, ${embTag})`);
        if (codeResults.length === 0) {
          console.log('  No matches found.');
          if (codeHint) console.log(`  Hint: ${codeHint}`);
          return;
        }
        for (const r of codeResults) {
          printCodeResult(r, '  ', isTTY, qTerms);
        }
        return;
      }

      // Default / --all / --wiki-only: mixed interleaved results
      const merged = mixedResults ?? mergeAndNormalize(wikiResults, codeResults, limit, q);
      const wikiCount = merged.filter(r => r.source === 'wiki').length;
      const codeCount = merged.filter(r => r.source === 'code').length;
      const templateCount = merged.filter(r => r.source === 'arch-kb').length;

      if (opts.json) {
        const typeCountsJson: Record<string, number> = {};
        for (const r of merged) {
          let dt: string;
          if (r.source === 'code') dt = 'code';
          else if (r.source === 'arch-kb') dt = 'template';
          else if (r.category === 'session') dt = 'session';
          else if (r.category === 'scratch') dt = 'scratch';
          else dt = r.kind;
          typeCountsJson[dt] = (typeCountsJson[dt] ?? 0) + 1;
        }
        console.log(JSON.stringify({
          query: q,
          wikiCount,
          codeCount,
          templateCount,
          codeIndex: codeOutcome.status,
          ...(codeHint ? { codeIndexHint: codeHint } : {}),
          typeCounts: typeCountsJson,
          count: merged.length,
          results: merged,
        }, null, 2));
        return;
      }

      // Per-type breakdown header
      const TYPE_DISPLAY_ORDER = ['spec', 'domain', 'knowhow', 'issue', 'project', 'roadmap', 'note', 'session', 'scratch', 'template', 'code'];
      const typeCounts = new Map<string, number>();
      for (const r of merged) {
        let displayType: string;
        if (r.source === 'code') displayType = 'code';
        else if (r.source === 'arch-kb') displayType = 'template';
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
      if (codeHint) console.log(`  Note: ${codeHint}`);

      if (qTerms.length > 4) {
        console.log(`  Hint: ${qTerms.length} terms — split into 1-3 keyword queries for better precision`);
      }
      if (isDevelopmentQuery && templateCount > 0) {
        console.log(`  Hint: Template results are reference-only and unrelated to current project content; for exact lookup use: ${templateSearchCommand}`);
      }
      if (isDevelopmentQuery && codeCount > 0) {
        console.log(`  Hint: For implementation symbols, use: ${codeSearchCommand}`);
      }

      if (merged.length === 0) {
        console.log('  No matches found.');
        return;
      }

      for (const r of merged) {
        const displayName = truncate(r.name, 60);
        const name = isTTY ? highlightTerms(displayName, qTerms) : displayName;
        const scoreTag = `  (${r.score.toFixed(4)})`;
        if (r.source === 'wiki') {
          const confBadge = r.confidence === 'contested' ? ' [CONTESTED]'
            : r.confidence === 'low' ? ' [LOW CONFIDENCE]'
            : '';
          const runsTag = r.runCount !== undefined ? `  runs:${r.runCount}` : '';
          console.log(`  [wiki:${r.kind}]  ${name}  ${r.detail}${runsTag}${confBadge}${scoreTag}`);
          const subtitle = pickSubtitle(r);
          if (subtitle) {
            const text = isTTY ? highlightTerms(subtitle, qTerms) : subtitle;
            console.log(`    ${text}`);
          }
        } else if (r.source === 'arch-kb') {
          console.log(`  [arch-kb:${r.kind}] [reference only; not current project]  ${name}  ${r.detail}${scoreTag}`);
          if (r.summary) console.log(`    ${r.summary}`);
        } else {
          const sigTag = r.signature ? `  ${truncate(r.signature, 60)}` : '';
          const workspaceTag = r.workspace ? `  @${r.workspace} (${r.workspaceFence})` : '';
          console.log(`  [code:${r.kind}]  ${name}  ${r.detail}${sigTag}${workspaceTag}${scoreTag}`);
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
        if (info && isDaemonInfoV2(info, workflowRoot)) {
          const health = await healthDaemon(workflowRoot, { timeoutMs: 1000 });
          if (isDaemonReadyResponse(health)) {
            console.log(`Search daemon already running (pid=${info.pid}, port=${info.port})`);
            return;
          }
          if (health?.ok && (health.state === 'starting' || health.state === 'draining')) {
            console.error(`Search daemon is ${health.state} (pid=${info.pid}); wait for that lifecycle transition before starting.`);
            process.exitCode = 1;
            return;
          }
        }
        if (info && isDaemonAlive(info)) {
          console.error(`Search daemon descriptor is stale/unverified (pid=${info.pid}); refusing to replace or kill it.`);
          process.exitCode = 1;
          return;
        }
        console.log('Starting search daemon...');
        const projectPath = process.cwd();
        const wsConfig = loadWorkspaceConfig(projectPath);
        const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
        const linkedWorkspaces = resolved
          .filter(lw => lw.valid)
          .map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
        try {
          const { startDaemon } = await import('../search/daemon.js');
          const { port } = await startDaemon(workflowRoot, { workflowRoot, linkedWorkspaces });
          console.log(`Search daemon started (pid=${process.pid}, port=${port})`);
        } catch (error: unknown) {
          console.error(`Search daemon failed to start: ${error instanceof Error ? error.message : error}`);
          process.exitCode = 1;
        }
        // The listening server keeps a successful foreground start alive.
        return;
      }

      if (action === 'stop') {
        const info = readDaemonInfo(workflowRoot);
        const stopped = await stopDaemon(workflowRoot);
        if (stopped) console.log('Search daemon stopped.');
        else if (info && !isDaemonInfoV2(info, workflowRoot)) {
          console.log('No verified daemon running (descriptor is stale/unverified).');
        } else console.log('No daemon running.');
        return;
      }

      if (action === 'status') {
        const info = readDaemonInfo(workflowRoot);
        if (!info) { console.log('Search daemon: not running'); return; }
        if (!isDaemonInfoV2(info, workflowRoot)) {
          console.log(`Search daemon: stale (unverified descriptor)  pid=${info.pid}  port=${info.port}  started=${info.startedAt}`);
          return;
        }
        const health = await healthDaemon(workflowRoot, { timeoutMs: 1000 });
        if (health?.ok) {
          const stateTag = health.state && health.state !== 'ready' ? ` (${health.state})` : '';
          console.log(`Search daemon: running${stateTag}  pid=${info.pid}  port=${info.port}  started=${info.startedAt}`);
        } else {
          const staleReason = isDaemonAlive(info) ? 'unreachable/unverified' : 'pid dead';
          console.log(`Search daemon: stale (${staleReason})  pid=${info.pid}  port=${info.port}  started=${info.startedAt}`);
        }
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
      } catch (error: unknown) {
        console.error(`Search daemon failed to start: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    });

  program
    .command('embedding')
    .description('Embedding model status, warmup, and rebuild')
    .argument('[action]', 'status (default), warmup, rebuild', 'status')
    .action(async (action: string) => {
      const workflowRoot = resolve('.workflow');
      const { isAvailable, getUnavailableReason, loadEmbeddingIndex, embedTexts, getDeviceSummary, detectDevice, setProgressCallback, DEFAULT_MODEL_ID, isApiMode, getModelId, loadEmbeddingApiConfig, isLocalModelPath, getLocalModelPath } = await import('#maestro-dashboard/wiki/embedding.js');

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
          if (isLocalModelPath()) {
            console.log(`Model: local → ${getLocalModelPath()}`);
          } else {
            console.log(`Model: ${DEFAULT_MODEL_ID} (~465 MB)`);
          }
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
            console.error(`  Cache dir: ~/.cache/huggingface/`);
            console.error(`  If download is slow, set HTTPS_PROXY or configure API mode: ~/.maestro/api-embedding.json`);
            console.error(`  Or use local model folder: ~/.maestro/local-embedding.json or MAESTRO_EMBEDDING_MODEL_PATH`);
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
        const { embeddingUsed, embeddingDocs } = await indexer.searchWithMeta('warmup', 1);
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
  const workspaceTag = r.workspace ? `  @${r.workspace} (${r.workspaceFence})` : '';
  console.log(`${indent}[${r.kind}] ${name}  ${codeLocation(r)}${sigTag}${workspaceTag}${scoreTag}`);
}

/** file:line reference — directly consumable by Read/editor jumps. */
function codeLocation(r: CodeSearchResult): string {
  return r.line !== null ? `${r.filePath}:${r.line}` : r.filePath;
}

// ── Multi-signal score normalization ────────────────────────────────
// Three-layer scoring:
//   1. Source-level boost (wiki type / code kind)
//   2. Name-match bonus for code results (exact > prefix > contains)
//   3. Dynamic source weight based on query type (identifier → boost code)
//   4. Rank-based normalization (position-aware, handles ties)

export interface MergedResult {
  source: 'wiki' | 'code' | 'arch-kb';
  /** Stable entry id — usable with `maestro load --id`. */
  id: string;
  sourceRef?: string | null;
  kind: string;
  name: string;
  detail: string;
  /** Interleave ordering value — rank-normalized position × source weight. */
  rank: number;
  /** Real normalized relevance within the source (finalScore / source max, 0..1). */
  score: number;
  snippet?: string;
  summary?: string;
  signature?: string;
  workspace?: string;
  workspaceFence?: string;
  category?: string;
  confidence?: string;
  /** Dedicated command for opening an Arch-KB result. */
  openCommand?: string;
  /** Dedicated command for exact template search. */
  searchCommand?: string;
  /** Arch-KB entries are reference material, never current-project facts. */
  referenceOnly?: boolean;
  projectRelated?: boolean;
  /** Session/Run topology — present only on run-mode session and run entries. */
  sessionId?: string;
  runId?: string;
  runCount?: number;
  related?: string[];
  selectionReason?: 'relevance' | 'diversity' | 'exploration';
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
  if (/\s/.test(trimmed)) return false;
  if (/^[a-z]+[A-Z]/.test(trimmed)) return true;
  if (/^[A-Z][a-z]+[A-Z]/.test(trimmed)) return true;
  if (/^[A-Z]{2,}[a-z]/.test(trimmed)) return true;
  if (/^[a-z]+_[a-z]+/.test(trimmed)) return true;
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

export function mergeAndNormalize(
  wiki: SearchResult[],
  code: CodeSearchResult[],
  limit: number,
  query?: string,
  templateResults: ScoredArchKbEntry[] = [],
): MergedResult[] {
  const q = query ?? '';
  const isIdQuery = isCodeIdentifier(q);
  const hasStrongCodeMatch = code.length > 0 && code.some(r =>
    codeNameMatchBonus(r.name, q) >= 15,
  );
  const WIKI_WEIGHT = isIdQuery ? 0.4 : hasStrongCodeMatch ? 0.5 : 0.6;
  const CODE_WEIGHT = isIdQuery ? 0.6 : hasStrongCodeMatch ? 0.5 : 0.4;

  const codeNames = new Set(code.map(r => r.name.toLowerCase()));

  const CONFIDENCE_PENALTY: Record<string, number> = {
    contested: 0.5,
    low: 0.7,
  };

  const wikiScored = wiki.map((r, i) => {
    const raw = r.score ?? 0;
    let typeBoost = WIKI_TYPE_BOOST[r.type] ?? 1.0;
    if (r.id.startsWith('kg-') && codeNames.has(r.title.toLowerCase())) {
      typeBoost *= 0.7;
    }
    const confPenalty = r.confidence ? (CONFIDENCE_PENALTY[r.confidence] ?? 1.0) : 1.0;
    return { ...r, finalScore: raw * typeBoost * confPenalty, index: i };
  });

  const codeScored = code.map((r, i) => {
    const raw = r.score ?? 0;
    const kindBoost = CODE_KIND_BOOST[r.kind] ?? 1.0;
    const nameBonus = codeNameMatchBonus(r.name, q);
    return { ...r, finalScore: raw * kindBoost + nameBonus, index: i };
  });

  const wikiRanks = rankNormalize(wikiScored.map(r => ({ index: r.index, score: r.finalScore })));
  const codeRanks = rankNormalize(codeScored.map(r => ({ index: r.index, score: r.finalScore })));
  const templateScored = templateResults.map((result, index) => ({
    ...result,
    finalScore: result.score,
    index,
  }));
  const templateRanks = rankNormalize(templateScored.map(r => ({ index: r.index, score: r.finalScore })));

  // Arch-KB is useful context, but generic Search should keep project knowledge
  // and code symbols ahead of it whenever those sources have strong matches.
  const ARCH_KB_WEIGHT = 0.15;

  // Rank decides interleave order only; the displayed score is the real
  // per-source normalized relevance (preserves contested/kg-dedup penalties) — X4.
  const maxWikiFinal = wikiScored.reduce((m, r) => Math.max(m, r.finalScore), 0);
  const maxCodeFinal = codeScored.reduce((m, r) => Math.max(m, r.finalScore), 0);
  const maxTemplateFinal = templateScored.reduce((m, r) => Math.max(m, r.finalScore), 0);

  const merged: MergedResult[] = [];
  for (let i = 0; i < wikiScored.length; i++) {
    const r = wikiScored[i];
    merged.push({
      source: 'wiki',
      id: r.id,
      sourceRef: r.sourceRef,
      kind: r.type,
      name: r.title,
      detail: r.category ? `${r.category}  ${r.id}` : r.id,
      rank: wikiRanks[i] * WIKI_WEIGHT,
      score: maxWikiFinal > 0 ? r.finalScore / maxWikiFinal : 0,
      snippet: r.snippet ?? undefined,
      summary: r.summary || undefined,
      category: r.category ?? undefined,
      confidence: r.confidence,
      sessionId: r.sessionId,
      runId: r.runId,
      runCount: r.runCount,
      related: r.related,
      selectionReason: r.selectionReason,
    });
  }
  for (let i = 0; i < codeScored.length; i++) {
    const r = codeScored[i];
    merged.push({
      source: 'code',
      id: r.id,
      kind: r.kind,
      name: r.name,
      detail: codeLocation(r),
      rank: codeRanks[i] * CODE_WEIGHT,
      score: maxCodeFinal > 0 ? r.finalScore / maxCodeFinal : 0,
      signature: r.signature,
      workspace: r.workspace,
      workspaceFence: r.workspaceFence,
    });
  }
  for (let i = 0; i < templateScored.length; i++) {
    const r = templateScored[i];
    merged.push({
      source: 'arch-kb',
      id: r.entry.id,
      sourceRef: r.entry.path,
      kind: r.entry.type,
      name: r.entry.title,
      detail: `${r.entry.path}  (maestro arch-kb show ${r.entry.id})`,
      rank: templateRanks[i] * ARCH_KB_WEIGHT,
      score: maxTemplateFinal > 0 ? r.finalScore / maxTemplateFinal : 0,
      summary: r.entry.summary || undefined,
      category: 'arch-kb',
      openCommand: `maestro arch-kb show ${r.entry.id}`,
      searchCommand: `maestro arch-kb search ${JSON.stringify(q)} --type template`,
      referenceOnly: true,
      projectRelated: false,
    });
  }

  merged.sort((a, b) => {
    const rankOrder = b.rank - a.rank;
    if (rankOrder !== 0) return rankOrder;
    if (a.source !== b.source) {
      const sourceOrder: Record<MergedResult['source'], number> = { wiki: 0, code: 1, 'arch-kb': 2 };
      return sourceOrder[a.source] - sourceOrder[b.source];
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const finalResults = merged.slice(0, limit);
  const explorer = merged.find(result =>
    result.source === 'wiki' && result.selectionReason === 'exploration'
  );
  if (explorer && !finalResults.some(result => result.id === explorer.id) && finalResults.length > 0) {
    let replaceIndex = -1;
    for (let index = finalResults.length - 1; index >= 0; index--) {
      if (finalResults[index].source === 'wiki') {
        replaceIndex = index;
        break;
      }
    }
    finalResults[replaceIndex >= 0 ? replaceIndex : finalResults.length - 1] = explorer;
  }
  return finalResults;
}
