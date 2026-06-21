/**
 * Wiki Category Loader — synchronous wiki knowledge loading by category.
 *
 * Reads the persisted wiki-index.json to quickly load category-tagged
 * entries without requiring the full WikiIndexer or dashboard server.
 * Used by spec-injector hook for lightweight context injection.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WikiCategoryResult {
  content: string;
  entryCount: number;
}

/**
 * Load wiki entries matching a given category from the persisted index.
 * Returns formatted title+summary content for injection, or null if
 * no matching entries exist.
 */
export function loadWikiByCategory(projectPath: string, category: string): WikiCategoryResult | null {
  const indexPath = join(projectPath, '.workflow', 'wiki-index.json');
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return null;
  }

  let index: { entries?: Array<{ type: string; title: string; summary: string; category?: string | null; specCategory?: string | null; updated: string }> };
  try {
    index = JSON.parse(raw);
  } catch (err) {
    console.warn(`[wiki-role-loader] Corrupt wiki-index.json at ${indexPath}: ${(err as Error).message}`);
    return null;
  }

  if (!index?.entries?.length) return null;

  const matched = index.entries
    .filter(e => e.category === category || e.specCategory === category)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 10);

  if (matched.length === 0) return null;

  const content = `# Wiki Knowledge (category: ${category})\n\n` +
    matched.map(e => `### [${e.type}] ${e.title}\n${e.summary}`).join('\n\n---\n\n');

  return { content, entryCount: matched.length };
}
