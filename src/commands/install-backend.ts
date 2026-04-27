// ---------------------------------------------------------------------------
// Pure backend functions for `maestro install` — extracted from install.ts
// for testability and reuse.
// ---------------------------------------------------------------------------

import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { paths } from '../config/paths.js';
import {
  addFile,
  addDir,
  type Manifest,
} from '../core/manifest.js';
import { applyOverlays, ensureOverlayDir } from '../core/overlay/applier.js';
import {
  HOOK_LEVELS,
  HOOK_LEVEL_DESCRIPTIONS,
  type HookLevel,
} from './hooks.js';

// ---------------------------------------------------------------------------
// ESM __dirname shim
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files to preserve during overwrite */
export const PRESERVE_FILES = new Set(['settings.json', 'settings.local.json']);

// ---------------------------------------------------------------------------
// Component definitions — single source of truth
// ---------------------------------------------------------------------------

export interface ComponentDef {
  id: string;
  label: string;
  description: string;
  sourcePath: string;
  /** Resolve target directory based on mode and project path */
  target: (mode: 'global' | 'project', projectPath: string) => string;
  /** Always installs to global location regardless of mode */
  alwaysGlobal: boolean;
}

export const COMPONENT_DEFS: ComponentDef[] = [
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Workflow definitions (~/.maestro/workflows/)',
    sourcePath: 'workflows',
    target: () => join(paths.home, 'workflows'),
    alwaysGlobal: true,
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Prompt & task templates (~/.maestro/templates/)',
    sourcePath: 'templates',
    target: () => join(paths.home, 'templates'),
    alwaysGlobal: true,
  },
  {
    id: 'chains',
    label: 'Chains',
    description: 'Coordinate chain graphs (~/.maestro/chains/)',
    sourcePath: 'chains',
    target: () => join(paths.home, 'chains'),
    alwaysGlobal: true,
  },
  {
    id: 'overlays',
    label: 'Overlays',
    description: 'Command overlay packs (~/.maestro/overlays/_shipped/)',
    sourcePath: join('overlays', '_shipped'),
    target: () => join(paths.home, 'overlays', '_shipped'),
    alwaysGlobal: true,
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'Claude Code slash commands',
    sourcePath: join('.claude', 'commands'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands'),
    alwaysGlobal: false,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Agent definitions',
    sourcePath: join('.claude', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'agents')
        : join(projectPath, '.claude', 'agents'),
    alwaysGlobal: false,
  },
  {
    id: 'skills',
    label: 'Skills',
    description: 'Claude Code skills',
    sourcePath: join('.claude', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'skills')
        : join(projectPath, '.claude', 'skills'),
    alwaysGlobal: false,
  },
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    description: 'Project instructions file',
    sourcePath: join('.claude', 'CLAUDE.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.claude', 'CLAUDE.md')
        : join(projectPath, '.claude', 'CLAUDE.md'),
    alwaysGlobal: false,
  },
  {
    id: 'codex-agents-md',
    label: 'Codex AGENTS.md',
    description: 'Codex project instructions file',
    sourcePath: join('.codex', 'AGENTS.md'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'AGENTS.md')
        : join(projectPath, '.codex', 'AGENTS.md'),
    alwaysGlobal: false,
  },
  {
    id: 'codex-agents',
    label: 'Codex Agents',
    description: 'Codex agent definitions',
    sourcePath: join('.codex', 'agents'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'agents')
        : join(projectPath, '.codex', 'agents'),
    alwaysGlobal: false,
  },
  {
    id: 'codex-skills',
    label: 'Codex Skills',
    description: 'Codex skill definitions',
    sourcePath: join('.codex', 'skills'),
    target: (mode, projectPath) =>
      mode === 'global'
        ? join(homedir(), '.codex', 'skills')
        : join(projectPath, '.codex', 'skills'),
    alwaysGlobal: false,
  },
];

// ---------------------------------------------------------------------------
// Disabled items — preserve disabled state across reinstalls
// ---------------------------------------------------------------------------

export interface DisabledItem {
  name: string;
  relativePath: string;
  type: 'skill' | 'command' | 'agent';
}

