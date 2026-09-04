import { createHash } from 'node:crypto';
import { readdir, readFile, stat, lstat, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import type { WikiEntry } from './wiki-types.js';

/**
 * Source families that can be updated without projecting the complete wiki.
 * `unsupported` is deliberately retained in the manifest: a change to an
 * unknown/session/KG/transcript-shaped file must never be mistaken for a safe
 * incremental update.
 */
export type IncrementalSourceKind =
  | 'project'
  | 'spec'
  | 'knowhow'
  | 'domain'
  | 'issue'
  | 'doc'
  | 'unsupported';

export type CoveredSourceKind = Exclude<IncrementalSourceKind, 'unsupported'>;

export const SOURCE_MANIFEST_VERSION = 1;
export const SOURCE_MANIFEST_FILE = 'wiki-source-manifest.json';

/** A normalized, content-addressed local source record. */
export interface SourceManifestEntry {
  /** Forward-slash path relative to the indexed workflow root. */
  path: string;
  sourceKind: IncrementalSourceKind;
  size: number;
  mtimeMs: number;
  contentHash: string;
  /** IDs emitted by the source parser in the published generation. */
  entryIds: string[];
}

export interface SourceManifest {
  version: typeof SOURCE_MANIFEST_VERSION;
  /** Absolute root identity. It is validation metadata, not part of the content fingerprint. */
  root: string;
  generation: number;
  entries: SourceManifestEntry[];
  /** SHA-256 over normalized path/kind/stat/hash tuples. */
  sourceFingerprint: string;
}

export type SourceChangeKind = 'add' | 'modify' | 'delete' | 'rename';

export interface SourceChange {
  kind: SourceChangeKind;
  path: string;
  sourceKind: IncrementalSourceKind;
  previousPath?: string;
  previous?: SourceManifestEntry;
  current?: SourceManifestEntry;
}

export interface BuildSourceManifestOptions {
  /** Include unknown files as `unsupported` (default true for safe fencing). */
  includeUnsupported?: boolean;
  /** Optional generation associated with the manifest. */
  generation?: number;
  /** Abort while walking/reading a large source tree. */
  signal?: AbortSignal;
  /** IDs from a just-built index, keyed by normalized source path. */
  entryIdsByPath?: ReadonlyMap<string, readonly string[]>;
}

const MAX_MANIFEST_ENTRIES = 1_000_000;
const MAX_MANIFEST_PATH = 32_768;
const MAX_MANIFEST_ID = 32_768;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;

const GENERATED_FILE_NAMES = new Set([
  'wiki-index.json',
  'search-cache.json',
  'embedding-index.json',
  'embedding-index.bin',
  'embedding-index.db',
  'embedding-index.zvec',
  'embedding.zvec',
  'embedding.zvec.meta.json',
  'wiki-source-manifest.json',
  'source-manifest.json',
  'wiki-index-publication.lock',
]);

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('incremental index aborted');
}

export function throwIfManifestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Normalize a relative source path for deterministic comparison/persistence. */
export function normalizeManifestPath(path: string, root?: string): string {
  let candidate = path;
  if (root) candidate = relative(resolve(root), resolve(path));
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
  // `relative()` should already produce a relative value. Refuse traversal and
  // drive/UNC absolute forms in persisted records rather than allowing two
  // spellings of the same path.
  if (normalized === '.' || normalized === '' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return '';
  const parts = normalized.split('/').filter(part => part.length > 0 && part !== '.');
  if (parts.some(part => part === '..')) return '';
  return parts.join('/');
}

/** Compatibility alias for callers that use the shorter name. */
export const normalizeSourcePath = normalizeManifestPath;

/** Classify only the file families understood by WikiIndexer incremental mode. */
export function classifySourcePath(path: string): IncrementalSourceKind {
  const normalized = normalizeManifestPath(path);
  const lower = normalized.toLowerCase();
  if (lower === 'project.md' || lower === 'roadmap.md') return 'project';
  if (/^specs\/[^/]+\.md$/i.test(normalized)) return 'spec';
  // Knowhow supports nested folders, unlike project specs.
  if (/^knowhow\/.+\.md$/i.test(normalized)) return 'knowhow';
  if (lower === 'domain/glossary.json') return 'domain';
  if (/^issues\/[^/]+\.jsonl$/i.test(normalized)) return 'issue';
  // The doc-index is a local file projection (and not a KG source).
  if (lower === 'codebase/doc-index.json') return 'doc';
  return 'unsupported';
}

export function isCoveredSourceKind(kind: IncrementalSourceKind): kind is CoveredSourceKind {
  return kind !== 'unsupported';
}

function isGeneratedFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (GENERATED_FILE_NAMES.has(base)) return true;
  // Temporary publication files are intentionally invisible to the source
  // manifest; they can appear briefly while a generation is being written.
  return /\.(?:tmp|partial)-[^/]+$/i.test(base)
    || /^wiki-index\.json\.tmp-/i.test(base)
    || /^search-cache\.json\.tmp-/i.test(base)
    || /^wiki-source-manifest\.json\.tmp-/i.test(base);
}

