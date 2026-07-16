// ---------------------------------------------------------------------------
// useInstallFlowState — extracted state management for InstallFlow
//
// Groups 20+ useState into a single hook. InstallFlow becomes a thin renderer.
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { HooksSelection } from './HooksConfig.js';
import type { InstallFlowConfig } from './types.js';
import type { InstallFlowResult } from './InstallExecution.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { scanComponents, countExistingTargetFiles, MCP_TOOLS, COMPONENT_DEFS, migrateComponentIds, type ExtraMcpTargetId, type ComponentDef } from '../../commands/install-backend.js';
import { detectStatusline, getHooksForLevel, getAllHookNames, type HookLevel } from '../../commands/hooks.js';
import { findManifest, type Manifest } from '../../core/manifest.js';
import { exportProfile, importProfile, listProfiles, configToProfile, profileToStateValues } from '../../core/install-profile.js';
import { paths } from '../../config/paths.js';
import { buildGroupedHubItems } from './GroupedHub.js';

export type FlowStep =
  | 'platforms' | 'hub'
  | 'components_config' | 'hooks_config' | 'mcp_config'
  | 'codex_hooks_config' | 'codex_mcp_config'
  | 'agy_hooks_config' | 'extra_mcp_config'
  | 'statusline_config' | 'backup_config' | 'embedding_config'
  | 'confirm' | 'executing' | 'complete';

export type FlowStepCompat = FlowStep | 'mode';

function isEmbeddingReady(): boolean {
  if (existsSync(join(homedir(), '.maestro', 'api-embedding.json'))) return true;
  try {
    const { createRequire } = require('node:module');
    const localRequire = createRequire(import.meta.url);
    const tjsMain = localRequire.resolve('@huggingface/transformers');
    const normalized = tjsMain.replace(/\\/g, '/');
    const idx = normalized.indexOf('@huggingface/transformers');
    if (idx >= 0) {
      const root = tjsMain.slice(0, idx + '@huggingface/transformers'.length);
      return existsSync(join(root, '.cache', 'Xenova', 'multilingual-e5-small', 'onnx', 'model.onnx'));
    }
  } catch { /* ignore */ }
  return false;
}

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
  initialProjectPath?: string;
}

