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
import { completeRunWithVerdict, type CompletionVerdict } from '../run/runtime.js';
import { checkLease } from '../run/lease.js';
import {
  resolveRalphSession,
  effectiveLease,
  readMeta,
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

/**
 * Ralph completion signals that belong in the run's handoff.concerns. caveats and
 * concerns/reason are advisory notes about the step's outcome; deferred items are
 * follow-up work the next step should see. All flow through the P1d notes channel,
 * where completeRun appends them to handoff.concerns (append + dedupe).
 */
function handoffNotes(opts: CompleteCmdOptions): string[] {
  const notes: string[] = [];
  if (opts.caveats) notes.push(opts.caveats);
  if (opts.status === 'DONE_WITH_CONCERNS' && opts.concerns) notes.push(opts.concerns);
  if (opts.deferred?.length) notes.push(...opts.deferred.map(d => `deferred: ${d}`));
  return notes;
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

  const leaseClaim = {
    executionOwner: opts.executionOwner,
    ownerEpoch: opts.ownerEpoch,
    leaseId: opts.leaseId,
  };
  const leaseConflict = checkLease(effectiveLease(session, meta), leaseClaim);
  if (leaseConflict) {
    console.error(`[ralph complete] ${leaseConflict}`);
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

  // Complete the standard Run if one exists. Ralph's completion signals ride the
  // P1d notes channel so run.json.handoff carries them: caveats/concerns/deferred
  // append to handoff.concerns, and summary is a fallback when the executor left
  // report frontmatter without one (deriveHandoff yields an empty summary then).
  const runId = chainStep.run_id;
  let canonicalTransitionApplied = false;
  if (runId) {
    try {
      const verdict: CompletionVerdict = opts.status === 'DONE'
        ? 'done'
        : opts.status === 'DONE_WITH_CONCERNS'
          ? 'done-with-concerns'
          : opts.status === 'NEEDS_RETRY'
            ? 'needs-retry'
            : 'blocked';
      const completed = completeRunWithVerdict(projectRoot, runId, sessionId, {
        verdict,
        notes: handoffNotes(opts),
        summaryFallback: opts.summary,
        reason: opts.reason,
        leaseClaim,
      });
      if (!completed.run_sealed) {
        console.error(`[ralph complete] run ${runId} did not pass completion gates; chain unchanged`);
        return 1;
      }
      canonicalTransitionApplied = completed.chain !== null;
    } catch (err) {
      // Non-fatal: the run might already be completed/sealed
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ralph complete] run completion failed: ${msg}`);
      return 1;
    }
  }

  if (!canonicalTransitionApplied) {
    const store = new SessionStore(projectRoot);
    let fallbackResult: 'updated' | 'already-terminal';
    try {
      fallbackResult = store.update(sessionId, (draft) => {
        // Legacy sessions may have no canonical Run. Re-check the lease and
        // expected step identity under the same store lock that commits the
        // fallback transition; the earlier checks are only user-facing fast
        // failures and cannot authorize this write.
        const freshMeta = readMeta(store.sessionDir(sessionId));
        const freshLeaseConflict = checkLease(effectiveLease(draft.session, freshMeta), leaseClaim);
        if (freshLeaseConflict) throw new Error(freshLeaseConflict);

        const step = draft.session.orchestration.chain[opts.index];
        if (!step || step.step_id !== chainStep.step_id) {
          throw new Error(`step ${opts.index} changed before completion`);
        }
        if (step.status === 'completed' || step.status === 'sealed') return 'already-terminal';
        if (step.status !== 'running' || step.run_id !== chainStep.run_id) {
          throw new Error(`step ${opts.index} changed before completion (status=${step.status}, run_id=${step.run_id ?? '<none>'})`);
        }
        if (opts.expectedSkill && step.command !== opts.expectedSkill) {
          throw new Error(`expected command "${opts.expectedSkill}" does not match step command "${step.command}"`);
        }

        switch (opts.status) {
          case 'DONE':
          case 'DONE_WITH_CONCERNS':
            step.status = 'completed';
            draft.session.active_run_id = null;
            break;
          case 'NEEDS_RETRY': {
            const current = step.retry ?? { count: 0, max: 2 };
            step.retry = { count: current.count + 1, max: current.max };
            step.status = 'pending';
            step.run_id = null;
            draft.session.active_run_id = null;
            break;
          }
          case 'BLOCKED':
            step.status = 'failed';
            draft.session.status = 'paused';
            draft.session.active_run_id = null;
            break;
        }
        draft.session.activity_revision++;
        return 'updated';
      });
    } catch (error) {
      console.error(`[ralph complete] fallback transition refused: ${(error as Error).message}`);
      return 1;
    }
    if (fallbackResult === 'already-terminal') return 0;
  }

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
