import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { existsSync } from 'node:fs';
import {
  saveCliToolsConfig,
  DELEGATE_ROLES,
  type CliToolsConfig,
} from '../../config/cli-tools-config.js';

export interface RegisterSettingsProps {
  config: CliToolsConfig;
  workDir: string;
  onBack: () => void;
}

type Phase = 'name' | 'role' | 'path' | 'scope' | 'saving' | 'done' | 'error';

export function RegisterSettings({ config, workDir, onBack }: RegisterSettingsProps) {
  const [phase, setPhase] = useState<Phase>('name');
  const [alias, setAlias] = useState('');
  const [role, setRole] = useState('');
  const [roleCursor, setRoleCursor] = useState(0);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Existing aliases
  const existing = Object.entries(config.tools)
    .filter(([, e]) => e.baseTool === 'claude')
    .map(([name, e]) => ({ name, settings: e.settingsFile ?? '—' }));

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }

    if (phase === 'role') {
      if (key.upArrow) setRoleCursor(c => c > 0 ? c - 1 : DELEGATE_ROLES.length - 1);
      if (key.downArrow) setRoleCursor(c => c < DELEGATE_ROLES.length - 1 ? c + 1 : 0);
      if (key.return) {
        setRole(DELEGATE_ROLES[roleCursor]);
        const ex = config.tools[alias];
        if (ex?.settingsFile) setPath(ex.settingsFile);
        setPhase('path');
      }
      // Number hotkeys 1-7
      const n = parseInt(input, 10);
      if (n >= 1 && n <= DELEGATE_ROLES.length) {
        setRoleCursor(n - 1);
        setRole(DELEGATE_ROLES[n - 1]);
        const ex = config.tools[alias];
        if (ex?.settingsFile) setPath(ex.settingsFile);
        setPhase('path');
      }
    }

    if (phase === 'scope') {
      if (input === 'g') doSave('global');
      if (input === 'p') doSave('workspace');
    }

    if (phase === 'done' || phase === 'error') {
      if (key.return || key.escape) onBack();
    }
  });

  const handleNameSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) { setError('Name is required'); return; }
    setAlias(trimmed);
    setError('');
    if (trimmed === 'claude') {
      // Base tool — skip role selection
      setRole('');
      const ex = config.tools.claude;
      if (ex?.settingsFile) setPath(ex.settingsFile);
      setPhase('path');
    } else {
      setPhase('role');
    }
  };

  const handlePathSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) { setError('Path is required'); return; }

    const expanded = trimmed.startsWith('~/')
      ? trimmed.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '~')
      : trimmed;

    if (!existsSync(expanded)) { setError(`File not found: ${expanded}`); return; }

    setPath(trimmed);
    setError('');
    setPhase('scope');
  };

  const doSave = async (scope: 'global' | 'workspace') => {
    setPhase('saving');
    try {
      const isBase = alias === 'claude';
      const base = config.tools.claude ?? { enabled: true, primaryModel: '', tags: [], type: 'builtin' };
      const entry = config.tools[alias] ?? {
        enabled: true,
        primaryModel: isBase ? base.primaryModel : base.primaryModel,
        tags: isBase ? base.tags : base.tags,
        type: 'builtin',
      };

      const toolUpdate = {
        ...entry,
        settingsFile: path,
        ...(!isBase ? { baseTool: 'claude' } : {}),
      };

      // Also update role mapping if a role was selected
      const rolesUpdate = role ? { [role]: { tool: alias } } : undefined;

      await saveCliToolsConfig(
        { tools: { [alias]: toolUpdate }, ...(rolesUpdate ? { roles: rolesUpdate } : {}) },
        scope,
        workDir,
      );
      const roleMsg = role ? ` (role: ${role})` : '';
      setMessage(`${alias}${roleMsg} → ${path} saved to ${scope}`);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Register Settings (Claude)</Text>
      <Text> </Text>

      {existing.length > 0 && (
        <>
          <Text dimColor>Existing aliases:</Text>
          {existing.map(e => (
            <Box key={e.name} gap={1}>
              <Text dimColor>  </Text>
              <Text bold>{e.name}</Text>
              <Text dimColor>→ {e.settings}</Text>
            </Box>
          ))}
          <Text> </Text>
        </>
      )}

      {phase === 'name' && (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text>Name:</Text>
            <TextInput
              placeholder="claude-analysis (or 'claude' for base)"
              onSubmit={handleNameSubmit}
            />
          </Box>
          {error && <Text color="red">  {error}</Text>}
          <Text dimColor>Enter alias name. Use "claude" to set base settings.</Text>
        </Box>
      )}

      {phase === 'role' && (
        <Box flexDirection="column">
          <Box gap={1}><Text>Name:</Text><Text bold color="green">{alias}</Text></Box>
          <Text>Assign to role:</Text>
          {DELEGATE_ROLES.map((r, i) => (
            <Box key={r} gap={1}>
              <Text color={i === roleCursor ? 'cyan' : undefined}>
                {i === roleCursor ? ' ▸' : '  '} {i + 1}.
              </Text>
              <Text bold={i === roleCursor} color={i === roleCursor ? 'cyan' : undefined}>{r}</Text>
            </Box>
          ))}
          <Text dimColor>[↑↓] Navigate  [1-7] Select  [Enter] Confirm</Text>
        </Box>
      )}

      {phase === 'path' && (
        <Box flexDirection="column">
          <Box gap={1}><Text>Name:</Text><Text bold color="green">{alias}</Text></Box>
          {role && <Box gap={1}><Text>Role:</Text><Text color="yellow">{role}</Text></Box>}
          <Box gap={1}>
            <Text>Path:</Text>
            <TextInput
              defaultValue={path}
              placeholder="~/.maestro/profiles/claude-analysis.json"
              onSubmit={handlePathSubmit}
            />
          </Box>
          {error && <Text color="red">  {error}</Text>}
        </Box>
      )}

      {phase === 'scope' && (
        <Box flexDirection="column">
          <Box gap={1}><Text>Name:</Text><Text bold color="green">{alias}</Text></Box>
          {role && <Box gap={1}><Text>Role:</Text><Text color="yellow">{role}</Text></Box>}
          <Box gap={1}><Text>Path:</Text><Text dimColor>{path}</Text></Box>
          <Text> </Text>
          <Text>Save to:</Text>
          <Box gap={2}><Text color="cyan">[g]</Text><Text>Global</Text></Box>
          <Box gap={2}><Text color="cyan">[p]</Text><Text>Project</Text></Box>
        </Box>
      )}

      {phase === 'saving' && <Text dimColor>Saving...</Text>}

      {phase === 'done' && (
        <Box flexDirection="column">
          <Text color="green">✓ {message}</Text>
          <Text dimColor>[Enter] Back</Text>
        </Box>
      )}

      {phase === 'error' && (
        <Box flexDirection="column">
          <Text color="red">✗ {error}</Text>
          <Text dimColor>[Enter] Back</Text>
        </Box>
      )}
    </Box>
  );
}
