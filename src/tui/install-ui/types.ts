// ---------------------------------------------------------------------------
// Types for install TUI — shared data contracts
// ---------------------------------------------------------------------------

import type { HookLevel } from '../../commands/hooks.js';
import type { ExtraMcpTargetId } from '../../commands/install-backend.js';
import type { HooksSelection } from './HooksConfig.js';

// ---------------------------------------------------------------------------
// InstallFlowConfig — central data contract for the install pipeline
// ---------------------------------------------------------------------------

export interface InstallFlowConfig {
  mode: 'global' | 'project';
  projectPath: string;
  installComponents: boolean;
  installHooks: boolean;
  installMcp: boolean;
  installCodexHooks: boolean;
  codexHookLevel: HookLevel;
  installCodexMcp: boolean;
  codexMcpTools: string[];
  codexMcpProjectRoot: string;
  installAgyHooks: boolean;
  agyHookLevel: HookLevel;
  installExtraMcp: boolean;
  extraMcpTargetIds: ExtraMcpTargetId[];
  genericHookLevels: Record<string, HookLevel>;
  installStatusline: boolean;
  statuslineTheme: string;
  hookLevel: HookLevel;
  componentCount: number;
  fileCount: number;
  mcpToolCount: number;
  selectedComponentIds: string[];
  mcpTools: string[];
  mcpProjectRoot: string;
  backupClaudeMd: boolean;
  backupAll: boolean;
  claudeHooksSelection?: HooksSelection;
  codexHooksSelection?: HooksSelection;
  agyHooksSelection?: HooksSelection;
  codexDedupeAgents?: boolean;
  installPluginClaude?: boolean;
  installPluginCodex?: boolean;
  configureCodexMultiAgentV2?: boolean;
  /** Subsystems explicitly disabled by a non-interactive/profile install. */
  explicitlyDisabled?: {
    claudeHooks?: boolean;
    claudeMcp?: boolean;
    codexHooks?: boolean;
    codexMcp?: boolean;
    agyHooks?: boolean;
    genericHooks?: string[];
    extraMcp?: boolean;
    statusline?: boolean;
    pluginClaude?: boolean;
    pluginCodex?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Legacy wizard types (CyberdeckBlueprint)
// ---------------------------------------------------------------------------

export type WizardStep = 'mode' | 'components' | 'config' | 'review' | 'executing' | 'complete';

export const WIZARD_STEPS: readonly WizardStep[] = [
  'mode',
  'components',
  'config',
  'review',
  'executing',
  'complete',
];

export interface InstallConfig {
  mode: 'global' | 'project';
  projectPath: string;
  selectedIds: string[];
  mcpEnabled: boolean;
  mcpTools: string[];
  mcpProjectRoot: string;
  hookLevel: 'none' | 'minimal' | 'standard' | 'full';
  /** Granular hook selection (overrides hookLevel when present) */
  hooksSelection?: { basePreset: HookLevel; selectedHooks: string[]; isCustom: boolean };
  doBackup: boolean;
  /** Install statusline separately (default: false) */
  installStatusline: boolean;
  /** Backup CLAUDE.md before overwrite (default: true) */
  backupClaudeMd: boolean;
  /** Backup all replaced files (default: false) */
  backupAll: boolean;
}

export const DEFAULT_INSTALL_CONFIG: InstallConfig = {
  mode: 'global',
  projectPath: '',
  selectedIds: [],
  mcpEnabled: true,
  mcpTools: [],
  mcpProjectRoot: '',
  hookLevel: 'none',
  doBackup: false,
  installStatusline: false,
  backupClaudeMd: true,
  backupAll: false,
};

// ---------------------------------------------------------------------------
// Execution result (produced by ExecutionView, consumed by ResultDashboard)
// ---------------------------------------------------------------------------

export interface InstallResult {
  totalStats: { files: number; dirs: number; skipped: number };
  manifestPath: string;
  mcpRegistered: boolean;
  hookResult: { installedHooks: string[]; level: string } | null;
  disabledRestored: number;
  overlaysApplied: number;
}
