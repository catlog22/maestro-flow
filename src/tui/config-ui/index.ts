import { renderTui } from '../render.js';

export type ConfigInitialView = 'dashboard' | 'skills' | 'editor' | 'sources';
export type DelegateInitialView = 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';
export type ConfigHubTab = 'Skills' | 'Delegate' | 'Hooks' | 'Overlay' | 'Specs' | 'Install';

/** Unified config hub — tab-based switcher between all config panels. */
export async function runConfigHub(options?: {
  initialTab?: ConfigHubTab;
  skillsInitialView?: ConfigInitialView;
  editSkill?: string;
  delegateInitialView?: DelegateInitialView;
}): Promise<void> {
  const { ConfigHub } = await import('./ConfigHub.js');

  await renderTui(ConfigHub, {
    workDir: process.cwd(),
    ...options,
  });
}

/** Skills config TUI — direct entry. */
export async function runConfigTui(
  initialView: ConfigInitialView = 'dashboard',
  editSkill?: string,
): Promise<void> {
  return runConfigHub({ initialTab: 'Skills', skillsInitialView: initialView, editSkill });
}

/** Delegate config TUI — direct entry. */
export async function runDelegateConfigTui(
  initialView: DelegateInitialView = 'dashboard',
): Promise<void> {
  return runConfigHub({ initialTab: 'Delegate', delegateInitialView: initialView });
}

/** Hooks panel — direct entry. */
export async function runHooksTui(): Promise<void> {
  return runConfigHub({ initialTab: 'Hooks' });
}

/** Overlay panel — direct entry. */
export async function runOverlayTui(): Promise<void> {
  return runConfigHub({ initialTab: 'Overlay' });
}

/** Specs panel — direct entry. */
export async function runSpecsTui(): Promise<void> {
  return runConfigHub({ initialTab: 'Specs' });
}

/** Install panel — direct entry. */
export async function runInstallTui(): Promise<void> {
  return runConfigHub({ initialTab: 'Install' });
}
