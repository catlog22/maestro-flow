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
import { isRepositoryApplicable } from '../repository/applicability.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { resolveRepositoryContext, type RepositoryContext } from '../repository/context.js';
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
import {
  boundedSearchDiagnostics,
  createSearchDiagnostics,
  finishSearchDiagnostics,
  withSearchDiagnosticPhase,
  type SearchDiagnosticsContext,
  type SearchDiagnostics,
} from '../search/diagnostics.js';
import {
  computeSearchCandidateBudget,
  escalateSearchCandidateBudget,
  shouldEscalateSearchCandidateBudget,
  isAdaptiveSearchBudgetEnabled,
  type SearchCandidateBudget,
  type SearchCandidateCounts,
} from '../search/candidate-budget.js';
import { runExactSearch, type ExactSearchOutcome } from '../search/exact-search.js';

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
  /** Provider-observed authorization metadata (when exposed by the source). */
  authorized?: boolean;
  /** Provider-observed lifecycle status (when exposed by the source). */
  status?: string;
  /** Provider-observed provenance (when exposed by the source). */
  provenance?: { source: string; path: string } | null;
  repoId?: string | null;
  repoName?: string;
  alias?: string;
  workspaceFence?: string;
  appliesToRepoIds?: string[] | null;
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
  /** Provider-observed authorization metadata (when exposed by the source). */
  authorized?: boolean;
  /** Provider-observed lifecycle status (when exposed by the source). */
  status?: string;
  /** Provider-observed provenance (when exposed by the source). */
  provenance?: { source: string; path: string } | null;
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
  /** Human-facing target repository selector. Explicit selection also filters origin. */
  repo?: string;
  /** Pre-resolved target used by host-owned callers. */
  targetRepository?: RepositoryContext;
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
  /** Optional request-local diagnostics collector; omitted on hot paths. */
  diagnostics?: SearchDiagnosticsContext;
  /** One request-bound candidate budget; adaptive mode is opt-in. */
  candidateBudget?: SearchCandidateBudget;
}

// ── Lazy offline client ────────────────────────────────────────────────

interface CachedWikiIndexer {
  workflowRoot: string;
  configKey: string;
  indexer: InstanceType<typeof import('#maestro-dashboard/wiki/wiki-indexer.js').WikiIndexer>;
}

let _indexer: CachedWikiIndexer | null = null;
let _probeIndexer: CachedWikiIndexer | null = null;

function toLinkedWikiConfig(link: ReturnType<typeof resolveWorkspaceLinks>[number]) {
  return {
    name: link.name,
    workflowRoot: link.workflowRoot,
    shareTypes: link.share,
    repoId: link.repoId,
    repoName: link.repoName,
    workspaceFence: link.repoId ? `repo:${link.repoId}` : `linked:${link.name}`,
  };
}

function currentWikiRepository(current: RepositoryContext) {
  return {
    repoId: current.repoId,
    repoName: current.repoName,
    alias: current.alias,
    // Legacy repositories without a manifest have no stable identity fence.
    // Do not serialize the alias/path sentinel as if it were an identity.
    workspaceFence: current.repoId ? `repo:${current.repoId}` : undefined,
  };
}

function resolveWikiAuthority(current: RepositoryContext) {
  const linkedWorkspaces = resolveWorkspaceLinks(
    current.projectRoot,
    loadWorkspaceConfig(current.projectRoot),
  )
    .filter(lw => lw.valid)
    .map(toLinkedWikiConfig);
  const repository = currentWikiRepository(current);
  return {
    linkedWorkspaces,
    repository,
    configKey: JSON.stringify({ linkedWorkspaces, repository }),
  };
}