export function useInstallFlowState(opts: UseInstallFlowStateOptions) {
  const { pkgRoot, initialStep, initialMode, initialStepIds, initialProjectPath } = opts;
  const isSubcommand = !!initialStep;
  const shouldInstallComponents = !initialStepIds || initialStepIds.includes('components');
  const resolvedInitialStep: FlowStep = (initialStep === 'mode' || !initialStep) ? 'platforms' : initialStep as FlowStep;

  // --- Core navigation ---
  const [step, setStep] = useState<FlowStep>(resolvedInitialStep);
  const [mode, setMode] = useState<'global' | 'project'>(initialMode ?? (initialProjectPath ? 'project' : 'global'));
  const [projectPath] = useState(initialProjectPath ?? process.cwd());

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
    hooks: initialStepIds ? initialStepIds.includes('hooks') : (lastManifest ? prior.claudeHooks : true),
    mcp: initialStepIds ? initialStepIds.includes('mcp') : (lastManifest ? prior.claudeMcp : true),
    codexHooks: initialStepIds ? initialStepIds.includes('codexHooks') : prior.codexHooks,
    codexMcp: initialStepIds ? initialStepIds.includes('codexMcp') : prior.codexMcp,
    agyHooks: initialStepIds ? initialStepIds.includes('agyHooks') : prior.agyHooks,
    extraMcp: initialStepIds ? initialStepIds.includes('extraMcp') : prior.extraMcp,
    statusline: initialStepIds ? initialStepIds.includes('statusline') : prior.statusline,
    backup: initialStepIds ? initialStepIds.includes('backup') : true,
    pluginClaude: initialStepIds ? initialStepIds.includes('pluginClaude') : false,
    pluginCodex: initialStepIds ? initialStepIds.includes('pluginCodex') : false,
  });

  // --- Platform selection ---
  type Platform = string;
  const ALL_PLATFORMS: Platform[] = [
    'claude', 'codex', 'agy', 'agents-standard',
    'cursor', 'opencode', 'kiro', 'kilo', 'copilot',
    'devin', 'qoder', 'codebuddy', 'droid', 'pi',
    'trae', 'roo',
    'aider-desk', 'amp', 'antigravity', 'antigravity-cli', 'astrbot',
    'autohand-code', 'augment', 'bob', 'cline', 'codearts-agent',
    'codemaker', 'codestudio', 'command-code', 'continue', 'cortex',
    'crush', 'deepagents', 'dexto', 'eve', 'firebender',
    'forgecode', 'goose', 'hermes-agent', 'inference-sh', 'jazz',
    'junie', 'iflow-cli', 'kimi-code-cli', 'kode', 'lingma',
    'loaf', 'mcpjam', 'mistral-vibe', 'moxby', 'mux',
    'openhands', 'ona', 'qwen-code', 'replit',
    'reasonix', 'rovodev', 'tabnine-cli', 'terramind', 'tinycloud',
    'warp', 'windsurf', 'zed', 'zencoder',
    'neovate', 'pochi', 'promptscript', 'adal',
  ];

  // Fallback: infer previously installed platforms from on-disk artifacts
  // when manifest is missing. Only activates if ~/.maestro/version.json exists
  // (proof that Maestro was installed before), so non-Maestro files won't
  // cause false positives.
  const inferPlatformsFromDisk = useCallback((scope: 'global' | 'project', projPath: string): Set<Platform> => {
    if (!existsSync(join(paths.home, 'version.json'))) return new Set<Platform>(['claude']);
    const base = scope === 'global' ? homedir() : projPath;
    const plats = new Set<Platform>();
    if (existsSync(join(base, '.claude'))) plats.add('claude');
    if (existsSync(join(base, '.codex', 'agents')) || existsSync(join(base, '.codex', 'skills'))) plats.add('codex');
    if (scope === 'global'
      ? existsSync(join(base, '.gemini', 'antigravity-cli'))
      : existsSync(join(base, '.agents', 'skills'))) plats.add('agy');
    if (existsSync(join(base, '.agents', 'agents')) || existsSync(join(base, '.agents', 'skills'))) plats.add('agents-standard');
    const extraPlatDirs: [string, string][] = [
      ['cursor', '.cursor'], ['opencode', '.opencode'], ['kiro', '.kiro'],
      ['kilo', '.kilocode'], ['copilot', '.github'], ['devin', '.devin'],
      ['qoder', '.qoder'], ['codebuddy', '.codebuddy'], ['droid', '.factory'], ['pi', '.pi'],
      ['trae', '.trae'], ['roo', '.roo'],
      ['aider-desk', '.aider-desk'], ['amp', '.amp'], ['antigravity', '.antigravity'],
      ['antigravity-cli', '.antigravity-cli'], ['astrbot', '.astrbot'], ['autohand-code', '.autohand'],
      ['augment', '.augment'], ['bob', '.bob'], ['cline', '.cline'],
      ['codearts-agent', '.codeartsdoer'], ['codemaker', '.codemaker'], ['codestudio', '.codestudio'],
      ['command-code', '.commandcode'], ['continue', '.continue'], ['cortex', '.cortex'],
      ['crush', '.crush'], ['deepagents', '.deepagents'], ['dexto', '.dexto'],
      ['eve', 'agent'], ['firebender', '.firebender'], ['forgecode', '.forge'],
      ['goose', '.goose'], ['hermes-agent', '.hermes'], ['inference-sh', '.inferencesh'],
      ['jazz', '.jazz'], ['junie', '.junie'], ['iflow-cli', '.iflow'],
      ['kimi-code-cli', '.kimi-code-cli'], ['kode', '.kode'], ['lingma', '.lingma'],
      ['loaf', '.loaf'], ['mcpjam', '.mcpjam'], ['mistral-vibe', '.vibe'],
      ['moxby', '.moxby'], ['mux', '.mux'], ['openhands', '.openhands'],
      ['ona', '.ona'], ['qwen-code', '.qwen'],
      ['replit', '.replit'], ['reasonix', '.reasonix'], ['rovodev', '.rovodev'],
      ['tabnine-cli', '.tabnine'], ['terramind', '.terramind'], ['tinycloud', '.tinycloud'],
      ['warp', '.warp'], ['windsurf', '.windsurf'],
      ['zed', '.zed'], ['zencoder', '.zencoder'],
      ['neovate', '.neovate'], ['pochi', '.pochi'], ['promptscript', '.promptscript'],
      ['adal', '.adal'],
    ];

    for (const [id, dir] of extraPlatDirs) {
      if (id === 'trae') {
        const hasLocal = existsSync(join(base, '.trae', 'skills')) || existsSync(join(base, '.trae', 'agents'));
        const hasGlobalCN = scope === 'global' && (existsSync(join(base, '.trae-cn', 'skills')) || existsSync(join(base, '.trae-cn', 'agents')));
        if (hasLocal || hasGlobalCN) plats.add(id);
      } else if (id === 'qoder') {
        const hasLocal = existsSync(join(base, '.qoder', 'skills')) || existsSync(join(base, '.qoder', 'agents'));
        const hasGlobalCN = scope === 'global' && (existsSync(join(base, '.qoder-cn', 'skills')) || existsSync(join(base, '.qoder-cn', 'agents')));
        if (hasLocal || hasGlobalCN) plats.add(id);
      } else {
        if (existsSync(join(base, dir, 'skills')) || existsSync(join(base, dir, 'agents'))) plats.add(id);
      }
    }
    if (plats.size === 0) plats.add('claude');
    return plats;
  }, []);

  const inferPlatformsFromManifest = useCallback((m: Manifest | null): Set<Platform> => {
    if (!m?.selectedComponentIds?.length) return new Set<Platform>(['claude']);
    const ids = new Set(m.selectedComponentIds);
    const plats = new Set<Platform>();
    for (const def of COMPONENT_DEFS) {
      if (def.platform && def.platform !== 'shared' && ids.has(def.id)) {
        plats.add(def.platform as Platform);
      }
    }
    if (plats.size === 0) plats.add('claude');
    return plats;
  }, []);

  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    () => lastManifest
      ? inferPlatformsFromManifest(lastManifest)
      : inferPlatformsFromDisk(mode, projectPath),
  );
  // Preserve the exact manifest/profile selection until the user explicitly
  // changes a platform/addon toggle. Platform inference is for presentation;
  // it must not silently expand a partial historical selection.
  const [preservedComponentIds, setPreservedComponentIds] = useState<Set<string> | null>(
    () => lastManifest?.selectedComponentIds !== undefined
      ? new Set(migrateComponentIds(lastManifest.selectedComponentIds))
      : null,
  );

  const togglePlatform = useCallback((plat: string) => {
    setPreservedComponentIds(null);
    setSelectedPlatforms(prev => {
      const next = new Set(prev);
      const p = plat as Platform;
      if (next.has(p)) {
        if (next.size > 1) next.delete(p);
      } else {
        next.add(p);
      }
      return next;
    });
  }, []);

  // --- Chinese response toggle (one switch → all selected platforms) ---
  const CHINESE_IDS = useMemo(() => new Set(
    COMPONENT_DEFS.filter(d => d.id.endsWith('-chinese')).map(d => d.id),
  ), []);
  const [chineseEnabled, setChineseEnabled] = useState<boolean>(() => {
    if (lastManifest?.selectedComponentIds === undefined) return true;
    return lastManifest.selectedComponentIds.some(id => id.endsWith('-chinese'));
  });

  // --- Addon IDs (optional user-selectable skill packs, excluding chinese) ---
  const ADDON_IDS = useMemo(() => new Set(
    COMPONENT_DEFS.filter(d => d.defaultSelected === false && !CHINESE_IDS.has(d.id)).map(d => d.id),
  ), [CHINESE_IDS]);

  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(() => {
    if (!lastManifest?.selectedComponentIds?.length) return new Set<string>();
    return new Set(lastManifest.selectedComponentIds.filter(id => ADDON_IDS.has(id)));
  });

  const toggleAddon = useCallback((id: string) => {
    setPreservedComponentIds(null);
    if (id === 'chinese') { setChineseEnabled(v => !v); return; }
    setSelectedAddons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Computed: selectedComponentIds from platforms + chinese + addons ---
  const selectedComponentIds = useMemo(() => {
    const skipFileCopy = (plat: string, def: ComponentDef) =>
      !def.inject && (
        (plat === 'claude' && enabledSteps.pluginClaude) ||
        (plat === 'codex' && enabledSteps.pluginCodex)
      );
    if (preservedComponentIds) {
      return Array.from(preservedComponentIds).filter((id) => {
        const def = COMPONENT_DEFS.find((candidate) => candidate.id === id);
        if (!def) return false;
        const platform = def.platform ?? 'shared';
        return !skipFileCopy(platform, def);
      });
    }
    const ids = new Set<string>();
    for (const def of COMPONENT_DEFS) {
      const plat = def.platform ?? 'shared';
      if (CHINESE_IDS.has(def.id)) continue;
      if (ADDON_IDS.has(def.id)) continue;
      if (plat === 'shared') { ids.add(def.id); continue; }
      if (selectedPlatforms.has(plat as Platform)) {
        if (skipFileCopy(plat, def)) continue;
        ids.add(def.id);
      }
    }
    if (chineseEnabled) {
      for (const cid of CHINESE_IDS) {
        const def = COMPONENT_DEFS.find(d => d.id === cid);
        if (!def) continue;
        const plat = def.platform ?? 'shared';
        if (plat === 'shared' || selectedPlatforms.has(plat as Platform)) {
          ids.add(cid);
        }
      }
    }
    for (const addon of selectedAddons) {
      const def = COMPONENT_DEFS.find(d => d.id === addon);
      if (!def) continue;
      const plat = def.platform ?? 'shared';
      if (plat === 'shared' || selectedPlatforms.has(plat as Platform)) {
        if (skipFileCopy(plat, def)) continue;
        ids.add(addon);
      }
    }
    return Array.from(ids);
  }, [preservedComponentIds, selectedPlatforms, chineseEnabled, selectedAddons, ADDON_IDS, CHINESE_IDS, enabledSteps.pluginClaude, enabledSteps.pluginCodex]);

  const applyComponentIds = useCallback((ids: string[]) => {
    const migratedIds = migrateComponentIds(ids);
    const idSet = new Set(migratedIds);
    const plats = new Set<Platform>();
    for (const def of COMPONENT_DEFS) {
      if (def.platform && def.platform !== 'shared' && idSet.has(def.id)) {
        plats.add(def.platform as Platform);
      }
    }
    if (plats.size > 0) setSelectedPlatforms(plats);
    setChineseEnabled(migratedIds.some(id => id.endsWith('-chinese')));
    setSelectedAddons(new Set(migratedIds.filter(id => ADDON_IDS.has(id))));
    setPreservedComponentIds(idSet);
  }, [ADDON_IDS]);

  const setSelectedComponentIds = applyComponentIds;

  // --- Codex dedupe: disable .agents/ skills in codex config to avoid duplicates ---
  const [codexDedupeAgents, setCodexDedupeAgents] = useState(true);

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

  // --- Generic platform hooks ---
  const [genericHookLevels, setGenericHookLevels] = useState<Record<string, HookLevel>>(() => {
    const levels: Record<string, HookLevel> = {};
    if (lastManifest?.hooks?.generic) {
      for (const [id, cfg] of Object.entries(lastManifest.hooks.generic as Record<string, { level?: string }>)) {
        levels[id] = (cfg.level as HookLevel) || 'none';
      }
    }
    return levels;
  });

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
    setSelectedPlatforms(lastManifest
      ? inferPlatformsFromManifest(lastManifest)
      : inferPlatformsFromDisk(mode, projectPath));
    setPreservedComponentIds(lastManifest?.selectedComponentIds !== undefined
      ? new Set(migrateComponentIds(lastManifest.selectedComponentIds))
      : null);
    setSelectedAddons(lastManifest?.selectedComponentIds?.length
      ? new Set(lastManifest.selectedComponentIds.filter(id => ADDON_IDS.has(id)))
      : new Set<string>());
    setEnabledSteps({
      hooks: lastManifest ? prior.claudeHooks : true,
      mcp: lastManifest ? prior.claudeMcp : true,
      codexHooks: prior.codexHooks,
      codexMcp: prior.codexMcp,
      agyHooks: prior.agyHooks,
      extraMcp: prior.extraMcp,
      statusline: prior.statusline || !lastManifest,
      backup: true,
      pluginClaude: false,
      pluginCodex: false,
    });
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
    installComponents: shouldInstallComponents,
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
    genericHookLevels,
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
    codexDedupeAgents: selectedPlatforms.has('codex') && selectedPlatforms.has('agents-standard') && codexDedupeAgents,
    installPluginClaude: enabledSteps.pluginClaude,
    installPluginCodex: enabledSteps.pluginCodex,
    configureCodexMultiAgentV2: shouldInstallComponents && selectedComponentIds.some((id) =>
      COMPONENT_DEFS.some((def) => def.id === id && def.platform === 'codex')),
  }), [mode, projectPath, enabledSteps, shouldInstallComponents, hookLevel, selectedComponents.length,
    fileCount, mcpTools, mcpEnabled, selectedComponentIds, mcpProjectRoot,
    codexHookLevel, codexMcpEnabled, codexMcpTools, codexMcpProjectRoot,
    agyHookLevel, extraMcpTargetIds, genericHookLevels,
    installStatusline, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection,
    selectedPlatforms, codexDedupeAgents]);

  // --- Hub groups ---
  const claudeAllHooks = useMemo(() => getAllHookNames('claude'), []);
  const codexAllHooks = useMemo(() => getAllHookNames('codex'), []);
  const agyAllHooks = useMemo(() => getAllHookNames('agy'), []);

  // --- Addon defs for hub display ---
  const addonDefs = useMemo(() =>
    COMPONENT_DEFS.filter(d => ADDON_IDS.has(d.id)).map(d => ({
      id: d.id, label: d.label, description: d.description,
      platform: d.platform ?? 'shared',
    })),
  [ADDON_IDS]);

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
      extraMcpTargetIds: extraMcpTargetIds as string[],
      genericHookLevels,
      statuslineDetected, statuslineTheme,
      backupClaudeMd, backupAll,
      selectedPlatforms: Array.from(selectedPlatforms),
      selectedAddons: Array.from(selectedAddons),
      chineseEnabled,
      addonDefs,
      embeddingMode: existsSync(join(homedir(), '.maestro', 'api-embedding.json')) ? 'api' as const : 'local' as const,
      embeddingCached: isEmbeddingReady(),
    },
  ), [enabledSteps, selectedComponents.length, fileCount, hookLevel, mcpTools.length,
    mcpEnabled, codexHookLevel, codexMcpTools.length, codexMcpEnabled,
    agyHookLevel, extraMcpTargetIds, genericHookLevels,
    statuslineDetected, statuslineTheme, backupClaudeMd, backupAll,
    claudeHooksSelection, codexHooksSelection, agyHooksSelection,
    claudeAllHooks, codexAllHooks, agyAllHooks,
    selectedPlatforms, selectedAddons, chineseEnabled, addonDefs]);

  // --- Actions ---
  const toggleStep = useCallback((id: string) => {
    if (id === 'embedding') return; // config-only item, no toggle
    if (ALL_PLATFORMS.includes(id as Platform)) {
      togglePlatform(id as Platform);
      return;
    }
    if (id === 'chinese' || ADDON_IDS.has(id)) {
      toggleAddon(id);
      return;
    }
    if (id.startsWith('mcp-')) {
      const targetId = id.slice(4) as ExtraMcpTargetId;
      setExtraMcpTargetIds((prev) =>
        prev.includes(targetId) ? prev.filter((x) => x !== targetId) : [...prev, targetId],
      );
      return;
    }
    if (id.startsWith('ghooks-')) {
      const platId = id.slice(7);
      setGenericHookLevels((prev) => ({
        ...prev,
        [platId]: prev[platId] === 'standard' || prev[platId] === 'minimal' ? 'none' : 'standard',
      }));
      return;
    }
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
  }, [togglePlatform, toggleAddon, ADDON_IDS]);

  const enterConfig = useCallback((id: string) => {
    if (id.startsWith('mcp-') || id.startsWith('ghooks-')) return;
    const map: Record<string, FlowStep> = {
      components: 'components_config', hooks: 'hooks_config', mcp: 'mcp_config',
      codexHooks: 'codex_hooks_config', codexMcp: 'codex_mcp_config',
      agyHooks: 'agy_hooks_config', extraMcp: 'extra_mcp_config',
      statusline: 'statusline_config', backup: 'backup_config',
      embedding: 'embedding_config',
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
      setGenericHookLevels(v.genericHookLevels);
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
    selectedPlatforms, togglePlatform, selectedAddons, toggleAddon,
    codexDedupeAgents, setCodexDedupeAgents,
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
