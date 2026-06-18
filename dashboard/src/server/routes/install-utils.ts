/**
 * Install Wizard Utilities — File operations for the Maestro install wizard.
 *
 * Manifest CRUD and paths are imported from the parent `maestro-flow` package
 * (`src/core/manifest.ts`). Both CLI `maestro install` and dashboard wizard
 * share the same manifest format and storage path (~/.maestro/manifests/).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';

// Re-export from shared core (single source of truth)
import {
  createManifest,
  saveManifest,
  findManifest,
  getAllManifests,
  addFile,
  addDir,
  paths,
  injectDocFile,
  COMPONENT_DEFS,
} from 'maestro-flow';
import type { Manifest, ManifestEntry, ComponentDef } from 'maestro-flow';
import {
  scanDisabledItems,
  restoreDisabledState,
  type DisabledItem,
} from '../../../../src/commands/install-backend.js';

export { createManifest, saveManifest, findManifest, getAllManifests, injectDocFile };
export { scanDisabledItems, restoreDisabledState };
export type { Manifest, ManifestEntry, DisabledItem };

// ---------------------------------------------------------------------------
// Dashboard-specific types
// ---------------------------------------------------------------------------

export interface ComponentInfo {
  id: string;
  label: string;
  sourceDir: string;
  targetDir: string;
  fileCount: number;
  available: boolean;
}

export interface DetectionResult {
  sourceDir: string;
  components: ComponentInfo[];
  existingManifest: Manifest | null;
  disabledItems: DisabledItem[];
}



export interface InstallResult {
  success: boolean;
  filesInstalled: number;
  dirsCreated: number;
  manifestPath: string;
  disabledItemsRestored: number;
  mcpRegistered: boolean;
  components: string[];
  error?: string;
  migrationWarnings?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAESTRO_HOME = paths.home;

/** Files to preserve during overwrite (same as src/commands/install.ts) */
const PRESERVE_FILES = new Set(['settings.json', 'settings.local.json']);

// ComponentDef and COMPONENT_DEFS imported from maestro-flow (single source of truth)

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

export function resolveSourceDir(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (typeof pkg.name === 'string' && pkg.name.includes('maestro')) {
          return dir;
        }
      } catch { /* keep walking */ }
    }
    if (existsSync(join(dir, '.claude', 'commands')) && existsSync(join(dir, 'workflows'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  const st = statSync(dir);
  if (st.isFile()) return 1;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
  }
  return count;
}

export function scanAvailableSources(
  sourceDir: string,
  mode: 'global' | 'project',
  projectPath?: string,
): ComponentInfo[] {
  return COMPONENT_DEFS.map((def) => {
    const fullSource = join(sourceDir, def.sourcePath);
    const fileCount = countFiles(fullSource);
    const targetDir = def.target(mode, projectPath ?? '');
    return {
      id: def.id,
      label: def.label,
      sourceDir: fullSource,
      targetDir,
      fileCount,
      available: fileCount > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Copy — uses shared manifest tracking from maestro-flow
// ---------------------------------------------------------------------------

export function copyDirectory(
  src: string,
  dest: string,
  manifest: Manifest,
): { files: number; dirs: number } {
  if (!existsSync(src)) return { files: 0, dirs: 0 };

  let files = 0;
  let dirs = 0;

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    dirs++;
    addDir(manifest, dest);
  }

  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Preserve settings files (same as CLI)
    if (PRESERVE_FILES.has(entry.name) && existsSync(destPath)) continue;

    if (entry.isDirectory()) {
      const sub = copyDirectory(srcPath, destPath, manifest);
      files += sub.files;
      dirs += sub.dirs;
    } else if (entry.isFile()) {
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
        dirs++;
        addDir(manifest, destDir);
      }
      copyFileSync(srcPath, destPath);
      files++;
      addFile(manifest, destPath);
    }
  }

  return { files, dirs };
}

// injectDocFile imported from maestro-flow (single source of truth)

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function createBackup(manifest: Manifest): string | null {
  const backupDir = join(MAESTRO_HOME, 'manifests', 'backups', `backup-${manifest.scope}-${Date.now()}`);

  const home = homedir();
  const homeLower = home.toLowerCase();
  let backedUp = 0;
  for (const entry of manifest.entries) {
    if (entry.type === 'file' && existsSync(entry.path)) {
      const rel = entry.path.toLowerCase().startsWith(homeLower)
        ? relative(home, entry.path)
        : entry.path.replace(/[:\\]/g, '_');
      const backupPath = join(backupDir, rel);
      const dir = dirname(backupPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      copyFileSync(entry.path, backupPath);
      backedUp++;
    }
  }

  if (backedUp === 0) return null;
  return backupDir;
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

export function getPackageVersion(sourceDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function writeVersionFile(targetDir: string, version: string): void {
  const versionPath = join(targetDir, 'version.json');
  const dir = dirname(versionPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    versionPath,
    JSON.stringify({ version, installedAt: new Date().toISOString(), installer: 'maestro-dashboard' }, null, 2),
    'utf-8',
  );
}

export { COMPONENT_DEFS, MAESTRO_HOME };
export type { ComponentDef };
