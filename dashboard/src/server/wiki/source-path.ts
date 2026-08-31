import { lstatSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export type AllowedSourceKind = 'file' | 'directory' | 'any';

/**
 * Bounded memoization for realpathSync.native, which is far more expensive
 * than a plain stat on Windows (~60x in measured environments). The wiki
 * indexer resolves the same small set of source paths on every cold build,
 * so a per-process cache removes the repeated syscall cost without changing
 * resolution semantics.
 *
 * Each cached entry is validated on every hit with one cheap lstat: if the
 * file identity (device+inode) at the lexical path is unchanged, the cached
 * real path is still authoritative. Replacement or deletion changes the
 * identity and forces a fresh resolution, so the cache can never outlive a
 * filesystem mutation it cannot see. Symbolic links are never cached — their
 * inode stays stable when the link is repointed, so only a fresh resolution
 * can stay correct; they are rare in the indexer's hot paths.
 */
type RealpathCacheEntry = { real: string; dev: number; ino: number } | typeof MISSING;
const realpathCache = new Map<string, RealpathCacheEntry>();
const REALPATH_CACHE_MAX = 4096;
const MISSING = Symbol('realpath-missing');

function cachedRealpath(path: string): string | null {
  const cached = realpathCache.get(path);
  if (cached === MISSING) {
    // Negative entry: only re-resolve once the path actually appears.
    try {
      lstatSync(path);
      realpathCache.delete(path);
    } catch {
      return null;
    }
  } else if (cached !== undefined) {
    try {
      const current = lstatSync(path);
      if (current.dev === cached.dev && current.ino === cached.ino) {
        return cached.real;
      }
      // Identity changed (replacement/symlink swap): fall through to a fresh
      // resolution.
    } catch {
      // Path disappeared — fall through to a fresh resolution which will
      // surface the failure through realpathSync.native.
    }
    realpathCache.delete(path);
  }
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch {
    // Negative cache: the indexer probes many optional paths (e.g. a
    // workflow without a roadmap or glossary); realpathSync.native is ~1-3ms
    // per ENOENT attempt on Windows, which dominates the warm change-check
    // when repeated per query.
    if (realpathCache.size >= REALPATH_CACHE_MAX) realpathCache.clear();
    realpathCache.set(path, MISSING);
    return null;
  }
  if (realpathCache.size >= REALPATH_CACHE_MAX) {
    // Pathological breadth (e.g. a huge generated tree): drop everything
    // rather than keeping a lopsided cache. Re-population is just slow,
    // not incorrect.
    realpathCache.clear();
  }
  try {
    const current = lstatSync(path);
    if (!current.isSymbolicLink()) {
      realpathCache.set(path, { real, dev: current.dev, ino: current.ino });
    }
  } catch {
    // Nothing to cache — the path vanished between resolution and now.
  }
  return real;
}

function normalizeForComparison(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * Resolve an existing source through symlinks and prove that it remains under
 * an explicitly allowed root. Callers must use the returned real path for I/O.
 */
export function resolveAllowedSourcePath(
  candidate: string,
  allowedRoot: string,
  kind: AllowedSourceKind = 'file',
): string | null {
  try {
    const realRoot = cachedRealpath(resolve(allowedRoot));
    if (realRoot === null) return null;
    const realCandidate = cachedRealpath(resolve(candidate));
    if (realCandidate === null) return null;
    const comparedRoot = normalizeForComparison(realRoot);
    const comparedCandidate = normalizeForComparison(realCandidate);
    if (comparedCandidate !== comparedRoot
      && !comparedCandidate.startsWith(`${comparedRoot}${sep}`)) return null;

    const sourceStat = statSync(realCandidate);
    if (kind === 'file' && !sourceStat.isFile()) return null;
    if (kind === 'directory' && !sourceStat.isDirectory()) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

/**
 * Fast path for descendants of a root that was already realpath-resolved.
 * Symbolic links are rejected, so lexical containment cannot be redirected.
 */
export function resolveAllowedDirectSourcePath(
  candidate: string,
  canonicalAllowedRoot: string,
  kind: AllowedSourceKind = 'file',
): string | null {
  try {
    const requested = resolve(candidate);
    const realRoot = resolve(canonicalAllowedRoot);
    const comparedRoot = normalizeForComparison(realRoot);
    const comparedCandidate = normalizeForComparison(requested);
    if (comparedCandidate !== comparedRoot
      && !comparedCandidate.startsWith(`${comparedRoot}${sep}`)) return null;
    const sourceStat = lstatSync(requested);
    if (sourceStat.isSymbolicLink()) return null;
    if (kind === 'file' && !sourceStat.isFile()) return null;
    if (kind === 'directory' && !sourceStat.isDirectory()) return null;
    return requested;
  } catch {
    return null;
  }
}

export function isAllowedSourcePath(
  candidate: string,
  allowedRoot: string,
  kind: AllowedSourceKind = 'file',
): boolean {
  return resolveAllowedSourcePath(candidate, allowedRoot, kind) !== null;
}
