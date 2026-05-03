import { renderTui } from '../render.js';

export type ToolsInitialView = 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';

export async function runToolsTui(
  initialView: ToolsInitialView = 'dashboard',
): Promise<void> {
  const { ToolsDashboard } = await import('./ToolsDashboard.js');

  await renderTui(ToolsDashboard, { workDir: process.cwd(), initialView });
}
