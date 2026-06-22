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
import { existsSync, readFileSync } from 'node:fs';
import { runInstallWizard, runInstallFlow } from '../tui/install-ui/index.js';
import {
  HOOK_LEVELS,
  type HookLevel,
} from './hooks.js';
import {
  getPackageRoot,
  scanComponents,
  MCP_TOOLS,
  type ExtraMcpTargetId,
} from './install-backend.js';
import { t } from '../i18n/index.js';
import { registerFontsSubcommand } from './font-guide.js';

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



function registerToggleSubcommand(install: Command): void {
  install
    .command('toggle')
    .description('Enable/disable individual commands, skills, and agents')
    .option('--global', 'Toggle items in global installation (default)')
    .option('--path <dir>', 'Toggle items in project installation')
    .option('--type <type>', 'Filter by type: command, skill, agent')
    .option('--enable <names>', 'Non-interactive: enable items (comma-separated)')
    .option('--disable <names>', 'Non-interactive: disable items (comma-separated)')
    .option('--list', 'List all items with their status (no TUI)')
    .action(async (opts: { global?: boolean; path?: string; type?: string; enable?: string; disable?: string; list?: boolean }) => {
      const { homedir } = await import('node:os');
      const { scanToggleItems, applyToggle, updateManifestDisabledItems } = await import('./install-backend.js');

      const pkgRoot = getPackageRoot();
      const mode: 'global' | 'project' = opts.path ? 'project' : 'global';
      const targetBase = opts.path ? resolve(opts.path) : homedir();
      const targetPath = opts.path ? resolve(opts.path) : (await import('../config/paths.js')).paths.home;

      // Non-interactive: --list
      if (opts.list) {
        const items = scanToggleItems(pkgRoot, targetBase);
        const filtered = opts.type ? items.filter(i => i.type === opts.type) : items;
        let currentType = '';
        for (const item of filtered) {
          if (item.type !== currentType) {
            currentType = item.type;
            console.error(`\n  ${currentType}s:`);
          }
          const sym = item.state === 'on' ? '✓' : item.state === 'off' ? '✗' : '·';
          const label = item.state === 'available' ? ' (not installed)' : item.state === 'off' ? ' (disabled)' : '';
          console.error(`    ${sym} ${item.name}${label}`);
        }
        const on = filtered.filter(i => i.state === 'on').length;
        console.error(`\n  ${on}/${filtered.length} enabled\n`);
        return;
      }

      // Non-interactive: --enable / --disable
      if (opts.enable || opts.disable) {
        const items = scanToggleItems(pkgRoot, targetBase);
        let changed = 0;
        if (opts.enable) {
          for (const name of opts.enable.split(',')) {
            const item = items.find(i => i.name === name.trim() && i.state !== 'on');
            if (item && applyToggle(item, pkgRoot)) { item.state = 'on'; changed++; console.error(`  ✓ enabled: ${item.name}`); }
          }
        }
        if (opts.disable) {
          for (const name of opts.disable.split(',')) {
            const item = items.find(i => i.name === name.trim() && i.state === 'on');
            if (item && applyToggle(item, pkgRoot)) { item.state = 'off'; changed++; console.error(`  ✗ disabled: ${item.name}`); }
          }
        }
        if (changed > 0) {
          const disabled = items.filter(i => i.state === 'off').map(i => `${i.type}:${i.name}`);
          updateManifestDisabledItems(mode, targetPath, disabled);
          console.error(`\n  ${changed} items toggled, manifest updated.`);
        }
        return;
      }

      // Interactive TUI
      const { renderTui } = await import('../tui/render.js');
      const { ToggleView } = await import('../tui/install-ui/ToggleView.js');
      await renderTui(ToggleView, {
        pkgRoot,
        targetBase,
        scope: mode,
        targetPath,
        filter: opts.type,
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
    .option('--codex-hooks <level>', 'Codex hook level for --force mode: none, minimal, standard, full')
    .option('--mcp', 'Register Claude MCP server in --force mode')
    .option('--codex-mcp', 'Register Codex MCP server in --force mode')
    .option('--agy-hooks <level>', 'Agy (Antigravity) hook level for --force mode: none, minimal, standard, full')
    .option('--extra-mcp <targets>', 'Comma-separated extra MCP targets (cursor,qoder,trae,kiro,roo,vscode,gemini)')
    .option('--components <ids>', 'Comma-separated component IDs to install (with --force)')
    .option('--statusline [theme]', 'Install statusline with optional theme (with --force)')
    .option('--export [path]', 'Export current install config as profile JSON')
    .option('--import <path>', 'Import profile and install non-interactively')
    .option('--load <path>', 'Load profile into interactive TUI (pre-fill state)')
    .action(async (opts: { force?: boolean; global?: boolean; path?: string; hooks?: string; mcp?: boolean; codexHooks?: string; codexMcp?: boolean; agyHooks?: string; extraMcp?: string; components?: string; statusline?: boolean | string; export?: boolean | string; import?: string; load?: string }) => {
      const pkgRoot = getPackageRoot();

      // Validate package root
      const hasTemplates = existsSync(join(pkgRoot, 'templates'));
      const hasWorkflows = existsSync(join(pkgRoot, 'workflows'));
      if (!hasTemplates && !hasWorkflows) {
        console.error(t.install.errorMissingRoot.replace('{path}', pkgRoot));
        process.exit(1);
      }

      const version = getVersion(pkgRoot);

      // Profile export — read current manifest and dump as profile JSON
      if (opts.export !== undefined) {
        const { exportProfileFromManifest } = await import('../core/install-profile.js');
        const targetPath = typeof opts.export === 'string' ? opts.export : undefined;
        const outPath = exportProfileFromManifest(opts.global ? 'global' : 'project', targetPath);
        console.error(`✓ Profile exported to: ${outPath}`);
        return;
      }

      // Profile import — non-interactive install from profile
      if (opts.import) {
        const { importProfile } = await import('../core/install-profile.js');
        const { migrateComponentIds: migrateIds } = await import('./install-backend.js');
        const profile = importProfile(opts.import);
        console.error(`Importing profile: ${profile.name} (${profile.scope})`);
        await forceInstall(pkgRoot, version, {
          global: profile.scope === 'global',
          hooks: profile.claude.hooks.basePreset,
          mcp: profile.claude.mcp.enabled || undefined,
          codexHooks: profile.codex.hooks.basePreset,
          codexMcp: profile.codex.mcp.enabled || undefined,
          agyHooks: profile.agy.hooks.basePreset,
          extraMcp: profile.extraMcp.enabled ? profile.extraMcp.targetIds.join(',') : undefined,
          components: migrateIds(profile.components.selectedIds).join(','),
          statusline: profile.claude.statusline.enabled ? profile.claude.statusline.theme : undefined,
          claudeHooksSelection: profile.claude.hooks.isCustom ? profile.claude.hooks : undefined,
          codexHooksSelection: profile.codex.hooks.isCustom ? profile.codex.hooks : undefined,
          agyHooksSelection: profile.agy.hooks.isCustom ? profile.agy.hooks : undefined,
        });
        return;
      }

      // Profile load — pre-fill TUI state (not yet implemented)
      if (opts.load) {
        console.error('--load is not yet implemented. Use --import for non-interactive install.');
        return;
      }

      if (opts.force) {
        await forceInstall(pkgRoot, version, opts);
      } else {
        await runInstallFlow(pkgRoot, version);
      }
    });

  // Direct subcommands for scripting / CI
  registerComponentsSubcommand(install);
  registerHooksSubcommand(install);
  registerMcpSubcommand(install);
  registerToggleSubcommand(install);
  registerFontsSubcommand(install);

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
// Non-interactive (force) install — uses shared executor with console progress
// ---------------------------------------------------------------------------

interface ForceInstallOpts {
  global?: boolean;
  path?: string;
  hooks?: string;
  mcp?: boolean;
  codexHooks?: string;
  codexMcp?: boolean;
  agyHooks?: string;
  extraMcp?: string;
  components?: string;
  statusline?: boolean | string;
  claudeHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
  codexHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
  agyHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
}

async function forceInstall(
  pkgRoot: string,
  version: string,
  opts: ForceInstallOpts,
): Promise<void> {
  const { executeInstallPipeline } = await import('../core/install-executor.js');
  const { migrateComponentIds } = await import('./install-backend.js');

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
  const componentIds = opts.components
    ? migrateComponentIds(opts.components.split(','))
    : undefined;
  const toInstall = componentIds
    ? available.filter(c => componentIds.includes(c.def.id))
    : available;

  const hookLevel = (opts.hooks ?? 'none') as HookLevel;
  const codexHookLevel = (opts.codexHooks ?? 'none') as HookLevel;
  const agyHookLevel = (opts.agyHooks ?? 'none') as HookLevel;
  const statuslineTheme = typeof opts.statusline === 'string' ? opts.statusline : 'notion';

  const hasCustomClaude = opts.claudeHooksSelection?.isCustom && opts.claudeHooksSelection.selectedHooks.length > 0;
  const hasCustomCodex = opts.codexHooksSelection?.isCustom && opts.codexHooksSelection.selectedHooks.length > 0;
  const hasCustomAgy = opts.agyHooksSelection?.isCustom && opts.agyHooksSelection.selectedHooks.length > 0;
  const extraMcpTargetIds: ExtraMcpTargetId[] = opts.extraMcp
    ? opts.extraMcp.split(',').map(s => s.trim()) as ExtraMcpTargetId[]
    : [];

  const config: import('../tui/install-ui/types.js').InstallFlowConfig = {
    mode,
    projectPath,
    installComponents: true,
    installHooks: (hookLevel !== 'none' && HOOK_LEVELS.includes(hookLevel)) || !!hasCustomClaude,
    installMcp: !!opts.mcp,
    installCodexHooks: (codexHookLevel !== 'none' && HOOK_LEVELS.includes(codexHookLevel)) || !!hasCustomCodex,
    codexHookLevel,
    installCodexMcp: !!opts.codexMcp,
    codexMcpTools: [...MCP_TOOLS],
    codexMcpProjectRoot: '',
    installAgyHooks: (agyHookLevel !== 'none' && HOOK_LEVELS.includes(agyHookLevel)) || !!hasCustomAgy,
    agyHookLevel,
    installExtraMcp: extraMcpTargetIds.length > 0,
    extraMcpTargetIds,
    installStatusline: !!opts.statusline,
    statuslineTheme,
    hookLevel,
    componentCount: toInstall.length,
    fileCount: toInstall.reduce((sum, c) => sum + c.fileCount, 0),
    mcpToolCount: MCP_TOOLS.length,
    selectedComponentIds: toInstall.map(c => c.def.id),
    mcpTools: [...MCP_TOOLS],
    mcpProjectRoot: '',
    backupClaudeMd: true,
    backupAll: false,
    claudeHooksSelection: opts.claudeHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
    codexHooksSelection: opts.codexHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
    agyHooksSelection: opts.agyHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
  };

  const result = await executeInstallPipeline({
    config, pkgRoot, version,
    onProgress: (step, status, detail) => {
      if (status === 'done') console.error(`  ✓ ${step}: ${detail}`);
      else if (status === 'active') process.stderr.write(`  ${step}: ${detail}\r`);
    },
  });

  const parts = [`${result.filesInstalled} files`];
  if (result.dirsCreated > 0) parts.push(`${result.dirsCreated} dirs`);
  if (result.filesSkipped > 0) parts.push(`${result.filesSkipped} preserved`);
  console.error(t.install.forceResult.replace('{summary}', parts.join(', ')));

  if (result.migrationWarnings.length > 0) {
    console.error('');
    console.error('  ⚠ Migration warnings:');
    for (const w of result.migrationWarnings) {
      console.error(`    ${w}`);
    }
  }

  console.error('');
  console.error(t.install.forceDone);

  // Warm up embedding model + build index (best-effort, non-blocking report)
  await warmupEmbedding();
}

async function warmupEmbedding(): Promise<void> {
  try {
    process.stderr.write('  Embedding: warming up model...\r');
    const { isAvailable, getUnavailableReason, embedTexts, getDeviceSummary } = await import('#maestro-dashboard/wiki/embedding.js');
    if (!await isAvailable()) {
      const reason = getUnavailableReason?.() ?? 'unknown';
      console.error(`  Embedding: unavailable (${reason})`);
      return;
    }
    const t0 = Date.now();
    await embedTexts(['warmup']);
    console.error(`  ✓ Embedding: model ready (${getDeviceSummary()}, ${Date.now() - t0}ms)`);
  } catch (e: unknown) {
    console.error(`  Embedding: warmup failed (${e instanceof Error ? e.message : e})`);
  }
}
