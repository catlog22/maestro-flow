import { open, readFile, readdir, stat, lstat, writeFile, mkdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { toForwardSlash } from '../../shared/utils.js';
import { normalizeCanonicalKnowledgeContent } from '../../../../shared/knowledge-content.js';
import { parseFrontmatter } from './frontmatter-util.js';
import { parseSpecEntries, parseKnowhowEntries } from './spec-entry-parser.js';
import {
  adaptCodebaseDocIndex,
  adaptKnowledgeGraphFromDb,
  adaptIssueRow,
  adaptKnowledgeGraph,
  crossReferenceKgWithDocIndex,
  loadRunModeSessionEntries,
  loadVirtualEntries,
  loadVirtualJsonEntries,
  loadClaudeCodeSessions,
  loadCodexSessions,
  cwdToClaudeProjectSlug,
} from './virtual-wiki-adapters.js';
import { homedir } from 'node:os';
import { closeSync, createWriteStream, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { buildGraph, type WikiGraph } from './graph-analysis.js';
import {
  buildInvertedIndex,
  deserializeInvertedIndex,
  searchBM25,
  searchBM25Planned,
  rerankByPhraseProximity,
  serializeInvertedIndex,
  getInvertedIndexConfigKey,
  type InvertedIndex,
  type SerializedInvertedIndex,
} from './search.js';
import { applyTimeDecay } from './time-decay.js';
import type { EmbeddingIndex } from './embedding.js';
import {
  isStructuredChunksEnabled,
  STRUCTURED_FRAGMENT_POLICY_CHECKSUM,
} from './structured-fragments.js';
import type {
  WikiEntry,
  WikiFilters,
  WikiIndex,
  WikiSearchFilters,
  WikiStatus,
  WikiNodeType,
  WikiScope,
  PersistedWikiIndex,
  PersistedEntry,
  WikiSearchDiagnostics,
  WikiSearchDiagnosticsSnapshot,
  WikiSearchCandidateBudget,
} from './wiki-types.js';
import {
  isWikiEntryApplicable,
  matchesWikiRepository,
  recallSnapshotSchema,
  type RecallSnapshot,
} from './wiki-types.js';
import {
  resolveAllowedDirectSourcePath,
  resolveAllowedDirectSourcePathInfo,
  resolveAllowedSourcePath,
  resolveAllowedSourcePathInfo,
} from './source-path.js';
import {
  buildSourceManifest,
  classifySourcePath,
  isCoveredSourceKind,
  manifestWithEntryIds,
  normalizeManifestPath,
  readSourceManifest,
  sourceManifestsContentEqual,
  sourceManifestsEqual,
  validateSourceManifest,
  SOURCE_MANIFEST_FILE,
  type SourceChange,
  type SourceManifest,
  type SourceManifestEntry,
} from './source-manifest.js';
import {
  applyIncrementalIndex,
} from './incremental-index.js';
import {
  computeSearchCandidateBudget,
  escalateSearchCandidateBudget,
  shouldEscalateSearchCandidateBudget,
  isAdaptiveSearchBudgetEnabled,
} from '../../../../src/search/candidate-budget.js';
import type { SearchCandidateBudget, SearchCandidateCounts } from '../../../../src/search/candidate-budget.js';

// v8: persist only canonical repository attribution and rehydrate live routing metadata.
// v7 remains dual-readable so existing caches can be rebuilt without losing compatibility.
const SEARCH_CACHE_VERSION = 9;
const LEGACY_SEARCH_CACHE_VERSION = 8;
const OLDER_SEARCH_CACHE_VERSION = 7;
const COMPILED_POSTINGS_ENV = 'MAESTRO_SEARCH_COMPILED_POSTINGS';
const INCREMENTAL_INDEX_ENV = 'MAESTRO_SEARCH_INCREMENTAL_INDEX';
const SEARCH_PARENT_CAP = 2;
const MAX_SEARCH_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_SEARCH_CACHE_ENTRIES = 1_000_000;
const PUBLICATION_LOCK_FILE = 'wiki-index-publication.lock';
const PUBLICATION_LOCK_WAIT_MS = 2_000;
const CLI_SESSION_CACHE_TTL_MS = 5 * 60_000;
/** Reconcile user-level transcript membership/content at most four minutes apart. */
export const CLI_SESSION_RECONCILIATION_INTERVAL_MS = 4 * 60_000;
const CLI_SESSION_MAX_AGE_DAYS = 90;
const CLI_SESSION_MAX_FILES = 100;
const CLI_SESSION_MAX_DISCOVERY_FILES = CLI_SESSION_MAX_FILES * 3;
const CLI_FINGERPRINT_HEAD_BYTES = 4 * 1024;
const CLI_FINGERPRINT_TAIL_BYTES = 4 * 1024;
const CLI_SESSION_CWD_CACHE_LIMIT = 2_048;
const CLI_HOME_DISCOVERY_CACHE_TTL_MS = 3 * 60_000;
const cliSessionScanCache = new Map<string, {
  fingerprint: string;
  cachedAt: number;
  entries: WikiEntry[];
}>();
const cliSessionCwdCache = new Map<string, {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  cwd: string | null;
}>();
let homeCodexDiscoveryCache: {
  root: string;
  cachedAt: number;
  files: string[];
} | null = null;

/**
 * Compiled posting payloads remain opt-in until the release benchmark proves
 * the required latency/size gate. Any truthy explicit opt-in is accepted so
 * CI and local profiling can use either `1` or `true`; unset/other values
 * intentionally retain the v8 JSON-entry writer.
 */
export function isCompiledSearchCacheEnabled(): boolean {
  const value = process.env[COMPILED_POSTINGS_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

/** Incremental file indexing is an explicit opt-in and remains fail-closed. */
export function isIncrementalSearchIndexEnabled(): boolean {
  const value = process.env[INCREMENTAL_INDEX_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

function searchCacheVersionForPublication(): number {
  return isCompiledSearchCacheEnabled() ? SEARCH_CACHE_VERSION : LEGACY_SEARCH_CACHE_VERSION;
}

export interface WikiSearchOptions {
  skipEmbedding?: boolean;
  credibilityFactors?: Map<string, number>;
  filters?: WikiSearchFilters;
  /** Cancels this caller's wait and query embedding without aborting shared cache builds. */
  signal?: AbortSignal;
  /** Optional request-local diagnostics sink; never persisted by the indexer. */
  diagnostics?: WikiSearchDiagnostics;
  /** One boundary-computed candidate budget; adaptive mode is opt-in. */
  candidateBudget?: WikiSearchCandidateBudget;
}

export interface WikiIndexerCloseOptions {
  /** Only dedicated owner processes should tear down the process-global pipeline. */
  disposeEmbeddingPipeline?: boolean;
}

function searchAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('wiki search aborted');
}

function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw searchAbortError(signal);
}

function awaitWithSearchAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(searchAbortError(signal));
  return new Promise<T>((resolveWork, rejectWork) => {
    const onAbort = (): void => {
      cleanup();
      rejectWork(searchAbortError(signal));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      value => { cleanup(); resolveWork(value); },
      error => { cleanup(); rejectWork(error); },
    );
  });
}

interface WikiRepositoryOrigin {
  repoId: string | null;
  repoName: string;
  alias: string;
  workspaceFence?: string;
}

function readRepositoryOrigin(workflowRoot: string, alias: string): WikiRepositoryOrigin {
  let repoId: string | null = null;
  let repoName = basename(dirname(workflowRoot));
  try {
    const value = JSON.parse(readFileSync(join(workflowRoot, 'repository.json'), 'utf-8')) as Record<string, unknown>;
    if (typeof value.repo_id === 'string' && value.repo_id) repoId = value.repo_id;
    if (typeof value.repo_name === 'string' && value.repo_name.trim()) repoName = value.repo_name.trim();
  } catch { /* legacy repository remains readable without inventing an identity fence */ }
  return {
    repoId,
    repoName,
    alias,
    workspaceFence: repoId ? `repo:${repoId}` : (alias === 'current' ? undefined : `linked:${alias}`),
  };
}

function applyRepositoryOriginToEntry(
  entry: WikiEntry,
  origin: WikiRepositoryOrigin,
  linkedAlias?: string,
): void {
  entry.repoId = origin.repoId;
  entry.repoName = origin.repoName;
  entry.alias = origin.alias;
  entry.workspaceFence = origin.workspaceFence;
  if (linkedAlias === undefined) delete entry.source.workspace;
  else entry.source.workspace = linkedAlias;
  entry.source.repoId = origin.repoId;
  entry.source.repoName = origin.repoName;
  entry.source.alias = origin.alias;
  if (origin.workspaceFence === undefined) delete entry.source.workspaceFence;
  else entry.source.workspaceFence = origin.workspaceFence;
}

function applyRepositoryOrigin(
  entries: WikiEntry[],
  origin: WikiRepositoryOrigin,
  linkedAlias?: string,
): void {
  for (const entry of entries) applyRepositoryOriginToEntry(entry, origin, linkedAlias);
}

function prefixLinkedEntries(entries: WikiEntry[], idPrefix: string, workspace: string): void {
  const idMap = new Map(entries.map(entry => [entry.id, `${idPrefix}${entry.id}`]));
  for (const entry of entries) {
    entry.id = idMap.get(entry.id)!;
    entry.related = entry.related.map(id => idMap.get(id) ?? id);
    if (entry.parent) entry.parent = idMap.get(entry.parent) ?? entry.parent;
    const kgEdges = entry.ext?.kgEdges;
    if (Array.isArray(kgEdges)) {
      entry.ext.kgEdges = kgEdges.map(edge => {
        if (!edge || typeof edge !== 'object') return edge;
        const typed = edge as Record<string, unknown>;
        const target = typeof typed.target === 'string' ? idMap.get(typed.target) ?? typed.target : typed.target;
        return { ...typed, target };
      });
    }
    entry.source = { ...entry.source, workspace };
    entry.scope = 'linked';
  }
}

function promotedRefToWikiId(ref: string): string | null {
  const value = ref.trim();
  if (/^(?:spec|knowhow)-/.test(value)) return value;
  const match = value.match(/^(spec|knowhow):(.+)$/);
  return match ? `${match[1]}-${slugify(match[2])}` : null;
}

export interface LinkedWorkspaceConfig {
  name: string;
  workflowRoot: string;
  shareTypes: Array<'spec' | 'knowhow' | 'domain' | 'codebase' | 'session'>;
  repoId?: string | null;
  repoName?: string;
  workspaceFence?: string;
}

export type WikiIndexerRole = 'publisher' | 'reader' | 'hermetic';
/** Compatibility aliases retained for callers that used persistence/mode names. */
export type WikiIndexerPersistence = 'filesystem' | 'read-only' | 'memory-only';

export const WIKI_INDEXER_ROLES: readonly WikiIndexerRole[] = ['publisher', 'reader', 'hermetic'];

/** Map the pre-role persistence option to the explicit ownership role. */
export function wikiIndexerRoleFromPersistence(
  persistence: WikiIndexerPersistence | undefined,
): WikiIndexerRole {
  if (persistence === 'read-only') return 'reader';
  if (persistence === 'memory-only') return 'hermetic';
  return 'publisher';
}

/** Resolve an explicit role first, preserving legacy option behavior. */
export function resolveWikiIndexerRole(config: Pick<WikiIndexerConfig, 'role' | 'persistence'>): WikiIndexerRole {
  return config.role ?? wikiIndexerRoleFromPersistence(config.persistence);
}

export interface WikiIndexerConfig {
  workflowRoot: string;
  linkedWorkspaces?: LinkedWorkspaceConfig[];
  repository?: { repoId: string | null; repoName: string; alias?: string; workspaceFence?: string };
  /** Explicit ownership: publisher writes, reader consumes, hermetic never touches persistence. */
  role?: WikiIndexerRole;
  /**
   * @deprecated Use role. filesystem → publisher, read-only → reader,
   * memory-only → hermetic. The default remains publisher for compatibility.
   */
  persistence?: WikiIndexerPersistence;
  /** Disable user-level Claude/Codex transcript sources for hermetic callers. */
  includeCliSessions?: boolean;
  evidenceRecorder?: (event: WikiEvidenceEvent) => void;
}

export type WikiEvidenceEventName =
  | 'filesystem-cache-read'
  | 'filesystem-cache-write'
  | 'filesystem-index-write'
  | 'embedding-build'
  | 'embedding-save';

export interface WikiEvidenceEvent {
  event: WikiEvidenceEventName;
  site: string;
  queryId: null;
}

function matchesSearchFilters(entry: WikiEntry, filters: WikiSearchFilters): boolean {
  if (!filters.includeDeprecated
    && (entry.status === 'deprecated' || entry.ext.status === 'deprecated')) return false;
  if (filters.type) {
    if (filters.type === 'session') {
      if (entry.category !== 'session') return false;
    } else if (filters.type === 'scratch') {
      if (entry.category !== 'scratch') return false;
    } else if (entry.type !== filters.type) return false;
  }
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.tag && !entry.tags.includes(filters.tag.toLowerCase())) return false;
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    if (!entry.title.toLowerCase().includes(keyword)
      && !entry.body.toLowerCase().includes(keyword)) return false;
  }
  if (filters.workspace && entry.source.workspace !== filters.workspace) return false;
  if (!matchesWikiRepository(entry, filters)) return false;
  return true;
}

function finalizeSearchResults(
  index: WikiIndex,
  candidates: readonly { docId: string; score: number }[],
  query: string,
  limit: number,
  includeDeprecated = false,
): Array<{ entry: WikiEntry; score: number }> {
  const resultLimit = Math.max(0, limit);
  if (resultLimit === 0) return [];

  let eligible: Array<{ entry: WikiEntry; score: number }> = [];
  for (const candidate of candidates) {
    const entry = index.byId[candidate.docId];
    if (!entry || (!includeDeprecated
      && (entry.status === 'deprecated' || entry.ext.status === 'deprecated'))) continue;
    eligible.push({ entry, score: candidate.score });
  }

  eligible = rerankByPhraseProximity(eligible, query);
  eligible = applyTimeDecay(eligible, Date.now());

  const selected: Array<{ entry: WikiEntry; score: number }> = [];
  const seen = new Set<string>();
  const parentCounts = new Map<string, number>();
  for (const result of eligible) {
    if (seen.has(result.entry.id)) continue;
    const parentKey = result.entry.parent ?? result.entry.id.replace(/-\d{2,3}$/, '');
    const parentCount = parentCounts.get(parentKey) ?? 0;
    if (parentCount >= SEARCH_PARENT_CAP) continue;
    seen.add(result.entry.id);
    parentCounts.set(parentKey, parentCount + 1);
    selected.push(result);
    if (selected.length >= resultLimit) break;
  }

  return selected.slice(0, resultLimit);
}

/**
 * WikiIndexer: single source of truth for the unified wiki index.
 *
 * Responsibilities:
 *   1. Walk `.workflow/` for known wiki sources.
 *   2. Parse frontmatter + infer missing fields.
 *   3. Adapt JSONL rows as virtual entries.
 *   4. Build backlinks from `related: [[id]]` frontmatter.
 *   5. Cache index + memoized graph + BM25 index.
 *   6. Single-flight rebuild with invalidate().
 */
export class WikiIndexer {
  private readonly workflowRoot: string;
  private readonly role: WikiIndexerRole;
  private readonly persistence: WikiIndexerPersistence;
  private readonly evidenceRecorder: ((event: WikiEvidenceEvent) => void) | undefined;
  private readonly includeCliSessions: boolean;
  private readonly currentRepository: WikiRepositoryOrigin;
  private readonly linkedWorkspaces: Array<{
    name: string;
    workflowRoot: string;
    shareTypes: Set<string>;
    origin: WikiRepositoryOrigin;
  }>;
  private cache: WikiIndex | null = null;
  private graphCache: WikiGraph | null = null;
  private searchCache: InvertedIndex | null = null;
  private embeddingCache: EmbeddingIndex | null = null;
  /** Partial vectors retained by incremental updates until the next build fills gaps. */
  private embeddingSeed: EmbeddingIndex | null = null;
  private embeddingInflight: Promise<EmbeddingIndex | null> | null = null;
  private embeddingGeneration = 0;
  private embeddingAbort: AbortController | null = null;
  private inflight: Promise<WikiIndex> | null = null;
  private incrementalInflight: Promise<'unchanged' | 'updated' | 'fallback'> | null = null;
  private rebuildGeneration = 0;
  private persistenceInflight: Promise<void> | null = null;
  private pendingPersistence: {
    index: WikiIndex;
    snapshot: Map<string, string>;
    generation: number;
    manifest?: SourceManifest | null;
    cliSessionFingerprint?: string | null;
  } | null = null;
  private mtimeSnapshot: Map<string, string> = new Map();
  /** Paths recorded in mtimeSnapshot, for the warm-path re-stat change check. */
  private lastSnapshotPaths: readonly string[] | null = null;
  /** Last validated manifest used by the opt-in incremental file path. */
  private incrementalManifest: SourceManifest | null = null;
  /** Fingerprint of the bounded user-level CLI transcript projection. */
  private cliSessionFingerprint: string | null = null;
  /** Monotonic generation value used to fence rapid publications in one process. */
  private lastIndexGeneration = 0;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private closing = false;

  constructor(config: WikiIndexerConfig) {
    this.workflowRoot = resolve(config.workflowRoot);
    this.role = resolveWikiIndexerRole(config);
    this.persistence = this.role === 'publisher'
      ? 'filesystem'
      : this.role === 'reader'
        ? 'read-only'
        : 'memory-only';
    this.evidenceRecorder = config.evidenceRecorder;
    // Hermetic instances are project-only by default. Legacy callers can opt
    // back into user-level transcript sources explicitly when needed.
    this.includeCliSessions = config.includeCliSessions ?? (this.role !== 'hermetic');
    const detectedCurrent = readRepositoryOrigin(this.workflowRoot, config.repository?.alias ?? 'current');
    this.currentRepository = config.repository
      ? {
        repoId: config.repository.repoId,
        repoName: config.repository.repoName,
        alias: config.repository.alias ?? 'current',
        workspaceFence: config.repository.workspaceFence
          ?? (config.repository.repoId ? `repo:${config.repository.repoId}` : undefined),
      }
      : detectedCurrent;
    this.linkedWorkspaces = (config.linkedWorkspaces ?? []).map(lw => {
      const workflowRoot = resolve(lw.workflowRoot);
      const detected = readRepositoryOrigin(workflowRoot, lw.name);
      return {
        name: lw.name,
        workflowRoot,
        shareTypes: new Set(lw.shareTypes),
        origin: {
          repoId: lw.repoId === undefined ? detected.repoId : lw.repoId,
          repoName: lw.repoName ?? detected.repoName,
          alias: lw.name,
          workspaceFence: lw.workspaceFence
            ?? (lw.repoId ? `repo:${lw.repoId}` : detected.workspaceFence),
        },
      };
    });
    this.startPeriodicReconciliation();
  }

  getWorkflowRoot(): string {
    return this.workflowRoot;
  }

  /** Explicit cache ownership role for lifecycle diagnostics and tests. */
  getRole(): WikiIndexerRole {
    return this.role;
  }

  /** Allocate a generation that remains unique even when Date.now() repeats. */
  private allocateIndexGeneration(): number {
    this.lastIndexGeneration = Math.max(Date.now(), this.lastIndexGeneration + 1);
    return this.lastIndexGeneration;
  }

  private startPeriodicReconciliation(): void {
    // Hermetic instances intentionally have no user-level transcript authority.
    if (this.persistence === 'memory-only' || !this.includeCliSessions) return;
    this.reconciliationTimer = setInterval(() => {
      if (this.closing) return;
      // A reconciliation is best effort. The next foreground get() still
      // performs the same bounded fingerprint check and will surface errors.
      void this.get().catch(() => undefined);
    }, CLI_SESSION_RECONCILIATION_INTERVAL_MS);
    // Timers must never keep a short-lived CLI/dashboard process alive.
    const timer = this.reconciliationTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  private recordEvidence(event: WikiEvidenceEventName, site: string): void {
    this.evidenceRecorder?.({ event, site, queryId: null });
  }

  private async captureCliSessionFingerprint(): Promise<string | null> {
    if (this.persistence === 'memory-only' || !this.includeCliSessions) return null;
    const projectCwd = dirname(this.workflowRoot);
    const home = homedir();
    const projectSlug = cwdToClaudeProjectSlug(projectCwd);
    return cliSessionStoreFingerprint(
      join(home, '.claude', 'projects', projectSlug),
      join(home, '.codex'),
      projectCwd,
    );
  }

  async get(): Promise<WikiIndex> {
    if (this.cache) {
      if (isIncrementalSearchIndexEnabled() && this.incrementalManifest) {
        const refreshed = this.incrementalInflight
          ? await this.incrementalInflight
          : await this.runIncrementalRefresh();
        if ((refreshed === 'unchanged' || refreshed === 'updated') && this.cache) return this.cache;
        // Any manifest mismatch, unsupported source, abort, or validation
        // failure deliberately falls through to the established full rebuild.
      } else if (!await this.hasSourceChanges()) {
        return this.cache;
      }
      this.invalidate();
    }
    if (this.inflight) return this.inflight;
    if (this.persistence !== 'memory-only' && await this.tryLoadSearchCache()) {
      return this.cache!;
    }
    return this.rebuild();
  }

  private async runIncrementalRefresh(): Promise<'unchanged' | 'updated' | 'fallback'> {
    if (this.incrementalInflight) return this.incrementalInflight;
    const flight = this.tryIncrementalRefresh();
    this.incrementalInflight = flight;
    try {
      return await flight;
    } finally {
      if (this.incrementalInflight === flight) this.incrementalInflight = null;
    }
  }

  /**
   * Refresh a warm generation from local covered files only. The existing
   * snapshot is still consulted for linked/session/transcript paths because
   * those paths are outside the manifest root and must force a full rebuild.
   */
  private async tryIncrementalRefresh(): Promise<'unchanged' | 'updated' | 'fallback'> {
    if (!this.cache || !this.incrementalManifest) return 'fallback';
    // Keep the generation being patched detached from mutable cache fields.
    // invalidate() may clear this.cache while a parser is yielding; the
    // candidate must still be fenced and discarded rather than dereferencing
    // a null cache or publishing stale entries.
    const previousIndex = this.cache;
    const previousSearchCache = this.searchCache;
    const previousEmbedding = this.embeddingCache;
    const generation = this.rebuildGeneration;
    const previousManifest = this.incrementalManifest;
    let currentManifest: SourceManifest;
    let currentSnapshot: Map<string, string>;
    let currentCliFingerprint: string | null = null;
    try {
      currentManifest = await buildSourceManifest(this.workflowRoot, { signal: undefined });
      currentSnapshot = await this.captureSourceSnapshot();
      currentCliFingerprint = await this.captureCliSessionFingerprint();
    } catch {
      return 'fallback';
    }
    // File-source updates are the only incremental surface. A transcript
    // append (including one that preserves mtime) remains a hard fence and
    // therefore takes the established full rebuild path.
    if (this.cliSessionFingerprint !== currentCliFingerprint) return 'fallback';

    const changedSnapshotPaths = this.changedSnapshotPaths(this.mtimeSnapshot, currentSnapshot);
    if (changedSnapshotPaths.some(path => !this.isIncrementalSnapshotPath(path))) return 'fallback';
    if (sourceManifestsContentEqual(previousManifest, currentManifest)
      && snapshotsEqual(this.mtimeSnapshot, currentSnapshot)) {
      return 'unchanged';
    }

    const currentWithIds = manifestWithEntryIds({
      ...currentManifest,
      generation: previousIndex.generatedAt,
    }, previousIndex.entries);
    let update;
    try {
      update = await applyIncrementalIndex({
        previous: {
          index: previousIndex,
          searchIndex: previousSearchCache,
          embedding: previousEmbedding,
          manifest: previousManifest,
          generation: previousIndex.generatedAt,
        },
        currentManifest: currentWithIds,
        loadSource: (source, change, signal) => this.scanIncrementalSource(source, change, signal),
        loadSourcesForKind: async (sourceKind, sources, signal) => {
          const out: WikiEntry[] = [];
          for (const source of sources) {
            const syntheticChange: SourceChange = {
              kind: 'modify',
              path: source.path,
              sourceKind,
              current: source,
            };
            out.push(...await this.scanIncrementalSource(source, syntheticChange, signal));
          }
          return out;
        },
      });
    } catch {
      // Parser/hash mismatches are ordinary incremental cache misses. Keep the
      // previously published generation untouched and let get() full-rebuild.
      return 'fallback';
    }
    if (update.status !== 'updated' || generation !== this.rebuildGeneration) return 'fallback';
    // The parser may have yielded while a writer touched another source. Fence
    // the candidate again before exposing it as the new in-memory generation.
    try {
      const verifiedManifest = await buildSourceManifest(this.workflowRoot);
      const verifiedSnapshot = await this.captureSourceSnapshot();
      const verifiedCliFingerprint = await this.captureCliSessionFingerprint();
      if (!sourceManifestsContentEqual(currentManifest, verifiedManifest)
        || !snapshotsEqual(currentSnapshot, verifiedSnapshot)
        || verifiedCliFingerprint !== currentCliFingerprint
        || generation !== this.rebuildGeneration) return 'fallback';
      currentSnapshot = verifiedSnapshot;
      currentManifest = verifiedManifest;
      currentCliFingerprint = verifiedCliFingerprint;
    } catch {
      return 'fallback';
    }

    // The candidate is completely detached/validated by applyIncrementalIndex;
    // publish it in memory only after all parsing and derived maps succeeded.
    // Advance the publication epoch so an older persistence flight cannot
    // supersede this candidate even when both updates happen in one millisecond.
    if (generation !== this.rebuildGeneration) return 'fallback';
    this.rebuildGeneration++;
    this.cache = update.state.index;
    this.searchCache = update.state.searchIndex;
    if (update.embedding.invalidatedDocIds.length > 0) {
      this.embeddingCache = null;
      this.embeddingSeed = update.embedding.index;
    } else {
      this.embeddingCache = update.embedding.index;
      this.embeddingSeed = null;
    }
    this.incrementalManifest = manifestWithEntryIds({
      ...currentManifest,
      generation: this.cache.generatedAt,
    }, this.cache.entries);
    this.cliSessionFingerprint = currentCliFingerprint;
    this.mtimeSnapshot = currentSnapshot;
    this.lastSnapshotPaths = [...currentSnapshot.keys()];
    this.graphCache = null;
    if (this.persistence === 'filesystem') {
      this.schedulePersistence(
        this.cache,
        currentSnapshot,
        this.rebuildGeneration,
        this.incrementalManifest,
        currentCliFingerprint,
      );
    }
    return 'updated';
  }

  private changedSnapshotPaths(
    previous: ReadonlyMap<string, string>,
    current: ReadonlyMap<string, string>,
  ): string[] {
    const changed = new Set<string>();
    for (const [path, fingerprint] of previous) if (current.get(path) !== fingerprint) changed.add(path);
    for (const [path, fingerprint] of current) if (previous.get(path) !== fingerprint) changed.add(path);
    return [...changed].sort((left, right) => left.localeCompare(right));
  }

  private isIncrementalSnapshotPath(path: string): boolean {
    const rel = normalizeManifestPath(relative(this.workflowRoot, path));
    if (!rel || rel.startsWith('../') || rel === '..') return false;
    if (isCoveredSourceKind(classifySourcePath(rel))) return true;
    // Directory mtimes change when covered files are added/removed/renamed.
    // They are safe only for the local covered roots; Session/KG and unknown
    // directories remain a hard fence to the established full rebuild.
    const lower = rel.toLowerCase();
    return lower === 'specs' || lower.startsWith('specs/')
      || lower === 'knowhow' || lower.startsWith('knowhow/')
      || lower === 'issues' || lower.startsWith('issues/')
      || lower === 'domain' || lower.startsWith('domain/')
      || lower === 'codebase' || lower.startsWith('codebase/');
  }

  private async hasSourceChanges(
    snapshot = this.mtimeSnapshot,
    recordedPaths = this.lastSnapshotPaths,
    checkCli = true,
  ): Promise<boolean> {
    if (snapshot.size === 0) return true;
    // User-level transcript files are intentionally outside the file-source
    // manifest. Their parent directories do not change on append, so compare
    // the bounded discovered-file fingerprint on every warm check (and on the
    // periodic reconciliation timer) before trusting a cached generation.
    if (checkCli && this.persistence !== 'memory-only' && this.includeCliSessions) {
      const currentCliFingerprint = await this.captureCliSessionFingerprint();
      if (this.cliSessionFingerprint === null || currentCliFingerprint !== this.cliSessionFingerprint) {
        return true;
      }
    }
    // Warm-path fast check: re-stat only the paths recorded in the last
    // snapshot instead of re-running the full recursive scan. Every source
    // family the indexer can read is already represented — additions and
    // removals bump the containing directory's mtime (recorded as its own
    // entry), in-place edits bump the file's own mtime, and the WAL entry
    // tracks WAL-mode graph commits. readdirSync is disproportionately
    // expensive on some Windows setups (~1.5ms per call), which made the
    // full scan dominate warm query latency.
    if (recordedPaths === null) {
      return !snapshotsEqual(snapshot, await this.captureSourceSnapshot());
    }
    // Issue all bounded re-stat probes together. Serial synchronous stats are
    // fast on an idle machine but accumulate scheduler and filesystem stalls
    // on shared Windows hosts; concurrent libuv probes preserve the same
    // fingerprints while keeping both warm queries and publication fencing
    // deterministic under contention.
    const changes = await Promise.all(recordedPaths.map(async path => {
      const previous = snapshot.get(path);
      if (previous === undefined) return true;
      if (previous === 'm') {
        try {
          await lstat(path);
          return true;
        } catch {
          return false;
        }
      }
      if (previous === 'z') {
        try {
          return (await stat(path)).size > 0;
        } catch {
          return false;
        }
      }
      try {
        const current = await stat(path);
        return [
          current.isDirectory() ? 'd' : 'f',
          current.size,
          current.mtimeMs,
          current.ctimeMs,
        ].join(':') !== previous;
      } catch {
        return true;
      }
    }));
    return changes.some(Boolean);
  }

  /** Capture every source family the indexer can read, after realpath fencing. */
  private async captureSourceSnapshot(): Promise<Map<string, string>> {
    const snapshot = new Map<string, string>();
    const record = (path: string, sourceStat: NonNullable<ReturnType<typeof statSync>>): void => {
      snapshot.set(path, [
        sourceStat.isDirectory() ? 'd' : 'f',
        sourceStat.size,
        sourceStat.mtimeMs,
        sourceStat.ctimeMs,
      ].join(':'));
    };
    // Synchronous syscalls throughout: the snapshot is a small, bounded
    // fingerprint set (budget + maxDepth guards below), and per-entry async
    // awaits serialize libuv round-trips — each costs ~1-2ms on Windows and
    // dominates both the warm hasSourceChanges path and the cold rebuild
    // race check. Sync stats measure ~10x faster here.
    const add = (
      candidate: string,
      allowedRoot: string,
      kind: 'file' | 'directory' | 'any' = 'file',
    ): string | null => {
      const resolved = resolveAllowedSourcePathInfo(candidate, allowedRoot, kind);
      if (!resolved) {
        // Keep a bounded negative sentinel for optional source paths. Without
        // it, creating project.md (or an initially absent source directory)
        // after a warm build is invisible because none of the recorded paths
        // changes. Existing but fenced paths are deliberately not recorded:
        // they must stay unreadable and must not force perpetual rebuilds.
        const resolvedCandidate = resolve(candidate);
        try {
          lstatSync(resolvedCandidate);
        } catch {
          snapshot.set(resolvedCandidate, 'm');
        }
        return null;
      }
      record(resolved.path, resolved.stat);
      return resolved.path;
    };
    const addWal = (candidate: string, allowedRoot: string): void => {
      const resolved = resolveAllowedSourcePathInfo(candidate, allowedRoot, 'file');
      if (resolved) {
        if (resolved.stat.size === 0) snapshot.set(resolved.path, 'z');
        else record(resolved.path, resolved.stat);
        return;
      }
      const resolvedCandidate = resolve(candidate);
      try {
        // Existing but fenced paths remain unreadable and untracked.
        lstatSync(resolvedCandidate);
      } catch {
        // Read-only SQLite opens may create an empty WAL. Treat missing and
        // empty as the same source state; any committed (>0 byte) WAL fails
        // the publication fence and triggers a rebuild.
        snapshot.set(resolvedCandidate, 'z');
      }
    };
    const scan = (
      candidate: string,
      allowedRoot: string,
      accept: (name: string, path: string) => boolean,
      recurse: boolean,
      maxDepth = 32,
      depth = 0,
      skipDir?: (name: string) => boolean,
      budget?: { remaining: number },
      newestFirst = false,
    ): void => {
      if (depth > maxDepth || budget?.remaining === 0) return;
      const realDir = depth === 0
        ? add(candidate, allowedRoot, 'directory')
        : candidate;
      if (!realDir) return;
      let names: string[];
      try { names = readdirSync(realDir); } catch { return; }
      names.sort((left, right) => newestFirst
        ? right.localeCompare(left)
        : left.localeCompare(right));
      for (const name of names) {
        const child = resolveAllowedDirectSourcePathInfo(join(realDir, name), realDir, 'any');
        if (!child) continue;
        const childStat = child.stat;
        if (childStat.isDirectory()) {
          record(child.path, childStat);
          if (recurse && !skipDir?.(name)) {
            scan(
              child.path,
              allowedRoot,
              accept,
              true,
              maxDepth,
              depth + 1,
              skipDir,
              budget,
              newestFirst,
            );
          }
        } else if (childStat.isFile() && accept(name, child.path)) {
          record(child.path, childStat);
          if (budget && --budget.remaining === 0) return;
        }
      }
    };

    add(join(this.workflowRoot, 'repository.json'), this.workflowRoot);
    add(join(this.workflowRoot, 'config.json'), this.workflowRoot);
    add(join(this.workflowRoot, 'project.md'), this.workflowRoot);
    add(join(this.workflowRoot, 'roadmap.md'), this.workflowRoot);
    scan(join(this.workflowRoot, 'knowhow'), this.workflowRoot, name => name.toLowerCase().endsWith('.md'), true);
    scan(join(this.workflowRoot, 'issues'), this.workflowRoot, name => name.toLowerCase().endsWith('.jsonl'), false);
    add(join(this.workflowRoot, 'domain', 'glossary.json'), this.workflowRoot);
    add(join(this.workflowRoot, 'codebase', 'doc-index.json'), this.workflowRoot);
    add(join(this.workflowRoot, 'codebase', 'knowledge-graph.json'), this.workflowRoot);
    add(join(this.workflowRoot, 'kg', 'maestro.db'), this.workflowRoot);
    // WAL is tracked because commits in WAL mode touch the WAL (and only the
    // WAL); the SHM file is deliberately excluded — it is pure connection
    // state that the indexer's own read-only graph probes churn on every
    // open, so including it makes the snapshot unstable across a build and
    // forces the rebuild loop to spin.
    addWal(join(this.workflowRoot, 'kg', 'maestro.db-wal'), this.workflowRoot);
    scan(
      join(this.workflowRoot, 'sessions'),
      this.workflowRoot,
      name => name === 'session.json' || name === 'artifacts.json' || name === 'gates.json'
        || name === 'run.json' || name === 'report.md' || name === 'knowledge-delta.json'
        || name.endsWith('.json'),
      true,
      16,
      0,
      name => name === 'work' || name === 'tmp',
    );

    for (const scope of this.resolveSpecScopes()) {
      scan(scope.dir, scope.allowedRoot, name => name.toLowerCase().endsWith('.md'), false);
    }

    for (const lw of this.linkedWorkspaces) {
      add(join(lw.workflowRoot, 'repository.json'), lw.workflowRoot);
      if (lw.shareTypes.has('spec')) {
        scan(join(lw.workflowRoot, 'specs'), lw.workflowRoot, name => name.toLowerCase().endsWith('.md'), false);
      }
      if (lw.shareTypes.has('knowhow')) {
        scan(join(lw.workflowRoot, 'knowhow'), lw.workflowRoot, name => name.toLowerCase().endsWith('.md'), true);
      }
      if (lw.shareTypes.has('domain')) {
        add(join(lw.workflowRoot, 'domain', 'glossary.json'), lw.workflowRoot);
      }
      if (lw.shareTypes.has('codebase')) {
        add(join(lw.workflowRoot, 'codebase', 'doc-index.json'), lw.workflowRoot);
        add(join(lw.workflowRoot, 'codebase', 'knowledge-graph.json'), lw.workflowRoot);
        add(join(lw.workflowRoot, 'kg', 'maestro.db'), lw.workflowRoot);
        addWal(join(lw.workflowRoot, 'kg', 'maestro.db-wal'), lw.workflowRoot);
      }
      if (lw.shareTypes.has('session')) {
        scan(join(lw.workflowRoot, 'sessions'), lw.workflowRoot, name =>
          name === 'session.json' || name === 'artifacts.json' || name === 'gates.json'
          || name === 'run.json' || name === 'report.md' || name === 'knowledge-delta.json'
          || name.endsWith('.json'), true, 16, 0, name => name === 'work' || name === 'tmp');
      }
    }

    if (this.persistence !== 'memory-only' && this.includeCliSessions) {
      const home = homedir();
      const projectCwd = dirname(this.workflowRoot);
      const projectSlug = cwdToClaudeProjectSlug(projectCwd);
      const claudeProjectDir = join(home, '.claude', 'projects', projectSlug);
      const codexRoot = join(home, '.codex');
      // The transcript loaders independently bound and fence their selected
      // files. Directory fingerprints detect membership changes without a
      // second recursive walk over user-level history for every cache check.
      add(claudeProjectDir, claudeProjectDir, 'directory');
      add(join(codexRoot, 'session_index.jsonl'), codexRoot);
      add(join(codexRoot, 'sessions'), codexRoot, 'directory');
    }

    return snapshot;
  }

  private async tryLoadSearchCache(): Promise<boolean> {
    const cachePath = resolveAllowedSourcePath(
      join(this.workflowRoot, 'search-cache.json'),
      this.workflowRoot,
      'file',
    );
    if (!cachePath) return false;
    const indexPath = resolveAllowedSourcePath(
      join(this.workflowRoot, 'wiki-index.json'),
      this.workflowRoot,
      'file',
    );
    if (!indexPath) return false;
    const generation = this.rebuildGeneration;

    try {
      this.recordEvidence('filesystem-cache-read', 'WikiIndexer.tryLoadSearchCache.readFile');
      const [raw, indexRaw] = await Promise.all([
        readBoundedUtf8(cachePath, MAX_SEARCH_CACHE_BYTES),
        readBoundedUtf8(indexPath, MAX_SEARCH_CACHE_BYTES),
      ]);
      const cached = validateSearchCache(JSON.parse(raw));
      if (!cached) return false;
      const persistedIndex = JSON.parse(indexRaw) as unknown;
      if (!persistedIndex || typeof persistedIndex !== 'object' || Array.isArray(persistedIndex)) return false;
      const persistedRecord = persistedIndex as Record<string, unknown>;
      // Both files are one logical publication. Refuse a torn/stale companion
      // so the filesystem owner rebuilds and repairs the pair before ready.
      if (persistedRecord.version !== 3
        || persistedRecord.generatedAt !== cached.generatedAt
        || !Array.isArray(persistedRecord.entries)) return false;

      const snapshot = new Map<string, string>(cached.mtimeSnapshot);
      let cachedCliFingerprint: string | null = null;
      if (this.persistence !== 'memory-only' && this.includeCliSessions) {
        // Caches written before append-fencing are not trusted for a caller
        // with transcript authority. Requiring the field causes one safe full
        // rebuild, after which the bounded fingerprint is persisted.
        if (!cached.cliSessionFingerprint) return false;
        cachedCliFingerprint = await this.captureCliSessionFingerprint();
        if (cachedCliFingerprint !== cached.cliSessionFingerprint) return false;
        this.cliSessionFingerprint = cachedCliFingerprint;
      }
      if (sourceFingerprint(snapshot) !== cached.sourceFingerprint
        || await this.hasSourceChanges(snapshot)
        || generation !== this.rebuildGeneration) return false;

      const entries = this.rehydrateCachedEntries(cached.entries, cached.version);
      if (!entries) return false;
      let persistedManifest: SourceManifest | null = null;
      if (isIncrementalSearchIndexEnabled()) {
        persistedManifest = await readSourceManifest(
          join(this.workflowRoot, SOURCE_MANIFEST_FILE),
          this.workflowRoot,
        );
        // A manifest is a required companion when incremental mode is opted
        // in. Missing/torn/stale generations are ordinary cache misses and
        // therefore fall back to the established full scanner.
        if (!persistedManifest || persistedManifest.generation !== cached.generatedAt) return false;
        let currentManifest: SourceManifest;
        try {
          currentManifest = await buildSourceManifest(this.workflowRoot);
        } catch {
          return false;
        }
        if (!sourceManifestsContentEqual(persistedManifest, currentManifest)) return false;
      }
      // Entry IDs are part of the publication fence as well. A manifest with
      // valid file hashes but stale IDs could otherwise retain the wrong
      // projection after a rename/collision change.
      if (persistedManifest
        && !sourceManifestsEqual(persistedManifest, manifestWithEntryIds(persistedManifest, entries))) {
        return false;
      }
      // The compiled BM25F payload is an acceleration hint, never the source
      // of truth. A malformed or stale section is discarded in isolation and
      // rebuilt lazily from the validated canonical entries below.
      const expectedDocIds = new Set(entries.map(entry => entry.id));
      const expectedDocConfigKeys = new Map(
        entries.map(entry => [entry.id, getInvertedIndexConfigKey(entry)] as const),
      );
      const compiled = isCompiledSearchCacheEnabled() && cached.compiled
        ? deserializeInvertedIndex(cached.compiled, {
          expectedGeneration: cached.generatedAt,
          expectedSourceFingerprint: cached.sourceFingerprint,
          expectedDocIds,
          expectedDocConfigKeys,
        })
        : null;
      const byId = Object.create(null) as Record<string, WikiEntry>;
      const byType = {
        project: [], roadmap: [], spec: [], issue: [],
        knowhow: [], note: [], domain: [],
      } as Record<WikiNodeType, WikiEntry[]>;

      for (const entry of entries) {
        byId[entry.id] = entry;
        byType[entry.type].push(entry);
      }

      const backlinks = this.buildBacklinks(entries, byId);
      if (generation !== this.rebuildGeneration) return false;
      this.lastIndexGeneration = Math.max(this.lastIndexGeneration, cached.generatedAt);
      this.mtimeSnapshot = snapshot;
      this.lastSnapshotPaths = [...snapshot.keys()];
      this.cache = { entries, byId, byType, backlinks, generatedAt: cached.generatedAt };
      this.searchCache = compiled;
      this.incrementalManifest = persistedManifest
        ? manifestWithEntryIds(persistedManifest, entries)
        : null;
      if (this.persistence === 'memory-only' || !this.includeCliSessions) {
        this.cliSessionFingerprint = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Replace cache-era routing/display fields with the current constructor
   * authority. Version 7 is intentionally dual-read: its persisted alias is
   * used only to identify identity-less legacy links, never as result metadata.
   */
  private rehydrateCachedEntries(entries: WikiEntry[], cacheVersion: number): WikiEntry[] | null {
    const linkedByRepoId = new Map<string, typeof this.linkedWorkspaces[number]>();
    for (const linked of this.linkedWorkspaces) {
      if (linked.origin.repoId) linkedByRepoId.set(linked.origin.repoId, linked);
    }

    for (const entry of entries) {
      const repoId = entry.repoId ?? entry.source.repoId ?? null;
      let linked: typeof this.linkedWorkspaces[number] | undefined;
      if (repoId && repoId !== this.currentRepository.repoId) {
        linked = linkedByRepoId.get(repoId);
        // A cached entry from a repository that is no longer shared must never
        // survive merely because its old source path still exists.
        if (!linked) return null;
      } else if (!repoId && entry.scope === 'linked') {
        if (cacheVersion !== LEGACY_SEARCH_CACHE_VERSION) return null;
        const legacyAlias = entry.source.workspace;
        linked = legacyAlias
          ? this.linkedWorkspaces.find(candidate => candidate.name === legacyAlias
            && candidate.origin.repoId === null)
          : undefined;
        if (!linked) return null;
      } else if (repoId !== this.currentRepository.repoId) {
        return null;
      }

      if (linked) {
        if (!this.linkedEntryIsShared(entry, linked.shareTypes)) return null;
        applyRepositoryOriginToEntry(entry, linked.origin, linked.name);
        if (entry.ext.sharedVia === 'explicit-session-share') {
          entry.ext.workspaceFence = linked.origin.workspaceFence ?? `linked:${linked.name}`;
        }
      } else {
        applyRepositoryOriginToEntry(entry, this.currentRepository);
        if (entry.ext.sharedVia === 'explicit-session-share') delete entry.ext.workspaceFence;
      }
    }
    return entries;
  }

  private linkedEntryIsShared(entry: WikiEntry, shareTypes: ReadonlySet<string>): boolean {
    const sourcePath = entry.source.path.replace(/\\/g, '/');
    if (sourcePath.startsWith('sessions/')) return shareTypes.has('session');
    if (sourcePath.startsWith('specs/')) return shareTypes.has('spec');
    if (sourcePath.startsWith('knowhow/')) return shareTypes.has('knowhow');
    if (sourcePath.startsWith('domain/')) return shareTypes.has('domain');
    if (sourcePath.startsWith('codebase/') || sourcePath.startsWith('kg/')) {
      return shareTypes.has('codebase');
    }
    return false;
  }

  private async prepareSearchCache(
    index: WikiIndex,
    snapshot: ReadonlyMap<string, string>,
    cliSessionFingerprint: string | null = null,
  ): Promise<string> {
    const target = join(this.workflowRoot, 'search-cache.json');
    const tmpTarget = `${target}.tmp-${process.pid}-${randomUUID()}`;
    // Build the optional acceleration payload before opening the stream so a
    // size/serialization failure can omit it without leaving malformed JSON.
    let compiledJson: string | null = null;
    if (isCompiledSearchCacheEnabled()) {
      try {
        const compiled = serializeInvertedIndex(buildInvertedIndex(index.entries), {
          generation: index.generatedAt,
          sourceFingerprint: sourceFingerprint(snapshot),
        });
        const candidate = JSON.stringify(compiled);
        // Keep the existing bounded cache contract. A compiled section that
        // would itself exceed the read cap is treated as an opt-in miss.
        if (Buffer.byteLength(candidate, 'utf8') <= MAX_SEARCH_CACHE_BYTES) compiledJson = candidate;
      } catch {
        compiledJson = null;
      }
    }
    const cacheVersion = compiledJson ? searchCacheVersionForPublication() : LEGACY_SEARCH_CACHE_VERSION;
    let stream: ReturnType<typeof createWriteStream> | null = null;
    try {
      this.recordEvidence(
        'filesystem-cache-write',
        'WikiIndexer.persistSearchCache.createWriteStream',
      );
      stream = createWriteStream(tmpTarget, { encoding: 'utf-8', flags: 'wx' });
      const writeChunk = async (chunk: string): Promise<void> => {
        if (!stream!.write(chunk)) await once(stream!, 'drain');
      };
      await writeChunk(`{"version":${cacheVersion},"generatedAt":${index.generatedAt}`);
      await writeChunk(`,"sourceFingerprint":${JSON.stringify(sourceFingerprint(snapshot))}`);
      if (cliSessionFingerprint) {
        await writeChunk(`,"cliSessionFingerprint":${JSON.stringify(cliSessionFingerprint)}`);
      }
      await writeChunk(',"mtimeSnapshot":');
      await writeChunk(JSON.stringify([...snapshot.entries()]));
      await writeChunk(',"entries":[');
      for (let i = 0; i < index.entries.length; i++) {
        if (i > 0) await writeChunk(',');
        const entry = index.entries[i];
        const persistedExt = { ...entry.ext };
        delete persistedExt.workspaceFence;
        await writeChunk(JSON.stringify({
          id: entry.id, type: entry.type, title: entry.title, summary: entry.summary,
          tags: entry.tags, status: entry.status, created: entry.created, updated: entry.updated,
          related: entry.related,
          source: {
            kind: entry.source.kind,
            path: entry.source.path,
            ...(entry.source.line === undefined ? {} : { line: entry.source.line }),
          },
          body: entry.body, ext: persistedExt,
          scope: entry.scope, category: entry.category, specCategory: entry.specCategory,
          createdBy: entry.createdBy, sourceRef: entry.sourceRef, parent: entry.parent,
          repoId: entry.repoId, appliesToRepoIds: entry.appliesToRepoIds,
        }));
      }
      stream.end(compiledJson
        ? `],"compiled":${compiledJson}}`
        : ']}');
      await finished(stream);
      stream = null;
      return tmpTarget;
    } catch (error) {
      stream?.destroy();
      await rm(tmpTarget, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async prepareSourceManifest(manifest: SourceManifest): Promise<string> {
    const target = join(this.workflowRoot, SOURCE_MANIFEST_FILE);
    const tmpTarget = `${target}.tmp-${process.pid}-${randomUUID()}`;
    if (!validateSourceManifest(manifest, this.workflowRoot)) {
      throw new Error('refusing to publish an invalid source manifest');
    }
    try {
      await writeFile(tmpTarget, JSON.stringify(manifest, null, 2), { encoding: 'utf-8', flag: 'wx' });
      return tmpTarget;
    } catch (error) {
      await rm(tmpTarget, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async rebuild(): Promise<WikiIndex> {
    if (this.inflight) return this.inflight;
    // An explicit rebuild is itself a new generation. Once a flight exists,
    // later invalidations only mark it dirty; they never start a second scan.
    this.invalidate();
    const flight = this.rebuildUntilCurrent();
    this.inflight = flight;
    try {
      return await flight;
    } finally {
      if (this.inflight === flight) this.inflight = null;
    }
  }

  private async buildIndexCandidate(): Promise<WikiIndex> {
      // Parallel: file scan + virtual entries + linked workspaces
      const [fileEntries, virtualEntries, linkedEntries] = await Promise.all([
        this.scanFiles(),
        this.scanVirtual(),
        this.scanLinkedWorkspaces(),
      ]);
      applyRepositoryOrigin(fileEntries, this.currentRepository);
      applyRepositoryOrigin(virtualEntries, this.currentRepository);
      const entries = [...fileEntries, ...virtualEntries, ...linkedEntries];

      // Sort entries by id first, then by source priority (file > virtual >
      // linked) for deterministic collision suffixing — the same logical entry
      // always gets the same suffixed id regardless of scan order.
      const sourcePriority = (e: WikiEntry): number =>
        e.source.workspace ? 2 : e.source.kind === 'virtual' ? 1 : 0;
      entries.sort((a, b) => a.id.localeCompare(b.id) || sourcePriority(a) - sourcePriority(b));

      // IDs are normally unique (notably for prefixed KG projections). Detect
      // the rare duplicate case from the sorted sequence before allocating
      // grouping arrays, maps, and rewritten edge objects for every entry.
      let hasCollisions = false;
      for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1].id === entries[index].id) {
          hasCollisions = true;
          break;
        }
      }
      const debugCollisions = process.env.MAESTRO_DEBUG === '1';
      let collisionCount = 0;
      let resolveCollisionRef = (_owner: WikiEntry, target: string): string => target;
      if (hasCollisions) {
        const entriesByOriginalId = new Map<string, WikiEntry[]>();
        for (const entry of entries) {
          const group = entriesByOriginalId.get(entry.id) ?? [];
          group.push(entry);
          entriesByOriginalId.set(entry.id, group);
        }
        const seen = new Map<string, number>();
        for (const d of entries) {
          const original = d.id;
          const n = seen.get(original) ?? 0;
          if (n > 0) {
            if (debugCollisions) {
              // eslint-disable-next-line no-console
              console.warn(`[wiki-indexer] id collision '${original}' — suffixing to ${original}-${n + 1}`);
            }
            d.id = `${original}-${n + 1}`;
            collisionCount++;
          }
          seen.set(original, n + 1);
        }
        resolveCollisionRef = (owner: WikiEntry, target: string): string => {
          const candidates = entriesByOriginalId.get(target);
          if (!candidates || candidates.length === 0) return target;
          if (candidates.length === 1) return candidates[0].id;
          const sameWorkspace = candidates.filter(candidate => candidate.source.workspace === owner.source.workspace);
          const sameSource = sameWorkspace.find(candidate => candidate.source.path === owner.source.path);
          return sameSource?.id ?? sameWorkspace[0]?.id ?? candidates[0].id;
        };
        for (const entry of entries) {
          entry.related = entry.related.map(target => resolveCollisionRef(entry, target));
          if (entry.parent) entry.parent = resolveCollisionRef(entry, entry.parent);
          const kgEdges = entry.ext?.kgEdges;
          if (Array.isArray(kgEdges)) {
            entry.ext.kgEdges = kgEdges.map(edge => {
              if (!edge || typeof edge !== 'object') return edge;
              const typed = edge as Record<string, unknown>;
              const target = typeof typed.target === 'string'
                ? resolveCollisionRef(entry, typed.target)
                : typed.target;
              return { ...typed, target };
            });
          }
        }
      }

      // Session lifecycle promotion refs are projected by the virtual adapter.
      // Avoid the resolved-ID map and promotion machinery for the overwhelmingly
      // common session-free corpus.
      const sessionEntries = entries.filter(entry => entry.ext?.virtualKind === 'session');
      if (sessionEntries.length > 0) {
        const entriesByResolvedId = new Map(entries.map(entry => [entry.id, entry]));
        const resolvePromotedEntry = (owner: WikiEntry, ref: string): WikiEntry | null => {
          const value = ref.trim();
          const directId = resolveCollisionRef(owner, value);
          const direct = entriesByResolvedId.get(directId);
          if (
            direct
            && direct.source.workspace === owner.source.workspace
            && (direct.type === 'spec' || direct.type === 'knowhow')
          ) return direct;

          const typedRef = value.match(/^(spec|knowhow):(.+)$/);
          if (typedRef) {
            const [, type, payload] = typedRef;
            const candidates = entries.filter(entry =>
              entry.type === type
              && entry.source.workspace === owner.source.workspace
              && entry.ext?.virtualKind !== 'session'
              && entry.ext?.virtualKind !== 'session-run'
              && (entry.sourceRef === payload
                || entry.id === payload
                || entry.ext?.sid === payload
                || entry.ext?.explicitId === payload));
            if (candidates.length > 0) {
              const sameSource = candidates.find(candidate => candidate.source.path === owner.source.path);
              return sameSource ?? candidates[0];
            }
          }

          const fallbackId = promotedRefToWikiId(value);
          if (!fallbackId) return null;
          const fallback = entriesByResolvedId.get(resolveCollisionRef(owner, fallbackId));
          return fallback
            && fallback.source.workspace === owner.source.workspace
            && (fallback.type === 'spec' || fallback.type === 'knowhow')
            ? fallback
            : null;
        };
        for (const sessionEntry of sessionEntries) {
          const sessionId = sessionEntry.ext?.sessionId;
          const promotedRefs = sessionEntry.ext?.promotedRefs;
          if (typeof sessionId !== 'string' || !Array.isArray(promotedRefs)) continue;

          const sourceSessionId = resolveCollisionRef(sessionEntry, `session-${slugify(sessionId)}`);
          for (const promotedRef of promotedRefs) {
            if (typeof promotedRef !== 'string') continue;
            const promotedEntry = resolvePromotedEntry(sessionEntry, promotedRef);
            if (!promotedEntry) continue;
            if (!sessionEntry.related.includes(promotedEntry.id)) {
              sessionEntry.related.push(promotedEntry.id);
            }
            if (!promotedEntry.related.includes(sourceSessionId)) {
              promotedEntry.related.push(sourceSessionId);
            }
          }
        }
      }
      if (collisionCount > 0 && debugCollisions) {
        // eslint-disable-next-line no-console
        console.warn(`[wiki-indexer] ${collisionCount} id collision(s) resolved by suffixing`);
      }

      const byId: Record<string, WikiEntry> = {};
      const byType = {
        project: [],
        roadmap: [],
        spec: [],
        issue: [],
        knowhow: [],
        note: [],
        domain: [],
      } as Record<WikiNodeType, WikiEntry[]>;

      for (const d of entries) {
        byId[d.id] = d;
        byType[d.type].push(d);
      }

      const backlinks = this.buildBacklinks(entries, byId);
      const index: WikiIndex = {
        entries,
        byId,
        byType,
        backlinks,
        generatedAt: this.allocateIndexGeneration(),
      };
      return index;
  }

  private async rebuildUntilCurrent(): Promise<WikiIndex> {
    for (;;) {
      if (this.closing) throw new Error('wiki indexer is closing');
      const generation = this.rebuildGeneration;
      const snapshot = await this.captureSourceSnapshot();
      const cliFingerprintBefore = await this.captureCliSessionFingerprint();
      let sourceManifest: SourceManifest | null = null;
      if (isIncrementalSearchIndexEnabled()) {
        try {
          sourceManifest = await buildSourceManifest(this.workflowRoot);
        } catch {
          // Hashing is an optimization/fence for the opt-in path. A malformed
          // or concurrently changing manifest must never prevent the existing
          // full scanner from producing a usable in-memory index.
          sourceManifest = null;
        }
      }
      const index = await this.buildIndexCandidate();
      if (this.closing) throw new Error('wiki indexer is closing');
      // Re-stat the securely resolved manifest captured before the build.
      // Directory fingerprints detect membership changes and negative
      // sentinels detect newly created optional roots, avoiding a second full
      // realpath/enumeration pass without weakening publication fencing.
      const cliFingerprintAfter = await this.captureCliSessionFingerprint();
      if (
        generation !== this.rebuildGeneration
        || await this.hasSourceChanges(snapshot, [...snapshot.keys()], false)
        || cliFingerprintAfter !== cliFingerprintBefore
      ) continue;
      if (sourceManifest) {
        try {
          const afterManifest = await buildSourceManifest(this.workflowRoot);
          if (!sourceManifestsContentEqual(sourceManifest, afterManifest)) continue;
        } catch {
          continue;
        }
        sourceManifest = manifestWithEntryIds({
          ...sourceManifest,
          generation: index.generatedAt,
        }, index.entries);
      }

      this.mtimeSnapshot = snapshot;
      this.lastSnapshotPaths = [...snapshot.keys()];
      this.cliSessionFingerprint = cliFingerprintAfter;
      this.cache = index;
      this.graphCache = null;
      this.searchCache = null;
      this.incrementalManifest = sourceManifest;
      if (this.persistence === 'filesystem') {
        this.schedulePersistence(
          index,
          snapshot,
          generation,
          isIncrementalSearchIndexEnabled() ? sourceManifest : undefined,
          cliFingerprintAfter,
        );
      }
      return index;
    }
  }

  private schedulePersistence(
    index: WikiIndex,
    snapshot: Map<string, string>,
    generation: number,
    manifest?: SourceManifest | null,
    cliSessionFingerprint?: string | null,
  ): void {
    if (this.closing) return;
    // Keep at most one writer and one coalesced latest candidate. Slow disk I/O
    // never blocks readers or permits an older generation to publish afterward.
    this.pendingPersistence = { index, snapshot, generation, manifest, cliSessionFingerprint };
    this.ensurePersistenceDrain();
  }

  private ensurePersistenceDrain(): void {
    if (this.persistenceInflight) return;
    const flight = this.drainPersistence();
    this.persistenceInflight = flight;
    const settle = () => {
      if (this.persistenceInflight === flight) this.persistenceInflight = null;
      if (this.pendingPersistence) this.ensurePersistenceDrain();
    };
    void flight.then(settle, settle);
  }

  private async drainPersistence(): Promise<void> {
    while (this.pendingPersistence && !this.closing) {
      const pending = this.pendingPersistence;
      this.pendingPersistence = null;
      if (pending.generation !== this.rebuildGeneration) continue;

      let indexTemp: string | null = null;
      let cacheTemp: string | null = null;
      let manifestTemp: string | null = null;
      let publicationLock: PublicationLock | null = null;
      try {
        const prepared = await Promise.all([
          this.prepareIndex(pending.index),
          this.prepareSearchCache(pending.index, pending.snapshot, pending.cliSessionFingerprint ?? null),
          ...(pending.manifest ? [this.prepareSourceManifest(pending.manifest)] : []),
        ]);
        indexTemp = prepared[0];
        cacheTemp = prepared[1];
        manifestTemp = pending.manifest ? prepared[2] ?? null : null;
        publicationLock = await acquirePublicationLock(this.workflowRoot);
        if (!publicationLock || pending.generation !== this.rebuildGeneration || this.closing) continue;

        const currentSnapshot = await this.captureSourceSnapshot();
        const currentCliFingerprint = await this.captureCliSessionFingerprint();
        let sourceManifestChanged = false;
        if (pending.manifest) {
          try {
            const currentManifest = await buildSourceManifest(this.workflowRoot);
            sourceManifestChanged = !sourceManifestsContentEqual(pending.manifest, currentManifest);
          } catch {
            sourceManifestChanged = true;
          }
        }
        const cliFingerprintChanged = this.persistence !== 'memory-only'
          && this.includeCliSessions
          && currentCliFingerprint !== (pending.cliSessionFingerprint ?? null);
        if (sourceManifestChanged || cliFingerprintChanged || !snapshotsEqual(currentSnapshot, pending.snapshot)) {
          if (process.env.MAESTRO_DEBUG === '1') {
            const changed = [...new Set([
              ...[...pending.snapshot.keys()].filter(path => currentSnapshot.get(path) !== pending.snapshot.get(path)),
              ...[...currentSnapshot.keys()].filter(path => pending.snapshot.get(path) !== currentSnapshot.get(path)),
            ])];
            console.warn('[wiki-indexer] source changed before protected publication:', changed.slice(0, 10));
          }
          if (pending.generation === this.rebuildGeneration && existsSync(this.workflowRoot)) {
            this.invalidate();
            setImmediate(() => {
              if (existsSync(this.workflowRoot)) void this.rebuild().catch(() => undefined);
            });
          }
          continue;
        }

        renameSync(indexTemp, join(this.workflowRoot, 'wiki-index.json'));
        indexTemp = null;
        renameSync(cacheTemp, join(this.workflowRoot, 'search-cache.json'));
        cacheTemp = null;
        if (manifestTemp && pending.manifest) {
          renameSync(manifestTemp, join(this.workflowRoot, SOURCE_MANIFEST_FILE));
          manifestTemp = null;
        } else if (pending.manifest === null) {
          try { unlinkSync(join(this.workflowRoot, SOURCE_MANIFEST_FILE)); } catch { /* already absent */ }
        }
      } catch (error) {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.warn('[wiki-indexer] protected publication failed:', (error as Error)?.message);
        }
      } finally {
        releasePublicationLock(this.workflowRoot, publicationLock);
        if (indexTemp) await rm(indexTemp, { force: true }).catch(() => undefined);
        if (cacheTemp) await rm(cacheTemp, { force: true }).catch(() => undefined);
        if (manifestTemp) await rm(manifestTemp, { force: true }).catch(() => undefined);
      }
    }
  }

  invalidate(_changedAbsPath?: string): void {
    this.rebuildGeneration++;
    this.cache = null;
    this.graphCache = null;
    this.searchCache = null;
    this.embeddingCache = null;
    this.embeddingSeed = null;
    this.incrementalManifest = null;
    this.cliSessionFingerprint = null;
    this.embeddingGeneration++;
    this.embeddingAbort?.abort();
  }

  /** Abort and join background index work before a daemon releases ownership. */
  async close(options?: WikiIndexerCloseOptions): Promise<void> {
    if (!this.closing) {
      this.closing = true;
      if (this.reconciliationTimer) {
        clearInterval(this.reconciliationTimer);
        this.reconciliationTimer = null;
      }
      this.pendingPersistence = null;
      this.rebuildGeneration++;
      this.embeddingGeneration++;
      this.embeddingAbort?.abort();
    }
    await Promise.allSettled([
      this.inflight ?? Promise.resolve(null),
      this.incrementalInflight ?? Promise.resolve('fallback' as const),
      this.embeddingInflight ?? Promise.resolve(null),
      this.persistenceInflight ?? Promise.resolve(),
    ]);
    if (options?.disposeEmbeddingPipeline) {
      const { disposeEmbeddingPipeline } = await import('./embedding.js');
      await disposeEmbeddingPipeline();
    }
  }

  async query(filters: WikiFilters): Promise<WikiEntry[]> {
    const index = await this.get();
    // Non-q filters first (cheap), then BM25 if q is present.
    const base = filterEntries(index.entries, { ...filters, q: undefined });
    if (!filters.q || !filters.q.trim()) return base;
    const bm25 = await this.getSearchIndex();
    const ranked = searchBM25(bm25, filters.q);
    const allowed = new Set(base.map((d) => d.id));
    let out: Array<{ entry: WikiEntry; score: number }> = [];
    for (const r of ranked) {
      if (allowed.has(r.docId) && index.byId[r.docId]) {
        out.push({ entry: index.byId[r.docId], score: r.score });
      }
    }
    out = rerankByPhraseProximity(out, filters.q);
    out = applyTimeDecay(out, Date.now());
    return out.map(o => o.entry);
  }

  async groups(filters?: WikiFilters): Promise<Record<WikiNodeType, WikiEntry[]>> {
    const source = filters ? await this.query(filters) : (await this.get()).entries;
    const out: Record<WikiNodeType, WikiEntry[]> = {
      project: [],
      roadmap: [],
      spec: [],
      issue: [],
      knowhow: [],
      note: [],
      domain: [],
    };
    for (const d of source) out[d.type].push(d);
    return out;
  }

  async getGraph(): Promise<WikiGraph> {
    if (this.graphCache) return this.graphCache;
    const index = await this.get();
    this.graphCache = buildGraph(index);
    return this.graphCache;
  }

  async getSearchIndex(): Promise<InvertedIndex> {
    return (await this.getSearchIndexWithMeta()).index;
  }

  async getSearchIndexWithMeta(): Promise<{
    index: InvertedIndex;
    cacheState: 'cold-build' | 'cache-hit';
  }> {
    if (this.searchCache) {
      return { index: this.searchCache, cacheState: 'cache-hit' };
    }
    const index = await this.get();
    if (this.searchCache) {
      return { index: this.searchCache, cacheState: 'cache-hit' };
    }
    this.searchCache = buildInvertedIndex(index.entries);
    return { index: this.searchCache, cacheState: 'cold-build' };
  }

  async searchWithScores(
    query: string,
    limit = 50,
    options?: WikiSearchOptions,
  ): Promise<Array<{ entry: WikiEntry; score: number }>> {
    return (await this.searchWithMeta(query, limit, options)).results;
  }

  async recallSnapshot(query: string, asOf: string, limit = 50): Promise<RecallSnapshot> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Recall snapshot query must not be empty.');
    const parsedAsOf = new Date(asOf);
    if (!Number.isFinite(parsedAsOf.getTime()) || parsedAsOf.toISOString() !== asOf) {
      throw new Error('Recall snapshot as_of must be a canonical ISO timestamp.');
    }
    const index = await this.get();
    const bm25 = await this.getSearchIndex();
    const ranked = searchBM25Planned(bm25, normalizedQuery, Math.max(0, limit));
    const candidates = ranked
      .map(result => ({ result, entry: index.byId[result.docId] }))
      .filter((item): item is { result: { docId: string; score: number }; entry: WikiEntry } => Boolean(item.entry))
      .map(({ result, entry }) => ({
        entry_id: entry.id,
        score_bp: Math.max(0, Math.round(result.score * 10_000)),
        raw_bm25: result.score,
        source_workspace: entry.source.workspace ?? null,
        workspace_fence: entry.workspaceFence ?? entry.source.workspaceFence
          ?? (entry.source.workspace ? `linked:${entry.source.workspace}` : null),
        fork_authorized: false as const,
        resume_authorized: false as const,
      }))
      .sort((left, right) => right.score_bp - left.score_bp || left.entry_id.localeCompare(right.entry_id))
      .slice(0, Math.max(0, limit));
    return recallSnapshotSchema.parse({
      schema_version: 'wiki-recall-snapshot/1.0',
      query: normalizedQuery,
      as_of: asOf,
      automatic: false,
      mutation_authorized: false,
      scoring: { provider: 'bm25', embedding_weight_bp: 0, tie_break: 'entry_id_asc' },
      candidates,
    });
  }

  async searchWithMeta(query: string, limit = 50, options?: WikiSearchOptions): Promise<{
    results: Array<{ entry: WikiEntry; score: number }>;
    embeddingUsed: boolean;
    embeddingDocs: number;
    /** Present only when a request-local diagnostics sink was supplied. */
    diagnostics?: WikiSearchDiagnosticsSnapshot;
  }> {
    const signal = options?.signal;
    const diagnostics = options?.diagnostics;
    diagnostics?.setProvider?.('indexer');
    throwIfSearchAborted(signal);
    const index = await (diagnostics
      ? (async () => {
        const startedAt = performance.now();
        try { return await awaitWithSearchAbort(this.get(), signal); }
        finally { diagnostics.recordPhase?.('index-load', performance.now() - startedAt); }
      })()
      : awaitWithSearchAbort(this.get(), signal));

    // Parallel: BM25 index build + embedding index load. Cache/index flights remain
    // shared, but a disconnected caller no longer retains its request lifecycle.
    const [searchIndexResult, embIdx] = await Promise.all([
      diagnostics
        ? (async () => {
          const startedAt = performance.now();
          try { return await this.getSearchIndexWithMeta(); }
          finally { diagnostics.recordPhase?.('search-index', performance.now() - startedAt); }
        })()
        : this.getSearchIndexWithMeta(),
      options?.skipEmbedding || this.persistence !== 'filesystem'
        ? null
        : diagnostics
          ? (async () => {
            const startedAt = performance.now();
            try { return await awaitWithSearchAbort(this.getEmbeddingIndex(), signal); }
            finally { diagnostics.recordPhase?.('embedding-index', performance.now() - startedAt); }
          })()
          : awaitWithSearchAbort(this.getEmbeddingIndex(), signal),
    ]);
    const bm25 = searchIndexResult.index;
    diagnostics?.setCacheState?.(searchIndexResult.cacheState === 'cache-hit' ? 'hit' : 'miss');
    if (searchIndexResult.cacheState === 'cold-build') diagnostics?.recordFallback?.('cache', 'miss');
    if (!embIdx && !options?.skipEmbedding && this.persistence === 'filesystem') {
      diagnostics?.recordFallback?.('embedding', 'unavailable');
    }
    throwIfSearchAborted(signal);
    const boundaryBudget = options?.candidateBudget
      ?? (isAdaptiveSearchBudgetEnabled()
        ? computeSearchCandidateBudget(limit, { surface: 'indexer', mode: 'adaptive' })
        : undefined);
    const adaptiveBudget = boundaryBudget?.adaptive
      ? boundaryBudget as SearchCandidateBudget
      : undefined;
    const internalLimit = adaptiveBudget?.candidateLimit
      ?? Math.min(500, Math.max(limit * 3, 60));
    if (boundaryBudget) {
      diagnostics?.setCandidateBudget?.({
        mode: boundaryBudget.mode,
        requestedLimit: boundaryBudget.resultLimit,
        initialCandidateLimit: boundaryBudget.initialCandidateLimit,
        candidateLimit: boundaryBudget.candidateLimit,
        hardCap: boundaryBudget.maxCandidateLimit,
        escalated: boundaryBudget.escalated,
        legacyCandidateLimit: boundaryBudget.legacyCandidateLimit,
      });
    }
    diagnostics?.setCandidateCount?.(internalLimit);
    const allowedDocIds = options?.filters
      ? new Set(index.entries
          .filter(entry => matchesSearchFilters(entry, options.filters!))
          .map(entry => entry.id))
      : undefined;
    const bm25StartedAt = performance.now();
    const bm25Results = adaptiveBudget
      ? searchBM25Planned(
        bm25,
        query,
        internalLimit,
        options?.credibilityFactors,
        allowedDocIds,
        adaptiveBudget,
      )
      : searchBM25Planned(
        bm25,
        query,
        internalLimit,
        options?.credibilityFactors,
        allowedDocIds,
      );
    diagnostics?.recordPhase?.('bm25-search', performance.now() - bm25StartedAt, internalLimit);

    if (embIdx && embIdx.docIds.length > 0) {
      try {
        const { embedQuery, vectorSearch, vectorSearchZvec, mapVectorResultsToParents, mergeHybrid } = await import('./embedding.js');
        const embeddingStartedAt = performance.now();
        const qVec = await embedQuery(query, signal);
        throwIfSearchAborted(signal);
        // zvec exposes no cancellation primitive. Keep this native query
        // attached to the request so daemon drain cannot release descriptor
        // ownership while the collection is still live.
        // Structured indexes may contain many fragments for one parent.
        // Over-fetch raw fragments once, then collapse to parents, so one long
        // document cannot consume the entire candidate pool before fusion.
        const vectorCandidateLimit = embIdx.fragments
          ? Math.min(500, Math.max(internalLimit, internalLimit * 4))
          : internalLimit;
        let rawVecResults = allowedDocIds
          ? vectorSearch(qVec, embIdx, vectorCandidateLimit, allowedDocIds)
          : await vectorSearchZvec(
            qVec,
            this.workflowRoot,
            vectorCandidateLimit,
            embIdx.fragments
              ? new Map(embIdx.fragments.map(fragment => [fragment.fragmentId, fragment] as const))
              : undefined,
          );
        throwIfSearchAborted(signal);
        if (rawVecResults.length === 0 && !allowedDocIds) {
          rawVecResults = vectorSearch(qVec, embIdx, vectorCandidateLimit);
        }

        // Internal fragment/chunk hits are collapsed to their existing parent
        // IDs before fusion; the highest-scoring fragment retains evidence.
        const vecResults = mapVectorResultsToParents(rawVecResults, embIdx, internalLimit);

        const merged = mergeHybrid(bm25Results, vecResults, internalLimit);
        const results = finalizeSearchResults(
          index,
          merged,
          query,
          limit,
          options?.filters?.includeDeprecated === true,
        );
        diagnostics?.recordPhase?.('embedding-search', performance.now() - embeddingStartedAt, internalLimit);
        diagnostics?.setEmbedding?.(true, embIdx.docIds.length);
        diagnostics?.setEligibleCandidateCount?.(results.length);
        diagnostics?.setResultCount?.(results.length);
        const adaptiveCounts: SearchCandidateCounts = {
          candidateCount: Math.max(bm25Results.length, vecResults.length),
          uniqueCandidateCount: new Set([...bm25Results, ...vecResults].map(result => result.docId)).size,
          eligibleUniqueCount: results.length,
          saturated: Math.max(bm25Results.length, vecResults.length) >= internalLimit,
        };
        if (adaptiveBudget && shouldEscalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts)) {
          const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts);
          if (nextBudget !== adaptiveBudget) {
            diagnostics?.recordFallback?.('candidate-budget', 'escalated');
            diagnostics?.setCandidateBudget?.({
              mode: nextBudget.mode,
              requestedLimit: nextBudget.resultLimit,
              initialCandidateLimit: nextBudget.initialCandidateLimit,
              candidateLimit: nextBudget.candidateLimit,
              hardCap: nextBudget.maxCandidateLimit,
              escalated: nextBudget.escalated,
              legacyCandidateLimit: nextBudget.legacyCandidateLimit,
            });
            return this.searchWithMeta(query, limit, { ...options, candidateBudget: nextBudget });
          }
        }
        const diagnosticSnapshot = diagnostics?.snapshot?.();
        return {
          results,
          embeddingUsed: true,
          embeddingDocs: embIdx.docIds.length,
          ...(diagnosticSnapshot ? { diagnostics: diagnosticSnapshot } : {}),
        };
      } catch (e: unknown) {
        if (signal?.aborted) throw searchAbortError(signal);
        diagnostics?.recordFallback?.('embedding', 'query-failed');
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[embedding] query failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    throwIfSearchAborted(signal);
    const results = finalizeSearchResults(
      index,
      bm25Results,
      query,
      limit,
      options?.filters?.includeDeprecated === true,
    );
    diagnostics?.setEmbedding?.(false, 0);
    diagnostics?.setEligibleCandidateCount?.(results.length);
    diagnostics?.setResultCount?.(results.length);
    const adaptiveCounts: SearchCandidateCounts = {
      candidateCount: bm25Results.length,
      uniqueCandidateCount: new Set(bm25Results.map(result => result.docId)).size,
      eligibleUniqueCount: results.length,
      saturated: bm25Results.length >= internalLimit,
    };
    if (adaptiveBudget && shouldEscalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts)) {
      const nextBudget = escalateSearchCandidateBudget(adaptiveBudget, adaptiveCounts);
      if (nextBudget !== adaptiveBudget) {
        diagnostics?.recordFallback?.('candidate-budget', 'escalated');
        if (nextBudget) {
          diagnostics?.setCandidateBudget?.({
            mode: nextBudget.mode,
            requestedLimit: nextBudget.resultLimit,
            initialCandidateLimit: nextBudget.initialCandidateLimit,
            candidateLimit: nextBudget.candidateLimit,
            hardCap: nextBudget.maxCandidateLimit,
            escalated: nextBudget.escalated,
            legacyCandidateLimit: nextBudget.legacyCandidateLimit,
          });
        }
        return this.searchWithMeta(query, limit, { ...options, candidateBudget: nextBudget });
      }
    }
    const diagnosticSnapshot = diagnostics?.snapshot?.();
    return {
      results,
      embeddingUsed: false,
      embeddingDocs: 0,
      ...(diagnosticSnapshot ? { diagnostics: diagnosticSnapshot } : {}),
    };
  }

  async getEmbeddingIndex(): Promise<EmbeddingIndex | null> {
    if (this.persistence !== 'filesystem' || this.closing) return null;
    // A long-lived daemon may receive a flag change between requests. Never
    // serve an artifact produced by the opposite chunk policy from memory.
    const structuredMode = isStructuredChunksEnabled();
    if (this.embeddingCache && (structuredMode
      ? this.embeddingCache.policyChecksum !== STRUCTURED_FRAGMENT_POLICY_CHECKSUM
      : this.embeddingCache.policyChecksum !== undefined)) {
      this.embeddingCache = null;
      this.embeddingSeed = null;
    }
    if (this.embeddingCache) return this.embeddingCache;
    if (this.embeddingInflight) return this.embeddingInflight;

    const flight = this.buildEmbeddingsUntilCurrent();
    this.embeddingInflight = flight;
    try {
      return await flight;
    } finally {
      if (this.embeddingInflight === flight) this.embeddingInflight = null;
    }
  }

  private async buildEmbeddingsUntilCurrent(): Promise<EmbeddingIndex | null> {
    while (!this.closing) {
      const generation = this.embeddingGeneration;
      const abort = new AbortController();
      this.embeddingAbort = abort;
      const result = await this.loadOrBuildEmbeddings(abort.signal);
      if (this.embeddingAbort === abort) this.embeddingAbort = null;
      if (this.closing) return null;
      if (abort.signal.aborted || generation !== this.embeddingGeneration) continue;
      this.embeddingCache = result;
      this.embeddingSeed = null;
      return result;
    }
    return null;
  }

  private async loadOrBuildEmbeddings(signal?: AbortSignal): Promise<EmbeddingIndex | null> {
    try {
      const { isAvailable, getUnavailableReason, loadEmbeddingIndex, buildEmbeddingIndex, saveEmbeddingIndex } = await import('./embedding.js');
      if (signal?.aborted) return null;
      if (!await isAvailable()) {
        const reason = getUnavailableReason?.() ?? 'unknown';
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[embedding] unavailable: ${reason}`);
        }
        return null;
      }

      this.recordEvidence(
        'filesystem-cache-read',
        'WikiIndexer.loadOrBuildEmbeddings.loadEmbeddingIndex',
      );
      // An incremental update may retain a partial vector seed in memory;
      // prefer a persisted complete index when available, otherwise let the
      // embedding builder fill changed/new document ranges from the seed.
      const cached = loadEmbeddingIndex(this.workflowRoot) ?? this.embeddingSeed;
      if (signal?.aborted) return null;
      const index = await this.get();
      if (signal?.aborted) return null;

      // KG nodes: include high/medium semantic density types, skip low-density bulk
      const KG_EMBED_NODE_TYPES = new Set(['module', 'class', 'kg-layer', 'kg-tour-step']);
      const KG_SKIP_NODE_TYPES = new Set(['file', 'function', 'interface', 'type', 'const', 'enum']);

      const docs: Array<{
        id: string;
        title: string;
        summary: string;
        tags: string[];
        body: string;
        kind?: 'markdown' | 'text' | 'code';
        filePath?: string | null;
        symbol?: string | null;
        qualifiedName?: string | null;
        signature?: string | null;
        language?: string | null;
        definition?: string | null;
        sourceType?: string | null;
        startLine?: number;
        endLine?: number;
      }> = [];
      for (let i = 0; i < index.entries.length; i++) {
        if (i % 256 === 0 && signal?.aborted) return null;
        const e = index.entries[i];
        const vk = e.ext?.virtualKind as string | undefined;
        if (vk === 'kg-node') {
          const nt = e.ext?.nodeType as string | undefined;
          if (nt && KG_SKIP_NODE_TYPES.has(nt)) continue;
          if (!nt || !KG_EMBED_NODE_TYPES.has(nt)) continue;
        }
        const baseDoc = vk === 'kg-node' || vk === 'kg-layer' || vk === 'kg-tour-step'
          ? this.enrichKgDocForEmbedding(e, index)
          : { id: e.id, title: e.title, summary: e.summary, tags: e.tags, body: e.body };
        // Structured code fragments consume only facts already projected by
        // MaestroGraph. No parser or zvec-grep path is introduced here.
        const raw = e.raw && typeof e.raw === 'object'
          ? e.raw as Record<string, unknown>
          : undefined;
        const sourceType = typeof e.ext?.sourceType === 'string'
          ? e.ext.sourceType
          : typeof raw?.source_type === 'string' ? raw.source_type : undefined;
        const isCodeGraph = vk === 'kg-node' && sourceType === 'codegraph';
        docs.push({
          ...baseDoc,
          ...(isCodeGraph ? {
            kind: 'code' as const,
            filePath: typeof e.ext?.filePath === 'string' ? e.ext.filePath : null,
            symbol: typeof e.ext?.qualifiedName === 'string' && e.ext.qualifiedName
              ? e.ext.qualifiedName : e.title,
            qualifiedName: typeof e.ext?.qualifiedName === 'string' ? e.ext.qualifiedName : null,
            signature: typeof e.ext?.signature === 'string' ? e.ext.signature : null,
            language: typeof e.ext?.language === 'string' ? e.ext.language : null,
            definition: typeof raw?.definition === 'string' ? raw.definition : null,
            sourceType,
            ...(typeof e.ext?.startLine === 'number' ? { startLine: e.ext.startLine } : {}),
            ...(typeof e.ext?.endLine === 'number' ? { endLine: e.ext.endLine } : {}),
          } : {}),
        });
      }

      const { getModelId, hashDocContent } = await import('./embedding.js');
      const activeModel = getModelId();
      const modelMatch = cached && cached.modelId === activeModel;
      const currentHashes = modelMatch ? docs.map(d => hashDocContent(d)) : undefined;

      if (currentHashes && cached) {
        // Build per-doc hash map from cached index (handles both chunk-based and legacy formats)
        const cachedHashMap = new Map<string, string>();
        if (cached.contentHashes) {
          if (cached.chunkDocIds) {
            // Chunk-based index: extract per-doc hash from first chunk of each doc
            const docSeen = new Set<string>();
            for (let i = 0; i < cached.chunkDocIds.length; i++) {
              const pid = cached.chunkDocIds[i];
              if (!docSeen.has(pid)) {
                docSeen.add(pid);
                cachedHashMap.set(pid, cached.contentHashes[i] ?? '');
              }
            }
          } else {
            // Legacy: docIds are 1:1 with docs
            for (let i = 0; i < cached.docIds.length; i++) {
              cachedHashMap.set(cached.docIds[i], cached.contentHashes[i] ?? '');
            }
          }
        }
        const cachedDocCount = cached.chunkDocIds
          ? new Set(cached.chunkDocIds).size
          : cached.docIds.length;
        const unchanged = cachedDocCount === docs.length
          && cachedHashMap.size > 0
          && docs.every((d, i) => cachedHashMap.get(d.id) === currentHashes[i]);
        if (unchanged) return cached;
      }

      try {
        if (signal?.aborted) return cached ?? null;
        this.recordEvidence(
          'embedding-build',
          'WikiIndexer.loadOrBuildEmbeddings.buildEmbeddingIndex',
        );
        const embIdx = await buildEmbeddingIndex(docs, cached, currentHashes, signal);
        if (signal?.aborted) return null;
        this.recordEvidence(
          'embedding-save',
          'WikiIndexer.loadOrBuildEmbeddings.saveEmbeddingIndex',
        );
        await saveEmbeddingIndex(embIdx, this.workflowRoot, signal);
        return embIdx;
      } catch (buildErr: unknown) {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[embedding] build failed: ${buildErr instanceof Error ? buildErr.message : buildErr}`);
        }
        if (cached) return cached;
        return null;
      }
    } catch (e: unknown) {
      if (process.env.MAESTRO_DEBUG === '1') {
        console.error(`[embedding] unavailable: ${e instanceof Error ? e.message : e}`);
      }
      return null;
    }
  }

  private enrichKgDocForEmbedding(
    e: WikiEntry,
    index: WikiIndex,
  ): { id: string; title: string; summary: string; tags: string[]; body: string } {
    const parts: string[] = [];
    const nt = (e.ext?.nodeType as string) || (e.ext?.virtualKind as string) || '';
    const fp = e.ext?.filePath as string | undefined;

    if (nt) parts.push(`[${nt}]`);
    parts.push(e.title);
    if (e.summary) parts.push(e.summary);
    if (fp) parts.push(`file: ${fp}`);

    const edges = (e.ext?.kgEdges as Array<{ target: string; type: string }>) ?? [];
    if (edges.length > 0) {
      const edgeDescs = edges.slice(0, 8).map(edge => {
        const target = index.byId[edge.target];
        return target ? `${edge.type} → ${target.title}` : null;
      }).filter(Boolean);
      if (edgeDescs.length > 0) parts.push('relations: ' + edgeDescs.join(', '));
    }

    if (e.tags.length > 0) {
      const meaningful = e.tags.filter(t => !t.startsWith('kg:') && t !== 'kg');
      if (meaningful.length > 0) parts.push('tags: ' + meaningful.join(', '));
    }

    return {
      id: e.id,
      title: e.title,
      summary: e.summary,
      tags: e.tags,
      body: parts.join('. '),
    };
  }

  async search(query: string, limit = 50, options?: WikiSearchOptions): Promise<WikiEntry[]> {
    return (await this.searchWithScores(query, limit, options)).map(r => r.entry);
  }

  // -------------------------------------------------------------------------
  // Walk
  // -------------------------------------------------------------------------

  private async scanFiles(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];

    const singletons: Array<{ rel: string; type: WikiNodeType }> = [
      { rel: 'project.md', type: 'project' },
      { rel: 'roadmap.md', type: 'roadmap' },
    ];
    // Parallel: singleton parses are independent and order does not matter
    // (buildIndexCandidate sorts by id + source priority afterwards).
    const singletonEntries = await Promise.all(singletons.map(s =>
      this.parseFileEntry(join(this.workflowRoot, s.rel), s.type)));
    for (const entry of singletonEntries) {
      if (entry) out.push(entry);
    }

    // specs — scan all scope directories (global, project, team, personal).
    // All files within a scope are parsed in one parallel batch; per-file
    // container → spec-entry grouping is preserved per file.
    const specScopes = this.resolveSpecScopes();
    for (const { dir, allowedRoot, scope, idPrefix, sourcePrefix } of specScopes) {
      const names = await safeReaddir(dir);
      const parsed = await Promise.all(names
        .filter(name => extname(name).toLowerCase() === '.md')
        .map(async (name) => {
          const absPath = join(dir, name);
          const container = await this.parseFileEntry(absPath, 'spec', allowedRoot);
          if (!container) return [] as WikiEntry[];

          // Scoped ID: spec:{scope}:{stem} to prevent cross-scope collisions
          const stem = basename(name, extname(name));
          container.id = `${idPrefix}${slugify(stem)}`;
          container.scope = scope;
          container.source = { kind: 'file', path: `${sourcePrefix}${name}` };

          // Parse <spec-entry> blocks into sub-node WikiEntries
          const specEntries = parseSpecEntries(container.body, name, {
            category: container.category ?? undefined,
            keywords: container.tags,
          });
          const sub = specEntries.map(se => {
            const related: string[] = [];
            if (se.ref) {
              const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
              // Derive ref target the same way as the knowhow container id (parseFileEntry
              // uses `knowhow-${slugify(stem)}`, which keeps the type prefix). Stripping the
              // prefix here produced target ≠ id → broken links for RCP/REF/DCS/etc.
              const refSlug = slugify(refStem);
              related.push(`knowhow-${refSlug}`);
            }
            return {
              id: `${idPrefix}${se.id}`,
              type: 'spec',
              title: se.title,
              summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
              tags: se.keywords,
              status: se.lifecycleStatus ?? 'active',
              created: container.created,
              updated: container.updated,
              related,
              source: container.source,
              body: se.content,
              ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}), ...(se.confidence ? { confidence: se.confidence } : {}), ...(se.conflictNote ? { conflictNote: se.conflictNote } : {}), ...(se.lifecycleStatus ? { lifecycleStatus: se.lifecycleStatus } : {}), ...(se.status ? { status: se.status } : {}), ...(se.relatedPaths ? { relatedPaths: se.relatedPaths } : {}), ...(se.appliesToRepoIds ? { appliesToRepoIds: se.appliesToRepoIds } : {}), ...(se.language ? { language: se.language } : {}), ...(se.decisionState ? { decisionState: se.decisionState } : {}), ...(se.supersededBy ? { supersededBy: se.supersededBy } : {}), ...(se.sid ? { sid: se.sid } : {}), ...(se.supersedes ? { supersedes: se.supersedes } : {}) },
              scope,
              category: se.category || container.category,
              specCategory: container.specCategory,
              createdBy: container.createdBy,
              sourceRef: se.sourceRef ?? container.sourceRef,
              parent: container.id,
              appliesToRepoIds: se.appliesToRepoIds ?? container.appliesToRepoIds,
            };
          });
          return [container, ...sub] as WikiEntry[];
        }));
      for (const entries of parsed) {
        out.push(...entries);
      }
    }

    // knowhow/*.md — recursive scan supports both flat and sub-folder layouts
    const knowhowEntries = await this.scanKnowhowDir(join(this.workflowRoot, 'knowhow'));
    for (const { name, entry } of knowhowEntries) {
      if (entry) {
        // Only derive category from file prefix if no frontmatter category
        if (!entry.category) {
          const upper = name.toUpperCase();
          if (upper.startsWith('KNW-')) entry.category = 'session';
          else if (upper.startsWith('TPL-')) entry.category = 'template';
          else if (upper.startsWith('RCP-')) entry.category = 'recipe';
          else if (upper.startsWith('REF-')) entry.category = 'reference';
          else if (upper.startsWith('DCS-')) entry.category = 'decision';
          else if (upper.startsWith('TIP-')) entry.category = 'tip';
          else if (upper.startsWith('AST-')) entry.category = 'asset';
          else if (upper.startsWith('BLP-')) entry.category = 'blueprint';
          else if (upper.startsWith('DOC-')) entry.category = 'document';
        }
        out.push(entry);

        // Parse <knowhow-entry> blocks into sub-node WikiEntries
        const knowhowSubEntries = parseKnowhowEntries(entry.body, name, {
          category: entry.category ?? undefined,
          keywords: entry.tags,
        });
        for (const se of knowhowSubEntries) {
          const related: string[] = [];
          if (se.ref) {
            const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
            // Derive ref target the same way as the knowhow container id (parseFileEntry
            // uses `knowhow-${slugify(stem)}`, which keeps the type prefix). Stripping the
            // prefix here produced target ≠ id → broken links for RCP/REF/DCS/etc.
            const refSlug = slugify(refStem);
            related.push(`knowhow-${refSlug}`);
          }
          out.push({
            id: `knowhow-${se.id}`,
            type: 'knowhow' as const,
            title: se.title,
            summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
            tags: se.keywords,
            status: se.lifecycleStatus ?? 'active' as const,
            created: entry.created,
            updated: entry.updated,
            related,
            source: entry.source,
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}), ...(se.relatedPaths ? { relatedPaths: se.relatedPaths } : {}), ...(se.appliesToRepoIds ? { appliesToRepoIds: se.appliesToRepoIds } : {}), ...(se.language ? { language: se.language } : {}), ...(se.decisionState ? { decisionState: se.decisionState } : {}) },
            scope: null,
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: se.sourceRef ?? entry.sourceRef,
            parent: entry.id,
            appliesToRepoIds: se.appliesToRepoIds ?? entry.appliesToRepoIds,
          });
        }
      }
    }

    // domain/glossary.json → domain WikiEntries
    const domainEntries = await this.scanDomain();
    out.push(...domainEntries);

    return out;
  }

  /**
   * Parse one changed local covered source for the opt-in incremental path.
   * This intentionally mirrors scanFiles/scanVirtual projection semantics and
   * never reaches Session, KG, linked-workspace, or transcript adapters.
   */
  private async scanIncrementalSource(
    source: SourceManifestEntry,
    _change: SourceChange,
    signal?: AbortSignal,
  ): Promise<WikiEntry[]> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('incremental index aborted');
    }
    const rel = normalizeManifestPath(source.path);
    const absPath = resolveAllowedSourcePath(join(this.workflowRoot, rel), this.workflowRoot, 'file');
    if (!absPath || classifySourcePath(rel) !== source.sourceKind) return [];

    if (source.sourceKind === 'project') {
      const type: WikiNodeType = rel.toLowerCase() === 'project.md' ? 'project' : 'roadmap';
      const entry = await this.parseFileEntry(absPath, type);
      if (!entry) return [];
      applyRepositoryOrigin([entry], this.currentRepository);
      return [entry];
    }

    if (source.sourceKind === 'spec') {
      const scope = this.resolveSpecScopes().find(candidate => {
        const candidatePath = normalizeManifestPath(relative(this.workflowRoot, absPath));
        return candidatePath.startsWith(normalizeManifestPath(relative(this.workflowRoot, candidate.dir)) + '/')
          || (candidatePath === normalizeManifestPath(relative(this.workflowRoot, candidate.dir)));
      });
      if (!scope) return [];
      const container = await this.parseFileEntry(absPath, 'spec', scope.allowedRoot);
      if (!container) return [];
      const name = basename(absPath);
      const stem = basename(name, extname(name));
      container.id = `${scope.idPrefix}${slugify(stem)}`;
      container.scope = scope.scope;
      container.source = { kind: 'file', path: rel };
      const specEntries = parseSpecEntries(container.body, name, {
        category: container.category ?? undefined,
        keywords: container.tags,
      });
      const out: WikiEntry[] = [container];
      for (const se of specEntries) {
        const related: string[] = [];
        if (se.ref) {
          const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
          related.push(`knowhow-${slugify(refStem)}`);
        }
        out.push({
          id: `${scope.idPrefix}${se.id}`,
          type: 'spec',
          title: se.title,
          summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
          tags: se.keywords,
          status: se.lifecycleStatus ?? 'active',
          created: container.created,
          updated: container.updated,
          related,
          source: container.source,
          body: se.content,
          ext: {
            entryType: se.type,
            timestamp: se.timestamp,
            ...(se.ref ? { ref: se.ref } : {}),
            ...(se.confidence ? { confidence: se.confidence } : {}),
            ...(se.conflictNote ? { conflictNote: se.conflictNote } : {}),
            ...(se.lifecycleStatus ? { lifecycleStatus: se.lifecycleStatus } : {}),
            ...(se.status ? { status: se.status } : {}),
            ...(se.relatedPaths ? { relatedPaths: se.relatedPaths } : {}),
            ...(se.appliesToRepoIds ? { appliesToRepoIds: se.appliesToRepoIds } : {}),
            ...(se.language ? { language: se.language } : {}),
            ...(se.decisionState ? { decisionState: se.decisionState } : {}),
            ...(se.supersededBy ? { supersededBy: se.supersededBy } : {}),
            ...(se.sid ? { sid: se.sid } : {}),
            ...(se.supersedes ? { supersedes: se.supersedes } : {}),
          },
          scope: scope.scope,
          category: se.category || container.category,
          specCategory: container.specCategory,
          createdBy: container.createdBy,
          sourceRef: se.sourceRef ?? container.sourceRef,
          parent: container.id,
          appliesToRepoIds: se.appliesToRepoIds ?? container.appliesToRepoIds,
        });
      }
      applyRepositoryOrigin(out, this.currentRepository);
      return out;
    }

    if (source.sourceKind === 'knowhow') {
      const entry = await this.parseFileEntry(absPath, 'knowhow');
      if (!entry) return [];
      const name = basename(absPath);
      if (!entry.category) {
        const upper = name.toUpperCase();
        if (upper.startsWith('KNW-')) entry.category = 'session';
        else if (upper.startsWith('TPL-')) entry.category = 'template';
        else if (upper.startsWith('RCP-')) entry.category = 'recipe';
        else if (upper.startsWith('REF-')) entry.category = 'reference';
        else if (upper.startsWith('DCS-')) entry.category = 'decision';
        else if (upper.startsWith('TIP-')) entry.category = 'tip';
        else if (upper.startsWith('AST-')) entry.category = 'asset';
        else if (upper.startsWith('BLP-')) entry.category = 'blueprint';
        else if (upper.startsWith('DOC-')) entry.category = 'document';
      }
      const out: WikiEntry[] = [entry];
      const subEntries = parseKnowhowEntries(entry.body, name, {
        category: entry.category ?? undefined,
        keywords: entry.tags,
      });
      for (const se of subEntries) {
        const related: string[] = [];
        if (se.ref) {
          const refStem = se.ref.replace(/^knowhow\//, '').replace(/\.md$/, '');
          related.push(`knowhow-${slugify(refStem)}`);
        }
        out.push({
          id: `knowhow-${se.id}`,
          type: 'knowhow',
          title: se.title,
          summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
          tags: se.keywords,
          status: se.lifecycleStatus ?? 'active',
          created: entry.created,
          updated: entry.updated,
          related,
          source: entry.source,
          body: se.content,
          ext: {
            entryType: se.type,
            timestamp: se.timestamp,
            ...(se.ref ? { ref: se.ref } : {}),
            ...(se.relatedPaths ? { relatedPaths: se.relatedPaths } : {}),
            ...(se.appliesToRepoIds ? { appliesToRepoIds: se.appliesToRepoIds } : {}),
            ...(se.language ? { language: se.language } : {}),
            ...(se.decisionState ? { decisionState: se.decisionState } : {}),
          },
          scope: null,
          category: se.category || entry.category,
          specCategory: entry.specCategory,
          createdBy: entry.createdBy,
          sourceRef: se.sourceRef ?? entry.sourceRef,
          parent: entry.id,
          appliesToRepoIds: se.appliesToRepoIds ?? entry.appliesToRepoIds,
        });
      }
      applyRepositoryOrigin(out, this.currentRepository);
      return out;
    }

    if (source.sourceKind === 'domain') {
      const entries = await this.scanDomain();
      applyRepositoryOrigin(entries, this.currentRepository);
      return entries.filter(entry => normalizeManifestPath(entry.source.path) === rel);
    }

    if (source.sourceKind === 'issue') {
      const sourceRel = toForwardSlash(relative(this.workflowRoot, absPath));
      const entries = await loadVirtualEntries(absPath, adaptIssueRow, sourceRel);
      applyRepositoryOrigin(entries, this.currentRepository);
      return entries;
    }

    if (source.sourceKind === 'doc') {
      const sourceRel = toForwardSlash(relative(this.workflowRoot, absPath));
      const entries = await loadVirtualJsonEntries(absPath, adaptCodebaseDocIndex, sourceRel);
      applyRepositoryOrigin(entries, this.currentRepository);
      return entries;
    }

    return [];
  }

  /**
   * Recursively scan knowhow directory (supports both flat and sub-folder layouts).
   */
  private async scanKnowhowDir(dir: string): Promise<Array<{ name: string; absPath: string; entry: WikiEntry | null }>> {
    const results: Array<{ name: string; absPath: string; entry: WikiEntry | null }> = [];
    try {
      const rootStats = await lstat(dir);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return results;
    } catch {
      return results;
    }
    const names = await safeReaddir(dir);
    // Parallel: lstat and parse are independent per entry; recursion results
    // are flattened in place afterwards (order is not significant — the
    // caller sorts by id).
    const nested = await Promise.all(names.map(async (name) => {
      const fullPath = join(dir, name);
      let stats: Awaited<ReturnType<typeof lstat>> | null = null;
      try { stats = await lstat(fullPath); } catch { return []; }
      if (stats.isSymbolicLink()) return [];

      if (stats.isDirectory()) {
        return this.scanKnowhowDir(fullPath);
      }
      if (stats.isFile() && extname(name).toLowerCase() === '.md') {
        const entry = await this.parseFileEntry(fullPath, 'knowhow');
        return [{ name, absPath: fullPath, entry }];
      }
      return [];
    }));
    for (const batch of nested) results.push(...batch);
    return results;
  }

  /**
   * Scan .workflow/domain/glossary.json and produce WikiEntry[] for each term.
   */
  private async scanDomain(): Promise<WikiEntry[]> {
    const glossaryPath = resolveAllowedSourcePath(
      join(this.workflowRoot, 'domain', 'glossary.json'),
      this.workflowRoot,
      'file',
    );
    if (!glossaryPath) return [];
    try {
      const raw = await readFile(glossaryPath, 'utf-8');
      const glossary = JSON.parse(raw);
      if (!Array.isArray(glossary.terms)) return [];

      let glossaryStat: Awaited<ReturnType<typeof stat>>;
      try { glossaryStat = await stat(glossaryPath); } catch { return []; }
      const fileDate = new Date(glossaryStat.mtimeMs).toISOString();

      return glossary.terms.map((term: Record<string, unknown>) => {
        const id = term.id as string;
        const canonical = term.canonical as string;
        const definition = (term.definition as string) ?? '';
        const aliases = (term.aliases as string[]) ?? [];
        const keywords = (term.keywords as string[]) ?? [];
        const relationships = (term.relationships as string[]) ?? [];
        const status = ((term.status as string) ?? 'active') === 'active' ? 'active' : 'archived';

        const bodyLines = [`# ${canonical}`, '', definition, ''];
        if (aliases.length) bodyLines.push(`Aliases: ${aliases.join(', ')}`);
        if (relationships.length) bodyLines.push(`Related: ${relationships.join(', ')}`);
        if (keywords.length) bodyLines.push(`Keywords: ${keywords.join(', ')}`);

        return {
          id: `domain-${id}`,
          type: 'domain' as const,
          title: canonical,
          summary: definition,
          tags: [...aliases, ...keywords],
          status: status as 'active' | 'archived',
          created: fileDate,
          updated: fileDate,
          related: relationships.map(r => `domain-${r}`),
          source: { kind: 'file' as const, path: 'domain/glossary.json' },
          body: bodyLines.join('\n'),
          ext: {
            tier: term.tier ?? 'core',
            sourceKind: (term.source as Record<string, unknown>)?.kind ?? 'unknown',
          },
          scope: null,
          category: 'domain',
          specCategory: null,
          createdBy: null,
          sourceRef: null,
          parent: null,
        } satisfies WikiEntry;
      });
    } catch {
      return [];
    }
  }

  /**
   * Resolve spec directories for all scopes that exist on disk.
   * Returns entries with scoped ID prefix and source path prefix.
   */
  private resolveSpecScopes(): Array<{
    dir: string;
    allowedRoot: string;
    scope: WikiScope;
    idPrefix: string;
    sourcePrefix: string;
  }> {
    const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
    const scopes: Array<{
      dir: string;
      allowedRoot: string;
      scope: WikiScope;
      idPrefix: string;
      sourcePrefix: string;
    }> = [];

    // Global: ~/.maestro/specs/ — user-level store, included for persistent
    // and read-only indexers. Memory-only probes must stay hermetic:
    // like the CLI session stores (see scanCliSessions), user-level spec
    // content is never part of a probe, which keeps the search-ranking gate
    // deterministic across machines.
    const globalDir = join(maestroHome, 'specs');
    if (this.persistence !== 'memory-only' && existsSync(globalDir)) {
      scopes.push({
        dir: globalDir,
        allowedRoot: globalDir,
        scope: 'global',
        idPrefix: 'spec:global:',
        sourcePrefix: '~/.maestro/specs/',
      });
    }

    // Project baseline: .workflow/specs/
    const projectDir = join(this.workflowRoot, 'specs');
    if (existsSync(projectDir)) {
      scopes.push({
        dir: projectDir,
        allowedRoot: this.workflowRoot,
        scope: 'project',
        idPrefix: 'spec:project:',
        sourcePrefix: 'specs/',
      });
    }

    // Team: .workflow/collab/specs/
    const teamDir = join(this.workflowRoot, 'collab', 'specs');
    if (existsSync(teamDir)) {
      // Only add the team root, not uid subdirs
      scopes.push({
        dir: teamDir,
        allowedRoot: this.workflowRoot,
        scope: 'team',
        idPrefix: 'spec:team:',
        sourcePrefix: 'collab/specs/',
      });
    }

    // Personal: .workflow/collab/specs/{uid}/ — scan each uid subdir
    if (existsSync(teamDir)) {
      try {
        for (const d of readdirSync(teamDir, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const personalDir = join(teamDir, d.name);
          scopes.push({
            dir: personalDir,
            allowedRoot: this.workflowRoot,
            scope: 'personal',
            idPrefix: `spec:personal:${d.name}:`,
            sourcePrefix: `collab/specs/${d.name}/`,
          });
        }
      } catch {
        // Best-effort
      }
    }

    return scopes;
  }

  private async scanVirtual(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];

    // Issues: collect from all JSONL files, then deduplicate by ID keeping the
    // entry with the most recent updated timestamp.  This avoids collision
    // warnings when the same issue ID appears across multiple JSONL sources
    // (e.g. issues.jsonl and review-issues.jsonl).
    const allIssues: WikiEntry[] = [];
    for (const name of await safeReaddir(join(this.workflowRoot, 'issues'))) {
      if (extname(name).toLowerCase() !== '.jsonl') continue;
      const abs = resolveAllowedSourcePath(
        join(this.workflowRoot, 'issues', name),
        this.workflowRoot,
        'file',
      );
      if (!abs) continue;
      const rel = toForwardSlash(relative(this.workflowRoot, abs));
      allIssues.push(...(await loadVirtualEntries(abs, adaptIssueRow, rel)));
    }
    const issueBest = new Map<string, WikiEntry>();
    for (const e of allIssues) {
      const existing = issueBest.get(e.id);
      if (!existing || e.updated > existing.updated) {
        issueBest.set(e.id, e);
      }
    }
    out.push(...issueBest.values());

    // Codebase: .workflow/codebase/doc-index.json → component/feature/req/ADR
    const codebaseIndex = resolveAllowedSourcePath(
      join(this.workflowRoot, 'codebase', 'doc-index.json'),
      this.workflowRoot,
      'file',
    );
    if (codebaseIndex) {
      const rel = toForwardSlash(relative(this.workflowRoot, codebaseIndex));
      out.push(...(await loadVirtualJsonEntries(codebaseIndex, adaptCodebaseDocIndex, rel)));
    }

    // Knowledge Graph: canonical MaestroGraph SQLite, with legacy JSON fallback.
    // Loaded after doc-index so cross-referencing can link kg-* ↔ codebase-comp-*.
    const maestroDbPath = resolveAllowedSourcePath(
      join(this.workflowRoot, 'kg', 'maestro.db'), this.workflowRoot, 'file',
    );
    const legacyKgPath = resolveAllowedSourcePath(
      join(this.workflowRoot, 'codebase', 'knowledge-graph.json'), this.workflowRoot, 'file',
    );
    if (maestroDbPath) {
      const kgRel = toForwardSlash(relative(this.workflowRoot, maestroDbPath));
      const kgEntries = adaptKnowledgeGraphFromDb(maestroDbPath, kgRel);
      crossReferenceKgWithDocIndex(kgEntries, out);
      out.push(...kgEntries);
    } else if (legacyKgPath) {
      const kgRel = toForwardSlash(relative(this.workflowRoot, legacyKgPath));
      const kgEntries = await loadVirtualJsonEntries(legacyKgPath, adaptKnowledgeGraph, kgRel);
      crossReferenceKgWithDocIndex(kgEntries, out);
      out.push(...kgEntries);
    }

    // Canonical Session/Run registry. Only sealed/archived Runs are indexed.
    out.push(...(await this.scanRunModeSessions()));

    // Memory-only probes are hermetic and never inspect user-level CLI session stores.
    if (this.persistence !== 'memory-only' && this.includeCliSessions) {
      out.push(...(await this.scanCliSessions()));
    }

    return out;
  }

  private async scanCliSessions(): Promise<WikiEntry[]> {
    const projectCwd = dirname(this.workflowRoot);
    const home = homedir();
    const maxAgeDays = CLI_SESSION_MAX_AGE_DAYS;
    const maxFiles = CLI_SESSION_MAX_FILES;

    // Parallel: Claude Code + Codex session loading. Reuse the bounded scan in
    // process while its store-level fingerprint is stable; many short-lived
    // WikiIndexer instances otherwise repeat the same user-history walk.
    const projectSlug = cwdToClaudeProjectSlug(projectCwd);
    const claudeProjectDir = join(home, '.claude', 'projects', projectSlug);
    const codexRoot = join(home, '.codex');
    const fingerprint = await cliSessionStoreFingerprint(claudeProjectDir, codexRoot, projectCwd);
    const cached = cliSessionScanCache.get(projectCwd);
    if (cached && cached.fingerprint === fingerprint
      && Date.now() - cached.cachedAt < CLI_SESSION_CACHE_TTL_MS) {
      return structuredClone(cached.entries);
    }

    const [claudeEntries, codexEntries] = await Promise.all([
      existsSync(claudeProjectDir)
        ? loadClaudeCodeSessions(claudeProjectDir, projectSlug, maxAgeDays, maxFiles).catch(() => [] as WikiEntry[])
        : [] as WikiEntry[],
      existsSync(join(codexRoot, 'sessions'))
        ? loadCodexSessions(codexRoot, projectCwd, maxAgeDays, maxFiles).catch(() => [] as WikiEntry[])
        : [] as WikiEntry[],
    ]);

    const entries = [...claudeEntries, ...codexEntries];
    cliSessionScanCache.set(projectCwd, {
      fingerprint,
      cachedAt: Date.now(),
      entries: structuredClone(entries),
    });
    return entries;
  }

  private async scanRunModeSessions(): Promise<WikiEntry[]> {
    const root = join(this.workflowRoot, 'sessions');
    if (!existsSync(root)) return [];
    const out: WikiEntry[] = [];
    const names = (await safeReaddir(root)).filter(name => name !== 'index.json');
    // Session projections are independent, but each terminal Session may read
    // several Run artifacts. Use bounded batches to overlap Windows filesystem
    // latency without opening the entire history tree at once. Promise.all
    // preserves input order, so the final deterministic index ordering is
    // unchanged even before buildIndexCandidate performs its stable sort.
    const concurrency = 8;
    for (let offset = 0; offset < names.length; offset += concurrency) {
      const batch = await Promise.all(names.slice(offset, offset + concurrency).map(async name => {
        const sessionPath = resolveAllowedSourcePath(
          join(root, name, 'session.json'),
          this.workflowRoot,
          'file',
        );
        if (!sessionPath) return [] as WikiEntry[];
        const rel = toForwardSlash(relative(this.workflowRoot, sessionPath));
        return loadRunModeSessionEntries(sessionPath, rel, this.workflowRoot);
      }));
      for (const entries of batch) out.push(...entries);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Linked workspace scanning
  // -------------------------------------------------------------------------

  private async scanLinkedWorkspaces(): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];
    for (const lw of this.linkedWorkspaces) {
      if (!existsSync(lw.workflowRoot)) {
        if (process.env.MAESTRO_DEBUG === '1') {
          // eslint-disable-next-line no-console
          console.warn(`[wiki-indexer] linked workspace "${lw.name}" not found: ${lw.workflowRoot}`);
        }
        continue;
      }
      const entries = await this.scanLinkedWorkspace(lw);
      out.push(...entries);
    }
    return out;
  }

  private async scanLinkedWorkspace(lw: {
    name: string;
    workflowRoot: string;
    shareTypes: Set<string>;
    origin: WikiRepositoryOrigin;
  }): Promise<WikiEntry[]> {
    const out: WikiEntry[] = [];
    const idPrefix = `ws:${lw.name}:`;

    if (lw.shareTypes.has('spec')) {
      const specsDir = join(lw.workflowRoot, 'specs');
      for (const name of await safeReaddir(specsDir)) {
        if (extname(name).toLowerCase() !== '.md') continue;
        const absPath = join(specsDir, name);
        const entry = await this.parseLinkedFileEntry(absPath, 'spec', lw.name, lw.workflowRoot);
        if (!entry) continue;
        const stem = basename(name, extname(name));
        entry.id = `${idPrefix}spec:${slugify(stem)}`;
        entry.scope = 'linked';
        entry.source = { kind: 'file', path: `specs/${name}`, workspace: lw.name };
        out.push(entry);

        const specEntries = parseSpecEntries(entry.body, name, {
          category: entry.category ?? undefined,
          keywords: entry.tags,
        });
        for (const se of specEntries) {
          out.push({
            id: `${idPrefix}spec:${se.id}`,
            type: 'spec',
            title: se.title,
            summary: se.description || se.content.slice(0, 240).replace(/\s+/g, ' '),
            tags: se.keywords,
            status: se.lifecycleStatus ?? 'active',
            created: entry.created,
            updated: entry.updated,
            related: [],
            source: { kind: 'file', path: `specs/${name}`, workspace: lw.name },
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.confidence ? { confidence: se.confidence } : {}), ...(se.conflictNote ? { conflictNote: se.conflictNote } : {}), ...(se.lifecycleStatus ? { lifecycleStatus: se.lifecycleStatus } : {}), ...(se.status ? { status: se.status } : {}), ...(se.relatedPaths ? { relatedPaths: se.relatedPaths } : {}), ...(se.appliesToRepoIds ? { appliesToRepoIds: se.appliesToRepoIds } : {}), ...(se.language ? { language: se.language } : {}), ...(se.decisionState ? { decisionState: se.decisionState } : {}), ...(se.supersededBy ? { supersededBy: se.supersededBy } : {}), ...(se.sid ? { sid: se.sid } : {}), ...(se.supersedes ? { supersedes: se.supersedes } : {}) },
            scope: 'linked',
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: se.sourceRef ?? entry.sourceRef,
            parent: entry.id,
            appliesToRepoIds: se.appliesToRepoIds ?? entry.appliesToRepoIds,
          });
        }
      }
    }

    if (lw.shareTypes.has('knowhow')) {
      const knowhowDir = join(lw.workflowRoot, 'knowhow');
      const knowhowFiles = await this.scanLinkedKnowhowDir(knowhowDir, lw.name, lw.workflowRoot);
      for (const { entry } of knowhowFiles) {
        if (!entry) continue;
        entry.id = `${idPrefix}${entry.id}`;
        entry.scope = 'linked';
        out.push(entry);
      }
    }

    if (lw.shareTypes.has('domain')) {
      const domainEntries = await this.scanLinkedDomain(lw.workflowRoot, lw.name);
      for (const e of domainEntries) {
        e.id = `${idPrefix}${e.id}`;
        out.push(e);
      }
    }

    if (lw.shareTypes.has('codebase')) {
      const codebaseIndex = resolveAllowedSourcePath(
        join(lw.workflowRoot, 'codebase', 'doc-index.json'), lw.workflowRoot, 'file',
      );
      if (codebaseIndex) {
        const rel = `codebase/doc-index.json`;
        const entries = await loadVirtualJsonEntries(codebaseIndex, adaptCodebaseDocIndex, rel);
        for (const e of entries) {
          e.id = `${idPrefix}${e.id}`;
          e.source = { ...e.source, workspace: lw.name };
          e.scope = 'linked';
          out.push(e);
        }
      }

      const maestroDbPath = resolveAllowedSourcePath(
        join(lw.workflowRoot, 'kg', 'maestro.db'), lw.workflowRoot, 'file',
      );
      const legacyKgPath = resolveAllowedSourcePath(
        join(lw.workflowRoot, 'codebase', 'knowledge-graph.json'), lw.workflowRoot, 'file',
      );
      let kgEntries: WikiEntry[] = [];
      if (maestroDbPath) {
        kgEntries = adaptKnowledgeGraphFromDb(maestroDbPath, 'kg/maestro.db');
      } else if (legacyKgPath) {
        kgEntries = await loadVirtualJsonEntries(legacyKgPath, adaptKnowledgeGraph, 'codebase/knowledge-graph.json');
      }
      if (kgEntries.length > 0) {
        prefixLinkedEntries(kgEntries, idPrefix, lw.name);
        out.push(...kgEntries);
      }
    }

    if (lw.shareTypes.has('session')) {
      const sessionsRoot = join(lw.workflowRoot, 'sessions');
      for (const sessionName of await safeReaddir(sessionsRoot)) {
        const sessionPath = resolveAllowedSourcePath(
          join(sessionsRoot, sessionName, 'session.json'), lw.workflowRoot, 'file',
        );
        if (!sessionPath) continue;
        const entries = await loadRunModeSessionEntries(
          sessionPath,
          `sessions/${sessionName}/session.json`,
          lw.workflowRoot,
        );
        prefixLinkedEntries(entries, idPrefix, lw.name);
        for (const entry of entries) {
          entry.ext = {
            ...entry.ext,
            workspaceFence: lw.origin.workspaceFence ?? `linked:${lw.name}`,
            sharedVia: 'explicit-session-share',
            forkAuthorized: false,
            resumeAuthorized: false,
          };
          entry.scope = 'linked';
        }
        out.push(...entries);
      }
    }

    applyRepositoryOrigin(out, lw.origin, lw.name);
    return out;
  }

  private async parseLinkedFileEntry(
    absPath: string,
    type: WikiNodeType,
    wsName: string,
    wsWorkflowRoot: string,
  ): Promise<WikiEntry | null> {
    const realPath = resolveAllowedSourcePath(absPath, wsWorkflowRoot, 'file');
    if (!realPath) return null;

    let raw: string;
    let stats;
    try {
      raw = await readFile(realPath, 'utf-8');
      stats = await stat(realPath);
    } catch {
      return null;
    }

    const { data, content } = parseFrontmatter(raw);
    const fileName = basename(realPath);
    const stem = basename(fileName, extname(fileName));

    const canonicalSurface = type === 'knowhow' || type === 'spec';
    const normalized = normalizeCanonicalKnowledgeContent({ ...data, content });
    const title = normalized.title || firstHeading(content) || stem;
    const summary = canonicalSurface
      ? normalized.summary
      : (asString(data.description) || asString(data.summary) || firstParagraph(content));
    const tags = canonicalSurface ? normalized.keywords : extractTags(data);
    const status = canonicalSurface
      ? normalized.lifecycleStatus
      : (asStatus(data.status) ?? inferStatus(type));
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);
    if (normalized.relatedPaths.length) ext.relatedPaths = normalized.relatedPaths;
    if (normalized.appliesToRepoIds.length) ext.appliesToRepoIds = normalized.appliesToRepoIds;
    if (normalized.language) ext.language = normalized.language;
    if (normalized.decisionState) ext.decisionState = normalized.decisionState;
    if (normalized.auditMarkers.length) ext.canonicalAudit = normalized.auditMarkers;
    // Surface deprecated into ext.status — the CLI search deprecated-filter
    // reads ext.status (like spec sub-entries), not the top-level field.
    if (status === 'deprecated') ext.status = 'deprecated';

    const category = canonicalSurface ? normalized.category : (asString(data.category) || null);
    const specCategory = canonicalSurface ? null : (asString(data.specCategory) || null);
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = canonicalSurface ? normalized.sourceRef : (asString(data.sourceRef) || null);
    const parent = asString(data.parent) || null;
    const appliesToRepoIds = Object.prototype.hasOwnProperty.call(data, 'appliesToRepoIds')
      ? normalized.appliesToRepoIds
      : undefined;

    const rel = toForwardSlash(relative(wsWorkflowRoot, realPath));
    const id = `${type}-${slugify(stem)}`;

    return {
      id,
      type,
      title,
      summary,
      tags,
      status,
      created: new Date(stats.birthtimeMs || stats.mtimeMs).toISOString(),
      updated: new Date(stats.mtimeMs).toISOString(),
      related,
      source: { kind: 'file', path: rel, workspace: wsName },
      body: content,
      ext,
      scope: 'linked',
      category,
      specCategory,
      createdBy,
      sourceRef,
      parent,
      appliesToRepoIds,
    };
  }

  private async scanLinkedKnowhowDir(
    dir: string,
    wsName: string,
    wsWorkflowRoot: string,
  ): Promise<Array<{ entry: WikiEntry | null }>> {
    const results: Array<{ entry: WikiEntry | null }> = [];
    try {
      const rootStats = await lstat(dir);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return results;
    } catch {
      return results;
    }
    for (const name of await safeReaddir(dir)) {
      const fullPath = join(dir, name);
      let stats: Awaited<ReturnType<typeof lstat>> | null = null;
      try { stats = await lstat(fullPath); } catch { continue; }
      if (stats.isSymbolicLink()) continue;

      if (stats.isDirectory()) {
        const nested = await this.scanLinkedKnowhowDir(fullPath, wsName, wsWorkflowRoot);
        results.push(...nested);
      } else if (stats.isFile() && extname(name).toLowerCase() === '.md') {
        const entry = await this.parseLinkedFileEntry(fullPath, 'knowhow', wsName, wsWorkflowRoot);
        if (entry) {
          if (!entry.category) {
            const upper = name.toUpperCase();
            if (upper.startsWith('KNW-')) entry.category = 'session';
            else if (upper.startsWith('TPL-')) entry.category = 'template';
            else if (upper.startsWith('RCP-')) entry.category = 'recipe';
            else if (upper.startsWith('REF-')) entry.category = 'reference';
            else if (upper.startsWith('DCS-')) entry.category = 'decision';
            else if (upper.startsWith('TIP-')) entry.category = 'tip';
            else if (upper.startsWith('AST-')) entry.category = 'asset';
            else if (upper.startsWith('BLP-')) entry.category = 'blueprint';
            else if (upper.startsWith('DOC-')) entry.category = 'document';
          }
        }
        results.push({ entry });
      }
    }
    return results;
  }

  private async scanLinkedDomain(wsWorkflowRoot: string, wsName: string): Promise<WikiEntry[]> {
    const glossaryPath = resolveAllowedSourcePath(
      join(wsWorkflowRoot, 'domain', 'glossary.json'), wsWorkflowRoot, 'file',
    );
    if (!glossaryPath) return [];
    try {
      const raw = await readFile(glossaryPath, 'utf-8');
      const glossary = JSON.parse(raw);
      if (!Array.isArray(glossary.terms)) return [];

      let glossaryStat: Awaited<ReturnType<typeof stat>>;
      try { glossaryStat = await stat(glossaryPath); } catch { return []; }
      const fileDate = new Date(glossaryStat.mtimeMs).toISOString();

      return glossary.terms.map((term: Record<string, unknown>) => {
        const id = term.id as string;
        const canonical = term.canonical as string;
        const definition = (term.definition as string) ?? '';
        const aliases = (term.aliases as string[]) ?? [];
        const keywords = (term.keywords as string[]) ?? [];
        const relationships = (term.relationships as string[]) ?? [];
        const status = ((term.status as string) ?? 'active') === 'active' ? 'active' : 'archived';

        const bodyLines = [`# ${canonical}`, '', definition, ''];
        if (aliases.length) bodyLines.push(`Aliases: ${aliases.join(', ')}`);
        if (relationships.length) bodyLines.push(`Related: ${relationships.join(', ')}`);
        if (keywords.length) bodyLines.push(`Keywords: ${keywords.join(', ')}`);

        return {
          id: `domain-${id}`,
          type: 'domain' as const,
          title: canonical,
          summary: definition,
          tags: [...aliases, ...keywords],
          status: status as 'active' | 'archived',
          created: fileDate,
          updated: fileDate,
          related: relationships.map(r => `domain-${r}`),
          source: { kind: 'file' as const, path: 'domain/glossary.json', workspace: wsName },
          body: bodyLines.join('\n'),
          ext: {
            tier: term.tier ?? 'core',
            sourceKind: (term.source as Record<string, unknown>)?.kind ?? 'unknown',
          },
          scope: 'linked' as const,
          category: 'domain',
          specCategory: null,
          createdBy: null,
          sourceRef: null,
          parent: null,
        } satisfies WikiEntry;
      });
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // File parsing
  // -------------------------------------------------------------------------

  private async parseFileEntry(
    absPath: string,
    type: WikiNodeType,
    allowedRoot = this.workflowRoot,
  ): Promise<WikiEntry | null> {
    const realPath = resolveAllowedSourcePath(absPath, allowedRoot, 'file');
    if (!realPath) return null;

    let raw: string;
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      raw = await readFile(realPath, 'utf-8');
      stats = await stat(realPath);
    } catch {
      return null;
    }

    const { data, content } = parseFrontmatter(raw);
    const fileName = basename(realPath);
    const stem = basename(fileName, extname(fileName));

    const canonicalSurface = type === 'knowhow' || type === 'spec';
    const normalized = normalizeCanonicalKnowledgeContent({ ...data, content });
    const title = normalized.title || firstHeading(content) || stem;
    const summary = canonicalSurface
      ? normalized.summary
      : (asString(data.description) || asString(data.summary) || firstParagraph(content));
    const tags = canonicalSurface ? normalized.keywords : extractTags(data);
    const status = canonicalSurface
      ? normalized.lifecycleStatus
      : (asStatus(data.status) ?? inferStatus(type));
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);
    if (normalized.relatedPaths.length) ext.relatedPaths = normalized.relatedPaths;
    if (normalized.appliesToRepoIds.length) ext.appliesToRepoIds = normalized.appliesToRepoIds;
    if (normalized.language) ext.language = normalized.language;
    if (normalized.decisionState) ext.decisionState = normalized.decisionState;
    if (normalized.auditMarkers.length) ext.canonicalAudit = normalized.auditMarkers;
    // Surface deprecated into ext.status — the CLI search deprecated-filter
    // reads ext.status (like spec sub-entries), not the top-level field.
    if (status === 'deprecated') ext.status = 'deprecated';

    // Enrichment fields from canonical/legacy frontmatter.
    const category = canonicalSurface ? normalized.category : (asString(data.category) || null);
    const specCategory = canonicalSurface ? null : (asString(data.specCategory) || null);
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = canonicalSurface ? normalized.sourceRef : (asString(data.sourceRef) || null);
    const parent = asString(data.parent) || null;
    const appliesToRepoIds = Object.prototype.hasOwnProperty.call(data, 'appliesToRepoIds')
      ? normalized.appliesToRepoIds
      : undefined;

    const rel = toForwardSlash(relative(this.workflowRoot, realPath));
    // Knowhow files use prefix-<slug>.md naming (KNW-, TIP-, TPL-, etc.).
    // Keep the full stem (including prefix) to avoid collisions when multiple
    // prefixed files share the same timestamp slug (e.g. KNW-20260427-1912 vs
    // DCS-20260427-1912 both slugifying to the same value).
    const id = `${type}-${slugify(stem)}`;

    return {
      id,
      type,
      title,
      summary,
      tags,
      status,
      created: new Date(stats.birthtimeMs || stats.mtimeMs).toISOString(),
      updated: new Date(stats.mtimeMs).toISOString(),
      related,
      source: { kind: 'file', path: rel },
      body: content,
      ext,
      scope: null,
      category,
      specCategory,
      createdBy,
      sourceRef,
      parent,
      appliesToRepoIds,
    };
  }

  private buildBacklinks(
    entries: WikiEntry[],
    byId: Record<string, WikiEntry>,
  ): Record<string, string[]> {
    // Avoid lowercasing every title and running a regex across every body when
    // the corpus has neither explicit relations nor wiki-link syntax.
    if (!entries.some(entry => entry.related.length > 0 || entry.body.includes('[['))) {
      return {};
    }
    const blSets = new Map<string, Set<string>>();
    const titleIndex = new Map<string, string>();
    for (const d of entries) titleIndex.set(d.title.toLowerCase(), d.id);

    const push = (target: string, source: string) => {
      const resolved = resolveLink(target, byId, titleIndex);
      if (!resolved) return;
      let s = blSets.get(resolved);
      if (!s) { s = new Set(); blSets.set(resolved, s); }
      s.add(source);
    };

    for (const d of entries) {
      for (const rel of d.related) push(rel, d.id);
      if (d.body.includes('[[')) {
        const linkRe = /\[\[([^\]]+)\]\]/g;
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(d.body))) push(m[1], d.id);
      }
    }
    const bl: Record<string, string[]> = {};
    for (const [k, v] of blSets) bl[k] = [...v];
    return bl;
  }

  /**
   * Write a lightweight persistent index to `.workflow/wiki-index.json`.
   * Strips body/raw/ext to keep the file small and fast to parse externally.
   * KG virtual entries get additional truncation to prevent file bloat.
   */
  private async prepareIndex(index: WikiIndex): Promise<string> {
    const persisted: PersistedWikiIndex = {
      version: 3,
      generatedAt: index.generatedAt,
      entries: index.entries.map((e): PersistedEntry => {
        const isKg = typeof e.ext?.virtualKind === 'string'
          && (e.ext.virtualKind as string).startsWith('kg-');
        return {
          id: e.id,
          type: e.type,
          title: e.title,
          summary: isKg ? e.summary.slice(0, 160) : e.summary,
          tags: isKg ? e.tags.slice(0, 8) : e.tags,
          status: e.status,
          created: e.created,
          updated: e.updated,
          scope: e.scope,
          category: e.category,
          specCategory: e.specCategory,
          createdBy: e.createdBy,
          sourceRef: e.sourceRef,
          parent: e.parent,
          related: isKg ? e.related.slice(0, 8) : e.related,
          repoId: e.repoId,
          appliesToRepoIds: e.appliesToRepoIds,
        };
      }),
    };
    const target = join(this.workflowRoot, 'wiki-index.json');
    const tmpTarget = `${target}.tmp-${process.pid}-${randomUUID()}`;
    await mkdir(dirname(target), { recursive: true });
    this.recordEvidence('filesystem-index-write', 'WikiIndexer.persistIndex.writeFile');
    try {
      await writeFile(tmpTarget, JSON.stringify(persisted, null, 2), { encoding: 'utf-8', flag: 'wx' });
      return tmpTarget;
    } catch (error) {
      await rm(tmpTarget, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  isInsideRoot(absPath: string): boolean {
    return resolveAllowedSourcePath(absPath, this.workflowRoot, 'any') !== null;
  }
}

interface CliFingerprintRecord {
  kind: 'claude-root' | 'claude-transcript' | 'codex-root' | 'codex-sessions' | 'codex-index' | 'codex-transcript';
  path: string;
  size: number | null;
  mtimeMs: number | null;
  digest: string;
}

/**
 * Read only bounded transcript windows. The adapters intentionally keep their
 * existing head-limited parsing authority; this digest merely fences changes
 * to the already discovered file without loading a complete transcript.
 */
async function boundedHeadTailDigest(
  path: string,
  headBytes = CLI_FINGERPRINT_HEAD_BYTES,
  tailBytes = CLI_FINGERPRINT_TAIL_BYTES,
): Promise<{ size: number; mtimeMs: number; digest: string } | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.size < 0) return null;
    const headLength = Math.min(before.size, headBytes);
    const head = Buffer.alloc(headLength);
    if (headLength > 0) {
      const result = await handle.read(head, 0, headLength, 0);
      if (result.bytesRead !== headLength) return null;
    }
    const tailStart = Math.max(headLength, before.size - tailBytes);
    const tailLength = Math.max(0, before.size - tailStart);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) {
      const result = await handle.read(tail, 0, tailLength, tailStart);
      if (result.bytesRead !== tailLength) return null;
    }
    const after = await handle.stat();
    if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    const hash = createHash('sha256');
    hash.update(head).update('\0').update(tail);
    return { size: before.size, mtimeMs: before.mtimeMs, digest: hash.digest('hex') };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function addCliStatRecord(
  records: CliFingerprintRecord[],
  kind: CliFingerprintRecord['kind'],
  path: string,
): void {
  try {
    const info = statSync(path);
    records.push({
      kind,
      path,
      size: info.isFile() ? info.size : null,
      mtimeMs: info.mtimeMs,
      digest: info.isFile() ? 'pending' : 'directory',
    });
  } catch {
    records.push({ kind, path, size: null, mtimeMs: null, digest: 'missing' });
  }
}

