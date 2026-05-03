// ---------------------------------------------------------------------------
// Pure tree-building logic extracted from BlueprintPreview for testability.
// ---------------------------------------------------------------------------

import { type ComponentDef } from '../install-backend.js';

/** A group of components sharing the same parent directory. */
export interface TargetGroup {
  parentDir: string;
  entries: Array<{ subPath: string; fileCount: number; label: string; status?: string }>;
  totalFiles: number;
}

/**
 * Resolve the parent directory from a full target path.
 * Walks segments to find the one containing ".maestro", ".claude", or ".codex"
 * and returns the path up to and including that segment.
 */
export function resolveParentDir(targetDir: string): string {
  const normalized = targetDir.replace(/\\/g, '/');
  const segments = normalized.split('/');

  let parentEnd = 2;
  for (let i = 1; i < segments.length; i++) {
    if (
      segments[i].startsWith('.maestro') ||
      segments[i].startsWith('.claude') ||
      segments[i].startsWith('.codex')
    ) {
      parentEnd = i + 1;
      break;
    }
  }
  return segments.slice(0, parentEnd).join('/');
}

/**
 * Resolve the sub-path (after the parent directory) from a full target path.
 */
export function resolveSubPath(targetDir: string): string {
  const normalized = targetDir.replace(/\\/g, '/');
  const parent = resolveParentDir(targetDir);
  const parentSegments = parent.split('/').length;
  const segments = normalized.split('/');
  return segments.slice(parentSegments).join('/') || '.';
}

/**
 * Build a grouped tree from resolved component targets.
 * Each group represents a parent directory (e.g. "~/.maestro", "~/.claude").
 */
export function buildTree(
  defs: Array<{ def: ComponentDef; targetDir: string; fileCount: number; status?: string }>,
): TargetGroup[] {
  const groupMap = new Map<string, TargetGroup>();

  for (const { def, targetDir, fileCount, status } of defs) {
    const parentDir = resolveParentDir(targetDir);
    const subPath = resolveSubPath(targetDir);

    if (!groupMap.has(parentDir)) {
      groupMap.set(parentDir, { parentDir, entries: [], totalFiles: 0 });
    }
    const group = groupMap.get(parentDir)!;
    group.entries.push({ subPath, fileCount, label: def.label, status });
    group.totalFiles += fileCount;
  }

  return Array.from(groupMap.values());
}
