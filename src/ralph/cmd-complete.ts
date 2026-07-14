// ---------------------------------------------------------------------------
// `maestro ralph complete <idx> --status <S>` — complete a step via standard Run.
//
// Delegates to `completeRun()` from the standard runtime, then updates the
// orchestration chain status in session.json.
//
// Status semantics (unchanged):
//   DONE                 → chain step completed, run sealed
//   DONE_WITH_CONCERNS   → chain step completed with concerns, run sealed
//   NEEDS_RETRY          → chain step back to pending, run completed but step re-queued
//   BLOCKED              → chain step failed, session paused
// ---------------------------------------------------------------------------

import { SessionStore } from '../run/store.js';
import { completeRun as completeStandardRun } from '../run/runtime.js';
import {
  resolveRalphSession,
  updateChainStepStatus,
  updateRalphMeta,
  workflowRoot,
} from './session-adapter.js';

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
  const projectRoot = workflowRoot();

  const resolved = resolveRalphSession(projectRoot, opts.sessionId);
  if (!resolved) {
    const msg = opts.sessionId
      ? `[ralph complete] no ralph session found with id "${opts.sessionId}"`
      : '[ralph complete] no running ralph session found in .workflow/sessions/';
    console.error(msg);
    return 1;
  }

  const { sessionId, meta, bundle } = resolved;
  const session = bundle.session;
  const chain = session.orchestration.chain;

  // Lease verification
  if (meta.execution_owner && meta.execution_owner !== opts.executionOwner) {
    console.error(`[ralph complete] lease conflict: session owned by "${meta.execution_owner}", got "${opts.executionOwner}"`);
    return 1;
  }
  if (meta.lease_id && meta.lease_id !== opts.leaseId) {
    console.error(`[ralph complete] lease conflict: session lease_id is "${meta.lease_id}", got "${opts.leaseId}"`);
    return 1;
  }

  // Validate index
  if (opts.index < 0 || opts.index >= chain.length) {
    console.error(`[ralph complete] step index ${opts.index} out of range (0..${chain.length - 1})`);
    return 1;
  }

  const chainStep = chain[opts.index];

  // Verify expected skill
  if (opts.expectedSkill && chainStep.command !== opts.expectedSkill) {
    console.error(`[ralph complete] expected command "${opts.expectedSkill}" does not match step command "${chainStep.command}"`);
    return 1;
  }

  // Verify expected step index
  if (opts.expectedStepIndex !== undefined && opts.index !== opts.expectedStepIndex) {
    console.error(`[ralph complete] E008: expected index ${opts.expectedStepIndex} does not match target index ${opts.index}`);
    return 1;
  }

  // Check step is in correct state
  if (chainStep.status === 'completed' || chainStep.status === 'sealed') {
    console.error(`[ralph complete] step ${opts.index} already ${chainStep.status}`);
    return 0; // idempotent
  }

  if (chainStep.status !== 'running') {
    console.error(`[ralph complete] step ${opts.index} status is "${chainStep.status}", expected "running"`);
    return 1;
  }

  // Complete the standard Run if one exists
  const runId = chainStep.run_id;
  if (runId) {
    try {
      completeStandardRun(projectRoot, runId, sessionId);
    } catch (err) {
      // Non-fatal: the run might already be completed/sealed
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('sealed') && !msg.includes('immutable')) {
        console.error(`[ralph complete] warning: run completion failed: ${msg}`);
      }
    }
  }

  // Update chain step status
  const store = new SessionStore(projectRoot);
  store.update(sessionId, (draft) => {
    const step = draft.session.orchestration.chain[opts.index];
    switch (opts.status) {
      case 'DONE':
      case 'DONE_WITH_CONCERNS':
        step.status = 'completed';
        draft.session.active_run_id = null;
        break;
      case 'NEEDS_RETRY':
        step.status = 'pending';
        step.run_id = null;
        draft.session.active_run_id = null;
        break;
      case 'BLOCKED':
        step.status = 'failed';
        draft.session.status = 'paused';
        draft.session.active_run_id = null;
        break;
    }
    draft.session.activity_revision++;
    return null;
  });

  // Record completion details in ralph-meta
  updateRalphMeta(projectRoot, sessionId, (m) => {
    if (!m.step_details) m.step_details = {};
    const stepId = chainStep.step_id;
    const existing = m.step_details[stepId] ?? { args: '', stage: '', skill: chainStep.command };
    existing.completion_status = opts.status;
    existing.completion_summary = opts.summary ?? null;
    existing.completion_evidence = opts.evidence.length === 0 ? null
      : opts.evidence.length === 1 ? opts.evidence[0] : opts.evidence;
    existing.completion_decisions = opts.decisions?.length ? opts.decisions : null;
    existing.completion_caveats = opts.caveats ?? null;
    existing.completion_deferred = opts.deferred?.length ? opts.deferred : null;
    existing.concerns = opts.status === 'DONE_WITH_CONCERNS' ? (opts.concerns ?? null)
      : opts.status === 'BLOCKED' ? (opts.reason ?? null) : null;
    if (opts.status === 'NEEDS_RETRY') {
      existing.retry_count = (existing.retry_count ?? 0) + 1;
    }
    m.step_details[stepId] = existing;
  });

  console.error(`[ralph complete] session=${sessionId} step=${opts.index} status=${opts.status}`);
  return 0;
}
