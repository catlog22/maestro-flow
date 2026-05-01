import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  loadSkillConfigSources,
  type SkillConfigFile,
} from '../../config/skill-config.js';

export interface ConfigSourcesViewProps {
  workDir: string;
  onBack: () => void;
}

export function ConfigSourcesView({ workDir, onBack }: ConfigSourcesViewProps) {
  const [data, setData] = useState<{
    globalPath: string;
    global: SkillConfigFile | null;
    workspacePath: string | null;
    workspace: SkillConfigFile | null;
  } | null>(null);

  useEffect(() => { setData(loadSkillConfigSources(workDir)); }, []);
  useInput((_input, key) => { if (key.escape) onBack(); });

  if (!data) return <Text dimColor>Loading...</Text>;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Skill Config Sources</Text>
      <Text> </Text>

      {/* Global */}
      <Text bold>Global</Text>
      <Text dimColor>  {data.globalPath}</Text>
      {data.global ? (
        <SkillConfigSection config={data.global} indent={2} />
      ) : (
        <Text dimColor color="yellow">  (not found)</Text>
      )}

      <Text> </Text>

      {/* Workspace */}
      <Text bold>Workspace</Text>
      <Text dimColor>  {data.workspacePath ?? `${workDir}/.maestro/skill-config.json`}</Text>
      {data.workspace ? (
        <SkillConfigSection config={data.workspace} indent={2} />
      ) : (
        <Text dimColor color="yellow">  (not found)</Text>
      )}

      <Text> </Text>
      <Text dimColor>Workspace overrides global (per-skill, params deep-merged). [Esc] Back</Text>
    </Box>
  );
}

function SkillConfigSection({ config, indent }: { config: SkillConfigFile; indent: number }) {
  const pad = ' '.repeat(indent);
  const skills = Object.entries(config.skills);

  if (skills.length === 0) {
    return <Text dimColor>{pad}(no skills configured)</Text>;
  }

  return (
    <Box flexDirection="column">
      {skills.map(([name, defaults]) => {
        const params = Object.entries(defaults.params);
        return (
          <Box key={name} flexDirection="column">
            <Box gap={1}>
              <Text>{pad}</Text>
              <Text color="green">●</Text>
              <Text bold>{name}</Text>
              <Text dimColor>({params.length} param{params.length !== 1 ? 's' : ''})</Text>
            </Box>
            {params.map(([param, value]) => (
              <Box key={param} gap={1}>
                <Text>{pad}  </Text>
                <Text color="yellow">{param}</Text>
                <Text>= {String(value)}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
