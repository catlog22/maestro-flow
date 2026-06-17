import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { C, SYM, Breadcrumb } from '../shared/index.js';
import { GroupedHub, buildGroupedHubItems } from './GroupedHub.js';
import { ComponentGrid } from './ComponentGrid.js';
import { HooksConfig, type HooksSelection } from './HooksConfig.js';
import { McpConfig } from './McpConfig.js';
import { ExtraMcpConfig } from './ExtraMcpConfig.js';
import { StatuslineConfig } from './StatuslineConfig.js';
import { BackupConfig } from './BackupConfig.js';
import { InstallConfirm } from './InstallConfirm.js';
import type { InstallFlowConfig } from './types.js';
import { InstallExecution, type InstallFlowResult } from './InstallExecution.js';
import { InstallResult } from './InstallResult.js';
import { scanComponents, countExistingTargetFiles, MCP_TOOLS, COMPONENT_DEFS, type ExtraMcpTargetId } from '../../commands/install-backend.js';
import { detectStatusline, getHooksForLevel, getAllHookNames, type HookLevel } from '../../commands/hooks.js';
import { findManifest, type Manifest } from '../../core/manifest.js';
import { exportProfile, importProfile, listProfiles, type InstallProfile } from '../../core/install-profile.js';
import { paths } from '../../config/paths.js';
import { t } from '../../i18n/index.js';

// CodeGraph is built-in (tree-sitter). !isCodeGraphAvailable() → false → toggle defaults off (no action needed).
const isCodeGraphAvailable = () => true;

// ---------------------------------------------------------------------------
// InstallFlow — redesigned hub-based interactive install
//
// Changes from v1:
//   - Mode selector inline (no separate step)
//   - GroupedHub with 4 semantic groups
//   - HooksConfig with individual hook toggle
//   - Config profile export/import
//   - Breadcrumb navigation in config panels
//   - Per-step execution checklist
//   - Confirm split: Will Install / Skipped
// ---------------------------------------------------------------------------

type FlowStep =
  | 'hub'
  | 'components_config' | 'hooks_config' | 'mcp_config'
  | 'codex_hooks_config' | 'codex_mcp_config'
  | 'agy_hooks_config'
  | 'extra_mcp_config'
  | 'statusline_config' | 'backup_config'
  | 'confirm' | 'executing' | 'complete';

// Keep 'mode' in the type for subcommand compat but redirect to 'hub'
type FlowStepCompat = FlowStep | 'mode';

export interface InstallFlowProps {
  pkgRoot: string;
  version: string;
  initialStep?: FlowStepCompat;
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
}

function makeHooksSelection(level: HookLevel, tool: 'claude' | 'codex' | 'agy'): HooksSelection {
  return {
    basePreset: level,
    selectedHooks: getHooksForLevel(level, tool),
    isCustom: false,
  };
}

