import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { C, SYM } from '../shared/index.js';
import { EXTRA_MCP_TARGETS, type ExtraMcpTargetId } from '../../commands/install-backend.js';

// ---------------------------------------------------------------------------
// ExtraMcpConfig — multi-select picker for opt-in MCP install targets
//
// Targets: Cursor / Qoder / Trae / Kiro / Roo / VS Code Copilot / Gemini CLI
// All default off; user toggles per target. Path resolution and write logic
// live in install-backend.ts (addExtraMcpServer / removeExtraMcpServer).
// ---------------------------------------------------------------------------

interface ExtraMcpConfigProps {
  mode: 'global' | 'project';
  selectedIds: ExtraMcpTargetId[];
  onSelectionChange: (ids: ExtraMcpTargetId[]) => void;
  onDone: () => void;
  onBack: () => void;
}

export function ExtraMcpConfig({
  mode,
  selectedIds,
  onSelectionChange,
  onDone,
  onBack,
}: ExtraMcpConfigProps) {
  const [cursor, setCursor] = useState(0);

  // Roo is project-only; hide entries with no path for current scope
  const visible = EXTRA_MCP_TARGETS.filter((t) => t.configPath(mode, '') !== null || mode === 'project');
  const count = visible.length;
  const safeIndex = Math.max(0, Math.min(cursor, count - 1));

  const toggle = useCallback(
    (id: ExtraMcpTargetId) => {
      onSelectionChange(
        selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id],
      );
    },
    [selectedIds, onSelectionChange],
  );

  useInput((input, key) => {
    if (key.return) {
      onDone();
      return;
    }
    if (key.escape) {
      onBack();
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
      toggle(visible[safeIndex].id);
      return;
    }
    if (input === 'a' || input === 'A') {
      onSelectionChange(visible.map((t) => t.id));
      return;
    }
    if (input === 'n' || input === 'N') {
      onSelectionChange([]);
      return;
    }
    // Number key 1-9 toggles by index
    const num = parseInt(input, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= count) {
      toggle(visible[num - 1].id);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={C.primary}>
        Extra MCP Targets (opt-in)
      </Text>
      <Text dimColor>
        Register maestro-tools MCP server in additional CLI/IDE configs. Default: none selected.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {visible.map((target, i) => {
          const selected = selectedIds.includes(target.id);
          const highlighted = i === safeIndex;
          const path = target.configPath(mode, '<project>') ?? '(unsupported in global scope)';
          const checkbox = selected ? SYM.checkOn : SYM.checkOff;
          const labelLine = `[${i + 1}] ${checkbox} ${target.label}`;
          return (
            <Box key={target.id} flexDirection="column">
              <Text
                color={highlighted ? C.successBright : selected ? C.success : undefined}
                bold={highlighted}
              >
                {labelLine}
              </Text>
              <Text dimColor>      → {path}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [Space/1-{count}] Toggle  [a] All  [n] None  [Enter] Done  [Esc] Back
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          Selected: {selectedIds.length}/{count}
        </Text>
      </Box>
    </Box>
  );
}
