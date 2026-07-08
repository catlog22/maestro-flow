import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { C, SYM } from '../shared/index.js';
import { executeInstallPipeline, CancelledError, type InstallResult, type StepName } from '../../core/install-executor.js';
import { GENERIC_HOOKS_PLATFORMS } from '../../commands/hooks.js';
import type { InstallFlowConfig } from './types.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallExecution — thin TUI renderer over the shared install executor
// ---------------------------------------------------------------------------

export type { InstallResult as InstallFlowResult } from '../../core/install-executor.js';

interface InstallExecutionProps {
  config: InstallFlowConfig;
  pkgRoot: string;
  version: string;
  onComplete: (result: InstallResult) => void;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface ExecutionStep {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
}

function StepRow({ step }: { step: ExecutionStep }) {
  const icon = step.status === 'done' ? SYM.checkOn
    : step.status === 'error' ? '✗'
    : step.status === 'active' ? ''
    : SYM.checkOff;

  const color = step.status === 'done' ? C.success
    : step.status === 'error' ? C.error
    : step.status === 'active' ? C.primary
    : C.neutral;

  return (
    <Box>
      {step.status === 'active' ? (
        <Text color={C.primary}><Spinner type="dots" /></Text>
      ) : (
        <Text color={color}>{icon}</Text>
      )}
      <Text color={color}> {step.label.padEnd(16)}</Text>
      <Text color={C.neutral}>{step.detail}</Text>
    </Box>
  );
}

function getStepLabels(): Record<string, string> {
  return {
    backup: t.install.hubLabelBackup,
    cleanup: t.install.execCleaning.replace('...', ''),
    components: t.install.hubLabelComponents,
    hooks: t.install.hubLabelHooks,
    statusline: t.install.hubLabelStatusline,
    mcp: t.install.hubLabelMcpServer,
    codexHooks: t.install.hubLabelCodexHooks,
    codexMcp: t.install.hubLabelCodexMcp,
    agyHooks: t.install.hubLabelAgyHooks,
    extraMcp: t.install.hubLabelExtraMcp,
    manifest: 'Manifest',
  };
}

export function InstallExecution({ config, pkgRoot, version, onComplete }: InstallExecutionProps) {
  const stepKeys = useMemo(() => {
    const keys: string[] = [];
    if (config.backupClaudeMd || config.backupAll) keys.push('backup');
    keys.push('cleanup');
    if (config.installComponents) keys.push('components');
    if (config.installHooks) keys.push('hooks');
    if (config.installStatusline) keys.push('statusline');
    if (config.installMcp) keys.push('mcp');
    if (config.installCodexHooks) keys.push('codexHooks');
    if (config.installCodexMcp) keys.push('codexMcp');
    if (config.installAgyHooks) keys.push('agyHooks');
    for (const [platId, level] of Object.entries(config.genericHookLevels)) {
      if (level !== 'none') keys.push(`ghooks-${platId}`);
    }
    if (config.installExtraMcp) keys.push('extraMcp');
    keys.push('manifest');
    return keys;
  }, [config]);

  const stepLabels = useMemo(() => {
    const labels = getStepLabels();
    for (const gp of GENERIC_HOOKS_PLATFORMS) {
      labels[`ghooks-${gp.id}`] = `${gp.label} Hooks`;
    }
    return labels;
  }, []);

  const [steps, setSteps] = useState<ExecutionStep[]>(() =>
    stepKeys.map((key) => ({
      key,
      label: stepLabels[key] ?? key,
      status: 'pending' as StepStatus,
      detail: '',
    })),
  );
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const ranRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const updateStep = (step: StepName, status: 'active' | 'done' | 'error', detail: string) => {
      setSteps((prev) => prev.map((s) => s.key === step ? { ...s, status, detail } : s));
    };

    executeInstallPipeline({
      config, pkgRoot, version,
      onProgress: updateStep,
      isCancelled: () => cancelledRef.current,
    }).then((result) => {
      onComplete(result);
    }).catch((err) => {
      if (err instanceof CancelledError) return;
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => { cancelledRef.current = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doneCount = steps.filter((s) => s.status === 'done').length;
  const totalCount = steps.length;
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const timeStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${(elapsed % 60).toString().padStart(2, '0')}s`
    : `${elapsed}s`;

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={C.error} bold>{t.install.execFailed}</Text>
        <Text color={C.error}>{error}</Text>
      </Box>
    );
  }

  const barWidth = 30;
  const filled = Math.round(barWidth * percent / 100);
  const remaining = barWidth - filled;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2}>
        <Text bold color={C.primary}>{t.install.execTitle}</Text>
        <Text dimColor>{timeStr}</Text>
        <Text bold color={percent === 100 ? C.success : C.primary}>{percent}%</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={C.success}>{'█'.repeat(filled)}</Text>
        <Text color={C.neutral}>{'░'.repeat(remaining)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
      </Box>
    </Box>
  );
}
