import React from 'react';
import { Box, Text } from 'ink';
import { type WizardStep } from './types.js';

// ---------------------------------------------------------------------------
// ShortcutFooter — context-sensitive keyboard shortcut hints
// ---------------------------------------------------------------------------

interface ShortcutFooterProps {
  currentStep: WizardStep;
}

const STEP_HINTS: Record<WizardStep, string> = {
  mode: '[G]lobal  [P]roject  [Enter] Next',
  components: '[1-9] Toggle  [A]ll  [N]one  [Enter] Next  [Esc] Back',
  config: '[Enter] Next  [Esc] Back',
  review: '[Enter] Install  [Esc] Back',
  executing: 'Installing... please wait',
  complete: '[Enter] Exit',
};

export function ShortcutFooter({ currentStep }: ShortcutFooterProps) {
  const hint = STEP_HINTS[currentStep];

  return (
    <Box paddingX={1}>
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
