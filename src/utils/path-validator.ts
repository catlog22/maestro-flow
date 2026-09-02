/**
 * Centralized Path Validation Utility
 *
 * Provides secure path validation and resolution for MCP tools.
 * Prevents path traversal attacks and ensures operations stay within allowed directories.
 */

import { resolve, isAbsolute, normalize, relative, sep } from 'path';
import { realpath, access } from 'fs/promises';
import { constants } from 'fs';
import { findRepositoryRoot, getActiveRepositoryExecution } from '../repository/context.js';

// Environment variable configuration
const ENV_PROJECT_ROOT = 'MAESTRO_PROJECT_ROOT';
const ENV_ALLOWED_DIRS = 'MAESTRO_ALLOWED_DIRS';
const ENV_ENABLE_SANDBOX = 'MAESTRO_ENABLE_SANDBOX';

/**
 * Check if sandbox mode is enabled
 * When enabled, path validation restricts access to allowed directories only
 */
export function isSandboxEnabled(): boolean {
  const value = process.env[ENV_ENABLE_SANDBOX];
  return value === '1' || value?.toLowerCase() === 'true';
}

/**
 * Get the canonical repository boundary.
 * Priority remains MAESTRO_PROJECT_ROOT > process.cwd(), but nested cwd/env
 * values now converge on the same realpath-resolved `.workflow` carrier.
 */
export function getProjectRoot(): string {
  const activeRoot = getActiveRepositoryExecution()?.target.projectRoot;
  if (activeRoot) return activeRoot;
  const start = process.env[ENV_PROJECT_ROOT] || process.cwd();
  return findRepositoryRoot(start) ?? resolve(start);
}

/**
 * Get allowed directories list
 * Priority: MAESTRO_ALLOWED_DIRS > [getProjectRoot()]
 */
export function getAllowedDirectories(): string[] {
  const envDirs = process.env[ENV_ALLOWED_DIRS];
  if (envDirs) {
    return envDirs.split(',').map(d => d.trim()).filter(Boolean);
  }
  return [getProjectRoot()];
}

/**
 * Normalize path (unify separators to forward slash)
 */
export function normalizePath(p: string): string {
  return normalize(p).replace(/\\/g, '/');
}

function canonicalizeForComparison(p: string): string {
  const base = getProjectRoot();
  const absolute = isAbsolute(p) ? p : resolve(base, p);
  let canonical = normalize(absolute);

  // Remove trailing separators (except drive roots like C:\ and posix root /)
  canonical = canonical.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(canonical)) {
    canonical += sep;
  } else if (canonical === '') {
    canonical = sep;
  }

  // Windows paths are case-insensitive.
  if (process.platform === 'win32') {
    canonical = canonical.toLowerCase();
  }

  return canonical;
}

/**
 * Check if path is within allowed directories
 */
export function isPathWithinAllowedDirectories(
  targetPath: string,
  allowedDirectories: string[]
): boolean {
  const canonicalTarget = canonicalizeForComparison(targetPath);
  return allowedDirectories.some(dir => {
    const canonicalDir = canonicalizeForComparison(dir);
    if (canonicalTarget === canonicalDir) return true;

    const boundary = canonicalDir.endsWith(sep) ? canonicalDir : canonicalDir + sep;
    return canonicalTarget.startsWith(boundary);
  });
}

/**
 * Validate and resolve path (core function)
 *
 * Security model:
 * 1. Resolve to absolute path
 * 2. Check against allowed directories
 * 3. Resolve symlinks and re-verify
 *
 * @param filePath - Path to validate
 * @param options - Validation options
 * @returns Validated absolute path
 * @throws Error if path is outside allowed directories or validation fails
 */
export async function validatePath(
  filePath: string,
  options: {
    allowedDirectories?: string[];
    mustExist?: boolean;
  } = {}
): Promise<string> {
  const sandboxEnabled = isSandboxEnabled();
  const allowedDirs = options.allowedDirectories || getAllowedDirectories();

  // 1. Resolve to absolute path
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(getProjectRoot(), filePath);
  const normalizedPath = normalizePath(absolutePath);

  // 2. Initial sandbox check (only if sandbox is enabled)
  if (sandboxEnabled && !isPathWithinAllowedDirectories(normalizedPath, allowedDirs)) {
    throw new Error(
      `Access denied: path "${normalizedPath}" is outside allowed directories. ` +
      `Allowed: [${allowedDirs.join(', ')}]`
    );
  }

  // 3. Try to resolve symlinks and re-verify
  try {
    const realPath = await realpath(absolutePath);
    const normalizedReal = normalizePath(realPath);

    // Only check symlink target if sandbox is enabled
    if (sandboxEnabled && !isPathWithinAllowedDirectories(normalizedReal, allowedDirs)) {
      throw new Error(
        `Access denied: symlink target "${normalizedReal}" is outside allowed directories`
      );
    }

    return normalizedReal;
  } catch (error: any) {
    // File doesn't exist - validate parent directory
    if (error.code === 'ENOENT') {
      if (options.mustExist) {
        throw new Error(`File not found: ${absolutePath}`);
      }

      // Validate parent directory's real path (only if sandbox is enabled)
      const parentDir = resolve(absolutePath, '..');
      try {
        const realParent = await realpath(parentDir);
        const normalizedParent = normalizePath(realParent);

        if (sandboxEnabled && !isPathWithinAllowedDirectories(normalizedParent, allowedDirs)) {
          throw new Error(
            `Access denied: parent directory "${normalizedParent}" is outside allowed directories`
          );
        }
      } catch (parentError: any) {
        if (parentError.code === 'ENOENT') {
          // Parent directory doesn't exist either - return original absolute path
          // Let the caller create it if needed
          return absolutePath;
        }
        throw parentError;
      }

      return absolutePath;
    }

    // Re-throw access denied errors
    if (error.message?.includes('Access denied')) {
      throw error;
    }
    throw error;
  }
}

/**
 * Resolve project-relative path (simplified, no strict validation)
 * Use for cases where strict security validation is not needed
 */
export function resolveProjectPath(...pathSegments: string[]): string {
  return resolve(getProjectRoot(), ...pathSegments);
}