export function scanDisabledItems(targetBase: string): DisabledItem[] {
  const items: DisabledItem[] = [];

  const scanDir = (
    dir: string,
    suffix: string,
    type: DisabledItem['type'],
    isSkillDir: boolean,
  ) => {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (isSkillDir && entry.isDirectory()) {
          const disabledPath = join(dir, entry.name, 'SKILL.md.disabled');
          if (existsSync(disabledPath)) {
            items.push({
              name: entry.name,
              relativePath: relative(targetBase, disabledPath),
              type,
            });
          }
        } else if (!isSkillDir && entry.isFile() && entry.name.endsWith(suffix)) {
          items.push({
            name: entry.name.replace(suffix, ''),
            relativePath: relative(targetBase, join(dir, entry.name)),
            type,
          });
        }
      }
    } catch { /* ignore */ }
  };

  scanDir(join(targetBase, '.claude', 'skills'), '', 'skill', true);
  scanDir(join(targetBase, '.claude', 'commands'), '.md.disabled', 'command', false);
  scanDir(join(targetBase, '.claude', 'agents'), '.md.disabled', 'agent', false);
  scanDir(join(targetBase, '.codex', 'skills'), '', 'skill', true);
  scanDir(join(targetBase, '.codex', 'agents'), '.md.disabled', 'agent', false);

  return items;
}

export function restoreDisabledState(items: DisabledItem[], targetBase: string): number {
  let restored = 0;
  for (const item of items) {
    const disabledPath = join(targetBase, item.relativePath);
    const enabledPath = disabledPath.replace(/\.disabled$/, '');
    if (existsSync(enabledPath) && !existsSync(disabledPath)) {
      renameSync(enabledPath, disabledPath);
      restored++;
    }
  }
  return restored;
}

// ---------------------------------------------------------------------------
// Overlay post-install hook
// ---------------------------------------------------------------------------

/**
 * Apply all enabled overlays from ~/.maestro/overlays/ to the just-installed
 * commands. Safe no-op if the overlay dir is missing or empty. Returns the
 * number of overlays successfully applied.
 */
