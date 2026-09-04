import type { EmbeddingIndex } from './embedding.js';
import {
  buildInvertedIndex,
  type InvertedIndex,
} from './search.js';
import type { WikiEntry, WikiIndex, WikiNodeType } from './wiki-types.js';
import {
  diffSourceManifests,
  isCoveredSourceKind,
  normalizeManifestPath,
  sourceManifestsContentEqual,
  type SourceChange,
  type SourceManifest,
  type SourceManifestEntry,
} from './source-manifest.js';

/** A half-open vector-slot range belonging to one document. */
export interface EmbeddingRange {
  docId: string;
  start: number;
  end: number;
}

export interface IncrementalEmbeddingUpdate {
  /** Existing vectors retained for unchanged documents; missing docs are rebuilt later. */
  index: EmbeddingIndex | null;
  ranges: Map<string, EmbeddingRange>;
  retainedDocIds: string[];
  invalidatedDocIds: string[];
}

export interface IncrementalIndexState {
  index: WikiIndex;
  /** BM25 state corresponding exactly to `index.entries`. */
  searchIndex: InvertedIndex | null;
  /** Optional embedding seed/ranges from the previous generation. */
  embedding?: EmbeddingIndex | null;
  embeddingRanges?: Map<string, EmbeddingRange>;
  manifest: SourceManifest;
  generation: number;
}

export interface IncrementalIndexUpdateOptions {
  previous: IncrementalIndexState;
  currentManifest: SourceManifest;
  changes?: readonly SourceChange[];
  /** Parse one changed covered source. Never mutate `previous` entries. */
  loadSource: (
    source: SourceManifestEntry,
    change: SourceChange,
    signal?: AbortSignal,
  ) => Promise<readonly WikiEntry[]>;
  /**
   * Optional kind-wide reload hook for projections whose output is globally
   * deduplicated (issues are currently the only such source).
   */
  loadSourcesForKind?: (
    sourceKind: SourceManifestEntry['sourceKind'],
    sources: readonly SourceManifestEntry[],
    signal?: AbortSignal,
  ) => Promise<readonly WikiEntry[]>;
  /** Optional generation timestamp; defaults to a fresh millisecond timestamp. */
  generation?: number;
  signal?: AbortSignal;
}

export interface IncrementalIndexUpdated {
  status: 'updated';
  state: IncrementalIndexState;
  changes: SourceChange[];
  changedEntryIds: string[];
  embedding: IncrementalEmbeddingUpdate;
}

export interface IncrementalIndexFallback {
  status: 'fallback';
  reason: string;
  changes: SourceChange[];
}

export type IncrementalIndexResult = IncrementalIndexUpdated | IncrementalIndexFallback;

const WIKI_TYPES: readonly WikiNodeType[] = [
  'project', 'roadmap', 'spec', 'issue', 'knowhow', 'note', 'domain',
];

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('incremental index aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function cloneEntry(entry: WikiEntry): WikiEntry {
  // Wiki entries are JSON-shaped by contract, but `raw` may contain arbitrary
  // adapter data. structuredClone keeps this operation detached from the
  // previous published generation while preserving those values.
  try {
    return structuredClone(entry) as WikiEntry;
  } catch {
    return {
      ...entry,
      tags: [...entry.tags],
      related: [...entry.related],
      source: { ...entry.source },
      ext: { ...entry.ext },
      ...(entry.appliesToRepoIds ? { appliesToRepoIds: [...entry.appliesToRepoIds] } : {}),
    };
  }
}

function sourcePriority(entry: WikiEntry): number {
  return entry.source.workspace ? 2 : entry.source.kind === 'virtual' ? 1 : 0;
}

function sourcePath(entry: WikiEntry): string {
  return normalizeManifestPath(entry.source.path);
}

function isNonCoveredEntry(entry: WikiEntry): boolean {
  if (entry.source.workspace) return true;
  const virtualKind = typeof entry.ext?.virtualKind === 'string' ? entry.ext.virtualKind : '';
  return virtualKind === 'session'
    || virtualKind === 'session-run'
    || virtualKind === 'claude-session'
    || virtualKind === 'codex-session'
    || virtualKind === 'kg-node'
    || virtualKind === 'kg-layer'
    || virtualKind === 'kg-tour-step';
}

