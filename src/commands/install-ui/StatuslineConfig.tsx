import React from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';
import type { StatuslineStyle } from '../hooks.js';

// ---------------------------------------------------------------------------
// StatuslineConfig — Statusline toggle + style selection
// ---------------------------------------------------------------------------

const STYLES: { key: StatuslineStyle; label: string; desc: string }[] = [
  { key: 'text',      label: 'Colored Text', desc: t.install.statuslineStyleText },
  { key: 'powerline', label: 'Powerline',    desc: t.install.statuslineStylePowerline },
];

interface StatuslineConfigProps {
  enabled: boolean;
  style: StatuslineStyle;
  nerdFont: boolean;
  /** Currently detected statusline command, or null */
  detected: string | null;
  onToggle: (v: boolean) => void;
  onStyleChange: (v: StatuslineStyle) => void;
  onNerdFontChange: (v: boolean) => void;
}

export function StatuslineConfig({
  enabled, style, nerdFont, detected,
  onToggle, onStyleChange, onNerdFontChange,
}: StatuslineConfigProps) {
  useInput((input, key) => {
    if (!enabled) {
      // Toggle install on/off
      if (input === 'y' || input === 'Y') onToggle(true);
      else if (input === 'n' || input === 'N') onToggle(false);
      return;
    }

    // Style selection: 1/2
    if (input === '1') onStyleChange('text');
    else if (input === '2') onStyleChange('powerline');
    // Nerd Font toggle: f
    else if (input === 'f' || input === 'F') onNerdFontChange(!nerdFont);
    // Back to toggle
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

      {enabled && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.install.statuslineStyleTitle}</Text>
          {STYLES.map((s, i) => (
            <Box key={s.key} marginLeft={1}>
              <Text color={style === s.key ? 'green' : 'gray'}>
                {style === s.key ? '● ' : '○ '}
              </Text>
              <Text color={style === s.key ? 'green' : undefined} bold={style === s.key}>
                [{i + 1}] {s.label}
              </Text>
              <Text dimColor>  {s.desc}</Text>
            </Box>
          ))}

          <Box marginTop={1}>
            <Text>
              {t.install.statuslineNerdFontPrompt}{' '}
            </Text>
            <Text color={nerdFont ? 'green' : 'gray'} bold>
              {nerdFont ? '[On]' : '[Off]'}
            </Text>
            <Text dimColor> [f]</Text>
          </Box>
          {nerdFont && (
            <Box marginLeft={2}>
              <Text dimColor>{t.install.statuslineNerdFontHint}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