function sourceFingerprintEntries(entries: readonly SourceManifestEntry[]): string {
  const hash = createHash('sha256');
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of sorted) {
    hash.update(entry.path).update('\0')
      .update(entry.sourceKind).update('\0')
      .update(String(entry.size)).update('\0')
      .update(String(entry.mtimeMs)).update('\0')
      .update(entry.contentHash).update('\0');
  }
  return hash.digest('hex');
}

export function sourceManifestFingerprint(manifest: Pick<SourceManifest, 'entries'>): string {
  return sourceFingerprintEntries(manifest.entries);
}

function cloneManifestEntry(entry: SourceManifestEntry): SourceManifestEntry {
  return { ...entry, entryIds: [...entry.entryIds].sort((a, b) => a.localeCompare(b)) };
}

function entryIdsForPath(
  map: ReadonlyMap<string, readonly string[]> | undefined,
  path: string,
): string[] {
  if (!map) return [];
  const ids = map.get(path) ?? map.get(normalizeManifestPath(path));
  return ids ? [...new Set(ids)].sort((a, b) => a.localeCompare(b)) : [];
}

async function hashSourceFile(
  absPath: string,
  signal?: AbortSignal,
): Promise<{ size: number; mtimeMs: number; contentHash: string }> {
  throwIfManifestAborted(signal);
  const before = await stat(absPath);
  if (!before.isFile() || before.size < 0 || before.size > MAX_SOURCE_BYTES) {
    throw new Error(`source file exceeds ${MAX_SOURCE_BYTES} byte limit`);
  }
  const bytes = await readFile(absPath);
  throwIfManifestAborted(signal);
  const after = await stat(absPath);
  if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error(`source changed while hashing: ${absPath}`);
  }
  return {
    size: before.size,
    mtimeMs: before.mtimeMs,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Build a deterministic manifest for files below `root`.
 *
 * Symlinks are not followed. Unknown files are retained as unsupported fences
 * by default so additions to sessions/KG/transcripts/configuration cannot be
 * silently accepted by the incremental path.
 */
export async function buildSourceManifest(
  root: string,
  options: BuildSourceManifestOptions = {},
): Promise<SourceManifest> {
  const absoluteRoot = resolve(root);
  const includeUnsupported = options.includeUnsupported !== false;
  const records: SourceManifestEntry[] = [];

  const walk = async (dir: string): Promise<void> => {
    throwIfManifestAborted(options.signal);
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name));
    for (const dirent of dirents) {
      throwIfManifestAborted(options.signal);
      const abs = resolve(dir, dirent.name);
      const rel = normalizeManifestPath(relative(absoluteRoot, abs));
      if (!rel || isGeneratedFile(rel)) continue;
      let info;
      try { info = await lstat(abs); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!info.isFile()) continue;
      const sourceKind = classifySourcePath(rel);
      if (!includeUnsupported && !isCoveredSourceKind(sourceKind)) continue;
      const hashed = await hashSourceFile(abs, options.signal);
      records.push({
        path: rel,
        sourceKind,
        size: hashed.size,
        mtimeMs: hashed.mtimeMs,
        contentHash: hashed.contentHash,
        entryIds: entryIdsForPath(options.entryIdsByPath, rel),
      });
      if (records.length > MAX_MANIFEST_ENTRIES) {
        throw new Error(`source manifest exceeds ${MAX_MANIFEST_ENTRIES} entries`);
      }
    }
  };

  await walk(absoluteRoot);
  records.sort((left, right) => left.path.localeCompare(right.path));
  return {
    version: SOURCE_MANIFEST_VERSION,
    root: absoluteRoot,
    generation: options.generation ?? 0,
    entries: records,
    sourceFingerprint: sourceFingerprintEntries(records),
  };
}