function discoverClaudeTranscriptPaths(
  projectDir: string,
  maxFiles: number,
  maxAgeDays: number,
): string[] {
  const realDir = resolveAllowedSourcePath(projectDir, projectDir, 'directory');
  if (!realDir) return [];
  let names: string[];
  try { names = readdirSync(realDir).filter(name => name.endsWith('.jsonl')); } catch { return []; }
  // Keep the adapter's bounded lexical discovery order before its mtime sort.
  const bounded = names.slice(0, maxFiles * 3);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const name of bounded) {
    const candidate = resolveAllowedDirectSourcePath(join(realDir, name), realDir, 'file');
    if (!candidate) continue;
    try {
      const info = statSync(candidate);
      if (info.mtimeMs >= cutoff && info.size > 200) candidates.push({ path: candidate, mtime: info.mtimeMs });
    } catch { /* race/removal */ }
  }
  candidates.sort((left, right) => right.mtime - left.mtime);
  return candidates.slice(0, maxFiles).map(candidate => candidate.path);
}

function discoverCodexTranscriptPaths(
  codexRoot: string,
  projectCwd: string,
  maxFiles: number,
  maxAgeDays: number,
): string[] {
  const realRoot = resolveAllowedSourcePath(codexRoot, codexRoot, 'directory');
  if (!realRoot) return [];
  const sessionsRoot = join(realRoot, 'sessions');
  const canonicalHomeRoot = resolve(join(homedir(), '.codex'));
  const mayReuseHomeDiscovery = realRoot === canonicalHomeRoot
    && homeCodexDiscoveryCache?.root === realRoot
    && Date.now() - homeCodexDiscoveryCache.cachedAt < CLI_HOME_DISCOVERY_CACHE_TTL_MS;
  let files: string[];
  if (mayReuseHomeDiscovery) {
    files = [...homeCodexDiscoveryCache!.files];
  } else {
    files = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 3 || files.length >= maxFiles * 3) return;
      const realDir = resolveAllowedDirectSourcePath(dir, realRoot, 'directory');
      if (!realDir) return;
      let names: string[];
      try { names = readdirSync(realDir).sort().reverse(); } catch { return; }
      for (const name of names) {
        if (files.length >= maxFiles * 3) break;
        const candidate = resolveAllowedDirectSourcePath(join(realDir, name), realRoot, 'any');
        if (!candidate) continue;
        try {
          const info = statSync(candidate);
          if (info.isDirectory()) walk(candidate, depth + 1);
          else if (info.isFile() && name.endsWith('.jsonl')) files.push(candidate);
        } catch { /* race/removal */ }
      }
    };
    walk(sessionsRoot, 0);
    if (realRoot === canonicalHomeRoot) {
      homeCodexDiscoveryCache = { root: realRoot, cachedAt: Date.now(), files: [...files] };
    }
  }

  const cutoff = Date.now() - maxAgeDays * 86400000;
  const normalizedProjectCwd = projectCwd.replace(/\\/g, '/').toLowerCase();
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const path of files) {
    try {
      const info = statSync(path);
      if (info.mtimeMs < cutoff || info.size <= 200) continue;
      // Match loadCodexSessions' bounded CWD peek without parsing beyond the
      // first 8 KiB of each discovered transcript.
      const cwd = readCliSessionCwd(path, realRoot);
      if (!cwd || cwd.replace(/\\/g, '/').toLowerCase() !== normalizedProjectCwd) continue;
      candidates.push({ path, mtime: info.mtimeMs });
    } catch { /* race/removal */ }
  }
  candidates.sort((left, right) => right.mtime - left.mtime);
  return candidates.slice(0, maxFiles).map(candidate => candidate.path);
}

