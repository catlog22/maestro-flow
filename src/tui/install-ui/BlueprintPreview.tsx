import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { existsSync } from 'node:fs';
import { COMPONENT_DEFS } from '../../commands/install-backend.js';
import { buildTree } from './BlueprintPreview.logic.js';

// ---------------------------------------------------------------------------
// BlueprintPreview -- live file tree showing what will be installed
// ---------------------------------------------------------------------------

export type FileStatus = 'new' | 'exists' | 'preserved';

interface BlueprintPreviewProps {
  mode: 'global' | 'project';
  projectPath: string;
  selectedIds: string[];
}

const STATUS_COLOR: Record<FileStatus, string> = {
  new: 'cyan',
  exists: 'yellow',
  preserved: 'gray',
};

export function BlueprintPreview({ mode, projectPath, selectedIds }: BlueprintPreviewProps) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  // Resolve selected defs to target info
  const resolvedTargets = useMemo(() => {
    const idSet = new Set(selectedIds);
    return COMPONENT_DEFS
      .filter((d) => idSet.has(d.id))
      .map((def) => {
        const targetDir = def.target(mode, projectPath);
        // Determine status based on whether target already exists
        const status: FileStatus = existsSync(targetDir) ? 'exists' : 'new';
        return {
          def,
          targetDir,
          fileCount: 0, // real counts come from scanning; label shown as fallback
          status,
        };
      });
  }, [selectedIds, mode, projectPath]);

  const tree = useMemo(() => buildTree(resolvedTargets), [resolvedTargets]);

  // Compute total files across groups
  const totalFiles = useMemo(
    () => tree.reduce((sum, g) => sum + g.totalFiles, 0),
    [tree],
  );

  // Empty selection
  if (selectedIds.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Blueprint</Text>
        <Box marginTop={1}>
          <Text dimColor>No components selected</Text>
        </Box>
      </Box>
    );
  }

  // Reserve 8 rows for header, border, total line, etc.
  const availableHeight = Math.max(termRows - 8, 6);

  // Flatten tree into renderable lines
  const lines: Array<{ text: string; color: string }> = [];
  for (const group of tree) {
    lines.push({ text: group.parentDir + '/', color: 'white' });
    for (let i = 0; i < group.entries.length; i++) {
      const isLast = i === group.entries.length - 1;
      const branch = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500';
      const entry = group.entries[i];
      const fileStr = entry.fileCount > 0
        ? `(${entry.fileCount} files)`
        : `(${entry.label})`;
      const status = (entry as any).status as FileStatus | undefined;
      const color = status ? STATUS_COLOR[status] : 'cyan';
      lines.push({
        text: `  ${branch} ${entry.subPath} ${fileStr}`,
        color,
      });
    }
  }

  const truncated = lines.length > availableHeight;
  const visibleLines = truncated ? lines.slice(0, availableHeight) : lines;
  const hiddenCount = lines.length - availableHeight;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Blueprint</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
      >
        {visibleLines.map((line, i) => (
          <Text key={i} color={line.color as any}>{line.text}</Text>
        ))}
        {truncated && <Text dimColor>[{hiddenCount} more...]</Text>}
        <Text>Total: {selectedIds.length} components{totalFiles > 0 ? `, ${totalFiles} files` : ''}</Text>
      </Box>
    </Box>
  );
}
