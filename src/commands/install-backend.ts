// ---------------------------------------------------------------------------
// Pure backend functions for `maestro install` — extracted from install.ts
// for testability and reuse.
// ---------------------------------------------------------------------------

import { join, dirname, resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmSync,
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
import { injectDocFile, hasAnyMarkers, removeAllSections, type MigrateResult } from '../core/tag-injector.js';
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
export { COMPONENT_DEFS, migrateComponentIds, mergeNewDefaults, type ComponentDef } from '../core/component-defs.js';

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

interface TomlPrimitiveEntry {
  key: string;
  value: string;
  comments?: string[];
}

/**
 * Update primitive keys inside one TOML table without parsing or reserializing
 * the rest of the user's file. Unknown tables, keys, ordering, and comments
 * remain byte-for-byte unchanged apart from newline normalization.
 */
function upsertTomlTable(
  content: string,
  tableName: string,
  entries: TomlPrimitiveEntry[],
): string {
  const lines = content ? content.split(/\r?\n/) : [];
  const tableHeader = `[${tableName}]`;
  const escapedHeader = tableHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerPattern = new RegExp(`^\\s*${escapedHeader}\\s*(?:#.*)?$`);
  const headerIndex = lines.findIndex((line) => headerPattern.test(line));

  if (headerIndex < 0) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(tableHeader);
    for (const entry of entries) {
      for (const comment of entry.comments ?? []) lines.push(`# ${comment}`);
      lines.push(`${entry.key} = ${entry.value}`);
    }
    return lines.join('\n');
  }

  const anyHeader = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/;
  let sectionEnd = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (anyHeader.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  for (const entry of entries) {
    const keyPattern = new RegExp(`^(\\s*${entry.key}\\s*=\\s*)[^#]*(\\s+#.*)?$`);
    let existingIndex = -1;
    for (let i = headerIndex + 1; i < sectionEnd; i++) {
      if (keyPattern.test(lines[i])) {
        existingIndex = i;
        break;
      }
    }

    if (existingIndex >= 0) {
      const match = lines[existingIndex].match(keyPattern);
      lines[existingIndex] = `${match?.[1] ?? `${entry.key} = `}${entry.value}${match?.[2] ?? ''}`;
      continue;
    }

    const addition = [
      ...(entry.comments ?? []).map((comment) => `# ${comment}`),
      `${entry.key} = ${entry.value}`,
    ];
    lines.splice(sectionEnd, 0, ...addition);
    sectionEnd += addition.length;
  }

  return lines.join('\n');
}

/**
 * Enable Codex request-user-input and Multi-Agent V2 defaults. This is an
 * additive user preference: install updates it, uninstall never removes it.
 */
export function configureCodexMultiAgentV2(
  scope: 'global' | 'project',
  projectPath: string,
): string | null {
  const fp = getCodexConfigPath(scope, projectPath);
  const tempPath = `${fp}.maestro-${process.pid}-${Date.now()}.tmp`;
  try {
    let content = existsSync(fp) ? readFileSync(fp, 'utf-8') : '';
    content = upsertTomlTable(content, 'features', [
      {
        key: 'default_mode_request_user_input',
        value: 'true',
        comments: ['Allow request_user_input in the default mode.'],
      },
      {
        key: 'multi_agents_v2',
        value: 'true',
        comments: ['Enable the Codex Multi-Agent V2 feature.'],
      },
    ]);
    content = upsertTomlTable(content, 'features.multi_agent_v2', [
      {
        key: 'enabled',
        value: 'true',
        comments: ['Enable V2 fallback for models without an explicit protocol.'],
      },
      {
        key: 'hide_spawn_agent_metadata',
        value: 'false',
        comments: ['Keep spawn metadata visible; Codex defaults this option to true.'],
      },
      {
        key: 'tool_namespace',
        value: '"maestro"',
        comments: ['Avoid the reserved collaboration namespace used by newer Codex models.'],
      },
      {
        key: 'max_concurrent_threads_per_session',
        value: '7',
        comments: ['One primary agent plus up to six concurrent sub-agents.'],
      },
      {
        key: 'min_wait_timeout_ms',
        value: '180000',
        comments: ['Minimum wait_agent timeout: 3 minutes.'],
      },
      {
        key: 'default_wait_timeout_ms',
        value: '180000',
        comments: ['Default wait_agent timeout: 3 minutes.'],
      },
      {
        key: 'max_wait_timeout_ms',
        value: '3600000',
        comments: ['Maximum wait_agent timeout: 1 hour.'],
      },
    ]);

    const dir = join(fp, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tempPath, content.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
    renameSync(tempPath, fp);
    return fp;
  } catch {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    return null;
  }
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

/**
 * Remove files in `dest` that do not exist in `src` (after applying the same
 * fileFilter). Prevents stale files from accumulating across installs when
 * source commands/skills/agents are deleted or merged.
 *
 * Only operates on flat or shallow directories — walks recursively but
 * respects PRESERVE_FILES and never removes non-empty directories.
 */
export function pruneOrphans(
  src: string,
  dest: string,
  fileFilter?: (name: string) => boolean,
): number {
  if (!existsSync(dest) || !existsSync(src)) return 0;
  const srcStat = statSync(src);
  if (srcStat.isFile()) return 0;

  const sourceEntries = new Set(
    readdirSync(src).filter(name => !fileFilter || fileFilter(name)),
  );

  let removed = 0;
  for (const entry of readdirSync(dest)) {
    if (PRESERVE_FILES.has(entry)) continue;
    if (entry.endsWith('.md.disabled')) continue;
    if (sourceEntries.has(entry)) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (statSync(srcPath).isDirectory() && existsSync(destPath) && statSync(destPath).isDirectory()) {
        // fileFilter classifies top-level component roots only. Applying it to
        // nested SKILL.md/references/assets entries corrupts valid components.
        removed += pruneOrphans(srcPath, destPath);
      }
      continue;
    }
    const orphanPath = join(dest, entry);
    try {
      const st = statSync(orphanPath);
      if (st.isDirectory()) {
        rmSync(orphanPath, { recursive: true });
      } else {
        unlinkSync(orphanPath);
      }
      removed++;
    } catch { /* skip */ }
  }
  return removed;
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
  genericHooksRemoved: Record<string, number>;
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
    genericHooksRemoved: {},
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
  if (hooks?.generic) {
    for (const [platformId, record] of Object.entries(hooks.generic)) {
      result.genericHooksRemoved[platformId] = uninstallCodexHooks(record.settingsPath, record.installed);
    }
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

  // --- Plugin unregistration ---
  if (manifest.plugin?.claude || manifest.plugin?.codex) {
    const isWin = process.platform === 'win32';
    const runCli = (cmd: string, args: string[]) => {
      try {
        execFileSync(isWin ? 'cmd' : cmd, isWin ? ['/c', cmd, ...args] : args,
          { encoding: 'utf-8', timeout: 30_000, stdio: 'pipe' });
      } catch { /* ignore CLI errors */ }
    };
    if (manifest.plugin.claude) {
      runCli('claude', ['plugin', 'uninstall', 'maestro-flow']);
      runCli('claude', ['plugin', 'marketplace', 'remove', 'maestro-flow-bridge']);
    }
    if (manifest.plugin.codex) {
      runCli('codex', ['plugin', 'remove', 'maestro-flow']);
      runCli('codex', ['plugin', 'marketplace', 'remove', 'maestro-flow-bridge']);
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

// ---------------------------------------------------------------------------
// Fallback scan & cleanup — when no manifests exist but files remain
// ---------------------------------------------------------------------------

/** Files to preserve during fallback cleanup. */
const FALLBACK_PRESERVE = new Set(['settings.json', 'settings.local.json']);

/** Content-managed doc files: remove maestro sections, don't delete entirely. */
const FALLBACK_CONTENT_MANAGED = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);

export interface FallbackScanResult {
  /** Unique target directories that contain files. */
  directories: { path: string; fileCount: number }[];
  hooksFound: boolean;
  statuslineFound: boolean;
  claudeMcpFound: boolean;
  codexMcpFound: boolean;
  totalFiles: number;
}

/**
 * Scan known maestro target directories for orphaned files when no manifests
 * exist. Uses COMPONENT_DEFS to derive the exact set of directories that
 * maestro install would populate.
 */
export function scanFallbackTargets(
  scope: 'global' | 'project',
  projectPath: string,
): FallbackScanResult {
  const result: FallbackScanResult = {
    directories: [],
    hooksFound: false,
    statuslineFound: false,
    claudeMcpFound: false,
    codexMcpFound: false,
    totalFiles: 0,
  };

  // Collect unique target directories from COMPONENT_DEFS
  const seen = new Set<string>();
  for (const def of COMPONENT_DEFS) {
    const dir = def.target(scope, projectPath);
    const norm = dir.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!existsSync(dir)) continue;
    const st = statSync(dir);
    if (st.isFile()) {
      // inject targets point to a file (e.g. CLAUDE.md)
      result.directories.push({ path: dir, fileCount: 1 });
      result.totalFiles += 1;
    } else {
      const count = countFiles(dir);
      if (count > 0) {
        result.directories.push({ path: dir, fileCount: count });
        result.totalFiles += count;
      }
    }
  }

  // Check Claude hooks + statusline
  const settingsPath = scope === 'global'
    ? getClaudeSettingsPath()
    : join(projectPath, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, 'utf-8');
      result.hooksFound = content.includes('maestro') && content.includes('hooks');
      result.statuslineFound = content.includes('statusLine') && content.includes('maestro');
    } catch { /* skip */ }
  }

  // Check Claude MCP (parse JSON for exact key match)
  const mcpPath = getClaudeMcpConfigPath(scope, projectPath);
  if (existsSync(mcpPath)) {
    try {
      const data = JSON.parse(readFileSync(mcpPath, 'utf-8')) as Record<string, unknown>;
      const servers = data.mcpServers as Record<string, unknown> | undefined;
      result.claudeMcpFound = !!servers && MAESTRO_MCP_SERVER_NAME in servers;
    } catch { /* skip */ }
  }

  // Check Codex MCP (match TOML section header exactly, not substring)
  const codexConfigPath = scope === 'project'
    ? join(projectPath, '.codex', 'config.toml')
    : join(homedir(), '.codex', 'config.toml');
  if (existsSync(codexConfigPath)) {
    try {
      const content = readFileSync(codexConfigPath, 'utf-8');
      result.codexMcpFound = content.includes(`[mcp_servers.${MAESTRO_MCP_SERVER_NAME}]`);
    } catch { /* skip */ }
  }

  return result;
}

/**
 * Walk a source directory and build a Set of corresponding target paths.
 * Used by fallback cleanup to distinguish maestro-managed files from
 * user-added content (e.g. custom workflows like Maestro-publish).
 */
function buildKnownPaths(
  sourceDir: string,
  targetDir: string,
  fileFilter?: (name: string) => boolean,
): Set<string> {
  const paths = new Set<string>();
  if (!existsSync(sourceDir)) return paths;

  function walk(currentSource: string, currentTarget: string): void {
    const st = statSync(currentSource);
    if (st.isFile()) {
      paths.add(currentTarget);
      return;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(currentSource, { withFileTypes: true })) {
        if (fileFilter && !fileFilter(entry.name)) continue;
        walk(join(currentSource, entry.name), join(currentTarget, entry.name));
      }
    }
  }

  walk(sourceDir, targetDir);
  return paths;
}

/**
 * Recursively remove all files in a directory, respecting PRESERVE and
 * CONTENT_MANAGED rules. Returns count of files removed.
 *
 * When `knownFiles` is provided, only files whose absolute path appears in
 * the set are eligible for deletion — user-added content is left untouched.
 * Directories are only removed if empty after cleaning.
 */
function cleanDirectory(dir: string, knownFiles?: Set<string>): number {
  if (!existsSync(dir)) return 0;
  const st = statSync(dir);

  // Single file (e.g. inject target like CLAUDE.md)
  if (st.isFile()) {
    const name = basename(dir);
    if (FALLBACK_PRESERVE.has(name)) return 0;
    if (FALLBACK_CONTENT_MANAGED.has(name)) {
      return cleanContentManagedFile(dir) ? 1 : 0;
    }
    if (knownFiles && !knownFiles.has(dir)) return 0;
    try { unlinkSync(dir); return 1; } catch { return 0; }
  }

  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (FALLBACK_PRESERVE.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Pass knownFiles through — subdirectories use the same white-list
      removed += cleanDirectory(fullPath, knownFiles);
      // Remove empty directory after cleaning
      try {
        if (existsSync(fullPath) && readdirSync(fullPath).length === 0) {
          rmSync(fullPath, { recursive: true });
        }
      } catch { /* skip */ }
    } else if (FALLBACK_CONTENT_MANAGED.has(entry.name)) {
      // Content-managed files (CLAUDE.md, AGENTS.md, GEMINI.md): clean
      // injected sections even when knownFiles doesn't cover them —
      // tag-injection cleanup is safe regardless.
      if (cleanContentManagedFile(fullPath)) removed++;
    } else {
      // Unknown files: skip when white-list is active
      if (knownFiles && !knownFiles.has(fullPath)) continue;
      try { unlinkSync(fullPath); removed++; } catch { /* skip */ }
    }
  }
  return removed;
}

function cleanContentManagedFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!hasAnyMarkers(content)) {
      unlinkSync(filePath);
      return true;
    }
    const cleaned = removeAllSections(content);
    if (!cleaned || cleaned.trim() === '') {
      unlinkSync(filePath);
      return true;
    }
    writeFileSync(filePath, cleaned, 'utf-8');
    return true;
  } catch { return false; }
}

/**
 * Perform a manifest-less cleanup of all known maestro target directories,
 * hooks, MCP, and statusline. Used as fallback when manifests are lost.
 *
 * When `pkgRoot` is provided, source directories are scanned to build a
 * white-list of known (maestro-managed) target paths. Only files matching
 * the white-list are deleted — user-added content (e.g. custom workflows
 * like Maestro-publish) is left untouched.
 */
export function performFallbackCleanup(
  scope: 'global' | 'project',
  projectPath: string,
  pkgRoot?: string,
): UninstallResult {
  const result: UninstallResult = {
    filesRemoved: 0,
    filesSkipped: 0,
    claudeHooksRemoved: 0,
    codexHooksRemoved: 0,
    agyHooksRemoved: 0,
    genericHooksRemoved: {},
    statuslineRemoved: false,
    mcpRemoved: { claude: false, codex: false, extras: [] },
  };

  // --- Build known-path white-list from source directories ---
  // Key: normalized target directory. Value: Set of absolute target paths
  // that maestro would have created.
  const dirKnownPaths = new Map<string, Set<string>>();
  if (pkgRoot) {
    for (const def of COMPONENT_DEFS) {
      // Build components transform files; we can't predict exact output paths
      // from the source alone, so skip them in fallback cleanup.
      if (def.build) continue;
      // Inject components (CLAUDE.md, AGENTS.md) are handled by
      // cleanContentManagedFile which only removes marked sections — safe.
      if (def.inject) continue;

      const dir = def.target(scope, projectPath);
      const sourceDir = join(pkgRoot, def.sourcePath);
      if (!existsSync(sourceDir)) continue;

      const norm = dir.toLowerCase();
      let known = dirKnownPaths.get(norm);
      if (!known) {
        known = new Set<string>();
        dirKnownPaths.set(norm, known);
      }

      const paths = buildKnownPaths(sourceDir, dir, def.fileFilter);
      for (const p of paths) known.add(p);
    }
  }

  // --- Files: clean all component target directories ---
  const seen = new Set<string>();
  for (const def of COMPONENT_DEFS) {
    // Skip build components in fallback — can't determine exact output files
    if (def.build) continue;

    const dir = def.target(scope, projectPath);
    const norm = dir.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);

    // When pkgRoot is available, pass the white-list so only known files
    // are deleted. When not available (legacy callers), cleanDirectory
    // falls back to its original behaviour.
    const knownFiles = dirKnownPaths.get(norm);
    result.filesRemoved += cleanDirectory(dir, knownFiles);
  }

  // --- Overlays ---
  const targetBase = scope === 'global' ? homedir() : projectPath;
  try { deleteOverlayManifest(scope, targetBase); } catch { /* skip */ }

  // --- Hooks: broad sweep (no whitelist — strip everything with "maestro") ---
  const settingsPath = scope === 'global'
    ? getClaudeSettingsPath()
    : join(projectPath, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    if (removeClaudeStatusline(settingsPath)) result.statuslineRemoved = true;
    try {
      const settings = loadClaudeSettings(settingsPath);
      const before = JSON.stringify(settings.hooks ?? {});
      removeMaestroHooks(settings);
      const after = JSON.stringify(settings.hooks ?? {});
      if (before !== after) result.claudeHooksRemoved = 1;
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch { /* skip */ }
  }

  // --- MCP ---
  if (removeMcpServer(scope, projectPath)) result.mcpRemoved.claude = true;
  if (removeCodexMcpServer(scope, projectPath)) result.mcpRemoved.codex = true;

  // --- Extra MCP (scan all known targets) ---
  for (const spec of EXTRA_MCP_TARGETS) {
    if (removeExtraMcpServer(spec.id, scope, projectPath)) {
      result.mcpRemoved.extras.push(spec.id);
    }
  }

  // --- Codex skill dedupe config ---
  removeCodexSkillDedupeConfig(scope, projectPath);

  return result;
}