function resolveLink(target: string, byId: Record<string, WikiEntry>, titleIndex: Map<string, string>): string | null {
  if (byId[target]) return target;
  return titleIndex.get(target.toLowerCase()) ?? null;
}

function deterministicBacklinks(
  entries: readonly WikiEntry[],
  byId: Record<string, WikiEntry>,
): Record<string, string[]> {
  if (!entries.some(entry => entry.related.length > 0 || entry.body.includes('[['))) return {};
  const titleIndex = new Map<string, string>();
  for (const entry of entries) {
    // Match WikiIndexer.buildBacklinks: stable-sorted entries make the last
    // duplicate title the deterministic winner.
    titleIndex.set(entry.title.toLowerCase(), entry.id);
  }
  const sets = new Map<string, Set<string>>();
  const add = (target: string, source: string): void => {
    const resolved = resolveLink(target, byId, titleIndex);
    if (!resolved) return;
    const set = sets.get(resolved) ?? new Set<string>();
    set.add(source);
    sets.set(resolved, set);
  };
  for (const entry of entries) {
    for (const related of entry.related) add(related, entry.id);
    if (entry.body.includes('[[')) {
      const links = /\[\[([^\]]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = links.exec(entry.body))) add(match[1], entry.id);
    }
  }
  const result: Record<string, string[]> = {};
  for (const [target, sources] of [...sets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    result[target] = [...sources].sort((a, b) => a.localeCompare(b));
  }
  return result;
}

function coalesceGloballyDeduplicatedEntries(entries: WikiEntry[]): WikiEntry[] {
  const issueById = new Map<string, WikiEntry>();
  const other: WikiEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== 'issue') {
      other.push(entry);
      continue;
    }
    const existing = issueById.get(entry.id);
    if (!existing
      || entry.updated > existing.updated
      || (entry.updated === existing.updated && sourcePath(entry).localeCompare(sourcePath(existing)) < 0)) {
      issueById.set(entry.id, entry);
    }
  }
  return [...other, ...issueById.values()];
}

function resolveCollisions(entries: WikiEntry[]): void {
  entries.sort((left, right) => left.id.localeCompare(right.id) || sourcePriority(left) - sourcePriority(right)
    || sourcePath(left).localeCompare(sourcePath(right)));
  const byOriginal = new Map<string, WikiEntry[]>();
  for (const entry of entries) {
    const group = byOriginal.get(entry.id) ?? [];
    group.push(entry);
    byOriginal.set(entry.id, group);
  }
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const original = entry.id;
    const occurrence = seen.get(original) ?? 0;
    if (occurrence > 0) entry.id = `${original}-${occurrence + 1}`;
    seen.set(original, occurrence + 1);
  }

  const resolve = (owner: WikiEntry, target: string): string => {
    const candidates = byOriginal.get(target);
    if (!candidates || candidates.length === 0) return target;
    if (candidates.length === 1) return candidates[0].id;
    const sameWorkspace = candidates.filter(candidate => candidate.source.workspace === owner.source.workspace);
    const sameSource = sameWorkspace.find(candidate => sourcePath(candidate) === sourcePath(owner));
    return sameSource?.id ?? sameWorkspace[0]?.id ?? candidates[0].id;
  };
  for (const entry of entries) {
    entry.related = entry.related.map(target => resolve(entry, target));
    if (entry.parent) entry.parent = resolve(entry, entry.parent);
    const edges = entry.ext?.kgEdges;
    if (Array.isArray(edges)) {
      entry.ext.kgEdges = edges.map(edge => {
        if (!edge || typeof edge !== 'object') return edge;
        const typed = edge as Record<string, unknown>;
        return typeof typed.target === 'string'
          ? { ...typed, target: resolve(entry, typed.target) }
          : { ...typed };
      });
    }
  }
}

/**
 * Build maps, collision IDs, backlinks, and deterministic ordering from a
 * detached entry list. This is intentionally shared by full and incremental
 * callers so an incremental publication has exactly the same derived shape.
 */
