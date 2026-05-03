import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { type InstallResult } from './types.js';

// ---------------------------------------------------------------------------
// ResultDashboard -- final bordered summary after installation
// ---------------------------------------------------------------------------

interface ResultDashboardProps {
  result: InstallResult;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text color="cyan">{label.padEnd(13)}</Text>
      <Text color="green">{value}</Text>
    </Box>
  );
}

export function ResultDashboard({ result, onClose }: ResultDashboardProps) {
  const { exit } = useApp();

  useInput((_input, key) => {
    if (key.return) {
      onClose();
      exit();
    }
  });

  const { totalStats, manifestPath, mcpRegistered, hookResult, disabledRestored, overlaysApplied } =
    result;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="green"
        paddingX={1}
      >
        <Text bold color="green">
          Installation Complete
        </Text>
        <Row label="Files:" value={`${totalStats.files} installed`} />
        {totalStats.dirs > 0 && (
          <Row label="Dirs:" value={`${totalStats.dirs} created`} />
        )}
        {totalStats.skipped > 0 && (
          <Row label="Preserved:" value={`${totalStats.skipped} settings files`} />
        )}
        {disabledRestored > 0 && (
          <Row label="Disabled:" value={`${disabledRestored} items restored`} />
        )}
        {overlaysApplied > 0 && (
          <Row label="Overlays:" value={`${overlaysApplied} applied`} />
        )}
        {mcpRegistered && (
          <Row label="MCP:" value="maestro-tools registered" />
        )}
        {hookResult && (
          <Row
            label="Hooks:"
            value={`${hookResult.level} (${hookResult.installedHooks.length} hooks)`}
          />
        )}
        <Box>
          <Text color="cyan">{'Manifest:'.padEnd(13)}</Text>
          <Text dimColor>{manifestPath}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Restart Claude Code or IDE to pick up changes.</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Enter to exit.</Text>
      </Box>
    </Box>
  );
}
