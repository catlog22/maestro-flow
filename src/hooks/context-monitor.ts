/**
 * Maestro Context Monitor — PostToolUse Hook
 *
 * Reads bridge file written by statusline hook, injects warnings
 * into agent context when usage is high.
 *
 * Bridge file: /tmp/maestro-ctx-{session_id}.json
 *
 * Thresholds:
 *   WARNING  (remaining <= 35%) — wrap up current task
 *   CRITICAL (remaining <= 25%) — stop and inform user
 *
 * Debounce: 5 tool calls between warnings; severity escalation bypasses it.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  STALE_SECONDS,
  DEBOUNCE_CALLS,
  BRIDGE_PREFIX,
} from './constants.js';
import { resolveWorkspace } from './workspace.js';
import { isAutoMode } from './auto-mode.js';

interface MonitorInput {
  session_id?: string;
  cwd?: string;
}

interface BridgeMetrics {
  session_id: string;
  remaining_percentage: number;
  used_pct: number;
  timestamp: number;
}

interface WarnState {
  callsSinceWarn: number;
  lastLevel: string | null;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

/** Build the warning message based on severity, workflow presence, and auto mode */
function buildMessage(usedPct: number, remaining: number, isCritical: boolean, hasWorkflow: boolean, autoMode: boolean): string {
  // Auto mode (-y): never instruct the model to stop — let the chain finish
  if (autoMode) {
    return isCritical
      ? `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Finish current chain step. Progress tracked in status.json. ' +
        'Chain can resume with /maestro -c in a new session.'
      : `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Finish current chain step, then stop chain. Resume with /maestro -c.';
  }

  if (isCritical) {
    return hasWorkflow
      ? `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Context is nearly exhausted. Do NOT start new complex work. ' +
        'State is tracked in .workflow/state.json. Inform the user so they can ' +
        'decide how to proceed (e.g. /maestro-phase-transition or pause).'
      : `CONTEXT CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Context is nearly exhausted. Inform the user that context is low and ask how they ' +
        'want to proceed. Do NOT autonomously save state or write handoff files unless asked.';
  }
  return hasWorkflow
    ? `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
      'Context is getting limited. Avoid starting new complex work. ' +
      'If between plan steps, inform the user so they can prepare to pause.'
    : `CONTEXT WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
      'Be aware that context is getting limited. Avoid unnecessary exploration or ' +
      'starting new complex work.';
}

/**
 * Evaluate context metrics and return a warning if thresholds are crossed.
 * Returns null if no warning needed.
 */
export function evaluateContext(data: MonitorInput): HookOutput | null {
  const sessionId = data.session_id;
  if (!sessionId) return null;

  const tmp = tmpdir();
  const metricsPath = join(tmp, `${BRIDGE_PREFIX}${sessionId}.json`);

  if (!existsSync(metricsPath)) return null;

  const metrics: BridgeMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);

  // Stale check
  if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) return null;

  const { remaining_percentage: remaining, used_pct: usedPct } = metrics;

  // Below threshold — no warning
  if (remaining > WARNING_THRESHOLD) return null;

  // --- Debounce ---
  const warnPath = join(tmp, `${BRIDGE_PREFIX}${sessionId}-warned.json`);
  let warnData: WarnState = { callsSinceWarn: 0, lastLevel: null };
  let firstWarn = true;

  if (existsSync(warnPath)) {
    try {
      warnData = JSON.parse(readFileSync(warnPath, 'utf8'));
      firstWarn = false;
    } catch {
      // Corrupted — reset
    }
  }

  warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

  const isCritical = remaining <= CRITICAL_THRESHOLD;
  const currentLevel = isCritical ? 'critical' : 'warning';
  const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';

  if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
    writeFileSync(warnPath, JSON.stringify(warnData));
    return null;
  }

  // Reset debounce
  warnData.callsSinceWarn = 0;
  warnData.lastLevel = currentLevel;
  writeFileSync(warnPath, JSON.stringify(warnData));

  // Detect maestro workflow state via workspace resolver
  const hasWorkflow = resolveWorkspace(data) !== null;
  const autoMode = hasWorkflow && isAutoMode(data);

  const message = buildMessage(usedPct, remaining, isCritical, hasWorkflow, autoMode);

  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: message,
    },
  };
}

/** Entry point — reads stdin JSON, writes hook output to stdout */
export function runContextMonitor(): void {
  let input = '';
  const timeout = setTimeout(() => process.exit(0), 3000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    try {
      const data: MonitorInput = JSON.parse(input);
      const result = evaluateContext(data);
      if (result) {
        process.stdout.write(JSON.stringify(result));
      }
    } catch {
      // Silent fail — never block tool execution
      process.exit(0);
    }
  });
}
