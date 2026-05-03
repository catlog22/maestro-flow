import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// StepSelector — checkbox multi-select for install steps
// ---------------------------------------------------------------------------

export interface StepDef {
  id: string;
  label: string;
  description: string;
}

interface StepSelectorProps {
  steps: StepDef[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onDone: () => void;
}

export function StepSelector({ steps, selectedIds, onSelectionChange, onDone }: StepSelectorProps) {
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i <= 0 ? steps.length - 1 : i - 1));
    } else if (key.downArrow) {
      setIndex((i) => (i >= steps.length - 1 ? 0 : i + 1));
    } else if (input === ' ') {
      const id = steps[index].id;
      const next = selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id];
      onSelectionChange(next);
    } else if (input === 'a' || input === 'A') {
      onSelectionChange(steps.map((s) => s.id));
    } else if (input === 'n' || input === 'N') {
      onSelectionChange([]);
    } else if (key.return) {
      onDone();
    } else {
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= steps.length) {
        const id = steps[num - 1].id;
        const next = selectedIds.includes(id)
          ? selectedIds.filter((s) => s !== id)
          : [...selectedIds, id];
        onSelectionChange(next);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Select Installation Steps</Text>
      <Box flexDirection="column" marginTop={1}>
        {steps.map((step, i) => {
          const selected = selectedIds.includes(step.id);
          const highlighted = i === index;
          return (
            <Box key={step.id}>
              <Text color={highlighted ? 'cyan' : 'gray'}>[{i + 1}]</Text>
              <Text color={selected ? 'green' : 'gray'}> {selected ? '[x]' : '[ ]'} </Text>
              <Text color={highlighted ? 'cyan' : undefined} bold={highlighted}>
                {step.label}
              </Text>
              <Text dimColor> — {step.description}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [Space] Toggle  [1-{steps.length}] Quick toggle  [A]ll  [N]one  [Enter] Next
        </Text>
      </Box>
    </Box>
  );
}
