import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { type HookLevel } from '../../commands/hooks.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallHub — menu hub with status for each install category
//
// Each item shows enabled/disabled + config summary.
// Enter on an item navigates into its config; Enter on "Install" proceeds.
// ---------------------------------------------------------------------------

export interface HubItem {
  id: string;
  label: string;
  enabled: boolean;
  summary: string;
}

interface InstallHubProps {
  items: HubItem[];
  onToggle: (id: string) => void;
  onEnter: (id: string) => void;
  onInstall: () => void;
  onBack: () => void;
}

export function InstallHub({ items, onToggle, onEnter, onInstall, onBack }: InstallHubProps) {
  // items + 1 extra row for "Install"
  const totalRows = items.length + 1;
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i <= 0 ? totalRows - 1 : i - 1));
    } else if (key.downArrow) {
      setIndex((i) => (i >= totalRows - 1 ? 0 : i + 1));
    } else if (key.return) {
      if (index < items.length) {
        onEnter(items[index].id);
      } else {
        onInstall();
      }
    } else if (input === ' ' && index < items.length) {
      onToggle(items[index].id);
    } else if (key.escape) {
      onBack();
    } else {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= items.length) {
        onToggle(items[num - 1].id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{t.install.hubTitle}</Text>
      <Text dimColor>{t.install.hubHint}</Text>

      <Box flexDirection="column" marginTop={1}>
        {items.map((item, i) => {
          const hl = i === index;
          return (
            <Box key={item.id}>
              <Text color={hl ? 'cyan' : 'gray'}>[{i + 1}]</Text>
              <Text color={item.enabled ? 'green' : 'gray'}> {item.enabled ? '[x]' : '[ ]'} </Text>
              <Text color={hl ? 'cyan' : undefined} bold={hl}>
                {item.label.padEnd(14)}
              </Text>
              <Text dimColor>{item.summary}</Text>
            </Box>
          );
        })}

        {/* Install action row */}
        <Box marginTop={1}>
          <Text color={index === items.length ? 'greenBright' : 'gray'} bold={index === items.length}>
            {index === items.length ? '>' : ' '} {t.install.hubInstall}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [Space/1-{items.length}] Toggle  [Enter] Configure / Install  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helper to build hub items from config state
// ---------------------------------------------------------------------------

export function buildHubItems(
  enabled: { components: boolean; hooks: boolean; mcp: boolean; statusline: boolean; backup: boolean },
  summaries: {
    componentCount: number; fileCount: number; hookLevel: HookLevel;
    mcpToolCount: number; mcpEnabled: boolean;
    statuslineDetected: string | null;
    backupClaudeMd: boolean; backupAll: boolean;
  },
): HubItem[] {
  const statuslineSummary = enabled.statusline
    ? (summaries.statuslineDetected
      ? t.install.statuslineDetected.replace('{cmd}', summaries.statuslineDetected)
      : t.install.statuslineWillInstall)
    : t.install.hubSkipped;

  const backupSummary = enabled.backup
    ? (summaries.backupAll
      ? t.install.backupAllLabel
      : summaries.backupClaudeMd
        ? t.install.backupClaudeMdLabel
        : t.install.hubSkipped)
    : t.install.hubSkipped;

  return [
    {
      id: 'components',
      label: 'Components',
      enabled: enabled.components,
      summary: enabled.components
        ? `${summaries.componentCount} selected (${t.install.hubFiles.replace('{count}', String(summaries.fileCount))})`
        : t.install.hubSkipped,
    },
    {
      id: 'hooks',
      label: 'Hooks',
      enabled: enabled.hooks,
      summary: enabled.hooks
        ? `${summaries.hookLevel} — ${t.install.hooksLevelDescriptions[summaries.hookLevel]}`
        : t.install.hubSkipped,
    },
    {
      id: 'mcp',
      label: 'MCP Server',
      enabled: enabled.mcp,
      summary: enabled.mcp && summaries.mcpEnabled
        ? t.install.hubTools.replace('{count}', String(summaries.mcpToolCount))
        : t.install.hubSkipped,
    },
    {
      id: 'statusline',
      label: 'Statusline',
      enabled: enabled.statusline,
      summary: statuslineSummary,
    },
    {
      id: 'backup',
      label: 'Backup',
      enabled: enabled.backup,
      summary: backupSummary,
    },
  ];
}
