import { randomUUID } from 'node:crypto';

/** Stable schema identifier for request-scoped search diagnostics. */
export const SEARCH_DIAGNOSTICS_SCHEMA = 'maestro-search-diagnostics/1.0' as const;
/** Diagnostics are deliberately small: they are for attribution, not tracing. */
export const SEARCH_DIAGNOSTICS_MAX_BYTES = 16 * 1024;
export const SEARCH_DIAGNOSTICS_MAX_PHASES = 32;
export const SEARCH_DIAGNOSTICS_MAX_FALLBACKS = 16;
export const SEARCH_DIAGNOSTICS_MAX_TOKEN_LENGTH = 64;

export type SearchDiagnosticProvider = 'daemon' | 'indexer' | 'mixed' | 'kg' | 'arch-kb' | 'none';
export type SearchDiagnosticCacheState = 'hit' | 'miss' | 'stale' | 'unknown';

/**
 * A phase is intentionally represented by a small fixed-shape record.  Do not
 * add paths, query text, or free-form error messages here: diagnostics can be
 * printed by untrusted callers and are never a persistence format.
 */
export interface SearchDiagnosticPhase {
  phase: string;
  durationMs: number;
  candidateCount?: number;
}

/** Reason-coded fallback attribution; values are sanitized to bounded tokens. */
export interface SearchDiagnosticFallback {
  source: string;
  reason: string;
}

/** JSON-safe request diagnostics exposed by `--diagnostics`. */
export interface SearchCandidateBudgetDiagnostics {
  mode: 'legacy' | 'adaptive';
  requestedLimit: number;
  initialCandidateLimit: number;
  candidateLimit: number;
  hardCap: number;
  escalated: boolean;
  legacyCandidateLimit: number;
}

export interface SearchDiagnostics {
  schemaVersion: typeof SEARCH_DIAGNOSTICS_SCHEMA;
  requestId: string;
  durationMs: number;
  phases: SearchDiagnosticPhase[];
  fallbacks: SearchDiagnosticFallback[];
  provider?: SearchDiagnosticProvider;
  cacheState?: SearchDiagnosticCacheState;
  embeddingUsed?: boolean;
  embeddingDocs?: number;
  resultCount?: number;
  candidateCount?: number;
  /** Unique candidates after authorization/facet/cap filtering. */
  eligibleCandidateCount?: number;
  /** One request budget snapshot; absent for ordinary non-budget callers. */
  candidateBudget?: SearchCandidateBudgetDiagnostics;
  truncated?: boolean;
}

/**
 * The intentionally tiny interface consumed by WikiIndexer.  Keeping this
 * structural lets the dashboard package record diagnostics without importing
 * the root CLI package (the dashboard is compiled first).
 */
export interface SearchDiagnosticsRecorder {
  readonly requestId: string;
  recordPhase(phase: string, durationMs: number, candidateCount?: number): void;
  /** Short aliases retained for lightweight consumers. */
  phase(phase: string, durationMs: number, candidateCount?: number): void;
  recordFallback(source: string, reason: string): void;
  fallback(source: string, reason: string): void;
  setProvider(provider: SearchDiagnosticProvider): void;
  setCacheState(state: SearchDiagnosticCacheState): void;
  setEmbedding(used: boolean, docs: number): void;
  setResultCount(count: number): void;
  setCandidateCount(count: number): void;
  setEligibleCandidateCount?(count: number): void;
  setCandidateBudget?(budget: SearchCandidateBudgetDiagnostics): void;
  merge(value: unknown): void;
  snapshot(): SearchDiagnostics;
  toJSON(): SearchDiagnostics;
  finish(): SearchDiagnostics;
}

/** Alias used by callers that treat diagnostics as a per-request context. */
export type SearchDiagnosticsContext = SearchDiagnosticsRecorder;

function boundedDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.round(value)));
}

function boundedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1_000_000_000, Math.max(0, Math.trunc(value)));
}

