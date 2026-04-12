// ---------------------------------------------------------------------------
// `maestro install` — interactive install wizard for maestro assets
//
// Global (~/.maestro/):  templates/, workflows/
// Project (target dir):  .claude/ (commands, agents, skills, CLAUDE.md),
//                        .codex/ (skills)
//
// Tracks installed files in manifests for clean reinstall and uninstall.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
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
import { select, input, confirm, checkbox } from '@inquirer/prompts';
import { paths } from '../config/paths.js';
import {
  createManifest,
  addFile,
  addDir,
  saveManifest,
  findManifest,
  cleanManifestFiles,
  getAllManifests,
  type Manifest,
} from '../core/manifest.js';
import { applyOverlays, ensureOverlayDir } from '../core/overlay/applier.js';
import {
  installHooksByLevel,
  HOOK_LEVELS,
  HOOK_LEVEL_DESCRIPTIONS,
  type HookLevel,
} from './hooks.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPackageRoot(): string {
  return resolve(__dirname, '..', '..');
}

/** Files to preserve during overwrite */
const PRESERVE_FILES = new Set(['settings.json', 'settings.local.json']);

// ---------------------------------------------------------------------------
// Component definitions — single source of truth
// ---------------------------------------------------------------------------

interface ComponentDef {
  id: string;
  label: string;
  description: string;
  sourcePath: string;
  /** Resolve target directory based on mode and project path */
  target: (mode: 'global' | 'project', projectPath: string) => string;
  /** Always installs to global location regardless of mode */
  alwaysGlobal: boolean;
}

