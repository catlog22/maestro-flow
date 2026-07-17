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
import { installAllStepContent } from '../core/workflows-installer.js';
import type { InstallProfile } from '../core/install-profile.js';

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
      const { mode, projectPath } = resolveMode(opts);
      await runInstallFlow(pkgRoot, version, {
        initialStep: 'components_config',
        initialMode: mode,
        initialProjectPath: projectPath,
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
        initialProjectPath: process.cwd(),
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
      const { mode, projectPath } = resolveMode(opts);
      await runInstallFlow(pkgRoot, version, {
        initialStep: 'mcp_config',
        initialMode: mode,
        initialProjectPath: projectPath,
        initialStepIds: ['mcp'],
      });
    });
}

function registerWorkflowsSubcommand(install: Command): void {
  install
    .command('workflows')
    .description('Install step content (workflows, prepare, ref) to ~/.maestro (non-interactive)')
    .action(() => {
      const pkgRoot = getPackageRoot();
      const { workflows, prepare, ref } = installAllStepContent(pkgRoot);
      console.error(`  ✓ workflows: ${workflows.filesInstalled} files → ${workflows.targetDir}`);
      console.error(`  ✓ prepare: ${prepare.filesInstalled} files → ${prepare.targetDir}`);
      console.error(`  ✓ ref: ${ref.filesInstalled} files → ${ref.targetDir}`);
    });
}



