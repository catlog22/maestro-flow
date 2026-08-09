/**
 * Canonical project-root resolution for KG CLI commands.
 *
 * Hooks already resolve a Maestro workspace before touching KG state. The CLI
 * must use the same boundary so invoking it from a nested source directory
 * cannot create or query a shadow `.workflow/kg` directory.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveWorkspace } from '../../../hooks/workspace.js';

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function findGitRoot(startDir: string): string | null {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    }).trim();
    return root ? canonicalPath(root) : null;
  } catch {
    return null;
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function findExternalManifestRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, '.workflow', 'kg', 'external-surfaces.json'))) {
      return canonicalPath(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the repository root for a KG CLI command.
 *
 * An initialized Maestro workspace wins because it is the same resolver used
 * by hooks. Before a workspace exists, `kg init` and other CLI actions use
 * the containing Git worktree; non-Git callers retain the historical cwd
 * fallback.
 */
export function resolveKgCliProjectRoot(startDir = process.cwd()): string {
  const cwd = canonicalPath(startDir);
  const workspace = resolveWorkspace({ cwd });
  const gitRoot = findGitRoot(cwd);
  if (workspace) {
    const canonicalWorkspace = canonicalPath(workspace);
    if (!gitRoot || isWithinRoot(canonicalWorkspace, gitRoot)) {
      return canonicalWorkspace;
    }
  }

  return gitRoot ?? findExternalManifestRoot(cwd) ?? cwd;
}

/**
 * Resolve the external-surface manifest carrier before the KG database exists.
 * Validation deliberately reuses the general CLI root so it cannot approve a
 * manifest that sync would ignore.
 */
export function resolveExternalSurfaceProjectRoot(startDir = process.cwd()): string {
  // Validation and sync must consume the same canonical manifest carrier.
  // The Git fallback in resolveKgCliProjectRoot already supports a fresh clone.
  return resolveKgCliProjectRoot(startDir);
}
