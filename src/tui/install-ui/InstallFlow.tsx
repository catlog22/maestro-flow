import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { C, SYM } from '../shared/index.js';
import { InstallHub, buildHubItems } from './InstallHub.js';
import { ComponentGrid } from './ComponentGrid.js';
import { HooksConfig } from './HooksConfig.js';
import { McpConfig } from './McpConfig.js';
import { ExtraMcpConfig } from './ExtraMcpConfig.js';
import { StatuslineConfig } from './StatuslineConfig.js';
import { BackupConfig } from './BackupConfig.js';
import { InstallConfirm, type InstallFlowConfig } from './InstallConfirm.js';
import { InstallExecution, type InstallFlowResult } from './InstallExecution.js';
import { InstallResult } from './InstallResult.js';
import { scanComponents, countExistingTargetFiles, MCP_TOOLS, COMPONENT_DEFS, type ExtraMcpTargetId } from '../../commands/install-backend.js';
import { detectStatusline, CODEX_HOOK_LEVEL_DESCRIPTIONS, type HookLevel } from '../../commands/hooks.js';
import { findManifest, type Manifest } from '../../core/manifest.js';
import { paths } from '../../config/paths.js';
import { t } from '../../i18n/index.js';
const isCodeGraphAvailable = () => true;

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
  | 'codex_hooks_config' | 'codex_mcp_config'
  | 'agy_hooks_config'
  | 'extra_mcp_config'
  | 'statusline_config' | 'backup_config'
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

  // Load manifest for the *current* scope+target so defaults reflect the
  // installation users are about to overwrite. Falls back to null on first
  // install in this scope (so toggles use fresh-install defaults).
  const lastManifest = useMemo<Manifest | null>(() => {
    try {
      const targetPath = mode === 'global' ? paths.home : projectPath;
      return findManifest(mode, targetPath);
    } catch { return null; }
  }, [mode, projectPath]);

  // Derive "was previously enabled" flags from lastManifest records so the
  // installer remembers user intent across runs. Each section knows whether
  // it was installed last time by checking the relevant manifest field.
  // For statusline, also check actual settings.json — forceInstall writes
  // statusLine but doesn't record it in manifest, so manifest alone misses it.
  const prior = useMemo(() => ({
    claudeHooks: !!(lastManifest?.hooks?.claude?.installed?.length),
    codexHooks: !!(lastManifest?.hooks?.codex?.installed?.length),
    agyHooks: !!(lastManifest?.hooks?.agy?.installed?.length),
    claudeMcp: !!lastManifest?.mcp?.claude,
    codexMcp: !!lastManifest?.mcp?.codex,
    extraMcp: !!(lastManifest?.mcp?.extras?.length),
    statusline: !!lastManifest?.statusline || !!detectStatusline(),
  }), [lastManifest]);

  // Which categories are enabled
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

  // Fine-grained config — default to last manifest selections if available.
  // Fresh install: only components with defaultSelected !== false are pre-selected.
  // Opt-in components (qoder, trae, .agents/, cursor) require explicit toggle.
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(
    () => lastManifest?.selectedComponentIds?.length
      ? lastManifest.selectedComponentIds
      : COMPONENT_DEFS.filter((d) => d.defaultSelected !== false).map((d) => d.id),
  );
  // Only consult `hooks.claude.level` — the legacy top-level `hookLevel`
  // field is unreliable (it may have been written as 'none' when the user
  // skipped Claude hooks last install, which would silently lock the next
  // install's level back to 'none').
  const [hookLevel, setHookLevel] = useState<HookLevel>(
    () => (lastManifest?.hooks?.claude?.level as HookLevel) || 'standard',
  );
  const [mcpEnabled, setMcpEnabled] = useState(true);
  const [mcpTools, setMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [mcpProjectRoot, setMcpProjectRoot] = useState('');

  // Codex config — read level from lastManifest.hooks.codex if present
  const [codexHookLevel, setCodexHookLevel] = useState<HookLevel>(
    () => (lastManifest?.hooks?.codex?.level as HookLevel) || 'standard',
  );
  const [codexMcpEnabled, setCodexMcpEnabled] = useState(true);
  const [codexMcpTools, setCodexMcpTools] = useState<string[]>([...MCP_TOOLS]);
  const [codexMcpProjectRoot, setCodexMcpProjectRoot] = useState('');

  // Agy (Antigravity) hook level — same pattern as codex
  const [agyHookLevel, setAgyHookLevel] = useState<HookLevel>(
    () => (lastManifest?.hooks?.agy?.level as HookLevel) || 'standard',
  );

  // Extra MCP targets — restore last selection if previous install used any
  const [extraMcpTargetIds, setExtraMcpTargetIds] = useState<ExtraMcpTargetId[]>(
    () => (lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? [],
  );

  // Statusline — restore previous on/off + theme. Also default to true on
  // fresh install (no manifest) since statusline is a core feature.
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

  // Backup config
  const [backupClaudeMd, setBackupClaudeMd] = useState(true);
  const [backupAll, setBackupAll] = useState(false);

  const [result, setResult] = useState<InstallFlowResult | null>(null);

  // When user switches mode at the mode step, re-sync every "default-from-prior"
  // state value to the new scope's manifest. Skipped on initial mount (the
  // useState initializers already handled that) and for subcommand flows
  // (where mode is fixed by the caller).
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
    setHookLevel((lastManifest?.hooks?.claude?.level as HookLevel) || 'standard');
    setCodexHookLevel((lastManifest?.hooks?.codex?.level as HookLevel) || 'standard');
    setAgyHookLevel((lastManifest?.hooks?.agy?.level as HookLevel) || 'standard');
    setExtraMcpTargetIds(
      (lastManifest?.mcp?.extras?.map((e) => e.targetId as ExtraMcpTargetId)) ?? [],
    );
    setInstallStatusline(prior.statusline || !lastManifest);
    setStatuslineTheme(lastManifest?.statusline?.theme || 'notion');
  }, [mode, lastManifest, prior, isSubcommand]);

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

  // Count existing target files for backup display
  const existingFileCount = useMemo(
    () => countExistingTargetFiles(selectedComponents),
    [selectedComponents],
  );

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
  }), [mode, projectPath, enabledSteps, hookLevel, selectedComponents.length,
    fileCount, mcpTools, mcpEnabled, selectedComponentIds, mcpProjectRoot,
    codexHookLevel, codexMcpEnabled, codexMcpTools, codexMcpProjectRoot,
    agyHookLevel, extraMcpTargetIds,
    installStatusline, statuslineTheme, backupClaudeMd, backupAll]);

  // Hub items with live summary
  const hubItems = useMemo(() => buildHubItems(
    enabledSteps as { components: boolean; hooks: boolean; mcp: boolean; codexHooks: boolean; codexMcp: boolean; agyHooks: boolean; extraMcp: boolean; statusline: boolean; codegraph: boolean; backup: boolean },
    {
      componentCount: selectedComponents.length,
      fileCount,
      hookLevel,
      mcpToolCount: mcpTools.length,
      mcpEnabled,
      codexHookLevel,
      codexMcpToolCount: codexMcpTools.length,
      codexMcpEnabled,
      agyHookLevel,
      extraMcpTargetCount: extraMcpTargetIds.length,
      statuslineDetected,
      codegraphAvailable: isCodeGraphAvailable(),
      backupClaudeMd,
      backupAll,
    },
  ), [enabledSteps, selectedComponents.length, fileCount, hookLevel, mcpTools.length,
    mcpEnabled, codexHookLevel, codexMcpTools.length, codexMcpEnabled,
    agyHookLevel, extraMcpTargetIds.length,
    statuslineDetected, backupClaudeMd, backupAll]);

  // Toggle category enabled/disabled. When turning a hook step from off→on,
  // promote a stuck 'none' level to 'standard' so the install actually does
  // something — otherwise a "checked but level=none" state silently installs
  // nothing (the execution branch guards on `level !== 'none'`).
  const toggleStep = useCallback((id: string) => {
    setEnabledSteps((prev) => {
      const next = !prev[id];
      if (next) {
        if (id === 'hooks') setHookLevel((lvl) => (lvl === 'none' ? 'standard' : lvl));
        else if (id === 'codexHooks') setCodexHookLevel((lvl) => (lvl === 'none' ? 'standard' : lvl));
        else if (id === 'agyHooks') setAgyHookLevel((lvl) => (lvl === 'none' ? 'standard' : lvl));
      }
      return { ...prev, [id]: next };
    });
  }, []);

  // Hub → enter config
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
    if (step === 'hooks_config' || step === 'mcp_config' || step === 'codex_hooks_config' || step === 'codex_mcp_config' || step === 'agy_hooks_config' || step === 'statusline_config' || step === 'backup_config') {
      if (key.return) returnFromConfig();
      else if (key.escape) setStep(isSubcommand ? 'confirm' : 'hub');
      return;
    }
    // extra_mcp_config has its own keybindings inside ExtraMcpConfig; do not intercept here

    // Confirm: handled by InstallConfirm component
    // Hub, ComponentGrid: handled by their own useInput
  });

  // Progress bar steps
  const progressSteps = isSubcommand
    ? [
        { key: step.replace('_config', '') as string, label: step.replace('_config', '').charAt(0).toUpperCase() + step.replace('_config', '').slice(1) },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ]
    : [
        { key: 'mode', label: t.install.stepMode },
        { key: 'hub', label: t.install.stepMenu },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ];

  // Map current step to progress key
  const progressKey = ['components_config', 'hooks_config', 'mcp_config', 'codex_hooks_config', 'codex_mcp_config', 'agy_hooks_config', 'statusline_config', 'backup_config'].includes(step)
    ? (isSubcommand ? step.replace('_config', '') : 'hub')
    : step;
  const stepIndex = progressSteps.findIndex((s) => s.key === progressKey);

  // Footer
  const footerHints: Partial<Record<FlowStep, string>> = {
    mode: t.install.footerMode,
    hub: t.install.footerHub,
    components_config: t.install.footerComponents,
    hooks_config: t.install.footerHooks,
    mcp_config: t.install.footerMcp,
    codex_hooks_config: t.install.footerHooks,
    codex_mcp_config: t.install.footerMcp,
    agy_hooks_config: t.install.footerHooks,
    statusline_config: t.install.footerStatusline,
    backup_config: t.install.footerBackup,
    confirm: t.install.footerConfirm,
  };

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
        {step === 'mode' && (
          <Box flexDirection="column">
            <Text bold color={C.primary}>{t.install.modeTitle}</Text>
            <Box marginTop={1}>
              <Text color={mode === 'global' ? C.success : C.neutral}>
                {mode === 'global' ? SYM.checkOn : SYM.checkOff} {t.install.modeGlobal}
              </Text>
              <Text>  </Text>
              <Text color={mode === 'project' ? C.success : C.neutral}>
                {mode === 'project' ? SYM.checkOn : SYM.checkOff} {t.install.modeProject}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                {mode === 'global'
                  ? t.install.modeGlobalDesc
                  : t.install.modeProjectDesc.replace('{path}', projectPath)}
              </Text>
            </Box>
            {lastManifest && (
              <Box marginTop={1}>
                <Text color={C.warning}>
                  Defaults loaded from last install ({lastManifest.installedAt.split('T')[0]})
                </Text>
              </Box>
            )}
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

        {step === 'codex_hooks_config' && (
          <HooksConfig
            level={codexHookLevel}
            onLevelChange={setCodexHookLevel}
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
            level={agyHookLevel}
            onLevelChange={setAgyHookLevel}
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
