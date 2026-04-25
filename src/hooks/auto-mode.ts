/**
 * Auto-mode detection — shared helper for hooks
 *
 * Detects whether the current session is running in `-y` (auto) mode.
 * Two-layer strategy:
 *   1. Bridge file (fast, written by coordinator-tracker on Stop)
 *   2. Direct status.json scan (fallback for first turn before Stop fires)
 */

import { readCoordBridge, readMaestroSession } from './coordinator-tracker.js';
import { resolveWorkspace } from './workspace.js';

interface AutoModeInput {
  session_id?: string;
  cwd?: string;
}

/**
 * Returns true if the current maestro session has auto_mode enabled.
 */
export function isAutoMode(data: AutoModeInput): boolean {
  // Fast path: bridge file (written by coordinator-tracker on previous Stop)
  if (data.session_id) {
    const bridge = readCoordBridge(data.session_id);
    if (bridge?.auto_mode) return true;
  }

  // Fallback: scan status.json directly (works on first turn before Stop fires)
  const workspace = resolveWorkspace(data);
  if (!workspace) return false;
  const session = readMaestroSession(workspace);
  return session?.auto_mode ?? false;
}
