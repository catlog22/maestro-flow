export type WikiNodeType =
  | 'project'
  | 'roadmap'
  | 'spec'
  | 'issue'
  | 'lesson'
  | 'knowhow'
  | 'note';

export type WikiStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'blocked'
  | 'archived';

export type WikiScope = 'project' | 'global' | 'team' | 'personal';

export interface WikiSource {
  kind: 'file' | 'virtual';
  /** Forward-slash relative path from .workflow/ root. */
  path: string;
  /** 1-based line number for virtual JSONL rows. */
  line?: number;
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

  // ── Enrichment fields ────────────────────────────────────────────────
  /** Spec scope: project (default), global, team, personal. Null for non-spec types. */
  scope: WikiScope | null;
  /** Content category: arch|coding|debug|learning|quality|execution|design|security|decision|... */
  category: string | null;
  /** Command/skill that created this entry, e.g. "manage-harvest", "memory-capture", "manual". */
  createdBy: string | null;
  /** Source anchor: session ID, harvest fragment ID, commit hash, issue ID, etc. */
  sourceRef: string | null;
  /** Parent entry ID for hierarchical relationships (child→parent). */
  parent: string | null;
}

export interface WikiIndex {
  entries: WikiEntry[];
  byId: Record<string, WikiEntry>;
  byType: Record<WikiNodeType, WikiEntry[]>;
  /** Map of target entry id -> source entry ids that link to it. */
  backlinks: Record<string, string[]>;
  generatedAt: number;
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
}

// ── Persisted index (written to .workflow/wiki-index.json) ────────────

/** Lightweight entry for the persisted index (no body/raw/ext). */
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
  createdBy: string | null;
  sourceRef: string | null;
  parent: string | null;
  related: string[];
  source: WikiSource;
}

export interface PersistedWikiIndex {
  version: 2;
  generatedAt: number;
  entries: PersistedEntry[];
  graph?: {
    forwardLinks: Record<string, string[]>;
    backlinks: Record<string, string[]>;
  };
}
