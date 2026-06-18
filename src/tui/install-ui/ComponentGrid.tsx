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
// ComponentGrid — multi-select container with category grouping
// ---------------------------------------------------------------------------

interface CategoryGroup {
  category: string;
  label: string;
  components: ScannedComponent[];
}

const CATEGORY_LABELS: Record<string, string> = {
  commands: '── Commands ──────────────────',
  skills: '── Skills ────────────────────',
  'extra-team': '── Extra Team Skills ─────────',
  'extra-scholar': '── Scholar Skills ────────────',
  'extra-meta': '── Meta Skills (Skill Tooling) ─',
};

export interface ComponentGridProps {
  /** Scanned components from backend */
  components: ScannedComponent[];
  /** Currently selected component IDs */
  selectedIds: string[];
  /** Callback when selection changes */
  onSelectionChange: (ids: string[]) => void;
  /** Callback to advance to next wizard step */
  onDone: () => void;
}

export function ComponentGrid({
  components,
  selectedIds,
  onSelectionChange,
  onDone,
}: ComponentGridProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevCountRef = useRef(components.length);

  const count = components.length;
  const safeIndex = clampIndex(selectedIndex, count);

  useEffect(() => {
    if (components.length !== prevCountRef.current) {
      setSelectedIndex(0);
      prevCountRef.current = components.length;
    }
  }, [components.length]);

  const groups = useMemo((): CategoryGroup[] => {
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

    const result: CategoryGroup[] = [];
    if (ungrouped.length > 0) {
      result.push({ category: '', label: '', components: ungrouped });
    }
    for (const cat of catOrder) {
      result.push({
        category: cat,
        label: CATEGORY_LABELS[cat] || `── ${cat} ──`,
        components: catMap.get(cat)!,
      });
    }
    return result;
  }, [components]);

  const toggleId = useCallback(
    (id: string) => {
      onSelectionChange(toggleSelection(selectedIds, id));
    },
    [selectedIds, onSelectionChange],
  );

  const toggleAt = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= count) return;
      const comp = components[idx];
      if (!comp.available) return;
      toggleId(comp.def.id);
    },
    [components, count, toggleId],
  );

  const selectAllAvailable = useCallback(() => {
    const allIds = components.filter((c) => c.available).map((c) => c.def.id);
    onSelectionChange(allIds);
  }, [components, onSelectionChange]);

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

  const availableCount = components.filter((c) => c.available).length;

  let globalIndex = 0;

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>
        {t.install.componentsTitle}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {groups.map((group) => {
          const groupItems = group.components.map((comp) => {
            const i = globalIndex++;
            return (
              <CyberItem
                key={comp.def.id}
                index={i + 1}
                label={comp.def.label}
                fileCount={comp.fileCount}
                selected={selectedIds.includes(comp.def.id)}
                available={comp.available}
                highlighted={i === safeIndex}
                description={comp.def.description}
              />
            );
          });

          if (!group.label) return <React.Fragment key="ungrouped">{groupItems}</React.Fragment>;

          return (
            <React.Fragment key={group.category}>
              <Box marginTop={1}>
                <Text color={C.neutral} dimColor>{group.label}</Text>
              </Box>
              {groupItems}
            </React.Fragment>
          );
        })}
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
