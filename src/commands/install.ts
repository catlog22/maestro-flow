// ---------------------------------------------------------------------------
// `maestro install` — install maestro assets with step-based selection
//
// Default:  interactive menu to select which steps to install
// Subcommands for direct access:
//   maestro install components   → install file components only
//   maestro install hooks        → install hooks to Claude Code settings
//   maestro install mcp          → register MCP server
//   maestro install wizard       → full TUI wizard (legacy)
//
// Each step has independent confirmation before executing.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runInstallWizard, runInstallFlow } from './install-ui/index.js';
import { paths } from '../config/paths.js';
import {
  createManifest,
  addFile,
  saveManifest,
  findManifest,
  cleanManifestFiles,
} from '../core/manifest.js';
import {
  installHooksByLevel,
  HOOK_LEVELS,
  type HookLevel,
} from './hooks.js';
import {
  getPackageRoot,
  scanComponents,
  scanDisabledItems,
  restoreDisabledState,
  applyOverlaysPostInstall,
  copyRecursive,
  createTargetBackup,
  MCP_TOOLS,
  type CopyStats,
} from './install-backend.js';
import { t } from '../i18n/index.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveMode(opts: { global?: boolean; path?: string }): { mode: 'global' | 'project'; projectPath: string } {
  if (opts.path) {
    const projectPath = resolve(opts.path);
    if (!existsSync(projectPath)) {
      console.error(t.install.errorTargetMissing.replace('{path}', projectPath));
      process.exit(1);
    }
    return { mode: 'project', projectPath };
  }
  return { mode: 'global', projectPath: '' };
}

function getVersion(pkgRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  return (pkg.version as string) ?? '0.1.0';
}

// ---------------------------------------------------------------------------
// Subcommands — each launches Ink TUI starting at the relevant config step
// ---------------------------------------------------------------------------

function registerComponentsSubcommand(install: Command): void {
  install
    .command('components')
    .description('Install file components (interactive component selection)')
    .option('--global', 'Install to global location')
    .option('--path <dir>', 'Install to project directory')
    .action(async (opts: { global?: boolean; path?: string }) => {
      const pkgRoot = getPackageRoot();
      const version = getVersion(pkgRoot);
      const { mode } = resolveMode(opts);
      await runInstallFlow(pkgRoot, version, {
        initialStep: 'components_config',
        initialMode: mode,
        initialStepIds: ['components'],
      });
    });
}

function registerHooksSubcommand(install: Command): void {
  install
    .command('hooks')
    .description('Install maestro hooks (interactive level selection)')
    .option('--global', 'Global scope (default)')
    .option('--project', 'Project scope')
    .action(async (opts: { global?: boolean; project?: boolean }) => {
      const pkgRoot = getPackageRoot();
      const version = getVersion(pkgRoot);
      const mode = opts.project ? 'project' : 'global';
      await runInstallFlow(pkgRoot, version, {
        initialStep: 'hooks_config',
        initialMode: mode,
        initialStepIds: ['hooks'],
      });
    });
}

function registerMcpSubcommand(install: Command): void {
  install
    .command('mcp')
    .description('Register maestro MCP server (interactive tool selection)')
    .option('--global', 'Register in global config (default)')
    .option('--path <dir>', 'Register in project config')
    .action(async (opts: { global?: boolean; path?: string }) => {
      const pkgRoot = getPackageRoot();
      const version = getVersion(pkgRoot);
      const { mode } = resolveMode(opts);
      await runInstallFlow(pkgRoot, version, {
        initialStep: 'mcp_config',
        initialMode: mode,
        initialStepIds: ['mcp'],
      });
    });
}



// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInstallCommand(program: Command): void {
  const install = program
    .command('install')
    .description('Install maestro assets (interactive step selection)')
    .option('--force', 'Non-interactive batch install of all components')
    .option('--global', 'Install global assets only (with --force)')
    .option('--path <dir>', 'Install to project directory (with --force)')
    .option('--hooks <level>', 'Hook level for --force mode: none, minimal, standard, full')
    .action(async (opts: { force?: boolean; global?: boolean; path?: string; hooks?: string }) => {
      const pkgRoot = getPackageRoot();

      // Validate package root
      const hasTemplates = existsSync(join(pkgRoot, 'templates'));
      const hasWorkflows = existsSync(join(pkgRoot, 'workflows'));
      if (!hasTemplates && !hasWorkflows) {
        console.error(t.install.errorMissingRoot.replace('{path}', pkgRoot));
        process.exit(1);
      }

      const version = getVersion(pkgRoot);

      if (opts.force) {
        forceInstall(pkgRoot, version, opts);
      } else {
        await runInstallFlow(pkgRoot, version);
      }
    });

  // Direct subcommands for scripting / CI
  registerComponentsSubcommand(install);
  registerHooksSubcommand(install);
  registerMcpSubcommand(install);

  // Legacy TUI wizard
  install
    .command('wizard')
    .description('Launch full interactive TUI wizard (legacy)')
    .action(async () => {
      const pkgRoot = getPackageRoot();
      const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
      await runInstallWizard(pkgRoot, (pkg.version as string) ?? '0.1.0');
    });
}

// ---------------------------------------------------------------------------
// Non-interactive (force) install — preserves original batch behavior
// ---------------------------------------------------------------------------

function forceInstall(
  pkgRoot: string,
  version: string,
  opts: { global?: boolean; path?: string; hooks?: string },
): void {
  console.error(t.install.forceVersion.replace('{version}', version));
  console.error('');

  const mode: 'global' | 'project' = opts.global ? 'global' : (opts.path ? 'project' : 'global');
  const projectPath = opts.path ? resolve(opts.path) : '';

  if (mode === 'project' && projectPath && !existsSync(projectPath)) {
    console.error(t.install.errorTargetMissing.replace('{path}', projectPath));
    process.exit(1);
  }

  const components = scanComponents(pkgRoot, mode, projectPath);
  const available = components.filter((c) => c.available);

  // Determine what to install based on mode
  const targetPath = mode === 'global' ? paths.home : projectPath;
  const targetBase = mode === 'global' ? homedir() : projectPath;

  // Scan disabled items
  const disabledItems = scanDisabledItems(targetBase);

  // Backup CLAUDE.md by default before overwrite
  const backupPath = createTargetBackup(available, { backupClaudeMd: true, backupAll: false });
  if (backupPath) {
    console.error(`  Backup: ${backupPath}`);
  }

  // Clean previous
  const existingManifest = findManifest(mode, targetPath);
  if (existingManifest) {
    const { removed, skipped } = cleanManifestFiles(existingManifest);
    if (removed > 0) {
      let msg = t.install.forceCleaned.replace('{count}', String(removed));
      if (skipped > 0) msg += t.install.forceCleanedPreserved.replace('{count}', String(skipped));
      console.error(msg);
    }
  }

  paths.ensure(paths.home);

  const hookLevel = (opts.hooks ?? 'none') as HookLevel;

  const manifest = createManifest(mode, targetPath, {
    hookLevel,
    selectedComponentIds: available.map(c => c.def.id),
  });
  const totalStats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

  for (const comp of available) {
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
  if (hookLevel !== 'none' && HOOK_LEVELS.includes(hookLevel)) {
    const hookResult = installHooksByLevel(hookLevel, { project: mode === 'project' });
    console.error(t.install.forceHooksResult
      .replace('{level}', hookLevel)
      .replace('{count}', String(hookResult.installedHooks.length))
      .replace('{path}', hookResult.settingsPath));
  }

  saveManifest(manifest);

  const parts = [`${totalStats.files} files`];
  if (totalStats.dirs > 0) parts.push(`${totalStats.dirs} dirs`);
  if (totalStats.skipped > 0) parts.push(`${totalStats.skipped} preserved`);
  if (disabledRestored > 0) parts.push(`${disabledRestored} disabled restored`);
  if (overlaysAppliedCount > 0) parts.push(`${overlaysAppliedCount} overlays applied`);
  console.error(t.install.forceResult.replace('{summary}', parts.join(', ')));
  console.error('');
  console.error(t.install.forceDone);
}
