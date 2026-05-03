// ---------------------------------------------------------------------------
// Unified TUI barrel — single import point for all terminal UI modules.
// ---------------------------------------------------------------------------

export { renderTui, type RenderTuiOptions } from './render.js';
export {
  runConfigHub,
  runConfigTui,
  runDelegateConfigTui,
  runHooksTui,
  runOverlayTui,
  runSpecsTui,
  runInstallTui,
  type ConfigInitialView,
  type DelegateInitialView,
  type ConfigHubTab,
} from './config-ui/index.js';
export { runToolsTui, type ToolsInitialView } from './tools-ui/index.js';
export { runInstallWizard, runInstallFlow, type InstallFlowOptions } from './install-ui/index.js';
export { runUninstallFlow } from './uninstall-ui/index.js';
export { runOverlayListUI } from './overlay-ui/index.js';
