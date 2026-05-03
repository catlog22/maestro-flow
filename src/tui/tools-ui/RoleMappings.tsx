import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  selectToolByRole,
  getDefaultRoleMappings,
  saveCliToolsConfig,
  DELEGATE_ROLES,
  type CliToolsConfig,
  type RoleMapping,
} from '../../config/cli-tools-config.js';

export interface RoleMappingsProps {
  config: CliToolsConfig;
  workDir: string;
  onBack: () => void;
  onReload: () => void;
}

type Mode = 'list' | 'edit-order';

export function RoleMappings({ config, workDir, onBack, onReload }: RoleMappingsProps) {
  const defaults = getDefaultRoleMappings();
  const userRoles = config.roles ?? {};
  const enabledTools = Object.entries(config.tools).filter(([, e]) => e.enabled).map(([n]) => n);

  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [editChain, setEditChain] = useState<string[]>([]);
  const [chainCursor, setChainCursor] = useState(0);
  const [saving, setSaving] = useState(false);

  const roles = [...DELEGATE_ROLES] as string[];

  useInput((input, key) => {
    if (saving) return;

    if (mode === 'list') {
      if (key.escape) { onBack(); return; }
      if (key.upArrow) setCursor(c => c > 0 ? c - 1 : roles.length - 1);
      if (key.downArrow) setCursor(c => c < roles.length - 1 ? c + 1 : 0);
      if (key.return || input === 'e') {
        // Edit fallback chain for this role
        const role = roles[cursor];
        const mapping = userRoles[role] ?? defaults[role];
        const chain = mapping?.fallbackChain ?? enabledTools;
        setEditChain([...chain]);
        setChainCursor(0);
        setMode('edit-order');
      }
    }

    if (mode === 'edit-order') {
      if (key.escape) { setMode('list'); return; }
      if (key.upArrow) setChainCursor(c => c > 0 ? c - 1 : editChain.length - 1);
      if (key.downArrow) setChainCursor(c => c < editChain.length - 1 ? c + 1 : 0);

      // Move up/down with shift (K/J)
      if (input === 'K' && chainCursor > 0) {
        setEditChain(prev => {
          const arr = [...prev];
          [arr[chainCursor - 1], arr[chainCursor]] = [arr[chainCursor], arr[chainCursor - 1]];
          return arr;
        });
        setChainCursor(c => c - 1);
      }
      if (input === 'J' && chainCursor < editChain.length - 1) {
        setEditChain(prev => {
          const arr = [...prev];
          [arr[chainCursor], arr[chainCursor + 1]] = [arr[chainCursor + 1], arr[chainCursor]];
          return arr;
        });
        setChainCursor(c => c + 1);
      }

      // Toggle include/exclude
      if (input === ' ') {
        const tool = enabledTools.find(t => !editChain.includes(t));
        if (tool) {
          // Add next available tool
          setEditChain(prev => [...prev, tool]);
        }
      }
      if (input === 'd') {
        // Remove current from chain
        if (editChain.length > 1) {
          setEditChain(prev => prev.filter((_, i) => i !== chainCursor));
          setChainCursor(c => Math.min(c, editChain.length - 2));
        }
      }

      if (input === 's') {
        const role = roles[cursor];
        setSaving(true);
        saveCliToolsConfig(
          { roles: { [role]: { fallbackChain: editChain } } },
          'global',
          workDir,
        ).then(() => { onReload(); setSaving(false); setMode('list'); });
      }
    }
  });

  if (mode === 'edit-order') {
    const role = roles[cursor];
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Edit Fallback Chain: <Text color="green">{role}</Text></Text>
        <Text dimColor>First enabled tool in chain wins</Text>
        <Text> </Text>
        {editChain.map((tool, i) => {
          const active = i === chainCursor;
          return (
            <Box key={`${tool}-${i}`} gap={1}>
              <Text color={active ? 'cyan' : undefined}>
                {active ? '▸' : ' '} {i + 1}.
              </Text>
              <Text bold={active} color={i === 0 ? 'green' : active ? 'cyan' : undefined}>{tool}</Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>[↑↓] Select  [Shift+K/J] Move up/down  [d] Remove  [s] Save  [Esc] Cancel</Text>
        {saving && <Text dimColor>Saving...</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Role Mappings</Text>
      <Text> </Text>

      <Box gap={1}>
        <Text dimColor>{pad('  Role', 16)}</Text>
        <Text dimColor>{pad('Resolved', 12)}</Text>
        <Text dimColor>{pad('Source', 10)}</Text>
        <Text dimColor>Fallback Chain</Text>
      </Box>
      <Text dimColor>{'─'.repeat(76)}</Text>

      {roles.map((role, i) => {
        const active = i === cursor;
        const selected = selectToolByRole(role, config);
        const mapping = userRoles[role] ?? defaults[role];
        const chain = mapping?.fallbackChain?.join(' → ') ?? (mapping?.tool ? `→ ${mapping.tool}` : '—');
        const source = userRoles[role] ? 'user' : 'default';

        return (
          <Box key={role} gap={1}>
            <Text color={active ? 'cyan' : undefined}>{active ? '▸' : ' '}</Text>
            <Text bold={active} color={active ? 'cyan' : undefined}>{pad(role, 14)}</Text>
            <Text color="green">{pad(selected?.name ?? '(none)', 12)}</Text>
            <Text color={source === 'user' ? 'yellow' : undefined} dimColor={source === 'default'}>
              {pad(source, 10)}
            </Text>
            <Text dimColor>{chain}</Text>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>[↑↓] Navigate  [Enter/e] Edit chain  [Esc] Back</Text>
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}
