import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { HookLevel } from '../../commands/hooks.js';
import type { HooksSelection } from './HooksConfig.js';
import type { InstallFlowConfig } from './types.js';
import { t } from '../../i18n/index.js';
import { C, SYM, BORDER } from '../shared/index.js';

interface InstallConfirmProps {
  config: InstallFlowConfig;
  onConfirm: () => void;
  onBack: () => void;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box>
      <Text color={C.success}>{SYM.checkOn} </Text>
      <Text bold>{label.padEnd(16)}</Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

function SkippedRow({ label }: { label: string }) {
  return (
    <Box>
      <Text color={C.neutral}>{SYM.checkOff} </Text>
      <Text color={C.neutral}>{label}</Text>
    </Box>
  );
}

function hookSummary(sel?: HooksSelection, fallbackLevel?: HookLevel): string {
  if (sel) {
    return sel.isCustom
      ? `custom (${sel.selectedHooks.length} hooks, based on ${sel.basePreset})`
      : `${sel.basePreset} (${sel.selectedHooks.length} hooks)`;
  }
  return fallbackLevel ?? 'standard';
}

export function InstallConfirm({ config, onConfirm, onBack }: InstallConfirmProps) {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    if (key.escape) onBack();
  });

  const target = config.mode === 'global'
    ? '~/.maestro/ + ~/.claude/'
    : config.projectPath || './';

  // Collect items that will be installed vs skipped
  const willInstall: { label: string; value: string }[] = [];
  const skipped: string[] = [];

  if (config.installComponents) {
    willInstall.push({ label: 'Components', value: `${config.componentCount} selected · ${config.fileCount} files` });
  } else { skipped.push('Components'); }

  if (config.installHooks) {
    willInstall.push({ label: 'Hooks (Claude)', value: hookSummary(config.claudeHooksSelection, config.hookLevel) });
  } else { skipped.push('Hooks (Claude)'); }

  if (config.installMcp) {
    willInstall.push({ label: 'MCP Server', value: `${config.mcpToolCount} tools` });
  } else { skipped.push('MCP Server'); }

  if (config.installStatusline) {
    willInstall.push({ label: 'Statusline', value: `${config.statuslineTheme} theme` });
  } else { skipped.push('Statusline'); }

  if (config.installCodexHooks) {
    willInstall.push({ label: 'Codex Hooks', value: hookSummary(config.codexHooksSelection, config.codexHookLevel) });
  } else { skipped.push('Codex Hooks'); }

  if (config.installCodexMcp) {
    willInstall.push({ label: 'Codex MCP', value: `${config.codexMcpTools.length} tools` });
  } else { skipped.push('Codex MCP'); }

  if (config.installAgyHooks) {
    willInstall.push({ label: 'Agy Hooks', value: hookSummary(config.agyHooksSelection, config.agyHookLevel) });
  } else { skipped.push('Agy Hooks'); }

  if (config.installExtraMcp) {
    willInstall.push({ label: 'Extra MCP', value: `${config.extraMcpTargetIds.join(', ')}` });
  } else { skipped.push('Extra MCP'); }

  if (config.backupClaudeMd || config.backupAll) {
    willInstall.push({ label: 'Backup', value: config.backupAll ? t.install.backupAllLabel : t.install.backupClaudeMdLabel });
  } else { skipped.push('Backup'); }

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>{t.install.confirmReady}</Text>

      <Box marginTop={1}>
        <Text bold>{t.install.confirmLabelMode} </Text>
        <Text>{config.mode}</Text>
        <Text dimColor>  → {target}</Text>
      </Box>

      {/* Will Install section */}
      <Box flexDirection="column" {...BORDER.success} paddingX={1} marginTop={1}>
        <Text bold color={C.success}>{t.install.confirmWillInstall}</Text>
        {willInstall.map((item) => (
          <Row key={item.label} label={item.label} value={item.value} valueColor={C.success} />
        ))}
      </Box>

      {/* Skipped section */}
      {skipped.length > 0 && (
        <Box flexDirection="column" {...BORDER.detail} paddingX={1} marginTop={1}>
          <Text bold color={C.neutral}>{t.install.confirmSkippedSection}</Text>
          {skipped.map((label) => (
            <SkippedRow key={label} label={label} />
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>{t.install.confirmKeyHints}</Text>
      </Box>
    </Box>
  );
}
