import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  HOOK_LEVELS,
  HOOK_DEFS,
  CODEX_HOOK_DEFS,
  AGY_HOOK_DEFS,
  getHooksForLevel,
  type HookLevel,
} from '../../commands/hooks.js';
import { t } from '../../i18n/index.js';
import { C, SYM, SP, wrapCursor, KeyHints, SectionHeader } from '../shared/index.js';

// ---------------------------------------------------------------------------
// HooksConfig — Preset + individual hook toggle
//
// Top: preset radio (1-4) for quick bulk selection
// Bottom: individual hooks grouped by event, each toggleable with Space
// Manual change after preset → marks "Custom"
// ---------------------------------------------------------------------------

export interface HooksSelection {
  basePreset: HookLevel;
  selectedHooks: string[];
  isCustom: boolean;
}

interface HooksConfigProps {
  selection: HooksSelection;
  onSelectionChange: (sel: HooksSelection) => void;
  title?: string;
  descriptions?: Record<string, string>;
  /** Which tool's hook defs to use */
  tool?: 'claude' | 'codex' | 'agy';
}

interface HookEntry {
  name: string;
  event: string;
  level: HookLevel;
}

function groupByEvent(entries: HookEntry[]): { event: string; hooks: HookEntry[] }[] {
  const map = new Map<string, HookEntry[]>();
  for (const e of entries) {
    const list = map.get(e.event) ?? [];
    list.push(e);
    map.set(e.event, list);
  }
  return Array.from(map.entries()).map(([event, hooks]) => ({ event, hooks }));
}

export function HooksConfig({
  selection, onSelectionChange,
  title, descriptions, tool = 'claude',
}: HooksConfigProps) {
  const descMap = descriptions ?? t.install.hooksLevelDescriptions;
  const sectionTitle = title ?? t.install.hooksTitle;

  const defs = tool === 'codex' ? CODEX_HOOK_DEFS
    : tool === 'agy' ? AGY_HOOK_DEFS
    : HOOK_DEFS;

  const allHooks = useMemo<HookEntry[]>(() =>
    Object.entries(defs).map(([name, def]) => ({
      name,
      event: def.event,
      level: def.level,
    })),
  [defs]);

  const eventGroups = useMemo(() => groupByEvent(allHooks), [allHooks]);

  // Navigation: 4 preset rows + individual hook rows
  const hookCount = allHooks.length;
  const totalRows = HOOK_LEVELS.length + hookCount;
  const [cursor, setCursor] = useState(Math.max(0, HOOK_LEVELS.indexOf(selection.basePreset)));

  const isInPresetZone = cursor < HOOK_LEVELS.length;
  const hookIndex = cursor - HOOK_LEVELS.length;

  const applyPreset = useCallback((level: HookLevel) => {
    const hooks = getHooksForLevel(level, tool);
    onSelectionChange({ basePreset: level, selectedHooks: hooks, isCustom: false });
  }, [tool, onSelectionChange]);

  const toggleHook = useCallback((hookName: string) => {
    const next = selection.selectedHooks.includes(hookName)
      ? selection.selectedHooks.filter((h) => h !== hookName)
      : [...selection.selectedHooks, hookName];
    onSelectionChange({ ...selection, selectedHooks: next, isCustom: true });
  }, [selection, onSelectionChange]);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((i) => wrapCursor(i, -1, totalRows));
    } else if (key.downArrow) {
      setCursor((i) => wrapCursor(i, 1, totalRows));
    } else if (input === ' ') {
      if (isInPresetZone) {
        applyPreset(HOOK_LEVELS[cursor]);
      } else {
        toggleHook(allHooks[hookIndex].name);
      }
    } else if (input === 'a' || input === 'A') {
      applyPreset('full');
    } else if (input === 'n' || input === 'N') {
      applyPreset('none');
    } else {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= 4) {
        const level = HOOK_LEVELS[num - 1];
        setCursor(num - 1);
        applyPreset(level);
      }
    }
  });

  const { selectedHooks, isCustom, basePreset } = selection;

  // Status line
  const statusText = isCustom
    ? `Custom (based on ${basePreset}, ${selectedHooks.length}/${hookCount} hooks)`
    : `${basePreset} (${selectedHooks.length}/${hookCount} hooks)`;

  // Pre-compute flat index for each hook to avoid mutable counter in render
  const hookFlatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const group of eventGroups) {
      for (const hook of group.hooks) {
        map.set(hook.name, idx++);
      }
    }
    return map;
  }, [eventGroups]);

  return (
    <Box flexDirection="column">
      <SectionHeader title={sectionTitle} />

      {/* Preset row — horizontal */}
      <Box marginTop={SP.sectionGap} gap={2}>
        {HOOK_LEVELS.map((lvl, i) => {
          const isActive = lvl === basePreset && !isCustom;
          const hl = cursor === i;
          const label = lvl.charAt(0).toUpperCase() + lvl.slice(1);
          return (
            <Box key={lvl}>
              <Text color={isActive ? C.success : C.neutral}>
                {isActive ? SYM.radioOn : SYM.radioOff}
              </Text>
              <Text color={hl ? C.primary : C.neutral}> {i + 1} </Text>
              <Text color={hl ? C.primary : undefined} bold={hl}>{label}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Individual hooks — grouped by event */}
      <Box flexDirection="column" marginTop={SP.sectionGap}>
        <Text color={C.neutral} dimColor>{'─'.repeat(2)} Individual Hooks {'─'.repeat(30)}</Text>
        {eventGroups.map((group) => (
          <Box key={group.event} flexDirection="column">
            <Text color={C.neutral} dimColor>  {group.event}</Text>
            {group.hooks.map((hook) => {
              const idx = HOOK_LEVELS.length + (hookFlatIndexMap.get(hook.name) ?? 0);
              const hl = cursor === idx;
              const checked = selectedHooks.includes(hook.name);
              return (
                <Box key={hook.name}>
                  <Text color={hl ? C.primary : undefined}>  </Text>
                  <Text color={checked ? (hl ? C.successBright : C.success) : C.neutral}>
                    {checked ? SYM.checkOn : SYM.checkOff}
                  </Text>
                  <Text color={hl ? C.primary : undefined} bold={hl}>
                    {' '}{hook.name.padEnd(24)}
                  </Text>
                  <Text dimColor>{hook.level}</Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Status */}
      <Box marginTop={SP.sectionGap}>
        <Text dimColor>Level: </Text>
        <Text color={isCustom ? C.warning : C.success}>{statusText}</Text>
      </Box>

      <KeyHints hints="[1-4] Preset  [↑↓] Navigate  [Space] Toggle  [a] All  [n] None  [Enter] Done  [Esc] Back" />
    </Box>
  );
}
