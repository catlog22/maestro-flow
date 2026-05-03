import React from 'react';
import { Box, Text, useInput } from 'ink';
import { t } from '../../i18n/index.js';
import { THEME_NAMES } from '../../hooks/constants.js';

// ---------------------------------------------------------------------------
// StatuslineConfig — Statusline toggle + theme selection
// ---------------------------------------------------------------------------

const THEME_LABELS: Record<string, { label: string; desc: string }> = {
  notion:    { label: 'Notion',       desc: '柔和暖色，Catppuccin 风格' },
  cyberpunk: { label: 'Cyberpunk',    desc: '霓虹高对比，赛博朋克' },
  pastel:    { label: 'Fresh Pastel', desc: '柔和粉蓝绿，小清新' },
  nord:      { label: 'Nord',         desc: '北欧冰蓝，沉稳冷调' },
  monokai:   { label: 'Monokai',      desc: '经典编辑器，高辨识' },
};

interface StatuslineConfigProps {
  enabled: boolean;
  theme: string;
  /** Currently detected statusline command, or null */
  detected: string | null;
  onToggle: (v: boolean) => void;
  onThemeChange: (v: string) => void;
}

export function StatuslineConfig({
  enabled, theme, detected,
  onToggle, onThemeChange,
}: StatuslineConfigProps) {
  useInput((input) => {
    if (!enabled) {
      if (input === 'y' || input === 'Y') onToggle(true);
      else if (input === 'n' || input === 'N') onToggle(false);
      return;
    }

    // Theme selection: 1-5
    const idx = parseInt(input, 10) - 1;
    if (idx >= 0 && idx < THEME_NAMES.length) {
      onThemeChange(THEME_NAMES[idx]);
    }
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
          <Text bold>Color Theme:</Text>
          {THEME_NAMES.map((name, i) => {
            const info = THEME_LABELS[name] ?? { label: name, desc: '' };
            const selected = theme === name;
            return (
              <Box key={name} marginLeft={1}>
                <Text color={selected ? 'green' : 'gray'}>
                  {selected ? '● ' : '○ '}
                </Text>
                <Text color={selected ? 'green' : undefined} bold={selected}>
                  [{i + 1}] {info.label}
                </Text>
                <Text dimColor>  {info.desc}</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