/** Compatibility alias for the scanner-oriented name. */
export const createSourceManifest = buildSourceManifest;
export const scanSourceManifest = buildSourceManifest;

/** Return true when only source content/stat metadata is equal (entry IDs ignored). */
export function sourceManifestsContentEqual(
  left: Pick<SourceManifest, 'entries'>,
  right: Pick<SourceManifest, 'entries'>,
): boolean {
  if (left.entries.length !== right.entries.length) return false;
  const a = [...left.entries].sort((x, y) => x.path.localeCompare(y.path));
  const b = [...right.entries].sort((x, y) => x.path.localeCompare(y.path));
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.path !== y.path || x.sourceKind !== y.sourceKind
      || x.size !== y.size || x.mtimeMs !== y.mtimeMs || x.contentHash !== y.contentHash) return false;
  }
  return true;
}

/**
 * Compute add/modify/delete/rename operations. Renames are paired by source
 * kind and content hash, with lexical path tie-breaking for deterministic
 * behavior when duplicate files have the same bytes.
 */
export function diffSourceManifests(
  previous: Pick<SourceManifest, 'entries'>,
  current: Pick<SourceManifest, 'entries'>,
): SourceChange[] {
  const oldByPath = new Map(previous.entries.map(entry => [entry.path, entry]));
  const newByPath = new Map(current.entries.map(entry => [entry.path, entry]));
  const deleted = [...oldByPath.values()]
    .filter(entry => !newByPath.has(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const added = [...newByPath.values()]
    .filter(entry => !oldByPath.has(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const consumedDeleted = new Set<string>();
  const consumedAdded = new Set<string>();
  const changes: SourceChange[] = [];
  for (const oldEntry of deleted) {
    const match = added.find(candidate => !consumedAdded.has(candidate.path)
      && candidate.sourceKind === oldEntry.sourceKind
      && candidate.contentHash === oldEntry.contentHash);
    if (!match) continue;
    consumedDeleted.add(oldEntry.path);
    consumedAdded.add(match.path);
    changes.push({
      kind: 'rename',
      path: match.path,
      previousPath: oldEntry.path,
      sourceKind: match.sourceKind,
      previous: cloneManifestEntry(oldEntry),
      current: cloneManifestEntry(match),
    });
  }

  for (const entry of added) {
    if (consumedAdded.has(entry.path)) continue;
    changes.push({ kind: 'add', path: entry.path, sourceKind: entry.sourceKind, current: cloneManifestEntry(entry) });
  }
  for (const entry of deleted) {
    if (consumedDeleted.has(entry.path)) continue;
    changes.push({ kind: 'delete', path: entry.path, sourceKind: entry.sourceKind, previous: cloneManifestEntry(entry) });
  }
  for (const currentEntry of [...newByPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const previousEntry = oldByPath.get(currentEntry.path);
    if (!previousEntry) continue;
    if (previousEntry.sourceKind !== currentEntry.sourceKind
      || previousEntry.size !== currentEntry.size
      || previousEntry.mtimeMs !== currentEntry.mtimeMs
      || previousEntry.contentHash !== currentEntry.contentHash) {
      changes.push({
        kind: 'modify',
        path: currentEntry.path,
        sourceKind: currentEntry.sourceKind,
        previous: cloneManifestEntry(previousEntry),
        current: cloneManifestEntry(currentEntry),
      });
    }
  }

  changes.sort((left, right) => left.path.localeCompare(right.path)
    || left.kind.localeCompare(right.kind)
    || (left.previousPath ?? '').localeCompare(right.previousPath ?? ''));
  return changes;
}

export const diffManifests = diffSourceManifests;

export function manifestEntryForPath(
  manifest: Pick<SourceManifest, 'entries'>,
  path: string,
): SourceManifestEntry | undefined {
  const normalized = normalizeManifestPath(path);
  return manifest.entries.find(entry => entry.path === normalized);
}

/** Attach final entry IDs to a manifest without changing source metadata. */
export function manifestWithEntryIds(
  manifest: SourceManifest,
  entries: readonly WikiEntry[],
): SourceManifest {
  const idsByPath = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.source.workspace) continue;
    const path = normalizeManifestPath(entry.source.path);
    const projectedPath = typeof entry.ext?.docIndexPath === 'string'
      ? normalizeManifestPath(entry.ext.docIndexPath)
      : '';
    const paths = [path, projectedPath].filter(Boolean);
    for (const candidatePath of paths) {
      const ids = idsByPath.get(candidatePath) ?? [];
      ids.push(entry.id);
      idsByPath.set(candidatePath, ids);
    }
  }
  const nextEntries = manifest.entries.map(entry => ({
    ...entry,
    entryIds: entryIdsForPath(idsByPath, entry.path),
  }));
  return {
    ...manifest,
    entries: nextEntries,
    sourceFingerprint: sourceFingerprintEntries(nextEntries),
  };
}

function validSourceKind(value: unknown): value is IncrementalSourceKind {
  return value === 'project' || value === 'spec' || value === 'knowhow'
    || value === 'domain' || value === 'issue' || value === 'doc' || value === 'unsupported';
}

function validManifestEntry(value: unknown): value is SourceManifestEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.path === 'string'
    && normalizeManifestPath(record.path) === record.path
    && record.path.length > 0 && record.path.length <= MAX_MANIFEST_PATH
    && validSourceKind(record.sourceKind)
    && typeof record.size === 'number' && Number.isSafeInteger(record.size) && record.size >= 0
    && typeof record.mtimeMs === 'number' && Number.isFinite(record.mtimeMs) && record.mtimeMs >= 0
    && typeof record.contentHash === 'string' && /^[0-9a-f]{64}$/.test(record.contentHash)
    && Array.isArray(record.entryIds) && record.entryIds.length <= MAX_MANIFEST_ENTRIES
    && record.entryIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= MAX_MANIFEST_ID);
}

/** Validate untrusted persisted data; invalid manifests are cache misses. */
export function validateSourceManifest(value: unknown, expectedRoot?: string): SourceManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== SOURCE_MANIFEST_VERSION
    || typeof record.root !== 'string'
    || (expectedRoot !== undefined && resolve(record.root) !== resolve(expectedRoot))
    || typeof record.generation !== 'number' || !Number.isSafeInteger(record.generation) || record.generation < 0
    || !Array.isArray(record.entries) || record.entries.length > MAX_MANIFEST_ENTRIES
    || typeof record.sourceFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(record.sourceFingerprint)) return null;
  const rawEntries = record.entries as unknown[];
  const entries: SourceManifestEntry[] = [];
  const paths = new Set<string>();
  for (const raw of rawEntries) {
    if (!validManifestEntry(raw)) return null;
    const entry = raw as SourceManifestEntry;
    if (paths.has(entry.path)) return null;
    paths.add(entry.path);
    entries.push({ ...entry, entryIds: [...new Set(entry.entryIds)].sort((a, b) => a.localeCompare(b)) });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  if (record.sourceFingerprint !== sourceFingerprintEntries(entries)) return null;
  return {
    version: SOURCE_MANIFEST_VERSION,
    root: resolve(record.root),
    generation: record.generation,
    entries,
    sourceFingerprint: record.sourceFingerprint,
  };
}

