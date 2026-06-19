import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import Spinner from 'ink-spinner';
import { basename, dirname } from 'node:path';
import { C, SYM, SP, BORDER, pad, wrapCursor, KeyHints, SectionHeader, CursorMarker, StepProgress } from '../shared/index.js';
import {
  type Manifest,
  type ManifestEntry,
} from '../../core/manifest.js';
import { uninstallManifest, type UninstallResult } from '../../commands/install-backend.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = 'select' | 'detail' | 'confirm' | 'executing' | 'complete';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function executeUninstall(manifest: Manifest): UninstallResult {
  return uninstallManifest(manifest);
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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStep('complete');
        }
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
      if (key.upArrow) setSelectedIndex((i) => wrapCursor(i, -1, manifests.length));
      else if (key.downArrow) setSelectedIndex((i) => wrapCursor(i, 1, manifests.length));
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
        <StepProgress steps={progressSteps} currentKey={step} />
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>

        {/* Select */}
        {step === 'select' && (
          <Box flexDirection="column">
            <SectionHeader title={t.uninstall.selectTitle} />
            <Box flexDirection="column" marginTop={SP.sectionGap}>
              {manifests.map((m, i) => {
                const hl = i === selectedIndex;
                const date = m.installedAt.split('T')[0];
                const files = (m.entries ?? []).filter((e) => e.type === 'file').length;
                return (
                  <Box key={m.id}>
                    <CursorMarker active={hl} />
                    <Text color={hl ? C.primary : undefined} bold={hl}>
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
            <SectionHeader title={t.uninstall.detailTitle} />

            <Box flexDirection="column" {...BORDER.detail} paddingX={SP.detailPadX} marginTop={SP.sectionGap}>
              <Box>
                <Text bold>{pad(t.uninstall.detailScope, SP.labelWidth)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.detailTarget, SP.labelWidth)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.detailFiles, SP.labelWidth)}</Text>
                <Text>{t.uninstall.detailFiles
                  .replace('{files}', String(fileCount))
                  .replace('{dirs}', String(dirCount))
                  .replace(/^.{12}/, '')}</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.detailInstalled, SP.labelWidth)}</Text>
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
                {detailScroll > 0 ? SYM.scrollUp : ' '} {t.uninstall.detailScroll} {detailScroll < maxScroll ? SYM.scrollDown : ' '}
              </Text>
            )}
          </Box>
        )}

        {/* Confirm */}
        {step === 'confirm' && (
          <Box flexDirection="column">
            <Text bold color={C.warning}>{t.uninstall.confirmTitle}</Text>
            <Box flexDirection="column" {...BORDER.warning} paddingX={SP.detailPadX} marginTop={SP.sectionGap}>
              <Box>
                <Text bold>{pad(t.uninstall.confirmScope, SP.labelWidth)}</Text>
                <Text>{selected.scope}</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.confirmTarget, SP.labelWidth)}</Text>
                <Text>{selected.targetPath}</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.confirmRemove, SP.labelWidth)}</Text>
                <Text color={C.error}>{fileCount} files, {dirCount} dirs</Text>
              </Box>
              <Box>
                <Text bold>{pad(t.uninstall.confirmCleanup, SP.labelWidth)}</Text>
                <Text>MCP config + hooks + overlays</Text>
              </Box>
            </Box>
            <Box marginTop={SP.sectionGap}>
              <Text color={C.warning}>{t.uninstall.confirmCannotUndo}</Text>
            </Box>
          </Box>
        )}

        {/* Executing */}
        {step === 'executing' && !error && (
          <Box flexDirection="column">
            <Box>
              <Text color={C.primary}><Spinner type="dots" /></Text>
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
            <Box flexDirection="column" {...BORDER.success} paddingX={SP.detailPadX}>
              <Text bold color={C.success}>{t.uninstall.resultTitle}</Text>
              <Box>
                <Text color={C.primary}>{pad('Removed:', SP.labelWidth)}</Text>
                <Text color={C.success}>{t.uninstall.resultRemoved.replace('{count}', String(result.filesRemoved))}</Text>
              </Box>
              {result.filesSkipped > 0 && (
                <Box>
                  <Text color={C.primary}>{pad('Preserved:', SP.labelWidth)}</Text>
                  <Text>{t.uninstall.resultPreserved.replace('{count}', String(result.filesSkipped))}</Text>
                </Box>
              )}
              {(result.claudeHooksRemoved + result.codexHooksRemoved + result.agyHooksRemoved) > 0 && (
                <Box>
                  <Text color={C.primary}>{pad('Hooks:', SP.labelWidth)}</Text>
                  <Text color={C.success}>
                    {[
                      result.claudeHooksRemoved && `${result.claudeHooksRemoved} claude`,
                      result.codexHooksRemoved && `${result.codexHooksRemoved} codex`,
                      result.agyHooksRemoved && `${result.agyHooksRemoved} agy`,
                    ].filter(Boolean).join(', ')}
                  </Text>
                </Box>
              )}
              <Box>
                <Text color={C.primary}>{pad('Statusline:', SP.labelWidth)}</Text>
                <Text color={result.statuslineRemoved ? C.success : C.neutral}>
                  {result.statuslineRemoved ? 'removed' : 'not installed'}
                </Text>
              </Box>
              <Box>
                <Text color={C.primary}>{pad('MCP:', SP.labelWidth)}</Text>
                <Text color={(result.mcpRemoved.claude || result.mcpRemoved.codex || result.mcpRemoved.extras.length > 0) ? C.success : C.neutral}>
                  {[
                    result.mcpRemoved.claude && 'claude',
                    result.mcpRemoved.codex && 'codex',
                    result.mcpRemoved.extras.length > 0 && result.mcpRemoved.extras.join('+'),
                  ].filter(Boolean).join(', ') || t.uninstall.resultMcpNotFound}
                </Text>
              </Box>
            </Box>
            <Box marginTop={SP.sectionGap}>
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
