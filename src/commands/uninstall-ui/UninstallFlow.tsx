import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import Spinner from 'ink-spinner';
import { join, basename, dirname } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  cleanManifestFiles,
  deleteManifest,
  type Manifest,
  type ManifestEntry,
} from '../../core/manifest.js';
import { deleteOverlayManifest } from '../../core/overlay/applier.js';
import { removeMcpServer } from '../install-backend.js';
import {
  removeMaestroHooks,
  loadClaudeSettings,
  getClaudeSettingsPath,
} from '../hooks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'select' | 'detail' | 'confirm' | 'executing' | 'complete';

interface UninstallResult {
  filesRemoved: number;
  filesSkipped: number;
  mcpCleaned: boolean;
  hooksCleaned: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function executeUninstall(manifest: Manifest): UninstallResult {
  const { removed, skipped } = cleanManifestFiles(manifest);

  const targetBase = manifest.scope === 'global' ? homedir() : manifest.targetPath;
  deleteOverlayManifest(manifest.scope, targetBase);

  const mcpCleaned = removeMcpServer(manifest.scope, manifest.targetPath);

  let hooksCleaned = false;
  const settingsPath = manifest.scope === 'global'
    ? getClaudeSettingsPath()
    : join(manifest.targetPath, '.claude', 'settings.json');

  if (existsSync(settingsPath)) {
    const settings = loadClaudeSettings(settingsPath);
    const hadHooks = !!settings.hooks;
    if (settings.statusLine?.command?.includes('maestro')) delete settings.statusLine;
    removeMaestroHooks(settings);
    if (hadHooks && !settings.hooks) hooksCleaned = true;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  deleteManifest(manifest);
  return { filesRemoved: removed, filesSkipped: skipped, mcpCleaned, hooksCleaned };
}

/** Group manifest entries by parent directory for display. */
function groupEntries(entries: ManifestEntry[]): { dir: string; files: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const dir = dirname(e.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(basename(e.path));
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({ dir, files: files.sort() }));
}

// ---------------------------------------------------------------------------
// UninstallFlow
// ---------------------------------------------------------------------------

interface UninstallFlowProps {
  manifests: Manifest[];
}

export function UninstallFlow({ manifests }: UninstallFlowProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 30;

  const [step, setStep] = useState<FlowStep>(manifests.length === 1 ? 'detail' : 'select');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<Manifest>(manifests[0]);
  const [detailScroll, setDetailScroll] = useState(0);
  const [result, setResult] = useState<UninstallResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Grouped entries for detail view
  const grouped = useMemo(() => groupEntries(selected.entries), [selected]);
  const detailLines = useMemo(() => {
    const lines: string[] = [];
    for (const g of grouped) {
      lines.push(g.dir);
      for (const f of g.files) lines.push(`  ${f}`);
    }
    return lines;
  }, [grouped]);

  const maxScroll = Math.max(0, detailLines.length - (termRows - 14));

  // Timer
  useEffect(() => {
    if (step !== 'executing') return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [step]);

  // Execute
  useEffect(() => {
    if (step !== 'executing') return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      try {
        const r = executeUninstall(selected);
        if (!cancelled) { setResult(r); setStep('complete'); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [step, selected]);

  useInput((input, key) => {
    if (step === 'executing') return;

    if (key.escape) {
      if (step === 'detail') {
        if (manifests.length > 1) { setStep('select'); setDetailScroll(0); }
        else exit();
      } else if (step === 'confirm') {
        setStep('detail');
      } else {
        exit();
      }
      return;
    }

    if (step === 'select') {
      if (key.upArrow) setSelectedIndex((i) => (i <= 0 ? manifests.length - 1 : i - 1));
      else if (key.downArrow) setSelectedIndex((i) => (i >= manifests.length - 1 ? 0 : i + 1));
      else if (key.return) {
        setSelected(manifests[selectedIndex]);
        setDetailScroll(0);
        setStep('detail');
      }
    } else if (step === 'detail') {
      if (key.upArrow) setDetailScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow) setDetailScroll((s) => Math.min(maxScroll, s + 1));
      else if (key.return) setStep('confirm');
    } else if (step === 'confirm') {
      if (key.return) setStep('executing');
    } else if (step === 'complete') {
      if (key.return) exit();
    }
  });

  // Progress
  const progressSteps = [
    ...(manifests.length > 1 ? [{ key: 'select', label: 'Select' }] : []),
    { key: 'detail', label: 'Detail' },
    { key: 'confirm', label: 'Confirm' },
    { key: 'executing', label: 'Uninstall' },
    { key: 'complete', label: 'Done' },
  ];
  const stepIndex = progressSteps.findIndex((s) => s.key === step);

  const fileCount = selected.entries.filter((e) => e.type === 'file').length;
  const dirCount = selected.entries.filter((e) => e.type === 'dir').length;
  const visibleLines = Math.max(1, termRows - 14);

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Gradient name="retro">
            <BigText text="MAESTRO-FLOW" font="slick" />
          </Gradient>
          <Box flexDirection="column" justifyContent="center" marginLeft={1}>
            <Text dimColor>uninstall</Text>
          </Box>
        </Box>
        <Box gap={1}>
          {progressSteps.map((s, i) => (
            <Text
              key={s.key}
              bold={s.key === step}
              color={i < stepIndex ? 'green' : s.key === step ? 'cyan' : 'gray'}
            >
              {i < stepIndex ? '[x]' : s.key === step ? '[>]' : '[ ]'} {s.label}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>

        {/* Select */}
        {step === 'select' && (
          <Box flexDirection="column">
            <Text bold color="cyan">Select installation to remove:</Text>
            <Box flexDirection="column" marginTop={1}>
              {manifests.map((m, i) => {
                const hl = i === selectedIndex;
                const date = m.installedAt.split('T')[0];
                const files = m.entries.filter((e) => e.type === 'file').length;
                return (
                  <Box key={m.id}>
                    <Text color={hl ? 'cyan' : 'gray'}>{hl ? '>' : ' '} </Text>
                    <Text color={hl ? 'cyan' : undefined} bold={hl}>
                      [{m.scope}]
                    </Text>
                    <Text> {m.targetPath} </Text>
                    <Text dimColor>({files} files, {date})</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Detail — scrollable file list */}
        {step === 'detail' && (
          <Box flexDirection="column">
            <Text bold color="cyan">Installation Detail</Text>

            <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
              <Box>
                <Text bold>{'Scope:'.padEnd(12)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{'Target:'.padEnd(12)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{'Files:'.padEnd(12)}</Text>
                <Text>{fileCount} files, {dirCount} dirs</Text>
              </Box>
              <Box>
                <Text bold>{'Installed:'.padEnd(12)}</Text>
                <Text>{selected.installedAt.split('T')[0]}</Text>
              </Box>
            </Box>

            <Text bold color="cyan" dimColor>
              {'\n'}Files ({detailScroll + 1}-{Math.min(detailScroll + visibleLines, detailLines.length)} of {detailLines.length}):
            </Text>
            <Box flexDirection="column">
              {detailLines.slice(detailScroll, detailScroll + visibleLines).map((line, i) => {
                const isDir = !line.startsWith('  ');
                return (
                  <Text key={detailScroll + i} color={isDir ? 'yellow' : undefined} dimColor={!isDir}>
                    {line}
                  </Text>
                );
              })}
            </Box>
            {maxScroll > 0 && (
              <Text dimColor>
                {detailScroll > 0 ? '▲' : ' '} scroll {detailScroll < maxScroll ? '▼' : ' '}
              </Text>
            )}
          </Box>
        )}

        {/* Confirm */}
        {step === 'confirm' && (
          <Box flexDirection="column">
            <Text bold color="yellow">Confirm Uninstall</Text>
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
              <Box>
                <Text bold>{'Scope:'.padEnd(12)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{'Target:'.padEnd(12)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{'Remove:'.padEnd(12)}</Text>
                <Text color="red">{fileCount} files, {dirCount} dirs</Text>
              </Box>
              <Box>
                <Text bold>{'Cleanup:'.padEnd(12)}</Text>
                <Text>MCP config + hooks + overlays</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text color="yellow">This action cannot be undone.</Text>
            </Box>
          </Box>
        )}

        {/* Executing */}
        {step === 'executing' && !error && (
          <Box flexDirection="column">
            <Box>
              <Text color="cyan"><Spinner type="dots" /></Text>
              <Text> Uninstalling...</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Elapsed: {elapsed}s</Text>
            </Box>
          </Box>
        )}

        {error && (
          <Box flexDirection="column">
            <Text color="red" bold>Uninstall failed</Text>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {/* Complete */}
        {step === 'complete' && result && (
          <Box flexDirection="column">
            <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
              <Text bold color="green">Uninstall Complete</Text>
              <Box>
                <Text color="cyan">{'Removed:'.padEnd(13)}</Text>
                <Text color="green">{result.filesRemoved} files</Text>
              </Box>
              {result.filesSkipped > 0 && (
                <Box>
                  <Text color="cyan">{'Preserved:'.padEnd(13)}</Text>
                  <Text>{result.filesSkipped} settings files</Text>
                </Box>
              )}
              <Box>
                <Text color="cyan">{'MCP:'.padEnd(13)}</Text>
                <Text color={result.mcpCleaned ? 'green' : 'gray'}>
                  {result.mcpCleaned ? 'config cleaned' : 'no config found'}
                </Text>
              </Box>
              <Box>
                <Text color="cyan">{'Hooks:'.padEnd(13)}</Text>
                <Text color={result.hooksCleaned ? 'green' : 'gray'}>
                  {result.hooksCleaned ? 'removed' : 'no hooks found'}
                </Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Restart Claude Code to pick up changes.</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          {step === 'select' && '[Up/Down] Navigate  [Enter] View detail  [Esc] Exit'}
          {step === 'detail' && '[Up/Down] Scroll files  [Enter] Proceed to uninstall  [Esc] Back'}
          {step === 'confirm' && '[Enter] Uninstall  [Esc] Back to detail'}
          {step === 'executing' && 'Uninstalling... please wait'}
          {step === 'complete' && '[Enter] Exit'}
        </Text>
      </Box>
    </Box>
  );
}
