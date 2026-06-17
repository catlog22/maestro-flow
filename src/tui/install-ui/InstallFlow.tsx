import React, { useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { C, SYM, Breadcrumb } from '../shared/index.js';
import { GroupedHub } from './GroupedHub.js';
import { ComponentGrid } from './ComponentGrid.js';
import { HooksConfig } from './HooksConfig.js';
import { McpConfig } from './McpConfig.js';
import { ExtraMcpConfig } from './ExtraMcpConfig.js';
import { StatuslineConfig } from './StatuslineConfig.js';
import { BackupConfig } from './BackupConfig.js';
import { InstallConfirm } from './InstallConfirm.js';
import { InstallExecution, type InstallFlowResult } from './InstallExecution.js';
import { InstallResult } from './InstallResult.js';
import { useInstallFlowState, type FlowStepCompat } from './useInstallFlowState.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallFlow — thin rendering shell over useInstallFlowState
// ---------------------------------------------------------------------------

export interface InstallFlowProps {
  pkgRoot: string;
  version: string;
  initialStep?: FlowStepCompat;
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
}

const CONFIG_STEPS = [
  'components_config', 'hooks_config', 'mcp_config',
  'codex_hooks_config', 'codex_mcp_config',
  'agy_hooks_config', 'extra_mcp_config',
  'statusline_config', 'backup_config',
];

export function InstallFlow({ pkgRoot, version, initialStep, initialMode, initialStepIds }: InstallFlowProps) {
  const { exit } = useApp();
  const s = useInstallFlowState({ pkgRoot, initialStep, initialMode, initialStepIds });

  // Global input for config steps
  useInput((_input, key) => {
    if (s.step === 'executing' || s.step === 'complete') return;

    if (s.step === 'components_config') {
      if (key.escape) s.setStep(s.isSubcommand ? 'confirm' : 'hub');
      return;
    }
    if (CONFIG_STEPS.includes(s.step)) {
      if (key.return) s.returnFromConfig();
      else if (key.escape) s.setStep(s.isSubcommand ? 'confirm' : 'hub');
      return;
    }
  });

  // Breadcrumb path
  const breadcrumbPath = useMemo((): string[] | null => {
    const hub = t.install.stepMenu;
    switch (s.step) {
      case 'components_config': return [hub, t.install.groupCore, t.install.hubLabelComponents];
      case 'hooks_config': return [hub, t.install.groupClaude, t.install.hubLabelHooks];
      case 'mcp_config': return [hub, t.install.groupClaude, t.install.hubLabelMcpServer];
      case 'statusline_config': return [hub, t.install.groupClaude, t.install.hubLabelStatusline];
      case 'codex_hooks_config': return [hub, t.install.groupCodex, t.install.hubLabelCodexHooks];
      case 'codex_mcp_config': return [hub, t.install.groupCodex, t.install.hubLabelCodexMcp];
      case 'agy_hooks_config': return [hub, t.install.groupOther, t.install.hubLabelAgyHooks];
      case 'extra_mcp_config': return [hub, t.install.groupOther, t.install.hubLabelExtraMcp];
      case 'backup_config': return [hub, t.install.groupCore, t.install.hubLabelBackup];
      default: return null;
    }
  }, [s.step]);

  // Progress steps
  const progressSteps = s.isSubcommand
    ? [
        { key: s.step.replace('_config', ''), label: s.step.replace('_config', '').charAt(0).toUpperCase() + s.step.replace('_config', '').slice(1) },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ]
    : [
        { key: 'hub', label: t.install.stepMenu },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ];

  const progressKey = CONFIG_STEPS.includes(s.step)
    ? (s.isSubcommand ? s.step.replace('_config', '') : 'hub')
    : s.step;
  const stepIndex = progressSteps.findIndex((ps) => ps.key === progressKey);

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Gradient name="fruit">
            <BigText text="MAESTRO" font="slick" />
          </Gradient>
          <Box marginTop={-2}>
            <Text dimColor>
              <BigText text="flow" font="slick" />
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>{t.install.headerVersion.replace('{version}', version)}</Text>
          </Box>
        </Box>
        <Box gap={1}>
          {progressSteps.map((ps, i) => (
            <Text
              key={ps.key}
              bold={ps.key === progressKey}
              color={i < stepIndex ? C.success : ps.key === progressKey ? C.primary : C.neutral}
            >
              {i < stepIndex ? SYM.stepDone : ps.key === progressKey ? SYM.stepActive : SYM.stepPending} {ps.label}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>
        {breadcrumbPath && (
          <Box marginBottom={1}>
            <Breadcrumb path={breadcrumbPath} />
          </Box>
        )}

        {s.step === 'hub' && (
          <>
            <GroupedHub
              groups={s.hubGroups}
              mode={s.mode}
              onModeChange={s.setMode}
              onToggle={s.toggleStep}
              onEnter={s.enterConfig}
              onInstall={() => s.setStep('confirm')}
              onExport={s.handleExport}
              onImport={s.handleImport}
              onExit={() => exit()}
              lastInstallDate={s.lastManifest?.installedAt?.split('T')[0]}
            />
            {s.profileMessage && (
              <Box marginTop={1}>
                <Text color={s.profileMessage.startsWith('✓') ? C.success : s.profileMessage.startsWith('✗') ? C.error : C.warning}>
                  {s.profileMessage}
                </Text>
              </Box>
            )}
          </>
        )}

        {s.step === 'components_config' && (
          <ComponentGrid
            components={s.scannedComponents}
            selectedIds={s.selectedComponentIds}
            onSelectionChange={s.setSelectedComponentIds}
            onDone={s.returnFromConfig}
          />
        )}

        {s.step === 'hooks_config' && (
          <HooksConfig selection={s.claudeHooksSelection} onSelectionChange={s.setClaudeHooksSelection} tool="claude" />
        )}

        {s.step === 'mcp_config' && (
          <McpConfig
            enabled={s.mcpEnabled} tools={s.mcpTools} projectRoot={s.mcpProjectRoot} mode={s.mode}
            onEnableChange={s.setMcpEnabled} onToolsChange={s.setMcpTools} onRootChange={s.setMcpProjectRoot}
          />
        )}

        {s.step === 'codex_hooks_config' && (
          <HooksConfig
            selection={s.codexHooksSelection} onSelectionChange={s.setCodexHooksSelection}
            tool="codex" title="Codex Hooks" descriptions={t.install.codexHooksLevelDescriptions}
          />
        )}

        {s.step === 'codex_mcp_config' && (
          <McpConfig
            enabled={s.codexMcpEnabled} tools={s.codexMcpTools} projectRoot={s.codexMcpProjectRoot} mode={s.mode}
            onEnableChange={s.setCodexMcpEnabled} onToolsChange={s.setCodexMcpTools} onRootChange={s.setCodexMcpProjectRoot}
          />
        )}

        {s.step === 'agy_hooks_config' && (
          <HooksConfig
            selection={s.agyHooksSelection} onSelectionChange={s.setAgyHooksSelection}
            tool="agy" title="Agy (Antigravity) Hooks" descriptions={t.install.agyHooksLevelDescriptions}
          />
        )}

        {s.step === 'extra_mcp_config' && (
          <ExtraMcpConfig
            mode={s.mode} selectedIds={s.extraMcpTargetIds}
            onSelectionChange={s.setExtraMcpTargetIds}
            onDone={s.returnFromConfig}
            onBack={() => s.setStep(s.isSubcommand ? 'confirm' : 'hub')}
          />
        )}

        {s.step === 'statusline_config' && (
          <StatuslineConfig
            enabled={s.installStatusline} theme={s.statuslineTheme} detected={s.statuslineDetected}
            onToggle={s.setInstallStatusline} onThemeChange={s.setStatuslineTheme}
          />
        )}

        {s.step === 'backup_config' && (
          <BackupConfig
            backupClaudeMd={s.backupClaudeMd} backupAll={s.backupAll} existingFileCount={s.existingFileCount}
            onClaudeMdChange={s.setBackupClaudeMd} onAllChange={s.setBackupAll}
          />
        )}

        {s.step === 'confirm' && (
          <InstallConfirm
            config={s.flowConfig}
            onConfirm={() => s.setStep('executing')}
            onBack={() => s.setStep(s.isSubcommand ? (s.resolvedInitialStep ?? 'hub') : 'hub')}
          />
        )}

        {s.step === 'executing' && (
          <InstallExecution
            config={s.flowConfig} pkgRoot={pkgRoot} version={version}
            onComplete={(r) => { s.setResult(r); s.setStep('complete'); }}
          />
        )}

        {s.step === 'complete' && s.result && (
          <InstallResult result={s.result} />
        )}
      </Box>
    </Box>
  );
}
