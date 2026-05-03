import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import {
  getConfigurableParams,
  type CommandDef,
  type SkillParamDef,
} from '../../config/argument-hint-parser.js';
import {
  setSkillParam,
  unsetSkillParam,
  type SkillConfigFile,
} from '../../config/skill-config.js';

export interface SkillParamEditorProps {
  skillName: string;
  commandDef: CommandDef | null;
  config: SkillConfigFile;
  workDir: string;
  onBack: () => void;
  onReload: () => void;
}

type Mode = 'list' | 'edit-value' | 'scope-select';

export function SkillParamEditor({
  skillName,
  commandDef,
  config,
  workDir,
  onBack,
  onReload,
}: SkillParamEditorProps) {
  const params = useMemo(() => {
    if (!commandDef) return [];
    return getConfigurableParams(commandDef.params);
  }, [commandDef]);

  const defaults = config.skills[skillName]?.params ?? {};

  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [editValue, setEditValue] = useState('');
  const [pendingSave, setPendingSave] = useState<{ param: string; value: string | boolean | number } | null>(null);

  useInput((input, key) => {
    if (mode === 'edit-value') {
      if (key.escape) { setMode('list'); return; }
      if (key.return) {
        // Commit edit
        const param = params[cursor];
        if (param && editValue.trim()) {
          const parsed = parseInputValue(editValue, param);
          setPendingSave({ param: param.name, value: parsed });
          setMode('scope-select');
        } else {
          setMode('list');
        }
        return;
      }
      return; // TextInput handles the rest
    }

    if (mode === 'scope-select') {
      if (input === 'g' && pendingSave) {
        setSkillParam(skillName, pendingSave.param, pendingSave.value, 'global');
        setPendingSave(null);
        setMode('list');
        onReload();
        return;
      }
      if (input === 'p' && pendingSave) {
        setSkillParam(skillName, pendingSave.param, pendingSave.value, 'workspace', workDir);
        setPendingSave(null);
        setMode('list');
        onReload();
        return;
      }
      if (key.escape) { setPendingSave(null); setMode('list'); return; }
      return;
    }

    // list mode
    if (key.escape) { onBack(); return; }
    if (params.length === 0) return;

    if (key.upArrow) setCursor(c => c > 0 ? c - 1 : params.length - 1);
    if (key.downArrow) setCursor(c => c < params.length - 1 ? c + 1 : 0);

    const param = params[cursor];
    if (!param) return;

    if (input === ' ') {
      // Toggle boolean / cycle enum
      if (param.type === 'boolean') {
        const current = defaults[param.name];
        const newVal = current === true ? false : true;
        setPendingSave({ param: param.name, value: newVal });
        setMode('scope-select');
      } else if (param.type === 'enum' && param.choices) {
        const current = defaults[param.name];
        const idx = param.choices.indexOf(String(current));
        const next = param.choices[(idx + 1) % param.choices.length];
        setPendingSave({ param: param.name, value: next });
        setMode('scope-select');
      }
    }

    if (key.return || input === 'e') {
      // Enter edit mode for string/number, or toggle boolean
      if (param.type === 'boolean') {
        const current = defaults[param.name];
        const newVal = current === true ? false : true;
        setPendingSave({ param: param.name, value: newVal });
        setMode('scope-select');
      } else {
        setEditValue(defaults[param.name] !== undefined ? String(defaults[param.name]) : '');
        setMode('edit-value');
      }
    }

    if (input === 'd') {
      // Delete current param default
      if (defaults[param.name] !== undefined) {
        unsetSkillParam(skillName, param.name, 'global');
        unsetSkillParam(skillName, param.name, 'workspace', workDir);
        onReload();
      }
    }
  });

  if (!commandDef) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="red">Skill not found: {skillName}</Text>
        <Text dimColor>No matching command in .claude/commands/</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
    );
  }

  if (params.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">{skillName}</Text>
        <Text dimColor>hint: {commandDef.argumentHint || '(none)'}</Text>
        <Text> </Text>
        <Text dimColor>No configurable parameters (only positional args).</Text>
        <Text dimColor>[Esc] Back</Text>
      </Box>
    );
  }

  // Scope selection overlay
  if (mode === 'scope-select' && pendingSave) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Save: {pendingSave.param} = {String(pendingSave.value)}</Text>
        <Text> </Text>
        <Box gap={2}>
          <Text color="yellow">[g]</Text><Text>Global (~/.maestro/)</Text>
        </Box>
        <Box gap={2}>
          <Text color="yellow">[p]</Text><Text>Project (.maestro/)</Text>
        </Box>
        <Text> </Text>
        <Text dimColor>[Esc] Cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">{skillName}</Text>
      <Text dimColor>hint: {commandDef.argumentHint}</Text>
      <Text> </Text>

      {params.map((param, i) => {
        const active = i === cursor;
        const color = active ? 'cyan' : undefined;
        const hasValue = defaults[param.name] !== undefined;
        const displayValue = hasValue ? String(defaults[param.name]) : '<not set>';
        const typeHint = formatTypeHint(param);
        const isEditing = mode === 'edit-value' && active;

        return (
          <Box key={param.name} gap={1}>
            <Text color={color}>{active ? '▸' : ' '}</Text>
            <Text bold={active} color={color}>{pad(param.name, 20)}</Text>
            {isEditing ? (
              <Box>
                <TextInput
                  defaultValue={editValue}
                  onSubmit={(val) => {
                    const param = params[cursor];
                    if (param && val.trim()) {
                      const parsed = parseInputValue(val, param);
                      setPendingSave({ param: param.name, value: parsed });
                      setMode('scope-select');
                    } else {
                      setMode('list');
                    }
                  }}
                />
              </Box>
            ) : (
              <>
                {param.type === 'boolean' ? (
                  <Text color={hasValue ? (defaults[param.name] ? 'green' : 'red') : undefined}>
                    {hasValue ? (defaults[param.name] ? '[x]' : '[ ]') : '[ ]'}{' '}
                    {displayValue}
                  </Text>
                ) : (
                  <Text color={hasValue ? 'yellow' : undefined} dimColor={!hasValue}>
                    {pad(displayValue, 16)}
                  </Text>
                )}
                <Text dimColor>({typeHint})</Text>
              </>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>[↑↓] Navigate  [Space] Toggle/Cycle  [Enter] Edit  [d] Delete  [Esc] Back</Text>
    </Box>
  );
}

function formatTypeHint(param: SkillParamDef): string {
  if (param.type === 'enum' && param.choices) {
    return param.choices.join('|');
  }
  return param.type;
}

function parseInputValue(raw: string, param: SkillParamDef): string | boolean | number {
  if (param.type === 'boolean') {
    return raw === 'true' || raw === '1' || raw === 'yes';
  }
  if (param.type === 'number') {
    const num = Number(raw);
    return isNaN(num) ? raw : num;
  }
  return raw;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}
