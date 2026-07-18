/**
 * Shared lifecycle policy for Wiki-backed knowledge entries.
 *
 * Some paths consume the full WikiEntry while hot-path hooks consume the
 * persisted lightweight index. Accept both shapes so deprecated knowledge is
 * hidden consistently across search, load, and prompt injection.
 */

export interface KnowledgeLifecycleEntry {
  status?: unknown;
  ext?: unknown;
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'superseded' ? 'deprecated' : normalized;
}

export function getKnowledgeStatus(entry: KnowledgeLifecycleEntry): string | null {
  const direct = normalizeStatus(entry.status);
  if (direct) return direct;

  if (entry.ext && typeof entry.ext === 'object') {
    return normalizeStatus((entry.ext as Record<string, unknown>).status);
  }
  return null;
}

export function isDeprecatedKnowledgeEntry(entry: KnowledgeLifecycleEntry): boolean {
  return getKnowledgeStatus(entry) === 'deprecated';
}
