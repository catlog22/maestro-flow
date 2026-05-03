import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { InstallFlowResult } from './InstallExecution.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallResult — final summary dashboard
// ---------------------------------------------------------------------------

interface InstallResultProps {
  result: InstallFlowResult;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box>
      <Text color="cyan">{label.padEnd(13)}</Text>
      <Text color={valueColor ?? 'green'}>{value}</Text>
    </Box>
  );
}

export function InstallResult({ result }: InstallResultProps) {
  const { exit } = useApp();

  useInput((_input, key) => {
    if (key.return) exit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text bold color="green">{t.install.resultTitle}</Text>

        {result.filesInstalled > 0 && (
          <Row label={t.install.resultFiles.replace('{count}', '')} value={t.install.resultFiles.replace('{count}', String(result.filesInstalled))} />
        )}
        {result.dirsCreated > 0 && (
          <Row label="Dirs:" value={t.install.resultDirs.replace('{count}', String(result.dirsCreated))} />
        )}
        {result.filesSkipped > 0 && (
          <Row label="Preserved:" value={t.install.resultPreserved.replace('{count}', String(result.filesSkipped))} />
        )}
        {result.hooksInstalled > 0 && (
          <Row label="Hooks:" value={t.install.resultHooks.replace('{count}', String(result.hooksInstalled))} />
        )}
        <Row
          label="Statusline:"
          value={result.statuslineInstalled ? t.install.resultStatuslineInstalled : t.install.confirmSkipped}
          valueColor={result.statuslineInstalled ? 'green' : 'gray'}
        />
        <Row
          label="MCP:"
          value={result.mcpRegistered ? 'maestro-tools registered' : t.install.confirmSkipped}
          valueColor={result.mcpRegistered ? 'green' : 'gray'}
        />
        {result.backupPath && (
          <Box>
            <Text color="cyan">{'Backup:'.padEnd(13)}</Text>
            <Text dimColor>{result.backupPath}</Text>
          </Box>
        )}
        {result.manifestPath && (
          <Box>
            <Text color="cyan">{t.install.resultManifest.padEnd(13)}</Text>
            <Text dimColor>{result.manifestPath}</Text>
          </Box>
        )}
      </Box>

      {result.migrationWarnings.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text bold color="yellow">⚠ Migration Warnings</Text>
          {result.migrationWarnings.map((w, i) => (
            <Text key={i} color="yellow" wrap="wrap">{w}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>{t.install.resultExit}</Text>
      </Box>
    </Box>
  );
}
