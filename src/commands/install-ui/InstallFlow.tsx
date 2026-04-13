import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { InstallHub, buildHubItems } from './InstallHub.js';
import { ComponentGrid } from './ComponentGrid.js';
import { HooksConfig } from './HooksConfig.js';
import { McpConfig } from './McpConfig.js';
import { InstallConfirm, type InstallFlowConfig } from './InstallConfirm.js';
import { InstallExecution, type InstallFlowResult } from './InstallExecution.js';
import { InstallResult } from './InstallResult.js';
import { scanComponents, MCP_TOOLS, COMPONENT_DEFS } from '../install-backend.js';
import type { HookLevel } from '../hooks.js';

// ---------------------------------------------------------------------------
// InstallFlow — hub-based interactive install
//
// Full flow:  mode → hub ⇄ [components_config | hooks_config | mcp_config]
//             → confirm → executing → complete
//
// Hub is the central menu. Enter on an item dives into its config.
// Esc from config returns to hub. "Install" from hub goes to confirm.
//
// Subcommands skip mode+hub and start directly at a config step.
// ---------------------------------------------------------------------------

type FlowStep =
  | 'mode' | 'hub'
  | 'components_config' | 'hooks_config' | 'mcp_config'
  | 'confirm' | 'executing' | 'complete';

export interface InstallFlowProps {
  pkgRoot: string;
  version: string;
  /** Jump directly to a config step (subcommands). */
  initialStep?: FlowStep;
  /** Pre-set mode. */
  initialMode?: 'global' | 'project';
  /** Pre-select categories (subcommands set this to single item). */
  initialStepIds?: string[];
}

