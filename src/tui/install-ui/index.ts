export async function runInstallWizard(
  pkgRoot: string,
  version: string,
): Promise<void> {
  const { render } = await import('ink');
  const React = await import('react');
  const { CyberdeckBlueprint } = await import('./CyberdeckBlueprint.js');

  const { waitUntilExit } = render(
    React.createElement(CyberdeckBlueprint, { pkgRoot, version }),
    { exitOnCtrlC: true },
  );

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await waitUntilExit();
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
  const { render } = await import('ink');
  const React = await import('react');
  const { InstallFlow } = await import('./InstallFlow.js');

  const { waitUntilExit } = render(
    React.createElement(InstallFlow, {
      pkgRoot,
      version,
      ...options,
    }),
    { exitOnCtrlC: true },
  );

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await waitUntilExit();
}
