import { renderTui } from '../render.js';

export type { InstallFlowConfig } from './types.js';
export type { HooksSelection } from './HooksConfig.js';

/** @deprecated Use runInstallFlow instead */
export async function runInstallWizard(
  pkgRoot: string,
  version: string,
): Promise<void> {
  const { CyberdeckBlueprint } = await import('./CyberdeckBlueprint.js');
  await renderTui(CyberdeckBlueprint, { pkgRoot, version });
}

export interface InstallFlowOptions {
  /** 'mode' is accepted for backward compat but maps to 'hub' internally */
  initialStep?: 'mode' | 'hub'
    | 'components_config' | 'hooks_config' | 'mcp_config'
    | 'codex_hooks_config' | 'codex_mcp_config'
    | 'agy_hooks_config' | 'extra_mcp_config'
    | 'statusline_config' | 'backup_config'
    | 'confirm';
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
  initialProjectPath?: string;
}

export async function runInstallFlow(
  pkgRoot: string,
  version: string,
  options?: InstallFlowOptions,
): Promise<void> {
  const { InstallFlow } = await import('./InstallFlow.js');
  await renderTui(InstallFlow, { pkgRoot, version, ...options });
}
