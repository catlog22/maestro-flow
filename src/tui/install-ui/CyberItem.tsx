import React from 'react';
import { Box, Text } from 'ink';

// ---------------------------------------------------------------------------
// CyberItem — single component row in the selection grid
// ---------------------------------------------------------------------------

export interface CyberItemProps {
  /** 1-based display index (1-9) */
  index: number;
  /** Human-readable component label */
  label: string;
  /** Number of files in the source directory */
  fileCount: number;
  /** Whether this row is currently selected for install */
  selected: boolean;
  /** Whether the component has source files available */
  available: boolean;
  /** Whether this row is currently highlighted by cursor */
  highlighted: boolean;
  /** Short description of the component */
  description: string;
}

/** Fixed width for label padding to align file counts */
const LABEL_WIDTH = 16;
/** Fixed width for file count display */
const FILE_COL_WIDTH = 10;

function padEnd(str: string, len: number): string {
  // Visual padding — accounts for wide chars by truncating to len
  if (str.length >= len) return str.slice(0, len);
  return str + '.'.repeat(len - str.length);
}

export function CyberItem({
  index,
  label,
  fileCount,
  selected,
  available,
  highlighted,
  description,
}: CyberItemProps) {
  const checkbox = selected ? '[X]' : '[ ]';
  const paddedLabel = padEnd(label, LABEL_WIDTH);
  const filesStr = `(${fileCount} files)`.padStart(FILE_COL_WIDTH);

  // Determine color state
  if (!available) {
    return (
      <Box>
        <Text dimColor color="gray">
          [{index}] {checkbox} {paddedLabel} {filesStr} [OFFLINE]
        </Text>
      </Box>
    );
  }

  if (selected && highlighted) {
    return (
      <Box>
        <Text color="cyan">[{index}] </Text>
        <Text color="cyan">{checkbox} </Text>
        <Text color="greenBright" bold>{paddedLabel}</Text>
        <Text> {filesStr} </Text>
        <Text dimColor>{description}</Text>
      </Box>
    );
  }

  if (selected) {
    return (
      <Box>
        <Text color="gray">[{index}] </Text>
        <Text color="green">{checkbox} </Text>
        <Text color="green">{paddedLabel}</Text>
        <Text> {filesStr} </Text>
        <Text dimColor>{description}</Text>
      </Box>
    );
  }

  if (highlighted) {
    return (
      <Box>
        <Text color="cyan">[{index}] </Text>
        <Text color="cyan">{checkbox} </Text>
        <Text color="cyan">{paddedLabel}</Text>
        <Text> {filesStr} </Text>
        <Text dimColor>{description}</Text>
      </Box>
    );
  }

  // Normal state
  return (
    <Box>
      <Text color="gray">[{index}] </Text>
      <Text>{checkbox} </Text>
      <Text>{paddedLabel}</Text>
      <Text> {filesStr} </Text>
      <Text dimColor>{description}</Text>
    </Box>
  );
}
