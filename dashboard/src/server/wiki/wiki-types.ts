export type WikiNodeType =
  | 'project'
  | 'roadmap'
  | 'spec'
  | 'issue'
  | 'knowhow'
  | 'note'
  | 'domain';

export type WikiStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'blocked'
  | 'archived'
  | 'deprecated';

export type WikiScope = 'project' | 'global' | 'team' | 'personal' | 'linked';

export interface WikiSource {
  kind: 'file' | 'virtual';
  /** Forward-slash relative path from .workflow/ root. */
  path: string;
  /** 1-based line number for virtual JSONL rows. */
  line?: number;
  /** Legacy linked alias. Undefined for local entries. */
  workspace?: string;
  /** Canonical physical repository origin. Null denotes a legacy repository without identity. */
  repoId?: string | null;
  repoName?: string;
  /** `current` for the host repository, otherwise the configured linked alias. */
  alias?: string;
  /** Stable read fence. Identity-backed repositories use `repo:<repoId>`. */
  workspaceFence?: string;
}

export interface WikiEntry {
  /** Inferred: `<type>-<slug>`. Stable across rebuilds. */
  id: string;
  type: WikiNodeType;
  title: string;
  summary: string;
  tags: string[];
  status: WikiStatus;
  /** ISO string from fs.stat.birthtimeMs (or JSONL created_at). */
  created: string;
  /** ISO string from fs.stat.mtimeMs (or JSONL updated_at). */
  updated: string;
  /** Normalized wikilink ids declared via frontmatter `related`. */
  related: string[];
  source: WikiSource;
  /** Markdown body (empty string for virtual entries). */
  body: string;
  /** Original JSONL row preserved for virtual entries. */
  raw?: unknown;
  /**
   * Preserves non-standard frontmatter fields so existing specs keep their
   * `readMode`, `priority`, `keywords` etc. intact.
   */
  ext: Record<string, unknown>;

  /** Canonical repository origin, duplicated from source for result serialization. */
  repoId?: string | null;
  repoName?: string;
  alias?: string;
  workspaceFence?: string;
  /** Null/undefined means historical unscoped content and preserves legacy visibility. */
  appliesToRepoIds?: string[] | null;

  // ── Enrichment fields ────────────────────────────────────────────────
  /** Spec scope: project (default), global, team, personal. Null for non-spec types. */
  scope: WikiScope | null;
  /** Content category: coding|arch|review|debug|test|learning (spec categories). Knowhow uses type-derived categories. */
  category: string | null;
  /** Spec category for cross-system alignment (coding|arch|debug|test|review|learning|ui). Allows knowhow entries to be discovered by spec-injector alongside spec entries. */
  specCategory: string | null;
  /** Command/skill that created this entry, e.g. "manage-harvest", "memory-capture", "manual". */
  createdBy: string | null;
  /** Source anchor: session ID, harvest fragment ID, commit hash, issue ID, etc. */
  sourceRef: string | null;
  /** Parent entry ID for hierarchical relationships (child→parent). */
  parent: string | null;
}

export function isWikiEntryApplicable(
  entry: Pick<WikiEntry, 'appliesToRepoIds' | 'ext'>,
  targetRepoId: string | null | undefined,
): boolean {
  const explicit = entry.appliesToRepoIds;
  const fallback = Array.isArray(entry.ext?.appliesToRepoIds)
    ? entry.ext.appliesToRepoIds.filter((value): value is string => typeof value === 'string')
    : undefined;
  const appliesToRepoIds = explicit ?? fallback;
  // Historical entries had no applicability field. They retain legacy visibility.
  if (appliesToRepoIds === undefined || appliesToRepoIds === null) return true;
  if (!targetRepoId || targetRepoId === '__legacy__') return false;
  return appliesToRepoIds.includes(targetRepoId);
}

export function matchesWikiRepository(
  entry: Pick<WikiEntry, 'repoId' | 'alias' | 'source'>,
  filters: Pick<WikiSearchFilters, 'repoId' | 'repoAlias' | 'applicableRepoId'>,
): boolean {
  if (filters.repoId && (entry.repoId ?? entry.source.repoId) !== filters.repoId) return false;
  if (filters.repoAlias && (entry.alias ?? entry.source.alias) !== filters.repoAlias) return false;
  if (filters.applicableRepoId !== undefined
    && !isWikiEntryApplicable(entry as WikiEntry, filters.applicableRepoId)) return false;
  return true;
}

export interface WikiIndex {
  entries: WikiEntry[];
  byId: Record<string, WikiEntry>;
  byType: Record<WikiNodeType, WikiEntry[]>;
  /** Map of target entry id -> source entry ids that link to it. */
  backlinks: Record<string, string[]>;
  generatedAt: number;
}

export interface WikiSearchFilters {
  /** session/scratch are virtual aliases backed by entry.category. */
  type?: WikiNodeType | 'session' | 'scratch';
  category?: string;
  tag?: string;
  keyword?: string;
  workspace?: string;
  /** Canonical physical-origin repository filter. */
  repoId?: string;
  /** Origin alias filter, including `current` and legacy linked aliases. */
  repoAlias?: string;
  /** Applicability target. `__legacy__` represents a target without persisted identity. */
  applicableRepoId?: string;
  includeDeprecated?: boolean;
}

