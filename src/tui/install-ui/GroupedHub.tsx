import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { type HookLevel } from '../../commands/hooks.js';
import { t } from '../../i18n/index.js';
import { C, SYM, SP, wrapCursor, parseNumberKey, KeyHints } from '../shared/index.js';

// ---------------------------------------------------------------------------
// GroupedHub — hub menu with semantic groups + inline scope selector
//
// Groups: Core / Claude Code / Codex / Other Tools
// Scope selector: g/p toggles at the top (no separate step)
// Tab: jump to next group. Enter: configure / install. Space: toggle.
// e: export profile. i: import profile.
// ---------------------------------------------------------------------------

export interface HubItem {
  id: string;
  label: string;
  enabled: boolean;
  summary: string;
  /** Shown in right-side detail panel when focused */
  detail?: string;
}

export interface HubGroup {
  id: string;
  title: string;
  items: HubItem[];
}

interface GroupedHubProps {
  groups: HubGroup[];
  mode: 'global' | 'project';
  onModeChange: (mode: 'global' | 'project') => void;
  onToggle: (id: string) => void;
  onEnter: (id: string) => void;
  onInstall: () => void;
  onExport: () => void;
  onImport: () => void;
  onExit: () => void;
  /** Date string from last manifest, e.g. "2026-06-15" */
  lastInstallDate?: string | null;
}

interface FlatEntry {
  type: 'item';
  groupIdx: number;
  itemIdx: number;
  item: HubItem;
}

