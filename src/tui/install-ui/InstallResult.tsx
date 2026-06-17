import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { InstallFlowResult } from './InstallExecution.js';
import { t } from '../../i18n/index.js';
import { C, BORDER } from '../shared/index.js';

// ---------------------------------------------------------------------------
// InstallResult — final summary dashboard
// ---------------------------------------------------------------------------

interface InstallResultProps {
  result: InstallFlowResult;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box>
      <Text color={C.primary}>{label.padEnd(13)}</Text>
      <Text color={valueColor ?? C.success}>{value}</Text>
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
      <Box flexDirection="column" {...BORDER.success} paddingX={1}>
        <Text bold color={C.success}>{t.install.resultTitle}</Text>

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
          valueColor={result.statuslineInstalled ? C.success : C.neutral}
        />
        <Row
          label="MCP:"
          value={result.mcpRegistered ? 'maestro-tools registered' : t.install.confirmSkipped}
          valueColor={result.mcpRegistered ? C.success : C.neutral}
        />
        {result.codexHooksInstalled > 0 && (
          <Row label="Codex Hooks:" value={t.install.resultHooks.replace('{count}', String(result.codexHooksInstalled))} />
        )}
        <Row
          label="Codex MCP:"
          value={result.codexMcpRegistered ? 'maestro-tools registered' : t.install.confirmSkipped}
          valueColor={result.codexMcpRegistered ? C.success : C.neutral}
        />
        {result.agyHooksInstalled > 0 && (
          <Row label="Agy Hooks:" value={t.install.resultHooks.replace('{count}', String(result.agyHooksInstalled))} />
        )}
        {(result.extraMcpRegistered.length > 0 || result.extraMcpFailed.length > 0) && (
          <Row
            label="Extra MCP:"
            value={
              result.extraMcpFailed.length === 0
                ? `${result.extraMcpRegistered.join(', ')}`
                : `${result.extraMcpRegistered.join(', ')}${result.extraMcpRegistered.length ? ' | ' : ''}failed: ${result.extraMcpFailed.join(', ')}`
            }
            valueColor={result.extraMcpFailed.length === 0 ? C.success : C.warning}
          />
        )}
        {result.backupPath && (
          <Box>
            <Text color={C.primary}>{'Backup:'.padEnd(13)}</Text>
            <Text dimColor>{result.backupPath}</Text>
          </Box>
        )}
        {result.manifestPath && (
          <Box>
            <Text color={C.primary}>{t.install.resultManifest.padEnd(13)}</Text>
            <Text dimColor>{result.manifestPath}</Text>
          </Box>
        )}
      </Box>

      {result.migrationWarnings.length > 0 && (
        <Box flexDirection="column" {...BORDER.warning} paddingX={1} marginTop={1}>
          <Text bold color={C.warning}>⚠ Migration Warnings</Text>
          {result.migrationWarnings.map((w, i) => (
            <Text key={i} color={C.warning} wrap="wrap">{w}</Text>
          ))}
        </Box>
      )}

      {result.statuslineInstalled && (
        <Box marginTop={1}>
          <Text dimColor>
            Nerd Font glyphs needed for statusline icons — run{' '}
          </Text>
          <Text color={C.primary}>maestro install fonts</Text>
          <Text dimColor> for platform-specific setup.</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>{t.install.resultExit}</Text>
      </Box>
    </Box>
  );
}
