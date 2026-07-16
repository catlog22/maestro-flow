// ---------------------------------------------------------------------------
// Shared install executor — single pipeline for both TUI and CLI
//
// Both InstallExecution (Ink TUI) and forceInstall (CLI) consume this.
// Progress is reported via an optional callback; callers decide how to display.
// ---------------------------------------------------------------------------

import { isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { paths } from '../config/paths.js';
import {
  scanComponents,
  scanDisabledItems,
  restoreDisabledState,
  applyOverlaysPostInstall,
  addMcpServer,
  addCodexMcpServer,
  addExtraMcpServer,
  copyRecursive,
  injectDocFile,
  createTargetBackup,
  writeCodexSkillDedupeConfig,
  removeCodexSkillDedupeConfig,
  configureCodexMultiAgentV2,
  removeMcpServerAt,
  removeCodexMcpServerAt,
  removeExtraMcpServerAt,
  getExtraMcpTargetSpec,
  type CopyStats,
} from '../commands/install-backend.js';
import {
  createManifest,
  addFile,
  addDir,
  saveManifest,
  findManifest,
  recordClaudeHooks,
  recordCodexHooks,
  recordAgyHooks,
  recordGenericHooks,
  recordStatusline,
  recordClaudeMcp,
  recordCodexMcp,
  recordExtraMcp,
  type Manifest,
} from './manifest.js';
import {
  installHooksByLevel,
  installCodexHooksByLevel,
  installAgyHooksByLevel,
  installGenericHooksByLevel,
  installStatusline as installStatuslineFn,
  uninstallClaudeHooks,
  uninstallCodexHooks,
  uninstallAgyHooks,
  getGenericHooksPlatform,
  removeClaudeStatusline,
} from '../commands/hooks.js';
import type { InstallFlowConfig } from '../tui/install-ui/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallResult {
  filesInstalled: number;
  dirsCreated: number;
  filesSkipped: number;
  hooksInstalled: number;
  mcpRegistered: boolean;
  codexHooksInstalled: number;
  codexMcpRegistered: boolean;
  agyHooksInstalled: number;
  genericHooksInstalled: Record<string, number>;
  extraMcpRegistered: string[];
  extraMcpFailed: string[];
  manifestPath: string;
  statuslineInstalled: boolean;
  backupPath: string | null;
  migrationWarnings: string[];
}

export type StepName =
  | 'backup' | 'cleanup' | 'components' | 'hooks' | 'statusline'
  | 'mcp' | 'codexHooks' | 'codexMcp' | 'agyHooks' | 'extraMcp' | 'plugin' | 'manifest'
  | 'codexConfig'
  | `ghooks-${string}`;

export type ProgressCallback = (step: StepName, status: 'active' | 'done' | 'error', detail: string) => void;

