/**
 * Canonical project-root resolution for KG CLI commands.
 *
 * KG uses an explicit project-root override or the containing Git worktree as
 * its implicit boundary, so invoking it from a nested source directory cannot
 * create or query a shadow `.workflow/kg` directory. Outside Git, it follows
 * the shared nearest-workspace resolver used by hooks.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
 * `MAESTRO_PROJECT_ROOT` is an explicit, hard boundary. Without an override,
 * KG state follows the containing Git worktree so nested source directories
 * cannot create or query a shadow database. Outside Git, use the nearest
 * initialized Maestro workspace, then the external-surface manifest or cwd
 * fallback for an uninitialized project.
 */
export function resolveKgCliProjectRoot(startDir = process.cwd()): string {
  const explicitRoot = process.env.MAESTRO_PROJECT_ROOT;
  if (explicitRoot) return canonicalPath(explicitRoot);

  const cwd = canonicalPath(startDir);
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) return gitRoot;

  const workspace = resolveWorkspace({ cwd });
  if (workspace) return canonicalPath(workspace);

  return findExternalManifestRoot(cwd) ?? cwd;
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
