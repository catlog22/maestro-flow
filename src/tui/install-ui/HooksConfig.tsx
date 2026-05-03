import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  HOOK_LEVELS,
  type HookLevel,
} from '../../commands/hooks.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// HooksConfig -- Hook level selection panel (radio-style)
// Supports: Up/Down arrows, number keys 1-4, Space to select
// ---------------------------------------------------------------------------

interface HooksConfigProps {
  level: HookLevel;
  onLevelChange: (level: HookLevel) => void;
}

export function HooksConfig({ level, onLevelChange }: HooksConfigProps) {
  const [index, setIndex] = useState(() => HOOK_LEVELS.indexOf(level));

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setIndex((i) => (i <= 0 ? HOOK_LEVELS.length - 1 : i - 1));
      } else if (key.downArrow) {
        setIndex((i) => (i >= HOOK_LEVELS.length - 1 ? 0 : i + 1));
      } else if (input === ' ') {
        onLevelChange(HOOK_LEVELS[index]);
      } else {
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= HOOK_LEVELS.length) {
          const idx = num - 1;
          setIndex(idx);
          onLevelChange(HOOK_LEVELS[idx]);
        }
      }
    },
  );

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {t.install.hooksTitle}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {HOOK_LEVELS.map((lvl, i) => {
          const isActive = lvl === level;
          const isHighlighted = i === index;
          const label = lvl.charAt(0).toUpperCase() + lvl.slice(1);
          const desc = t.install.hooksLevelDescriptions[lvl];

          return (
            <Box key={lvl}>
              <Text color={isHighlighted ? 'cyan' : 'gray'}>
                [{i + 1}]
              </Text>
              <Text color={isActive ? 'green' : 'gray'}>
                {' '}{isActive ? '(x)' : '( )'}{' '}
              </Text>
              <Text color={isHighlighted ? 'cyan' : undefined} bold={isHighlighted}>
                {label}
              </Text>
              <Text dimColor> -- {desc}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [Up/Down] Navigate  [Space/1-{HOOK_LEVELS.length}] Select  [Enter] Done  [Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