/** Keep diagnostics tokens opaque and path-free. */
function boundedToken(value: unknown, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback;
  const token = value.trim().toLowerCase();
  if (!token || token.length > SEARCH_DIAGNOSTICS_MAX_TOKEN_LENGTH) return fallback;
  // Slashes, dots, whitespace, and punctuation are intentionally rejected so
  // a path or an arbitrary error/query string cannot cross this boundary.
  return /^[a-z0-9][a-z0-9_-]*$/.test(token) ? token : fallback;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function provider(value: unknown): SearchDiagnosticProvider | undefined {
  return value === 'daemon' || value === 'indexer' || value === 'mixed'
    || value === 'kg' || value === 'arch-kb' || value === 'none'
    ? value
    : undefined;
}

function cacheState(value: unknown): SearchDiagnosticCacheState | undefined {
  return value === 'hit' || value === 'miss' || value === 'stale' || value === 'unknown'
    ? value
    : undefined;
}

function normalizeCandidateBudget(value: unknown): SearchCandidateBudgetDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const mode = row.mode === 'legacy' || row.mode === 'adaptive' ? row.mode : null;
  if (!mode) return null;
  const requestedLimit = boundedCount(row.requestedLimit);
  const initialCandidateLimit = boundedCount(row.initialCandidateLimit);
  const candidateLimit = boundedCount(row.candidateLimit);
  const hardCap = boundedCount(row.hardCap);
  const legacyCandidateLimit = boundedCount(row.legacyCandidateLimit);
  if (hardCap <= 0 || candidateLimit > hardCap || initialCandidateLimit > hardCap) return null;
  return {
    mode,
    requestedLimit,
    initialCandidateLimit,
    candidateLimit,
    hardCap,
    escalated: row.escalated === true,
    legacyCandidateLimit,
  };
}

function normalizePhase(value: unknown): SearchDiagnosticPhase | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { phase?: unknown; durationMs?: unknown; candidateCount?: unknown };
  const phase = boundedToken(row.phase);
  if (phase === 'unknown') return null;
  const normalized: SearchDiagnosticPhase = { phase, durationMs: boundedDuration(row.durationMs) };
  if (row.candidateCount !== undefined) normalized.candidateCount = boundedCount(row.candidateCount);
  return normalized;
}

function normalizeFallback(value: unknown): SearchDiagnosticFallback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { source?: unknown; reason?: unknown };
  const source = boundedToken(row.source);
  const reason = boundedToken(row.reason);
  if (source === 'unknown' || reason === 'unknown') return null;
  return { source, reason };
}

/**
 * Validate and sanitize diagnostics crossing a daemon/CLI boundary. Unknown
 * fields are ignored so a newer daemon can safely answer an older client.
 */
export function sanitizeSearchDiagnostics(value: unknown): SearchDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== SEARCH_DIAGNOSTICS_SCHEMA || !validRequestId(row.requestId)) return null;

  const phases: SearchDiagnosticPhase[] = [];
  if (Array.isArray(row.phases)) {
    for (const item of row.phases.slice(0, SEARCH_DIAGNOSTICS_MAX_PHASES)) {
      const phase = normalizePhase(item);
      if (phase) phases.push(phase);
    }
  }
  const fallbacks: SearchDiagnosticFallback[] = [];
  if (Array.isArray(row.fallbacks)) {
    for (const item of row.fallbacks.slice(0, SEARCH_DIAGNOSTICS_MAX_FALLBACKS)) {
      const fallback = normalizeFallback(item);
      if (fallback) fallbacks.push(fallback);
    }
  }

  const normalized: SearchDiagnostics = {
    schemaVersion: SEARCH_DIAGNOSTICS_SCHEMA,
    requestId: row.requestId,
    durationMs: boundedDuration(row.durationMs),
    phases,
    fallbacks,
  };
  const normalizedProvider = provider(row.provider);
  if (normalizedProvider) normalized.provider = normalizedProvider;
  const normalizedCache = cacheState(row.cacheState);
  if (normalizedCache) normalized.cacheState = normalizedCache;
  if (typeof row.embeddingUsed === 'boolean') normalized.embeddingUsed = row.embeddingUsed;
  if (row.embeddingDocs !== undefined) normalized.embeddingDocs = boundedCount(row.embeddingDocs);
  if (row.resultCount !== undefined) normalized.resultCount = boundedCount(row.resultCount);
  if (row.candidateCount !== undefined) normalized.candidateCount = boundedCount(row.candidateCount);
  if (row.eligibleCandidateCount !== undefined) {
    normalized.eligibleCandidateCount = boundedCount(row.eligibleCandidateCount);
  }
  const normalizedBudget = normalizeCandidateBudget(row.candidateBudget);
  if (normalizedBudget) normalized.candidateBudget = normalizedBudget;
  if (typeof row.truncated === 'boolean') normalized.truncated = row.truncated;
  return normalized;
}

