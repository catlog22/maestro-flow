// ---------------------------------------------------------------------------
// useInstallFlowState — extracted state management for InstallFlow
//
// Groups 20+ useState into a single hook. InstallFlow becomes a thin renderer.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { HooksSelection } from './HooksConfig.js';
import type { InstallFlowConfig } from './types.js';
import type { InstallFlowResult } from './InstallExecution.js';
import { scanComponents, countExistingTargetFiles, MCP_TOOLS, COMPONENT_DEFS, migrateComponentIds, type ExtraMcpTargetId } from '../../commands/install-backend.js';
import { detectStatusline, getHooksForLevel, getAllHookNames, type HookLevel } from '../../commands/hooks.js';
import { findManifest, type Manifest } from '../../core/manifest.js';
import { exportProfile, importProfile, listProfiles, configToProfile, profileToStateValues } from '../../core/install-profile.js';
import { paths } from '../../config/paths.js';
import { buildGroupedHubItems } from './GroupedHub.js';

export type FlowStep =
  | 'hub'
  | 'components_config' | 'hooks_config' | 'mcp_config'
  | 'codex_hooks_config' | 'codex_mcp_config'
  | 'agy_hooks_config' | 'extra_mcp_config'
  | 'statusline_config' | 'backup_config'
  | 'confirm' | 'executing' | 'complete';

export type FlowStepCompat = FlowStep | 'mode';

function makeHooksSelection(level: HookLevel, tool: 'claude' | 'codex' | 'agy'): HooksSelection {
  return {
    basePreset: level,
    selectedHooks: getHooksForLevel(level, tool),
    isCustom: false,
  };
}

export interface UseInstallFlowStateOptions {
  pkgRoot: string;
  initialStep?: FlowStepCompat;
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
}

