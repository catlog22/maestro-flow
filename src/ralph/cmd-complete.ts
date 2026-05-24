// ---------------------------------------------------------------------------
// `maestro ralph complete <idx> --status <S>` — write completion + clear active_step.
//
// Consistency rules (all hard errors):
//   E008  idx must equal session.active_step_index
//   E009  target step.status must be "running"
//
// Status semantics:
//   DONE                 → completed, completion_confirmed=true
//   DONE_WITH_CONCERNS   → completed, completion_confirmed=true, .concerns recorded
//   NEEDS_RETRY          → pending,   retried=true, completion_confirmed=false
//   BLOCKED              → step.status=failed, session.status=paused
//
// NEEDS_CONTEXT is NOT accepted — context shortage is no longer a valid
// completion verdict (Claude Code harness auto-compacts; genuine ambiguity is
// resolved in-place via AskUserQuestion in the command itself).
// ---------------------------------------------------------------------------

import type { RalphSession, RalphStep } from './status-schema.js';
import { resolveSession, writeStatus, workflowRoot } from './status-store.js';

export interface CompleteCmdOptions {
  sessionId?: string;
  index: number;
  status: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_RETRY' | 'BLOCKED';
  evidence: string[];
  concerns?: string;
  reason?: string;
}

export async function runComplete(opts: CompleteCmdOptions): Promise<number> {
  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    console.error('[ralph complete] no maestro-* / ralph-* session found in .workflow/.maestro/');
    return 1;
  }
  const { sessionId, statusPath, data } = resolved;

  if (opts.index < 0 || opts.index >= data.steps.length) {
    console.error(`[ralph complete] step index ${opts.index} out of range (0..${data.steps.length - 1})`);
    return 1;
  }

  const active = data.active_step_index;
  if (active !== opts.index) {
    console.error(`[ralph complete] E008: index ${opts.index} != active_step_index ${active === null || active === undefined ? '(none)' : active}`);
    console.error('  → edit status.json manually to recover');
    return 1;
  }

  const step = data.steps[opts.index];
  if (step.status !== 'running') {
    console.error(`[ralph complete] E009: step ${opts.index}.status is "${step.status}", expected "running"`);
    return 1;
  }

  const now = new Date().toISOString();
  applyStatus(data, step, now, opts);
  writeStatus(statusPath, data);

  console.error(`[ralph complete] session=${sessionId} step=${opts.index} status=${opts.status}`);
  return 0;
}

function applyStatus(
  session: RalphSession,
  step: RalphStep,
  now: string,
  opts: CompleteCmdOptions,
): void {
  const evidence = opts.evidence.length === 0
    ? null
    : opts.evidence.length === 1 ? opts.evidence[0] : opts.evidence;

  switch (opts.status) {
    case 'DONE':
      step.status = 'completed';
      step.completion_confirmed = true;
      step.completion_status = 'DONE';
      step.completion_evidence = evidence;
      step.completed_at = now;
      step.concerns = null;
      session.active_step_index = null;
      break;

    case 'DONE_WITH_CONCERNS':
      step.status = 'completed';
      step.completion_confirmed = true;
      step.completion_status = 'DONE_WITH_CONCERNS';
      step.completion_evidence = evidence;
      step.concerns = opts.concerns ?? null;
      step.completed_at = now;
      session.active_step_index = null;
      break;

    case 'NEEDS_RETRY':
      step.status = 'pending';
      step.retried = true;
      step.completion_confirmed = false;
      step.completion_status = 'NEEDS_RETRY';
      step.completion_evidence = evidence;
      step.completed_at = null;
      session.active_step_index = null;
      break;

    case 'BLOCKED':
      step.status = 'failed';
      step.completion_confirmed = false;
      step.completion_status = 'BLOCKED';
      step.completion_evidence = evidence;
      step.concerns = opts.reason ?? null;
      step.completed_at = now;
      session.status = 'paused';
      session.active_step_index = null;
      break;
  }
}