export function buildDeterministicWikiIndex(
  input: readonly WikiEntry[],
  generatedAt = Date.now(),
  signal?: AbortSignal,
): WikiIndex {
  throwIfAborted(signal);
  const entries = coalesceGloballyDeduplicatedEntries(input.map(cloneEntry));
  resolveCollisions(entries);
  throwIfAborted(signal);

  const byId = Object.create(null) as Record<string, WikiEntry>;
  const byType = {
    project: [], roadmap: [], spec: [], issue: [], knowhow: [], note: [], domain: [],
  } as Record<WikiNodeType, WikiEntry[]>;
  for (const entry of entries) {
    throwIfAborted(signal);
    byId[entry.id] = entry;
    // Invalid parser output should never become a partially published index.
    if (!byType[entry.type]) throw new Error(`unsupported wiki entry type: ${entry.type}`);
    byType[entry.type].push(entry);
  }
  const backlinks = deterministicBacklinks(entries, byId);
  return { entries, byId, byType, backlinks, generatedAt };
}

function manifestWithPreviousIds(current: SourceManifest, previous: SourceManifest): SourceManifest {
  const oldByPath = new Map(previous.entries.map(entry => [entry.path, entry.entryIds]));
  const entries = current.entries.map(entry => ({
    ...entry,
    entryIds: [...(entry.entryIds.length > 0 ? entry.entryIds : (oldByPath.get(entry.path) ?? []))]
      .sort((a, b) => a.localeCompare(b)),
  }));
  return { ...current, entries };
}

function changedPaths(changes: readonly SourceChange[]): Set<string> {
  const paths = new Set<string>();
  for (const change of changes) {
    paths.add(normalizeManifestPath(change.path));
    if (change.previousPath) paths.add(normalizeManifestPath(change.previousPath));
  }
  return paths;
}

