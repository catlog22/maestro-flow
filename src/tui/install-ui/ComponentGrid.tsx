import React, { useState, useCallback } from 'react';
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

// ---------------------------------------------------------------------------
// ComponentGrid — multi-select container for installable components
// ---------------------------------------------------------------------------

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

  const count = components.length;
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
      // Enter: advance
      if (key.return) {
        onDone();
        return;
      }

      // Up arrow: move highlight up with wrapping
      if (key.upArrow) {
        setSelectedIndex((prev) => moveUp(prev, count));
        return;
      }

      // Down arrow: move highlight down with wrapping
      if (key.downArrow) {
        setSelectedIndex((prev) => moveDown(prev, count));
        return;
      }

      // Space: toggle highlighted item
      if (input === ' ') {
        toggleAt(safeIndex);
        return;
      }

      // 'a': select all available
      if (input === 'a' || input === 'A') {
        selectAllAvailable();
        return;
      }

      // 'n': deselect all
      if (input === 'n' || input === 'N') {
        handleDeselectAll();
        return;
      }

      // Number keys '1'-'9': toggle corresponding component by 1-based index
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
        <Text bold color="cyan">
          {t.install.componentsTitle}
        </Text>
        <Text dimColor>{t.install.componentsNone}</Text>
      </Box>
    );
  }

  const availableCount = components.filter((c) => c.available).length;

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {t.install.componentsTitle}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {components.map((comp, i) => (
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
        ))}
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