export function GroupedHub({
  groups, mode, onModeChange,
  onToggle, onEnter, onInstall, onExport, onImport, onExit,
  lastInstallDate,
}: GroupedHubProps) {
  const flat = useMemo<FlatEntry[]>(() => {
    const entries: FlatEntry[] = [];
    groups.forEach((g, gi) => {
      g.items.forEach((item, ii) => {
        entries.push({ type: 'item', groupIdx: gi, itemIdx: ii, item });
      });
    });
    return entries;
  }, [groups]);

  const totalRows = flat.length + 3; // items + Install + Export + Import
  const [cursor, setCursor] = useState(0);

  const groupStartIndices = useMemo(() => {
    const starts: number[] = [];
    let idx = 0;
    groups.forEach((g) => {
      starts.push(idx);
      idx += g.items.length;
    });
    return starts;
  }, [groups]);

  const jumpNextGroup = () => {
    const currentGroupIdx = cursor < flat.length
      ? flat[cursor].groupIdx
      : groups.length - 1;
    const nextGroupIdx = (currentGroupIdx + 1) % groups.length;
    setCursor(groupStartIndices[nextGroupIdx]);
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((i) => wrapCursor(i, -1, totalRows));
    } else if (key.downArrow) {
      setCursor((i) => wrapCursor(i, 1, totalRows));
    } else if (key.tab) {
      jumpNextGroup();
    } else if (key.return) {
      if (cursor < flat.length) {
        onEnter(flat[cursor].item.id);
      } else if (cursor === flat.length) {
        onInstall();
      } else if (cursor === flat.length + 1) {
        onExport();
      } else if (cursor === flat.length + 2) {
        onImport();
      }
    } else if (input === ' ' && cursor < flat.length) {
      onToggle(flat[cursor].item.id);
    } else if (input === 'g' || input === 'G') {
      onModeChange('global');
    } else if (input === 'p' || input === 'P') {
      onModeChange('project');
    } else if (input === 'e' || input === 'E') {
      onExport();
    } else if (input === 'i' || input === 'I') {
      onImport();
    } else if (key.escape) {
      onExit();
    } else {
      const idx = parseNumberKey(input, flat.length);
      if (idx !== null) {
        onToggle(flat[idx].item.id);
      }
    }
  });

  const focusedItem = cursor < flat.length ? flat[cursor].item : null;

  // Pre-compute flat index for each entry to avoid mutable counter in render
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((entry, i) => map.set(`${entry.groupIdx}-${entry.itemIdx}`, i));
    return map;
  }, [flat]);

  return (
    <Box flexDirection="column">
      {/* Scope selector */}
      <Box>
        <Text bold color={C.primary}>{t.install.hubScope} </Text>
        <Text color={mode === 'global' ? C.success : C.neutral} bold={mode === 'global'}>
          {mode === 'global' ? '● ' : '○ '}{t.install.hubGlobal}
        </Text>
        <Text>  </Text>
        <Text color={mode === 'project' ? C.success : C.neutral} bold={mode === 'project'}>
          {mode === 'project' ? '● ' : '○ '}{t.install.hubProject}
        </Text>
        <Text dimColor>  [g/p]</Text>
        {lastInstallDate && (
          <Text dimColor>  {t.install.hubLastInstall.replace('{date}', lastInstallDate)}</Text>
        )}
      </Box>

      {/* Grouped items + detail panel side by side */}
      <Box marginTop={SP.sectionGap}>
        {/* Left: grouped list */}
        <Box flexDirection="column" width={44}>
          {groups.map((group, gi) => {
            const groupItems = flat.filter((e) => e.groupIdx === gi);
            return (
              <Box key={group.id} flexDirection="column">
                <Text color={C.primary}>{'─'.repeat(2)} {group.title} {'─'.repeat(Math.max(0, 36 - group.title.length))}</Text>
                {groupItems.map((entry) => {
                  const idx = flatIndexMap.get(`${entry.groupIdx}-${entry.itemIdx}`) ?? 0;
                  const hl = cursor === idx;
                  const item = entry.item;
                  return (
                    <Box key={item.id}>
                      <Text color={hl ? C.primary : C.neutral}> </Text>
                      <Text color={item.enabled ? (hl ? C.successBright : C.success) : C.neutral}>
                        {item.enabled ? SYM.checkOn : SYM.checkOff}
                      </Text>
                      <Text> </Text>
                      <Text color={hl ? C.primary : undefined} bold={hl}>
                        {item.label.padEnd(16)}
                      </Text>
                      <Text dimColor>{item.enabled ? item.summary : '—'}</Text>
                    </Box>
                  );
                })}
                <Text> </Text>
              </Box>
            );
          })}

          {/* Action rows */}
          <Box flexDirection="column" marginTop={0}>
            <Text
              color={cursor === flat.length ? C.successBright : C.neutral}
              bold={cursor === flat.length}
            >
              {cursor === flat.length ? SYM.cursor : ' '} {t.install.hubExecuteInstall}
            </Text>
            <Text
              color={cursor === flat.length + 1 ? C.primary : C.neutral}
              bold={cursor === flat.length + 1}
            >
              {cursor === flat.length + 1 ? SYM.cursor : ' '} {t.install.hubExportConfig}  [e]
            </Text>
            <Text
              color={cursor === flat.length + 2 ? C.primary : C.neutral}
              bold={cursor === flat.length + 2}
            >
              {cursor === flat.length + 2 ? SYM.cursor : ' '} {t.install.hubImportConfig}  [i]
            </Text>
          </Box>
        </Box>

        {/* Right: detail panel */}
        {focusedItem?.detail && (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={C.neutral}
            paddingX={1}
            width={30}
            marginLeft={2}
          >
            <Text bold color={C.primary}>{focusedItem.label}</Text>
            <Text dimColor wrap="wrap">{focusedItem.detail}</Text>
          </Box>
        )}
      </Box>

      <KeyHints hints={t.install.hubKeyHints} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helper to build grouped hub items from config state
// ---------------------------------------------------------------------------

export function buildGroupedHubItems(
  enabled: Record<string, boolean>,
  summaries: {
    componentCount: number; fileCount: number; hookLevel: HookLevel;
    hookSelectedCount?: number; hookTotalCount?: number; hookIsCustom?: boolean;
    mcpToolCount: number; mcpEnabled: boolean;
    codexHookLevel: HookLevel; codexMcpToolCount: number; codexMcpEnabled: boolean;
    codexHookSelectedCount?: number; codexHookTotalCount?: number; codexHookIsCustom?: boolean;
    agyHookLevel: HookLevel;
    agyHookSelectedCount?: number; agyHookTotalCount?: number; agyHookIsCustom?: boolean;
    extraMcpTargetCount: number;
    statuslineDetected: string | null;
    statuslineTheme?: string;
    backupClaudeMd: boolean; backupAll: boolean;
  },
): HubGroup[] {
  const hookSummary = (level: HookLevel, selCount?: number, totalCount?: number, isCustom?: boolean) => {
    if (isCustom && selCount != null && totalCount != null) {
      return `custom (${selCount}/${totalCount})`;
    }
    if (selCount != null && totalCount != null) {
      return `${level} (${selCount}/${totalCount})`;
    }
    return level;
  };

  const backupSummary = summaries.backupAll
    ? t.install.backupAllLabel
    : summaries.backupClaudeMd
      ? t.install.backupClaudeMdLabel
      : '—';

  return [
    {
      id: 'core',
      title: t.install.groupCore,
      items: [
        {
          id: 'components',
          label: t.install.hubLabelComponents,
          enabled: enabled.components,
          summary: `${summaries.componentCount} sel · ${summaries.fileCount}f`,
          detail: t.install.hubDetailComponents.replace('{count}', String(summaries.componentCount)).replace('{files}', String(summaries.fileCount)),
        },
        {
          id: 'backup',
          label: t.install.hubLabelBackup,
          enabled: enabled.backup,
          summary: backupSummary,
          detail: t.install.hubDetailBackup,
        },
      ],
    },
    {
      id: 'claude',
      title: t.install.groupClaude,
      items: [
        {
          id: 'hooks',
          label: t.install.hubLabelHooks,
          enabled: enabled.hooks,
          summary: hookSummary(summaries.hookLevel, summaries.hookSelectedCount, summaries.hookTotalCount, summaries.hookIsCustom),
          detail: t.install.hubDetailHooks.replace('{level}', summaries.hookLevel),
        },
        {
          id: 'mcp',
          label: t.install.hubLabelMcpServer,
          enabled: enabled.mcp,
          summary: summaries.mcpEnabled ? t.install.hubTools.replace('{count}', String(summaries.mcpToolCount)) : '—',
          detail: t.install.hubDetailMcp,
        },
        {
          id: 'statusline',
          label: t.install.hubLabelStatusline,
          enabled: enabled.statusline,
          summary: summaries.statuslineDetected
            ? t.install.statuslineDetected.replace('{cmd}', summaries.statuslineDetected)
            : (summaries.statuslineTheme || 'notion'),
          detail: t.install.hubDetailStatusline.replace('{theme}', summaries.statuslineTheme || 'notion'),
        },
      ],
    },
    {
      id: 'codex',
      title: t.install.groupCodex,
      items: [
        {
          id: 'codexHooks',
          label: t.install.hubLabelCodexHooks,
          enabled: enabled.codexHooks,
          summary: hookSummary(summaries.codexHookLevel, summaries.codexHookSelectedCount, summaries.codexHookTotalCount, summaries.codexHookIsCustom),
          detail: t.install.hubDetailCodexHooks,
        },
        {
          id: 'codexMcp',
          label: t.install.hubLabelCodexMcp,
          enabled: enabled.codexMcp,
          summary: summaries.codexMcpEnabled ? t.install.hubTools.replace('{count}', String(summaries.codexMcpToolCount)) : '—',
          detail: t.install.hubDetailCodexMcp,
        },
      ],
    },
    {
      id: 'other',
      title: t.install.groupOther,
      items: [
        {
          id: 'agyHooks',
          label: t.install.hubLabelAgyHooks,
          enabled: enabled.agyHooks,
          summary: hookSummary(summaries.agyHookLevel, summaries.agyHookSelectedCount, summaries.agyHookTotalCount, summaries.agyHookIsCustom),
          detail: t.install.hubDetailAgyHooks,
        },
        {
          id: 'extraMcp',
          label: t.install.hubLabelExtraMcp,
          enabled: enabled.extraMcp,
          summary: summaries.extraMcpTargetCount > 0 ? `${summaries.extraMcpTargetCount} targets` : '0 targets',
          detail: t.install.hubDetailExtraMcp,
        },
      ],
    },
  ];
}
