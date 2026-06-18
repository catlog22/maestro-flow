import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { CyberItem } from './CyberItem.js';
import {
  toggleSelection,
  moveUp,
  moveDown,
  parseNumberKey,
  clampIndex,
} from './ComponentGrid.logic.js';
import type { ScannedComponent } from '../../commands/install-backend.js';
import { t } from '../../i18n/index.js';
import { C } from '../shared/index.js';

// ---------------------------------------------------------------------------
// ComponentGrid — multi-select container with category grouping + viewport
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  commands: '── Commands ──────────────────',
  skills: '── Skills ────────────────────',
};

type VisualRow =
  | { type: 'header'; label: string; category: string }
  | { type: 'item'; comp: ScannedComponent; itemIndex: number };

export interface ComponentGridProps {
  components: ScannedComponent[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onDone: () => void;
}

const VIEWPORT = 20;

export function ComponentGrid({
  components,
  selectedIds,
  onSelectionChange,
  onDone,
}: ComponentGridProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevCountRef = useRef(components.length);

  useEffect(() => {
    if (components.length !== prevCountRef.current) {
      setSelectedIndex(0);
      prevCountRef.current = components.length;
    }
  }, [components.length]);

  // Build grouped order: ungrouped first, then by category.
  // `ordered` is the source of truth for both navigation and rendering.
  const { ordered, visualRows, itemToVisualRow } = useMemo(() => {
    const ungrouped: ScannedComponent[] = [];
    const catMap = new Map<string, ScannedComponent[]>();
    const catOrder: string[] = [];

    for (const comp of components) {
      const cat = comp.def.category;
      if (!cat) {
        ungrouped.push(comp);
      } else {
        if (!catMap.has(cat)) {
          catMap.set(cat, []);
          catOrder.push(cat);
        }
        catMap.get(cat)!.push(comp);
      }
    }

    // Flat ordered array: navigation index = render index
    const orderedList: ScannedComponent[] = [...ungrouped];
    for (const cat of catOrder) {
      orderedList.push(...catMap.get(cat)!);
    }

    // Visual rows include headers between category groups
    const rows: VisualRow[] = [];
    const mapping = new Map<number, number>();
    let itemIdx = 0;

    // Ungrouped items
    for (const comp of ungrouped) {
      mapping.set(itemIdx, rows.length);
      rows.push({ type: 'item', comp, itemIndex: itemIdx });
      itemIdx++;
    }

    // Categorized groups
    for (const cat of catOrder) {
      const label = CATEGORY_LABELS[cat] || `── ${cat} ──`;
      rows.push({ type: 'header', label, category: cat });
      for (const comp of catMap.get(cat)!) {
        mapping.set(itemIdx, rows.length);
        rows.push({ type: 'item', comp, itemIndex: itemIdx });
        itemIdx++;
      }
    }

    return { ordered: orderedList, visualRows: rows, itemToVisualRow: mapping };
  }, [components]);

  const count = ordered.length;
  const safeIndex = clampIndex(selectedIndex, count);

  const toggleId = useCallback(
    (id: string) => {
      onSelectionChange(toggleSelection(selectedIds, id));
    },
    [selectedIds, onSelectionChange],
  );

  const toggleAt = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= count) return;
      const comp = ordered[idx];
      if (!comp.available) return;
      toggleId(comp.def.id);
    },
    [ordered, count, toggleId],
  );

  const selectAllAvailable = useCallback(() => {
    const allIds = ordered.filter((c) => c.available).map((c) => c.def.id);
    onSelectionChange(allIds);
  }, [ordered, onSelectionChange]);

  const handleDeselectAll = useCallback(() => {
    onSelectionChange([]);
  }, [onSelectionChange]);

  useInput(
    (input, key) => {
      if (key.return) {
        onDone();
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => moveUp(prev, count));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => moveDown(prev, count));
        return;
      }
      if (input === ' ') {
        toggleAt(safeIndex);
        return;
      }
      if (input === 'a' || input === 'A') {
        selectAllAvailable();
        return;
      }
      if (input === 'n' || input === 'N') {
        handleDeselectAll();
        return;
      }
      const idx = parseNumberKey(input, count);
      if (idx >= 0) {
        toggleAt(idx);
        return;
      }
    },
  );

  if (count === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color={C.primary}>
          {t.install.componentsTitle}
        </Text>
        <Text dimColor>{t.install.componentsNone}</Text>
      </Box>
    );
  }

  const availableCount = ordered.filter((c) => c.available).length;

  // Viewport window around current cursor
  const cursorVisualRow = itemToVisualRow.get(safeIndex) ?? 0;
  const totalVisual = visualRows.length;
  let vStart = 0;
  let vEnd = totalVisual;
  if (totalVisual > VIEWPORT) {
    vStart = Math.max(0, cursorVisualRow - Math.floor(VIEWPORT / 2));
    vEnd = Math.min(totalVisual, vStart + VIEWPORT);
    if (vEnd - vStart < VIEWPORT) vStart = Math.max(0, vEnd - VIEWPORT);
  }
  const visibleRows = visualRows.slice(vStart, vEnd);

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>
        {t.install.componentsTitle}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {vStart > 0 && <Text dimColor>  ↑ {vStart} more</Text>}
        {visibleRows.map((row, vi) => {
          if (row.type === 'header') {
            return (
              <Box key={`hdr-${row.category}`} marginTop={vi > 0 ? 1 : 0}>
                <Text color={C.primary}>{row.label}</Text>
              </Box>
            );
          }
          const { comp, itemIndex } = row;
          return (
            <CyberItem
              key={comp.def.id}
              index={itemIndex + 1}
              label={comp.def.label}
              fileCount={comp.fileCount}
              selected={selectedIds.includes(comp.def.id)}
              available={comp.available}
              highlighted={itemIndex === safeIndex}
              description={comp.def.description}
            />
          );
        })}
        {vEnd < totalVisual && <Text dimColor>  ↓ {totalVisual - vEnd} more</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {t.install.componentsSelected
            .replace('{selected}', String(selectedIds.length))
            .replace('{total}', String(availableCount))}
        </Text>
      </Box>
    </Box>
  );
}
