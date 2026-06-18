import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { C, SYM, KeyHints } from '../shared/index.js';
import {
  scanToggleItems,
  applyToggle,
  updateManifestDisabledItems,
  type ToggleItem,
  type ToggleState,
} from '../../commands/install-backend.js';

// ---------------------------------------------------------------------------
// ToggleView — Tab-based TUI for managing commands, skills, agents
//
// Three states per item:
//   on        = installed & enabled  (✓ green)
//   off       = installed & disabled (✗ red)
//   available = in source, not yet installed (· dim)
//
// Tab switches between Commands / Skills / Agents tabs.
// Space toggles: available→on, on→off, off→on
// ---------------------------------------------------------------------------

const TABS = [
  { type: 'command', label: 'Commands' },
  { type: 'skill', label: 'Skills' },
  { type: 'agent', label: 'Agents' },
] as const;

const STATE_DISPLAY: Record<ToggleState, { sym: string; color: string; label: string }> = {
  on: { sym: SYM.checkOn, color: C.success, label: '' },
  off: { sym: SYM.checkOff, color: C.error, label: '[disabled]' },
  available: { sym: '·', color: C.neutral, label: '[not installed]' },
};

export interface ToggleViewProps {
  pkgRoot: string;
  targetBase: string;
  scope: 'global' | 'project';
  targetPath: string;
  filter?: string;
}

export function ToggleView({ pkgRoot, targetBase, scope, targetPath, filter }: ToggleViewProps) {
  const { exit } = useApp();
  const [allItems, setAllItems] = useState<ToggleItem[]>(() => scanToggleItems(pkgRoot, targetBase));
  const [activeTab, setActiveTab] = useState(() => {
    if (filter) {
      const idx = TABS.findIndex((t) => t.type === filter);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [cursor, setCursor] = useState(0);
  const [dirty, setDirty] = useState(false);

  const tabItems = useMemo(
    () => allItems.filter((i) => i.type === TABS[activeTab].type),
    [allItems, activeTab],
  );

  const count = tabItems.length;
  const safeIdx = count > 0 ? Math.min(cursor, count - 1) : 0;

  useEffect(() => {
    if (cursor >= count) setCursor(Math.max(0, count - 1));
  }, [activeTab, count, cursor]);

  const handleToggle = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= count) return;
      const item = tabItems[idx];
      if (applyToggle(item, pkgRoot)) {
        setAllItems((prev) => {
          const key = `${item.type}:${item.name}`;
          return prev.map((it) => {
            if (`${it.type}:${it.name}` !== key) return it;
            const nextState: ToggleState =
              it.state === 'on' ? 'off' : 'on';
            return { ...it, state: nextState };
          });
        });
        setDirty(true);
      }
    },
    [tabItems, count, pkgRoot],
  );

  const switchTab = useCallback(
    (dir: 1 | -1) => {
      const tabs = filter ? [TABS.findIndex((t) => t.type === filter)] : [0, 1, 2];
      if (tabs.length <= 1) return;
      setActiveTab((prev) => (prev + dir + TABS.length) % TABS.length);
      setCursor(0);
    },
    [filter],
  );

  const handleSave = useCallback(() => {
    const disabled = allItems
      .filter((i) => i.state === 'off')
      .map((i) => `${i.type}:${i.name}`);
    updateManifestDisabledItems(scope, targetPath, disabled);
    exit();
  }, [allItems, scope, targetPath, exit]);

  useInput((input, key) => {
    if (key.escape) {
      if (dirty) handleSave();
      exit();
      return;
    }
    if (key.return) {
      handleSave();
      return;
    }
    if (key.tab) {
      switchTab(key.shift ? -1 : 1);
      return;
    }
    if (key.upArrow) {
      setCursor((i) => (i - 1 + count) % count);
      return;
    }
    if (key.downArrow) {
      setCursor((i) => (i + 1) % count);
      return;
    }
    if (input === ' ') {
      handleToggle(safeIdx);
      return;
    }
  });

  const tabCounts = useMemo(() => {
    const m: Record<string, { on: number; total: number }> = {};
    for (const t of TABS) {
      const list = allItems.filter((i) => i.type === t.type);
      m[t.type] = { on: list.filter((i) => i.state === 'on').length, total: list.length };
    }
    return m;
  }, [allItems]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={C.primary}>Maestro Toggle</Text>
      <Text dimColor>␣ toggle  Tab switch  ↵ save & exit</Text>

      {/* Tab bar */}
      <Box marginTop={1} gap={2}>
        {TABS.map((tab, i) => {
          const active = i === activeTab;
          const c = tabCounts[tab.type];
          return (
            <Text key={tab.type} bold={active} color={active ? C.primary : C.neutral}>
              {active ? '▸ ' : '  '}{tab.label} ({c.on}/{c.total})
            </Text>
          );
        })}
      </Box>

      {/* Items — viewport window around cursor */}
      <Box flexDirection="column" marginTop={1}>
        {count === 0 ? (
          <Text dimColor>  No items in this category.</Text>
        ) : (
          (() => {
            const VIEWPORT = 20;
            let start = 0;
            let end = count;
            if (count > VIEWPORT) {
              start = Math.max(0, safeIdx - Math.floor(VIEWPORT / 2));
              end = Math.min(count, start + VIEWPORT);
              if (end - start < VIEWPORT) start = Math.max(0, end - VIEWPORT);
            }
            const visible = tabItems.slice(start, end);
            return (
              <>
                {start > 0 && <Text dimColor>  ↑ {start} more</Text>}
                {visible.map((item, vi) => {
                  const i = start + vi;
                  const hl = i === safeIdx;
                  const d = STATE_DISPLAY[item.state];
                  return (
                    <Box key={item.name}>
                      <Text color={hl ? C.primary : C.neutral}>{hl ? SYM.cursor : ' '} </Text>
                      <Text color={hl ? (item.state === 'on' ? C.successBright : d.color) : d.color}>
                        {d.sym}
                      </Text>
                      <Text> </Text>
                      <Text color={hl ? C.primary : undefined} bold={hl}>
                        {item.name.padEnd(32)}
                      </Text>
                      {d.label && <Text dimColor>{d.label}</Text>}
                    </Box>
                  );
                })}
                {end < count && <Text dimColor>  ↓ {count - end} more</Text>}
              </>
            );
          })()
        )}
      </Box>

      {dirty && (
        <Box marginTop={1}>
          <Text color={C.warning}>  Changes applied. Press ↵ to save manifest.</Text>
        </Box>
      )}
    </Box>
  );
}
