import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { paths } from '../../config/paths.js';
import { C } from '../shared/index.js';
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
} from '../../commands/install-backend.js';
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
} from '../../core/manifest.js';
import {
  installHooksByLevel,
  installCodexHooksByLevel,
  installAgyHooksByLevel,
  installStatusline as installStatuslineFn,
} from '../../commands/hooks.js';
import type { InstallFlowConfig } from './InstallConfirm.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallExecution — animated per-step progress
//
// Flow (idempotent re-install):
//   1. Find prior manifest for (scope, targetPath)
//   2. uninstallManifest(prior, { skipContentManaged: true }) — full reverse
//   3. createManifest() — fresh slate
//   4. For each enabled step: execute + record into new manifest
//   5. saveManifest()
// ---------------------------------------------------------------------------

export interface InstallFlowResult {
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

interface InstallExecutionProps {
  config: InstallFlowConfig;
  pkgRoot: string;
  version: string;
  onComplete: (result: InstallFlowResult) => void;
}

export function InstallExecution({ config, pkgRoot, version, onComplete }: InstallExecutionProps) {
  const [status, setStatus] = useState(t.install.execPreparing);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
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

        // --- Backup (before any destructive cleanup) ---
        if (config.installComponents && (config.backupClaudeMd || config.backupAll)) {
          if (cancelled) return;
          setStatus(t.install.execBackingUp);
          const components = scanComponents(pkgRoot, config.mode, config.projectPath)
            .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));
          backupPath = createTargetBackup(components, {
            backupClaudeMd: config.backupClaudeMd,
            backupAll: config.backupAll,
          });
        }

        // --- Full uninstall of prior installation ---
        if (cancelled) return;
        setStatus(t.install.execCleaning);
        const disabledItems = scanDisabledItems(targetBase);
        const prior = findManifest(config.mode, targetPath);
        if (prior) {
          // skipContentManaged: tag injection updates CLAUDE.md/AGENTS.md in
          // place, so don't strip them here — they'll be re-written below.
          uninstallManifest(prior, { skipContentManaged: true });
        }

        // --- Fresh manifest ---
        // Note: top-level `hookLevel` is a legacy field. Only write it when
        // Claude hooks are actually being installed; otherwise omit so the
        // next install's defaults aren't poisoned by a stale 'none'.
        paths.ensure(paths.home);
        const manifest = createManifest(config.mode, targetPath, {
          ...(config.installHooks && config.hookLevel !== 'none'
            ? { hookLevel: config.hookLevel }
            : {}),
          selectedComponentIds: config.installComponents ? config.selectedComponentIds : [],
        });

        // --- Components ---
        if (config.installComponents) {
          if (cancelled) return;
          setStatus(t.install.execScanning);
          const stats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

          const components = scanComponents(pkgRoot, config.mode, config.projectPath)
            .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));

          for (const comp of components) {
            if (cancelled) return;
            setStatus(t.install.execInstalling.replace('{name}', comp.def.label));
            if (comp.def.build) {
              const result = comp.def.build(join(pkgRoot, '.claude'), comp.targetDir);
              stats.files += result.files;
            } else if (comp.def.inject) {
              const result = injectDocFile(comp.sourceFull, comp.targetDir, stats, manifest, comp.def.section);
              if (result.warning) warnings.push(result.warning);
            } else {
              copyRecursive(comp.sourceFull, comp.targetDir, stats, manifest);
            }
          }

          // Version marker
          if (cancelled) return;
          setStatus(t.install.execWritingVersion);
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
        }

        // --- Hooks (Claude) ---
        // Statusline is NOT installed here — it has its own opt-in branch below.
        if (config.installHooks && config.hookLevel !== 'none') {
          if (cancelled) return;
          setStatus(t.install.execInstallingHooks.replace('{level}', config.hookLevel));
          const result = installHooksByLevel(config.hookLevel, {
            project: config.mode === 'project',
          });
          hooksInstalled = result.installedHooks.length;
          recordClaudeHooks(manifest, {
            settingsPath: result.settingsPath,
            installed: result.installedHooks,
            level: config.hookLevel,
          });
        }

        // --- Statusline (opt-in) ---
        if (config.installStatusline) {
          if (cancelled) return;
          setStatus(t.install.execInstallingStatusline);
          const settingsPath = installStatuslineFn({
            project: config.mode === 'project',
            theme: config.statuslineTheme,
          });
          statuslineInstalled = true;
          recordStatusline(manifest, {
            settingsPath,
            theme: config.statuslineTheme,
          });
        }

        // --- Claude MCP ---
        if (config.installMcp) {
          if (cancelled) return;
          setStatus(t.install.execRegisteringMcp);
          const path = addMcpServer(config.mode, config.projectPath, config.mcpTools, config.mcpProjectRoot || undefined);
          mcpRegistered = !!path;
          if (path) {
            recordClaudeMcp(manifest, { configPath: path, serverName: 'maestro-tools' });
          }
        }

        // --- Codex Hooks ---
        if (config.installCodexHooks) {
          if (cancelled) return;
          setStatus(t.install.execInstallingCodexHooks.replace('{level}', config.codexHookLevel));
          const result = installCodexHooksByLevel(config.codexHookLevel, {
            project: config.mode === 'project',
          });
          codexHooksInstalled = result.installedHooks.length;
          recordCodexHooks(manifest, {
            settingsPath: result.settingsPath,
            installed: result.installedHooks,
            level: config.codexHookLevel,
          });
        }

        // --- Codex MCP ---
        if (config.installCodexMcp) {
          if (cancelled) return;
          setStatus(t.install.execRegisteringCodexMcp);
          const path = addCodexMcpServer(config.mode, config.projectPath, config.codexMcpTools, config.codexMcpProjectRoot || undefined);
          codexMcpRegistered = !!path;
          if (path) {
            recordCodexMcp(manifest, { configPath: path, serverName: 'maestro-tools' });
          }
        }

        // --- Agy (Antigravity) Hooks ---
        if (config.installAgyHooks && config.agyHookLevel !== 'none') {
          if (cancelled) return;
          setStatus(t.install.execInstallingAgyHooks.replace('{level}', config.agyHookLevel));
          const result = installAgyHooksByLevel(config.agyHookLevel, {
            project: config.mode === 'project',
            projectPath: config.mode === 'project' ? config.projectPath : undefined,
          });
          agyHooksInstalled = result.installedHooks.length;
          recordAgyHooks(manifest, {
            settingsPath: result.settingsPath,
            installed: result.installedHooks,
            level: config.agyHookLevel,
          });
        }

        // --- Extra MCP targets ---
        if (config.installExtraMcp) {
          for (const targetId of config.extraMcpTargetIds) {
            if (cancelled) return;
            setStatus(`Registering MCP for ${targetId}...`);
            const path = addExtraMcpServer(
              targetId,
              config.mode,
              config.projectPath,
              config.mcpTools,
              config.mcpProjectRoot || undefined,
            );
            if (path) {
              extraMcpRegistered.push(targetId);
              recordExtraMcp(manifest, {
                targetId,
                configPath: path,
                serverName: 'maestro-tools',
              });
            } else {
              extraMcpFailed.push(targetId);
            }
          }
        }

        // --- CLI tools config ---
        if (!cancelled) {
          const { initCliToolsConfig } = await import('../../config/cli-tools-config.js');
          const result = await initCliToolsConfig();
          if (result.created) setStatus('Initialized cli-tools.json');
          else if (result.added.length > 0) setStatus(`cli-tools.json: added ${result.added.join(', ')}`);
        }

        // --- Save manifest (single write at the end) ---
        const manifestPath = saveManifest(manifest);

        setDone(true);
        setStatus(t.install.execComplete);
        onComplete({
          filesInstalled, dirsCreated, filesSkipped,
          hooksInstalled, mcpRegistered,
          codexHooksInstalled, codexMcpRegistered,
          agyHooksInstalled,
          extraMcpRegistered, extraMcpFailed,
          manifestPath,
          statuslineInstalled, backupPath, migrationWarnings: warnings,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    run();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const seconds = elapsed % 60;
  const timeStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={C.error} bold>{t.install.execFailed}</Text>
        <Text color={C.error}>{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {done ? (
          <Text color={C.success} bold>{t.install.execDone}</Text>
        ) : (
          <Box>
            <Text color={C.primary}><Spinner type="dots" /></Text>
            <Text> {status}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{t.install.execElapsed.replace('{time}', timeStr)}</Text>
      </Box>
    </Box>
  );
}
