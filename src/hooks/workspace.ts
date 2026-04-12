/**
 * Workspace Resolver — Finds the project root containing `.workflow/`
 *
 * Walks up from the given directory to find the nearest ancestor
 * containing a `.workflow` directory. Similar to how git finds `.git/`.
 *
 * Used by all workflow-aware hooks to resolve artifact paths correctly
 * regardless of the working directory Claude Code reports.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Check if a `.workflow/` directory is a Maestro workspace by verifying
 * `state.json` contains Maestro-specific fields (`version` + `phases_summary`).
 * This prevents false positives from other tools that use `.workflow/`.
 */
export function isMaestroWorkspace(dir: string): boolean {
  const statePath = join(dir, '.workflow', 'state.json');
  if (!existsSync(statePath)) return false;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.version !== undefined && state.phases_summary !== undefined;
  } catch {
    return false;
  }
}

/**
 * Find the nearest ancestor directory containing a valid Maestro `.workflow/`.
 * Returns null if no workspace is found (walks up to filesystem root).
 *
 * Prefers a directory that also contains `.git/` (project root heuristic).
 * Walks up at most 10 levels.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = startDir;
  let firstMatch: string | null = null;

  for (let i = 0; i < 10; i++) {
    if (isMaestroWorkspace(dir)) {
      // Prefer git root match — if .git/ is here too, return immediately
      if (existsSync(join(dir, '.git'))) return dir;
      // Otherwise remember first match and keep looking
      if (!firstMatch) firstMatch = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return firstMatch;
}

/**
 * Resolve the workspace root from hook input data.
 * Tries data.cwd first, falls back to process.cwd().
 * Returns null if no workspace found.
 */
export function resolveWorkspace(data: { cwd?: string }): string | null {
  const startDir = data.cwd || process.cwd();
  return findWorkspaceRoot(startDir);
}
