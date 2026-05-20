import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { type HookLevel } from '../../commands/hooks.js';
import { t } from '../../i18n/index.js';
import { C, SYM, SP, wrapCursor, parseNumberKey, KeyHints, SectionHeader } from '../shared/index.js';

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
      setIndex((i) => wrapCursor(i, -1, totalRows));
    } else if (key.downArrow) {
      setIndex((i) => wrapCursor(i, 1, totalRows));
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
      const idx = parseNumberKey(input, items.length);
      if (idx !== null) {
        onToggle(items[idx].id);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <SectionHeader title={t.install.hubTitle} />
      <Text dimColor>{t.install.hubHint}</Text>

      <Box flexDirection="column" marginTop={SP.sectionGap}>
        {items.map((item, i) => {
          const hl = i === index;
          return (
            <Box key={item.id}>
              <Text color={hl ? C.primary : C.neutral}>[{i + 1}]</Text>
              <Text color={item.enabled ? (hl ? C.successBright : C.success) : C.neutral}> {item.enabled ? SYM.checkOn : SYM.checkOff} </Text>
              <Text color={hl ? C.primary : undefined} bold={hl}>
                {item.label.padEnd(SP.labelWidth)}
              </Text>
              <Text dimColor>{item.summary}</Text>
            </Box>
          );
        })}

        {/* Install action row */}
        <Box marginTop={SP.sectionGap}>
          <Text color={index === items.length ? C.successBright : C.neutral} bold={index === items.length}>
            {index === items.length ? SYM.cursor : SYM.cursorBlank} {t.install.hubInstall}
          </Text>
        </Box>
      </Box>

      <KeyHints hints={`[Space/1-${items.length}] Toggle  [Enter] Configure / Install  [Esc] Back`} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helper to build hub items from config state
// ---------------------------------------------------------------------------

export function buildHubItems(
  enabled: { components: boolean; hooks: boolean; mcp: boolean; codexHooks: boolean; codexMcp: boolean; extraMcp: boolean; statusline: boolean; backup: boolean },
  summaries: {
    componentCount: number; fileCount: number; hookLevel: HookLevel;
    mcpToolCount: number; mcpEnabled: boolean;
    codexHookLevel: HookLevel; codexMcpToolCount: number; codexMcpEnabled: boolean;
    extraMcpTargetCount: number;
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
      id: 'codexHooks',
      label: 'Codex Hooks',
      enabled: enabled.codexHooks,
      summary: enabled.codexHooks
        ? `${summaries.codexHookLevel} — ${t.install.codexHooksLevelDescriptions[summaries.codexHookLevel]}`
        : t.install.hubSkipped,
    },
    {
      id: 'codexMcp',
      label: 'Codex MCP',
      enabled: enabled.codexMcp,
      summary: enabled.codexMcp && summaries.codexMcpEnabled
        ? t.install.hubTools.replace('{count}', String(summaries.codexMcpToolCount))
        : t.install.hubSkipped,
    },
    {
      id: 'extraMcp',
      label: 'Extra MCP (Cursor/Qoder/Trae/Kiro/Roo/VS Code/Gemini)',
      enabled: enabled.extraMcp,
      summary: enabled.extraMcp && summaries.extraMcpTargetCount > 0
        ? `${summaries.extraMcpTargetCount} target(s)`
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
