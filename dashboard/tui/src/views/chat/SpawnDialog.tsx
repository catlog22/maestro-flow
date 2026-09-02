import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput, Select } from '@inkjs/ui';
import type { AgentType, AgentConfig } from '@shared/agent-types.js';

// ---------------------------------------------------------------------------
// SpawnDialog — overlay for spawning a new agent
// ---------------------------------------------------------------------------

const AGENT_TYPE_OPTIONS = [
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Qwen', value: 'qwen' },
  { label: 'OpenCode', value: 'opencode' },
  { label: 'Pi', value: 'pi' },
  { label: 'Grok', value: 'grok' },
];

const APPROVAL_OPTIONS = [
  { label: 'Suggest (manual)', value: 'suggest' },
  { label: 'Auto (auto-approve)', value: 'auto' },
];

type SpawnStep = 'type' | 'prompt' | 'workDir' | 'approvalMode';
const SPAWN_STEPS: SpawnStep[] = ['type', 'prompt', 'workDir', 'approvalMode'];

interface SpawnDialogProps {
  onComplete: (config: AgentConfig) => void;
  onCancel: () => void;
}

export function SpawnDialog({ onComplete, onCancel }: SpawnDialogProps) {
  const [spawnStep, setSpawnStep] = useState<SpawnStep>('type');
  const [spawnType, setSpawnType] = useState<AgentType>('claude-code');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnWorkDir, setSpawnWorkDir] = useState(process.cwd());

  const stepIndex = SPAWN_STEPS.indexOf(spawnStep);

  const submitSpawn = useCallback(
    (approvalMode: 'suggest' | 'auto') => {
      const config: AgentConfig = {
        type: spawnType,
        prompt: spawnPrompt,
        workDir: spawnWorkDir,
        approvalMode,
      };
      onComplete(config);
    },
    [spawnType, spawnPrompt, spawnWorkDir, onComplete],
  );

  return (
    <Box
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      marginLeft={5}
      marginTop={2}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">Spawn Agent</Text>
        <Text dimColor> (Step {stepIndex + 1}/{SPAWN_STEPS.length}) Esc=cancel</Text>
      </Box>

      <Box gap={1} marginBottom={1}>
        {SPAWN_STEPS.map((s, i) => (
          <Text
            key={s}
            bold={s === spawnStep}
            color={i < stepIndex ? 'green' : s === spawnStep ? 'cyan' : 'gray'}
          >
            {i < stepIndex ? '[x]' : s === spawnStep ? '[>]' : '[ ]'} {s}
          </Text>
        ))}
      </Box>

      {spawnStep === 'type' && (
        <Box flexDirection="column">
          <Text>Agent Type:</Text>
          <Select
            options={AGENT_TYPE_OPTIONS}
            defaultValue={spawnType}
            onChange={(value) => {
              setSpawnType(value as AgentType);
              setSpawnStep('prompt');
            }}
          />
        </Box>
      )}

      {spawnStep === 'prompt' && (
        <Box flexDirection="column">
          <Text>Prompt:</Text>
          <TextInput
            placeholder="Enter agent prompt..."
            defaultValue={spawnPrompt}
            onChange={setSpawnPrompt}
            onSubmit={() => setSpawnStep('workDir')}
          />
        </Box>
      )}

      {spawnStep === 'workDir' && (
        <Box flexDirection="column">
          <Text>Working Directory:</Text>
          <TextInput
            placeholder={process.cwd()}
            defaultValue={spawnWorkDir}
            onChange={setSpawnWorkDir}
            onSubmit={() => setSpawnStep('approvalMode')}
          />
        </Box>
      )}

      {spawnStep === 'approvalMode' && (
        <Box flexDirection="column">
          <Text>Approval Mode:</Text>
          <Select
            options={APPROVAL_OPTIONS}
            defaultValue="suggest"
            onChange={(value) => submitSpawn(value as 'suggest' | 'auto')}
          />
        </Box>
      )}

      {stepIndex > 0 && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text dimColor bold>Filled:</Text>
          <Text dimColor>  Type: {spawnType}</Text>
          {spawnPrompt && (
            <Text dimColor>
              {'  '}Prompt: {spawnPrompt.slice(0, 60)}
              {spawnPrompt.length > 60 ? '...' : ''}
            </Text>
          )}
          {stepIndex > 2 && <Text dimColor>  WorkDir: {spawnWorkDir}</Text>}
        </Box>
      )}
    </Box>
  );
}