/** Structural view of the shared root SearchCandidateBudget. */
export interface WikiSearchCandidateBudget {
  readonly resultLimit: number;
  readonly limit: number;
  readonly candidateLimit: number;
  readonly initialCandidateLimit: number;
  readonly maxCandidateLimit: number;
  readonly hardCap: number;
  readonly mode: 'legacy' | 'adaptive';
  readonly adaptive: boolean;
  readonly escalated: boolean;
  readonly escalationCount: number;
  readonly legacyCandidateLimit: number;
  readonly surface: 'search' | 'wiki' | 'mixed' | 'indexer' | 'planned' | 'kg' | 'code' | 'arch-kb';
}

/**
 * Request-scoped search diagnostics sink.  This structural contract keeps the
 * dashboard WikiIndexer independent from the root CLI package while allowing a
 * caller to collect bounded phase timings and reason-coded fallbacks.
 */
export interface WikiSearchDiagnosticsSnapshot {
  schemaVersion: string;
  requestId: string;
  durationMs: number;
  phases: Array<{ phase: string; durationMs: number; candidateCount?: number }>;
  fallbacks: Array<{ source: string; reason: string }>;
  provider?: 'daemon' | 'indexer' | 'mixed' | 'kg' | 'arch-kb' | 'none';
  cacheState?: 'hit' | 'miss' | 'stale' | 'unknown';
  embeddingUsed?: boolean;
  embeddingDocs?: number;
  resultCount?: number;
  candidateCount?: number;
  eligibleCandidateCount?: number;
  candidateBudget?: {
    mode: 'legacy' | 'adaptive';
    requestedLimit: number;
    initialCandidateLimit: number;
    candidateLimit: number;
    hardCap: number;
    escalated: boolean;
    legacyCandidateLimit: number;
  };
  truncated?: boolean;
}

export interface WikiSearchDiagnostics {
  readonly requestId?: string;
  recordPhase?(phase: string, durationMs: number, candidateCount?: number): void;
  recordFallback?(source: string, reason: string): void;
  setProvider?(provider: 'daemon' | 'indexer' | 'mixed' | 'kg' | 'arch-kb' | 'none'): void;
  setCacheState?(state: 'hit' | 'miss' | 'stale' | 'unknown'): void;
  setEmbedding?(used: boolean, docs: number): void;
  setResultCount?(count: number): void;
  setCandidateCount?(count: number): void;
  setEligibleCandidateCount?(count: number): void;
  setCandidateBudget?(budget: {
    mode: 'legacy' | 'adaptive';
    requestedLimit: number;
    initialCandidateLimit: number;
    candidateLimit: number;
    hardCap: number;
    escalated: boolean;
    legacyCandidateLimit: number;
  }): void;
  merge?(value: unknown): void;
  snapshot?(): WikiSearchDiagnosticsSnapshot;
}

export interface WikiFilters {
  type?: WikiNodeType;
  tag?: string;
  status?: WikiStatus;
  /** BM25 query string — tokenized against title + summary + tags + body. */
  q?: string;
  /** Filter by spec scope: project|global|team|personal. */
  scope?: WikiScope;
  /** Filter by content category. */
  category?: string;
  /** Filter by creating command/skill. */
  createdBy?: string;
  /** Filter for tool documents only (ext.tool === true). */
  tool?: boolean;
  /** Filter by source workspace name. */
  workspace?: string;
  repoId?: string;
  repoAlias?: string;
  applicableRepoId?: string;
}

export const recallSnapshotSchema = z.object({
  schema_version: z.literal('wiki-recall-snapshot/1.0'),
  query: z.string().min(1),
  as_of: z.string().datetime(),
  automatic: z.literal(false),
  mutation_authorized: z.literal(false),
  scoring: z.object({
    provider: z.literal('bm25'),
    embedding_weight_bp: z.literal(0),
    tie_break: z.literal('entry_id_asc'),
  }).strict(),
  candidates: z.array(z.object({
    entry_id: z.string().min(1),
    score_bp: z.number().int().nonnegative(),
    raw_bm25: z.number().finite().nonnegative(),
    source_workspace: z.string().min(1).nullable(),
    workspace_fence: z.string().min(1),
    fork_authorized: z.literal(false),
    resume_authorized: z.literal(false),
  }).strict()),
}).strict();

export type RecallSnapshot = z.infer<typeof recallSnapshotSchema>;

// ── Persisted index (written to .workflow/wiki-index.json) ────────────

/**
 * Lightweight canonical entry written by current indexers. Runtime routing and
 * display data (source descriptors, aliases, names, and fences) is deliberately
 * absent; consumers must resolve it from the live repository configuration.
 */
export interface PersistedEntry {
  id: string;
  type: WikiNodeType;
  title: string;
  summary: string;
  tags: string[];
  status: WikiStatus;
  created: string;
  updated: string;
  scope: WikiScope | null;
  category: string | null;
  specCategory: string | null;
  createdBy: string | null;
  sourceRef: string | null;
  parent: string | null;
  related: string[];
  /** Canonical physical-repository attribution. */
  repoId?: string | null;
  /** Canonical applicability; absent/null retains historical unscoped visibility. */
  appliesToRepoIds?: string[] | null;
}

/** Version 2 remains readable by lightweight consumers during migration. */
export interface LegacyPersistedEntry extends PersistedEntry {
  source: WikiSource;
  repoName?: string;
  alias?: string;
  workspaceFence?: string;
}

interface PersistedWikiGraph {
  forwardLinks: Record<string, string[]>;
  backlinks: Record<string, string[]>;
}

export type PersistedWikiIndex = {
  version: 3;
  generatedAt: number;
  entries: PersistedEntry[];
  graph?: PersistedWikiGraph;
} | {
  version: 2;
  generatedAt: number;
  entries: LegacyPersistedEntry[];
  graph?: PersistedWikiGraph;
};
import { z } from 'zod';