function registerEntryCommandsSubcommand(install: Command): void {
  install
    .command('entry-commands')
    .description('Generate entry slash commands (thin `maestro run` wrappers) for selected steps')
    .option('--steps <list>', 'Comma-separated step names (default: grill,collab)')
    .option('--list', 'List eligible steps without generating')
    .option('--global', 'Generate into ~/.claude/commands (default)')
    .option('--path <dir>', 'Generate into <dir>/.claude/commands')
    .action(async (_opts: unknown, cmd: Command) => {
      // The parent `install` command also declares --path/--global and consumes
      // them before the subcommand — merge via optsWithGlobals.
      const opts = cmd.optsWithGlobals() as { steps?: string; list?: boolean; global?: boolean; path?: string };
      const { scanEntrySteps, buildEntryCommands, DEFAULT_ENTRY_STEPS } = await import('../core/entry-command-generator.js');
      const { homedir } = await import('node:os');
      const pkgRoot = getPackageRoot();

      if (opts.list) {
        const eligible = scanEntrySteps(pkgRoot);
        console.error(`  Eligible steps (${eligible.length}):`);
        for (const info of eligible) {
          const mark = DEFAULT_ENTRY_STEPS.includes(info.step) ? '*' : ' ';
          console.error(`  ${mark} ${info.step.padEnd(16)} ${info.description.slice(0, 80)}`);
        }
        console.error('\n  * = generated by default. Generate with: maestro install entry-commands --steps <a,b>');
        return;
      }

      const { mode, projectPath } = resolveMode(opts);
      const targetDir = mode === 'global'
        ? join(homedir(), '.claude', 'commands')
        : join(projectPath, '.claude', 'commands');
      const steps = opts.steps
        ? opts.steps.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const result = buildEntryCommands(pkgRoot, targetDir, steps);
      for (const file of result.written) console.error(`  ✓ ${file}`);
      for (const step of result.unknown) console.error(`  ✗ unknown step: ${step} (see --list)`);
      console.error(`\n  ${result.files} entry command(s) generated → ${targetDir}`);
      if (result.unknown.length > 0) process.exit(1);
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
    .option('--force', 'Non-interactive install (inherits the existing installation)')
    .option('--all-platforms', 'With --force: install every available platform component')
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
    .option('--plugin', 'Register as native plugin instead of file copy (with --force)')
    .option('--export [path]', 'Export current install config as profile JSON')
    .option('--import <path>', 'Import profile and install non-interactively')
    .option('--upgrade', 'With --import: merge new default-selected components (used by update)')
    .option('--load <path>', 'Load profile into interactive TUI (pre-fill state)')
    .action(async (opts: { force?: boolean; allPlatforms?: boolean; global?: boolean; path?: string; hooks?: string; mcp?: boolean; codexHooks?: string; codexMcp?: boolean; agyHooks?: string; extraMcp?: string; components?: string; statusline?: boolean | string; plugin?: boolean; export?: boolean | string; import?: string; upgrade?: boolean; load?: string }) => {
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
        const { migrateComponentIds: migrateIds, mergeNewDefaults } = await import('./install-backend.js');
        const profile = importProfile(opts.import);
        console.error(`Importing profile: ${profile.name} (${profile.scope})`);
        if (profile.scope === 'project' && !opts.path) {
          throw new Error('Project install profiles require an explicit --path <dir>.');
        }
        const componentIds = opts.upgrade
          ? mergeNewDefaults(profile.components.selectedIds, profile.components.knownIds)
          : migrateIds(profile.components.selectedIds);
        await forceInstall(pkgRoot, version, {
          global: profile.scope === 'global',
          path: opts.path,
          installComponents: profile.components.enabled,
          hooks: profile.claude.hooks.enabled ? profile.claude.hooks.basePreset : 'none',
          mcp: profile.claude.mcp.enabled,
          mcpTools: profile.claude.mcp.tools,
          mcpProjectRoot: profile.claude.mcp.projectRoot,
          codexHooks: profile.codex.hooks.enabled ? profile.codex.hooks.basePreset : 'none',
          codexMcp: profile.codex.mcp.enabled,
          codexMcpTools: profile.codex.mcp.tools,
          codexMcpProjectRoot: profile.codex.mcp.projectRoot,
          agyHooks: profile.agy.hooks.enabled ? profile.agy.hooks.basePreset : 'none',
          genericHookLevels: profile.genericHooks,
          extraMcp: profile.extraMcp.enabled ? profile.extraMcp.targetIds.join(',') : undefined,
          extraMcpEnabled: profile.extraMcp.enabled,
          components: profile.components.enabled ? componentIds.join(',') : undefined,
          statusline: profile.claude.statusline.enabled ? profile.claude.statusline.theme : false,
          claudeHooksSelection: enabledCustomHookSelection(profile.claude.hooks),
          codexHooksSelection: enabledCustomHookSelection(profile.codex.hooks),
          agyHooksSelection: enabledCustomHookSelection(profile.agy.hooks),
          pluginClaude: profilePluginPlatformState(profile.plugin, 'claude'),
          pluginCodex: profilePluginPlatformState(profile.plugin, 'codex'),
          backupClaudeMd: profile.backup.claudeMd,
          backupAll: profile.backup.all,
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
        const { mode, projectPath } = resolveMode(opts);
        await runInstallFlow(pkgRoot, version, {
          initialMode: mode,
          initialProjectPath: projectPath || undefined,
        });
      }
    });

  // Direct subcommands for scripting / CI
  registerComponentsSubcommand(install);
  registerWorkflowsSubcommand(install);
  registerEntryCommandsSubcommand(install);
  registerHooksSubcommand(install);
  registerMcpSubcommand(install);
  registerToggleSubcommand(install);
  registerFontsSubcommand(install);

  // Embedding model management
  install
    .command('embedding')
    .description('Manage embedding model (download, configure, rebuild index)')
    .option('--download', 'Download local ONNX model (~465MB)')
    .option('--status', 'Show embedding status')
    .option('--local', 'Switch to local model mode')
    .option('--rebuild', 'Rebuild embedding index')
    .action(async (opts: { download?: boolean; status?: boolean; local?: boolean; rebuild?: boolean }) => {
      const { getEmbeddingStatus, downloadLocalModel, switchToLocalMode } = await import('../tui/install-ui/embedding-status.js');
      const projectRoot = process.cwd();

      if (opts.local) {
        switchToLocalMode();
        console.error('  ✓ Switched to local model mode');
      }

      if (opts.download) {
        console.error('  Downloading local model (Xenova/multilingual-e5-small)...');
        const isTTY = process.stderr.isTTY === true;
        await downloadLocalModel((pct) => {
          if (isTTY) process.stderr.write(`\x1b[2K\r  Downloading... ${pct}%`);
        });
        if (isTTY) process.stderr.write('\x1b[2K\r');
        console.error('  ✓ Model downloaded and ready');
      }

      if (opts.rebuild) {
        console.error('  Rebuilding embedding index...');
        const { MaestroGraph } = await import('../graph/kg/engine.js');
        if (MaestroGraph.isInitialized(projectRoot)) {
          const mg = await MaestroGraph.open(projectRoot);
          try {
            const idx = await mg.buildCodeEmbeddings();
            console.error(`  ✓ Code index: ${idx.nodeIds.length} nodes, ${idx.dimension}d`);
          } finally { mg.close(); }
        }
      }

      if (opts.status || (!opts.download && !opts.local && !opts.rebuild)) {
        const status = await getEmbeddingStatus(projectRoot);
        console.error(`  Mode:     ${status.mode === 'local' ? 'Local (ONNX)' : 'API (External)'}`);
        console.error(`  Model:    ${status.modelId}`);
        console.error(`  Cached:   ${status.modelCached ? 'Yes' : 'No'}`);
        console.error(`  Device:   ${status.device}/${status.dtype} batch=${status.batchSize}`);
        console.error(`  GPU:      ${status.gpuAvailable ? 'Available' : 'Not available'}`);
        console.error(`  Wiki idx: ${status.wikiIndexDocs} docs`);
        console.error(`  Code idx: ${status.codeIndexNodes} nodes`);
      }
    });

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
  allPlatforms?: boolean;
  global?: boolean;
  path?: string;
  hooks?: string;
  mcp?: boolean;
  codexHooks?: string;
  codexMcp?: boolean;
  agyHooks?: string;
  extraMcp?: string;
  extraMcpEnabled?: boolean;
  components?: string;
  installComponents?: boolean;
  statusline?: boolean | string;
  claudeHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
  codexHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
  agyHooksSelection?: { basePreset: string; selectedHooks: string[]; isCustom: boolean };
  plugin?: boolean;
  pluginClaude?: boolean;
  pluginCodex?: boolean;
  mcpTools?: string[];
  mcpProjectRoot?: string;
  codexMcpTools?: string[];
  codexMcpProjectRoot?: string;
  backupClaudeMd?: boolean;
  backupAll?: boolean;
  genericHookLevels?: Record<string, HookLevel>;
}

type ProfileHookSelection = InstallProfile['claude']['hooks'];

export function enabledCustomHookSelection(
  selection: ProfileHookSelection,
): ProfileHookSelection | undefined {
  return selection.enabled && selection.isCustom ? selection : undefined;
}

export function profilePluginPlatformState(
  plugin: InstallProfile['plugin'],
  platform: 'claude' | 'codex',
): boolean | undefined {
  if (!plugin) return undefined;
  if (plugin.enabled === false) return false;
  return plugin[platform];
}

async function forceInstall(
  pkgRoot: string,
  version: string,
  opts: ForceInstallOpts,
): Promise<void> {
  const { executeInstallPipeline } = await import('../core/install-executor.js');
  const { migrateComponentIds } = await import('./install-backend.js');
  const { findManifest } = await import('../core/manifest.js');
  const { paths } = await import('../config/paths.js');

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
  const targetPath = mode === 'global' ? paths.home : projectPath;
  const prior = findManifest(mode, targetPath);
  const availableIds = new Set(available.map((component) => component.def.id));
  const rawComponentIds = opts.components === undefined
    ? undefined
    : opts.components.split(',').map((id) => id.trim()).filter(Boolean);

  if (rawComponentIds && rawComponentIds.length === 0) {
    throw new Error('--components requires at least one component ID.');
  }

  const invalidComponentIds = rawComponentIds?.filter((id) => {
    const migrated = migrateComponentIds([id]);
    return migrated.length === 0 || migrated.some((candidate) => !availableIds.has(candidate));
  }) ?? [];
  if (invalidComponentIds.length > 0) {
    throw new Error(`Unknown or unavailable component IDs: ${invalidComponentIds.join(', ')}`);
  }

  const requestedIds = rawComponentIds ? migrateComponentIds(rawComponentIds) : undefined;
  const priorIds = prior?.selectedComponentIds === undefined
    ? undefined
    : migrateComponentIds(prior.selectedComponentIds);
  let selectedIds: string[];
  if (opts.allPlatforms) {
    selectedIds = available.map((component) => component.def.id);
  } else if (requestedIds) {
    selectedIds = Array.from(new Set([...(priorIds ?? []), ...requestedIds]));
  } else if (priorIds) {
    selectedIds = priorIds;
  } else if (prior) {
    // Legacy manifests used an omitted selection to mean "all".
    selectedIds = available.map((component) => component.def.id);
  } else if (opts.installComponents === false) {
    selectedIds = [];
  } else {
    // Match the fresh TUI default: shared infrastructure + Claude assets.
    selectedIds = available
      .filter((component) => component.def.defaultSelected !== false)
      .filter((component) => {
        const platform = component.def.platform ?? 'shared';
        return platform === 'shared' || platform === 'claude';
      })
      .map((component) => component.def.id);
  }
  let toInstall = available.filter((component) => selectedIds.includes(component.def.id));

  const pluginClaudeRequested = opts.plugin === true || (opts.pluginClaude ?? prior?.plugin?.claude ?? false);
  const pluginCodexRequested = opts.plugin === true || (opts.pluginCodex ?? prior?.plugin?.codex ?? false);

  // Plugin mode: skip file-copy components only for the platforms that use a
  // native plugin. Injected instruction files remain additive.
  if (pluginClaudeRequested || pluginCodexRequested) {
    toInstall = toInstall.filter(c => {
      if (c.def.inject) return true; // keep inject components (CLAUDE.md, AGENTS.md)
      if (c.def.platform === 'claude' && pluginClaudeRequested) return false;
      if (c.def.platform === 'codex' && pluginCodexRequested) return false;
      return true;
    });
  }

  const hookLevel = (opts.hooks ?? prior?.hooks?.claude?.level ?? prior?.hookLevel ?? 'none') as HookLevel;
  const codexHookLevel = (opts.codexHooks ?? prior?.hooks?.codex?.level ?? 'none') as HookLevel;
  const agyHookLevel = (opts.agyHooks ?? prior?.hooks?.agy?.level ?? 'none') as HookLevel;
  const statuslineTheme = typeof opts.statusline === 'string'
    ? opts.statusline
    : prior?.statusline?.theme ?? 'notion';

  const inheritedClaudeSelection = opts.hooks === undefined && prior?.hooks?.claude
    ? { basePreset: hookLevel, selectedHooks: [...prior.hooks.claude.installed], isCustom: true }
    : undefined;
  const inheritedCodexSelection = opts.codexHooks === undefined && prior?.hooks?.codex
    ? { basePreset: codexHookLevel, selectedHooks: [...prior.hooks.codex.installed], isCustom: true }
    : undefined;
  const inheritedAgySelection = opts.agyHooks === undefined && prior?.hooks?.agy
    ? { basePreset: agyHookLevel, selectedHooks: [...prior.hooks.agy.installed], isCustom: true }
    : undefined;
  const claudeHooksSelection = opts.hooks === 'none'
    ? undefined
    : opts.claudeHooksSelection ?? inheritedClaudeSelection;
  const codexHooksSelection = opts.codexHooks === 'none'
    ? undefined
    : opts.codexHooksSelection ?? inheritedCodexSelection;
  const agyHooksSelection = opts.agyHooks === 'none'
    ? undefined
    : opts.agyHooksSelection ?? inheritedAgySelection;

  const hasCustomClaude = claudeHooksSelection?.isCustom && claudeHooksSelection.selectedHooks.length > 0;
  const hasCustomCodex = codexHooksSelection?.isCustom && codexHooksSelection.selectedHooks.length > 0;
  const hasCustomAgy = agyHooksSelection?.isCustom && agyHooksSelection.selectedHooks.length > 0;
  const extraMcpTargetIds: ExtraMcpTargetId[] = opts.extraMcpEnabled === false
    ? []
    : opts.extraMcp
    ? opts.extraMcp.split(',').map(s => s.trim()) as ExtraMcpTargetId[]
    : (prior?.mcp?.extras?.map((entry) => entry.targetId as ExtraMcpTargetId) ?? []);

  const installPluginClaude = pluginClaudeRequested;
  const installPluginCodex = pluginCodexRequested;
  const mcpTools = opts.mcpTools ?? [...MCP_TOOLS];
  const codexMcpTools = opts.codexMcpTools ?? [...MCP_TOOLS];
  const configureCodexV2 = opts.installComponents !== false && selectedIds.some((id) =>
    components.some((component) => component.def.id === id && component.def.platform === 'codex'));
  const genericHookLevels = opts.genericHookLevels ?? Object.fromEntries(
    Object.entries(prior?.hooks?.generic ?? {}).map(([id, record]) => [id, (record.level ?? 'none') as HookLevel]),
  );

  const config: import('../tui/install-ui/types.js').InstallFlowConfig = {
    mode,
    projectPath,
    installComponents: opts.installComponents !== false,
    installHooks: (hookLevel !== 'none' && HOOK_LEVELS.includes(hookLevel)) || !!hasCustomClaude,
    installMcp: opts.mcp ?? !!prior?.mcp?.claude,
    installCodexHooks: (codexHookLevel !== 'none' && HOOK_LEVELS.includes(codexHookLevel)) || !!hasCustomCodex,
    codexHookLevel,
    installCodexMcp: opts.codexMcp ?? !!prior?.mcp?.codex,
    codexMcpTools,
    codexMcpProjectRoot: opts.codexMcpProjectRoot ?? '',
    installAgyHooks: (agyHookLevel !== 'none' && HOOK_LEVELS.includes(agyHookLevel)) || !!hasCustomAgy,
    agyHookLevel,
    installExtraMcp: extraMcpTargetIds.length > 0,
    extraMcpTargetIds,
    genericHookLevels,
    installStatusline: opts.statusline === undefined ? !!prior?.statusline : !!opts.statusline,
    statuslineTheme,
    hookLevel,
    componentCount: toInstall.length,
    fileCount: toInstall.reduce((sum, c) => sum + c.fileCount, 0),
    mcpToolCount: mcpTools.length,
    selectedComponentIds: toInstall.map(c => c.def.id),
    mcpTools,
    mcpProjectRoot: opts.mcpProjectRoot ?? '',
    backupClaudeMd: opts.backupClaudeMd ?? true,
    backupAll: opts.backupAll ?? false,
    claudeHooksSelection: claudeHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
    codexHooksSelection: codexHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
    agyHooksSelection: agyHooksSelection as import('../tui/install-ui/HooksConfig.js').HooksSelection,
    codexDedupeAgents: toInstall.some(c => c.def.id.startsWith('codex-')) && toInstall.some(c => c.def.id.startsWith('agents-standard-')),
    installPluginClaude,
    installPluginCodex,
    configureCodexMultiAgentV2: configureCodexV2,
    explicitlyDisabled: {
      claudeHooks: opts.hooks !== undefined && !((hookLevel !== 'none' && HOOK_LEVELS.includes(hookLevel)) || !!hasCustomClaude),
      claudeMcp: opts.mcp === false,
      codexHooks: opts.codexHooks !== undefined && !((codexHookLevel !== 'none' && HOOK_LEVELS.includes(codexHookLevel)) || !!hasCustomCodex),
      codexMcp: opts.codexMcp === false,
      agyHooks: opts.agyHooks !== undefined && !((agyHookLevel !== 'none' && HOOK_LEVELS.includes(agyHookLevel)) || !!hasCustomAgy),
      genericHooks: opts.genericHookLevels === undefined
        ? undefined
        : Object.entries(opts.genericHookLevels)
            .filter(([, level]) => level === 'none')
            .map(([platformId]) => platformId),
      extraMcp: opts.extraMcpEnabled === false,
      statusline: opts.statusline === false,
      pluginClaude: opts.plugin !== true && opts.pluginClaude === false,
      pluginCodex: opts.plugin !== true && opts.pluginCodex === false,
    },
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
    const { isAvailable, getUnavailableReason, isModelCached, isApiMode, embedTexts, getDeviceSummary, setProgressCallback } = await import('#maestro-dashboard/wiki/embedding.js');
    if (!await isAvailable()) {
      const reason = getUnavailableReason?.() ?? 'unknown';
      console.error(`  Embedding: unavailable (${reason})`);
      return;
    }

    if (isApiMode()) {
      console.error(`  Embedding: API mode (${getDeviceSummary()})`);
      return;
    }

    if (!isModelCached()) {
      console.error('  Embedding: model not cached, skipping warmup');
      console.error('    Run "maestro install embedding --download" to download (~465MB)');
      return;
    }

    const isTTY = process.stderr.isTTY === true;
    const t0 = Date.now();
    process.stderr.write('  Embedding: warming up model...\r');

    await embedTexts(['warmup']);
    if (isTTY) process.stderr.write('\x1b[2K\r');
    console.error(`  ✓ Embedding: model ready (${getDeviceSummary()}, ${Date.now() - t0}ms)`);
  } catch (e: unknown) {
    process.stderr.write('\x1b[2K\r');
    console.error(`  Embedding: warmup failed (${e instanceof Error ? e.message : e})`);
    console.error(`    Run "maestro install embedding --download" to retry`);
  }
}
