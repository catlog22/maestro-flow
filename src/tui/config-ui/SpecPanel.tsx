import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

interface SpecFileInfo {
  name: string;
  entries: number;
  size: number;
}

interface ScopeInfo {
  scope: string;
  exists: boolean;
  files: SpecFileInfo[];
}

export interface SpecPanelProps {
  workDir: string;
  onBack?: () => void;
}

const SCOPE_LABELS: Record<string, string> = {
  project: 'Project',
  global: 'Global',
  team: 'Team',
};

export function SpecPanel({ workDir, onBack }: SpecPanelProps) {
  const { exit } = useApp();
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [activeScope, setActiveScope] = useState(0);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    const { existsSync, readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { resolveSpecDir } = await import('../../tools/spec-loader.js');

    const result: ScopeInfo[] = [];

    for (const scope of ['project', 'global', 'team'] as const) {
      const dir = resolveSpecDir(workDir, scope);
      const exists = existsSync(dir);
      const files: SpecFileInfo[] = [];

      if (exists) {
        const entries = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
        for (const file of entries) {
          const content = readFileSync(join(dir, file), 'utf-8');
          const entryCount = (content.match(/<spec-entry\b/g) || []).length;
          files.push({ name: file, entries: entryCount, size: content.length });
        }
      }

      result.push({ scope, exists, files });
    }

    setScopes(result);
  }

  const currentScope = scopes[activeScope];
  const fileCount = currentScope?.files.length ?? 0;

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onBack) onBack();
      else exit();
    }
    if (key.leftArrow) {
      setActiveScope(s => Math.max(0, s - 1));
      setCursor(0);
    }
    if (key.rightArrow) {
      setActiveScope(s => Math.min(scopes.length - 1, s + 1));
      setCursor(0);
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(fileCount - 1, c + 1));
  });

  if (scopes.length === 0) {
    return <Text dimColor>Loading spec status...</Text>;
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">SPEC SYSTEM</Text>
        <Text> </Text>

        {/* Scope tabs */}
        <Box gap={1}>
          {scopes.map((s, i) => (
            <Box key={s.scope} paddingX={1}>
              {i === activeScope
                ? <Text bold inverse color="cyan">{` ${SCOPE_LABELS[s.scope]} `}</Text>
                : <Text dimColor>{` ${SCOPE_LABELS[s.scope]} `}</Text>
              }
            </Box>
          ))}
        </Box>
        <Text> </Text>

        {!currentScope.exists ? (
          <Box flexDirection="column">
            <Text color="red">  Directory not initialized</Text>
            <Text dimColor>  Run: maestro spec init --scope {currentScope.scope}</Text>
          </Box>
        ) : currentScope.files.length === 0 ? (
          <Text dimColor>  No spec files found</Text>
        ) : (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text dimColor>{pad('', 2)}</Text>
              <Text dimColor bold>{pad('File', 30)}</Text>
              <Text dimColor bold>{pad('Entries', 10)}</Text>
              <Text dimColor bold>Size</Text>
            </Box>
            {currentScope.files.map((f, i) => {
              const isCurrent = i === cursor;
              const hasEntries = f.entries > 0;
              return (
                <Box key={f.name} gap={1}>
                  <Text color="cyan">{isCurrent ? '›' : ' '}</Text>
                  <Text color={hasEntries ? 'green' : 'yellow'}>{hasEntries ? '✓' : '○'}</Text>
                  <Text bold={isCurrent}>{pad(f.name, 29)}</Text>
                  <Text dimColor={!isCurrent}>{pad(String(f.entries), 10)}</Text>
                  <Text dimColor>{formatSize(f.size)}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        <Text> </Text>
        <Text dimColor>  ←/→ scope  ↑/↓ navigate  [q] back</Text>
        <Text dimColor>  CLI: maestro spec {'<'}init|load|add|list|status{'>'}</Text>
      </Box>
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
