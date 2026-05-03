import type { Manifest } from '../../core/manifest.js';
import { renderTui } from '../render.js';

export async function runUninstallFlow(
  manifests: Manifest[],
): Promise<void> {
  const { UninstallFlow } = await import('./UninstallFlow.js');
  await renderTui(UninstallFlow, { manifests });
}
