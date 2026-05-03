import React from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// ReviewPanel -- Installation summary before execution
// ---------------------------------------------------------------------------

interface ReviewPanelProps {
  config: {
    mode: 'global' | 'project';
    projectPath: string;
    selectedIds: string[];
    mcpEnabled: boolean;
    mcpTools: string[];
    mcpProjectRoot: string;
    hookLevel: string;
    doBackup: boolean;
  };
  componentLabels: string[];
  fileCount: number;
  onConfirm: () => void;
  onBack: () => void;
}

export function ReviewPanel({
  config,
  componentLabels,
  fileCount,
  onConfirm,
  onBack,
}: ReviewPanelProps) {
  useInput(
    (_input, key) => {
      if (key.return) {
        onConfirm();
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
    },
  );

  const targetDir = config.mode === 'global'
    ? '~/.maestro/ + ~/.claude/'
    : config.projectPath || './';

  const componentsStr = componentLabels.length > 0
    ? componentLabels.join(', ')
    : 'None';

  const mcpStr = config.mcpEnabled
    ? `${config.mcpTools.length} tools enabled`
    : 'disabled';

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Installation Summary
      </Text>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        marginTop={1}
      >
        <Box>
          <Text bold>Mode:{'        '}</Text>
          <Text>{config.mode}</Text>
        </Box>
        <Box>
          <Text bold>Target:{'      '}</Text>
          <Text>{targetDir}</Text>
        </Box>
        <Box>
          <Text bold>Components:{'  '}</Text>
          <Text>{componentsStr}</Text>
        </Box>
        <Box>
          <Text bold>Files:{'       '}</Text>
          <Text>{fileCount} total</Text>
        </Box>
        <Box>
          <Text bold>MCP:{'        '}</Text>
          <Text>{mcpStr}</Text>
        </Box>
        <Box>
          <Text bold>Hooks:{'      '}</Text>
          <Text>{config.hookLevel}</Text>
        </Box>
        <Box>
          <Text bold>Backup:{'     '}</Text>
          <Text>{config.doBackup ? 'yes' : 'no'}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Enter to install, Esc to go back</Text>
      </Box>
    </Box>
  );
}