export interface ExecutorOptions {
  config: InstallFlowConfig;
  pkgRoot: string;
  version: string;
  onProgress?: ProgressCallback;
  isCancelled?: () => boolean;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeInstallPipeline(opts: ExecutorOptions): Promise<InstallResult> {
  const { config, pkgRoot, version, onProgress, isCancelled } = opts;
  const progress = onProgress ?? (() => {});
  const cancelled = () => isCancelled?.() ?? false;

  const targetBase = config.mode === 'global' ? homedir() : config.projectPath;
  const targetPath = config.mode === 'global' ? paths.home : config.projectPath;

  let filesInstalled = 0;
  let dirsCreated = 0;
  let filesSkipped = 0;
  let hooksInstalled = 0;
  let mcpRegistered = false;
  let codexHooksInstalled = 0;
  let codexMcpRegistered = false;
  let agyHooksInstalled = 0;
  const genericHooksInstalled: Record<string, number> = {};
  const extraMcpRegistered: string[] = [];
  const extraMcpFailed: string[] = [];
  let statuslineInstalled = false;
  let backupPath: string | null = null;
  const warnings: string[] = [];

  // Pre-scan components once (shared by backup + component-install phases).
  // Keep the full catalog so upgrade logic can later distinguish genuinely
  // new components from items a user previously chose not to install.
  const scannedComponents = scanComponents(pkgRoot, config.mode, config.projectPath);
  const components = (config.installComponents || config.backupClaudeMd || config.backupAll)
    ? scannedComponents.filter((c) => c.available && config.selectedComponentIds.includes(c.def.id))
    : [];

  // --- Backup ---
  if (config.backupClaudeMd || config.backupAll) {
    if (cancelled()) throw new CancelledError();
    progress('backup', 'active', 'Creating backup...');
    backupPath = createTargetBackup(components, {
      backupClaudeMd: config.backupClaudeMd,
      backupAll: config.backupAll,
    });
    progress('backup', 'done', backupPath ? 'saved' : 'no files to backup');
  }

  // --- Cleanup ---
  if (cancelled()) throw new CancelledError();
  progress('cleanup', 'active', 'Loading prior install state...');
  const disabledItems = scanDisabledItems(targetBase);
  const prior = findManifest(config.mode, targetPath);
  const globalPrior = config.mode === 'project' ? findManifest('global', paths.home) : null;
  progress('cleanup', 'done', prior ? 'prior state preserved' : 'clean slate');

  // --- Replacement manifest ---
  // Installation is additive. Existing ownership/config records remain until
  // an explicit uninstall operation removes them. This prevents a partial
  // `install --components ...` call from silently uninstalling unrelated
  // components, hooks, MCP registrations, statusline, or plugins.
  paths.ensure(paths.home);
  const alwaysGlobalIds = new Set(
    scannedComponents.filter((component) => component.def.alwaysGlobal).map((component) => component.def.id),
  );
  const requestedIds = config.installComponents ? config.selectedComponentIds : [];
  const selectedComponentIds = Array.from(new Set([
    ...(prior?.selectedComponentIds ?? []).filter((id) => config.mode !== 'project' || !alwaysGlobalIds.has(id)),
    ...requestedIds.filter((id) => config.mode !== 'project' || !alwaysGlobalIds.has(id)),
  ]));
  const manifest = createManifest(config.mode, targetPath, {
    ...(config.installHooks && config.hookLevel !== 'none'
      ? { hookLevel: config.hookLevel }
      : prior?.hookLevel ? { hookLevel: prior.hookLevel } : {}),
    selectedComponentIds,
    knownComponentIds: scannedComponents.map((component) => component.def.id),
  });
  if (prior) {
    copyPriorState(manifest, prior, (entry) => config.mode !== 'project' || !isPathWithin(paths.home, entry.path));
    await clearExplicitlyDisabledState(manifest, prior, config);
  }
  const sharedManifest = config.mode === 'project' && config.installComponents
    ? createManifest('global', paths.home, {
        hookLevel: globalPrior?.hookLevel,
        selectedComponentIds: Array.from(new Set([
          ...(globalPrior?.selectedComponentIds ?? []),
          ...(prior?.selectedComponentIds ?? []).filter((id) => alwaysGlobalIds.has(id)),
          ...requestedIds.filter((id) => alwaysGlobalIds.has(id)),
        ])),
        knownComponentIds: scannedComponents.map((component) => component.def.id),
      })
    : null;
  if (sharedManifest && globalPrior) copyPriorState(sharedManifest, globalPrior);
  if (sharedManifest && prior) {
    for (const entry of prior.entries.filter((candidate) => isPathWithin(paths.home, candidate.path))) {
      if (entry.type === 'file') addFile(sharedManifest, entry.path);
      else addDir(sharedManifest, entry.path);
    }
  }
  // --- Components ---
  if (config.installComponents) {
    if (cancelled()) throw new CancelledError();
    const stats: CopyStats = { files: 0, dirs: 0, skipped: 0 };
    const total = components.length;

    for (let i = 0; i < total; i++) {
      const comp = components[i];
      const ownershipManifest = comp.def.alwaysGlobal && sharedManifest ? sharedManifest : manifest;
      if (cancelled()) throw new CancelledError();
      progress('components', 'active', `[${i + 1}/${total}] ${comp.def.label}`);
      if (comp.def.build) {
        const result = comp.def.build(join(pkgRoot, '.claude'), comp.targetDir);
        stats.files += result.files;
        trackBuildOutput(comp.targetDir, ownershipManifest);
      } else if (comp.def.inject) {
        const result = injectDocFile(comp.sourceFull, comp.targetDir, stats, ownershipManifest, comp.def.section);
        if (result.warning) warnings.push(result.warning);
      } else {
        copyRecursive(comp.sourceFull, comp.targetDir, stats, ownershipManifest, comp.def.fileFilter);
      }
    }

    if (cancelled()) throw new CancelledError();
    const versionPath = join(paths.home, 'version.json');
    writeFileSync(versionPath, JSON.stringify({
      version, installedAt: new Date().toISOString(), installer: 'maestro',
    }, null, 2), 'utf-8');
    addFile(sharedManifest ?? manifest, versionPath);

    restoreDisabledState(disabledItems, targetBase);
    applyOverlaysPostInstall(config.mode, targetBase);

    filesInstalled = stats.files;
    dirsCreated = stats.dirs;
    filesSkipped = stats.skipped;
    progress('components', 'done', `${filesInstalled} files`);
  }

  // --- Codex Multi-Agent V2 preferences ---
  if (config.installComponents && config.configureCodexMultiAgentV2) {
    if (cancelled()) throw new CancelledError();
    progress('codexConfig', 'active', 'Enabling Multi-Agent V2...');
    const configPath = configureCodexMultiAgentV2(config.mode, config.projectPath);
    if (!configPath) {
      progress('codexConfig', 'error', 'Failed to update config.toml');
      throw new Error('Failed to update Codex config.toml');
    }
    progress('codexConfig', 'done', configPath);
  }

  // --- Hooks (Claude) ---
  if (config.installHooks && (config.hookLevel !== 'none' || config.claudeHooksSelection?.selectedHooks?.length)) {
    if (cancelled()) throw new CancelledError();
    progress('hooks', 'active', `${config.hookLevel}...`);
    const result = installHooksByLevel(config.hookLevel, {
      project: config.mode === 'project',
      selectedHooks: config.claudeHooksSelection?.isCustom ? config.claudeHooksSelection.selectedHooks : undefined,
    });
    hooksInstalled = result.installedHooks.length;
    recordClaudeHooks(manifest, {
      settingsPath: result.settingsPath,
      installed: result.installedHooks,
      level: config.hookLevel,
    });
    progress('hooks', 'done', `${hooksInstalled} hooks (${config.hookLevel})`);
  }

  // --- Statusline ---
  if (config.installStatusline) {
    if (cancelled()) throw new CancelledError();
    progress('statusline', 'active', `${config.statuslineTheme}...`);
    const settingsPath = installStatuslineFn({
      project: config.mode === 'project',
      theme: config.statuslineTheme,
    });
    statuslineInstalled = true;
    recordStatusline(manifest, { settingsPath, theme: config.statuslineTheme });
    progress('statusline', 'done', config.statuslineTheme);
  }

  // --- Claude MCP ---
  if (config.installMcp) {
    if (cancelled()) throw new CancelledError();
    progress('mcp', 'active', 'Registering...');
    const path = addMcpServer(config.mode, config.projectPath, config.mcpTools, config.mcpProjectRoot || undefined);
    mcpRegistered = !!path;
    if (path) {
      recordClaudeMcp(manifest, { configPath: path, serverName: 'maestro-tools' });
    }
    progress('mcp', 'done', mcpRegistered ? 'maestro-tools registered' : 'skipped');
  }

  // --- Codex Hooks ---
  if (config.installCodexHooks && (config.codexHookLevel !== 'none' || config.codexHooksSelection?.selectedHooks?.length)) {
    if (cancelled()) throw new CancelledError();
    progress('codexHooks', 'active', `${config.codexHookLevel}...`);
    const result = installCodexHooksByLevel(config.codexHookLevel, {
      project: config.mode === 'project',
      selectedHooks: config.codexHooksSelection?.isCustom ? config.codexHooksSelection.selectedHooks : undefined,
    });
    codexHooksInstalled = result.installedHooks.length;
    recordCodexHooks(manifest, {
      settingsPath: result.settingsPath,
      installed: result.installedHooks,
      level: config.codexHookLevel,
    });
    progress('codexHooks', 'done', `${codexHooksInstalled} hooks`);
  }

  // --- Codex MCP ---
  if (config.installCodexMcp) {
    if (cancelled()) throw new CancelledError();
    progress('codexMcp', 'active', 'Registering...');
    const path = addCodexMcpServer(config.mode, config.projectPath, config.codexMcpTools, config.codexMcpProjectRoot || undefined);
    codexMcpRegistered = !!path;
    if (path) {
      recordCodexMcp(manifest, { configPath: path, serverName: 'maestro-tools' });
    }
    progress('codexMcp', 'done', codexMcpRegistered ? 'registered' : 'skipped');
  }

  // --- Agy Hooks ---
  if (config.installAgyHooks && (config.agyHookLevel !== 'none' || config.agyHooksSelection?.selectedHooks?.length)) {
    if (cancelled()) throw new CancelledError();
    progress('agyHooks', 'active', `${config.agyHookLevel}...`);
    const result = installAgyHooksByLevel(config.agyHookLevel, {
      project: config.mode === 'project',
      projectPath: config.mode === 'project' ? config.projectPath : undefined,
      selectedHooks: config.agyHooksSelection?.isCustom ? config.agyHooksSelection.selectedHooks : undefined,
    });
    agyHooksInstalled = result.installedHooks.length;
    recordAgyHooks(manifest, {
      settingsPath: result.settingsPath,
      installed: result.installedHooks,
      level: config.agyHookLevel,
    });
    progress('agyHooks', 'done', `${agyHooksInstalled} hooks`);
  }

  // --- Generic platform hooks ---
  if (config.genericHookLevels) {
    for (const [platId, level] of Object.entries(config.genericHookLevels)) {
      if (level === 'none') continue;
      if (cancelled()) throw new CancelledError();
      const stepId = `ghooks-${platId}` as StepName;
      progress(stepId, 'active', `${level}...`);
      const result = installGenericHooksByLevel(platId, level, {
        project: config.mode === 'project',
      });
      genericHooksInstalled[platId] = result.installedHooks.length;
      recordGenericHooks(manifest, platId, {
        settingsPath: result.settingsPath,
        installed: result.installedHooks,
        level,
      });
      progress(stepId, 'done', `${result.installedHooks.length} hooks`);
    }
  }

  // --- Extra MCP ---
  if (config.installExtraMcp && config.extraMcpTargetIds.length > 0) {
    progress('extraMcp', 'active', 'Registering targets...');
    for (const targetId of config.extraMcpTargetIds) {
      if (cancelled()) throw new CancelledError();
      const path = addExtraMcpServer(
        targetId, config.mode, config.projectPath,
        config.mcpTools, config.mcpProjectRoot || undefined,
      );
      if (path) {
        extraMcpRegistered.push(targetId);
        recordExtraMcp(manifest, { targetId, configPath: path, serverName: 'maestro-tools' });
      } else {
        extraMcpFailed.push(targetId);
      }
    }
    progress('extraMcp', 'done', `${extraMcpRegistered.length} targets`);
  }

  // --- Codex skill deduplication ---
  if (config.codexDedupeAgents) {
    removeCodexSkillDedupeConfig(config.mode, config.projectPath);
    const count = writeCodexSkillDedupeConfig(config.mode, config.projectPath);
    if (count > 0) progress('manifest', 'active', `Codex dedupe: ${count} .agents/ skills disabled`);
  }

  // --- Plugin registration ---
  if (config.installPluginClaude || config.installPluginCodex) {
    if (cancelled()) throw new CancelledError();
    progress('plugin', 'active', 'Registering native plugin...');
    try {
      const { installPlugin } = await import('./plugin-bridge.js');
      const pluginResult = installPlugin(pkgRoot, version, {
        claude: !!config.installPluginClaude,
        codex: !!config.installPluginCodex,
      });
      const parts: string[] = [];
      if (pluginResult.claude.success) parts.push(`Claude: ${pluginResult.claude.detail}`);
      if (pluginResult.codex.success) parts.push(`Codex: ${pluginResult.codex.detail}`);
      manifest.plugin = {
        claude: pluginResult.claude.success,
        codex: pluginResult.codex.success,
      };
      progress('plugin', 'done', parts.join('; ') || 'no platforms available');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      progress('plugin', 'error', msg);
    }
  }

  // --- CLI tools config ---
  const { initCliToolsConfig } = await import('../config/cli-tools-config.js');
  await initCliToolsConfig();

  // --- Save manifest ---
  if (cancelled()) throw new CancelledError();
  progress('manifest', 'active', 'Saving...');
  if (sharedManifest) {
    saveManifest(sharedManifest, { expectedPriorId: globalPrior?.id ?? null });
  }
  const manifestPath = saveManifest(manifest, { expectedPriorId: prior?.id ?? null });
  progress('manifest', 'done', 'saved');

  return {
    filesInstalled, dirsCreated, filesSkipped,
    hooksInstalled, mcpRegistered,
    codexHooksInstalled, codexMcpRegistered,
    agyHooksInstalled, genericHooksInstalled,
    extraMcpRegistered, extraMcpFailed,
    manifestPath,
    statuslineInstalled, backupPath, migrationWarnings: warnings,
  };
}

function copyPriorState(
  target: Manifest,
  prior: Manifest,
  includeEntry: (entry: Manifest['entries'][number]) => boolean = () => true,
): void {
  target.entries = prior.entries.filter(includeEntry).map((entry) => ({ ...entry }));
  if (prior.disabledItems) target.disabledItems = [...prior.disabledItems];
  if (prior.hooks) target.hooks = JSON.parse(JSON.stringify(prior.hooks));
  if (prior.statusline) target.statusline = { ...prior.statusline };
  if (prior.mcp) target.mcp = JSON.parse(JSON.stringify(prior.mcp));
  if (prior.plugin) target.plugin = { ...prior.plugin };
}

async function clearExplicitlyDisabledState(
  target: Manifest,
  prior: Manifest,
  config: InstallFlowConfig,
): Promise<void> {
  const disabled = config.explicitlyDisabled;
  if (!disabled) return;

  const genericRecords = (disabled.genericHooks ?? [])
    .filter((platformId) => prior.hooks?.generic?.[platformId])
    .map((platformId) => [platformId, prior.hooks!.generic![platformId]] as const);
  const unsupportedGenericPlatforms = genericRecords
    .filter(([platformId]) => !getGenericHooksPlatform(platformId))
    .map(([platformId]) => platformId);
  if (unsupportedGenericPlatforms.length > 0) {
    throw new Error(
      `Cannot safely remove generic hooks for unknown platforms: ${unsupportedGenericPlatforms.join(', ')}`,
    );
  }

  if (disabled.claudeHooks && prior.hooks?.claude) {
    uninstallClaudeHooks(prior.hooks.claude.settingsPath, prior.hooks.claude.installed);
    delete target.hooks?.claude;
    delete target.hookLevel;
  }
  if (disabled.codexHooks && prior.hooks?.codex) {
    uninstallCodexHooks(prior.hooks.codex.settingsPath, prior.hooks.codex.installed);
    delete target.hooks?.codex;
  }
  if (disabled.agyHooks && prior.hooks?.agy) {
    uninstallAgyHooks(prior.hooks.agy.settingsPath, prior.hooks.agy.installed);
    delete target.hooks?.agy;
  }
  if (genericRecords.length > 0) {
    for (const [platformId, record] of genericRecords) {
      // Registered generic platforms explicitly use Codex-compatible hooks.json.
      uninstallCodexHooks(record.settingsPath, record.installed);
      delete target.hooks?.generic?.[platformId];
    }
    if (target.hooks?.generic && Object.keys(target.hooks.generic).length === 0) {
      delete target.hooks.generic;
    }
  }
  if (target.hooks && Object.keys(target.hooks).length === 0) delete target.hooks;

  if (disabled.statusline && prior.statusline) {
    removeClaudeStatusline(prior.statusline.settingsPath);
    delete target.statusline;
  }
  if (disabled.claudeMcp && prior.mcp?.claude) {
    removeMcpServerAt(prior.mcp.claude.configPath);
    delete target.mcp?.claude;
  }
  if (disabled.codexMcp && prior.mcp?.codex) {
    removeCodexMcpServerAt(prior.mcp.codex.configPath);
    delete target.mcp?.codex;
  }
  if (disabled.extraMcp && prior.mcp?.extras) {
    for (const record of prior.mcp.extras) {
      const spec = getExtraMcpTargetSpec(record.targetId as Parameters<typeof getExtraMcpTargetSpec>[0]);
      if (spec) removeExtraMcpServerAt(record.configPath, spec.format);
    }
    delete target.mcp?.extras;
  }
  if (target.mcp && Object.keys(target.mcp).length === 0) delete target.mcp;

  if ((disabled.pluginClaude && prior.plugin?.claude) || (disabled.pluginCodex && prior.plugin?.codex)) {
    const { uninstallPlugin } = await import('./plugin-bridge.js');
    uninstallPlugin({
      claude: disabled.pluginClaude && !!prior.plugin?.claude,
      codex: disabled.pluginCodex && !!prior.plugin?.codex,
    });
  }
  if (disabled.pluginClaude) delete target.plugin?.claude;
  if (disabled.pluginCodex) delete target.plugin?.codex;
  if (target.plugin && !target.plugin.claude && !target.plugin.codex) delete target.plugin;
}

function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Recursively scan a build-output directory and add all files/dirs to the
 * manifest so uninstall can track them. Build callbacks write directly to
 * the target without going through copyRecursive, so the manifest would
 * otherwise miss these files entirely.
 */
function trackBuildOutput(dir: string, manifest: import('./manifest.js').Manifest): void {
  if (!existsSync(dir)) return;
  const st = statSync(dir);
  if (st.isFile()) { addFile(manifest, dir); return; }
  addDir(manifest, dir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      trackBuildOutput(fullPath, manifest);
    } else {
      addFile(manifest, fullPath);
    }
  }
}

export class CancelledError extends Error {
  constructor() { super('Install cancelled'); }
}