export function applyOverlaysPostInstall(
  scope: 'global' | 'project',
  targetBase: string,
): number {
  const overlayDir = join(paths.home, 'overlays');
  try {
    ensureOverlayDir(overlayDir);
    const report = applyOverlays({ scope, targetBase, overlayDir });
    return report.overlaysApplied;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Overlay apply error: ${msg}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// MCP config helpers
// ---------------------------------------------------------------------------

export function addMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
  enabledTools: string[],
  projectRoot?: string,
): boolean {
  const isWin = process.platform === 'win32';
  const env: Record<string, string> = {
    MAESTRO_ENABLED_TOOLS: enabledTools.join(','),
  };
  if (projectRoot) env.MAESTRO_PROJECT_ROOT = projectRoot;

  // Use the maestro-mcp binary exposed by the globally installed maestro-flow package.
  // On Windows, npm generates maestro-mcp.cmd shim resolved via cmd.exe; on Unix, it's
  // symlinked onto PATH directly.
  const serverConfig = {
    command: isWin ? 'cmd' : 'maestro-mcp',
    args: isWin ? ['/c', 'maestro-mcp'] : [],
    env,
  };

  try {
    if (scope === 'project') {
      const fp = join(projectPath, '.mcp.json');
      let mj: Record<string, unknown> = { mcpServers: {} };
      if (existsSync(fp)) {
        mj = JSON.parse(readFileSync(fp, 'utf-8'));
        if (!mj.mcpServers) mj.mcpServers = {};
      }
      (mj.mcpServers as Record<string, unknown>)['maestro-tools'] = serverConfig;
      writeFileSync(fp, JSON.stringify(mj, null, 2), 'utf-8');
    } else {
      const fp = join(homedir(), '.claude.json');
      let cc: Record<string, unknown> = { mcpServers: {} };
      if (existsSync(fp)) {
        cc = JSON.parse(readFileSync(fp, 'utf-8'));
        if (!cc.mcpServers) cc.mcpServers = {};
      }
      (cc.mcpServers as Record<string, unknown>)['maestro-tools'] = serverConfig;
      writeFileSync(fp, JSON.stringify(cc, null, 2), 'utf-8');
    }
    return true;
  } catch {
    return false;
  }
}

export function removeMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
): boolean {
  try {
    const fp = scope === 'project'
      ? join(projectPath, '.mcp.json')
      : join(homedir(), '.claude.json');

    if (!existsSync(fp)) return false;

    const data = JSON.parse(readFileSync(fp, 'utf-8')) as Record<string, unknown>;
    const servers = data.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !('maestro-tools' in servers)) return false;

    delete servers['maestro-tools'];
    writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export function getPackageRoot(): string {
  // Compiled JS at dist/src/commands/ → 3 levels up to project root
  return resolve(__dirname, '..', '..', '..');
}

export function countFiles(dir: string): number {
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

export interface ScannedComponent {
  def: ComponentDef;
  sourceFull: string;
  targetDir: string;
  fileCount: number;
  available: boolean;
}

export function scanComponents(
  pkgRoot: string,
  mode: 'global' | 'project',
  projectPath: string,
): ScannedComponent[] {
  return COMPONENT_DEFS.map((def) => {
    const sourceFull = join(pkgRoot, def.sourcePath);
    const fileCount = countFiles(sourceFull);
    const targetDir = def.target(mode, projectPath);
    return { def, sourceFull, targetDir, fileCount, available: fileCount > 0 };
  });
}

// ---------------------------------------------------------------------------
// Recursive copy with manifest tracking
// ---------------------------------------------------------------------------

export interface CopyStats {
  files: number;
  dirs: number;
  skipped: number;
}

export function copyRecursive(
  src: string,
  dest: string,
  stats: CopyStats,
  manifest: Manifest,
): void {
  const srcStat = statSync(src);

  // Single file copy (e.g. CLAUDE.md)
  if (srcStat.isFile()) {
    const destDir = dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
      stats.dirs++;
      addDir(manifest, destDir);
    }
    const destName = basename(dest);
    if (PRESERVE_FILES.has(destName) && existsSync(dest)) {
      stats.skipped++;
      return;
    }
    copyFileSync(src, dest);
    stats.files++;
    addFile(manifest, dest);
    return;
  }

  // Directory copy
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
    stats.dirs++;
    addDir(manifest, dest);
  }

  for (const entry of readdirSync(src)) {
    if (PRESERVE_FILES.has(entry) && existsSync(join(dest, entry))) {
      stats.skipped++;
      continue;
    }

    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);

    if (st.isDirectory()) {
      copyRecursive(srcPath, destPath, stats, manifest);
    } else {
      copyFileSync(srcPath, destPath);
      stats.files++;
      addFile(manifest, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function createBackup(manifest: Manifest): string | null {
  const backupDir = join(paths.home, 'manifests', 'backups', `backup-${manifest.scope}-${Date.now()}`);
  mkdirSync(backupDir, { recursive: true });

  const home = homedir();
  let backedUp = 0;
  for (const entry of manifest.entries) {
    if (entry.type === 'file' && existsSync(entry.path)) {
      const rel = entry.path.startsWith(home)
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
// Granular backup — backup specific targets before overwrite
// ---------------------------------------------------------------------------

export interface BackupOptions {
  /** Backup CLAUDE.md files before overwrite (default: true) */
  backupClaudeMd: boolean;
  /** Backup ALL files that will be replaced (default: false) */
  backupAll: boolean;
}

/**
 * Backup existing target files before installation overwrites them.
 * Returns the backup directory path, or null if nothing was backed up.
 */
export function createTargetBackup(
  components: ScannedComponent[],
  options: BackupOptions,
): string | null {
  if (!options.backupClaudeMd && !options.backupAll) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = join(paths.home, 'backups', `pre-install-${timestamp}`);
  let backedUp = 0;

  const backupFile = (filePath: string, baseDir: string) => {
    if (!existsSync(filePath)) return;
    const rel = relative(baseDir, filePath);
    const dest = join(backupDir, rel);
    const destDir = dirname(dest);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    copyFileSync(filePath, dest);
    backedUp++;
  };

  const backupDirRecursive = (dir: string, baseDir: string) => {
    if (!existsSync(dir)) return;
    const st = statSync(dir);
    if (st.isFile()) {
      backupFile(dir, baseDir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        backupDirRecursive(fullPath, baseDir);
      } else {
        backupFile(fullPath, baseDir);
      }
    }
  };

  const home = homedir();

  for (const comp of components) {
    const targetDir = comp.targetDir;
    if (options.backupAll) {
      // Backup everything in this target
      backupDirRecursive(targetDir, home);
    } else if (options.backupClaudeMd && (comp.def.id === 'claude-md' || comp.def.id === 'codex-agents-md')) {
      // Backup instruction files (CLAUDE.md and AGENTS.md)
      backupFile(targetDir, home);
    }
  }

  if (backedUp === 0) return null;
  return backupDir;
}

/**
 * Count existing files in target directories that would be overwritten.
 */
export function countExistingTargetFiles(components: ScannedComponent[]): number {
  let count = 0;
  for (const comp of components) {
    if (existsSync(comp.targetDir)) {
      count += countFiles(comp.targetDir);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// MCP tools list
// ---------------------------------------------------------------------------

export const MCP_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'read_many_files',
  'team_msg',

] as const;