async function getIndexer(
  executionMode: SearchExecutionMode = 'default',
  resolvedCurrent?: RepositoryContext,
): Promise<WikiIndexer> {
  const current = resolvedCurrent ?? resolveRepositoryContext('current', { projectRoot: process.cwd() });
  const workflowRoot = current.workflowRoot;
  const { linkedWorkspaces, repository, configKey } = resolveWikiAuthority(current);
  // Re-key on the effective linked authority, not just the local path. A
  // resident in-process indexer must not retain entries after sharing is
  // revoked or a linked identity/path changes.
  const cached = executionMode === 'read-only-probe' ? _probeIndexer : _indexer;
  if (!cached || cached.workflowRoot !== workflowRoot || cached.configKey !== configKey) {
    if (cached) await cached.indexer.close();
    const { WikiIndexer: Cls } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    const replacement: CachedWikiIndexer = {
      workflowRoot,
      configKey,
      indexer: new Cls({
        workflowRoot,
        linkedWorkspaces,
        repository,
        // The resident daemon is the sole persistent-cache publisher. A
        // short-lived fallback may consume an existing cache and preserve the
        // full source corpus, but must not keep the CLI alive to republish it.
        role: executionMode === 'read-only-probe' ? 'hermetic' : 'reader',
      }),
    };
    if (executionMode === 'read-only-probe') _probeIndexer = replacement;
    else _indexer = replacement;
    return replacement.indexer;
  }
  return cached.indexer;
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
// Semantic searches obtain a BM25 safety net before spending their bounded
// inference budget; BM25 remains the low-latency default for the CLI.
const DAEMON_SEMANTIC_BUDGET_MS = 600;
const DAEMON_BM25_BUDGET_MS = 1_000;

function recordCandidateBudgetDiagnostics(
  diagnostics: SearchDiagnosticsContext | undefined,
  budget: SearchCandidateBudget | undefined,
): void {
  if (!diagnostics || !budget) return;
  diagnostics.setCandidateBudget?.({
    mode: budget.mode,
    requestedLimit: budget.resultLimit,
    initialCandidateLimit: budget.initialCandidateLimit,
    candidateLimit: budget.candidateLimit,
    hardCap: budget.maxCandidateLimit,
    escalated: budget.escalated,
    legacyCandidateLimit: budget.legacyCandidateLimit,
  });
}

function daemonFailureReason(
  result: Awaited<ReturnType<typeof tryDaemonSearch>>,
  workflowRoot: string,
): string {
  if (result?.ok === false) {
    const error = result.error?.toLowerCase() ?? '';
    if (error.includes('too many')) return 'capacity';
    if (error.includes('authority')) return 'authority-mismatch';
    if (error.includes('identity')) return 'identity-mismatch';
    if (error.includes('starting')) return 'starting';
    if (error.includes('draining')) return 'draining';
    return 'rejected';
  }
  const info = readDaemonInfo(workflowRoot);
  if (!info) return 'descriptor-absent';
  if (!isDaemonInfoV2(info, workflowRoot) || !isDaemonAlive(info)) return 'descriptor-unavailable';
  return 'unreachable';
}

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
  const diagnostics = opts.diagnostics;
  const repositoryStartedAt = performance.now();
  const currentRepository = resolveRepositoryContext('current', { projectRoot: process.cwd() });
  const targetRepository = opts.targetRepository ?? (opts.repo
    ? resolveRepositoryContext(opts.repo, { projectRoot: currentRepository.projectRoot })
    : currentRepository);
  diagnostics?.recordPhase('repository-context', performance.now() - repositoryStartedAt);
  const explicitRepository = Boolean(opts.repo || opts.targetRepository);
  const applicableRepoId = targetRepository?.repoId ?? '__legacy__';
  const limit = Math.min(500, opts.limit > 0 ? Math.trunc(opts.limit) : 20);
  const executionMode = opts.executionMode ?? 'default';
  const readOnlyProbe = executionMode === 'read-only-probe';
  const filters: WikiSearchFilters = {
    ...(opts.type ? { type: opts.type as WikiSearchFilters['type'] } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.tag ? { tag: opts.tag.toLowerCase() } : {}),
    ...(opts.keyword ? { keyword: opts.keyword } : {}),
    ...(opts.workspace ? { workspace: opts.workspace } : {}),
    ...(explicitRepository && targetRepository?.repoId ? { repoId: targetRepository.repoId } : {}),
    ...(explicitRepository && !targetRepository?.repoId && targetRepository
      ? { repoAlias: targetRepository.alias }
      : {}),
    applicableRepoId,
    includeDeprecated: opts.includeDeprecated === true,
  };
  // Applicability is always a pre-ranking filter, even with no user facet.
  const hasFacet = true;
  const searchFilters = filters;
  // Filters are applied inside BM25/vector candidate generation.  Legacy
  // callers retain the current provider overfetch; adaptive callers receive
  // one boundary-computed budget and never multiply it downstream.
  const boundaryBudget = opts.candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'wiki', mode: 'adaptive' })
      : undefined);
  const adaptiveBudget = boundaryBudget?.adaptive ? boundaryBudget : undefined;
  const candidateLimit = adaptiveBudget?.candidateLimit
    ?? Math.min(500, Math.max(limit * 2, 40));
  recordCandidateBudgetDiagnostics(diagnostics, boundaryBudget);
  diagnostics?.setCandidateCount(candidateLimit);

  // Try daemon first (warm ONNX model, no cold-start penalty)
  const workflowRoot = currentRepository.workflowRoot;
  const authorityStartedAt = performance.now();
  const { configKey: authorityKey } = resolveWikiAuthority(currentRepository);
  diagnostics?.recordPhase('authority', performance.now() - authorityStartedAt);
  if (!readOnlyProbe) {
    opts.evidenceRecorder?.({
      event: 'daemon-lookup',
      site: 'runUnifiedSearch.tryDaemonSearch',
      queryId: opts.evidenceQueryId ?? null,
    });
  }
  let daemonResult: Awaited<ReturnType<typeof tryDaemonSearch>> = null;
  let daemonFailureObserved = false;
  const noteDaemonFailure = (reason: string): void => {
    daemonFailureObserved = true;
    diagnostics?.recordFallback('daemon', reason);
  };
  const daemonResultUsable = (result: typeof daemonResult): boolean => Boolean(
    result?.ok === true
    && Array.isArray(result.results)
    // A diagnostics-enabled caller can consume a pre-diagnostics daemon
    // response that lacks the optional filter marker; ordinary callers retain
    // the stricter filter contract.
    && (!hasFacet || result.filtersApplied === true || (diagnostics && result.filtersApplied === undefined)),
  );
  if (!readOnlyProbe) {
    // BM25 is both the default path and the semantic safety net. Establish a
    // fast result first; only a successful resident BM25 response may proceed
    // to the bounded semantic request. This keeps semantic failures from
    // falling through to the local cold index.
    const bm25StartedAt = performance.now();
    const bm25Result = await tryDaemonSearch(
      workflowRoot,
      q,
      candidateLimit,
      true,
      {
        filters: searchFilters,
        timeoutMs: DAEMON_BM25_BUDGET_MS,
        authorityKey,
        ...(adaptiveBudget ? { candidateBudget: adaptiveBudget } : {}),
        ...(diagnostics
          ? {
            diagnostics: true,
            diagnosticsRequestId: diagnostics.requestId,
            onFailure: noteDaemonFailure,
          }
          : {}),
      },
    );
    diagnostics?.recordPhase('daemon-bm25', performance.now() - bm25StartedAt, candidateLimit);
    daemonResult = bm25Result;
    if (opts.skipEmbedding !== true && daemonResultUsable(bm25Result)) {
      const semanticStartedAt = performance.now();
      const semanticResult = await tryDaemonSearch(
        workflowRoot,
        q,
        candidateLimit,
        false,
        {
          filters: searchFilters,
          timeoutMs: DAEMON_SEMANTIC_BUDGET_MS,
          authorityKey,
          ...(adaptiveBudget ? { candidateBudget: adaptiveBudget } : {}),
          ...(diagnostics
            ? {
              diagnostics: true,
              diagnosticsRequestId: diagnostics.requestId,
              onFailure: noteDaemonFailure,
            }
            : {}),
        },
      );
      diagnostics?.recordPhase('daemon-semantic', performance.now() - semanticStartedAt, candidateLimit);
      if (daemonResultUsable(semanticResult)) daemonResult = semanticResult;
    }
  } else {
    diagnostics?.recordFallback('daemon', 'read-only-probe');
  }
  let scored: Array<{ entry: WikiEntry; score: number }>;
  let embeddingUsed: boolean;
  let embeddingDocs: number;
  const usableDaemonResult = !readOnlyProbe
    && daemonResult?.ok === true
    && Array.isArray(daemonResult.results)
    && (!hasFacet || daemonResult.filtersApplied === true || (diagnostics && daemonResult.filtersApplied === undefined))
      ? daemonResult
      : null;

  if (usableDaemonResult) {
    diagnostics?.setProvider('daemon');
    scored = usableDaemonResult.results!;
    embeddingUsed = usableDaemonResult.embeddingUsed ?? false;
    embeddingDocs = usableDaemonResult.embeddingDocs ?? 0;
    diagnostics?.setEmbedding(embeddingUsed, embeddingDocs);
    if (diagnostics && usableDaemonResult.diagnostics) {
      diagnostics.merge(usableDaemonResult.diagnostics);
    } else if (diagnostics) {
      // Older daemons may return a valid result without the optional
      // diagnostics payload; compatibility is success, not a hard failure.
      diagnostics.recordFallback('daemon', 'diagnostics-unavailable');
    }
  } else {
    // Daemon unavailable — use BM25-only to avoid ONNX cold-start (~1800ms).
    // Spawn daemon in background so future searches get embedding.
    if (diagnostics && !daemonFailureObserved && !readOnlyProbe) {
      diagnostics.recordFallback('daemon', daemonFailureReason(daemonResult, workflowRoot));
    }
    if (!readOnlyProbe && daemonResult === null && !_daemonFallbackNoted && readDaemonInfo(workflowRoot)) {
      _daemonFallbackNoted = true;
      console.error('Note: search daemon unreachable — falling back to BM25-only (embedding disabled)');
    }
    const indexer = await getIndexer(executionMode, currentRepository);
    const indexerStartedAt = performance.now();
    const result = await indexer.searchWithMeta(
      q,
      candidateLimit,
      {
        skipEmbedding: true,
        filters: searchFilters,
        ...(diagnostics ? { diagnostics } : {}),
        ...(adaptiveBudget ? { candidateBudget: adaptiveBudget } : {}),
      },
    );
    diagnostics?.recordPhase('indexer-search', performance.now() - indexerStartedAt, candidateLimit);
    diagnostics?.setProvider('indexer');
    scored = result.results;
    embeddingUsed = result.embeddingUsed;
    embeddingDocs = result.embeddingDocs;
    diagnostics?.setEmbedding(embeddingUsed, embeddingDocs);
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
  diagnostics?.setEligibleCandidateCount?.(
    new Set(scored.map(result => result.entry.id)).size,
  );

  const filterStartedAt = performance.now();
  let filtered = scored.filter(result => {
    if (!isRepositoryApplicable(result.entry, targetRepository?.repoId ?? null)) return false;
    if (!explicitRepository || !targetRepository) return true;
    return targetRepository.repoId
      ? (result.entry.repoId ?? result.entry.source.repoId) === targetRepository.repoId
      : (result.entry.alias ?? result.entry.source.alias) === targetRepository.alias;
  });
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

  diagnostics?.recordPhase('result-filter', performance.now() - filterStartedAt, filtered.length);

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
    && existsSync(resolve(workflowRoot, 'kg', 'maestro.db'))) {
    try {
      const { readKnowledgeUsageSignals } = await import('../graph/kg/knowledge-usage.js');
      const signals = readKnowledgeUsageSignals(
        currentRepository.projectRoot,
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
  const selectionStartedAt = performance.now();
  const deduped = selectDiverseWikiCandidates(filtered, {
    limit,
    applyCaps,
    diversity: opts.diversity,
    impressions,
    explorationLimit,
  });
  diagnostics?.recordPhase('result-selection', performance.now() - selectionStartedAt, deduped.length);
  diagnostics?.setEligibleCandidateCount?.(deduped.length);
  const adaptiveCounts: SearchCandidateCounts = {
    candidateCount: scored.length,
    uniqueCandidateCount: new Set(scored.map(result => result.entry.id)).size,
    eligibleUniqueCount: deduped.length,
    saturated: scored.length >= candidateLimit,
  };
  if (adaptiveBudget && shouldEscalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts)) {
    const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts);
    if (nextBudget !== adaptiveBudget) {
      diagnostics?.recordFallback('candidate-budget', 'escalated');
      recordCandidateBudgetDiagnostics(diagnostics, nextBudget);
      diagnostics?.setCandidateCount(nextBudget.candidateLimit);
      return runUnifiedSearch(q, { ...opts, candidateBudget: nextBudget });
    }
  }
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
    ...wikiProviderMetadata(entry),
    repoId: entry.repoId ?? entry.source.repoId ?? null,
    repoName: entry.repoName ?? entry.source.repoName,
    alias: entry.alias ?? entry.source.alias,
    appliesToRepoIds: entry.appliesToRepoIds ?? null,
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
  diagnostics?.setResultCount(results.length);

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

function hasCanonicalKg(projectRoot: string): boolean {
  return existsSync(resolve(projectRoot, '.workflow', 'kg', 'maestro.db'));
}

function incrementSearchHitsAsync(
  entries: Array<{ id: string; sourceRef?: string | null }>,
  evidenceRecorder?: (event: SearchEvidenceEvent) => void,
  queryId: string | null = null,
  contexts: string[] = [],
): void {
  const projectRoot = resolve('.');
  if (!hasCanonicalKg(projectRoot)) return;
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
  /** Request-local diagnostics; omitted by hooks and ordinary callers. */
  diagnostics?: SearchDiagnosticsContext;
  /** One boundary-computed candidate budget; adaptive mode is opt-in. */
  candidateBudget?: SearchCandidateBudget;
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

function wikiProviderMetadata(entry: WikiEntry): Pick<
  SearchResult,
  'workspace' | 'workspaceFence' | 'authorized' | 'status' | 'provenance'
> {
  const raw = entry as unknown as Record<string, unknown>;
  const metadata = raw.metadata && typeof raw.metadata === 'object'
    && !Array.isArray(raw.metadata)
    ? raw.metadata as Record<string, unknown>
    : {};
  const ext = { ...metadata, ...(entry.ext ?? {}) };
  const workspace = Object.hasOwn(raw, 'workspace')
    ? raw.workspace
    : Object.hasOwn(entry.source, 'workspace')
      ? entry.source.workspace
      : ext.fixtureWorkspace;
  const workspaceFence = Object.hasOwn(raw, 'workspaceFence')
    ? raw.workspaceFence
    : Object.hasOwn(entry.source, 'workspaceFence')
      ? entry.source.workspaceFence
      : ext.fixtureWorkspaceFence;
  const fixtureAuthorized = Object.hasOwn(raw, 'authorized')
    ? raw.authorized
    : ext.fixtureAuthorized;
  const authorized = typeof fixtureAuthorized === 'boolean'
    ? fixtureAuthorized
    : fixtureAuthorized === 'true'
      ? true
      : fixtureAuthorized === 'false'
        ? false
        : undefined;
  const hasObservedProvenance = Object.hasOwn(raw, 'provenance');
  const fixtureProvenance = hasObservedProvenance
    ? raw.provenance
    : ext.fixtureProvenance;
  const provenance = fixtureProvenance === null
    ? null
    : fixtureProvenance && typeof fixtureProvenance === 'object'
      && !Array.isArray(fixtureProvenance)
      ? fixtureProvenance as { source: string; path: string }
      : !hasObservedProvenance
        && typeof ext.fixtureProvenanceSource === 'string'
        && typeof ext.fixtureProvenancePath === 'string'
        && ext.fixtureProvenanceSource.length > 0
        && ext.fixtureProvenancePath.length > 0
          ? { source: ext.fixtureProvenanceSource, path: ext.fixtureProvenancePath }
          : undefined;
  return {
    ...(typeof workspace === 'string' ? { workspace } : workspace === null ? { workspace: undefined } : {}),
    ...(typeof workspaceFence === 'string' ? { workspaceFence } : workspaceFence === null ? { workspaceFence: undefined } : {}),
    ...(authorized === undefined ? {} : { authorized }),
    status: typeof raw.status === 'string' ? raw.status : entry.status,
    ...(provenance === undefined ? {} : { provenance }),
  };
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
  const diagnostics = options.diagnostics;
  diagnostics?.setProvider('kg');
  const boundaryBudget = options.candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'kg', mode: 'adaptive' })
      : undefined);
  const adaptiveBudget = boundaryBudget?.adaptive ? boundaryBudget : undefined;
  recordCandidateBudgetDiagnostics(diagnostics, boundaryBudget);
  const startedAt = performance.now();
  try {
    if (!hasCanonicalKg(projectRoot)) {
      diagnostics?.recordFallback('kg', 'not-initialized');
      return { results: [], summary: {} };
    }
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    const sourceTypes = options.codeOnly ? ['codegraph'] as SourceType[] : kgSourceTypes(options.type);
    if (sourceTypes?.length === 0) {
      diagnostics?.recordFallback('kg', 'empty-source-filter');
      return { results: [], summary: {} };
    }
    const mg = recordImpressions
      ? await MaestroGraph.open(projectRoot)
      : await MaestroGraph.openReadOnly(projectRoot);
    try {
      const candidateLimit = adaptiveBudget?.candidateLimit
        ?? Math.min(500, Math.max(limit * 4, 40));
      diagnostics?.setCandidateCount(candidateLimit);
      const includeCode = !sourceTypes || sourceTypes.includes('codegraph');
      const includeKnowledge = !sourceTypes || sourceTypes.some(sourceType => sourceType !== 'codegraph');
      const queryKg = (passBudget: SearchCandidateBudget | undefined): {
        candidates: KgSearchResult[];
        results: KgSearchResult[];
        rawCount: number;
      } => {
        const passLimit = passBudget?.candidateLimit ?? candidateLimit;
        const output = mg.searchUnified(q, {
          limit: passLimit,
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
        return { candidates, results, rawCount: output.directMatches.length };
      };
      let pass = queryKg(adaptiveBudget);
      const adaptiveCounts: SearchCandidateCounts = {
        candidateCount: pass.rawCount,
        uniqueCandidateCount: new Set(pass.candidates.map(candidate => candidate.graphId)).size,
        eligibleUniqueCount: pass.results.length,
        saturated: pass.rawCount >= candidateLimit,
      };
      if (adaptiveBudget && shouldEscalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts)) {
        const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts);
        if (nextBudget !== adaptiveBudget) {
          diagnostics?.recordFallback('candidate-budget', 'escalated');
          recordCandidateBudgetDiagnostics(diagnostics, nextBudget);
          diagnostics?.setCandidateCount(nextBudget.candidateLimit);
          pass = queryKg(nextBudget);
        }
      }
      const candidates = pass.candidates;
      const results = pass.results;
      diagnostics?.setEligibleCandidateCount?.(results.length);
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
      diagnostics?.setResultCount(results.length);
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
    diagnostics?.recordFallback('kg', 'unavailable');
    if (process.env.MAESTRO_DEBUG === '1') {
      console.error(`[search] KG search failed: ${e instanceof Error ? e.message : e}`);
    }
    return { results: [], summary: {} };
  } finally {
    diagnostics?.recordPhase('kg-search', performance.now() - startedAt);
  }
}