function readCliSessionCwd(path: string, allowedRoot: string): string | null {
  const realPath = resolveAllowedDirectSourcePath(path, allowedRoot, 'file');
  if (!realPath) return null;
  let fd: number | null = null;
  try {
    const before = statSync(realPath);
    const cached = cliSessionCwdCache.get(realPath);
    if (cached
      && cached.size === before.size
      && cached.mtimeMs === before.mtimeMs
      && cached.ctimeMs === before.ctimeMs) return cached.cwd;

    fd = openSync(realPath, 'r');
    const buffer = Buffer.alloc(8 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    let cwd: string | null = null;
    for (const line of text.split(/\r?\n/).slice(0, 10)) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row.type === 'session_meta') {
          const payload = row.payload as Record<string, unknown> | undefined;
          cwd = typeof payload?.cwd === 'string' ? payload.cwd : null;
          break;
        }
      } catch { /* malformed line */ }
    }
    const after = statSync(realPath);
    if (after.size === before.size
      && after.mtimeMs === before.mtimeMs
      && after.ctimeMs === before.ctimeMs) {
      if (cliSessionCwdCache.size >= CLI_SESSION_CWD_CACHE_LIMIT) {
        const oldest = cliSessionCwdCache.keys().next().value as string | undefined;
        if (oldest !== undefined) cliSessionCwdCache.delete(oldest);
      }
      cliSessionCwdCache.set(realPath, {
        size: after.size,
        mtimeMs: after.mtimeMs,
        ctimeMs: after.ctimeMs,
        cwd,
      });
    }
    return cwd;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* already closed */ }
  }
}

