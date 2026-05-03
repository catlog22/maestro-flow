import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

interface HookInfo {
  name: string;
  event: string;
  matcher?: string;
  level: string;
  installed: boolean;
  enabled: boolean;
  requiresWorkspace: boolean;
}

export interface HooksPanelProps {
  workDir: string;
  onBack?: () => void;
}

export function HooksPanel({ workDir, onBack }: HooksPanelProps) {
  const { exit } = useApp();
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [globalInstalled, setGlobalInstalled] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [statusLine, setStatusLine] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    const {
      HOOK_DEFS,
      HOOK_LEVEL_DESCRIPTIONS,
      getClaudeSettingsPath,
      loadClaudeSettings,
    } = await import('../../commands/hooks.js') as any;
    const { loadHooksConfig } = await import('../../config/index.js');

    const settingsPath = getClaudeSettingsPath();
    const settings = loadClaudeSettings(settingsPath);
    const config = loadHooksConfig();

    const hasStatusline = settings.statusLine?.command?.includes('maestro') || false;
    setStatusLine(hasStatusline);
    setGlobalInstalled(!!settings.hooks);

    const items: HookInfo[] = [];
    for (const [name, def] of Object.entries(HOOK_DEFS) as [string, any][]) {
      // Check if installed in settings
      const installed = findHook(settings, name);
      // Check toggle
      const toggleKey = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const enabled = config.toggles[toggleKey] !== false;

      items.push({
        name,
        event: def.event,
        matcher: def.matcher,
        level: def.level,
        installed,
        enabled,
        requiresWorkspace: !!def.requiresWorkspace,
      });
    }
    setHooks(items);
  }

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onBack) onBack();
      else exit();
    }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(hooks.length - 1, c + 1));
  });

  if (hooks.length === 0) {
    return <Text dimColor>Loading hooks status...</Text>;
  }

  const selected = hooks[cursor];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">HOOKS STATUS</Text>
        <Text> </Text>

        <Box gap={2}>
          <Text>Statusline:</Text>
          {statusLine
            ? <Text bold color="green">installed</Text>
            : <Text bold color="red">not installed</Text>
          }
        </Box>
        <Text> </Text>

        <Box flexDirection="column">
          <Box gap={1}>
            <Text dimColor>{pad('', 2)}</Text>
            <Text dimColor bold>{pad('Hook', 24)}</Text>
            <Text dimColor bold>{pad('Event', 20)}</Text>
            <Text dimColor bold>{pad('Level', 10)}</Text>
            <Text dimColor bold>{pad('Status', 12)}</Text>
          </Box>
          {hooks.map((h, i) => {
            const isCurrent = i === cursor;
            const icon = h.installed
              ? (h.enabled ? '✓' : '○')
              : '✗';
            const iconColor = h.installed
              ? (h.enabled ? 'green' : 'yellow')
              : 'red';
            const matcher = h.matcher ? ` [${h.matcher}]` : '';

            return (
              <Box key={h.name} gap={1}>
                <Text color="cyan">{isCurrent ? '›' : ' '}</Text>
                <Text color={iconColor}>{icon}</Text>
                <Text bold={isCurrent}>{pad(h.name, 23)}</Text>
                <Text dimColor={!isCurrent}>{pad(`${h.event}${matcher}`, 20)}</Text>
                <Text dimColor={!isCurrent}>{pad(h.level, 10)}</Text>
                <Text color={iconColor}>
                  {h.installed ? (h.enabled ? 'active' : 'disabled') : 'not installed'}
                </Text>
              </Box>
            );
          })}
        </Box>

        {selected && (
          <>
            <Text> </Text>
            <Text dimColor>
              {selected.requiresWorkspace ? '⚑ Requires workspace' : ''}
            </Text>
          </>
        )}

        <Text> </Text>
        <Text dimColor>  ↑/↓ navigate  [q] back</Text>
        <Text dimColor>  CLI: maestro hooks install --level {'<'}minimal|standard|full{'>'}</Text>
      </Box>
    </Box>
  );
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function findHook(settings: any, name: string): boolean {
  if (!settings.hooks) return false;
  for (const eventKey of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop']) {
    const groups = settings.hooks[eventKey];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (Array.isArray(group.hooks)) {
        for (const h of group.hooks) {
          if (h.command?.includes(name)) return true;
        }
      }
    }
  }
  return false;
}