export function InstallFlow({
  pkgRoot, version,
  initialStep, initialMode, initialStepIds,
}: InstallFlowProps) {
  const { exit } = useApp();

  const isSubcommand = !!initialStep;
  const [step, setStep] = useState<FlowStep>(initialStep ?? 'mode');
  const [mode, setMode] = useState<'global' | 'project'>(initialMode ?? 'global');
  const [projectPath] = useState(process.cwd());

  // Which categories are enabled
  const [enabledSteps, setEnabledSteps] = useState<Record<string, boolean>>({
    components: initialStepIds ? initialStepIds.includes('components') : true,
    hooks: initialStepIds ? initialStepIds.includes('hooks') : true,
    mcp: initialStepIds ? initialStepIds.includes('mcp') : true,
  });

  // Fine-grained config
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(
    () => COMPONENT_DEFS.map((d) => d.id),
  );
  const [hookLevel, setHookLevel] = useState<HookLevel>('standard');
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [mcpTools, setMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [mcpProjectRoot, setMcpProjectRoot] = useState('');

  const [result, setResult] = useState<InstallFlowResult | null>(null);

  // Scanned components
  const scannedComponents = useMemo(
    () => scanComponents(pkgRoot, mode, projectPath),
    [pkgRoot, mode, projectPath],
  );
  const selectedComponents = useMemo(
    () => scannedComponents.filter((c) => c.available && selectedComponentIds.includes(c.def.id)),
    [scannedComponents, selectedComponentIds],
  );
  const fileCount = selectedComponents.reduce((sum, c) => sum + c.fileCount, 0);

  const flowConfig: InstallFlowConfig = useMemo(() => ({
    mode,
    projectPath,
    installComponents: enabledSteps.components,
    installHooks: enabledSteps.hooks,
    installMcp: enabledSteps.mcp && mcpEnabled,
    hookLevel,
    componentCount: selectedComponents.length,
    fileCount,
    mcpToolCount: mcpTools.length,
    selectedComponentIds,
    mcpTools,
    mcpProjectRoot,
  }), [mode, projectPath, enabledSteps, hookLevel, selectedComponents.length,
    fileCount, mcpTools, mcpEnabled, selectedComponentIds, mcpProjectRoot]);

  // Hub items with live summary
  const hubItems = useMemo(() => buildHubItems(
    enabledSteps as { components: boolean; hooks: boolean; mcp: boolean },
    {
      componentCount: selectedComponents.length,
      fileCount,
      hookLevel,
      mcpToolCount: mcpTools.length,
      mcpEnabled,
    },
  ), [enabledSteps, selectedComponents.length, fileCount, hookLevel, mcpTools.length, mcpEnabled]);

  // Toggle category enabled/disabled
  const toggleStep = useCallback((id: string) => {
    setEnabledSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Hub → enter config
  const enterConfig = useCallback((id: string) => {
    const map: Record<string, FlowStep> = {
      components: 'components_config',
      hooks: 'hooks_config',
      mcp: 'mcp_config',
    };
    if (map[id]) setStep(map[id]);
  }, []);

  // Return to hub from config (or to confirm for subcommands)
  const returnFromConfig = useCallback(() => {
    setStep(isSubcommand ? 'confirm' : 'hub');
  }, [isSubcommand]);

  // Global input
  useInput((input, key) => {
    if (step === 'executing' || step === 'complete') return;

    if (step === 'mode') {
      if (input === 'g' || input === 'G') setMode('global');
      else if (input === 'p' || input === 'P') setMode('project');
      else if (key.return) setStep('hub');
      else if (key.escape) exit();
      return;
    }

    // Config steps: Esc → return to hub
    if (step === 'components_config') {
      if (key.escape) setStep(isSubcommand ? 'confirm' : 'hub');
      return;
    }
    if (step === 'hooks_config' || step === 'mcp_config') {
      if (key.return) returnFromConfig();
      else if (key.escape) setStep(isSubcommand ? 'confirm' : 'hub');
      return;
    }

    // Confirm: handled by InstallConfirm component
    // Hub, ComponentGrid: handled by their own useInput
  });

  // Progress bar steps
  const progressSteps = isSubcommand
    ? [
        { key: step.replace('_config', '') as string, label: step.replace('_config', '').charAt(0).toUpperCase() + step.replace('_config', '').slice(1) },
        { key: 'confirm', label: 'Confirm' },
        { key: 'executing', label: 'Install' },
        { key: 'complete', label: 'Done' },
      ]
    : [
        { key: 'mode', label: 'Mode' },
        { key: 'hub', label: 'Menu' },
        { key: 'confirm', label: 'Confirm' },
        { key: 'executing', label: 'Install' },
        { key: 'complete', label: 'Done' },
      ];

  // Map current step to progress key
  const progressKey = ['components_config', 'hooks_config', 'mcp_config'].includes(step)
    ? (isSubcommand ? step.replace('_config', '') : 'hub')
    : step;
  const stepIndex = progressSteps.findIndex((s) => s.key === progressKey);

  // Footer
  const footerHints: Partial<Record<FlowStep, string>> = {
    mode: '[G]lobal  [P]roject  [Enter] Next  [Esc] Exit',
    hub: '[Space/1-3] Toggle  [Enter] Configure/Install  [Esc] Back',
    components_config: '[Space] Toggle  [1-9] Quick  [A]ll  [N]one  [Enter] Done  [Esc] Back',
    hooks_config: '[1-4] Select level  [Enter] Done  [Esc] Back',
    mcp_config: '[y/n] Enable  [1-6] Toggle tool  [Enter] Done  [Esc] Back',
    confirm: '[Enter] Install  [Esc] Back',
  };

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Gradient name="fruit">
            <BigText text="MAESTRO-FLOW" font="slick" />
          </Gradient>
          <Box flexDirection="column" justifyContent="center" marginLeft={1}>
            <Text dimColor>install</Text>
            <Text dimColor>v{version}</Text>
          </Box>
        </Box>
        <Box gap={1}>
          {progressSteps.map((s, i) => (
            <Text
              key={s.key}
              bold={s.key === progressKey}
              color={i < stepIndex ? 'green' : s.key === progressKey ? 'cyan' : 'gray'}
            >
              {i < stepIndex ? '[x]' : s.key === progressKey ? '[>]' : '[ ]'} {s.label}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>
        {step === 'mode' && (
          <Box flexDirection="column">
            <Text bold color="cyan">Installation Mode</Text>
            <Box marginTop={1}>
              <Text color={mode === 'global' ? 'green' : 'gray'}>
                {mode === 'global' ? '[x]' : '[ ]'} Global
              </Text>
              <Text>  </Text>
              <Text color={mode === 'project' ? 'green' : 'gray'}>
                {mode === 'project' ? '[x]' : '[ ]'} Project
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                {mode === 'global'
                  ? 'Install to home directory (~/.claude/, ~/.maestro/)'
                  : `Install to project directory (${projectPath})`}
              </Text>
            </Box>
          </Box>
        )}

        {step === 'hub' && (
          <InstallHub
            items={hubItems}
            onToggle={toggleStep}
            onEnter={enterConfig}
            onInstall={() => setStep('confirm')}
            onBack={() => setStep('mode')}
          />
        )}

        {step === 'components_config' && (
          <ComponentGrid
            components={scannedComponents}
            selectedIds={selectedComponentIds}
            onSelectionChange={setSelectedComponentIds}
            onDone={returnFromConfig}
          />
        )}

        {step === 'hooks_config' && (
          <HooksConfig level={hookLevel} onLevelChange={setHookLevel} />
        )}

        {step === 'mcp_config' && (
          <McpConfig
            enabled={mcpEnabled}
            tools={mcpTools}
            projectRoot={mcpProjectRoot}
            mode={mode}
            onEnableChange={setMcpEnabled}
            onToolsChange={setMcpTools}
            onRootChange={setMcpProjectRoot}
          />
        )}

        {step === 'confirm' && (
          <InstallConfirm
            config={flowConfig}
            onConfirm={() => setStep('executing')}
            onBack={() => setStep(isSubcommand ? (initialStep ?? 'hub') : 'hub')}
          />
        )}

        {step === 'executing' && (
          <InstallExecution
            config={flowConfig}
            pkgRoot={pkgRoot}
            version={version}
            onComplete={(r) => {
              setResult(r);
              setStep('complete');
            }}
          />
        )}

        {step === 'complete' && result && (
          <InstallResult result={result} />
        )}
      </Box>

      {/* Footer */}
      {footerHints[step] && (
        <Box paddingX={1}>
          <Text dimColor>{footerHints[step]}</Text>
        </Box>
      )}
    </Box>
  );
}