/**
 * Fingerprint exactly the user-level stores already authorized by the CLI
 * transcript adapters. Metadata covers discovery/membership; each selected
 * transcript and the Codex title index receives a bounded head/tail digest so
 * appends are visible even when a filesystem preserves mtime.
 */
export async function cliSessionStoreFingerprint(
  claudeProjectDir: string,
  codexRoot: string,
  projectCwd = '',
  options: { maxAgeDays?: number; maxFiles?: number } = {},
): Promise<string> {
  const maxAgeDays = options.maxAgeDays ?? CLI_SESSION_MAX_AGE_DAYS;
  const maxFiles = options.maxFiles ?? CLI_SESSION_MAX_FILES;
  const records: CliFingerprintRecord[] = [];
  const claudePaths = discoverClaudeTranscriptPaths(claudeProjectDir, maxFiles, maxAgeDays);
  const codexPaths = discoverCodexTranscriptPaths(codexRoot, projectCwd, maxFiles, maxAgeDays);

  addCliStatRecord(records, 'claude-root', claudeProjectDir);
  addCliStatRecord(records, 'codex-root', codexRoot);
  addCliStatRecord(records, 'codex-sessions', join(codexRoot, 'sessions'));
  addCliStatRecord(records, 'codex-index', join(codexRoot, 'session_index.jsonl'));
  for (const path of claudePaths) addCliStatRecord(records, 'claude-transcript', path);
  for (const path of codexPaths) addCliStatRecord(records, 'codex-transcript', path);

  const digestRecords = await Promise.all(records.map(async record => {
    if (record.digest !== 'pending') return record;
    const bounded = await boundedHeadTailDigest(record.path);
    if (!bounded) return { ...record, digest: 'unreadable' };
    return { ...record, size: bounded.size, mtimeMs: bounded.mtimeMs, digest: bounded.digest };
  }));
  digestRecords.sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));
  const hash = createHash('sha256');
  for (const record of digestRecords) {
    hash.update(record.kind).update('\0').update(record.path).update('\0')
      .update(record.size === null ? 'missing' : String(record.size)).update('\0')
      .update(record.mtimeMs === null ? 'missing' : String(record.mtimeMs)).update('\0')
      .update(record.digest).update('\0');
  }
  return hash.digest('hex');
}

