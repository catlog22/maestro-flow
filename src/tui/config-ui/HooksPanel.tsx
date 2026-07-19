import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { C, SYM, SP, BORDER, pad, wrapCursor, KeyHints, SectionHeader, StatusBadge } from '../shared/index.js';

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
    const { loadHooksConfig, normalizeHookToggleKey } = await import('../../config/index.js');

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
      const toggleKey = normalizeHookToggleKey(name);
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
    if (key.upArrow) setCursor(c => wrapCursor(c, -1, hooks.length));
    if (key.downArrow) setCursor(c => wrapCursor(c, 1, hooks.length));
  });

  if (hooks.length === 0) {
    return <Text dimColor>Loading hooks status...</Text>;
  }

  const selected = hooks[cursor];

  return (
    <Box flexDirection="column" paddingX={SP.detailPadX}>
      <Box {...BORDER.primary} flexDirection="column" paddingX={SP.panelPadX} paddingY={SP.panelPadY}>
        <SectionHeader title="HOOKS STATUS" />
        <Text> </Text>

        <Box gap={SP.tabGap}>
          <Text>Statusline:</Text>
          <StatusBadge enabled={statusLine} labels={{ on: 'installed', off: 'not installed' }} />
        </Box>
        <Text> </Text>

        <Box flexDirection="column">
          <Box gap={SP.inlineGap}>
            <Text dimColor>{pad('', 2)}</Text>
            <Text dimColor bold>{pad('Hook', 24)}</Text>
            <Text dimColor bold>{pad('Event', 20)}</Text>
            <Text dimColor bold>{pad('Level', 10)}</Text>
            <Text dimColor bold>{pad('Status', 12)}</Text>
          </Box>
          {hooks.map((h, i) => {
            const isCurrent = i === cursor;
            const icon = h.installed
              ? (h.enabled ? SYM.enabled : SYM.dotEmpty)
              : SYM.disabled;
            const iconColor = h.installed
              ? (h.enabled ? C.success : C.warning)
              : C.error;
            const matcher = h.matcher ? ` [${h.matcher}]` : '';

            return (
              <Box key={h.name} gap={SP.inlineGap}>
                <Text color={C.primary}>{isCurrent ? SYM.cursor : ' '}</Text>
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

        {selected && selected.requiresWorkspace && (
          <Box marginTop={SP.sectionGap}>
            <Text dimColor>⚑ Requires workspace</Text>
          </Box>
        )}

        <Text> </Text>
        <Text dimColor>  CLI: maestro hooks install --level {'<'}minimal|standard|full{'>'}</Text>
      </Box>
      <KeyHints hints="[↑↓] Navigate  [q] Back" />
    </Box>
  );
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
