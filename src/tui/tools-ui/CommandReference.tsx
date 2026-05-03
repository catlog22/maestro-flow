import React from 'react';
import { Box, Text, useInput } from 'ink';
import {
  selectToolByRole,
  type CliToolsConfig,
} from '../../config/cli-tools-config.js';

export interface CommandReferenceProps {
  config: CliToolsConfig;
  onBack: () => void;
}

interface RefEntry {
  command: string;
  role: string;
  resolvesTo: string;
}

// Static mapping of known --role references in commands/skills
const KNOWN_ROLE_REFS: Array<{ command: string; role: string }> = [
  { command: 'maestro-analyze', role: 'analyze' },
  { command: 'maestro-composer', role: 'analyze' },
  { command: 'maestro-super', role: 'analyze' },
  { command: 'issue-discover', role: 'analyze' },
  { command: 'team-review/scanner', role: 'review' },
  { command: 'team-review/reviewer', role: 'review' },
  { command: 'team-qa/scout', role: 'analyze' },
  { command: 'team-tech-debt/scanner', role: 'explore' },
  { command: 'spec-generate (product)', role: 'analyze' },
  { command: 'spec-generate (technical)', role: 'review' },
  { command: 'spec-generate (user)', role: 'explore' },
];

export function CommandReference({ config, onBack }: CommandReferenceProps) {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const entries: RefEntry[] = KNOWN_ROLE_REFS.map(ref => ({
    command: ref.command,
    role: ref.role,
    resolvesTo: selectToolByRole(ref.role, config)?.name ?? '(none)',
  }));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Command Reference</Text>
      <Text dimColor>Shows which tool each command/skill resolves to via --role</Text>
      <Text> </Text>

      {/* Header */}
      <Box gap={1}>
        <Text dimColor>{pad('Command / Skill', 32)}</Text>
        <Text dimColor>{pad('Role', 24)}</Text>
        <Text dimColor>Resolves To</Text>
      </Box>
      <Text dimColor>{'─'.repeat(76)}</Text>

      {/* Rows */}
      {entries.map((entry, i) => (
        <Box key={i} gap={1}>
          <Text>{pad(entry.command, 32)}</Text>
          <Text color="yellow">{pad(entry.role, 24)}</Text>
          <Text color="green" bold>{entry.resolvesTo}</Text>
        </Box>
      ))}

      <Text> </Text>
      <Text dimColor>[Esc] Back</Text>
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}
