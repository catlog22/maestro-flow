import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import {
  loadSkillConfig,
  type SkillConfigFile,
} from '../../config/skill-config.js';
import {
  loadAllCommandDefs,
  type CommandDef,
} from '../../config/argument-hint-parser.js';
import { checkSkillContextHook } from '../../commands/config.js';
import { SkillsList } from './SkillsList.js';
import { SkillParamEditor } from './SkillParamEditor.js';
import { ConfigSourcesView } from './ConfigSourcesView.js';

type View = 'dashboard' | 'skills' | 'editor' | 'sources';

export interface SkillConfigDashboardProps {
  workDir: string;
  initialView?: View;
  editSkill?: string;
}

export function SkillConfigDashboard({ workDir, initialView, editSkill }: SkillConfigDashboardProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(initialView ?? 'dashboard');
  const [config, setConfig] = useState<SkillConfigFile | null>(null);
  const [commandDefs, setCommandDefs] = useState<Map<string, CommandDef> | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(editSkill ?? null);
  const [hookStatus, setHookStatus] = useState<'installed' | 'not-installed'>('installed');

  const reload = () => {
    setConfig(loadSkillConfig(workDir));
    setCommandDefs(loadAllCommandDefs(workDir));
  };

  useEffect(() => {
    reload();
    setHookStatus(checkSkillContextHook());
    // If editSkill was provided, jump directly to editor
    if (editSkill) setView('editor');
  }, []);

  useInput((input, key) => {
    if (view !== 'dashboard') return;
    if (input === '1') setView('skills');
    if (input === '2') setView('sources');
    if (input === 'q' || key.escape) exit();
  });

  if (!config || !commandDefs) {
    return <Text dimColor>Loading configuration...</Text>;
  }

  if (view === 'skills') {
    return (
      <SkillsList
        config={config}
        commandDefs={commandDefs}
        workDir={workDir}
        onBack={() => { reload(); setView('dashboard'); }}
        onEdit={(skill) => { setSelectedSkill(skill); setView('editor'); }}
        onReload={reload}
      />
    );
  }

  if (view === 'editor' && selectedSkill) {
    const def = commandDefs.get(selectedSkill);
    return (
      <SkillParamEditor
        skillName={selectedSkill}
        commandDef={def ?? null}
        config={config}
        workDir={workDir}
        onBack={() => { reload(); setView('skills'); }}
        onReload={reload}
      />
    );
  }

  if (view === 'sources') {
    return <ConfigSourcesView workDir={workDir} onBack={() => { reload(); setView('dashboard'); }} />;
  }

  // Dashboard view
  const configuredSkills = Object.entries(config.skills);
  const totalCommands = commandDefs.size;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color="cyan">MAESTRO SKILL CONFIG</Text>
        <Text> </Text>

        <Box gap={2}>
          <Text>Commands discovered:</Text>
          <Text bold color="green">{totalCommands}</Text>
        </Box>
        <Box gap={2}>
          <Text>Skills with defaults:</Text>
          <Text bold color="yellow">{configuredSkills.length}</Text>
        </Box>
        <Box gap={2}>
          <Text>Hook (skill-context):</Text>
          {hookStatus === 'installed'
            ? <Text bold color="green">installed</Text>
            : <Text bold color="red">not installed</Text>
          }
        </Box>

        {hookStatus === 'not-installed' && (
          <Box marginTop={1}>
            <Text color="red">  Parameter injection requires the skill-context hook.</Text>
          </Box>
        )}
        {hookStatus === 'not-installed' && (
          <Text dimColor>  Run: maestro hooks install --level standard</Text>
        )}

        {configuredSkills.length > 0 && (
          <>
            <Text> </Text>
            <Text dimColor>Configured:</Text>
            {configuredSkills.slice(0, 8).map(([name, defaults]) => {
              const paramCount = Object.keys(defaults.params).length;
              return (
                <Box key={name} gap={1}>
                  <Text color="green">  ✓</Text>
                  <Text bold>{padRight(name, 28)}</Text>
                  <Text dimColor>{paramCount} param{paramCount !== 1 ? 's' : ''}</Text>
                </Box>
              );
            })}
            {configuredSkills.length > 8 && (
              <Text dimColor>  ... and {configuredSkills.length - 8} more</Text>
            )}
          </>
        )}

        <Text> </Text>
        <Box gap={2}>
          <Text color="cyan">[1]</Text><Text>Skills</Text>
          <Text color="cyan">[2]</Text><Text>Config Sources</Text>
        </Box>
        <Text dimColor>  [q] Quit</Text>
      </Box>
    </Box>
  );
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}
