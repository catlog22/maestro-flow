import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { paths } from '../../config/paths.js';
import {
  scanComponents,
  scanDisabledItems,
  restoreDisabledState,
  applyOverlaysPostInstall,
  addMcpServer,
  copyRecursive,
  createTargetBackup,
  type CopyStats,
} from '../install-backend.js';
import {
  createManifest,
  addFile,
  saveManifest,
  findManifest,
  cleanManifestFiles,
} from '../../core/manifest.js';
import { installHooksByLevel, installStatusline as installStatuslineFn, type HookLevel } from '../hooks.js';
import type { InstallFlowConfig } from './InstallConfirm.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallExecution — animated per-step progress
// ---------------------------------------------------------------------------

export interface InstallFlowResult {
  filesInstalled: number;
  dirsCreated: number;
  filesSkipped: number;
  hooksInstalled: number;
  mcpRegistered: boolean;
  manifestPath: string;
  statuslineInstalled: boolean;
  backupPath: string | null;
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
        let manifestPath = '';
        let filesInstalled = 0;
        let dirsCreated = 0;
        let filesSkipped = 0;
        let hooksInstalled = 0;
        let mcpRegistered = false;
        let statuslineInstalled = false;
        let backupPath: string | null = null;

        // Components
        if (config.installComponents) {
          if (cancelled) return;
          setStatus(t.install.execScanning);
          const disabledItems = scanDisabledItems(targetBase);

          // Backup before clean
          if (config.backupClaudeMd || config.backupAll) {
            if (cancelled) return;
            setStatus(t.install.execBackingUp);
            const components = scanComponents(pkgRoot, config.mode, config.projectPath)
              .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));
            backupPath = createTargetBackup(components, {
              backupClaudeMd: config.backupClaudeMd,
              backupAll: config.backupAll,
            });
          }

          if (cancelled) return;
          setStatus(t.install.execCleaning);
          const existing = findManifest(config.mode, targetPath);
          if (existing) cleanManifestFiles(existing);

          paths.ensure(paths.home);
          const manifest = createManifest(config.mode, targetPath);
          const stats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

          const components = scanComponents(pkgRoot, config.mode, config.projectPath)
            .filter((c) => c.available && config.selectedComponentIds.includes(c.def.id));

          for (const comp of components) {
            if (cancelled) return;
            setStatus(t.install.execInstalling.replace('{name}', comp.def.label));
            copyRecursive(comp.sourceFull, comp.targetDir, stats, manifest);
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
          manifestPath = saveManifest(manifest);

          filesInstalled = stats.files;
          dirsCreated = stats.dirs;
          filesSkipped = stats.skipped;
        }

        // Hooks (skip statusline if managed separately)
        if (config.installHooks) {
          if (cancelled) return;
          setStatus(t.install.execInstallingHooks.replace('{level}', config.hookLevel));
          const result = installHooksByLevel(config.hookLevel, {
            project: config.mode === 'project',
            skipStatusline: config.installStatusline,
          });
          hooksInstalled = result.installedHooks.length;
        }

        // Statusline (separate install)
        if (config.installStatusline) {
          if (cancelled) return;
          setStatus(t.install.execInstallingStatusline);
          installStatuslineFn({
            project: config.mode === 'project',
            style: config.statuslineStyle,
            nerdFont: config.statuslineNerdFont,
          });
          statuslineInstalled = true;
        }

        // MCP
        if (config.installMcp) {
          if (cancelled) return;
          setStatus(t.install.execRegisteringMcp);
          mcpRegistered = addMcpServer(config.mode, config.projectPath, config.mcpTools, config.mcpProjectRoot || undefined);
        }

        setDone(true);
        setStatus(t.install.execComplete);
        onComplete({ filesInstalled, dirsCreated, filesSkipped, hooksInstalled, mcpRegistered, manifestPath, statuslineInstalled, backupPath });
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
        <Text color="red" bold>{t.install.execFailed}</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {done ? (
          <Text color="green" bold>{t.install.execDone}</Text>
        ) : (
          <Box>
            <Text color="cyan"><Spinner type="dots" /></Text>
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
