import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { HookLevel } from '../hooks.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallConfirm — summary before execution
// ---------------------------------------------------------------------------

export interface InstallFlowConfig {
  mode: 'global' | 'project';
  projectPath: string;
  installComponents: boolean;
  installHooks: boolean;
  installMcp: boolean;
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
      <Text bold color="cyan">{t.install.confirmTitle}</Text>

      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
        <Row label={t.install.confirmLabelMode} value={config.mode} />
        <Row label={t.install.confirmLabelTarget} value={target} />

        {config.installComponents ? (
          <Row
            label={t.install.confirmLabelComponents}
            value={`${config.componentCount} selected (${t.install.hubFiles.replace('{count}', String(config.fileCount))})`}
            valueColor="green"
          />
        ) : (
          <Row label={t.install.confirmLabelComponents} value={t.install.confirmSkipped} valueColor="gray" />
        )}

        {config.installHooks ? (
          <Row
            label={t.install.confirmLabelHooks}
            value={`${config.hookLevel} — ${t.install.hooksLevelDescriptions[config.hookLevel]}`}
            valueColor="green"
          />
        ) : (
          <Row label={t.install.confirmLabelHooks} value={t.install.confirmSkipped} valueColor="gray" />
        )}

        {config.installMcp ? (
          <Row
            label={t.install.confirmLabelMcp}
            value={`${config.mcpToolCount} tools (${config.mcpTools.join(', ')})`}
            valueColor="green"
          />
        ) : (
          <Row label={t.install.confirmLabelMcp} value={t.install.confirmSkipped} valueColor="gray" />
        )}

        <Row
          label={t.install.confirmLabelStatusline}
          value={config.installStatusline
            ? `${t.install.statuslineEnabled} (${config.statuslineTheme})`
            : t.install.confirmSkipped}
          valueColor={config.installStatusline ? 'green' : 'gray'}
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
          valueColor={config.backupClaudeMd || config.backupAll ? 'green' : 'gray'}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{t.install.footerConfirm}</Text>
      </Box>
    </Box>
  );
}
