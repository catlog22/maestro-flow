// ---------------------------------------------------------------------------
// Shared install executor — single pipeline for both TUI and CLI
//
// Both InstallExecution (Ink TUI) and forceInstall (CLI) consume this.
// Progress is reported via an optional callback; callers decide how to display.
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
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
  uninstallManifest,
  type CopyStats,
} from '../commands/install-backend.js';
import {
  createManifest,
  addFile,
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
  extraMcpRegistered: string[];
  extraMcpFailed: string[];
  manifestPath: string;
  statuslineInstalled: boolean;
  backupPath: string | null;
  migrationWarnings: string[];
}

export type StepName =
  | 'backup' | 'cleanup' | 'components' | 'hooks' | 'statusline'
  | 'mcp' | 'codexHooks' | 'codexMcp' | 'agyHooks' | 'extraMcp' | 'manifest';

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
  const extraMcpRegistered: string[] = [];
  const extraMcpFailed: string[] = [];
  let statuslineInstalled = false;
  let backupPath: string | null = null;
  const warnings: string[] = [];

  // --- Backup ---
  if (config.backupClaudeMd || config.backupAll) {
    if (cancelled()) throw new CancelledError();
    progress('backup', 'active', 'Creating backup...');
    const components = scanComponents(pkgRoot, config.mode, config.projectPath)
      .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));
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
    progress('components', 'active', 'Scanning...');
    const stats: CopyStats = { files: 0, dirs: 0, skipped: 0 };
    const components = scanComponents(pkgRoot, config.mode, config.projectPath)
      .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));

    for (const comp of components) {
      if (cancelled()) throw new CancelledError();
      progress('components', 'active', comp.def.label);
      if (comp.def.build) {
        const result = comp.def.build(join(pkgRoot, '.claude'), comp.targetDir);
        stats.files += result.files;
      } else if (comp.def.inject) {
        const result = injectDocFile(comp.sourceFull, comp.targetDir, stats, manifest, comp.def.section);
        if (result.warning) warnings.push(result.warning);
      } else {
        copyRecursive(comp.sourceFull, comp.targetDir, stats, manifest, comp.def.fileFilter);
      }
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
    agyHooksInstalled,
    extraMcpRegistered, extraMcpFailed,
    manifestPath,
    statuslineInstalled, backupPath, migrationWarnings: warnings,
  };
}

export class CancelledError extends Error {
  constructor() { super('Install cancelled'); }
}
