// ---------------------------------------------------------------------------
// Pure backend functions for `maestro install` — extracted from install.ts
// for testability and reuse.
// ---------------------------------------------------------------------------

import { join, dirname, resolve, relative, basename, isAbsolute } from 'node:path';
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
  cleanManifestFiles,
  deleteManifest,
  type Manifest,
} from '../core/manifest.js';
import { applyOverlays, ensureOverlayDir, deleteOverlayManifest } from '../core/overlay/applier.js';
import { injectDocFile, type MigrateResult } from '../core/tag-injector.js';
import { COMPONENT_DEFS, type ComponentDef } from '../core/component-defs.js';
import {
  HOOK_LEVELS,
  HOOK_LEVEL_DESCRIPTIONS,
  removeClaudeStatusline,
  removeMaestroHooks,
  uninstallClaudeHooks,
  uninstallCodexHooks,
  uninstallAgyHooks,
  loadClaudeSettings,
  getClaudeSettingsPath,
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

// Re-export component definitions from shared module
export { COMPONENT_DEFS, migrateComponentIds, type ComponentDef } from '../core/component-defs.js';

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
  scanDir(join(targetBase, '.codex', 'commands'), '.md.disabled', 'command', false);
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

// Toggle — re-exported from core/toggle.ts (single responsibility extraction)
export {
  scanToggleItems,
  applyToggle,
  updateManifestDisabledItems,
  type ToggleItem,
  type ToggleState,
} from '../core/toggle.js';

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

/** MCP server name used everywhere maestro registers itself. */
export const MAESTRO_MCP_SERVER_NAME = 'maestro-tools';

export function getClaudeMcpConfigPath(scope: 'global' | 'project', projectPath: string): string {
  return scope === 'project'
    ? join(projectPath, '.mcp.json')
    : join(homedir(), '.claude.json');
}

/**
 * Register the maestro MCP server in Claude's config. Returns the path that
 * was written on success, or null on failure.
 */
export function addMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
  enabledTools: string[],
  projectRoot?: string,
): string | null {
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

  const fp = getClaudeMcpConfigPath(scope, projectPath);
  try {
    let data: Record<string, unknown> = { mcpServers: {} };
    if (existsSync(fp)) {
      data = JSON.parse(readFileSync(fp, 'utf-8'));
      if (!data.mcpServers) data.mcpServers = {};
    }
    (data.mcpServers as Record<string, unknown>)[MAESTRO_MCP_SERVER_NAME] = serverConfig;
    writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
    return fp;
  } catch {
    return null;
  }
}

export function removeMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
): boolean {
  const fp = getClaudeMcpConfigPath(scope, projectPath);
  return removeMcpServerAt(fp);
}

/** Remove the maestro-tools entry from a known config file path. */
export function removeMcpServerAt(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const servers = data.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !(MAESTRO_MCP_SERVER_NAME in servers)) return false;
    delete servers[MAESTRO_MCP_SERVER_NAME];
    writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Codex MCP config helpers (TOML-based)
// ---------------------------------------------------------------------------

function getCodexConfigPath(scope: 'global' | 'project', projectPath: string): string {
  return scope === 'project'
    ? join(projectPath, '.codex', 'config.toml')
    : join(homedir(), '.codex', 'config.toml');
}

/**
 * Remove the `[mcp_servers.maestro-tools]` and `[mcp_servers.maestro-tools.env]`
 * sections from a TOML string. Returns the cleaned content.
 *
 * Line-by-line parsing — robust against bracket characters inside values
 * (e.g. `args = ["/c", "maestro-mcp"]`), which previously broke a regex-based
 * implementation and left stale blocks behind, producing duplicate-key errors.
 */