// ---------------------------------------------------------------------------
// Codex skill deduplication — disable .agents/ skills in codex config
// ---------------------------------------------------------------------------

const DEDUPE_START = '# maestro:dedupe-agents-start';
const DEDUPE_END = '# maestro:dedupe-agents-end';

/**
 * Strip ALL maestro-managed dedupe blocks, orphaned markers, and orphaned
 * .agents/skills entries from codex config content.  Handles corruption left
 * by older versions where indexOf(END) found an orphan before START.
 */
function stripDedupeBlocks(content: string): string {
  let cleaned = content;

  // 1. Remove properly-formed START...END blocks (search END only AFTER START)
  for (;;) {
    const si = cleaned.indexOf(DEDUPE_START);
    if (si === -1) break;
    const ei = cleaned.indexOf(DEDUPE_END, si);
    if (ei === -1) {
      cleaned = cleaned.slice(0, si) + cleaned.slice(si + DEDUPE_START.length);
      break;
    }
    cleaned = cleaned.slice(0, si) + cleaned.slice(ei + DEDUPE_END.length);
  }

  // 2. Remove orphaned markers (from prior corruption)
  cleaned = cleaned.split(DEDUPE_START).join('').split(DEDUPE_END).join('');

  // 3. Remove orphaned [[skills.config]] entries for .agents/skills paths
  cleaned = cleaned.replace(
    /\[\[skills\.config\]\]\r?\npath = "[^"]*\.agents[/\\]skills[/\\][^"]*"\r?\nenabled = false\r?\n?/g,
    '',
  );

  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Write `[[skills.config]]` entries to `~/.codex/config.toml` to disable
 * .agents/ skills that duplicate the native codex skills.
 * Returns the number of entries written.
 */
export function writeCodexSkillDedupeConfig(
  scope: 'global' | 'project',
  projectPath: string,
): number {
  const agentsSkillsDir = scope === 'global'
    ? join(homedir(), '.agents', 'skills')
    : join(projectPath, '.agents', 'skills');

  if (!existsSync(agentsSkillsDir)) return 0;

  const skillDirs = readdirSync(agentsSkillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (skillDirs.length === 0) return 0;

  const fp = getCodexConfigPath(scope, projectPath);
  let content = '';
  if (existsSync(fp)) {
    content = readFileSync(fp, 'utf-8');
  }

  content = stripDedupeBlocks(content);

  const entries = skillDirs.map(name => {
    const skillPath = join(agentsSkillsDir, name, 'SKILL.md').replace(/\\/g, '/');
    return `[[skills.config]]\npath = "${skillPath}"\nenabled = false`;
  });

  const block = [
    '',
    DEDUPE_START,
    ...entries,
    DEDUPE_END,
  ].join('\n');

  content = content ? content + '\n' + block + '\n' : block.trimStart() + '\n';

  const dir = join(fp, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, content, 'utf-8');

  return skillDirs.length;
}

/**
 * Remove the maestro-managed dedupe block from codex config.
 */
export function removeCodexSkillDedupeConfig(
  scope: 'global' | 'project',
  projectPath: string,
): boolean {
  const fp = getCodexConfigPath(scope, projectPath);
  if (!existsSync(fp)) return false;

  const content = readFileSync(fp, 'utf-8');
  if (!content.includes(DEDUPE_START) && !content.includes(DEDUPE_END)
    && !/\.agents[/\\]skills[/\\]/.test(content)) return false;

  const cleaned = stripDedupeBlocks(content);
  writeFileSync(fp, cleaned + '\n', 'utf-8');
  return true;
}
