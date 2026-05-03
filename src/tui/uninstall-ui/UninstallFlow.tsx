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
import { t } from '../../i18n/index.js';

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
  const grouped = useMemo(() => groupEntries(selected.entries ?? []), [selected]);
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
    ...(manifests.length > 1 ? [{ key: 'select', label: t.uninstall.stepSelect }] : []),
    { key: 'detail', label: t.uninstall.stepDetail },
    { key: 'confirm', label: t.uninstall.stepConfirm },
    { key: 'executing', label: t.uninstall.stepUninstall },
    { key: 'complete', label: t.uninstall.stepDone },
  ];
  const stepIndex = progressSteps.findIndex((s) => s.key === step);

  const safeEntries = selected.entries ?? [];
  const fileCount = safeEntries.filter((e) => e.type === 'file').length;
  const dirCount = safeEntries.filter((e) => e.type === 'dir').length;
  const visibleLines = Math.max(1, termRows - 14);

  const timeStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toString().padStart(2, '0')}s`
    : `${elapsed}s`;

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Gradient name="retro">
            <BigText text="MAESTRO" font="slick" />
          </Gradient>
          <Box marginTop={-2}>
            <Text dimColor>
              <BigText text="flow" font="slick" />
            </Text>
          </Box>
          <Box marginLeft={2}>
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
            <Text bold color="cyan">{t.uninstall.selectTitle}</Text>
            <Box flexDirection="column" marginTop={1}>
              {manifests.map((m, i) => {
                const hl = i === selectedIndex;
                const date = m.installedAt.split('T')[0];
                const files = (m.entries ?? []).filter((e) => e.type === 'file').length;
                return (
                  <Box key={m.id}>
                    <Text color={hl ? 'cyan' : 'gray'}>{hl ? '>' : ' '} </Text>
                    <Text color={hl ? 'cyan' : undefined} bold={hl}>
                      [{m.scope}]
                    </Text>
                    <Text> {m.targetPath} </Text>
                    <Text dimColor>
                      ({t.uninstall.selectFileDate
                        .replace('{files}', String(files))
                        .replace('{date}', date)})
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Detail — scrollable file list */}
        {step === 'detail' && (
          <Box flexDirection="column">
            <Text bold color="cyan">{t.uninstall.detailTitle}</Text>

            <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
              <Box>
                <Text bold>{t.uninstall.detailScope.padEnd(12)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.detailTarget.padEnd(12)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.detailFiles.padEnd(12)}</Text>
                <Text>{t.uninstall.detailFiles
                  .replace('{files}', String(fileCount))
                  .replace('{dirs}', String(dirCount))
                  .replace(/^.{12}/, '')}</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.detailInstalled.padEnd(12)}</Text>
                <Text>{selected.installedAt.split('T')[0]}</Text>
              </Box>
            </Box>

            <Text bold color="cyan" dimColor>
              {'\n'}{t.uninstall.detailFilesRange
                .replace('{from}', String(detailScroll + 1))
                .replace('{to}', String(Math.min(detailScroll + visibleLines, detailLines.length)))
                .replace('{total}', String(detailLines.length))}
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
                {detailScroll > 0 ? '▲' : ' '} {t.uninstall.detailScroll} {detailScroll < maxScroll ? '▼' : ' '}
              </Text>
            )}
          </Box>
        )}

        {/* Confirm */}
        {step === 'confirm' && (
          <Box flexDirection="column">
            <Text bold color="yellow">{t.uninstall.confirmTitle}</Text>
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
              <Box>
                <Text bold>{t.uninstall.confirmScope.padEnd(12)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.confirmTarget.padEnd(12)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.confirmRemove.padEnd(12)}</Text>
                <Text color="red">{fileCount} files, {dirCount} dirs</Text>
              </Box>
              <Box>
                <Text bold>{t.uninstall.confirmCleanup.padEnd(12)}</Text>
                <Text>MCP config + hooks + overlays</Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text color="yellow">{t.uninstall.confirmCannotUndo}</Text>
            </Box>
          </Box>
        )}

        {/* Executing */}
        {step === 'executing' && !error && (
          <Box flexDirection="column">
            <Box>
              <Text color="cyan"><Spinner type="dots" /></Text>
              <Text> {t.uninstall.executingText}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>{t.uninstall.executingElapsed.replace('{time}', timeStr)}</Text>
            </Box>
          </Box>
        )}

        {error && (
          <Box flexDirection="column">
            <Text color="red" bold>{t.uninstall.execFailed}</Text>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {/* Complete */}
        {step === 'complete' && result && (
          <Box flexDirection="column">
            <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
              <Text bold color="green">{t.uninstall.resultTitle}</Text>
              <Box>
                <Text color="cyan">{'Removed:'.padEnd(13)}</Text>
                <Text color="green">{t.uninstall.resultRemoved.replace('{count}', String(result.filesRemoved))}</Text>
              </Box>
              {result.filesSkipped > 0 && (
                <Box>
                  <Text color="cyan">{'Preserved:'.padEnd(13)}</Text>
                  <Text>{t.uninstall.resultPreserved.replace('{count}', String(result.filesSkipped))}</Text>
                </Box>
              )}
              <Box>
                <Text color="cyan">{'MCP:'.padEnd(13)}</Text>
                <Text color={result.mcpCleaned ? 'green' : 'gray'}>
                  {result.mcpCleaned ? t.uninstall.resultMcpCleaned : t.uninstall.resultMcpNotFound}
                </Text>
              </Box>
              <Box>
                <Text color="cyan">{'Hooks:'.padEnd(13)}</Text>
                <Text color={result.hooksCleaned ? 'green' : 'gray'}>
                  {result.hooksCleaned ? t.uninstall.resultHooksRemoved : t.uninstall.resultHooksNotFound}
                </Text>
              </Box>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>{t.uninstall.resultRestart}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          {step === 'select' && t.uninstall.footerSelect}
          {step === 'detail' && t.uninstall.footerDetail}
          {step === 'confirm' && t.uninstall.footerConfirm}
          {step === 'executing' && t.uninstall.footerExecuting}
          {step === 'complete' && t.uninstall.footerComplete}
        </Text>
      </Box>
    </Box>
  );
}