export function useInstallFlowState(opts: UseInstallFlowStateOptions) {
  const { pkgRoot, initialStep, initialMode, initialStepIds } = opts;
  const isSubcommand = !!initialStep;
  const resolvedInitialStep: FlowStep = (initialStep === 'mode' || !initialStep) ? 'hub' : initialStep as FlowStep;

  // --- Core navigation ---
  const [step, setStep] = useState<FlowStep>(resolvedInitialStep);
  const [mode, setMode] = useState<'global' | 'project'>(initialMode ?? 'global');
  const [projectPath] = useState(process.cwd());

  // --- Manifest ---
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

  // --- Enabled steps ---
  const [enabledSteps, setEnabledSteps] = useState<Record<string, boolean>>({
    components: initialStepIds ? initialStepIds.includes('components') : true,
    hooks: initialStepIds ? initialStepIds.includes('hooks') : (lastManifest ? prior.claudeHooks : true),
    mcp: initialStepIds ? initialStepIds.includes('mcp') : (lastManifest ? prior.claudeMcp : true),
    codexHooks: initialStepIds ? initialStepIds.includes('codexHooks') : prior.codexHooks,
    codexMcp: initialStepIds ? initialStepIds.includes('codexMcp') : prior.codexMcp,
    agyHooks: initialStepIds ? initialStepIds.includes('agyHooks') : prior.agyHooks,
    extraMcp: initialStepIds ? initialStepIds.includes('extraMcp') : prior.extraMcp,
    statusline: initialStepIds ? initialStepIds.includes('statusline') : prior.statusline,
    backup: initialStepIds ? initialStepIds.includes('backup') : true,
  });

  // --- Component selection ---
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(
    () => lastManifest?.selectedComponentIds?.length
      ? migrateComponentIds(lastManifest.selectedComponentIds)
      : COMPONENT_DEFS.filter((d) => d.defaultSelected !== false).map((d) => d.id),
  );

  // --- Claude hooks ---
  const [claudeHooksSelection, setClaudeHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection((lastManifest?.hooks?.claude?.level as HookLevel) || 'standard', 'claude'),
  );

  // --- Claude MCP ---
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [mcpTools, setMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [mcpProjectRoot, setMcpProjectRoot] = useState('');

  // --- Codex hooks ---
  const [codexHooksSelection, setCodexHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection((lastManifest?.hooks?.codex?.level as HookLevel) || 'standard', 'codex'),
  );
  const [codexMcpEnabled, setCodexMcpEnabled] = useState(true);
  const [codexMcpTools, setCodexMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [codexMcpProjectRoot, setCodexMcpProjectRoot] = useState('');

  // --- Agy hooks ---
  const [agyHooksSelection, setAgyHooksSelection] = useState<HooksSelection>(
    () => makeHooksSelection((lastManifest?.hooks?.agy?.level as HookLevel) || 'standard', 'agy'),
  );

  // --- Extra MCP ---
  const [extraMcpTargetIds, setExtraMcpTargetIds] = useState<ExtraMcpTargetId[]>(
    () => (lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? [],
  );

  // --- Statusline ---
  const [installStatusline, setInstallStatusline] = useState(() => prior.statusline || !lastManifest);
  const [statuslineTheme, setStatuslineTheme] = useState(() => lastManifest?.statusline?.theme || 'notion');
  const statuslineDetected = useMemo(() => detectStatusline({ project: mode === 'project' }), [mode]);

  // --- Backup ---
  const [backupClaudeMd, setBackupClaudeMd] = useState(true);
  const [backupAll, setBackupAll] = useState(false);

  // --- Result + profile message ---
  const [result, setResult] = useState<InstallFlowResult | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (profileTimerRef.current) clearTimeout(profileTimerRef.current);
  }, []);

  const showProfileMessage = useCallback((msg: string) => {
    setProfileMessage(msg);
    profileTimerRef.current = setTimeout(() => setProfileMessage(null), 3000);
  }, []);

  // --- Re-sync on mode change ---
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
      backup: true,
    });
    setSelectedComponentIds(
      lastManifest?.selectedComponentIds?.length
        ? migrateComponentIds(lastManifest.selectedComponentIds)
        : COMPONENT_DEFS.filter((d) => d.defaultSelected !== false).map((d) => d.id),
    );
    setClaudeHooksSelection(makeHooksSelection((lastManifest?.hooks?.claude?.level as HookLevel) || 'standard', 'claude'));
    setCodexHooksSelection(makeHooksSelection((lastManifest?.hooks?.codex?.level as HookLevel) || 'standard', 'codex'));
    setAgyHooksSelection(makeHooksSelection((lastManifest?.hooks?.agy?.level as HookLevel) || 'standard', 'agy'));
    setExtraMcpTargetIds((lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? []);
    setInstallStatusline(prior.statusline || !lastManifest);
    setStatuslineTheme(lastManifest?.statusline?.theme || 'notion');
  }, [mode, lastManifest, prior, isSubcommand]);

  // --- Derived values ---
  const scannedComponents = useMemo(() => scanComponents(pkgRoot, mode, projectPath), [pkgRoot, mode, projectPath]);
  const selectedComponents = useMemo(
    () => scannedComponents.filter((c) => c.available && selectedComponentIds.includes(c.def.id)),
    [scannedComponents, selectedComponentIds],
  );
  const fileCount = selectedComponents.reduce((sum, c) => sum + c.fileCount, 0);
  const existingFileCount = useMemo(() => countExistingTargetFiles(selectedComponents), [selectedComponents]);

  const hookLevel: HookLevel = claudeHooksSelection.basePreset;
  const codexHookLevel: HookLevel = codexHooksSelection.basePreset;
  const agyHookLevel: HookLevel = agyHooksSelection.basePreset;

  const flowConfig: InstallFlowConfig = useMemo(() => ({
    mode, projectPath,
    installComponents: enabledSteps.components,
    installHooks: enabledSteps.hooks,
    installMcp: enabledSteps.mcp && mcpEnabled,
    installCodexHooks: enabledSteps.codexHooks,
    codexHookLevel,
    installCodexMcp: enabledSteps.codexMcp && codexMcpEnabled,
    codexMcpTools, codexMcpProjectRoot,
    installAgyHooks: enabledSteps.agyHooks,
    agyHookLevel,
    installExtraMcp: enabledSteps.extraMcp && extraMcpTargetIds.length > 0,
    extraMcpTargetIds,
    installStatusline: enabledSteps.statusline && installStatusline,
    statuslineTheme,
    hookLevel,
    componentCount: selectedComponents.length,
    fileCount,
    mcpToolCount: mcpTools.length,
    selectedComponentIds, mcpTools, mcpProjectRoot,
    backupClaudeMd: enabledSteps.backup && backupClaudeMd,
    backupAll: enabledSteps.backup && backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection,
  }), [mode, projectPath, enabledSteps, hookLevel, selectedComponents.length,
    fileCount, mcpTools, mcpEnabled, selectedComponentIds, mcpProjectRoot,
    codexHookLevel, codexMcpEnabled, codexMcpTools, codexMcpProjectRoot,
    agyHookLevel, extraMcpTargetIds,
    installStatusline, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection]);

  // --- Hub groups ---
  const claudeAllHooks = useMemo(() => getAllHookNames('claude'), []);
  const codexAllHooks = useMemo(() => getAllHookNames('codex'), []);
  const agyAllHooks = useMemo(() => getAllHookNames('agy'), []);

  const hubGroups = useMemo(() => buildGroupedHubItems(
    enabledSteps as Record<string, boolean>,
    {
      componentCount: selectedComponents.length, fileCount, hookLevel,
      hookSelectedCount: claudeHooksSelection.selectedHooks.length,
      hookTotalCount: claudeAllHooks.length,
      hookIsCustom: claudeHooksSelection.isCustom,
      mcpToolCount: mcpTools.length, mcpEnabled,
      codexHookLevel,
      codexMcpToolCount: codexMcpTools.length, codexMcpEnabled,
      codexHookSelectedCount: codexHooksSelection.selectedHooks.length,
      codexHookTotalCount: codexAllHooks.length,
      codexHookIsCustom: codexHooksSelection.isCustom,
      agyHookLevel,
      agyHookSelectedCount: agyHooksSelection.selectedHooks.length,
      agyHookTotalCount: agyAllHooks.length,
      agyHookIsCustom: agyHooksSelection.isCustom,
      extraMcpTargetCount: extraMcpTargetIds.length,
      statuslineDetected, statuslineTheme,
      backupClaudeMd, backupAll,
    },
  ), [enabledSteps, selectedComponents.length, fileCount, hookLevel, mcpTools.length,
    mcpEnabled, codexHookLevel, codexMcpTools.length, codexMcpEnabled,
    agyHookLevel, extraMcpTargetIds.length,
    statuslineDetected, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection,
    claudeAllHooks, codexAllHooks, agyAllHooks]);

  // --- Actions ---
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
      components: 'components_config', hooks: 'hooks_config', mcp: 'mcp_config',
      codexHooks: 'codex_hooks_config', codexMcp: 'codex_mcp_config',
      agyHooks: 'agy_hooks_config', extraMcp: 'extra_mcp_config',
      statusline: 'statusline_config', backup: 'backup_config',
    };
    if (map[id]) setStep(map[id]);
  }, []);

  const returnFromConfig = useCallback(() => {
    setStep(isSubcommand ? 'confirm' : 'hub');
  }, [isSubcommand]);

  const handleExport = useCallback(() => {
    try {
      const profile = configToProfile(flowConfig);
      const path = exportProfile(profile);
      showProfileMessage(`✓ Exported to ${path}`);
    } catch (err) {
      showProfileMessage(`✗ Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [flowConfig, showProfileMessage]);

  const handleImport = useCallback(() => {
    try {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        showProfileMessage('No profiles found in ~/.maestro/install-profiles/');
        return;
      }
      const profile = importProfile(profiles[0].filePath);
      const v = profileToStateValues(profile);
      setMode(v.mode);
      setEnabledSteps(v.enabledSteps);
      setSelectedComponentIds(v.selectedComponentIds);
      setClaudeHooksSelection(v.claudeHooks);
      setMcpEnabled(v.mcpEnabled);
      setMcpTools(v.mcpTools);
      setMcpProjectRoot(v.mcpProjectRoot);
      setCodexHooksSelection(v.codexHooks);
      setCodexMcpEnabled(v.codexMcpEnabled);
      setCodexMcpTools(v.codexMcpTools);
      setCodexMcpProjectRoot(v.codexMcpProjectRoot);
      setAgyHooksSelection(v.agyHooks);
      setExtraMcpTargetIds(v.extraMcpTargetIds);
      setInstallStatusline(v.installStatusline);
      setStatuslineTheme(v.statuslineTheme);
      setBackupClaudeMd(v.backupClaudeMd);
      setBackupAll(v.backupAll);
      showProfileMessage(`✓ Loaded profile: ${profiles[0].name}`);
    } catch (err) {
      showProfileMessage(`✗ Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showProfileMessage]);

  return {
    // Navigation
    step, setStep, isSubcommand, resolvedInitialStep,
    mode, setMode,

    // Config state
    enabledSteps, selectedComponentIds, setSelectedComponentIds,
    claudeHooksSelection, setClaudeHooksSelection,
    mcpEnabled, setMcpEnabled, mcpTools, setMcpTools, mcpProjectRoot, setMcpProjectRoot,
    codexHooksSelection, setCodexHooksSelection,
    codexMcpEnabled, setCodexMcpEnabled, codexMcpTools, setCodexMcpTools,
    codexMcpProjectRoot, setCodexMcpProjectRoot,
    agyHooksSelection, setAgyHooksSelection,
    extraMcpTargetIds, setExtraMcpTargetIds,
    installStatusline, setInstallStatusline,
    statuslineTheme, setStatuslineTheme, statuslineDetected,
    backupClaudeMd, setBackupClaudeMd, backupAll, setBackupAll,

    // Derived
    lastManifest, scannedComponents, selectedComponents, fileCount, existingFileCount,
    flowConfig, hubGroups,

    // Result
    result, setResult, profileMessage,

    // Actions
    toggleStep, enterConfig, returnFromConfig,
    handleExport, handleImport,
  };
}
