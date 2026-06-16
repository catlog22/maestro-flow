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

  let globalItemIndex = 0;

  return (
    <Box flexDirection="column">
      {/* Scope selector */}
      <Box>
        <Text bold color={C.primary}>Scope: </Text>
        <Text color={mode === 'global' ? C.success : C.neutral} bold={mode === 'global'}>
          {mode === 'global' ? '● ' : '○ '}Global
        </Text>
        <Text>  </Text>
        <Text color={mode === 'project' ? C.success : C.neutral} bold={mode === 'project'}>
          {mode === 'project' ? '● ' : '○ '}Project
        </Text>
        <Text dimColor>  [g/p]</Text>
        {lastInstallDate && (
          <Text dimColor>  last: {lastInstallDate}</Text>
        )}
      </Box>

      {/* Grouped items + detail panel side by side */}
      <Box marginTop={SP.sectionGap}>
        {/* Left: grouped list */}
        <Box flexDirection="column" width={44}>
          {groups.map((group) => {
            const groupItems = flat.filter((e) => groups[e.groupIdx] === group);
            return (
              <Box key={group.id} flexDirection="column">
                <Text color={C.neutral} dimColor>{'─'.repeat(2)} {group.title} {'─'.repeat(Math.max(0, 36 - group.title.length))}</Text>
                {groupItems.map((entry) => {
                  const idx = globalItemIndex++;
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
              {cursor === flat.length ? SYM.cursor : ' '} Execute Install
            </Text>
            <Text
              color={cursor === flat.length + 1 ? C.primary : C.neutral}
              bold={cursor === flat.length + 1}
            >
              {cursor === flat.length + 1 ? SYM.cursor : ' '} Export Config  [e]
            </Text>
            <Text
              color={cursor === flat.length + 2 ? C.primary : C.neutral}
              bold={cursor === flat.length + 2}
            >
              {cursor === flat.length + 2 ? SYM.cursor : ' '} Import Config  [i]
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

      <KeyHints hints={`[↑↓] Navigate  [Space] Toggle  [Enter] Configure  [Tab] Next group  [g/p] Scope  [e] Export  [i] Import  [Esc] Exit`} />
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
    codegraphAvailable: boolean;
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
      title: 'Core',
      items: [
        {
          id: 'components',
          label: 'Components',
          enabled: enabled.components,
          summary: `${summaries.componentCount} sel · ${summaries.fileCount}f`,
          detail: `Workflow templates, agent definitions, skill files, overlays, CLI templates.\n\n${summaries.componentCount} components selected\n~${summaries.fileCount} files to install`,
        },
        {
          id: 'backup',
          label: 'Backup',
          enabled: enabled.backup,
          summary: backupSummary,
          detail: 'Create timestamped backup of existing files before overwriting.',
        },
        {
          id: 'codegraph',
          label: 'CodeGraph',
          enabled: enabled.codegraph,
          summary: 'built-in',
          detail: 'MaestroGraph tree-sitter based code analysis. Built-in, no install needed.',
        },
      ],
    },
    {
      id: 'claude',
      title: 'Claude Code',
      items: [
        {
          id: 'hooks',
          label: 'Hooks',
          enabled: enabled.hooks,
          summary: hookSummary(summaries.hookLevel, summaries.hookSelectedCount, summaries.hookTotalCount, summaries.hookIsCustom),
          detail: `Claude Code event hooks.\nPreset: ${summaries.hookLevel}\nControls: context injection, KG sync, tool validation, etc.`,
        },
        {
          id: 'mcp',
          label: 'MCP Server',
          enabled: enabled.mcp,
          summary: summaries.mcpEnabled ? `${summaries.mcpToolCount} tools` : '—',
          detail: 'Register maestro-tools MCP server in Claude Code settings.\n\nTools: read/write/edit files, team messaging, knowhow storage.',
        },
        {
          id: 'statusline',
          label: 'Statusline',
          enabled: enabled.statusline,
          summary: summaries.statuslineDetected
            ? `detected: ${summaries.statuslineDetected}`
            : (summaries.statuslineTheme || 'notion'),
          detail: `Status bar theme for Claude Code.\nTheme: ${summaries.statuslineTheme || 'notion'}\nRequires Nerd Font glyphs.`,
        },
      ],
    },
    {
      id: 'codex',
      title: 'Codex',
      items: [
        {
          id: 'codexHooks',
          label: 'Hooks',
          enabled: enabled.codexHooks,
          summary: hookSummary(summaries.codexHookLevel, summaries.codexHookSelectedCount, summaries.codexHookTotalCount, summaries.codexHookIsCustom),
          detail: 'Codex (OpenAI) event hooks.\nSame hook library adapted for Codex event model.',
        },
        {
          id: 'codexMcp',
          label: 'MCP',
          enabled: enabled.codexMcp,
          summary: summaries.codexMcpEnabled ? `${summaries.codexMcpToolCount} tools` : '—',
          detail: 'Register maestro-tools MCP server in Codex config.',
        },
      ],
    },
    {
      id: 'other',
      title: 'Other Tools',
      items: [
        {
          id: 'agyHooks',
          label: 'Agy Hooks',
          enabled: enabled.agyHooks,
          summary: hookSummary(summaries.agyHookLevel, summaries.agyHookSelectedCount, summaries.agyHookTotalCount, summaries.agyHookIsCustom),
          detail: 'Antigravity (Gemini CLI) event hooks.\nSame hook library adapted for Agy event model.',
        },
        {
          id: 'extraMcp',
          label: 'Extra MCP',
          enabled: enabled.extraMcp,
          summary: summaries.extraMcpTargetCount > 0 ? `${summaries.extraMcpTargetCount} targets` : '0 targets',
          detail: 'Register maestro-tools in additional IDEs/CLIs:\nCursor, Qoder, Trae, Kiro, Roo, VS Code, Gemini CLI.',
        },
      ],
    },
  ];
}
