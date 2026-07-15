// ---------------------------------------------------------------------------
// Shared install executor — single pipeline for both TUI and CLI
//
// Both InstallExecution (Ink TUI) and forceInstall (CLI) consume this.
// Progress is reported via an optional callback; callers decide how to display.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
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
  pruneOrphans,
  injectDocFile,
  createTargetBackup,
  uninstallManifest,
  writeCodexSkillDedupeConfig,
  removeCodexSkillDedupeConfig,
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
  recordStatusline,
  recordClaudeMcp,
  recordCodexMcp,
  recordExtraMcp,
} from './manifest.js';
import {
  installHooksByLevel,
  installCodexHooksByLevel,
  installAgyHooksByLevel,
  installGenericHooksByLevel,
  installStatusline as installStatuslineFn,
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

  // Pre-scan components once (shared by backup + component-install phases)
  const components = (config.installComponents || config.backupClaudeMd || config.backupAll)
    ? scanComponents(pkgRoot, config.mode, config.projectPath)
        .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id))
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
  progress('cleanup', 'active', 'Removing prior install...');
  const disabledItems = scanDisabledItems(targetBase);
  const prior = findManifest(config.mode, targetPath);
  if (prior) {
    uninstallManifest(prior, { skipContentManaged: true });
  }
  progress('cleanup', 'done', prior ? 'prior manifest removed' : 'clean slate');

  // --- Fresh manifest ---
  paths.ensure(paths.home);
  const manifest = createManifest(config.mode, targetPath, {
    ...(config.installHooks && config.hookLevel !== 'none'
      ? { hookLevel: config.hookLevel }
      : {}),
    selectedComponentIds: config.installComponents ? config.selectedComponentIds : [],
  });
  if (prior?.disabledItems?.length) {
    manifest.disabledItems = prior.disabledItems;
  }
  // Save manifest early so interrupted installs leave a trackable manifest on disk
  saveManifest(manifest);

  // --- Components ---
  if (config.installComponents) {
    if (cancelled()) throw new CancelledError();
    const stats: CopyStats = { files: 0, dirs: 0, skipped: 0 };
    const total = components.length;

    for (let i = 0; i < total; i++) {
      const comp = components[i];
      if (cancelled()) throw new CancelledError();
      progress('components', 'active', `[${i + 1}/${total}] ${comp.def.label}`);
      if (comp.def.build) {
        const result = comp.def.build(join(pkgRoot, '.claude'), comp.targetDir);
        stats.files += result.files;
        trackBuildOutput(comp.targetDir, manifest);
      } else if (comp.def.inject) {
        const result = injectDocFile(comp.sourceFull, comp.targetDir, stats, manifest, comp.def.section);
        if (result.warning) warnings.push(result.warning);
      } else {
        copyRecursive(comp.sourceFull, comp.targetDir, stats, manifest, comp.def.fileFilter);
      }
    }

    // --- Prune orphans: remove files in target that no longer exist in source ---
    let pruned = 0;
    for (const comp of components) {
      if (comp.def.build || comp.def.inject) continue;
      pruned += pruneOrphans(comp.sourceFull, comp.targetDir, comp.def.fileFilter);
    }
    if (pruned > 0) {
      progress('components', 'active', `Pruned ${pruned} orphan files`);
    }

    if (cancelled()) throw new CancelledError();
    const versionPath = join(paths.home, 'version.json');
    writeFileSync(versionPath, JSON.stringify({
      version, installedAt: new Date().toISOString(), installer: 'maestro',
    }, null, 2), 'utf-8');
    addFile(manifest, versionPath);

    restoreDisabledState(disabledItems, targetBase);
    applyOverlaysPostInstall(config.mode, targetBase);

    filesInstalled = stats.files;
    dirsCreated = stats.dirs;
    filesSkipped = stats.skipped;
    progress('components', 'done', `${filesInstalled} files`);
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
  } else {
    removeCodexSkillDedupeConfig(config.mode, config.projectPath);
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
  const manifestPath = saveManifest(manifest);
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
