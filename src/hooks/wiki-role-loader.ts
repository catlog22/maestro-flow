/**
 * Wiki Category Loader — synchronous wiki knowledge loading by category.
 *
 * Reads the persisted wiki-index.json to quickly load category-tagged
 * entries without requiring the full WikiIndexer or dashboard server.
 * Used by spec-injector hook for lightweight context injection.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDeprecatedKnowledgeEntry } from '../utils/knowledge-lifecycle.js';
import { logHookWarn } from './hook-logger.js';

export interface WikiCategoryResult {
  content: string;
  entryCount: number;
}

export interface WikiIndexEntry {
  type: string;
  title: string;
  summary: string;
  category?: string | null;
  specCategory?: string | null;
  updated: string;
  status?: string;
  tags?: string[];
  ext?: { virtualKind?: string; status?: string; appliesToRepoIds?: string[] };
  repoId?: string | null;
  repoName?: string;
  alias?: string;
  workspaceFence?: string;
  appliesToRepoIds?: string[] | null;
}

export interface ParsedWikiIndex {
  entries?: WikiIndexEntry[];
}

// ---------------------------------------------------------------------------
// Module-level mtime-keyed cache (pattern: readGlossaryCached in domain-loader)
// ---------------------------------------------------------------------------

let _cache: { path: string; mtimeMs: number; size: number; index: ParsedWikiIndex | null } | null = null;

/**
 * Load and parse the persisted wiki index once per mtime. The hook hot path
 * calls this per agent spawn across multiple categories — re-parsing a
 * multi-MB JSON each time is wasted blocking I/O. A stat failure falls back
 * to a fresh read; parse failures are cached as null until the file changes.
 */
export function loadWikiIndex(projectPath: string): ParsedWikiIndex | null {
  const indexPath = join(projectPath, '.workflow', 'wiki-index.json');

  let mtimeMs = -1;
  let size = -1;
  try {
    const st = statSync(indexPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
    if (_cache && _cache.path === indexPath && _cache.mtimeMs === mtimeMs && _cache.size === size) {
      return _cache.index;
    }
  } catch {
    // stat failure — fall through to a fresh uncached read
  }

  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return null;
  }

  let index: ParsedWikiIndex | null;
  try {
    index = JSON.parse(raw);
  } catch (err) {
    logHookWarn('wiki-role-loader', `Corrupt wiki-index.json at ${indexPath}: ${(err as Error).message}`);
    index = null;
  }

  if (mtimeMs >= 0) {
    _cache = { path: indexPath, mtimeMs, size, index };
  }
  return index;
}

/**
 * KG virtual projections (ext.virtualKind kg-*) all share the latest sync
 * timestamp and would crowd out real knowhow in updated-desc selection.
 * The persisted index strips ext, so also match the 'kg' projection tag
 * (both KG adapters emit tags starting with 'kg').
 */
function isKgVirtual(e: WikiIndexEntry): boolean {
  const vk = e.ext?.virtualKind;
  if (typeof vk === 'string' && vk.startsWith('kg-')) return true;
  return Array.isArray(e.tags) && e.tags.includes('kg');
}

/**
 * Select entries matching a given category from a parsed wiki index.
 * Returns formatted title+summary content for injection, or null if
 * no matching entries exist.
 */
export function selectWikiByCategory(
  index: ParsedWikiIndex | null,
  category: string,
  applicableRepoId?: string | null,
): WikiCategoryResult | null {
  if (!index?.entries?.length) return null;

  const matched = index.entries
    .filter(e =>
      !isKgVirtual(e)
      && !isDeprecatedKnowledgeEntry(e)
      && isApplicable(e, applicableRepoId)
      && (e.category === category || e.specCategory === category)
    )
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 10);

  if (matched.length === 0) return null;

  const content = `# Wiki Knowledge (category: ${category})\n\n` +
    matched.map(e => `### [${e.type}] ${e.title}\n${e.summary}`).join('\n\n---\n\n');

  return { content, entryCount: matched.length };
}

/**
 * Load wiki entries matching a given category from the persisted index.
 * Thin wrapper over loadWikiIndex + selectWikiByCategory.
 */
export function loadWikiByCategory(
  projectPath: string,
  category: string,
  applicableRepoId?: string | null,
): WikiCategoryResult | null {
  return selectWikiByCategory(loadWikiIndex(projectPath), category, applicableRepoId);
}

function isApplicable(entry: WikiIndexEntry, targetRepoId: string | null | undefined): boolean {
  const appliesToRepoIds = entry.appliesToRepoIds ?? entry.ext?.appliesToRepoIds;
  if (appliesToRepoIds === undefined || appliesToRepoIds === null) return true;
  // Undefined means an older caller that has not opted into repository scoping.
  if (targetRepoId === undefined) return true;
  return targetRepoId !== null && appliesToRepoIds.includes(targetRepoId);
}
