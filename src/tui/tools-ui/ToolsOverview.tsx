import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import {
  saveCliToolsConfig,
  DOMAIN_TAGS,
  type CliToolsConfig,
} from '../../config/cli-tools-config.js';

export interface ToolsOverviewProps {
  config: CliToolsConfig;
  workDir: string;
  onBack: () => void;
  onReload: () => void;
}

type Mode = 'list' | 'edit-tags';

export function ToolsOverview({ config, workDir, onBack, onReload }: ToolsOverviewProps) {
  const entries = Object.entries(config.tools);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [tagCursor, setTagCursor] = useState(0);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useInput((input, key) => {
    if (saving) return;

    if (mode === 'list') {
      if (key.escape) { onBack(); return; }
      if (key.upArrow) setCursor(c => c > 0 ? c - 1 : entries.length - 1);
      if (key.downArrow) setCursor(c => c < entries.length - 1 ? c + 1 : 0);
      if (input === 't' && entries.length > 0) {
        // Enter tag editing for current tool
        setEditTags([...(entries[cursor][1].tags ?? [])]);
        setTagCursor(0);
        setMode('edit-tags');
      }
      if (input === ' ' && entries.length > 0) {
        // Toggle enabled
        const [name, entry] = entries[cursor];
        setSaving(true);
        saveCliToolsConfig({ tools: { [name]: { ...entry, enabled: !entry.enabled } } }, 'global', workDir)
          .then(() => { onReload(); setSaving(false); });
      }
    }

    if (mode === 'edit-tags') {
      if (key.escape) { setMode('list'); return; }
      if (key.upArrow) setTagCursor(c => c > 0 ? c - 1 : DOMAIN_TAGS.length - 1);
      if (key.downArrow) setTagCursor(c => c < DOMAIN_TAGS.length - 1 ? c + 1 : 0);
      if (input === ' ' || key.return) {
        const tag = DOMAIN_TAGS[tagCursor];
        setEditTags(prev =>
          prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
        );
      }
      if (input === 's') {
        // Save tags
        const [name, entry] = entries[cursor];
        setSaving(true);
        saveCliToolsConfig({ tools: { [name]: { ...entry, tags: editTags } } }, 'global', workDir)
          .then(() => { onReload(); setSaving(false); setMode('list'); });
      }
    }
  });

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Tools Overview</Text>
        <Text dimColor>No tools configured.</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
    );
  }

  if (mode === 'edit-tags') {
    const [name] = entries[cursor];
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Edit Tags: <Text color="green">{name}</Text></Text>
        <Text> </Text>
        {DOMAIN_TAGS.map((tag, i) => {
          const selected = editTags.includes(tag);
          const active = i === tagCursor;
          return (
            <Box key={tag} gap={1}>
              <Text color={active ? 'cyan' : undefined}>
                {active ? '▸' : ' '} {selected ? '[✓]' : '[ ]'}
              </Text>
              <Text bold={active} color={active ? 'cyan' : selected ? 'green' : undefined}>{tag}</Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>[↑↓] Navigate  [Space] Toggle  [s] Save  [Esc] Cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Tools Overview</Text>
      <Text> </Text>

      <Box gap={1}>
        <Text dimColor>{'  '}{pad('Tool', 12)}</Text>
        <Text dimColor>{pad('Model', 24)}</Text>
        <Text dimColor>{pad('Tags', 28)}</Text>
        <Text dimColor>Settings</Text>
      </Box>
      <Text dimColor>{'  ' + '─'.repeat(80)}</Text>

      {entries.map(([name, entry], i) => {
        const active = i === cursor;
        const color = active ? 'cyan' : undefined;
        const statusIcon = entry.enabled ? '✓' : '✗';
        const statusColor = entry.enabled ? 'green' : 'red';
        const tags = entry.tags?.length ? entry.tags.join(', ') : '—';
        const settings = entry.settingsFile || '—';

        return (
          <Box key={name} gap={1}>
            <Text color={statusColor}>{active ? '▸' : ' '}{statusIcon}</Text>
            <Text bold={active} color={color}>{pad(name, 12)}</Text>
            <Text color={color}>{pad(entry.primaryModel || '—', 24)}</Text>
            <Text color="yellow">{pad(tags, 28)}</Text>
            <Text dimColor={!entry.settingsFile}>{settings}</Text>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>[↑↓] Navigate  [Space] Toggle enabled  [t] Edit tags  [Esc] Back</Text>
      {saving && <Text dimColor>Saving...</Text>}
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}
