/**
 * Wiki Role Loader — synchronous wiki knowledge loading by role.
 *
 * Reads the persisted wiki-index.json to quickly load role-tagged
 * entries without requiring the full WikiIndexer or dashboard server.
 * Used by spec-injector hook for lightweight context injection.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WikiRoleResult {
  content: string;
  entryCount: number;
}

/**
 * Load wiki entries matching a given role from the persisted index.
 * Returns formatted title+summary content for injection, or null if
 * no matching entries exist.
 */
export function loadWikiByRole(projectPath: string, role: string): WikiRoleResult | null {
  const indexPath = join(projectPath, '.workflow', 'wiki-index.json');
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return null;
  }

  let index: { entries?: Array<{ type: string; title: string; summary: string; roles?: string[]; updated: string }> };
  try {
    index = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!index?.entries?.length) return null;

  const matched = index.entries
    .filter(e => Array.isArray(e.roles) && e.roles.includes(role))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 10);

  if (matched.length === 0) return null;

  const content = `# Wiki Knowledge (role: ${role})\n\n` +
    matched.map(e => `### [${e.type}] ${e.title}\n${e.summary}`).join('\n\n---\n\n');

  return { content, entryCount: matched.length };
}