/** Runtime type guard for compatible daemon responses. */
export function isSearchDiagnostics(value: unknown): value is SearchDiagnostics {
  return sanitizeSearchDiagnostics(value) !== null;
}

/** Naming aliases for protocol/client callers that use normalize terminology. */
export const normalizeSearchDiagnostics = sanitizeSearchDiagnostics;
export const createSearchDiagnosticsContext = createSearchDiagnostics;
export type SearchDiagnosticsMeta = SearchDiagnostics;

function baseSnapshot(requestId: string): SearchDiagnostics {
  return {
    schemaVersion: SEARCH_DIAGNOSTICS_SCHEMA,
    requestId,
    durationMs: 0,
    phases: [],
    fallbacks: [],
  };
}

/** Create an in-memory, bounded recorder for exactly one search request. */
export function createSearchDiagnostics(options?: { requestId?: string }): SearchDiagnosticsRecorder {
  const requestId = validRequestId(options?.requestId) ? options!.requestId! : randomUUID();
  const startedAt = performance.now();
  let state = baseSnapshot(requestId);
  let finalized = false;

  const recorder: SearchDiagnosticsRecorder = {
    requestId,
    recordPhase(phaseName, durationMs, candidateCount) {
      if (state.phases.length >= SEARCH_DIAGNOSTICS_MAX_PHASES) {
        state.truncated = true;
        return;
      }
      const phase = boundedToken(phaseName);
      if (phase === 'unknown') {
        state.truncated = true;
        return;
      }
      state.phases.push({
        phase,
        durationMs: boundedDuration(durationMs),
        ...(candidateCount === undefined ? {} : { candidateCount: boundedCount(candidateCount) }),
      });
    },
    phase(phaseName, durationMs, candidateCount) {
      recorder.recordPhase(phaseName, durationMs, candidateCount);
    },
    recordFallback(sourceName, reasonName) {
      if (state.fallbacks.length >= SEARCH_DIAGNOSTICS_MAX_FALLBACKS) {
        state.truncated = true;
        return;
      }
      const source = boundedToken(sourceName);
      const reason = boundedToken(reasonName);
      if (source === 'unknown' || reason === 'unknown') {
        state.truncated = true;
        return;
      }
      state.fallbacks.push({ source, reason });
    },
    fallback(sourceName, reasonName) {
      recorder.recordFallback(sourceName, reasonName);
    },
    setProvider(value) {
      state.provider = value;
    },
    setCacheState(value) {
      // Preserve the strongest observed state when concurrent index/cache work
      // reports more than one phase (stale > miss > hit > unknown).
      const rank: Record<SearchDiagnosticCacheState, number> = {
        unknown: 0, hit: 1, miss: 2, stale: 3,
      };
      if (!state.cacheState || rank[value] >= rank[state.cacheState]) state.cacheState = value;
    },
    setEmbedding(used, docs) {
      state.embeddingUsed = used;
      state.embeddingDocs = boundedCount(docs);
    },
    setResultCount(count) {
      state.resultCount = boundedCount(count);
    },
    setCandidateCount(count) {
      state.candidateCount = boundedCount(count);
    },
    setEligibleCandidateCount(count) {
      state.eligibleCandidateCount = boundedCount(count);
    },
    setCandidateBudget(budget) {
      const normalized = normalizeCandidateBudget(budget);
      if (normalized) state.candidateBudget = normalized;
    },
    merge(value) {
      const remote = sanitizeSearchDiagnostics(value);
      if (!remote) return;
      for (const phase of remote.phases) recorder.recordPhase(phase.phase, phase.durationMs, phase.candidateCount);
      for (const fallback of remote.fallbacks) recorder.recordFallback(fallback.source, fallback.reason);
      if (remote.provider) recorder.setProvider(remote.provider);
      if (remote.cacheState) recorder.setCacheState(remote.cacheState);
      if (remote.embeddingUsed !== undefined) recorder.setEmbedding(remote.embeddingUsed, remote.embeddingDocs ?? 0);
      if (remote.resultCount !== undefined) recorder.setResultCount(remote.resultCount);
      if (remote.candidateCount !== undefined) recorder.setCandidateCount(remote.candidateCount);
      if (remote.eligibleCandidateCount !== undefined) recorder.setEligibleCandidateCount?.(remote.eligibleCandidateCount);
      if (remote.candidateBudget) recorder.setCandidateBudget?.(remote.candidateBudget);
      if (remote.truncated) state.truncated = true;
    },
    snapshot() {
      // The duration is calculated on every read, keeping the context useful
      // even when a caller asks for diagnostics after a partially failed path.
      state.durationMs = finalized
        ? state.durationMs
        : boundedDuration(performance.now() - startedAt);
      return {
        ...state,
        phases: state.phases.map(phase => ({ ...phase })),
        fallbacks: state.fallbacks.map(fallback => ({ ...fallback })),
      };
    },
    toJSON() {
      return recorder.snapshot();
    },
    finish() {
      if (!finalized) {
        state.durationMs = boundedDuration(performance.now() - startedAt);
        finalized = true;
      }
      return recorder.snapshot();
    },
  };
  return recorder;
}

