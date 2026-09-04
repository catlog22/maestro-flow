/**
 * Search candidate budget policy shared by the CLI and dashboard search.
 *
 * A search has one display limit (the user's K) and one provider candidate
 * limit.  The latter is deliberately computed at the request boundary and
 * passed through the provider stack rather than being multiplied by every
 * layer.  Adaptive mode is opt-in (`MAESTRO_SEARCH_ADAPTIVE_BUDGET=1`); the
 * legacy policy remains available so rollout can compare both policies without
 * changing the default result contract.
 */

export const SEARCH_CANDIDATE_HARD_CAP = 500 as const;
export const SEARCH_CANDIDATE_DEFAULT_MULTIPLIER = 2 as const;
export const SEARCH_CANDIDATE_DEFAULT_MINIMUM = 40 as const;
export const SEARCH_CANDIDATE_MAX_ESCALATIONS = 1 as const;
export const SEARCH_CANDIDATE_ADAPTIVE_ENV = 'MAESTRO_SEARCH_ADAPTIVE_BUDGET' as const;
/** Compatibility aliases for provider adapters and rollout probes. */
export const MAX_SEARCH_CANDIDATES = SEARCH_CANDIDATE_HARD_CAP;
export const SEARCH_MAX_CANDIDATES = SEARCH_CANDIDATE_HARD_CAP;
export const MAX_CANDIDATES = SEARCH_CANDIDATE_HARD_CAP;
export const SEARCH_ADAPTIVE_BUDGET_ENV = SEARCH_CANDIDATE_ADAPTIVE_ENV;

export type SearchCandidateBudgetMode = 'legacy' | 'adaptive';
export type SearchCandidateBudgetSurface =
  | 'search'
  | 'wiki'
  | 'mixed'
  | 'indexer'
  | 'planned'
  | 'kg'
  | 'code'
  | 'arch-kb';

/**
 * Immutable-by-convention request budget.  `candidateLimit` is the active
 * pass.  `resultLimit` is always the user's requested display K and is never
 * changed by escalation.
 */
export interface SearchCandidateBudget {
  /** User-visible result limit (K). */
  readonly resultLimit: number;
  /** Alias retained for callers that call the user limit simply `limit`. */
  readonly limit: number;
  /** Active provider candidate limit for this pass. */
  readonly candidateLimit: number;
  /** Initial provider candidate limit before a possible second pass. */
  readonly initialCandidateLimit: number;
  /** Absolute provider cap. Always <= SEARCH_CANDIDATE_HARD_CAP. */
  readonly maxCandidateLimit: number;
  /** Alias for maxCandidateLimit used by protocol/diagnostic consumers. */
  readonly hardCap: number;
  /** Current rollout policy. */
  readonly mode: SearchCandidateBudgetMode;
  /** Whether this budget can perform the one adaptive second pass. */
  readonly adaptive: boolean;
  /** Whether this is the escalated second pass. */
  readonly escalated: boolean;
  /** Number of adaptive escalations already consumed (0 or 1). */
  readonly escalationCount: number;
  /** Legacy candidate limit for shadow/rollout comparison. */
  readonly legacyCandidateLimit: number;
  /** Policy surface used to derive legacyCandidateLimit. */
  readonly surface: SearchCandidateBudgetSurface;
}

