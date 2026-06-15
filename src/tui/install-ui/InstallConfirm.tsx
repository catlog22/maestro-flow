import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { HookLevel } from '../../commands/hooks.js';
import type { ExtraMcpTargetId } from '../../commands/install-backend.js';
import { t } from '../../i18n/index.js';
import { C, BORDER } from '../shared/index.js';

// ---------------------------------------------------------------------------
// InstallConfirm — summary before execution
// ---------------------------------------------------------------------------

export interface InstallFlowConfig {
  mode: 'global' | 'project';
  projectPath: string;
  installComponents: boolean;
  installHooks: boolean;
  installMcp: boolean;
  installCodexHooks: boolean;
  codexHookLevel: HookLevel;
  installCodexMcp: boolean;
  codexMcpTools: string[];
  codexMcpProjectRoot: string;
  installAgyHooks: boolean;
  agyHookLevel: HookLevel;
  installExtraMcp: boolean;
  extraMcpTargetIds: ExtraMcpTargetId[];
  installCodeGraph: boolean;
  installStatusline: boolean;
  statuslineTheme: string;
  hookLevel: HookLevel;
  componentCount: number;
  fileCount: number;
  mcpToolCount: number;
  selectedComponentIds: string[];
  mcpTools: string[];
  mcpProjectRoot: string;
  backupClaudeMd: boolean;
  backupAll: boolean;
}

interface InstallConfirmProps {
  config: InstallFlowConfig;
  onConfirm: () => void;
  onBack: () => void;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box>
      <Text bold>{label.padEnd(14)}</Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

export function InstallConfirm({ config, onConfirm, onBack }: InstallConfirmProps) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    if (key.escape) onBack();
  });

  const target = config.mode === 'global'
    ? '~/.maestro/ + ~/.claude/'
    : config.projectPath || './';

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>{t.install.confirmTitle}</Text>

      <Box flexDirection="column" {...BORDER.primary} paddingX={1} marginTop={1}>
        <Row label={t.install.confirmLabelMode} value={config.mode} />
        <Row label={t.install.confirmLabelTarget} value={target} />

        {config.installComponents ? (
          <Row
            label={t.install.confirmLabelComponents}
            value={`${config.componentCount} selected (${t.install.hubFiles.replace('{count}', String(config.fileCount))})`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelComponents} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installHooks ? (
          <Row
            label={t.install.confirmLabelHooks}
            value={`${config.hookLevel} — ${t.install.hooksLevelDescriptions[config.hookLevel]}`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelHooks} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installMcp ? (
          <Row
            label={t.install.confirmLabelMcp}
            value={`${config.mcpToolCount} tools (${config.mcpTools.join(', ')})`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelMcp} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installCodexHooks ? (
          <Row
            label={t.install.confirmLabelCodexHooks}
            value={`${config.codexHookLevel} — ${t.install.codexHooksLevelDescriptions[config.codexHookLevel]}`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelCodexHooks} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installCodexMcp ? (
          <Row
            label={t.install.confirmLabelCodexMcp}
            value={`${config.codexMcpTools.length} tools`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelCodexMcp} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installAgyHooks ? (
          <Row
            label={t.install.confirmLabelAgyHooks}
            value={`${config.agyHookLevel} — ${t.install.agyHooksLevelDescriptions[config.agyHookLevel]}`}
            valueColor={C.success}
          />
        ) : (
          <Row label={t.install.confirmLabelAgyHooks} value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        {config.installExtraMcp ? (
          <Row
            label="Extra MCP"
            value={`${config.extraMcpTargetIds.length} target(s): ${config.extraMcpTargetIds.join(', ')}`}
            valueColor={C.success}
          />
        ) : (
          <Row label="Extra MCP" value={t.install.confirmSkipped} valueColor={C.neutral} />
        )}

        <Row
          label={t.install.confirmLabelCodeGraph}
          value={config.installCodeGraph
            ? 'MaestroGraph tree-sitter (built-in, no install needed)'
            : t.install.confirmSkipped}
          valueColor={config.installCodeGraph ? C.success : C.neutral}
        />

        <Row
          label={t.install.confirmLabelStatusline}
          value={config.installStatusline
            ? `${t.install.statuslineEnabled} (${config.statuslineTheme})`
            : t.install.confirmSkipped}
          valueColor={config.installStatusline ? C.success : C.neutral}
        />

        <Row
          label={t.install.confirmLabelBackup}
          value={
            config.backupAll
              ? t.install.backupAllLabel
              : config.backupClaudeMd
                ? t.install.backupClaudeMdLabel
                : t.install.confirmSkipped
          }
          valueColor={config.backupClaudeMd || config.backupAll ? C.success : C.neutral}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{t.install.footerConfirm}</Text>
      </Box>
    </Box>
  );
}