/** Finish a recorder when the caller wants an explicit terminal snapshot. */
export function finishSearchDiagnostics(recorder: SearchDiagnosticsRecorder): SearchDiagnostics {
  const finish = (recorder as SearchDiagnosticsRecorder & { finish?: () => SearchDiagnostics }).finish;
  return typeof finish === 'function' ? finish() : recorder.snapshot();
}

/** Record an async phase while preserving the original result/error. */
export async function withSearchDiagnosticPhase<T>(
  recorder: SearchDiagnosticsRecorder | undefined,
  phase: string,
  work: Promise<T> | (() => Promise<T>),
  candidateCount?: number,
): Promise<T> {
  if (!recorder) return typeof work === 'function' ? work() : work;
  const startedAt = performance.now();
  try {
    return await (typeof work === 'function' ? work() : work);
  } finally {
    recorder.recordPhase(phase, performance.now() - startedAt, candidateCount);
  }
}

/** Record a synchronous phase without leaking its return value into the API. */
export function recordSearchDiagnosticPhase<T>(
  recorder: SearchDiagnosticsRecorder | undefined,
  phase: string,
  work: () => T,
  candidateCount?: number,
): T {
  if (!recorder) return work();
  const startedAt = performance.now();
  try {
    return work();
  } finally {
    recorder.recordPhase(phase, performance.now() - startedAt, candidateCount);
  }
}

/**
 * Return a sanitized object suitable for embedding in a larger JSON response.
 * The result is guaranteed to stay under the diagnostics byte budget; optional
 * fields and then tail phases/fallbacks are removed if a custom token somehow
 * causes the budget to be exceeded.
 */
export function boundedSearchDiagnostics(value: unknown): SearchDiagnostics | null {
  const normalized = sanitizeSearchDiagnostics(value);
  if (!normalized) return null;
  const fits = (candidate: SearchDiagnostics): boolean =>
    Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= SEARCH_DIAGNOSTICS_MAX_BYTES;
  if (fits(normalized)) return normalized;

  const compact: SearchDiagnostics = {
    schemaVersion: normalized.schemaVersion,
    requestId: normalized.requestId,
    durationMs: normalized.durationMs,
    phases: normalized.phases.slice(0, 8),
    fallbacks: normalized.fallbacks.slice(0, 8),
    truncated: true,
  };
  if (normalized.provider) compact.provider = normalized.provider;
  if (normalized.cacheState) compact.cacheState = normalized.cacheState;
  if (normalized.embeddingUsed !== undefined) compact.embeddingUsed = normalized.embeddingUsed;
  if (normalized.embeddingDocs !== undefined) compact.embeddingDocs = normalized.embeddingDocs;
  if (normalized.resultCount !== undefined) compact.resultCount = normalized.resultCount;
  if (normalized.candidateCount !== undefined) compact.candidateCount = normalized.candidateCount;
  if (normalized.eligibleCandidateCount !== undefined) compact.eligibleCandidateCount = normalized.eligibleCandidateCount;
  if (normalized.candidateBudget) compact.candidateBudget = normalized.candidateBudget;
  while (!fits(compact) && compact.fallbacks.length > 0) compact.fallbacks.pop();
  while (!fits(compact) && compact.phases.length > 0) compact.phases.pop();
  return compact;
}

/** Serialize a bounded diagnostics object for stderr or protocol tests. */
export function serializeSearchDiagnostics(value: unknown): string {
  const normalized = boundedSearchDiagnostics(value) ?? boundedSearchDiagnostics(baseSnapshot(randomUUID()))!;
  return JSON.stringify(normalized);
}
