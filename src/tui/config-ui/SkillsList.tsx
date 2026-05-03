import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import {
  getConfigurableParams,
  type CommandDef,
} from '../../config/argument-hint-parser.js';
import {
  resetSkillConfig,
  type SkillConfigFile,
} from '../../config/skill-config.js';

export interface SkillsListProps {
  config: SkillConfigFile;
  commandDefs: Map<string, CommandDef>;
  workDir: string;
  onBack: () => void;
  onEdit: (skillName: string) => void;
  onReload: () => void;
}

export function SkillsList({ config, commandDefs, workDir, onBack, onEdit, onReload }: SkillsListProps) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
  const [filterMode, setFilterMode] = useState(false);

  // Build sorted list: configured skills first, then rest
  const allSkills = useMemo(() => {
    const entries = [...commandDefs.entries()]
      .map(([name, def]) => ({
        name,
        def,
        configurable: getConfigurableParams(def.params).length,
        configured: config.skills[name] ? Object.keys(config.skills[name].params).length : 0,
      }))
      .sort((a, b) => {
        // Configured first, then alphabetical
        if (a.configured > 0 && b.configured === 0) return -1;
        if (a.configured === 0 && b.configured > 0) return 1;
        return a.name.localeCompare(b.name);
      });
    return entries;
  }, [commandDefs, config]);

  const filtered = useMemo(() => {
    if (!filter) return allSkills;
    const q = filter.toLowerCase();
    return allSkills.filter(s => s.name.toLowerCase().includes(q));
  }, [allSkills, filter]);

  // Page-based display (max 20 visible at a time)
  const PAGE_SIZE = 20;
  const pageStart = Math.floor(cursor / PAGE_SIZE) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) { setFilterMode(false); setFilter(''); return; }
      if (key.return) { setFilterMode(false); setCursor(0); return; }
      return; // TextInput handles the rest
    }

    if (key.escape) { onBack(); return; }
    if (key.upArrow) setCursor(c => c > 0 ? c - 1 : filtered.length - 1);
    if (key.downArrow) setCursor(c => c < filtered.length - 1 ? c + 1 : 0);
    if (key.return && filtered.length > 0) {
      onEdit(filtered[cursor].name);
    }
    if (input === '/' || input === 'f') {
      setFilterMode(true);
      setFilter('');
    }
    if (input === 'x' && filtered.length > 0) {
      const skill = filtered[cursor];
      if (skill.configured > 0) {
        resetSkillConfig(skill.name, 'global', workDir);
        onReload();
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Skills ({filtered.length}/{allSkills.length})</Text>

      {filterMode ? (
        <Box gap={1}>
          <Text color="yellow">Filter:</Text>
          <TextInput
            defaultValue={filter}
            onSubmit={(val) => { setFilter(val); setFilterMode(false); setCursor(0); }}
          />
        </Box>
      ) : (
        filter && <Text dimColor>Filter: {filter}</Text>
      )}

      <Text> </Text>

      <Box gap={1}>
        <Text dimColor>{'  '}{pad('Skill', 28)}</Text>
        <Text dimColor>{pad('Params', 8)}</Text>
        <Text dimColor>{pad('Set', 6)}</Text>
        <Text dimColor>Hint</Text>
      </Box>
      <Text dimColor>{'  ' + '─'.repeat(85)}</Text>

      {visible.map((skill, i) => {
        const idx = pageStart + i;
        const active = idx === cursor;
        const color = active ? 'cyan' : undefined;
        const hasConfig = skill.configured > 0;
        const hint = skill.def.argumentHint.length > 38
          ? skill.def.argumentHint.slice(0, 35) + '...'
          : skill.def.argumentHint;

        return (
          <Box key={skill.name} gap={1}>
            <Text color={hasConfig ? 'green' : color}>{active ? '▸' : ' '}{hasConfig ? '●' : ' '}</Text>
            <Text bold={active} color={color}>{pad(skill.name, 28)}</Text>
            <Text color={color}>{pad(String(skill.configurable), 8)}</Text>
            <Text color={hasConfig ? 'yellow' : undefined} dimColor={!hasConfig}>{pad(hasConfig ? String(skill.configured) : '—', 6)}</Text>
            <Text dimColor>{hint || '(no params)'}</Text>
          </Box>
        );
      })}

      {filtered.length > PAGE_SIZE && (
        <Text dimColor>  Page {Math.floor(cursor / PAGE_SIZE) + 1}/{Math.ceil(filtered.length / PAGE_SIZE)}</Text>
      )}

      <Text> </Text>
      <Text dimColor>[↑↓] Navigate  [Enter] Edit  [/] Filter  [x] Clear defaults  [Esc] Back</Text>
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}
