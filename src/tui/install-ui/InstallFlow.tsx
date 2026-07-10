import React, { useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { C, SYM, SP, Breadcrumb, SectionHeader, wrapCursor, KeyHints } from '../shared/index.js';
import { GroupedHub } from './GroupedHub.js';
import { ComponentGrid } from './ComponentGrid.js';
import { HooksConfig } from './HooksConfig.js';
import { McpConfig } from './McpConfig.js';
import { ExtraMcpConfig } from './ExtraMcpConfig.js';
import { StatuslineConfig } from './StatuslineConfig.js';
import { BackupConfig } from './BackupConfig.js';
import { EmbeddingPanel } from './EmbeddingPanel.js';
import { InstallConfirm } from './InstallConfirm.js';
import { InstallExecution, type InstallFlowResult } from './InstallExecution.js';
import { InstallResult } from './InstallResult.js';
import { useInstallFlowState, type FlowStepCompat } from './useInstallFlowState.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// InstallFlow — thin rendering shell over useInstallFlowState
// ---------------------------------------------------------------------------

export interface InstallFlowProps {
  pkgRoot: string;
  version: string;
  initialStep?: FlowStepCompat;
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
  initialProjectPath?: string;
}

const CONFIG_STEPS = [
  'components_config', 'hooks_config', 'mcp_config',
  'codex_hooks_config', 'codex_mcp_config',
  'agy_hooks_config', 'extra_mcp_config',
  'statusline_config', 'backup_config', 'embedding_config',
];

export function InstallFlow({ pkgRoot, version, initialStep, initialMode, initialStepIds, initialProjectPath }: InstallFlowProps) {
  const { exit } = useApp();
  const s = useInstallFlowState({ pkgRoot, initialStep, initialMode, initialStepIds, initialProjectPath });

  // Global input for config steps
  useInput((_input, key) => {
    if (s.step === 'executing' || s.step === 'complete') return;
    if (s.step === 'platforms') return;

    if (s.step === 'components_config') {
      if (key.escape || key.leftArrow) s.setStep(s.isSubcommand ? 'confirm' : 'hub');
      return;
    }
    if (CONFIG_STEPS.includes(s.step)) {
      if (key.return) s.returnFromConfig();
      else if (key.escape || key.leftArrow) s.setStep(s.isSubcommand ? 'confirm' : 'hub');
      return;
    }
  });

  // Breadcrumb path
  const breadcrumbPath = useMemo((): string[] | null => {
    const hub = t.install.stepMenu;
    switch (s.step) {
      case 'components_config': return [hub, t.install.groupCore, t.install.hubLabelComponents];
      case 'hooks_config': return [hub, t.install.groupHooks, 'Claude Hooks'];
      case 'mcp_config': return [hub, t.install.groupMcp, 'Claude MCP'];
      case 'statusline_config': return [hub, t.install.groupAppearance, t.install.hubLabelStatusline];
      case 'codex_hooks_config': return [hub, t.install.groupHooks, t.install.hubLabelCodexHooks];
      case 'codex_mcp_config': return [hub, t.install.groupMcp, t.install.hubLabelCodexMcp];
      case 'agy_hooks_config': return [hub, t.install.groupHooks, t.install.hubLabelAgyHooks];
      case 'extra_mcp_config': return [hub, t.install.groupMcp, t.install.hubLabelExtraMcp];
      case 'backup_config': return [hub, t.install.groupCore, t.install.hubLabelBackup];
      case 'embedding_config': return [hub, t.install.groupEmbedding, 'Embedding Model'];
      default: return null;
    }
  }, [s.step]);

  // Progress steps
  const progressSteps = s.isSubcommand
    ? [
        { key: s.step.replace('_config', ''), label: s.step.replace('_config', '').charAt(0).toUpperCase() + s.step.replace('_config', '').slice(1) },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ]
    : [
        { key: 'platforms', label: t.install.stepPlatforms ?? 'Platforms' },
        { key: 'hub', label: t.install.stepMenu },
        { key: 'confirm', label: t.install.stepConfirm },
        { key: 'executing', label: t.install.stepInstall },
        { key: 'complete', label: t.install.stepDone },
      ];

  const progressKey = CONFIG_STEPS.includes(s.step)
    ? (s.isSubcommand ? s.step.replace('_config', '') : 'hub')
    : s.step;
  const stepIndex = progressSteps.findIndex((ps) => ps.key === progressKey);

  return (
    <Box flexDirection="column" width="100%">
      {/* Header */}
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Gradient name="fruit">
            <BigText text="MAESTRO" font="slick" />
          </Gradient>
        </Box>
        <Box marginTop={-1} marginLeft={2} gap={2}>
          <Text dimColor>flow</Text>
          <Text dimColor>·</Text>
          <Text dimColor>{t.install.headerVersion.replace('{version}', version)}</Text>
        </Box>
        <Box marginTop={1} gap={1}>
          {progressSteps.map((ps, i) => (
            <Text
              key={ps.key}
              bold={ps.key === progressKey}
              color={i < stepIndex ? C.success : ps.key === progressKey ? C.primary : C.neutral}
            >
              {i < stepIndex ? SYM.stepDone : ps.key === progressKey ? SYM.stepActive : SYM.stepPending} {ps.label}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} marginTop={1}>
        {breadcrumbPath && (
          <Box marginBottom={1}>
            <Breadcrumb path={breadcrumbPath} />
          </Box>
        )}

        {s.step === 'platforms' && (
          <PlatformSelector
            selectedPlatforms={s.selectedPlatforms}
            onToggle={s.togglePlatform}
            mode={s.mode}
            onModeChange={s.setMode}
            onNext={() => s.setStep('hub')}
            onExit={() => exit()}
            codexDedupeAgents={s.codexDedupeAgents}
            onDedupeChange={s.setCodexDedupeAgents}
            pluginClaude={s.enabledSteps.pluginClaude}
            pluginCodex={s.enabledSteps.pluginCodex}
            onPluginToggle={(id) => s.toggleStep(id)}
          />
        )}

        {s.step === 'hub' && (
          <>
            <GroupedHub
              groups={s.hubGroups}
              mode={s.mode}
              onModeChange={s.setMode}
              onToggle={s.toggleStep}
              onEnter={s.enterConfig}
              onInstall={() => s.setStep('confirm')}
              onExport={s.handleExport}
              onImport={s.handleImport}
              onExit={() => s.isSubcommand ? exit() : s.setStep('platforms')}
              lastInstallDate={s.lastManifest?.installedAt?.split('T')[0]}
            />
            {s.profileMessage && (
              <Box marginTop={1}>
                <Text color={s.profileMessage.startsWith('✓') ? C.success : s.profileMessage.startsWith('✗') ? C.error : C.warning}>
                  {s.profileMessage}
                </Text>
              </Box>
            )}
          </>
        )}

        {s.step === 'components_config' && (
          <ComponentGrid
            components={s.scannedComponents}
            selectedIds={s.selectedComponentIds}
            onSelectionChange={s.setSelectedComponentIds}
            onDone={s.returnFromConfig}
          />
        )}

        {s.step === 'hooks_config' && (
          <HooksConfig selection={s.claudeHooksSelection} onSelectionChange={s.setClaudeHooksSelection} tool="claude" />
        )}

        {s.step === 'mcp_config' && (
          <McpConfig
            enabled={s.mcpEnabled} tools={s.mcpTools} projectRoot={s.mcpProjectRoot} mode={s.mode}
            onEnableChange={s.setMcpEnabled} onToolsChange={s.setMcpTools} onRootChange={s.setMcpProjectRoot}
          />
        )}

        {s.step === 'codex_hooks_config' && (
          <HooksConfig
            selection={s.codexHooksSelection} onSelectionChange={s.setCodexHooksSelection}
            tool="codex" title="Codex Hooks" descriptions={t.install.codexHooksLevelDescriptions}
          />
        )}

        {s.step === 'codex_mcp_config' && (
          <McpConfig
            enabled={s.codexMcpEnabled} tools={s.codexMcpTools} projectRoot={s.codexMcpProjectRoot} mode={s.mode}
            onEnableChange={s.setCodexMcpEnabled} onToolsChange={s.setCodexMcpTools} onRootChange={s.setCodexMcpProjectRoot}
          />
        )}

        {s.step === 'agy_hooks_config' && (
          <HooksConfig
            selection={s.agyHooksSelection} onSelectionChange={s.setAgyHooksSelection}
            tool="agy" title="Agy (Antigravity) Hooks" descriptions={t.install.agyHooksLevelDescriptions}
          />
        )}

        {s.step === 'extra_mcp_config' && (
          <ExtraMcpConfig
            mode={s.mode} selectedIds={s.extraMcpTargetIds}
            onSelectionChange={s.setExtraMcpTargetIds}
            onDone={s.returnFromConfig}
            onBack={() => s.setStep(s.isSubcommand ? 'confirm' : 'hub')}
          />
        )}

        {s.step === 'statusline_config' && (
          <StatuslineConfig
            enabled={s.installStatusline} theme={s.statuslineTheme} detected={s.statuslineDetected}
            onToggle={s.setInstallStatusline} onThemeChange={s.setStatuslineTheme}
          />
        )}

        {s.step === 'backup_config' && (
          <BackupConfig
            backupClaudeMd={s.backupClaudeMd} backupAll={s.backupAll} existingFileCount={s.existingFileCount}
            onClaudeMdChange={s.setBackupClaudeMd} onAllChange={s.setBackupAll}
          />
        )}

        {s.step === 'embedding_config' && (
          <EmbeddingPanel onDone={s.returnFromConfig} />
        )}

        {s.step === 'confirm' && (
          <InstallConfirm
            config={s.flowConfig}
            onConfirm={() => s.setStep('executing')}
            onBack={() => s.setStep(s.isSubcommand ? (s.resolvedInitialStep ?? 'hub') : 'hub')}
          />
        )}

        {s.step === 'executing' && (
          <InstallExecution
            config={s.flowConfig} pkgRoot={pkgRoot} version={version}
            onComplete={(r) => { s.setResult(r); s.setStep('complete'); }}
          />
        )}

        {s.step === 'complete' && s.result && (
          <InstallResult result={s.result} />
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PlatformSelector — first step: choose which platforms to install
// ---------------------------------------------------------------------------

const PLATFORM_DEFS = [
  { id: 'claude',          label: 'Claude Code',        desc: 'Commands, skills, agents, hooks, MCP' },
  { id: 'codex',           label: 'Codex',              desc: 'Agents, skills, hooks, MCP' },
  { id: 'cursor',          label: 'Cursor',             desc: 'Skills, agents → .cursor/' },
  { id: 'agy',             label: 'Agy (Gemini CLI)',   desc: 'Skills, agents, hooks → .gemini/' },
  { id: 'copilot',         label: 'GitHub Copilot',     desc: 'Skills, agents → .github/' },
  { id: 'kiro',            label: 'Kiro',               desc: 'Skills, agents → .kiro/' },
  { id: 'opencode',        label: 'OpenCode',           desc: 'Skills, agents → .opencode/' },
  { id: 'kilo',            label: 'Kilo Code',          desc: 'Skills, agents → .kilocode/' },
  { id: 'devin',           label: 'Devin',              desc: 'Skills, agents → .devin/' },
  { id: 'qoder',           label: 'Qoder',              desc: 'Skills, agents → .qoder/' },
  { id: 'codebuddy',       label: 'CodeBuddy',          desc: 'Skills, agents → .codebuddy/' },
  { id: 'droid',           label: 'Droid',              desc: 'Skills, agents → .factory/' },
  { id: 'pi',              label: 'Pi Agent',           desc: 'Skills, agents → .pi/' },
  { id: 'trae',            label: 'Trae',               desc: 'Skills, agents → .trae/' },
  { id: 'roo',             label: 'Roo Code',           desc: 'Skills, agents → .roo/' },
  { id: 'aider-desk',      label: 'AiderDesk',          desc: 'Skills, agents → .aider-desk/' },
  { id: 'amp',             label: 'Amp',                desc: 'Skills, agents → .amp/' },
  { id: 'antigravity',     label: 'Antigravity',        desc: 'Skills, agents → .antigravity/' },
  { id: 'antigravity-cli', label: 'Antigravity CLI',    desc: 'Skills, agents → .antigravity-cli/' },
  { id: 'astrbot',         label: 'AstrBot',            desc: 'Skills, agents → .astrbot/' },
  { id: 'autohand-code',   label: 'Autohand Code CLI',  desc: 'Skills, agents → .autohand/' },
  { id: 'augment',         label: 'Augment',            desc: 'Skills, agents → .augment/' },
  { id: 'bob',             label: 'IBM Bob',            desc: 'Skills, agents → .bob/' },
  { id: 'cline',           label: 'Cline',              desc: 'Skills, agents → .cline/' },
  { id: 'codearts-agent',  label: 'CodeArts Agent',     desc: 'Skills, agents → .codeartsdoer/' },
  { id: 'codemaker',       label: 'Codemaker',          desc: 'Skills, agents → .codemaker/' },
  { id: 'codestudio',      label: 'Code Studio',        desc: 'Skills, agents → .codestudio/' },
  { id: 'command-code',    label: 'Command Code',       desc: 'Skills, agents → .commandcode/' },
  { id: 'continue',        label: 'Continue',           desc: 'Skills, agents → .continue/' },
  { id: 'cortex',          label: 'Cortex Code',        desc: 'Skills, agents → .cortex/' },
  { id: 'crush',           label: 'Crush',              desc: 'Skills, agents → .crush/' },
  { id: 'deepagents',      label: 'Deep Agents',        desc: 'Skills, agents → .deepagents/' },
  { id: 'dexto',           label: 'Dexto',              desc: 'Skills, agents → .dexto/' },
  { id: 'eve',             label: 'Eve',                desc: 'Skills, agents → agent/' },
  { id: 'firebender',      label: 'Firebender',         desc: 'Skills, agents → .firebender/' },
  { id: 'forgecode',       label: 'ForgeCode',          desc: 'Skills, agents → .forge/' },
  { id: 'goose',           label: 'Goose',              desc: 'Skills, agents → .goose/' },
  { id: 'hermes-agent',    label: 'Hermes Agent',       desc: 'Skills, agents → .hermes/' },
  { id: 'inference-sh',    label: 'inference.sh',       desc: 'Skills, agents → .inferencesh/' },
  { id: 'jazz',            label: 'Jazz',               desc: 'Skills, agents → .jazz/' },
  { id: 'junie',           label: 'Junie',              desc: 'Skills, agents → .junie/' },
  { id: 'iflow-cli',       label: 'iFlow CLI',          desc: 'Skills, agents → .iflow/' },
  { id: 'kimi-code-cli',   label: 'Kimi Code CLI',      desc: 'Skills, agents → .kimi-code-cli/' },
  { id: 'kode',            label: 'Kode',               desc: 'Skills, agents → .kode/' },
  { id: 'lingma',          label: 'Lingma',             desc: 'Skills, agents → .lingma/' },
  { id: 'loaf',            label: 'Loaf',               desc: 'Skills, agents → .loaf/' },
  { id: 'mcpjam',          label: 'MCPJam',             desc: 'Skills, agents → .mcpjam/' },
  { id: 'mistral-vibe',    label: 'Mistral Vibe',       desc: 'Skills, agents → .vibe/' },
  { id: 'moxby',           label: 'Moxby',              desc: 'Skills, agents → .moxby/' },
  { id: 'mux',             label: 'Mux',                desc: 'Skills, agents → .mux/' },
  { id: 'openhands',       label: 'OpenHands',          desc: 'Skills, agents → .openhands/' },
  { id: 'ona',             label: 'Ona',                desc: 'Skills, agents → .ona/' },
  { id: 'qoder-cn',        label: 'Qoder CN',           desc: 'Skills, agents → .qoder/' },
  { id: 'qwen-code',       label: 'Qwen Code',          desc: 'Skills, agents → .qwen/' },
  { id: 'replit',          label: 'Replit',             desc: 'Skills, agents → .replit/' },
  { id: 'reasonix',        label: 'Reasonix',           desc: 'Skills, agents → .reasonix/' },
  { id: 'rovodev',         label: 'Rovo Dev',           desc: 'Skills, agents → .rovodev/' },
  { id: 'tabnine-cli',     label: 'Tabnine CLI',        desc: 'Skills, agents → .tabnine/' },
  { id: 'terramind',       label: 'Terramind',          desc: 'Skills, agents → .terramind/' },
  { id: 'tinycloud',       label: 'Tinycloud',          desc: 'Skills, agents → .tinycloud/' },
  { id: 'trae-cn',         label: 'Trae CN',            desc: 'Skills, agents → .trae/' },
  { id: 'warp',            label: 'Warp',               desc: 'Skills, agents → .warp/' },
  { id: 'windsurf',        label: 'Windsurf',           desc: 'Skills, agents → .windsurf/' },
  { id: 'zed',             label: 'Zed',                desc: 'Skills, agents → .zed/' },
  { id: 'zencoder',        label: 'Zencoder',           desc: 'Skills, agents → .zencoder/' },
  { id: 'zenflow',         label: 'Zenflow',            desc: 'Skills, agents → .zencoder/' },
  { id: 'neovate',         label: 'Neovate',            desc: 'Skills, agents → .neovate/' },
  { id: 'pochi',           label: 'Pochi',              desc: 'Skills, agents → .pochi/' },
  { id: 'promptscript',    label: 'PromptScript',       desc: 'Skills, agents → .promptscript/' },
  { id: 'adal',            label: 'AdaL',               desc: 'Skills, agents → .adal/' },
  { id: 'agents-standard', label: 'Open Standard',      desc: '.agents/ format (portable)' },
] as const;

interface FlatRow {
  type: 'platform' | 'plugin' | 'dedupe';
  id: string;
  platIdx?: number;
}

function PlatformSelector({
  selectedPlatforms, onToggle, mode, onModeChange, onNext, onExit,
  codexDedupeAgents, onDedupeChange,
  pluginClaude, pluginCodex, onPluginToggle,
}: {
  selectedPlatforms: Set<string>;
  onToggle: (id: string) => void;
  mode: 'global' | 'project';
  onModeChange: (m: 'global' | 'project') => void;
  onNext: () => void;
  onExit: () => void;
  codexDedupeAgents: boolean;
  onDedupeChange: (v: boolean) => void;
  pluginClaude: boolean;
  pluginCodex: boolean;
  onPluginToggle: (id: string) => void;
}) {
  const showDedupe = selectedPlatforms.has('codex') && selectedPlatforms.has('agents-standard');

  const rows = React.useMemo(() => {
    const r: FlatRow[] = [];
    for (let i = 0; i < PLATFORM_DEFS.length; i++) {
      const plat = PLATFORM_DEFS[i];
      r.push({ type: 'platform', id: plat.id, platIdx: i });
      if (plat.id === 'claude' && selectedPlatforms.has('claude')) {
        r.push({ type: 'plugin', id: 'pluginClaude' });
      }
      if (plat.id === 'codex' && selectedPlatforms.has('codex')) {
        r.push({ type: 'plugin', id: 'pluginCodex' });
      }
    }
    if (showDedupe) r.push({ type: 'dedupe', id: 'dedupe' });
    return r;
  }, [selectedPlatforms, showDedupe]);

  const [cursor, setCursor] = React.useState(0);
  const safeCursor = Math.min(cursor, rows.length - 1);

  useInput((input, key) => {
    if (key.upArrow) setCursor(i => wrapCursor(Math.min(i, rows.length - 1), -1, rows.length));
    else if (key.downArrow) setCursor(i => wrapCursor(Math.min(i, rows.length - 1), 1, rows.length));
    else if (input === ' ') {
      const row = rows[safeCursor];
      if (!row) return;
      if (row.type === 'platform') onToggle(row.id);
      else if (row.type === 'plugin') onPluginToggle(row.id);
      else if (row.type === 'dedupe') onDedupeChange(!codexDedupeAgents);
    } else if (key.return) onNext();
    else if (key.escape) onExit();
    else if (input === 'g' || input === 'G') onModeChange('global');
    else if (input === 'p' || input === 'P') onModeChange('project');
    else {
      const n = parseInt(input, 10);
      if (n >= 1 && n <= Math.min(9, PLATFORM_DEFS.length)) onToggle(PLATFORM_DEFS[n - 1].id);
    }
  });

  const isPlugin = (id: string) => id === 'pluginClaude' ? pluginClaude : pluginCodex;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color={C.primary}>{t.install.hubScope}</Text>
        <Text color={mode === 'global' ? C.success : C.neutral} bold={mode === 'global'}>
          {mode === 'global' ? SYM.radioOn : SYM.radioOff} {t.install.hubGlobal}
        </Text>
        <Text color={mode === 'project' ? C.success : C.neutral} bold={mode === 'project'}>
          {mode === 'project' ? SYM.radioOn : SYM.radioOff} {t.install.hubProject}
        </Text>
        <Text dimColor>[g/p]</Text>
      </Box>

      <SectionHeader title={t.install.groupPlatforms ?? 'Platforms'} />
      <Box flexDirection="column" marginTop={SP.sectionGap}>
        {rows.map((row, idx) => {
          const hl = idx === safeCursor;
          if (row.type === 'platform') {
            const plat = PLATFORM_DEFS[row.platIdx!];
            const sel = selectedPlatforms.has(plat.id);
            return (
              <Box key={row.id}>
                <Text color={hl ? C.primary : C.neutral}>{row.platIdx! < 9 ? `[${row.platIdx! + 1}] ` : '    '}</Text>
                <Text color={sel ? (hl ? C.successBright : C.success) : C.neutral}>{sel ? SYM.checkOn : SYM.checkOff} </Text>
                <Text color={hl ? C.primary : undefined} bold={hl}>{plat.label.padEnd(22)}</Text>
                <Text color={C.neutral}>{plat.desc}</Text>
              </Box>
            );
          }
          if (row.type === 'plugin') {
            const plugin = isPlugin(row.id);
            return (
              <Box key={row.id}>
                <Text color={hl ? C.primary : C.neutral}>{'      '}</Text>
                <Text color={!plugin ? (hl ? C.successBright : C.success) : C.neutral}>{!plugin ? SYM.radioOn : SYM.radioOff} </Text>
                <Text color={hl ? C.primary : undefined}>Copy files  </Text>
                <Text color={plugin ? (hl ? C.successBright : C.success) : C.neutral}>{plugin ? SYM.radioOn : SYM.radioOff} </Text>
                <Text color={hl ? C.primary : undefined}>Native plugin</Text>
              </Box>
            );
          }
          // dedupe
          return (
            <Box key={row.id} marginTop={1}>
              <Text color={hl ? C.primary : C.neutral}>    </Text>
              <Text color={codexDedupeAgents ? (hl ? C.successBright : C.success) : C.neutral}>
                {codexDedupeAgents ? SYM.checkOn : SYM.checkOff}{' '}
              </Text>
              <Text color={hl ? C.primary : undefined} bold={hl}>
                {'Codex: disable .agents/ skills'.padEnd(22)}
              </Text>
              <Text color={C.neutral}>avoid duplicate skill discovery</Text>
            </Box>
          );
        })}
      </Box>
      <KeyHints hints={`[Space/1-9] Toggle  [Up/Down] Navigate  [g/p] Scope  [Enter] Next  [Esc] Exit`} />
    </Box>
  );
}
