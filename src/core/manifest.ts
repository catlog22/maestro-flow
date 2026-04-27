// ---------------------------------------------------------------------------
// Installation Manifest
// Tracks installed files for clean reinstall and uninstall.
// Manifests stored at ~/.maestro/manifests/{id}.json
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { paths } from '../config/paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  path: string;
  type: 'file' | 'dir';
}

export interface Manifest {
  id: string;
  version: string;
  scope: 'global' | 'project';
  targetPath: string;
  installedAt: string;
  entries: ManifestEntry[];
  /** Hook level configured during install (none/minimal/standard/full) */
  hookLevel?: string;
  /** Component IDs selected during interactive install (omitted = all) */
  selectedComponentIds?: string[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MANIFESTS_DIR = join(paths.home, 'manifests');

function ensureDir(): void {
  if (!existsSync(MANIFESTS_DIR)) {
    mkdirSync(MANIFESTS_DIR, { recursive: true });
  }
}

function manifestFile(id: string): string {
  return join(MANIFESTS_DIR, `${id}.json`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createManifest(
  scope: 'global' | 'project',
  targetPath: string,
  opts?: { hookLevel?: string; selectedComponentIds?: string[] },
): Manifest {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
  return {
    id: `${scope}-${ts}`,
    version: '1.0',
    scope,
    targetPath,
    installedAt: new Date().toISOString(),
    entries: [],
    hookLevel: opts?.hookLevel,
    selectedComponentIds: opts?.selectedComponentIds,
  };
}

export function addFile(manifest: Manifest, filePath: string): void {
  manifest.entries.push({ path: filePath, type: 'file' });
}

export function addDir(manifest: Manifest, dirPath: string): void {
  manifest.entries.push({ path: dirPath, type: 'dir' });
}

export function saveManifest(manifest: Manifest): string {
  ensureDir();
  // Remove old manifests for same scope+path
  removeOld(manifest.scope, manifest.targetPath);
  const fp = manifestFile(manifest.id);
  writeFileSync(fp, JSON.stringify(manifest, null, 2), 'utf-8');
  return fp;
}

function removeOld(scope: string, targetPath: string): void {
  if (!existsSync(MANIFESTS_DIR)) return;
  const norm = targetPath.toLowerCase().replace(/[\\/]+$/, '');
  for (const f of readdirSync(MANIFESTS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const m = JSON.parse(readFileSync(join(MANIFESTS_DIR, f), 'utf-8')) as Manifest;
      if (m.scope === scope && m.targetPath.toLowerCase().replace(/[\\/]+$/, '') === norm) {
        unlinkSync(join(MANIFESTS_DIR, f));
      }
    } catch { /* skip */ }
  }
}

export function findManifest(scope: 'global' | 'project', targetPath: string): Manifest | null {
  if (!existsSync(MANIFESTS_DIR)) return null;
  const norm = targetPath.toLowerCase().replace(/[\\/]+$/, '');
  for (const f of readdirSync(MANIFESTS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const m = JSON.parse(readFileSync(join(MANIFESTS_DIR, f), 'utf-8')) as Manifest;
      m.entries ??= [];
      if (m.scope === scope && m.targetPath.toLowerCase().replace(/[\\/]+$/, '') === norm) {
        return m;
      }
    } catch { /* skip */ }
  }
  return null;
}

export function getAllManifests(): Manifest[] {
  if (!existsSync(MANIFESTS_DIR)) return [];
  const results: Manifest[] = [];
  for (const f of readdirSync(MANIFESTS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const m = JSON.parse(readFileSync(join(MANIFESTS_DIR, f), 'utf-8')) as Manifest;
      m.entries ??= [];
      // Skip corrupt manifests (no targetPath or no entries)
      if (!m.targetPath || !m.scope) {
        unlinkSync(join(MANIFESTS_DIR, f));
        continue;
      }
      results.push(m);
    } catch { /* skip */ }
  }
  return results.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
}

export function deleteManifest(manifest: Manifest): void {
  const fp = manifestFile(manifest.id);
  if (existsSync(fp)) unlinkSync(fp);
}

// ---------------------------------------------------------------------------
// Cleanup — remove files recorded in a manifest
// ---------------------------------------------------------------------------

/** Files to preserve even during cleanup. */
const PRESERVE = new Set(['settings.json', 'settings.local.json']);

/** Files that should have maestro content removed instead of being deleted entirely. */
const CONTENT_MANAGED = new Set(['CLAUDE.md']);

/** Maestro-specific line patterns in CLAUDE.md */
const MAESTRO_LINE_PATTERNS = [
  /^#\s*Maestro\s*$/i,
  /maestro/i,
  /~\/\.maestro\//,
  /mcp__ide__getDiagnostics/,
  /cli-tools\.json/,
];

/**
 * Remove maestro-added content from CLAUDE.md instead of deleting the file.
 *
 * Strategy:
 * - Read source CLAUDE.md content that was installed by maestro
 * - Compare with existing file to determine if it's maestro-only or mixed
 * - If file matches maestro source content → safe to delete
 * - If file has user additions → remove only maestro-originated lines
 */
function cleanClaudeMd(filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Filter out lines that are maestro-specific
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return true; // keep blank lines
    return !MAESTRO_LINE_PATTERNS.some(p => p.test(trimmed));
  });

  // Check if remaining content is empty (only whitespace/blank lines)
  const meaningful = filteredLines.filter(l => l.trim().length > 0);
  if (meaningful.length === 0) {
    // File only had maestro content — safe to delete
    unlinkSync(filePath);
    return true;
  }

  // If nothing was actually removed, leave as-is
  if (filteredLines.length === lines.length) return false;

  // Has user content — write back without maestro lines
  const cleaned = filteredLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
  writeFileSync(filePath, cleaned, 'utf-8');
  return true;
}

export function cleanManifestFiles(manifest: Manifest): { removed: number; skipped: number } {
  let removed = 0;
  let skipped = 0;

  // Remove files first (deepest paths first)
  const files = manifest.entries
    .filter(e => e.type === 'file')
    .sort((a, b) => b.path.length - a.path.length);

  for (const entry of files) {
    const name = entry.path.split(/[\\/]/).pop() ?? '';
    if (PRESERVE.has(name)) { skipped++; continue; }

    // Content-managed files: remove added content instead of deleting
    if (CONTENT_MANAGED.has(name)) {
      try {
        if (cleanClaudeMd(entry.path)) removed++;
      } catch { /* skip */ }
      continue;
    }

    try {
      if (existsSync(entry.path)) {
        unlinkSync(entry.path);
        removed++;
      }
    } catch { /* skip */ }
  }

  // Remove empty directories (deepest first)
  const dirs = manifest.entries
    .filter(e => e.type === 'dir')
    .sort((a, b) => b.path.length - a.path.length);

  for (const entry of dirs) {
    try {
      if (existsSync(entry.path)) {
        const contents = readdirSync(entry.path);
        if (contents.length === 0) {
          rmSync(entry.path, { recursive: true });
          removed++;
        }
      }
    } catch { /* skip */ }
  }

  return { removed, skipped };
}
