/**
 * Workspace Resolver — Finds the project root containing `.workflow/`
 *
 * Walks up from the given directory to find the nearest ancestor
 * containing a `.workflow` directory. Similar to how git finds `.git/`.
 *
 * Used by all workflow-aware hooks to resolve artifact paths correctly
 * regardless of the working directory Claude Code reports.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalizeRepositoryRoot,
  findRepositoryRoot,
  isPathContained,
  readRepositoryIdentity,
} from '../repository/context.js';

/**
 * Check if a `.workflow/` directory is a Maestro workspace by verifying
 * either the canonical Session registry or a MaestroGraph database exists.
 * This prevents false positives from other tools that use `.workflow/`, while
 * still allowing KG-only workspaces to use code-search hooks before workflow
 * state init.
 */
export function isMaestroWorkspace(dir: string): boolean {
  try {
    const root = canonicalizeRepositoryRoot(dir);
    const workflowPath = join(root, '.workflow');
    if (!existsSync(workflowPath) || !isPathContained(realpathSync(workflowPath), root)) return false;
    if (existsSync(join(workflowPath, 'repository.json'))) {
      // Parsing here makes malformed identities fail closed at the root boundary.
      return readRepositoryIdentity(root) !== null;
    }
  } catch {
    return false;
  }

  if (existsSync(join(dir, '.workflow', 'kg', 'maestro.db'))) return true;

  const statePath = join(dir, '.workflow', 'state.json');
  if (!existsSync(statePath)) return false;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.version !== undefined
      && (typeof state.phases_summary === 'object'
        || Array.isArray(state.sessions) || typeof state.active_session_id === 'string'
        || existsSync(join(dir, '.workflow', 'sessions'))
        || existsSync(join(dir, '.workflow', '.maestro')));
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
  return findRepositoryRoot(startDir);
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
