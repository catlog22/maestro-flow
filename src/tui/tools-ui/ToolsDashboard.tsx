import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import {
  loadCliToolsConfig,
  getDefaultRoleMappings,
  selectToolByRole,
  type CliToolsConfig,
} from '../../config/cli-tools-config.js';
import { ToolsOverview } from './ToolsOverview.js';
import { RoleMappings } from './RoleMappings.js';
import { RegisterSettings } from './RegisterSettings.js';
import { CommandReference } from './CommandReference.js';
import { ConfigSources } from './ConfigSources.js';

type View = 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';

export interface ToolsDashboardProps {
  workDir: string;
  initialView?: View;
}

export function ToolsDashboard({ workDir, initialView }: ToolsDashboardProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(initialView ?? 'dashboard');
  const [config, setConfig] = useState<CliToolsConfig | null>(null);

  const reload = async () => {
    const cfg = await loadCliToolsConfig(workDir);
    setConfig(cfg);
  };

  useEffect(() => { reload(); }, []);

  useInput((input, key) => {
    if (view !== 'dashboard') return;
    if (input === '1') setView('tools');
    if (input === '2') setView('roles');
    if (input === '3') setView('register');
    if (input === '4') setView('reference');
    if (input === '5') setView('sources');
    if (input === 'q' || key.escape) exit();
  });

  if (!config) {
    return <Text dimColor>Loading configuration...</Text>;
  }

  if (view === 'tools') {
    return <ToolsOverview config={config} workDir={workDir} onBack={() => { reload(); setView('dashboard'); }} onReload={reload} />;
  }
  if (view === 'roles') {
    return <RoleMappings config={config} workDir={workDir} onBack={() => { reload(); setView('dashboard'); }} onReload={reload} />;
  }
  if (view === 'register') {
    return (
      <RegisterSettings
        config={config}
        workDir={workDir}
        onBack={() => { reload(); setView('dashboard'); }}
      />
    );
  }
  if (view === 'reference') {
    return <CommandReference config={config} onBack={() => setView('dashboard')} />;
  }
  if (view === 'sources') {
    return <ConfigSources workDir={workDir} onBack={() => setView('dashboard')} />;
  }

  // Dashboard view
  const toolEntries = Object.entries(config.tools);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">MAESTRO TOOLS</Text>
        <Text> </Text>

        {toolEntries.length === 0 ? (
          <Text dimColor>  No tools configured in cli-tools.json</Text>
        ) : (
          toolEntries.map(([name, entry]) => (
            <Box key={name} gap={1}>
              <Text color={entry.enabled ? 'green' : 'red'}>
                {entry.enabled ? '  ✓' : '  ✗'}
              </Text>
              <Text bold>{padRight(name, 12)}</Text>
              <Text dimColor>{padRight(entry.primaryModel || '—', 24)}</Text>
              <Text color="yellow">
                {entry.tags?.length ? `[${entry.tags.join(', ')}]` : '—'}
              </Text>
            </Box>
          ))
        )}

        <Text> </Text>
        <Box gap={2}>
          <Text color="cyan">[1]</Text><Text>Tools</Text>
          <Text color="cyan">[2]</Text><Text>Roles</Text>
          <Text color="cyan">[3]</Text><Text>Register</Text>
          <Text color="cyan">[4]</Text><Text>Ref</Text>
          <Text color="cyan">[5]</Text><Text>Config</Text>
        </Box>
        <Text dimColor>  [q] Quit</Text>
      </Box>
    </Box>
  );
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}
