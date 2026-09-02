export interface RepositoryApplicableEntry {
  appliesToRepoIds?: string[] | null;
  ext?: Record<string, unknown>;
}

/**
 * Historical entries without an applicability field remain visible. Scoped
 * entries require an exact persisted target repository ID.
 */
export function isRepositoryApplicable(
  entry: RepositoryApplicableEntry,
  targetRepoId: string | null | undefined,
): boolean {
  const fallback = Array.isArray(entry.ext?.appliesToRepoIds)
    ? entry.ext.appliesToRepoIds.filter((value): value is string => typeof value === 'string')
    : undefined;
  const appliesToRepoIds = entry.appliesToRepoIds ?? fallback;
  if (appliesToRepoIds === undefined || appliesToRepoIds === null) return true;
  if (!targetRepoId || targetRepoId === '__legacy__') return false;
  return appliesToRepoIds.includes(targetRepoId);
}