export async function readSourceManifest(
  path: string,
  expectedRoot?: string,
  signal?: AbortSignal,
): Promise<SourceManifest | null> {
  throwIfManifestAborted(signal);
  try {
    const raw = await readFile(path, 'utf-8');
    throwIfManifestAborted(signal);
    return validateSourceManifest(JSON.parse(raw) as unknown, expectedRoot);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    return null;
  }
}

/** Atomically persist a manifest. The caller still owns generation fencing. */
export async function writeSourceManifest(
  path: string,
  manifest: SourceManifest,
  signal?: AbortSignal,
): Promise<string> {
  throwIfManifestAborted(signal);
  const checked = validateSourceManifest(manifest, manifest.root);
  if (!checked) throw new Error('refusing to write an invalid source manifest');
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    throwIfManifestAborted(signal);
    await writeFile(temp, JSON.stringify(checked, null, 2), { encoding: 'utf-8', flag: 'wx' });
    throwIfManifestAborted(signal);
    await rename(temp, path);
    return path;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Compare persisted IDs as well as source metadata for publication validation. */
export function sourceManifestsEqual(
  left: Pick<SourceManifest, 'entries'>,
  right: Pick<SourceManifest, 'entries'>,
): boolean {
  if (!sourceManifestsContentEqual(left, right)) return false;
  const rightByPath = new Map(right.entries.map(entry => [entry.path, entry.entryIds]));
  for (const entry of left.entries) {
    const expected = [...entry.entryIds].sort((a, b) => a.localeCompare(b));
    const actual = [...(rightByPath.get(entry.path) ?? [])].sort((a, b) => a.localeCompare(b));
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) return false;
  }
  return true;
}