interface PublicationLock {
  token: string;
  serialized: string;
}

function snapshotsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [path, fingerprint] of left) {
    if (right.get(path) !== fingerprint) return false;
  }
  return true;
}

function sourceFingerprint(snapshot: ReadonlyMap<string, string>): string {
  const hash = createHash('sha256');
  const entries = [...snapshot.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [path, value] of entries) hash.update(path).update('\0').update(value).update('\0');
  return hash.digest('hex');
}

async function readBoundedUtf8(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 0 || info.size > maxBytes) {
      throw new Error(`file exceeds ${maxBytes} byte limit`);
    }
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw new Error('file changed while being read');
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new Error('file grew while being read');
    }
    return buffer.toString('utf-8');
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const WIKI_TYPES = new Set<WikiNodeType>([
  'project', 'roadmap', 'spec', 'issue', 'knowhow', 'note', 'domain',
]);
const WIKI_STATUSES = new Set<WikiStatus>([
  'draft', 'active', 'completed', 'blocked', 'archived', 'deprecated',
]);
const WIKI_SCOPES = new Set<WikiScope>(['project', 'global', 'team', 'personal', 'linked']);

function isStringArray(value: unknown, maxItems = 100_000): value is string[] {
  return Array.isArray(value) && value.length <= maxItems
    && value.every(item => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRuntimeWikiEntry(value: unknown): value is WikiEntry {
  if (!isRecord(value)
    || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 32_768
    || value.id === '__proto__' || value.id === 'prototype' || value.id === 'constructor'
    || !WIKI_TYPES.has(value.type as WikiNodeType)
    || typeof value.title !== 'string'
    || typeof value.summary !== 'string'
    || typeof value.body !== 'string'
    || !WIKI_STATUSES.has(value.status as WikiStatus)
    || typeof value.created !== 'string'
    || typeof value.updated !== 'string'
    || !isStringArray(value.tags)
    || !isStringArray(value.related)
    || !isRecord(value.ext)
    || !isRecord(value.source)) return false;
  const source = value.source;
  if ((source.kind !== 'file' && source.kind !== 'virtual')
    || typeof source.path !== 'string'
    || (source.line !== undefined && (!Number.isSafeInteger(source.line) || (source.line as number) < 1))
    || (source.workspace !== undefined && typeof source.workspace !== 'string')
    || (source.repoId !== undefined && !isNullableString(source.repoId))
    || (source.repoName !== undefined && typeof source.repoName !== 'string')
    || (source.alias !== undefined && typeof source.alias !== 'string')
    || (source.workspaceFence !== undefined && typeof source.workspaceFence !== 'string')) return false;
  if (value.repoId !== undefined && !isNullableString(value.repoId)) return false;
  if (value.repoName !== undefined && typeof value.repoName !== 'string') return false;
  if (value.alias !== undefined && typeof value.alias !== 'string') return false;
  if (value.workspaceFence !== undefined && typeof value.workspaceFence !== 'string') return false;
  if (value.appliesToRepoIds !== undefined && value.appliesToRepoIds !== null
    && !isStringArray(value.appliesToRepoIds)) return false;
  return (value.scope === null || WIKI_SCOPES.has(value.scope as WikiScope))
    && isNullableString(value.category)
    && isNullableString(value.specCategory)
    && isNullableString(value.createdBy)
    && isNullableString(value.sourceRef)
    && isNullableString(value.parent);
}

interface ValidatedSearchCache {
  version: number;
  generatedAt: number;
  sourceFingerprint: string;
  /** Optional for legacy caches; required before reuse when CLI sources are enabled. */
  cliSessionFingerprint?: string;
  mtimeSnapshot: Array<[string, string]>;
  entries: WikiEntry[];
  compiled?: SerializedInvertedIndex;
}

function validateSearchCache(value: unknown): ValidatedSearchCache | null {
  if (!isRecord(value)
    || (value.version !== SEARCH_CACHE_VERSION
      && value.version !== LEGACY_SEARCH_CACHE_VERSION
      && value.version !== OLDER_SEARCH_CACHE_VERSION)
    || !Number.isFinite(value.generatedAt)
    || typeof value.sourceFingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.sourceFingerprint)
    || (value.cliSessionFingerprint !== undefined
      && (typeof value.cliSessionFingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.cliSessionFingerprint)))
    || !Array.isArray(value.mtimeSnapshot)
    || value.mtimeSnapshot.length > MAX_SEARCH_CACHE_ENTRIES
    || !Array.isArray(value.entries)
    || value.entries.length > MAX_SEARCH_CACHE_ENTRIES) return null;

  const snapshot: Array<[string, string]> = [];
  const snapshotPaths = new Set<string>();
  for (const item of value.mtimeSnapshot) {
    if (!Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || item[0].length === 0 || item[0].length > 32_768
      || typeof item[1] !== 'string' || item[1].length > 512
      || snapshotPaths.has(item[0])) return null;
    snapshotPaths.add(item[0]);
    snapshot.push([item[0], item[1]]);
  }

  const entries: WikiEntry[] = [];
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!isRuntimeWikiEntry(entry) || ids.has(entry.id)) return null;
    ids.add(entry.id);
    entries.push(entry);
  }
  // Compiled postings are a v9-only acceleration section. A legacy v8
  // cache remains readable but cannot opt into a payload that its publication
  // contract never recorded.
  const compiled = value.version !== SEARCH_CACHE_VERSION || value.compiled === undefined
    ? undefined
    // Full validation happens once in tryLoadSearchCache, where canonical
    // entry IDs/config keys are available. Avoid parsing a large payload twice.
    : value.compiled as SerializedInvertedIndex;
  return {
    version: value.version as number,
    generatedAt: value.generatedAt as number,
    sourceFingerprint: value.sourceFingerprint,
    ...(value.cliSessionFingerprint === undefined
      ? {}
      : { cliSessionFingerprint: value.cliSessionFingerprint }),
    mtimeSnapshot: snapshot,
    entries,
    ...(compiled ? { compiled } : {}),
  };
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquirePublicationLock(workflowRoot: string): Promise<PublicationLock | null> {
  const path = join(workflowRoot, PUBLICATION_LOCK_FILE);
  const deadline = Date.now() + PUBLICATION_LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    const token = randomUUID();
    const serialized = JSON.stringify({ pid: process.pid, token });
    try {
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, serialized); } finally { closeSync(fd); }
      return { token, serialized };
    } catch {
      try {
        const observed = readFileSync(path, 'utf-8');
        const owner = JSON.parse(observed) as { pid?: unknown; token?: unknown };
        if (typeof owner.token === 'string'
          && Number.isSafeInteger(owner.pid)
          && !processIsAlive(owner.pid as number)
          && readFileSync(path, 'utf-8') === observed) {
          unlinkSync(path);
          continue;
        }
      } catch { /* unreadable or concurrently released: retry until bounded deadline */ }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  return null;
}

