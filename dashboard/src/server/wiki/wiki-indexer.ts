import { open, readFile, readdir, stat, lstat, writeFile, mkdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { toForwardSlash } from '../../shared/utils.js';
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
import { closeSync, createWriteStream, existsSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { buildGraph, type WikiGraph } from './graph-analysis.js';
import { buildInvertedIndex, searchBM25, searchBM25Planned, rerankByPhraseProximity, type InvertedIndex } from './search.js';
import { applyTimeDecay } from './time-decay.js';
import type { EmbeddingIndex } from './embedding.js';
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
} from './wiki-types.js';
import { recallSnapshotSchema, type RecallSnapshot } from './wiki-types.js';
import { resolveAllowedDirectSourcePath, resolveAllowedSourcePath } from './source-path.js';

// v6: session/3.0 + run/3.0 terminal history is projected into Wiki entries.
const SEARCH_CACHE_VERSION = 6;
const SEARCH_PARENT_CAP = 2;
const MAX_SEARCH_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_SEARCH_CACHE_ENTRIES = 1_000_000;
const PUBLICATION_LOCK_FILE = 'wiki-index-publication.lock';
const PUBLICATION_LOCK_WAIT_MS = 2_000;
const CLI_SESSION_CACHE_TTL_MS = 5 * 60_000;
const cliSessionScanCache = new Map<string, {
  fingerprint: string;
  cachedAt: number;
  entries: WikiEntry[];
}>();

export interface WikiSearchOptions {
  skipEmbedding?: boolean;
  credibilityFactors?: Map<string, number>;
  filters?: WikiSearchFilters;
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
}

export interface WikiIndexerConfig {
  workflowRoot: string;
  linkedWorkspaces?: LinkedWorkspaceConfig[];
  /**
   * filesystem: read and publish persistent caches;
   * read-only: read caches and user-level sources without publishing;
   * memory-only: hermetic project-only rebuild with no persistent cache access.
   */
  persistence?: 'filesystem' | 'read-only' | 'memory-only';
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
  private readonly persistence: 'filesystem' | 'read-only' | 'memory-only';
  private readonly evidenceRecorder: ((event: WikiEvidenceEvent) => void) | undefined;
  private readonly includeCliSessions: boolean;
  private readonly linkedWorkspaces: Array<{
    name: string;
    workflowRoot: string;
    shareTypes: Set<string>;
  }>;
  private cache: WikiIndex | null = null;
  private graphCache: WikiGraph | null = null;
  private searchCache: InvertedIndex | null = null;
  private embeddingCache: EmbeddingIndex | null = null;
  private embeddingInflight: Promise<EmbeddingIndex | null> | null = null;
  private embeddingGeneration = 0;
  private embeddingAbort: AbortController | null = null;
  private inflight: Promise<WikiIndex> | null = null;
  private rebuildGeneration = 0;
  private persistenceInflight: Promise<void> | null = null;
  private pendingPersistence: {
    index: WikiIndex;
    snapshot: Map<string, string>;
    generation: number;
  } | null = null;
  private mtimeSnapshot: Map<string, string> = new Map();
  /** Paths recorded in mtimeSnapshot, for the warm-path re-stat change check. */
  private lastSnapshotPaths: readonly string[] | null = null;
  private closing = false;

  constructor(config: WikiIndexerConfig) {
    this.workflowRoot = resolve(config.workflowRoot);
    this.persistence = config.persistence ?? 'filesystem';
    this.evidenceRecorder = config.evidenceRecorder;
    this.includeCliSessions = config.includeCliSessions ?? true;
    this.linkedWorkspaces = (config.linkedWorkspaces ?? []).map(lw => ({
      name: lw.name,
      workflowRoot: resolve(lw.workflowRoot),
      shareTypes: new Set(lw.shareTypes),
    }));
  }

  getWorkflowRoot(): string {
    return this.workflowRoot;
  }

  private recordEvidence(event: WikiEvidenceEventName, site: string): void {
    this.evidenceRecorder?.({ event, site, queryId: null });
  }

  async get(): Promise<WikiIndex> {
    if (this.cache) {
      if (!await this.hasSourceChanges()) return this.cache;
      this.invalidate();
    }
    if (this.inflight) return this.inflight;
    if (this.persistence !== 'memory-only' && await this.tryLoadSearchCache()) {
      return this.cache!;
    }
    return this.rebuild();
  }

  private async hasSourceChanges(snapshot = this.mtimeSnapshot): Promise<boolean> {
    if (snapshot.size === 0) return true;
    // Warm-path fast check: re-stat only the paths recorded in the last
    // snapshot instead of re-running the full recursive scan. Every source
    // family the indexer can read is already represented — additions and
    // removals bump the containing directory's mtime (recorded as its own
    // entry), in-place edits bump the file's own mtime, and the WAL entry
    // tracks WAL-mode graph commits. readdirSync is disproportionately
    // expensive on some Windows setups (~1.5ms per call), which made the
    // full scan dominate warm query latency.
    const recordedPaths = this.lastSnapshotPaths;
    if (recordedPaths === null) {
      return !snapshotsEqual(snapshot, await this.captureSourceSnapshot());
    }
    for (const path of recordedPaths) {
      const previous = snapshot.get(path);
      if (previous === undefined) return true;
      if (previous === 'm') {
        try {
          lstatSync(path);
          return true;
        } catch {
          continue;
        }
      }
      let current: ReturnType<typeof statSync>;
      try {
        current = statSync(path);
      } catch {
        return true;
      }
      if ([current.isDirectory() ? 'd' : 'f', current.size, current.mtimeMs, current.ctimeMs]
        .join(':') !== previous) {
        return true;
      }
    }
    return false;
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
      const realPath = resolveAllowedSourcePath(candidate, allowedRoot, kind);
      if (!realPath) {
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
      try {
        record(realPath, statSync(realPath));
        return realPath;
      } catch {
        return null;
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
        const child = resolveAllowedDirectSourcePath(join(realDir, name), realDir, 'any');
        if (!child) continue;
        let childStat: NonNullable<ReturnType<typeof statSync>> | null = null;
        try { childStat = statSync(child); } catch { continue; }
        if (childStat.isDirectory()) {
          record(child, childStat);
          if (recurse && !skipDir?.(name)) {
            scan(
              child,
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
        } else if (childStat.isFile() && accept(name, child)) {
          record(child, childStat);
          if (budget && --budget.remaining === 0) return;
        }
      }
    };

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
    add(join(this.workflowRoot, 'kg', 'maestro.db-wal'), this.workflowRoot);
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
        add(join(lw.workflowRoot, 'kg', 'maestro.db-wal'), lw.workflowRoot);
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
      const persistedIndex = JSON.parse(indexRaw);
      if (!persistedIndex || typeof persistedIndex !== 'object' || Array.isArray(persistedIndex)) return false;
      const persistedRecord = persistedIndex;
      // Both files are one logical publication. Refuse a torn/stale companion
      // so the filesystem owner rebuilds and repairs the pair before ready.
      if (persistedRecord.version !== 3
        || persistedRecord.generatedAt !== cached.generatedAt
        || !Array.isArray(persistedRecord.entries)) return false;

      const snapshot = new Map<string, string>(cached.mtimeSnapshot);
      if (sourceFingerprint(snapshot) !== cached.sourceFingerprint
        || await this.hasSourceChanges(snapshot)
        || generation !== this.rebuildGeneration) return false;

      const entries = cached.entries;
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
      this.mtimeSnapshot = snapshot;
      this.lastSnapshotPaths = [...snapshot.keys()];
      this.cache = { entries, byId, byType, backlinks, generatedAt: cached.generatedAt };
      return true;
    } catch {
      return false;
    }
  }

  private async prepareSearchCache(
    index: WikiIndex,
    snapshot: ReadonlyMap<string, string>,
  ): Promise<string> {
    const target = join(this.workflowRoot, 'search-cache.json');
    const tmpTarget = `${target}.tmp-${process.pid}-${randomUUID()}`;
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
      await writeChunk(`{"version":${SEARCH_CACHE_VERSION},"generatedAt":${index.generatedAt}`);
      await writeChunk(`,"sourceFingerprint":${JSON.stringify(sourceFingerprint(snapshot))}`);
      await writeChunk(',"mtimeSnapshot":');
      await writeChunk(JSON.stringify([...snapshot.entries()]));
      await writeChunk(',"entries":[');
      for (let i = 0; i < index.entries.length; i++) {
        if (i > 0) await writeChunk(',');
        const entry = index.entries[i];
        await writeChunk(JSON.stringify({
          id: entry.id, type: entry.type, title: entry.title, summary: entry.summary,
          tags: entry.tags, status: entry.status, created: entry.created, updated: entry.updated,
          related: entry.related, source: entry.source, body: entry.body, ext: entry.ext,
          scope: entry.scope, category: entry.category, specCategory: entry.specCategory,
          createdBy: entry.createdBy, sourceRef: entry.sourceRef, parent: entry.parent,
        }));
      }
      stream.end(']}');
      await finished(stream);
      stream = null;
      return tmpTarget;
    } catch (error) {
      stream?.destroy();
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
      const entries = [...fileEntries, ...virtualEntries, ...linkedEntries];

      // Sort entries by id first, then by source priority (file > virtual >
      // linked) for deterministic collision suffixing — the same logical entry
      // always gets the same suffixed id regardless of scan order.
      const sourcePriority = (e: WikiEntry): number =>
        e.source.workspace ? 2 : e.source.kind === 'virtual' ? 1 : 0;
      entries.sort((a, b) => a.id.localeCompare(b.id) || sourcePriority(a) - sourcePriority(b));

      const entriesByOriginalId = new Map<string, WikiEntry[]>();
      for (const entry of entries) {
        const group = entriesByOriginalId.get(entry.id) ?? [];
        group.push(entry);
        entriesByOriginalId.set(entry.id, group);
      }
      const seen = new Map<string, number>();
      const debugCollisions = process.env.MAESTRO_DEBUG === '1';
      let collisionCount = 0;
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
      const resolveCollisionRef = (owner: WikiEntry, target: string): string => {
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

      // Session lifecycle promotion refs are projected by the virtual adapter.
      // Reconcile both directions only after collision references have settled,
      // so the promoted target and source session use final deterministic IDs.
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
      for (const sessionEntry of entries) {
        if (sessionEntry.ext?.virtualKind !== 'session') continue;
        const sessionId = sessionEntry.ext.sessionId;
        const promotedRefs = sessionEntry.ext.promotedRefs;
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
        generatedAt: Date.now(),
      };
      return index;
  }

  private async rebuildUntilCurrent(): Promise<WikiIndex> {
    for (;;) {
      if (this.closing) throw new Error('wiki indexer is closing');
      const generation = this.rebuildGeneration;
      const before = await this.captureSourceSnapshot();
      const index = await this.buildIndexCandidate();
      const snapshot = await this.captureSourceSnapshot();
      if (this.closing) throw new Error('wiki indexer is closing');
      if (generation !== this.rebuildGeneration || !snapshotsEqual(before, snapshot)) continue;

      this.mtimeSnapshot = snapshot;
      this.lastSnapshotPaths = [...snapshot.keys()];
      this.cache = index;
      this.graphCache = null;
      this.searchCache = null;
      if (this.persistence === 'filesystem') {
        this.schedulePersistence(index, snapshot, generation);
      }
      return index;
    }
  }

  private schedulePersistence(
    index: WikiIndex,
    snapshot: Map<string, string>,
    generation: number,
  ): void {
    if (this.closing) return;
    // Keep at most one writer and one coalesced latest candidate. Slow disk I/O
    // never blocks readers or permits an older generation to publish afterward.
    this.pendingPersistence = { index, snapshot, generation };
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
      let publicationLock: PublicationLock | null = null;
      try {
        [indexTemp, cacheTemp] = await Promise.all([
          this.prepareIndex(pending.index),
          this.prepareSearchCache(pending.index, pending.snapshot),
        ]);
        publicationLock = await acquirePublicationLock(this.workflowRoot);
        if (!publicationLock || pending.generation !== this.rebuildGeneration || this.closing) continue;

        const currentSnapshot = await this.captureSourceSnapshot();
        if (!snapshotsEqual(currentSnapshot, pending.snapshot)) {
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
      } catch (error) {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.warn('[wiki-indexer] protected publication failed:', (error as Error)?.message);
        }
      } finally {
        releasePublicationLock(this.workflowRoot, publicationLock);
        if (indexTemp) await rm(indexTemp, { force: true }).catch(() => undefined);
        if (cacheTemp) await rm(cacheTemp, { force: true }).catch(() => undefined);
      }
    }
  }

  invalidate(_changedAbsPath?: string): void {
    this.rebuildGeneration++;
    this.cache = null;
    this.graphCache = null;
    this.searchCache = null;
    this.embeddingCache = null;
    this.embeddingGeneration++;
    this.embeddingAbort?.abort();
  }

  /** Abort and join background index work before a daemon releases ownership. */
  async close(): Promise<void> {
    if (this.closing) {
      await Promise.allSettled([
        this.embeddingInflight ?? Promise.resolve(null),
        this.persistenceInflight ?? Promise.resolve(),
      ]);
      return;
    }
    this.closing = true;
    this.pendingPersistence = null;
    this.embeddingGeneration++;
    this.embeddingAbort?.abort();
    await Promise.allSettled([
      this.embeddingInflight ?? Promise.resolve(null),
      this.persistenceInflight ?? Promise.resolve(),
    ]);
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
        workspace_fence: entry.source.workspace ? `linked:${entry.source.workspace}` : 'local',
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
  }> {
    const index = await this.get();

    // Parallel: BM25 index build + embedding index load
    const [bm25, embIdx] = await Promise.all([
      this.getSearchIndex(),
      options?.skipEmbedding || this.persistence !== 'filesystem'
        ? null
        : this.getEmbeddingIndex(),
    ]);
    const internalLimit = Math.min(500, Math.max(limit * 3, 60));
    const allowedDocIds = options?.filters
      ? new Set(index.entries
          .filter(entry => matchesSearchFilters(entry, options.filters!))
          .map(entry => entry.id))
      : undefined;
    const bm25Results = searchBM25Planned(
      bm25,
      query,
      internalLimit,
      options?.credibilityFactors,
      allowedDocIds,
    );

    if (embIdx && embIdx.docIds.length > 0) {
      try {
        const { embedQuery, vectorSearch, vectorSearchZvec, mergeHybrid } = await import('./embedding.js');
        const qVec = await embedQuery(query);
        let rawVecResults = allowedDocIds
          ? vectorSearch(qVec, embIdx, internalLimit, allowedDocIds)
          : await vectorSearchZvec(qVec, this.workflowRoot, internalLimit);
        if (rawVecResults.length === 0 && !allowedDocIds) {
          rawVecResults = vectorSearch(qVec, embIdx, internalLimit);
        }

        // Deduplicate chunk results back to parent docId (keep highest score per doc)
        let vecResults = rawVecResults;
        if (embIdx.chunkDocIds) {
          const chunkToParent = new Map<string, string>();
          for (let i = 0; i < embIdx.docIds.length; i++) {
            chunkToParent.set(embIdx.docIds[i], embIdx.chunkDocIds[i]);
          }
          const bestPerDoc = new Map<string, { docId: string; score: number }>();
          for (const r of rawVecResults) {
            const parentId = chunkToParent.get(r.docId) ?? r.docId;
            const existing = bestPerDoc.get(parentId);
            if (!existing || r.score > existing.score) {
              bestPerDoc.set(parentId, { docId: parentId, score: r.score });
            }
          }
          vecResults = Array.from(bestPerDoc.values());
        }

        const merged = mergeHybrid(bm25Results, vecResults, internalLimit);
        return {
          results: finalizeSearchResults(
            index,
            merged,
            query,
            limit,
            options?.filters?.includeDeprecated === true,
          ),
          embeddingUsed: true,
          embeddingDocs: embIdx.docIds.length,
        };
      } catch (e: unknown) {
        if (process.env.MAESTRO_DEBUG === '1') {
          console.error(`[embedding] query failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    return {
      results: finalizeSearchResults(
        index,
        bm25Results,
        query,
        limit,
        options?.filters?.includeDeprecated === true,
      ),
      embeddingUsed: false,
      embeddingDocs: 0,
    };
  }

  async getEmbeddingIndex(): Promise<EmbeddingIndex | null> {
    if (this.persistence !== 'filesystem' || this.closing) return null;
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
      const cached = loadEmbeddingIndex(this.workflowRoot);
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
        docs.push(vk === 'kg-node' || vk === 'kg-layer' || vk === 'kg-tour-step'
          ? this.enrichKgDocForEmbedding(e, index)
          : { id: e.id, title: e.title, summary: e.summary, tags: e.tags, body: e.body });
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
              status: 'active',
              created: container.created,
              updated: container.updated,
              related,
              source: container.source,
              body: se.content,
              ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}), ...(se.confidence ? { confidence: se.confidence } : {}), ...(se.conflictNote ? { conflictNote: se.conflictNote } : {}), ...(se.status ? { status: se.status } : {}), ...(se.supersededBy ? { supersededBy: se.supersededBy } : {}), ...(se.sid ? { sid: se.sid } : {}), ...(se.supersedes ? { supersedes: se.supersedes } : {}) },
              scope,
              category: se.category || container.category,
              specCategory: container.specCategory,
              createdBy: container.createdBy,
              sourceRef: container.sourceRef,
              parent: container.id,
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
            status: 'active' as const,
            created: entry.created,
            updated: entry.updated,
            related,
            source: entry.source,
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.ref ? { ref: se.ref } : {}) },
            scope: null,
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: entry.sourceRef,
            parent: entry.id,
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
    const maxAgeDays = 90;
    const maxFiles = 100;

    // Parallel: Claude Code + Codex session loading. Reuse the bounded scan in
    // process while its store-level fingerprint is stable; many short-lived
    // WikiIndexer instances otherwise repeat the same user-history walk.
    const projectSlug = cwdToClaudeProjectSlug(projectCwd);
    const claudeProjectDir = join(home, '.claude', 'projects', projectSlug);
    const codexRoot = join(home, '.codex');
    const fingerprint = cliSessionStoreFingerprint(claudeProjectDir, codexRoot);
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
            status: 'active',
            created: entry.created,
            updated: entry.updated,
            related: [],
            source: { kind: 'file', path: `specs/${name}`, workspace: lw.name },
            body: se.content,
            ext: { entryType: se.type, timestamp: se.timestamp, ...(se.confidence ? { confidence: se.confidence } : {}), ...(se.conflictNote ? { conflictNote: se.conflictNote } : {}), ...(se.status ? { status: se.status } : {}), ...(se.supersededBy ? { supersededBy: se.supersededBy } : {}), ...(se.sid ? { sid: se.sid } : {}), ...(se.supersedes ? { supersedes: se.supersedes } : {}) },
            scope: 'linked',
            category: se.category || entry.category,
            specCategory: entry.specCategory,
            createdBy: entry.createdBy,
            sourceRef: entry.sourceRef,
            parent: entry.id,
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
            workspaceFence: `linked:${lw.name}`,
            sharedVia: 'explicit-session-share',
            forkAuthorized: false,
            resumeAuthorized: false,
          };
          entry.scope = 'linked';
        }
        out.push(...entries);
      }
    }

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

    const title = asString(data.title) || firstHeading(content) || stem;
    const summary = asString(data.description) || asString(data.summary) || firstParagraph(content);
    const tags = extractTags(data);
    const status = asStatus(data.status) ?? inferStatus(type);
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);
    // Surface deprecated into ext.status — the CLI search deprecated-filter
    // reads ext.status (like spec sub-entries), not the top-level field.
    if (status === 'deprecated') ext.status = 'deprecated';

    const category = asString(data.category) || null;
    const specCategory = asString(data.specCategory) || null;
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = asString(data.sourceRef) || null;
    const parent = asString(data.parent) || null;

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

    const title = asString(data.title) || firstHeading(content) || stem;
    const summary = asString(data.description) || asString(data.summary) || firstParagraph(content);
    const tags = extractTags(data);
    const status = asStatus(data.status) ?? inferStatus(type);
    const related = normalizeRelated(data.related);
    const ext = extractExt(data);
    // Surface deprecated into ext.status — the CLI search deprecated-filter
    // reads ext.status (like spec sub-entries), not the top-level field.
    if (status === 'deprecated') ext.status = 'deprecated';

    // Enrichment fields from frontmatter
    const category = asString(data.category) || null;
    const specCategory = asString(data.specCategory) || null;
    const createdBy = asString(data.createdBy) || null;
    const sourceRef = asString(data.sourceRef) || null;
    const parent = asString(data.parent) || null;

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
    };
  }

  private buildBacklinks(
    entries: WikiEntry[],
    byId: Record<string, WikiEntry>,
  ): Record<string, string[]> {
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
      if (d.body) {
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
      version: 2,
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
          source: e.source,
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

function cliSessionStoreFingerprint(claudeProjectDir: string, codexRoot: string): string {
  return [
    claudeProjectDir,
    join(codexRoot, 'sessions'),
    join(codexRoot, 'session_index.jsonl'),
  ].map(path => {
    try {
      const info = statSync(path);
      return `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    } catch {
      return `${path}:missing`;
    }
  }).join('|');
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
    || (source.workspace !== undefined && typeof source.workspace !== 'string')) return false;
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
  mtimeSnapshot: Array<[string, string]>;
  entries: WikiEntry[];
}

function validateSearchCache(value: unknown): ValidatedSearchCache | null {
  if (!isRecord(value)
    || value.version !== SEARCH_CACHE_VERSION
    || !Number.isFinite(value.generatedAt)
    || typeof value.sourceFingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.sourceFingerprint)
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
  return {
    version: SEARCH_CACHE_VERSION,
    generatedAt: value.generatedAt as number,
    sourceFingerprint: value.sourceFingerprint,
    mtimeSnapshot: snapshot,
    entries,
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
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!d.title.toLowerCase().includes(q) && !d.summary.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}
