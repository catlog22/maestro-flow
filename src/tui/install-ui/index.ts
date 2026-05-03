import { renderTui } from '../render.js';

export async function runInstallWizard(
  pkgRoot: string,
  version: string,
): Promise<void> {
  const { CyberdeckBlueprint } = await import('./CyberdeckBlueprint.js');
  await renderTui(CyberdeckBlueprint, { pkgRoot, version });
}

export interface InstallFlowOptions {
  initialStep?: 'mode' | 'hub' | 'components_config' | 'hooks_config' | 'mcp_config' | 'statusline_config' | 'backup_config' | 'confirm';
  initialMode?: 'global' | 'project';
  initialStepIds?: string[];
}

export async function runInstallFlow(
  pkgRoot: string,
  version: string,
  options?: InstallFlowOptions,
): Promise<void> {
  const { InstallFlow } = await import('./InstallFlow.js');
  await renderTui(InstallFlow, { pkgRoot, version, ...options });
}
