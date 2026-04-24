import React from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// StatuslineConfig — Statusline toggle (colored text mode only)
// ---------------------------------------------------------------------------

interface StatuslineConfigProps {
  enabled: boolean;
  /** Currently detected statusline command, or null */
  detected: string | null;
  onToggle: (v: boolean) => void;
}

export function StatuslineConfig({
  enabled, detected, onToggle,
}: StatuslineConfigProps) {
  useInput((input) => {
    if (input === 'y' || input === 'Y') onToggle(true);
    else if (input === 'n' || input === 'N') onToggle(false);
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{t.install.statuslineTitle}</Text>

      {detected && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">{t.install.statuslineCurrentLabel}</Text>
          <Text dimColor>  {detected}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>{t.install.statuslineInstallPrompt} </Text>
        <Text color={enabled ? 'green' : 'yellow'} bold>
          {enabled ? '[Yes]' : '[No]'}
        </Text>
        <Text dimColor> [y/n]</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{t.install.statuslineDesc}</Text>
      </Box>

      {detected && enabled && (
        <Box marginTop={1}>
          <Text color="yellow">{t.install.statuslineOverwriteWarn}</Text>
        </Box>
      )}
    </Box>
  );
}
