import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  loadConfigSources,
  type CliToolsConfig,
} from '../../config/cli-tools-config.js';

export interface ConfigSourcesProps {
  workDir: string;
  onBack: () => void;
}

export function ConfigSources({ workDir, onBack }: ConfigSourcesProps) {
  const [data, setData] = useState<{
    globalPath: string;
    global: Partial<CliToolsConfig> | null;
    workspacePath: string | null;
    workspace: Partial<CliToolsConfig> | null;
  } | null>(null);

  useEffect(() => { loadConfigSources(workDir).then(setData); }, []);
  useInput((_input, key) => { if (key.escape) onBack(); });

  if (!data) return <Text dimColor>Loading...</Text>;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Config Sources</Text>
      <Text> </Text>

      {/* Global */}
      <Text bold>Global</Text>
      <Text dimColor>  {data.globalPath}</Text>
      {data.global ? (
        <ConfigSection config={data.global} indent={2} prefix="g" />
      ) : (
        <Text dimColor color="yellow">  (not found)</Text>
      )}

      <Text> </Text>

      {/* Workspace */}
      <Text bold>Workspace</Text>
      <Text dimColor>  {data.workspacePath ?? `${workDir}/.maestro/cli-tools.json`}</Text>
      {data.workspace ? (
        <ConfigSection config={data.workspace} indent={2} prefix="w" />
      ) : (
        <Text dimColor color="yellow">  (not found)</Text>
      )}

      <Text> </Text>
      <Text dimColor>Workspace overrides global. [Esc] Back</Text>
    </Box>
  );
}

function ConfigSection({ config, indent, prefix }: { config: Partial<CliToolsConfig>; indent: number; prefix: string }) {
  const pad = ' '.repeat(indent);
  const tools = config.tools ? Object.entries(config.tools) : [];
  const roles = config.roles ? Object.entries(config.roles) : [];

  return (
    <Box flexDirection="column">
      {tools.length > 0 && (
        <>
          <Text>{pad}<Text color="cyan">tools:</Text></Text>
          {tools.map(([name, entry]) => (
            <Box key={`${prefix}-t-${name}`} gap={1}>
              <Text>{pad}  </Text>
              <Text color={entry.enabled ? 'green' : 'red'}>{entry.enabled ? '✓' : '✗'}</Text>
              <Text bold>{name}</Text>
              {entry.primaryModel ? <Text dimColor>model={entry.primaryModel}</Text> : null}
              {entry.tags?.length ? <Text color="yellow">[{entry.tags.join(',')}]</Text> : null}
              {entry.settingsFile ? <Text dimColor>settings={entry.settingsFile}</Text> : null}
            </Box>
          ))}
        </>
      )}
      {roles.length > 0 && (
        <>
          <Text>{pad}<Text color="cyan">roles:</Text></Text>
          {roles.map(([name, mapping]) => {
            const detail = mapping.tool
              ? `→ ${mapping.tool}`
              : mapping.fallbackChain
                ? mapping.fallbackChain.join(' → ')
                : '(empty)';
            return (
              <Box key={`${prefix}-r-${name}`} gap={1}>
                <Text>{pad}  </Text>
                <Text bold>{name}</Text>
                <Text dimColor>{detail}</Text>
              </Box>
            );
          })}
        </>
      )}
      {tools.length === 0 && roles.length === 0 && (
        <Text dimColor>{pad}(empty config)</Text>
      )}
    </Box>
  );
}
