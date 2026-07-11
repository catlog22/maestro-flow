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
  summary?: string;
  decisions?: string[];
  caveats?: string;
  deferred?: string[];
  executionOwner?: string;
  ownerEpoch?: number;
  leaseId?: string;
  expectedSkill?: string;
  expectedStepIndex?: number;
}

export async function runComplete(opts: CompleteCmdOptions): Promise<number> {
  if (!opts.sessionId) {
    console.error('[ralph complete] error: --session <id> is required for all state-writing operations.');
    return 1;
  }

  const resolved = resolveSession(workflowRoot(), opts.sessionId);
  if (!resolved) {
    console.error(`[ralph complete] no session found with id "${opts.sessionId}" in .workflow/.maestro/`);
    return 1;
  }
  const { sessionId, statusPath, data } = resolved;

  // Lease verification
  if (data.execution_owner && data.execution_owner !== opts.executionOwner) {
    console.error(`[ralph complete] lease conflict: session owned by "${data.execution_owner}", got executionOwner "${opts.executionOwner}"`);
    return 1;
  }
  if (data.lease_id && data.lease_id !== opts.leaseId) {
    console.error(`[ralph complete] lease conflict: session lease_id is "${data.lease_id}", got leaseId "${opts.leaseId}"`);
    return 1;
  }
  if (data.owner_epoch !== undefined && opts.ownerEpoch !== undefined && data.owner_epoch > opts.ownerEpoch) {
    console.error(`[ralph complete] lease conflict: session owner_epoch is ${data.owner_epoch}, got older epoch ${opts.ownerEpoch}`);
    return 1;
  }

  if (opts.index < 0 || opts.index >= data.steps.length) {
    console.error(`[ralph complete] step index ${opts.index} out of range (0..${data.steps.length - 1})`);
    return 1;
  }

  const step = data.steps[opts.index];

  // expectedSkill verification
  if (opts.expectedSkill && step.skill !== opts.expectedSkill) {
    console.error(`[ralph complete] error: expected skill "${opts.expectedSkill}" does not match active step skill "${step.skill}"`);
    return 1;
  }

  // expectedStepIndex verification
  if (opts.expectedStepIndex !== undefined && opts.index !== opts.expectedStepIndex) {
    console.error(`[ralph complete] E008: expected index ${opts.expectedStepIndex} does not match target index ${opts.index}`);
    return 1;
  }

  // Check if already completed/failed and verify idempotency
  if (step.status === 'completed' || step.status === 'failed') {
    if (isSameResult(step, opts)) {
      console.error(`[ralph complete] idempotent success for session=${sessionId} step=${opts.index}`);
      return 0;
    } else {
      console.error(`[ralph complete] BLOCK: conflicting completion result repeated for step ${opts.index}`);
      return 1;
    }
  }

  const active = data.active_step_index;
  if (active !== opts.index) {
    console.error(`[ralph complete] E008: index ${opts.index} != active_step_index ${active === null || active === undefined ? '(none)' : active}`);
    console.error('  → edit status.json manually to recover');
    return 1;
  }

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

function isSameResult(step: RalphStep, opts: CompleteCmdOptions): boolean {
  if (step.completion_status !== opts.status) return false;
  if ((step.completion_summary ?? null) !== (opts.summary ?? null)) return false;
  if ((step.completion_caveats ?? null) !== (opts.caveats ?? null)) return false;

  const existingEvidence = Array.isArray(step.completion_evidence)
    ? step.completion_evidence
    : (step.completion_evidence ? [step.completion_evidence] : []);
  const newEvidence = opts.evidence ?? [];
  if (existingEvidence.length !== newEvidence.length || !existingEvidence.every((val, i) => val === newEvidence[i])) {
    return false;
  }

  const existingDecisions = step.completion_decisions ?? [];
  const newDecisions = opts.decisions ?? [];
  if (existingDecisions.length !== newDecisions.length || !existingDecisions.every((val, i) => val === newDecisions[i])) {
    return false;
  }

  const existingDeferred = step.completion_deferred ?? [];
  const newDeferred = opts.deferred ?? [];
  if (existingDeferred.length !== newDeferred.length || !existingDeferred.every((val, i) => val === newDeferred[i])) {
    return false;
  }

  return true;
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
      step.completion_summary = opts.summary ?? null;
      step.completion_decisions = opts.decisions?.length ? opts.decisions : null;
      step.completion_caveats = opts.caveats ?? null;
      step.completion_deferred = opts.deferred?.length ? opts.deferred : null;
      step.completed_at = now;
      step.concerns = null;
      session.active_step_index = null;
      break;

    case 'DONE_WITH_CONCERNS':
      step.status = 'completed';
      step.completion_confirmed = true;
      step.completion_status = 'DONE_WITH_CONCERNS';
      step.completion_evidence = evidence;
      step.completion_summary = opts.summary ?? null;
      step.completion_decisions = opts.decisions?.length ? opts.decisions : null;
      step.completion_caveats = opts.caveats ?? null;
      step.completion_deferred = opts.deferred?.length ? opts.deferred : null;
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