/** Map raw FTS code nodes to the CLI result shape. */
function mapCodeNodes(nodes: Array<{
  id: string;
  kind: string;
  name: string;
  filePath: string;
  startLine?: number;
  _bm25Score?: number;
  signature?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}>): CodeSearchResult[] {
  return nodes.map(n => {
    const metadata = n.metadata ?? {};
    const workspace = typeof metadata.fixtureWorkspace === 'string'
      ? metadata.fixtureWorkspace
      : undefined;
    const workspaceFence = typeof metadata.fixtureWorkspaceFence === 'string'
      ? metadata.fixtureWorkspaceFence
      : undefined;
    const fixtureAuthorized = metadata.fixtureAuthorized;
    const authorized = typeof fixtureAuthorized === 'boolean'
      ? fixtureAuthorized
      : fixtureAuthorized === 'true'
        ? true
        : fixtureAuthorized === 'false'
          ? false
          : undefined;
    const fixtureProvenance = metadata.fixtureProvenance;
    const provenance = fixtureProvenance && typeof fixtureProvenance === 'object'
      && !Array.isArray(fixtureProvenance)
      ? fixtureProvenance as { source: string; path: string }
      : undefined;
    return {
      id: n.id,
      kind: n.kind,
      name: n.name,
      filePath: n.filePath,
      line: typeof n.startLine === 'number' && n.startLine > 0 ? n.startLine : null,
      score: typeof n._bm25Score === 'number' ? n._bm25Score : null,
      signature: n.signature || undefined,
      ...(workspace === undefined ? {} : { workspace }),
      ...(workspaceFence === undefined ? {} : { workspaceFence }),
      ...(authorized === undefined ? {} : { authorized }),
      ...(n.status === undefined ? {} : { status: n.status }),
      ...(provenance === undefined ? {} : { provenance }),
    };
  });
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
    if (!hasCanonicalKg(projectRoot)) return { results: [], status: 'not-initialized' };
    const { MaestroGraph } = await import('../graph/kg/engine.js');
    const mg = executionMode === 'read-only-probe'
      ? await MaestroGraph.openReadOnly(projectRoot)
      : await MaestroGraph.open(projectRoot);
    try {
      let results: CodeSearchResult[] | null = null;
      if (!skipEmbedding && executionMode === 'default') {
        try {
          // sourceTypes: ['codegraph'] restricts the FTS side to code nodes.
          const hybrid = await mg.searchHybrid(q, { limit, sourceTypes: ['codegraph'] });
          results = mapCodeNodes(hybrid.map(r => ({
            ...r.node,
            _bm25Score: typeof r.score === 'number' ? r.score : undefined,
          })));
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
  const linkedWorkspaces = resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot))
    .filter(workspace => workspace.valid && workspace.share.includes('codebase'))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const results: CodeSearchResult[] = [];
  const failures: LinkedCodeSearchFailure[] = [];
  if (linkedWorkspaces.length === 0) return { results, failures };
  const { MaestroGraph } = await import('../graph/kg/engine.js');

  for (const workspace of linkedWorkspaces) {
    let graph: InstanceType<typeof MaestroGraph> | null = null;
    try {
      graph = await MaestroGraph.openReadOnly(workspace.resolvedPath);
      const workspaceFence = workspace.repoId ? `repo:${workspace.repoId}` : `linked:${workspace.name}`;
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
  diagnostics?: SearchDiagnosticsContext,
  candidateBudget?: SearchCandidateBudget,
): Promise<CodeSearchOutcome> {
  const repositoryRoot = resolveRepositoryContext('current', { projectRoot }).projectRoot;
  const boundaryBudget = candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'code', mode: 'adaptive' })
      : undefined);
  const adaptiveBudget = boundaryBudget?.adaptive ? boundaryBudget : undefined;
  const providerLimit = adaptiveBudget?.candidateLimit ?? limit;
  recordCandidateBudgetDiagnostics(diagnostics, boundaryBudget);
  diagnostics?.setCandidateCount(providerLimit);
  const runPass = async (passBudget: SearchCandidateBudget | undefined): Promise<{
    local: CodeSearchOutcome;
    linked: LinkedCodeSearchOutcome | null;
    results: CodeSearchResult[];
    candidateCount: number;
    saturated: boolean;
  }> => {
    const passLimit = passBudget?.candidateLimit ?? limit;
    const local = await withSearchDiagnosticPhase(
      diagnostics,
      'code-search',
      () => runLocalCodeSearch(q, passLimit, skipEmbedding, repositoryRoot, executionMode),
      passLimit,
    );
    if (local.status !== 'ok') diagnostics?.recordFallback('kg', local.status);
    // Direct code search still honors the user's K; mixed search passes its
    // provider pool as `limit` and therefore keeps the larger pool for fusion.
    const localResults = includeLinkedCode || !adaptiveBudget
      ? local.results
      : local.results.slice(0, limit);
    if (!includeLinkedCode) {
      return {
        local,
        linked: null,
        results: localResults,
        candidateCount: local.results.length,
        saturated: local.results.length >= passLimit,
      };
    }

    const linked = await withSearchDiagnosticPhase(
      diagnostics,
      'linked-code-search',
      () => runLinkedCodeSearch(q, passLimit, repositoryRoot),
      passLimit,
    );
    if (linked.failures.length > 0) diagnostics?.recordFallback('kg', 'linked-unavailable');
    const results = interleaveCodeProviders(local.results, linked.results, limit);
    return {
      local,
      linked,
      results,
      candidateCount: local.results.length + linked.results.length,
      saturated: local.results.length >= passLimit || linked.results.length >= passLimit,
    };
  };

  let pass = await runPass(adaptiveBudget);
  const passUniqueCount = new Set(pass.results.map(result => result.id)).size;
  diagnostics?.setEligibleCandidateCount?.(passUniqueCount);
  if (adaptiveBudget) {
    const adaptiveCounts: SearchCandidateCounts = {
      candidateCount: pass.candidateCount,
      uniqueCandidateCount: new Set([
        ...pass.local.results,
        ...(pass.linked?.results ?? []),
      ].map(result => result.id)).size,
      eligibleUniqueCount: passUniqueCount,
      saturated: pass.saturated,
    };
    if (shouldEscalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts)) {
      const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts);
      if (nextBudget !== adaptiveBudget) {
        diagnostics?.recordFallback('candidate-budget', 'escalated');
        recordCandidateBudgetDiagnostics(diagnostics, nextBudget);
        diagnostics?.setCandidateCount(nextBudget.candidateLimit);
        pass = await runPass(nextBudget);
      }
    }
  }

  diagnostics?.setResultCount(pass.results.length);
  if (!includeLinkedCode) return { ...pass.local, results: pass.results };
  const linked = pass.linked!;
  return {
    results: pass.results,
    status: pass.results.length > 0 ? 'ok' : pass.local.status,
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
  const boundaryBudget = options.candidateBudget
    ?? (isAdaptiveSearchBudgetEnabled()
      ? computeSearchCandidateBudget(limit, { surface: 'mixed', mode: 'adaptive' })
      : undefined);
  const adaptiveBudget = boundaryBudget?.adaptive ? boundaryBudget : undefined;
  const candidateLimit = adaptiveBudget?.candidateLimit
    ?? Math.min(500, Math.max(limit * 3, 60));
  recordCandidateBudgetDiagnostics(options.diagnostics, boundaryBudget);
  options.diagnostics?.setCandidateCount(candidateLimit);
  const wikiSearch = dependencies.wikiSearch ?? runUnifiedSearch;
  const codeSearch = dependencies.codeSearch ?? runCodeSearch;
  const archKbSearch = dependencies.archKbSearch ?? runArchKbSearch;
  const merge = dependencies.merge ?? mergeAndNormalize;
  const { includeLinkedCode = false, ...wikiOptions } = options;
  const executionMode = options.executionMode ?? 'default';

  const invokeCodeSearch = (skipEmbedding: boolean | undefined): Promise<CodeSearchOutcome> => {
    if (adaptiveBudget) {
      return codeSearch(
        q,
        candidateLimit,
        skipEmbedding,
        includeLinkedCode,
        resolve('.'),
        executionMode,
        options.diagnostics,
        adaptiveBudget,
      );
    }
    if (options.diagnostics) {
      return codeSearch(
        q,
        candidateLimit,
        skipEmbedding,
        includeLinkedCode,
        resolve('.'),
        executionMode,
        options.diagnostics,
      );
    }
    return codeSearch(q, candidateLimit, skipEmbedding, includeLinkedCode);
  };
  const codePromise = invokeCodeSearch(executionMode === 'default' ? options.skipEmbedding : true);
  const templatePromise = !options.type
    && !options.category
    && !options.tag
    && !options.keyword
    && !options.workspace
    ? Promise.resolve(archKbSearch(q, candidateLimit)).then(results =>
      results.filter(result => hasDirectArchKbMatch(result, q)))
    : Promise.resolve([] as ScoredArchKbEntry[]);
  const providerWork = Promise.all([
    wikiSearch(q, {
      ...wikiOptions,
      limit: candidateLimit,
      executionMode,
      deferImpressions: dependencies.wikiSearch === undefined,
      explorationLimit: limit,
      ...(adaptiveBudget ? { candidateBudget: adaptiveBudget } : {}),
    }),
    codePromise,
    templatePromise,
  ]);
  const [wikiResults, codeOutcome, templateResults] = await withSearchDiagnosticPhase(
    options.diagnostics,
    'mixed-providers',
    providerWork,
    candidateLimit,
  );
  options.diagnostics?.setProvider('mixed');
  const results = templateResults.length > 0
    ? merge(wikiResults, codeOutcome.results, limit, q, templateResults)
    : merge(wikiResults, codeOutcome.results, limit, q);
  const candidateIds = new Set([
    ...wikiResults.map(result => result.id),
    ...codeOutcome.results.map(result => result.id),
    ...templateResults.map(result => result.entry.id),
  ]);
  const mixedCounts: SearchCandidateCounts = {
    candidateCount: wikiResults.length + codeOutcome.results.length + templateResults.length,
    uniqueCandidateCount: candidateIds.size,
    eligibleUniqueCount: candidateIds.size,
    saturated: wikiResults.length >= candidateLimit
      || codeOutcome.results.length >= candidateLimit
      || templateResults.length >= candidateLimit,
  };
  if (adaptiveBudget && shouldEscalateSearchCandidateBudget(adaptiveBudget, mixedCounts)) {
    const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, mixedCounts);
    if (nextBudget !== adaptiveBudget) {
      options.diagnostics?.recordFallback('candidate-budget', 'escalated');
      recordCandidateBudgetDiagnostics(options.diagnostics, nextBudget);
      options.diagnostics?.setCandidateCount(nextBudget.candidateLimit);
      return runMixedSearch(q, { ...options, candidateBudget: nextBudget }, dependencies);
    }
  }

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

  options.diagnostics?.setEligibleCandidateCount?.(
    new Set([
      ...wikiResults.map(result => result.id),
      ...codeOutcome.results.map(result => result.id),
      ...templateResults.map(result => result.entry.id),
    ]).size,
  );
  options.diagnostics?.setResultCount(results.length);

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
    .option('--repo <selector>', 'Target repository (current, ID, linked alias, or unique name)')
    .option('--include-linked-code', 'Include explicitly shared linked CodeGraph results')
    .option('--exact', 'Standalone fixed-string source search (does not use normal ranking/fusion)')
    .option('--timeout-ms <ms>', 'Exact search wall-clock timeout (only with --exact)')
    .option('--max-results <n>', 'Exact search occurrence cap (only with --exact)')
    .option('--max-bytes <n>', 'Exact search response-byte cap (only with --exact)')
    .option('--read-only-probe', 'Run a hermetic no-daemon, no-persistence search probe')
    .option('--include-deprecated', 'Include superseded/deprecated knowledge entries (hidden by default)')
    .option('--semantic', 'Enable semantic embedding reranking (BM25 is the low-latency default)')
    .option('--no-emb', 'Skip embedding, use BM25 only (backward-compatible explicit form)')
    .option('--diagnostics', 'Include bounded request-scoped JSON diagnostics')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Max results', '20')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (queryParts: string[], opts) => {
      const q = queryParts.join(' ');
      if (opts.workflowRoot && resolve(opts.workflowRoot) !== process.cwd()) {
        process.chdir(resolve(opts.workflowRoot));
      }
      const limit = Math.min(500, opts.limit > 0 ? Math.trunc(opts.limit) : 20);
      const diagnostics = opts.diagnostics === true ? createSearchDiagnostics() : undefined;
      const diagnosticsPayload = (): SearchDiagnostics | undefined => {
        if (!diagnostics) return undefined;
        return boundedSearchDiagnostics(finishSearchDiagnostics(diagnostics)) ?? undefined;
      };
      const withDiagnostics = <T extends Record<string, unknown>>(payload: T): T & { diagnostics?: SearchDiagnostics } => {
        const snapshot = diagnosticsPayload();
        return snapshot ? { ...payload, diagnostics: snapshot } : payload;
      };
      try {
        const resolvedTag = opts.tag ?? opts.kind;
        const wikiOnly = opts.wikiOnly === true || typeof resolvedTag === 'string' || typeof opts.repo === 'string';
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
      if (opts.repo && kgMode) {
        console.error('Error: --repo is not available in local --kg mode');
        process.exit(1);
      }

      // --exact is intentionally a separate, fixed-string route. It must not
      // initialize the daemon/indexer, enter mixed fusion, or inherit ranking
      // facets whose semantics do not apply to source occurrences.
      if (opts.exact === true) {
        const incompatible: Array<[boolean, string]> = [
          [Boolean(opts.type), '--type'],
          [Boolean(opts.category), '--category'],
          [Boolean(resolvedTag), '--tag/--kind'],
          [codeOnly, '--code'],
          [kgMode, '--kg'],
          [opts.wikiOnly === true, '--wiki-only'],
          [opts.semantic === true, '--semantic'],
          [opts.emb === false, '--no-emb'],
          [opts.includeDeprecated === true, '--include-deprecated'],
          [opts.diagnostics === true, '--diagnostics'],
        ];
        const conflict = incompatible.find(([present]) => present)?.[1];
        if (conflict) {
          console.error(`Error: --exact cannot be combined with ${conflict}`);
          process.exitCode = 1;
          return;
        }
        let exact: ExactSearchOutcome;
        try {
          exact = await runExactSearch(q, {
            projectRoot: resolve('.'),
            repo: opts.repo,
            workspace: opts.workspace,
            includeLinkedCode: opts.includeLinkedCode === true,
            // Pass raw caps through: exact-search owns validation/clamping and
            // therefore cannot inherit ranked search's invalid-value defaults.
            limit: opts.maxResults ?? opts.limit,
            timeoutMs: opts.timeoutMs,
            maxBytes: opts.maxBytes,
          });
        } catch (error: unknown) {
          // Exact failures are terminal for this opt-in route. Never fall back
          // to a broad filesystem scan or the normal indexed search providers.
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({
            query: q,
            mode: 'exact',
            count: exact.results.length,
            truncated: exact.truncated,
            timedOut: exact.timedOut,
            bytesUsed: exact.bytesUsed,
            results: exact.results,
          }, null, 2));
          return;
        }
        const status = exact.truncated ? ', truncated' : '';
        console.log(`Search: "${q}" (exact ${exact.results.length} result${exact.results.length === 1 ? '' : 's'}${status})`);
        if (exact.results.length === 0) {
          console.log('  No matches found.');
          return;
        }
        for (const result of exact.results) {
          const workspaceTag = result.workspace ? `  @${result.workspace}` : '';
          console.log(`  [exact]  ${result.filePath}:${result.line}:${result.column}${workspaceTag}`);
          if (result.preview) console.log(`    ${result.preview}`);
        }
        return;
      }

      // Exact-only caps are not meaningful on ranked search and are rejected
      // rather than silently ignored.
      if (opts.timeoutMs !== undefined || opts.maxResults !== undefined || opts.maxBytes !== undefined) {
        console.error('Error: --timeout-ms, --max-results, and --max-bytes require --exact');
        process.exitCode = 1;
        return;
      }

      const skipEmbedding = opts.emb === false || opts.semantic !== true;
      const isTTY = process.stdout.isTTY === true;
      const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const isDevelopmentQuery = /(?:\b(?:implement|implementation|develop|development|build|feature|refactor|fix|bug|api|class|function|code)\b|组件|开发|实现|功能|重构|修复|代码|接口)/i.test(q);
      const templateSearchCommand = `maestro arch-kb search ${JSON.stringify(q)} --type template`;
      const codeSearchCommand = `maestro search ${JSON.stringify(q)} --code`;

      // --type template: exact architecture-template search. This bypasses
      // project Wiki/CodeGraph providers but uses the same result contract.
      if (opts.type === 'template') {
        const templateStartedAt = performance.now();
        const templateResults = runArchKbSearch(q, limit);
        diagnostics?.recordPhase('arch-kb-search', performance.now() - templateStartedAt);
        diagnostics?.setProvider('arch-kb');
        const merged = mergeAndNormalize([], [], limit, q, templateResults);
        diagnostics?.setResultCount(merged.length);
        const templateHint = `For exact template lookup, use: ${templateSearchCommand}`;
        if (opts.json) {
          console.log(JSON.stringify(withDiagnostics({
            query: q,
            wikiCount: 0,
            codeCount: 0,
            templateCount: merged.length,
            typeCounts: { template: merged.length },
            count: merged.length,
            results: merged,
          }), null, 2));
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
            ...(diagnostics ? { diagnostics } : {}),
          },
        );
        diagnostics?.setProvider('kg');
        diagnostics?.setResultCount(kgResults.length);
        if (opts.json) {
          diagnostics?.setProvider('kg');
          console.log(JSON.stringify(withDiagnostics({ query: q, engine: 'maestrograph', count: kgResults.length, summary, results: kgResults }), null, 2));
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

      let targetRepository: RepositoryContext | undefined;
      if (opts.repo) {
        try {
          targetRepository = resolveRepositoryContext(opts.repo, { projectRoot: process.cwd() });
        } catch (error) {
          console.error(`Error: ${(error as Error).message}`);
          process.exitCode = 1;
          return;
        }
      }

      const searchOptions = {
        type: opts.type,
        category: opts.category,
        tag: resolvedTag,
        workspace: opts.workspace,
        repo: opts.repo,
        targetRepository,
        limit,
        skipEmbedding,
        includeLinkedCode: opts.includeLinkedCode === true,
        executionMode: opts.readOnlyProbe === true
          ? 'read-only-probe' as const
          : 'default' as const,
        includeDeprecated: opts.includeDeprecated === true,
        ...(diagnostics ? { diagnostics } : {}),
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
              diagnostics,
            ),
        ]);
      }
      const codeResults = codeOutcome.results;
      const codeHint = wikiOnly ? null : codeIndexHint(codeOutcome.status);
      if (codeOnly) diagnostics?.setResultCount(codeResults.length);

      const meta = getLastSearchMeta();
      const embTag = meta.embeddingUsed ? `+emb(${meta.embeddingDocs})` : 'bm25';

      // --code: code graph results only
      if (codeOnly) {
        if (opts.json) {
          diagnostics?.setResultCount(codeResults.length);
          console.log(JSON.stringify(withDiagnostics({
            query: q,
            count: codeResults.length,
            codeIndex: codeOutcome.status,
            ...(codeHint ? { hint: codeHint } : {}),
            results: codeResults,
          }), null, 2));
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
      diagnostics?.setResultCount(merged.length);

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
        diagnostics?.setResultCount(merged.length);
        console.log(JSON.stringify(withDiagnostics({
          query: q,
          wikiCount,
          codeCount,
          templateCount,
          codeIndex: codeOutcome.status,
          ...(codeHint ? { codeIndexHint: codeHint } : {}),
          typeCounts: typeCountsJson,
          count: merged.length,
          results: merged,
        }), null, 2));
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
      } finally {
        // Keep human-readable stdout byte-for-byte compatible. Diagnostics are
        // machine-readable and therefore emitted on stderr unless --json has
        // already embedded them in the response object.
        if (diagnostics && !opts.json) {
          console.error(JSON.stringify({ diagnostics: diagnosticsPayload() }));
        }
      }
    });

  // ── Search daemon management ───────────────────────────────────────────

  program
    .command('search-daemon')
    .description('Manage the resident search daemon (warm ONNX model)')
    .argument('<action>', 'start | stop | status')
    .action(async (action: string) => {
      const currentRepository = resolveRepositoryContext('current', { projectRoot: process.cwd() });
      const workflowRoot = currentRepository.workflowRoot;

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
        const { linkedWorkspaces, repository } = resolveWikiAuthority(currentRepository);
        try {
          const { startDaemon } = await import('../search/daemon.js');
          const { port } = await startDaemon(
            workflowRoot,
            { workflowRoot, linkedWorkspaces, repository, role: 'publisher' },
            { exitOnDrainTimeout: true },
          );
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
          const idleTag = health.idleTimeoutMs === 0
            ? '  idle=disabled'
            : typeof health.idleTimeoutMs === 'number'
              ? `  idle=${Math.round(health.idleTimeoutMs / 60_000)}m  deadline=${health.idleDeadline ?? 'pending'}`
              : '';
          console.log(`Search daemon: running${stateTag}  pid=${info.pid}  port=${info.port}  started=${info.startedAt}${idleTag}`);
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
      const currentRepository = resolveRepositoryContext('current', { projectRoot: process.cwd() });
      const workflowRoot = currentRepository.workflowRoot;
      const { linkedWorkspaces, repository } = resolveWikiAuthority(currentRepository);
      try {
        const { startDaemon } = await import('../search/daemon.js');
        await startDaemon(
          workflowRoot,
          { workflowRoot, linkedWorkspaces, repository, role: 'publisher' },
          { exitOnDrainTimeout: true },
        );
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
      const currentRepository = resolveRepositoryContext('current', { projectRoot: process.cwd() });
      const workflowRoot = currentRepository.workflowRoot;
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
        const projectPath = currentRepository.projectRoot;
        const wsConfig = loadWorkspaceConfig(projectPath);
        const resolved = resolveWorkspaceLinks(projectPath, wsConfig);
        const linkedWorkspaces = resolved.filter(lw => lw.valid).map(lw => ({ name: lw.name, workflowRoot: lw.workflowRoot, shareTypes: lw.share }));
        const indexer = new WikiIndexer({ workflowRoot, linkedWorkspaces, role: 'publisher' });
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
  /** Provider-observed authorization metadata (when exposed by the source). */
  authorized?: boolean;
  /** Provider-observed lifecycle status (when exposed by the source). */
  status?: string;
  /** Provider-observed provenance (when exposed by the source). */
  provenance?: { source: string; path: string } | null;
  repoId?: string | null;
  repoName?: string;
  alias?: string;
  workspaceFence?: string;
  appliesToRepoIds?: string[] | null;
  category?: string;
  confidence?: string;
  /** Unified load command for opening an Arch-KB result. */
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
      repoId: r.repoId,
      repoName: r.repoName,
      alias: r.alias,
      workspace: r.workspace,
      workspaceFence: r.workspaceFence,
      authorized: r.authorized,
      status: r.status,
      provenance: r.provenance,
      appliesToRepoIds: r.appliesToRepoIds,
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
      authorized: r.authorized,
      status: r.status,
      provenance: r.provenance,
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
      detail: `${r.entry.path}  (maestro load --type template --id ${r.entry.id})`,
      rank: templateRanks[i] * ARCH_KB_WEIGHT,
      score: maxTemplateFinal > 0 ? r.finalScore / maxTemplateFinal : 0,
      summary: r.entry.summary || undefined,
      category: 'arch-kb',
      openCommand: `maestro load --type template --id ${r.entry.id}`,
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