export function InstallFlow({
  pkgRoot, version,
  initialStep, initialMode, initialStepIds,
}: InstallFlowProps) {
  const { exit } = useApp();

  const isSubcommand = !!initialStep;
  // 'mode' step redirects to 'hub' in the new design
  const resolvedInitialStep: FlowStep = (initialStep === 'mode' || !initialStep) ? 'hub' : initialStep as FlowStep;
  const [step, setStep] = useState<FlowStep>(resolvedInitialStep);
  const [mode, setMode] = useState<'global' | 'project'>(initialMode ?? 'global');
  const [projectPath] = useState(process.cwd());

  const lastManifest = useMemo<Manifest | null>(() => {
    try {
      const targetPath = mode === 'global' ? paths.home : projectPath;
      return findManifest(mode, targetPath);
    } catch { return null; }
  }, [mode, projectPath]);

  const prior = useMemo(() => ({
    claudeHooks: !!(lastManifest?.hooks?.claude?.installed?.length),
    codexHooks: !!(lastManifest?.hooks?.codex?.installed?.length),
    agyHooks: !!(lastManifest?.hooks?.agy?.installed?.length),
    claudeMcp: !!lastManifest?.mcp?.claude,
    codexMcp: !!lastManifest?.mcp?.codex,
    extraMcp: !!(lastManifest?.mcp?.extras?.length),
    statusline: !!lastManifest?.statusline || !!detectStatusline(),
  }), [lastManifest]);

  const [enabledSteps, setEnabledSteps] = useState<Record<string, boolean>>({
    components: initialStepIds ? initialStepIds.includes('components') : true,
    hooks: initialStepIds ? initialStepIds.includes('hooks') : (lastManifest ? prior.claudeHooks : true),
    mcp: initialStepIds ? initialStepIds.includes('mcp') : (lastManifest ? prior.claudeMcp : true),
    codexHooks: initialStepIds ? initialStepIds.includes('codexHooks') : prior.codexHooks,
    codexMcp: initialStepIds ? initialStepIds.includes('codexMcp') : prior.codexMcp,
    agyHooks: initialStepIds ? initialStepIds.includes('agyHooks') : prior.agyHooks,
    extraMcp: initialStepIds ? initialStepIds.includes('extraMcp') : prior.extraMcp,
    statusline: initialStepIds ? initialStepIds.includes('statusline') : prior.statusline,
    codegraph: initialStepIds ? initialStepIds.includes('codegraph') : !isCodeGraphAvailable(),
    backup: initialStepIds ? initialStepIds.includes('backup') : true,
  });

  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(
    () => lastManifest?.selectedComponentIds?.length
      ? lastManifest.selectedComponentIds
      : COMPONENT_DEFS.filter((d) => d.defaultSelected !== false).map((d) => d.id),
  );

  // Granular hooks — initialize from manifest level or default
  const initClaudeLevel = (lastManifest?.hooks?.claude?.level as HookLevel) || 'standard';
  const [claudeHooksSelection, setClaudeHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection(initClaudeLevel, 'claude'),
  );

  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [mcpTools, setMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [mcpProjectRoot, setMcpProjectRoot] = useState('');

  const initCodexLevel = (lastManifest?.hooks?.codex?.level as HookLevel) || 'standard';
  const [codexHooksSelection, setCodexHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection(initCodexLevel, 'codex'),
  );
  const [codexMcpEnabled, setCodexMcpEnabled] = useState(true);
  const [codexMcpTools, setCodexMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [codexMcpProjectRoot, setCodexMcpProjectRoot] = useState('');

  const initAgyLevel = (lastManifest?.hooks?.agy?.level as HookLevel) || 'standard';
  const [agyHooksSelection, setAgyHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection(initAgyLevel, 'agy'),
  );

  const [extraMcpTargetIds, setExtraMcpTargetIds] = useState<ExtraMcpTargetId[]>(
    () => (lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? [],
  );

  const [installStatusline, setInstallStatusline] = useState(
    () => prior.statusline || !lastManifest,
  );
  const [statuslineTheme, setStatuslineTheme] = useState(
    () => lastManifest?.statusline?.theme || 'notion',
  );
  const statuslineDetected = useMemo(
    () => detectStatusline({ project: mode === 'project' }),
    [mode],
  );

  const [backupClaudeMd, setBackupClaudeMd] = useState(true);
  const [backupAll, setBackupAll] = useState(false);
  const [result, setResult] = useState<InstallFlowResult | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear profile message timers on unmount
  useEffect(() => () => {
    if (profileTimerRef.current) clearTimeout(profileTimerRef.current);
  }, []);

  // Re-sync on mode change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (isSubcommand) return;
    setEnabledSteps({
      components: true,
      hooks: lastManifest ? prior.claudeHooks : true,
      mcp: lastManifest ? prior.claudeMcp : true,
      codexHooks: prior.codexHooks,
      codexMcp: prior.codexMcp,
      agyHooks: prior.agyHooks,
      extraMcp: prior.extraMcp,
      statusline: prior.statusline || !lastManifest,
      codegraph: !isCodeGraphAvailable(),
      backup: true,
    });
    setSelectedComponentIds(
      lastManifest?.selectedComponentIds?.length
        ? lastManifest.selectedComponentIds
        : COMPONENT_DEFS.filter((d) => d.defaultSelected !== false).map((d) => d.id),
    );
    const claudeLevel = (lastManifest?.hooks?.claude?.level as HookLevel) || 'standard';
    setClaudeHooksSelection(makeHooksSelection(claudeLevel, 'claude'));
    const codexLevel = (lastManifest?.hooks?.codex?.level as HookLevel) || 'standard';
    setCodexHooksSelection(makeHooksSelection(codexLevel, 'codex'));
    const agyLevel = (lastManifest?.hooks?.agy?.level as HookLevel) || 'standard';
    setAgyHooksSelection(makeHooksSelection(agyLevel, 'agy'));
    setExtraMcpTargetIds(
      (lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? [],
    );
    setInstallStatusline(prior.statusline || !lastManifest);
    setStatuslineTheme(lastManifest?.statusline?.theme || 'notion');
  }, [mode, lastManifest, prior, isSubcommand]);

  const scannedComponents = useMemo(
    () => scanComponents(pkgRoot, mode, projectPath),
    [pkgRoot, mode, projectPath],
  );
  const selectedComponents = useMemo(
    () => scannedComponents.filter((c) => c.available && selectedComponentIds.includes(c.def.id)),
    [scannedComponents, selectedComponentIds],
  );
  const fileCount = selectedComponents.reduce((sum, c) => sum + c.fileCount, 0);
  const existingFileCount = useMemo(
    () => countExistingTargetFiles(selectedComponents),
    [selectedComponents],
  );

  // Derive legacy hookLevel from selection for backward compat.
  // Execution uses basePreset for installHooksByLevel; individual toggles
  // are a UI preview — full custom execution requires future backend support.
  const hookLevel: HookLevel = claudeHooksSelection.basePreset;
  const codexHookLevel: HookLevel = codexHooksSelection.basePreset;
  const agyHookLevel: HookLevel = agyHooksSelection.basePreset;

  const flowConfig: InstallFlowConfig = useMemo(() => ({
    mode,
    projectPath,
    installComponents: enabledSteps.components,
    installHooks: enabledSteps.hooks,
    installMcp: enabledSteps.mcp && mcpEnabled,
    installCodexHooks: enabledSteps.codexHooks,
    codexHookLevel,
    installCodexMcp: enabledSteps.codexMcp && codexMcpEnabled,
    codexMcpTools,
    codexMcpProjectRoot,
    installAgyHooks: enabledSteps.agyHooks,
    agyHookLevel,
    installExtraMcp: enabledSteps.extraMcp && extraMcpTargetIds.length > 0,
    extraMcpTargetIds,
    installCodeGraph: enabledSteps.codegraph,
    installStatusline: enabledSteps.statusline && installStatusline,
    statuslineTheme,
    hookLevel,
    componentCount: selectedComponents.length,
    fileCount,
    mcpToolCount: mcpTools.length,
    selectedComponentIds,
    mcpTools,
    mcpProjectRoot,
    backupClaudeMd: enabledSteps.backup && backupClaudeMd,
    backupAll: enabledSteps.backup && backupAll,
    claudeHooksSelection,
    codexHooksSelection,
    agyHooksSelection,
  }), [mode, projectPath, enabledSteps, hookLevel, selectedComponents.length,
    fileCount, mcpTools, mcpEnabled, selectedComponentIds, mcpProjectRoot,
    codexHookLevel, codexMcpEnabled, codexMcpTools, codexMcpProjectRoot,
    agyHookLevel, extraMcpTargetIds,
    installStatusline, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection]);

  // Grouped hub items
  const claudeAllHooks = useMemo(() => getAllHookNames('claude'), []);
  const codexAllHooks = useMemo(() => getAllHookNames('codex'), []);
  const agyAllHooks = useMemo(() => getAllHookNames('agy'), []);

  const hubGroups = useMemo(() => buildGroupedHubItems(
    enabledSteps as Record<string, boolean>,
    {
      componentCount: selectedComponents.length,
      fileCount,
      hookLevel,
      hookSelectedCount: claudeHooksSelection.selectedHooks.length,
      hookTotalCount: claudeAllHooks.length,
      hookIsCustom: claudeHooksSelection.isCustom,
      mcpToolCount: mcpTools.length,
      mcpEnabled,
      codexHookLevel,
      codexMcpToolCount: codexMcpTools.length,
      codexMcpEnabled,
      codexHookSelectedCount: codexHooksSelection.selectedHooks.length,
      codexHookTotalCount: codexAllHooks.length,
      codexHookIsCustom: codexHooksSelection.isCustom,
      agyHookLevel,
      agyHookSelectedCount: agyHooksSelection.selectedHooks.length,
      agyHookTotalCount: agyAllHooks.length,
      agyHookIsCustom: agyHooksSelection.isCustom,
      extraMcpTargetCount: extraMcpTargetIds.length,
      statuslineDetected,
      statuslineTheme,
      codegraphAvailable: isCodeGraphAvailable(),
      backupClaudeMd,
      backupAll,
    },
  ), [enabledSteps, selectedComponents.length, fileCount, hookLevel, mcpTools.length,
    mcpEnabled, codexHookLevel, codexMcpTools.length, codexMcpEnabled,
    agyHookLevel, extraMcpTargetIds.length,
    statuslineDetected, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection,
    claudeAllHooks, codexAllHooks, agyAllHooks]);

  const toggleStep = useCallback((id: string) => {
    setEnabledSteps((prev) => {
      const next = !prev[id];
      if (next) {
        if (id === 'hooks') setClaudeHooksSelection((sel) =>
          sel.basePreset === 'none' ? makeHooksSelection('standard', 'claude') : sel);
        else if (id === 'codexHooks') setCodexHooksSelection((sel) =>
          sel.basePreset === 'none' ? makeHooksSelection('standard', 'codex') : sel);
        else if (id === 'agyHooks') setAgyHooksSelection((sel) =>
          sel.basePreset === 'none' ? makeHooksSelection('standard', 'agy') : sel);
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const enterConfig = useCallback((id: string) => {
    const map: Record<string, FlowStep> = {
      components: 'components_config',
      hooks: 'hooks_config',
      mcp: 'mcp_config',
      codexHooks: 'codex_hooks_config',
      codexMcp: 'codex_mcp_config',
      agyHooks: 'agy_hooks_config',
      extraMcp: 'extra_mcp_config',
      statusline: 'statusline_config',
      backup: 'backup_config',
    };
    if (map[id]) setStep(map[id]);
  }, []);

  const returnFromConfig = useCallback(() => {
    setStep(isSubcommand ? 'confirm' : 'hub');
  }, [isSubcommand]);

  // Profile export
  const handleExport = useCallback(() => {
    try {
      const profile: InstallProfile = {
        $schema: 'maestro-install-config/v1',
        name: 'default',
        createdAt: new Date().toISOString(),
        scope: mode,
        components: { enabled: enabledSteps.components, selectedIds: selectedComponentIds },
        claude: {
          hooks: { enabled: enabledSteps.hooks, ...claudeHooksSelection },
          mcp: { enabled: enabledSteps.mcp && mcpEnabled, tools: mcpTools, projectRoot: mcpProjectRoot },
          statusline: { enabled: enabledSteps.statusline && installStatusline, theme: statuslineTheme },
        },
        codex: {
          hooks: { enabled: enabledSteps.codexHooks, ...codexHooksSelection },
          mcp: { enabled: enabledSteps.codexMcp && codexMcpEnabled, tools: codexMcpTools, projectRoot: codexMcpProjectRoot },
        },
        agy: {
          hooks: { enabled: enabledSteps.agyHooks, ...agyHooksSelection },
        },
        extraMcp: { enabled: enabledSteps.extraMcp, targetIds: extraMcpTargetIds },
        codeGraph: { enabled: enabledSteps.codegraph },
        backup: { claudeMd: backupClaudeMd, all: backupAll },
      };
      const path = exportProfile(profile);
      setProfileMessage(`✓ Exported to ${path}`);
      profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
    } catch (err) {
      setProfileMessage(`✗ Export failed: ${err instanceof Error ? err.message : String(err)}`);
      profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
    }
  }, [mode, enabledSteps, selectedComponentIds, claudeHooksSelection, mcpEnabled, mcpTools, mcpProjectRoot,
    codexHooksSelection, codexMcpEnabled, codexMcpTools, codexMcpProjectRoot,
    agyHooksSelection, extraMcpTargetIds, installStatusline, statuslineTheme, backupClaudeMd, backupAll]);

  // Profile import — try to load from default profile
  const handleImport = useCallback(() => {
    try {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        setProfileMessage('No profiles found in ~/.maestro/install-profiles/');
        profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
        return;
      }
      const profile = importProfile(profiles[0].filePath);
      // Apply profile to state
      setMode(profile.scope);
      setEnabledSteps({
        components: profile.components.enabled,
        hooks: profile.claude.hooks.enabled,
        mcp: profile.claude.mcp.enabled,
        codexHooks: profile.codex.hooks.enabled,
        codexMcp: profile.codex.mcp.enabled,
        agyHooks: profile.agy.hooks.enabled,
        extraMcp: profile.extraMcp.enabled,
        statusline: profile.claude.statusline.enabled,
        codegraph: profile.codeGraph.enabled,
        backup: profile.backup.claudeMd || profile.backup.all,
      });
      setSelectedComponentIds(profile.components.selectedIds);
      setClaudeHooksSelection({
        basePreset: profile.claude.hooks.basePreset,
        selectedHooks: profile.claude.hooks.selectedHooks,
        isCustom: profile.claude.hooks.isCustom,
      });
      setMcpEnabled(profile.claude.mcp.enabled);
      setMcpTools(profile.claude.mcp.tools);
      setMcpProjectRoot(profile.claude.mcp.projectRoot);
      setCodexHooksSelection({
        basePreset: profile.codex.hooks.basePreset,
        selectedHooks: profile.codex.hooks.selectedHooks,
        isCustom: profile.codex.hooks.isCustom,
      });
      setCodexMcpEnabled(profile.codex.mcp.enabled);
      setCodexMcpTools(profile.codex.mcp.tools);
      setCodexMcpProjectRoot(profile.codex.mcp.projectRoot);
      setAgyHooksSelection({
        basePreset: profile.agy.hooks.basePreset,
        selectedHooks: profile.agy.hooks.selectedHooks,
        isCustom: profile.agy.hooks.isCustom,
      });
      setExtraMcpTargetIds(profile.extraMcp.targetIds);
      setInstallStatusline(profile.claude.statusline.enabled);
      setStatuslineTheme(profile.claude.statusline.theme);
      setBackupClaudeMd(profile.backup.claudeMd);
      setBackupAll(profile.backup.all);
      setProfileMessage(`✓ Loaded profile: ${profiles[0].name}`);
      profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
    } catch (err) {
      setProfileMessage(`✗ Import failed: ${err instanceof Error ? err.message : String(err)}`);
      profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
    }
  }, []);

  // Global input for config steps
  useInput((input, key) => {
    if (step === 'executing' || step === 'complete') return;

    if (step === 'components_config') {
      if (key.escape) setStep(isSubcommand ? 'confirm' : 'hub');
      return;
    }
    if (step === 'hooks_config' || step === 'mcp_config' || step === 'codex_hooks_config' || step === 'codex_mcp_config' || step === 'agy_hooks_config' || step === 'extra_mcp_config' || step === 'statusline_config' || step === 'backup_config') {
      if (key.return) returnFromConfig();
      else if (key.escape) setStep(isSubcommand ? 'confirm' : 'hub');
      return;
    }
  });

  // Breadcrumb path for config steps
  const breadcrumbPath = useMemo((): string[] | null => {
    switch (step) {
      case 'components_config': return ['Hub', 'Core', 'Components'];
      case 'hooks_config': return ['Hub', 'Claude Code', 'Hooks'];
      case 'mcp_config': return ['Hub', 'Claude Code', 'MCP Server'];
      case 'statusline_config': return ['Hub', 'Claude Code', 'Statusline'];
      case 'codex_hooks_config': return ['Hub', 'Codex', 'Hooks'];
      case 'codex_mcp_config': return ['Hub', 'Codex', 'MCP'];
      case 'agy_hooks_config': return ['Hub', 'Other Tools', 'Agy Hooks'];
      case 'extra_mcp_config': return ['Hub', 'Other Tools', 'Extra MCP'];
      case 'backup_config': return ['Hub', 'Core', 'Backup'];
      default: return null;
    }
  }, [step]);

  // Progress steps for header
  const progressSteps = isSubcommand
    ? [
        { key: step.replace('_config', ''), label: step.replace('_config', '').charAt(0).toUpperCase() + step.replace('_config', '').slice(1) },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ]
    : [
        { key: 'hub', label: t.install.stepMenu },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ];

  const progressKey = ['components_config', 'hooks_config', 'mcp_config', 'codex_hooks_config', 'codex_mcp_config', 'agy_hooks_config', 'extra_mcp_config', 'statusline_config', 'backup_config'].includes(step)
    ? (isSubcommand ? step.replace('_config', '') : 'hub')
    : step;
  const stepIndex = progressSteps.findIndex((s) => s.key === progressKey);

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column">
          <Gradient name="fruit">
            <BigText text="MAESTRO" font="slick" />
          </Gradient>
          <Box marginTop={-2}>
            <Text dimColor>
              <BigText text="flow" font="slick" />
            </Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>{t.install.headerVersion.replace('{version}', version)}</Text>
          </Box>
        </Box>
        <Box gap={1}>
          {progressSteps.map((s, i) => (
            <Text
              key={s.key}
              bold={s.key === progressKey}
              color={i < stepIndex ? C.success : s.key === progressKey ? C.primary : C.neutral}
            >
              {i < stepIndex ? SYM.stepDone : s.key === progressKey ? SYM.stepActive : SYM.stepPending} {s.label}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>
        {/* Breadcrumb for config panels */}
        {breadcrumbPath && (
          <Box marginBottom={1}>
            <Breadcrumb path={breadcrumbPath} />
          </Box>
        )}

        {step === 'hub' && (
          <>
            <GroupedHub
              groups={hubGroups}
              mode={mode}
              onModeChange={setMode}
              onToggle={toggleStep}
              onEnter={enterConfig}
              onInstall={() => setStep('confirm')}
              onExport={handleExport}
              onImport={handleImport}
              onExit={() => exit()}
              lastInstallDate={lastManifest?.installedAt?.split('T')[0]}
            />
            {profileMessage && (
              <Box marginTop={1}>
                <Text color={profileMessage.startsWith('✓') ? C.success : profileMessage.startsWith('✗') ? C.error : C.warning}>
                  {profileMessage}
                </Text>
              </Box>
            )}
          </>
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
          <HooksConfig
            selection={claudeHooksSelection}
            onSelectionChange={setClaudeHooksSelection}
            tool="claude"
          />
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

        {step === 'codex_hooks_config' && (
          <HooksConfig
            selection={codexHooksSelection}
            onSelectionChange={setCodexHooksSelection}
            tool="codex"
            title="Codex Hooks"
            descriptions={t.install.codexHooksLevelDescriptions}
          />
        )}

        {step === 'codex_mcp_config' && (
          <McpConfig
            enabled={codexMcpEnabled}
            tools={codexMcpTools}
            projectRoot={codexMcpProjectRoot}
            mode={mode}
            onEnableChange={setCodexMcpEnabled}
            onToolsChange={setCodexMcpTools}
            onRootChange={setCodexMcpProjectRoot}
          />
        )}

        {step === 'agy_hooks_config' && (
          <HooksConfig
            selection={agyHooksSelection}
            onSelectionChange={setAgyHooksSelection}
            tool="agy"
            title="Agy (Antigravity) Hooks"
            descriptions={t.install.agyHooksLevelDescriptions}
          />
        )}

        {step === 'extra_mcp_config' && (
          <ExtraMcpConfig
            mode={mode}
            selectedIds={extraMcpTargetIds}
            onSelectionChange={setExtraMcpTargetIds}
            onDone={returnFromConfig}
            onBack={() => setStep(isSubcommand ? 'confirm' : 'hub')}
          />
        )}

        {step === 'statusline_config' && (
          <StatuslineConfig
            enabled={installStatusline}
            theme={statuslineTheme}
            detected={statuslineDetected}
            onToggle={setInstallStatusline}
            onThemeChange={setStatuslineTheme}
          />
        )}

        {step === 'backup_config' && (
          <BackupConfig
            backupClaudeMd={backupClaudeMd}
            backupAll={backupAll}
            existingFileCount={existingFileCount}
            onClaudeMdChange={setBackupClaudeMd}
            onAllChange={setBackupAll}
          />
        )}

        {step === 'confirm' && (
          <InstallConfirm
            config={flowConfig}
            onConfirm={() => setStep('executing')}
            onBack={() => setStep(isSubcommand ? (resolvedInitialStep ?? 'hub') : 'hub')}
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
    </Box>
  );
}
