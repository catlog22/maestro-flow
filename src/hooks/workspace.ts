/**
 * Workspace Resolver — Finds the project root containing `.workflow/`
 *
 * Walks up from the given directory to find the nearest ancestor
 * containing a `.workflow` directory. Similar to how git finds `.git/`.
 *
 * Used by all workflow-aware hooks to resolve artifact paths correctly
 * regardless of the working directory Claude Code reports.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
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

/** Loose hook payload shape: fields arrive untyped from host CLIs. */
export interface WorkspaceHint {
  cwd?: unknown;
  workspace_roots?: unknown;
  workspaceRoots?: unknown;
}

const CHILD_WORKSPACE_SKIP = new Set(['node_modules', 'dist', 'coverage', 'dashboard']);

/** Append value to dirs when it is a non-blank string; ignore everything else. */
function pushDir(dirs: string[], value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) dirs.push(trimmed);
}

/**
 * Directories a host hook may be talking about: cwd, Cursor workspace_roots,
 * and common project-dir env vars. Order is preference, not uniqueness.
 *
 * An explicit `cwd` is not silently replaced by `process.cwd()` — callers that
 * pass a non-workspace directory still get null, matching the old contract.
 */
export function workspaceStartDirs(data: WorkspaceHint = {}, fallbackCwd = process.cwd()): string[] {
  const dirs: string[] = [];
  const hasExplicitCwd = typeof data.cwd === 'string' && data.cwd.trim().length > 0;
  pushDir(dirs, data.cwd);
  const roots = data.workspace_roots ?? data.workspaceRoots;
  const beforeRoots = dirs.length;
  if (Array.isArray(roots)) {
    for (const root of roots) pushDir(dirs, root);
  } else {
    pushDir(dirs, roots);
  }
  const hasRoots = dirs.length > beforeRoots;
  if (!hasExplicitCwd || hasRoots) {
    pushDir(dirs, process.env.CURSOR_PROJECT_DIR);
    pushDir(dirs, process.env.CLAUDE_PROJECT_DIR);
    pushDir(dirs, process.env.MAESTRO_PROJECT_ROOT);
  }
  if (!hasExplicitCwd) pushDir(dirs, fallbackCwd);
  return [...new Set(dirs)];
}

/**
 * Cursor often opens a wrapper folder whose Maestro workspace is one child
 * (e.g. maestrogrok/repo). Walk-up cannot see that; scan immediate children.
 */
export function findWorkspaceInImmediateChildren(dir: string): string | null {
  let names: string[] = [];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !CHILD_WORKSPACE_SKIP.has(entry.name))
      .map(entry => entry.name);
  } catch {
    return null;
  }
  names.sort((left, right) => {
    if (left === 'repo') return -1;
    if (right === 'repo') return 1;
    return left.localeCompare(right);
  });
  for (const name of names) {
    const child = join(dir, name);
    if (isMaestroWorkspace(child)) return child;
  }
  return null;
}

/** Resolve one candidate directory: walk up first, then probe immediate children. */
function resolveFromStart(startDir: string): string | null {
  return findWorkspaceRoot(startDir) ?? findWorkspaceInImmediateChildren(startDir);
}

/**
 * Resolve the workspace root from hook input data.
 * Tries cwd, workspace_roots, then project-dir env vars, then process.cwd().
 * Returns null if no workspace found.
 */
export function resolveWorkspace(data: WorkspaceHint = {}): string | null {
  for (const startDir of workspaceStartDirs(data)) {
    const found = resolveFromStart(startDir);
    if (found) return found;
  }
  return null;
}