function releasePublicationLock(workflowRoot: string, lock: PublicationLock | null): void {
  if (!lock) return;
  const path = join(workflowRoot, PUBLICATION_LOCK_FILE);
  try {
    if (readFileSync(path, 'utf-8') === lock.serialized) unlinkSync(path);
  } catch { /* already released */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStatus(value: unknown): WikiStatus | null {
  if (typeof value !== 'string') return null;
  // `superseded` (decision lifecycle) is the same terminal state as deprecated.
  const normalized = value === 'superseded' ? 'deprecated' : value;
  const allowed: WikiStatus[] = ['draft', 'active', 'completed', 'blocked', 'archived', 'deprecated'];
  return (allowed as string[]).includes(normalized)
    ? (normalized as WikiStatus)
    : null;
}

function inferStatus(type: WikiNodeType): WikiStatus {
  if (type === 'spec' || type === 'project' || type === 'roadmap') return 'active';
  return 'draft';
}

function firstHeading(body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function firstParagraph(body: string): string {
  const withoutFm = body.replace(/^#\s+.+\n+/, '');
  const para = withoutFm.split(/\n\s*\n/).find((p) => p.trim().length > 0) ?? '';
  return para.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function extractTags(data: Record<string, unknown>): string[] {
  const tags = data.tags ?? data.keywords;
  if (!Array.isArray(tags)) return [];
  return tags.map(String).filter((s) => s.length > 0);
}

function normalizeRelated(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    // Block-array parser keeps surrounding quotes; strip them so
    // `"[[id]]"` and `[[id]]` both resolve.
    const unquoted = v.replace(/^["']|["']$/g, '');
    const m = unquoted.match(/^\[\[([^\]]+)\]\]$/);
    out.push(m ? m[1] : unquoted);
  }
  return out;
}

function extractExt(data: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    'title', 'summary', 'tags', 'status', 'related',
    'category', 'specCategory', 'createdBy', 'sourceRef', 'parent',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!known.has(k)) out[k] = v;
  }
  return out;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveLink(
  target: string,
  byId: Record<string, WikiEntry>,
  titleIndex: Map<string, string>,
): string | null {
  if (byId[target]) return target;
  const hit = titleIndex.get(target.toLowerCase());
  return hit ?? null;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function filterEntries(entries: WikiEntry[], filters: WikiFilters): WikiEntry[] {
  return entries.filter((d) => {
    if (filters.type && d.type !== filters.type) return false;
    if (filters.scope && d.scope !== filters.scope) return false;
    if (filters.tag && !d.tags.includes(filters.tag)) return false;
    if (filters.status && d.status !== filters.status) return false;
    if (filters.category && d.category !== filters.category) return false;
    if (filters.createdBy && d.createdBy !== filters.createdBy) return false;
    if (filters.tool && d.ext?.tool !== true && d.ext?.tool !== 'true') return false;
    if (filters.workspace && d.source.workspace !== filters.workspace) return false;
    if (!matchesWikiRepository(d, filters)) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}