const COMPONENT_DEFS: ComponentDef[] = [
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

interface DisabledItem {
  name: string;
  relativePath: string;
  type: 'skill' | 'command' | 'agent';
}

function scanDisabledItems(targetBase: string): DisabledItem[] {
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

  return items;
}

function restoreDisabledState(items: DisabledItem[], targetBase: string): number {
  let restored = 0;
  for (const item of items) {
    if (item.type === 'skill') {
      const enabledPath = join(targetBase, '.claude', 'skills', item.name, 'SKILL.md');
      const disabledPath = enabledPath + '.disabled';
      if (existsSync(enabledPath) && !existsSync(disabledPath)) {
        renameSync(enabledPath, disabledPath);
        restored++;
      }
    } else {
      const subdir = item.type === 'command' ? 'commands' : 'agents';
      const enabledPath = join(targetBase, '.claude', subdir, `${item.name}.md`);
      const disabledPath = enabledPath + '.disabled';
      if (existsSync(enabledPath) && !existsSync(disabledPath)) {
        renameSync(enabledPath, disabledPath);
        restored++;
      }
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
function applyOverlaysPostInstall(
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

function addMcpServer(
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

  const serverConfig = {
    command: isWin ? 'cmd' : 'npx',
    args: isWin ? ['/c', 'npx', '-y', 'maestro-mcp'] : ['-y', 'maestro-mcp'],
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

interface ScannedComponent {
  def: ComponentDef;
  sourceFull: string;
  targetDir: string;
  fileCount: number;
  available: boolean;
}

function scanComponents(
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

interface CopyStats {
  files: number;
  dirs: number;
  skipped: number;
}

function copyRecursive(
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

function createBackup(manifest: Manifest): string | null {
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
// Interactive wizard
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'read_many_files',
  'team_msg',
  'core_memory',
] as const;

async function interactiveInstall(pkgRoot: string, version: string): Promise<void> {
  console.error('');
  console.error(`  maestro install v${version}`);
  console.error('  Interactive installation wizard');
  console.error('');

  // ── Step 1: Mode selection ──────────────────────────────────────────

  const mode = await select<'global' | 'project'>({
    message: 'Installation mode:',
    choices: [
      {
        name: 'Global — Install to home directory (recommended)',
        value: 'global',
        description: '~/.claude/, ~/.maestro/, ~/.codex/',
      },
      {
        name: 'Project — Install to a specific project directory',
        value: 'project',
        description: 'Commands scoped to project',
      },
    ],
  });

  let projectPath = '';
  if (mode === 'project') {
    projectPath = await input({
      message: 'Project path:',
      default: process.cwd(),
      validate: (val) => {
        if (!val.trim()) return 'Path is required';
        if (!existsSync(val.trim())) return `Path does not exist: ${val}`;
        return true;
      },
    });
    projectPath = resolve(projectPath.trim());
  }

  // ── Step 2: Scan & show existing installations ──────────────────────

  const manifests = getAllManifests();
  const targetPath = mode === 'global' ? paths.home : projectPath;
  const existingManifest = findManifest(mode, targetPath);

  if (existingManifest) {
    console.error('');
    console.error(`  Existing ${mode} installation found (${existingManifest.installedAt})`);
    console.error(`  ${existingManifest.entries.length} tracked entries`);
  }

  // ── Step 3: Scan available components ───────────────────────────────

  const components = scanComponents(pkgRoot, mode, projectPath);
  const available = components.filter((c) => c.available);

  if (available.length === 0) {
    console.error('  No installable components found.');
    process.exit(1);
  }

  console.error('');

  // ── Step 4: Component selection ─────────────────────────────────────

  const selected = await checkbox({
    message: 'Select components to install:',
    choices: components.map((c) => ({
      name: `${c.def.label} (${c.fileCount} files) — ${c.def.description}`,
      value: c.def.id,
      checked: c.available,
      disabled: !c.available ? '(not found)' : false,
    })),
    validate: (vals) => vals.length > 0 || 'Select at least one component',
  });

  // ── Step 5: MCP configuration ───────────────────────────────────────

  const configureMcp = await confirm({
    message: 'Register MCP server (maestro-tools)?',
    default: true,
  });

  let mcpTools: string[] = [];
  let mcpProjectRoot = '';
  if (configureMcp) {
    mcpTools = await checkbox({
      message: 'Select MCP tools to enable:',
      choices: MCP_TOOLS.map((t) => ({
        name: t,
        value: t,
        checked: true,
      })),
    });

    mcpProjectRoot = await input({
      message: 'MCP project root (leave empty to skip):',
      default: mode === 'project' ? projectPath : '',
    });
    mcpProjectRoot = mcpProjectRoot.trim();
  }

  // ── Step 6: Hook level selection ────────────────────────────────────

  const hookLevel = await select<HookLevel>({
    message: 'Claude Code hooks:',
    choices: HOOK_LEVELS.map((level) => ({
      name: `${level} — ${HOOK_LEVEL_DESCRIPTIONS[level]}`,
      value: level,
    })),
    default: 'none' as HookLevel,
  });

  // ── Step 7: Backup ──────────────────────────────────────────────────

  let doBackup = false;
  if (existingManifest) {
    doBackup = await confirm({
      message: 'Backup existing installation before overwriting?',
      default: true,
    });
  }

  // ── Step 8: Review & confirm ────────────────────────────────────────

  const targetBase = mode === 'global' ? homedir() : projectPath;
  const selectedComponents = components.filter((c) => selected.includes(c.def.id));

  console.error('');
  console.error('  ┌─ Installation Summary ──────────────────────');
  console.error(`  │ Mode:       ${mode}`);
  console.error(`  │ Target:     ${targetBase}`);
  console.error(`  │ Components: ${selectedComponents.map((c) => c.def.label).join(', ')}`);
  if (configureMcp) {
    console.error(`  │ MCP:        ${mcpTools.length} tools enabled`);
    if (mcpProjectRoot) console.error(`  │ MCP root:   ${mcpProjectRoot}`);
  }
  console.error(`  │ Hooks:      ${hookLevel} (${HOOK_LEVEL_DESCRIPTIONS[hookLevel]})`);
  if (doBackup) {
    console.error('  │ Backup:     yes');
  }
  console.error('  └──────────────────────────────────────────────');
  console.error('');

  const proceed = await confirm({
    message: 'Proceed with installation?',
    default: true,
  });

  if (!proceed) {
    console.error('  Installation cancelled.');
    return;
  }

  // ── Step 9: Execute ─────────────────────────────────────────────────

  console.error('');

  // Scan disabled items before overwrite
  const disabledItems = scanDisabledItems(targetBase);

  // Backup if requested
  if (doBackup && existingManifest) {
    const backupPath = createBackup(existingManifest);
    if (backupPath) {
      console.error(`  Backup created: ${backupPath}`);
    }
  }

  // Clean previous installation
  if (existingManifest) {
    const { removed, skipped } = cleanManifestFiles(existingManifest);
    if (removed > 0) {
      console.error(`  Cleaned: ${removed} old files${skipped > 0 ? `, ${skipped} preserved` : ''}`);
    }
  }

  // Ensure global home exists
  paths.ensure(paths.home);

  // Create new manifest
  const manifest = createManifest(mode, mode === 'global' ? paths.home : projectPath);
  const totalStats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

  for (const comp of selectedComponents) {
    console.error(`  Installing ${comp.def.label}...`);
    copyRecursive(comp.sourceFull, comp.targetDir, totalStats, manifest);
  }

  // Version marker
  const versionData = {
    version,
    installedAt: new Date().toISOString(),
    installer: 'maestro',
  };
  const versionPath = join(paths.home, 'version.json');
  writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf-8');
  addFile(manifest, versionPath);
  totalStats.files++;

  // Restore disabled state
  const disabledRestored = restoreDisabledState(disabledItems, targetBase);

  // Apply overlays (non-invasive command patches)
  const overlaysAppliedCount = applyOverlaysPostInstall(mode, targetBase);

  // MCP registration
  let mcpRegistered = false;
  if (configureMcp && mcpTools.length > 0) {
    mcpRegistered = addMcpServer(mode, projectPath, mcpTools, mcpProjectRoot || undefined);
  }

  // Hook installation
  let hookResult: { installedHooks: string[] } | null = null;
  if (hookLevel !== 'none') {
    hookResult = installHooksByLevel(hookLevel, { project: mode === 'project' });
    console.error(`  Hooks installed (${hookLevel}): ${hookResult.installedHooks.length} hooks`);
  }

  // Save manifest
  const manifestPath = saveManifest(manifest);

  // ── Summary ─────────────────────────────────────────────────────────

  console.error('');
  console.error('  ┌─ Installation Complete ─────────────────────');
  console.error(`  │ Files:    ${totalStats.files} installed`);
  if (totalStats.dirs > 0) console.error(`  │ Dirs:     ${totalStats.dirs} created`);
  if (totalStats.skipped > 0) console.error(`  │ Preserved: ${totalStats.skipped} settings files`);
  if (disabledRestored > 0) console.error(`  │ Disabled:  ${disabledRestored} items restored`);
  if (overlaysAppliedCount > 0) console.error(`  │ Overlays:  ${overlaysAppliedCount} applied`);
  if (mcpRegistered) console.error('  │ MCP:       maestro-tools registered');
  if (hookResult) console.error(`  │ Hooks:     ${hookLevel} (${hookResult.installedHooks.length} hooks)`);
  console.error(`  │ Manifest: ${manifestPath}`);
  console.error('  └──────────────────────────────────────────────');
  console.error('');
  console.error('  Restart Claude Code or IDE to pick up changes.');
  console.error('');
}

// ---------------------------------------------------------------------------
// Non-interactive (force) install — preserves original batch behavior
// ---------------------------------------------------------------------------

function forceInstall(
  pkgRoot: string,
  version: string,
  opts: { global?: boolean; path?: string; hooks?: string },
): void {
  console.error(`maestro install v${version}`);
  console.error('');

  const mode: 'global' | 'project' = opts.global ? 'global' : (opts.path ? 'project' : 'global');
  const projectPath = opts.path ? resolve(opts.path) : '';

  if (mode === 'project' && projectPath && !existsSync(projectPath)) {
    console.error(`Error: Target directory does not exist: ${projectPath}`);
    process.exit(1);
  }

  const components = scanComponents(pkgRoot, mode, projectPath);
  const available = components.filter((c) => c.available);

  // Determine what to install based on mode
  const targetPath = mode === 'global' ? paths.home : projectPath;
  const targetBase = mode === 'global' ? homedir() : projectPath;

  // Scan disabled items
  const disabledItems = scanDisabledItems(targetBase);

  // Clean previous
  const existingManifest = findManifest(mode, targetPath);
  if (existingManifest) {
    const { removed, skipped } = cleanManifestFiles(existingManifest);
    if (removed > 0) {
      console.error(`  Cleaned: ${removed} old files${skipped > 0 ? `, ${skipped} preserved` : ''}`);
    }
  }

  paths.ensure(paths.home);

  const manifest = createManifest(mode, targetPath);
  const totalStats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

  for (const comp of available) {
    // In global-only mode, skip project-scoped items unless they're alwaysGlobal
    if (opts.global && !comp.def.alwaysGlobal) continue;
    console.error(`  ${comp.def.label} → ${comp.targetDir}`);
    copyRecursive(comp.sourceFull, comp.targetDir, totalStats, manifest);
  }

  // Version marker
  const versionData = {
    version,
    installedAt: new Date().toISOString(),
    installer: 'maestro',
  };
  const versionPath = join(paths.home, 'version.json');
  writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf-8');
  addFile(manifest, versionPath);
  totalStats.files++;

  // Restore disabled state
  const disabledRestored = restoreDisabledState(disabledItems, targetBase);

  // Apply overlays (non-invasive command patches)
  const overlaysAppliedCount = applyOverlaysPostInstall(mode, targetBase);

  // Hook installation
  const hookLevel = (opts.hooks ?? 'none') as HookLevel;
  if (hookLevel !== 'none' && HOOK_LEVELS.includes(hookLevel)) {
    const hookResult = installHooksByLevel(hookLevel, { project: mode === 'project' });
    console.error(`  Hooks (${hookLevel}): ${hookResult.installedHooks.length} hooks → ${hookResult.settingsPath}`);
  }

  saveManifest(manifest);

  const parts = [`${totalStats.files} files`];
  if (totalStats.dirs > 0) parts.push(`${totalStats.dirs} dirs`);
  if (totalStats.skipped > 0) parts.push(`${totalStats.skipped} preserved`);
  if (disabledRestored > 0) parts.push(`${disabledRestored} disabled restored`);
  if (overlaysAppliedCount > 0) parts.push(`${overlaysAppliedCount} overlays applied`);
  console.error(`  Result: ${parts.join(', ')}`);
  console.error('');
  console.error('Done. Restart Claude Code or IDE to pick up changes.');
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install maestro assets (interactive wizard or --force for batch mode)')
    .option('--global', 'Install global assets only (~/.maestro/)')
    .option('--path <dir>', 'Install project assets to target directory')
    .option('--force', 'Skip interactive prompts, install all available components')
    .option('--hooks <level>', 'Install Claude Code hooks: none, minimal, standard, full (default: none)')
    .action(async (opts: { global?: boolean; path?: string; force?: boolean; hooks?: string }) => {
      const pkgRoot = getPackageRoot();

      // Validate package root
      const hasTemplates = existsSync(join(pkgRoot, 'templates'));
      const hasWorkflows = existsSync(join(pkgRoot, 'workflows'));
      if (!hasTemplates && !hasWorkflows) {
        console.error(`Error: Package root missing source directories: ${pkgRoot}`);
        process.exit(1);
      }

      const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
      const version = (pkg.version as string) ?? '0.1.0';

      if (opts.force) {
        forceInstall(pkgRoot, version, opts);
      } else {
        await interactiveInstall(pkgRoot, version);
      }
    });
}