export interface SearchCandidateBudgetOptions {
  /** Explicit mode wins over MAESTRO_SEARCH_ADAPTIVE_BUDGET. */
  mode?: SearchCandidateBudgetMode;
  adaptive?: boolean;
  surface?: SearchCandidateBudgetSurface;
  multiplier?: number;
  minimum?: number;
  hardCap?: number;
  /** Test/embedding callers may provide an environment object explicitly. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Candidate observations used to decide whether a second pass can help. */
export interface SearchCandidateCounts {
  /** Number of raw candidates returned by the provider. */
  candidateCount?: number;
  /** Alias for candidateCount used by some provider adapters. */
  returnedCount?: number;
  /** Number of unique candidates before eligibility filters. */
  uniqueCandidateCount?: number;
  /** Number of unique candidates surviving authorization/facets/caps. */
  eligibleUniqueCount?: number;
  /** Alias accepted at adapter boundaries. */
  eligibleUniqueCandidates?: number;
  /** Explicit saturation signal from a provider. */
  saturated?: boolean;
}

export interface SearchCandidateShadowComparison {
  legacyCandidateLimit: number;
  adaptiveCandidateLimit: number;
  legacyCount: number;
  adaptiveCount: number;
  topLimit: number;
  topIdsEqual: boolean;
  overlapCount: number;
}

function finiteInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function normalizeLimit(value: unknown, hardCap: number): number {
  return Math.min(hardCap, Math.max(0, finiteInteger(value)));
}

function normalizeHardCap(value: unknown): number {
  const requested = finiteInteger(value, SEARCH_CANDIDATE_HARD_CAP);
  return Math.min(SEARCH_CANDIDATE_HARD_CAP, Math.max(1, requested));
}

function normalizeMultiplier(value: unknown): number {
  const multiplier = typeof value === 'number' && Number.isFinite(value)
    ? value
    : SEARCH_CANDIDATE_DEFAULT_MULTIPLIER;
  return Math.max(1, multiplier);
}

function normalizeMinimum(value: unknown, hardCap: number): number {
  const minimum = finiteInteger(value, SEARCH_CANDIDATE_DEFAULT_MINIMUM);
  return Math.min(hardCap, Math.max(0, minimum));
}

/** True only for the explicit opt-in rollout flag. */
export function isAdaptiveSearchBudgetEnabled(
  env: Readonly<Record<string, string | undefined>> =
    (typeof process === 'undefined' ? {} : process.env),
): boolean {
  return env[SEARCH_CANDIDATE_ADAPTIVE_ENV] === '1';
}

/**
 * Return the pre-adaptive candidate policy used by each current call site.
 * Keeping this in one pure function lets the default path remain byte-for-
 * byte compatible while adaptive callers stop applying these multipliers.
 */
export function legacySearchCandidateLimit(
  limit: number,
  surface: SearchCandidateBudgetSurface = 'search',
  hardCap: number = SEARCH_CANDIDATE_HARD_CAP,
): number {
  const cap = normalizeHardCap(hardCap);
  const normalized = normalizeLimit(limit, cap);
  if (normalized === 0) return 0;
  switch (surface) {
    case 'mixed': return Math.min(cap, Math.max(normalized * 3, 60));
    case 'kg': return Math.min(cap, Math.max(normalized * 4, 40));
    case 'indexer':
    case 'planned': return Math.min(cap, Math.max(normalized * 3, 60));
    case 'code':
    case 'arch-kb': return normalized;
    case 'search':
    case 'wiki':
    default: return Math.min(cap, Math.max(normalized * 2, 40));
  }
}

/** Compute the one-pass adaptive candidate count. */
export function adaptiveSearchCandidateLimit(
  limit: number,
  options: Pick<SearchCandidateBudgetOptions, 'multiplier' | 'minimum' | 'hardCap'> = {},
): number {
  const cap = normalizeHardCap(options.hardCap);
  const normalized = normalizeLimit(limit, cap);
  if (normalized === 0) return 0;
  const multiplier = normalizeMultiplier(options.multiplier);
  const minimum = normalizeMinimum(options.minimum, cap);
  return Math.min(cap, Math.max(Math.ceil(normalized * multiplier), minimum));
}

/**
 * Compute a request budget exactly once.  If no mode is supplied, the explicit
 * environment opt-in selects adaptive; otherwise legacy is selected.
 */
export function computeSearchCandidateBudget(
  limit: number,
  options: SearchCandidateBudgetOptions | boolean = {},
): SearchCandidateBudget {
  const policy = typeof options === 'boolean' ? { adaptive: options } : options;
  const hardCap = normalizeHardCap(policy.hardCap);
  const surface = policy.surface ?? 'search';
  const normalizedLimit = normalizeLimit(limit, hardCap);
  const mode: SearchCandidateBudgetMode = policy.mode
    ?? (policy.adaptive === undefined
      ? (isAdaptiveSearchBudgetEnabled(policy.env) ? 'adaptive' : 'legacy')
      : policy.adaptive ? 'adaptive' : 'legacy');
  const optionsForAdaptive = policy;
  const adaptive = mode === 'adaptive';
  const legacyCandidateLimit = legacySearchCandidateLimit(normalizedLimit, surface, hardCap);
  const initialCandidateLimit = adaptive
    ? adaptiveSearchCandidateLimit(normalizedLimit, optionsForAdaptive)
    : legacyCandidateLimit;
  return {
    resultLimit: normalizedLimit,
    limit: normalizedLimit,
    candidateLimit: initialCandidateLimit,
    initialCandidateLimit,
    maxCandidateLimit: hardCap,
    hardCap,
    mode,
    adaptive,
    escalated: false,
    escalationCount: 0,
    legacyCandidateLimit,
    surface,
  };
}

/** Naming aliases used by adapters and tests. */
export const createSearchCandidateBudget = computeSearchCandidateBudget;
export const createCandidateBudget = computeSearchCandidateBudget;
export const computeCandidateBudget = computeSearchCandidateBudget;
export const getSearchCandidateBudget = computeSearchCandidateBudget;
export const getCandidateBudget = computeSearchCandidateBudget;
export const createAdaptiveSearchCandidateBudget = (
  limit: number,
  options: Omit<SearchCandidateBudgetOptions, 'mode' | 'adaptive'> = {},
): SearchCandidateBudget => computeSearchCandidateBudget(limit, {
  ...options,
  mode: 'adaptive',
});
export const createLegacySearchCandidateBudget = (
  limit: number,
  options: Omit<SearchCandidateBudgetOptions, 'mode' | 'adaptive'> = {},
): SearchCandidateBudget => computeSearchCandidateBudget(limit, {
  ...options,
  mode: 'legacy',
});

function observationCount(count: SearchCandidateCounts): number {
  const value = count.candidateCount ?? count.returnedCount ?? count.uniqueCandidateCount;
  return Math.max(0, finiteInteger(value));
}

function eligibleCount(count: SearchCandidateCounts): number {
  const value = count.eligibleUniqueCount
    ?? count.eligibleUniqueCandidates
    ?? count.uniqueCandidateCount
    ?? count.returnedCount
    ?? count.candidateCount;
  return Math.max(0, finiteInteger(value));
}

/** Whether the active provider pass reached its candidate ceiling. */
export function isSearchCandidateBudgetSaturated(
  budget: SearchCandidateBudget,
  counts: SearchCandidateCounts,
): boolean {
  if (counts.saturated === true) return true;
  if (counts.saturated === false) return false;
  return observationCount(counts) >= budget.candidateLimit;
}

/**
 * Escalate exactly once, and only when the first pass is both underfilled after
 * eligibility/deduplication and saturated.  A sparse provider cannot benefit
 * from asking for more, and a full eligible result must never trigger work.
 */
function budgetAndCounts(
  budgetOrCounts: SearchCandidateBudget | SearchCandidateCounts,
  countsOrBudget: SearchCandidateCounts | SearchCandidateBudget | number,
  candidateCount?: number,
): { budget: SearchCandidateBudget; counts: SearchCandidateCounts } | null {
  if ('candidateLimit' in budgetOrCounts) {
    return {
      budget: budgetOrCounts,
      counts: typeof countsOrBudget === 'number'
        ? { eligibleUniqueCount: countsOrBudget, candidateCount }
        : ('candidateLimit' in countsOrBudget ? {} : countsOrBudget),
    };
  }
  if (typeof countsOrBudget === 'object' && countsOrBudget !== null && 'candidateLimit' in countsOrBudget) {
    return { budget: countsOrBudget, counts: budgetOrCounts };
  }
  return null;
}

export function shouldEscalateSearchCandidateBudget(
  budgetOrCounts: SearchCandidateBudget | SearchCandidateCounts,
  countsOrBudget: SearchCandidateCounts | SearchCandidateBudget | number,
  candidateCount?: number,
): boolean {
  const pair = budgetAndCounts(budgetOrCounts, countsOrBudget, candidateCount);
  if (!pair) return false;
  const { budget, counts } = pair;
  if (!budget.adaptive) return false;
  if (budget.escalated || budget.escalationCount >= SEARCH_CANDIDATE_MAX_ESCALATIONS) return false;
  if (budget.candidateLimit <= 0 || budget.candidateLimit >= budget.maxCandidateLimit) return false;
  if (eligibleCount(counts) >= budget.resultLimit) return false;
  return isSearchCandidateBudgetSaturated(budget, counts);
}

/** Return a new budget for the one allowed 2x pass, or the same budget. */
export function escalateSearchCandidateBudget(
  budgetOrCounts: SearchCandidateBudget | SearchCandidateCounts,
  countsOrBudget: SearchCandidateCounts | SearchCandidateBudget | number,
  candidateCount?: number,
): SearchCandidateBudget {
  const pair = budgetAndCounts(budgetOrCounts, countsOrBudget, candidateCount);
  if (!pair) {
    return ('candidateLimit' in budgetOrCounts)
      ? budgetOrCounts
      : (typeof countsOrBudget === 'object' && countsOrBudget !== null && 'candidateLimit' in countsOrBudget
        ? countsOrBudget
        : computeSearchCandidateBudget(0, { mode: 'adaptive' }));
  }
  const { budget, counts } = pair;
  if (!shouldEscalateSearchCandidateBudget(budget, counts)) return budget;
  const candidateLimit = Math.min(
    budget.maxCandidateLimit,
    Math.max(budget.candidateLimit, budget.candidateLimit * 2),
  );
  return {
    ...budget,
    candidateLimit,
    escalated: true,
    escalationCount: budget.escalationCount + 1,
  };
}

export const nextSearchCandidateBudget = escalateSearchCandidateBudget;
export const nextCandidateBudget = escalateSearchCandidateBudget;
export const shouldEscalateCandidateBudget = shouldEscalateSearchCandidateBudget;
export const escalateCandidateBudget = escalateSearchCandidateBudget;

/** Count stable unique IDs without changing provider ordering. */
export function countUniqueSearchCandidates<T>(
  candidates: readonly T[],
  identity: (candidate: T) => unknown = candidate => candidate,
): number {
  const seen = new Set<unknown>();
  for (const candidate of candidates) seen.add(identity(candidate));
  return seen.size;
}

export const countUniqueCandidates = countUniqueSearchCandidates;
export const countUniqueCandidateIds = countUniqueSearchCandidates;

/**
 * Compare legacy and adaptive Top-N IDs for shadow rollout.  The comparison is
 * pure and does not alter either result list or any public result field.
 */
export function compareSearchCandidateResults(
  legacyIds: readonly string[],
  adaptiveIds: readonly string[],
  budget: SearchCandidateBudget | number,
): SearchCandidateShadowComparison {
  const topLimit = Math.max(0, Math.trunc(typeof budget === 'number' ? budget : budget.resultLimit));
  const legacyTop = legacyIds.slice(0, topLimit);
  const adaptiveTop = adaptiveIds.slice(0, topLimit);
  const topIdsEqual = legacyTop.length === adaptiveTop.length
    && legacyTop.every((id, index) => id === adaptiveTop[index]);
  const adaptiveSet = new Set(adaptiveTop);
  const overlapCount = legacyTop.reduce((count, id) => count + (adaptiveSet.has(id) ? 1 : 0), 0);
  const legacyCandidateLimit = typeof budget === 'number'
    ? legacySearchCandidateLimit(topLimit)
    : budget.legacyCandidateLimit;
  const adaptiveCandidateLimit = typeof budget === 'number'
    ? adaptiveSearchCandidateLimit(topLimit)
    : budget.candidateLimit;
  return {
    legacyCandidateLimit,
    adaptiveCandidateLimit,
    legacyCount: legacyIds.length,
    adaptiveCount: adaptiveIds.length,
    topLimit,
    topIdsEqual,
    overlapCount,
  };
}

export const compareSearchCandidateBudget = compareSearchCandidateResults;
export const compareCandidateBudgetShadow = compareSearchCandidateResults;