function removeCodexMcpBlock(content: string): string {
  // A TOML table header starts at column 0 with `[` (or `[[` for arrays of tables)
  // and is the only token on the line aside from optional trailing whitespace/comment.
  const tableHeaderRe = /^\[\[?[^\]]+\]\]?\s*(?:#.*)?$/;
  const maestroHeaderRe = /^\[mcp_servers\.maestro-tools(?:\.[^\]]+)?\]\s*(?:#.*)?$/;

  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (tableHeaderRe.test(line)) {
      // Entering a new section — decide whether to skip it
      skipping = maestroHeaderRe.test(line);
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }

  // Collapse 3+ consecutive blank lines left behind by removal
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function addCodexMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
  enabledTools: string[],
  projectRoot?: string,
): string | null {
  const isWin = process.platform === 'win32';
  const fp = getCodexConfigPath(scope, projectPath);

  try {
    let content = '';
    if (existsSync(fp)) {
      content = readFileSync(fp, 'utf-8');
    }

    // Remove existing maestro-tools block
    content = removeCodexMcpBlock(content);

    // Build TOML block
    const command = isWin ? 'cmd' : 'maestro-mcp';
    const args = isWin ? '["/c", "maestro-mcp"]' : '[]';
    const envLines = [`MAESTRO_ENABLED_TOOLS = "${enabledTools.join(',')}"`];
    if (projectRoot) {
      envLines.push(`MAESTRO_PROJECT_ROOT = "${projectRoot.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }

    const block = [
      '',
      `[mcp_servers.maestro-tools]`,
      `command = "${command}"`,
      `args = ${args}`,
      '',
      `[mcp_servers.maestro-tools.env]`,
      ...envLines,
    ].join('\n');

    content = content ? content + '\n' + block + '\n' : block.trimStart() + '\n';

    // Ensure parent directory exists
    const dir = join(fp, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fp, content, 'utf-8');
    return fp;
  } catch {
    return null;
  }
}

export function removeCodexMcpServer(
  scope: 'global' | 'project',
  projectPath: string,
): boolean {
  return removeCodexMcpServerAt(getCodexConfigPath(scope, projectPath));
}

export function removeCodexMcpServerAt(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const original = readFileSync(configPath, 'utf-8');
    const cleaned = removeCodexMcpBlock(original);
    if (cleaned === original.trim()) return false;
    writeFileSync(configPath, cleaned + '\n', 'utf-8');
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

export function countFilesFiltered(dir: string, filter: (name: string) => boolean): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!filter(entry.name)) continue;
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
    const countDir = def.sourceCountDir ? join(pkgRoot, def.sourceCountDir) : sourceFull;
    const fileCount = def.fileFilter
      ? countFilesFiltered(countDir, def.fileFilter)
      : countFiles(countDir);
    const targetDir = def.target(mode, projectPath);
    return { def, sourceFull, targetDir, fileCount, available: fileCount > 0 };
  });
}

// Re-export CopyStats from shared core
export type { CopyStats } from '../core/tag-injector.js';
import type { CopyStats } from '../core/tag-injector.js';

// ---------------------------------------------------------------------------
// Recursive copy with manifest tracking
// ---------------------------------------------------------------------------

export function copyRecursive(
  src: string,
  dest: string,
  stats: CopyStats,
  manifest: Manifest,
  fileFilter?: (name: string) => boolean,
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
    if (fileFilter && !fileFilter(entry)) continue;
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

// Re-export injectDocFile from shared core
export { injectDocFile, type MigrateResult } from '../core/tag-injector.js';

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function createBackup(manifest: Manifest): string | null {
  const backupDir = join(paths.home, 'manifests', 'backups', `backup-${manifest.scope}-${Date.now()}`);

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
    let rel = relative(baseDir, filePath);
    // On Windows, relative() returns an absolute path when paths are on different drives.
    // Strip the drive letter colon to make it a valid relative path (e.g. "D:\foo" → "D\foo").
    if (isAbsolute(rel)) {
      rel = rel.replace(/^([a-zA-Z]):/, '$1');
    }
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
  'store_knowhow',
] as const;

// ---------------------------------------------------------------------------
// Generic MCP server install — opt-in CLI/IDE targets
//
// Three formats based on consumer:
//   - JSON_MCP_SERVERS: top-level `mcpServers` key, own mcp.json file
//     (Cursor, Qoder, Trae, Kiro, Roo Code, Claude `.mcp.json`)
//   - JSON_VSCODE_SERVERS: top-level `servers` key with `type: "stdio"`
//     (VS Code Copilot `.vscode/mcp.json`)
//   - JSON_GEMINI_MERGE: merge `mcpServers` into existing settings.json
//     (Gemini CLI `.gemini/settings.json`)
//
// Resolved per target — see EXTRA_MCP_TARGETS below.
// ---------------------------------------------------------------------------

export type ExtraMcpTargetId =
  | 'cursor' | 'qoder' | 'trae' | 'kiro' | 'roo'
  | 'vscode-copilot' | 'gemini-cli';

export type McpFormat = 'json-mcpServers' | 'json-vscode-servers' | 'json-gemini-merge';

interface ExtraMcpTargetSpec {
  id: ExtraMcpTargetId;
  label: string;
  format: McpFormat;
  /** Returns the config file path, or null when scope is unsupported. */
  configPath: (scope: 'global' | 'project', projectPath: string) => string | null;
}

export const EXTRA_MCP_TARGETS: ExtraMcpTargetSpec[] = [
  {
    id: 'cursor',
    label: 'Cursor (.cursor/mcp.json)',
    format: 'json-mcpServers',
    configPath: (scope, p) => scope === 'project'
      ? join(p, '.cursor', 'mcp.json')
      : join(homedir(), '.cursor', 'mcp.json'),
  },
  {
    id: 'qoder',
    label: 'Qoder (<proj>/mcp.json — Settings → MCP)',
    format: 'json-mcpServers',
    configPath: (scope, p) => scope === 'project'
      // Qoder uses root-level mcp.json (no leading dot) per their docs
      ? join(p, 'mcp.json')
      // Global config lives under SharedClientCache; we write the canonical path,
      // even though Qoder UI commonly bootstraps this on first launch.
      : join(homedir(), '.qoder', 'SharedClientCache', 'mcp.json'),
  },
  {
    id: 'trae',
    label: 'Trae (.mcp.json)',
    format: 'json-mcpServers',
    configPath: (scope, p) => scope === 'project'
      ? join(p, '.mcp.json')
      : join(homedir(), '.trae', 'mcp.json'),
  },
  {
    id: 'kiro',
    label: 'Kiro (.kiro/settings/mcp.json)',
    format: 'json-mcpServers',
    configPath: (scope, p) => scope === 'project'
      ? join(p, '.kiro', 'settings', 'mcp.json')
      : join(homedir(), '.kiro', 'settings', 'mcp.json'),
  },
  {
    id: 'roo',
    label: 'Roo Code (.roo/mcp.json)',
    format: 'json-mcpServers',
    // Roo Code global config lives inside VS Code globalStorage — skip global
    // (users almost always want project-level). Project = .roo/mcp.json.
    configPath: (scope, p) => scope === 'project' ? join(p, '.roo', 'mcp.json') : null,
  },
  {
    id: 'vscode-copilot',
    label: 'VS Code Copilot (.vscode/mcp.json)',
    format: 'json-vscode-servers',
    configPath: (scope, p) => scope === 'project'
      ? join(p, '.vscode', 'mcp.json')
      // User-profile mcp.json — location varies by OS, command-driven in VS Code.
      // We target the canonical app-data folder.
      : process.platform === 'win32'
        ? join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')
        : process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
          : join(homedir(), '.config', 'Code', 'User', 'mcp.json'),
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI (.gemini/settings.json)',
    format: 'json-gemini-merge',
    configPath: (scope, p) => scope === 'project'
      ? join(p, '.gemini', 'settings.json')
      : join(homedir(), '.gemini', 'settings.json'),
  },
];

function buildServerConfig(
  enabledTools: string[],
  projectRoot: string | undefined,
  format: McpFormat,
): Record<string, unknown> {
  const isWin = process.platform === 'win32';
  const env: Record<string, string> = {
    MAESTRO_ENABLED_TOOLS: enabledTools.join(','),
  };
  if (projectRoot) env.MAESTRO_PROJECT_ROOT = projectRoot;

  const base: Record<string, unknown> = {
    command: isWin ? 'cmd' : 'maestro-mcp',
    args: isWin ? ['/c', 'maestro-mcp'] : [],
    env,
  };

  if (format === 'json-vscode-servers') {
    return { type: 'stdio', ...base };
  }
  return base;
}

export function getExtraMcpTargetSpec(targetId: ExtraMcpTargetId): ExtraMcpTargetSpec | undefined {
  return EXTRA_MCP_TARGETS.find((t) => t.id === targetId);
}

export function addExtraMcpServer(
  targetId: ExtraMcpTargetId,
  scope: 'global' | 'project',
  projectPath: string,
  enabledTools: string[],
  projectRoot?: string,
): string | null {
  const spec = getExtraMcpTargetSpec(targetId);
  if (!spec) return null;
  const fp = spec.configPath(scope, projectPath);
  if (!fp) return null;

  try {
    const dir = dirname(fp);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const serverConfig = buildServerConfig(enabledTools, projectRoot, spec.format);
    const containerKey = spec.format === 'json-vscode-servers' ? 'servers' : 'mcpServers';

    let data: Record<string, unknown> = {};
    if (existsSync(fp)) {
      try {
        data = JSON.parse(readFileSync(fp, 'utf-8'));
      } catch {
        // Corrupt JSON — back up before overwriting
        try {
          const backupPath = `${fp}.bak.${Date.now()}`;
          writeFileSync(backupPath, readFileSync(fp, 'utf-8'));
        } catch { /* best-effort */ }
        data = {};
      }
    }
    if (!data[containerKey] || typeof data[containerKey] !== 'object') {
      data[containerKey] = {};
    }
    (data[containerKey] as Record<string, unknown>)[MAESTRO_MCP_SERVER_NAME] = serverConfig;
    writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
    return fp;
  } catch {
    return null;
  }
}

export function removeExtraMcpServer(
  targetId: ExtraMcpTargetId,
  scope: 'global' | 'project',
  projectPath: string,
): boolean {
  const spec = getExtraMcpTargetSpec(targetId);
  if (!spec) return false;
  const fp = spec.configPath(scope, projectPath);
  if (!fp) return false;
  return removeExtraMcpServerAt(fp, spec.format);
}

export function removeExtraMcpServerAt(configPath: string, format: McpFormat): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const containerKey = format === 'json-vscode-servers' ? 'servers' : 'mcpServers';
    const servers = data[containerKey] as Record<string, unknown> | undefined;
    if (!servers || !(MAESTRO_MCP_SERVER_NAME in servers)) return false;
    delete servers[MAESTRO_MCP_SERVER_NAME];
    writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Unified uninstall — single source of truth for reversing a manifest
//
// Reads every tracking field on the manifest and undoes exactly what was
// installed. No marker scanning — manifest is authoritative.
// ---------------------------------------------------------------------------

export interface UninstallResult {
  filesRemoved: number;
  filesSkipped: number;
  claudeHooksRemoved: number;
  codexHooksRemoved: number;
  agyHooksRemoved: number;
  statuslineRemoved: boolean;
  mcpRemoved: { claude: boolean; codex: boolean; extras: string[] };
}

export interface UninstallOptions {
  /**
   * Skip CONTENT_MANAGED files (CLAUDE.md, AGENTS.md). Used when uninstalling
   * before a re-install — tag injection updates these in place, so cleanup
   * would lose user content.
   */
  skipContentManaged?: boolean;
  /**
   * Skip deletion of the manifest file itself. Useful when the caller wants
   * to mutate and re-save the manifest as part of a re-install.
   */
  keepManifestFile?: boolean;
}

/**
 * Reverse everything a manifest installed: files, hooks, statusline, MCP.
 *
 * Falls back to legacy "scan for `maestro` marker" cleanup for old manifests
 * (schema < 2.0) that don't have hooks/mcp/statusline records.
 */
export function uninstallManifest(
  manifest: Manifest,
  opts: UninstallOptions = {},
): UninstallResult {
  const result: UninstallResult = {
    filesRemoved: 0,
    filesSkipped: 0,
    claudeHooksRemoved: 0,
    codexHooksRemoved: 0,
    agyHooksRemoved: 0,
    statuslineRemoved: false,
    mcpRemoved: { claude: false, codex: false, extras: [] },
  };

  // --- Files ---
  const fileResult = cleanManifestFiles(manifest, { skipContentManaged: opts.skipContentManaged });
  result.filesRemoved = fileResult.removed;
  result.filesSkipped = fileResult.skipped;

  // --- Overlays ---
  const targetBase = manifest.scope === 'global' ? homedir() : manifest.targetPath;
  try { deleteOverlayManifest(manifest.scope, targetBase); } catch { /* skip */ }

  // --- Hooks (precise removal from manifest records) ---
  const hooks = manifest.hooks;
  if (hooks?.claude) {
    result.claudeHooksRemoved = uninstallClaudeHooks(hooks.claude.settingsPath, hooks.claude.installed);
  }
  if (hooks?.codex) {
    result.codexHooksRemoved = uninstallCodexHooks(hooks.codex.settingsPath, hooks.codex.installed);
  }
  if (hooks?.agy) {
    result.agyHooksRemoved = uninstallAgyHooks(hooks.agy.settingsPath, hooks.agy.installed);
  }

  // --- Statusline ---
  if (manifest.statusline) {
    result.statuslineRemoved = removeClaudeStatusline(manifest.statusline.settingsPath);
  }

  // --- MCP ---
  if (manifest.mcp?.claude) {
    result.mcpRemoved.claude = removeMcpServerAt(manifest.mcp.claude.configPath);
  }
  if (manifest.mcp?.codex) {
    result.mcpRemoved.codex = removeCodexMcpServerAt(manifest.mcp.codex.configPath);
  }
  if (manifest.mcp?.extras) {
    for (const extra of manifest.mcp.extras) {
      const spec = getExtraMcpTargetSpec(extra.targetId as ExtraMcpTargetId);
      if (!spec) continue;
      if (removeExtraMcpServerAt(extra.configPath, spec.format)) {
        result.mcpRemoved.extras.push(extra.targetId);
      }
    }
  }

  // --- Legacy fallback ---
  // For old manifests (no hooks/mcp/statusline records), fall back to broad
  // cleanup so reinstall/uninstall still works on upgrade.
  const hasNewRecords = manifest.hooks || manifest.statusline || manifest.mcp;
  if (!hasNewRecords) {
    legacyCleanup(manifest, result);
  }

  // --- Manifest file ---
  if (!opts.keepManifestFile) {
    deleteManifest(manifest);
  }

  return result;
}

/**
 * Legacy cleanup for manifests without explicit hooks/mcp/statusline records.
 * Uses the old marker-scan approach so upgrade users aren't stranded.
 */
function legacyCleanup(manifest: Manifest, result: UninstallResult): void {
  // Claude settings — strip all maestro hooks + statusline (full scan)
  const settingsPath = manifest.scope === 'global'
    ? getClaudeSettingsPath()
    : join(manifest.targetPath, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    if (removeClaudeStatusline(settingsPath)) result.statuslineRemoved = true;
    try {
      const settings = loadClaudeSettings(settingsPath);
      const before = JSON.stringify(settings.hooks ?? {});
      removeMaestroHooks(settings); // no whitelist → strip everything containing "maestro"
      const after = JSON.stringify(settings.hooks ?? {});
      if (before !== after) result.claudeHooksRemoved++;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch { /* skip */ }
  }

  // Claude MCP (project-level .mcp.json or global .claude.json)
  if (removeMcpServer(manifest.scope, manifest.targetPath)) {
    result.mcpRemoved.claude = true;
  }
}
