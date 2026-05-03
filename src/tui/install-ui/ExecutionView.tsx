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
  createBackup,
  type ScannedComponent,
  type CopyStats,
} from '../../commands/install-backend.js';
import {
  createManifest,
  addFile,
  saveManifest,
  findManifest,
  cleanManifestFiles,
} from '../../core/manifest.js';
import { installHooksByLevel, type HookLevel } from '../../commands/hooks.js';
import { type InstallConfig, type InstallResult } from './types.js';

// ---------------------------------------------------------------------------
// ExecutionView -- animated progress during install
// ---------------------------------------------------------------------------

interface ExecutionViewProps {
  components: ScannedComponent[];
  config: InstallConfig;
  pkgRoot: string;
  version: string;
  onComplete: (result: InstallResult) => void;
}

export function ExecutionView({
  components,
  config,
  pkgRoot,
  version,
  onComplete,
}: ExecutionViewProps) {
  const [status, setStatus] = useState('Scanning...');
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Install orchestration
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const targetBase =
          config.mode === 'global' ? homedir() : config.projectPath;
        const targetPath =
          config.mode === 'global' ? paths.home : config.projectPath;

        // 1. Scan disabled items
        if (cancelled) return;
        setStatus('Scanning disabled items...');
        const disabledItems = scanDisabledItems(targetBase);

        // 2. Backup if requested
        if (config.doBackup) {
          const existingManifest = findManifest(config.mode, targetPath);
          if (existingManifest) {
            if (cancelled) return;
            setStatus('Creating backup...');
            createBackup(existingManifest);
          }
        }

        // 3. Clean previous installation
        const existingManifest = findManifest(config.mode, targetPath);
        if (existingManifest) {
          if (cancelled) return;
          setStatus('Cleaning previous installation...');
          cleanManifestFiles(existingManifest, { skipContentManaged: true });
        }

        // 4. Ensure home directory exists
        paths.ensure(paths.home);

        // 5. Create manifest
        if (cancelled) return;
        setStatus('Creating manifest...');
        const manifest = createManifest(config.mode, targetPath, {
          hookLevel: config.hookLevel,
          selectedComponentIds: config.selectedIds,
        });
        const totalStats: CopyStats = { files: 0, dirs: 0, skipped: 0 };

        // 6. Copy components
        const selectedComponents = components.filter((c) =>
          config.selectedIds.includes(c.def.id),
        );

        for (let i = 0; i < selectedComponents.length; i++) {
          if (cancelled) return;
          const comp = selectedComponents[i];
          setStatus(`Installing ${comp.def.label}...`);
          const beforeFiles = totalStats.files;
          copyRecursive(comp.sourceFull, comp.targetDir, totalStats, manifest);
          const delta = totalStats.files - beforeFiles;
          setProgress(`(${delta} files)`);
        }

        // 7. Write version.json
        if (cancelled) return;
        setStatus('Writing version marker...');
        const versionData = {
          version,
          installedAt: new Date().toISOString(),
          installer: 'maestro',
        };
        const versionPath = join(paths.home, 'version.json');
        writeFileSync(versionPath, JSON.stringify(versionData, null, 2), 'utf-8');
        addFile(manifest, versionPath);
        totalStats.files++;

        // 8. Restore disabled state
        if (cancelled) return;
        setStatus('Restoring disabled state...');
        const disabledRestored = restoreDisabledState(disabledItems, targetBase);

        // 9. Apply overlays
        if (cancelled) return;
        setStatus('Applying overlays...');
        const overlaysApplied = applyOverlaysPostInstall(config.mode, targetBase);

        // 10. MCP registration
        let mcpRegistered = false;
        if (config.mcpEnabled && config.mcpTools.length > 0) {
          if (cancelled) return;
          setStatus('Registering MCP server...');
          mcpRegistered = addMcpServer(
            config.mode,
            config.projectPath,
            config.mcpTools,
            config.mcpProjectRoot || undefined,
          );
        }

        // 11. Hook installation
        let hookResult: { installedHooks: string[]; level: string } | null =
          null;
        if (config.hookLevel !== 'none') {
          if (cancelled) return;
          setStatus('Installing hooks...');
          const hookRes = installHooksByLevel(
            config.hookLevel as HookLevel,
            { project: config.mode === 'project' },
          );
          hookResult = {
            installedHooks: hookRes.installedHooks,
            level: config.hookLevel,
          };
        }

        // 12. Save manifest
        if (cancelled) return;
        setStatus('Saving manifest...');
        const manifestPath = saveManifest(manifest);

        // Complete
        setDone(true);
        setStatus('Installation complete');
        setProgress('');
        onComplete({
          totalStats,
          manifestPath,
          mcpRegistered,
          hookResult,
          disabledRestored,
          overlaysApplied,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr =
    minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red" bold>
          Installation failed
        </Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {done ? (
          <Text color="green" bold>
            {'  '}Done
          </Text>
        ) : (
          <Box>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> {status}</Text>
          </Box>
        )}
        {progress && <Text> {progress}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Elapsed: {timeStr}</Text>
      </Box>
    </Box>
  );
}
