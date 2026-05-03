import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { MCP_TOOLS } from '../install-backend.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// McpConfig -- MCP tools configuration panel
// Supports: Up/Down arrows, Space to toggle, number keys, y/n enable
// ---------------------------------------------------------------------------

interface McpConfigProps {
  enabled: boolean;
  tools: string[];
  projectRoot: string;
  mode: string;
  onEnableChange: (v: boolean) => void;
  onToolsChange: (tools: string[]) => void;
  onRootChange: (root: string) => void;
}

export function McpConfig({
  enabled,
  tools,
  projectRoot,
  mode,
  onEnableChange,
  onToolsChange,
  onRootChange,
}: McpConfigProps) {
  const [editingRoot, setEditingRoot] = useState(false);
  const [rootInput, setRootInput] = useState(projectRoot);
  // Index 0 = enable toggle, 1..N = tools
  const [index, setIndex] = useState(0);
  const totalRows = enabled ? 1 + MCP_TOOLS.length : 1;

  const toggleTool = useCallback(
    (toolIndex: number) => {
      if (toolIndex < 0 || toolIndex >= MCP_TOOLS.length) return;
      const toolName = MCP_TOOLS[toolIndex];
      if (tools.includes(toolName)) {
        onToolsChange(tools.filter((t) => t !== toolName));
      } else {
        onToolsChange([...tools, toolName]);
      }
    },
    [tools, onToolsChange],
  );

  useInput(
    (input, key) => {
      if (editingRoot) return;

      if (key.upArrow) {
        setIndex((i) => (i <= 0 ? totalRows - 1 : i - 1));
      } else if (key.downArrow) {
        setIndex((i) => (i >= totalRows - 1 ? 0 : i + 1));
      } else if (input === ' ') {
        if (index === 0) {
          onEnableChange(!enabled);
        } else {
          toggleTool(index - 1);
        }
      } else if (input === 'y' || input === 'Y') {
        onEnableChange(true);
      } else if (input === 'n' || input === 'N') {
        onEnableChange(false);
      } else if (input === 'r' || input === 'R') {
        setEditingRoot(true);
      } else {
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= MCP_TOOLS.length && enabled) {
          toggleTool(num - 1);
        }
      }
    },
  );

  const handleRootSubmit = useCallback(
    (value: string) => {
      onRootChange(value);
      setEditingRoot(false);
    },
    [onRootChange],
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {t.install.mcpTitle}
      </Text>

      <Box marginTop={1}>
        <Text color={index === 0 ? 'cyan' : undefined}>
          {t.install.mcpEnable}{' '}
        </Text>
        <Text color={enabled ? 'green' : 'yellow'} bold>
          {enabled ? t.install.mcpYes : t.install.mcpNo}
        </Text>
        <Text dimColor> [y/n/Space]</Text>
      </Box>

      {enabled && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.install.mcpTools}</Text>
          <Box flexDirection="column" marginTop={1}>
            {MCP_TOOLS.map((tool, i) => {
              const checked = tools.includes(tool);
              const hl = index === i + 1;
              return (
                <Box key={tool}>
                  <Text color={hl ? 'cyan' : 'gray'}>[{i + 1}]</Text>
                  <Text color={checked ? 'green' : 'gray'}> {checked ? '[x]' : '[ ]'} </Text>
                  <Text color={hl ? 'cyan' : undefined} bold={hl}>{tool}</Text>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>
              {t.install.mcpToolsEnabled
                .replace('{enabled}', String(tools.length))
                .replace('{total}', String(MCP_TOOLS.length))}
            </Text>
          </Box>

          {mode === 'project' && (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                {t.install.mcpProjectRoot}{' '}
                {editingRoot ? (
                  <TextInput
                    placeholder={projectRoot || process.cwd()}
                    defaultValue={projectRoot}
                    onSubmit={handleRootSubmit}
                    onChange={setRootInput}
                  />
                ) : (
                  <Text color="cyan">{projectRoot || t.install.mcpProjectRootDefault}</Text>
                )}
              </Text>
              {!editingRoot && (
                <Text dimColor>{t.install.mcpEditRoot}</Text>
              )}
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [Up/Down] Navigate  [Space/1-{MCP_TOOLS.length}] Toggle  [y/n] Enable  [Enter] Done  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
