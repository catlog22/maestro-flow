import type { Manifest } from '../../core/manifest.js';

export async function runUninstallFlow(
  manifests: Manifest[],
): Promise<void> {
  const { render } = await import('ink');
  const React = await import('react');
  const { UninstallFlow } = await import('./UninstallFlow.js');

  const { waitUntilExit } = render(
    React.createElement(UninstallFlow, { manifests }),
    { exitOnCtrlC: true },
  );

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await waitUntilExit();
}
