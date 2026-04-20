// ---------------------------------------------------------------------------
// PreflightGuard — Warns when teammates are active on the same phase
//
// Runs as a PreToolUse hook on write operations (Bash|Write|Edit|Agent).
// Advisory by default (emits warning context), configurable to block.
//
// Namespace: reads `.workflow/collab/activity.jsonl` (never writes).
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveSelf } from '../../tools/team-members.js';
import { readRecentActivity } from '../../tools/team-activity.js';
import { runPreflight, type PreflightResult } from '../preflight-core.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightGuardResult {
  /** True if the guard wants to block (only when mode = 'block'). */
  blocked: boolean;
  /** Warning lines (always populated when conflicts exist). */
  warnings: string[];
  /** Number of conflicting teammates. */
  conflictCount: number;
}

export interface PreflightGuardConfig {
  /** 'warn' = emit warnings, 'block' = reject the operation. Default: 'warn' */
  mode: 'warn' | 'block';
  /** Activity look-back window in minutes. Default: 30 */
  windowMin: number;
  /** Whether to run automatically. Default: true */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PreflightGuardConfig = {
  mode: 'warn',
  windowMin: 30,
  enabled: true,
};

/**
 * Load preflight guard config from `.workflow/config.json` → `collab` section.
 * Returns defaults on any error.
 */
export function loadPreflightConfig(projectRoot: string): PreflightGuardConfig {
  try {
    const configPath = join(projectRoot, '.workflow', 'config.json');
    if (!existsSync(configPath)) return DEFAULT_CONFIG;
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const collab = raw?.collab;
    if (!collab) return DEFAULT_CONFIG;
    return {
      mode: collab.preflight_mode === 'block' ? 'block' : 'warn',
      windowMin: typeof collab.preflight_window_min === 'number'
        ? collab.preflight_window_min
        : DEFAULT_CONFIG.windowMin,
      enabled: collab.auto_preflight !== false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether the current phase has active teammates.
 *
 * Pure function — takes explicit dependencies for testability.
 * Never throws.
 */
export function evaluatePreflightGuard(
  projectRoot: string,
  config?: Partial<PreflightGuardConfig>,
): PreflightGuardResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return { blocked: false, warnings: [], conflictCount: 0 };
  }

  const self = resolveSelf();
  if (!self) {
    return { blocked: false, warnings: [], conflictCount: 0 };
  }

  // Read current phase from state.json
  const phase = readCurrentPhase(projectRoot);
  if (phase === null) {
    return { blocked: false, warnings: [], conflictCount: 0 };
  }

  const result = runPreflight(phase, { force: cfg.mode !== 'block' });

  if (result.conflicts.length === 0) {
    return { blocked: false, warnings: [], conflictCount: 0 };
  }

  return {
    blocked: cfg.mode === 'block' && result.exitCode !== 0,
    warnings: result.warnings,
    conflictCount: result.conflicts.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readCurrentPhase(projectRoot: string): number | null {
  try {
    const statePath = join(projectRoot, '.workflow', 'state.json');
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const phase = state?.current_phase;
    return typeof phase === 'number' ? phase : null;
  } catch {
    return null;
  }
}