function collectChangedEntryIds(
  previous: IncrementalIndexState,
  changes: readonly SourceChange[],
  nextEntries: readonly WikiEntry[],
): string[] {
  const ids = new Set<string>();
  for (const change of changes) {
    for (const id of change.previous?.entryIds ?? []) ids.add(id);
    for (const id of change.current?.entryIds ?? []) ids.add(id);
  }
  const paths = changedPaths(changes);
  for (const entry of previous.index.entries) {
    const projectedPath = typeof entry.ext?.docIndexPath === 'string'
      ? normalizeManifestPath(entry.ext.docIndexPath)
      : '';
    if (paths.has(sourcePath(entry)) || (projectedPath && paths.has(projectedPath))) ids.add(entry.id);
  }
  for (const entry of nextEntries) {
    const projectedPath = typeof entry.ext?.docIndexPath === 'string'
      ? normalizeManifestPath(entry.ext.docIndexPath)
      : '';
    if (paths.has(sourcePath(entry)) || (projectedPath && paths.has(projectedPath))) ids.add(entry.id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function validPreviousState(state: IncrementalIndexState): boolean {
  if (state.generation !== state.index.generatedAt
    || (state.manifest.generation !== 0 && state.manifest.generation !== state.index.generatedAt)) return false;
  const ids = new Set<string>();
  for (const entry of state.index.entries) {
    if (!entry || !entry.id || ids.has(entry.id)) return false;
    ids.add(entry.id);
    if (state.index.byId[entry.id] !== entry) return false;
  }
  for (const type of WIKI_TYPES) {
    const grouped = state.index.byType[type];
    if (!Array.isArray(grouped)) return false;
    for (const entry of grouped) if (!ids.has(entry.id)) return false;
  }
  if (state.searchIndex && state.searchIndex.totalDocs !== state.index.entries.length) return false;
  return true;
}

function parentDocId(embedding: EmbeddingIndex, slot: number): string {
  return embedding.chunkDocIds?.[slot] ?? embedding.docIds[slot];
}

/**
 * Retain unchanged embedding vectors and expose stable parent-document ranges.
 * The regular embedding builder can use this filtered index as a seed and
 * re-embed only missing/changed documents.
 */
export function updateEmbeddingRanges(
  previous: EmbeddingIndex | null | undefined,
  nextEntries: readonly WikiEntry[],
  changedEntryIds: ReadonlySet<string> = new Set(),
): IncrementalEmbeddingUpdate {
  if (!previous) {
    return { index: null, ranges: new Map(), retainedDocIds: [], invalidatedDocIds: [...changedEntryIds].sort() };
  }
  const nextIds = new Set(nextEntries.map(entry => entry.id));
  const grouped = new Map<string, Array<{ id: string; vector: Float32Array; hash?: string }>>();
  for (let slot = 0; slot < previous.docIds.length; slot++) {
    const parent = parentDocId(previous, slot);
    if (!nextIds.has(parent) || changedEntryIds.has(parent)) continue;
    const group = grouped.get(parent) ?? [];
    group.push({ id: previous.docIds[slot], vector: previous.vectors[slot], hash: previous.contentHashes?.[slot] });
    grouped.set(parent, group);
  }
  const docOrder = nextEntries.map(entry => entry.id).filter(id => grouped.has(id));
  const docIds: string[] = [];
  const vectors: Float32Array[] = [];
  const contentHashes: string[] = [];
  const chunkDocIds: string[] = [];
  const ranges = new Map<string, EmbeddingRange>();
  for (const parent of docOrder) {
    const start = docIds.length;
    for (const slot of grouped.get(parent) ?? []) {
      docIds.push(slot.id);
      vectors.push(slot.vector);
      chunkDocIds.push(parent);
      contentHashes.push(slot.hash ?? '');
    }
    ranges.set(parent, { docId: parent, start, end: docIds.length });
  }
  const invalidatedDocIds = nextEntries.map(entry => entry.id)
    .filter(id => !ranges.has(id) || changedEntryIds.has(id))
    .sort((a, b) => a.localeCompare(b));
  const retainedDocIds = [...ranges.keys()].sort((a, b) => a.localeCompare(b));
  const index = docIds.length === 0
    ? null
    : {
      ...previous,
      docIds,
      vectors,
      chunkDocIds,
      contentHashes,
      builtAt: previous.builtAt,
    };
  return { index, ranges, retainedDocIds, invalidatedDocIds };
}

/**
 * Apply a manifest delta without mutating the currently published state.
 * Unsupported source changes deliberately return `fallback`; callers should
 * invoke the existing full WikiIndexer rebuild in that case.
 */
export async function applyIncrementalIndex(
  options: IncrementalIndexUpdateOptions,
): Promise<IncrementalIndexResult> {
  const { previous, currentManifest, signal } = options;
  throwIfAborted(signal);
  const changes = [...(options.changes ?? diffSourceManifests(previous.manifest, currentManifest))];
  if (!validPreviousState(previous)) {
    return { status: 'fallback', reason: 'previous index state is invalid', changes };
  }
  if (previous.manifest.root !== currentManifest.root) {
    return { status: 'fallback', reason: 'source root changed', changes };
  }
  if (changes.some(change => !isCoveredSourceKind(change.sourceKind))) {
    return { status: 'fallback', reason: 'non-covered source changed', changes };
  }
  // Session/KG/linked/transcript projections have cross-source promotion and
  // collision semantics that cannot be safely patched from file IDs alone.
  if (changes.length > 0 && previous.index.entries.some(isNonCoveredEntry)) {
    return { status: 'fallback', reason: 'index contains non-covered projections', changes };
  }

  const nextManifest = {
    ...manifestWithPreviousIds(currentManifest, previous.manifest),
    generation: previous.index.generatedAt,
  };
  if (changes.length === 0 || sourceManifestsContentEqual(previous.manifest, currentManifest)) {
    const embedding = updateEmbeddingRanges(previous.embedding, previous.index.entries, new Set());
    return {
      status: 'updated',
      state: {
        ...previous,
        manifest: nextManifest,
        embedding: embedding.index,
        embeddingRanges: embedding.ranges,
      },
      changes,
      changedEntryIds: [],
      embedding,
    };
  }

  const paths = changedPaths(changes);
  const reloadKinds = new Set<SourceManifestEntry['sourceKind']>();
  if (options.loadSourcesForKind) {
    for (const change of changes) {
      if (change.sourceKind === 'issue') reloadKinds.add(change.sourceKind);
    }
  }
  // Some virtual projections (notably codebase doc-index) expose a generated
  // display path instead of their physical source path. Persisted entry IDs
  // are therefore a second, authoritative removal key.
  const removedIds = new Set<string>();
  for (const change of changes) {
    for (const id of change.previous?.entryIds ?? []) removedIds.add(id);
  }
  const retained = previous.index.entries
    .filter(entry => !paths.has(sourcePath(entry))
      && !removedIds.has(entry.id)
      && !(reloadKinds.has('issue') && entry.type === 'issue'))
    .map(cloneEntry);
  const loaded: WikiEntry[] = [];
  const changed = changes.slice().sort((left, right) => left.path.localeCompare(right.path));
  const loadedKinds = new Set<SourceManifestEntry['sourceKind']>();
  for (const change of changed) {
    throwIfAborted(signal);
    if (reloadKinds.has(change.sourceKind)) {
      if (loadedKinds.has(change.sourceKind)) continue;
      loadedKinds.add(change.sourceKind);
      const sources = currentManifest.entries.filter(entry => entry.sourceKind === change.sourceKind);
      const parsed = await options.loadSourcesForKind!(change.sourceKind, sources, signal);
      throwIfAborted(signal);
      for (const entry of parsed) loaded.push(cloneEntry(entry));
      continue;
    }
    if (change.kind === 'delete') continue;
    const source = change.current;
    if (!source) return { status: 'fallback', reason: 'change has no current source', changes };
    const parsed = await options.loadSource(source, change, signal);
    throwIfAborted(signal);
    for (const entry of parsed) loaded.push(cloneEntry(entry));
  }

  // A parser is allowed to return an empty list for malformed/filtered files;
  // that is still a valid replacement and mirrors the full scanner behavior.
  const nextGeneration = options.generation ?? Math.max(Date.now(), previous.index.generatedAt + 1);
  const nextIndex = buildDeterministicWikiIndex(
    [...retained, ...loaded],
    nextGeneration,
    signal,
  );
  const searchIndex = previous.searchIndex
    && nextIndex.entries.length === previous.index.entries.length
    && nextIndex.entries.every((entry, index) => {
      const previousEntry = previous.index.entries[index];
      return entry.id === previousEntry.id
        && entry.title === previousEntry.title
        && entry.summary === previousEntry.summary
        && entry.body === previousEntry.body
        && entry.category === previousEntry.category
        && entry.tags.length === previousEntry.tags.length
        && entry.tags.every((tag, tagIndex) => tag === previousEntry.tags[tagIndex]);
    })
    ? previous.searchIndex
    : buildInvertedIndex(nextIndex.entries);
  const changedEntryIds = collectChangedEntryIds(previous, changes, nextIndex.entries);
  const embedding = updateEmbeddingRanges(previous.embedding, nextIndex.entries, new Set(changedEntryIds));
  const state: IncrementalIndexState = {
    index: nextIndex,
    searchIndex,
    embedding: embedding.index,
    embeddingRanges: embedding.ranges,
    manifest: { ...nextManifest, generation: nextIndex.generatedAt },
    generation: nextIndex.generatedAt,
  };
  // Validate all derived state before returning it to the publisher. A failed
  // validation leaves `previous` untouched and lets the caller full-rebuild.
  if (!validPreviousState(state)
    || state.searchIndex?.totalDocs !== state.index.entries.length) {
    return { status: 'fallback', reason: 'incremental derived state failed validation', changes };
  }
  return { status: 'updated', state, changes, changedEntryIds, embedding };
}

/** Compatibility aliases for integrations that call this an update/build step. */
export const buildIncrementalIndex = applyIncrementalIndex;
export const applyIncrementalUpdate = applyIncrementalIndex;

export function embeddingRangesFromIndex(index: EmbeddingIndex | null | undefined): Map<string, EmbeddingRange> {
  if (!index) return new Map();
  const ranges = new Map<string, EmbeddingRange>();
  for (let slot = 0; slot < index.docIds.length; slot++) {
    const docId = parentDocId(index, slot);
    const range = ranges.get(docId);
    if (range) range.end = slot + 1;
    else ranges.set(docId, { docId, start: slot, end: slot + 1 });
  }
  return ranges;
}
