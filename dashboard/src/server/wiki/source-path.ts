import { lstatSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export type AllowedSourceKind = 'file' | 'directory' | 'any';

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
    const realRoot = realpathSync.native(resolve(allowedRoot));
    const realCandidate = realpathSync.native(resolve(candidate));
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
