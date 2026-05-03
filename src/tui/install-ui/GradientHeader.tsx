import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { type WizardStep, WIZARD_STEPS } from './types.js';

// ---------------------------------------------------------------------------
// GradientHeader — neon gradient header with step progress
// ---------------------------------------------------------------------------

interface GradientHeaderProps {
  currentStep: WizardStep;
  version: string;
}

const STEP_LABELS: Record<WizardStep, string> = {
  mode: 'Mode',
  components: 'Components',
  config: 'Config',
  review: 'Review',
  executing: 'Installing',
  complete: 'Done',
};

export function GradientHeader({ currentStep, version }: GradientHeaderProps) {
  const stepIndex = WIZARD_STEPS.indexOf(currentStep);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        <Gradient name="fruit">
          <BigText text="MAESTRO" font="slick" />
        </Gradient>
        <Box marginTop={-2}>
          <Text dimColor>
            <BigText text="flow" font="slick" />
          </Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>install wizard  v{version}</Text>
        </Box>
      </Box>

      <Box gap={1}>
        {WIZARD_STEPS.map((step, i) => (
          <Text
            key={step}
            bold={step === currentStep}
            color={i < stepIndex ? 'green' : step === currentStep ? 'cyan' : 'gray'}
          >
            {i < stepIndex ? '[x]' : step === currentStep ? '[>]' : '[ ]'} {STEP_LABELS[step]}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
