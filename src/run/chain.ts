// ---------------------------------------------------------------------------
// Chain navigation + mutation — engine-agnostic helpers over
// `session.orchestration.chain[]`. These operate purely on SessionState and the
// canonical SessionStore, so any step-driving caller (`run next`, and later the
// ralph adapter) can share them without an engine dependency.
//
// The ralph engine keeps its own copies in src/ralph/session-adapter.ts today;
// P2 folds ralph onto these. src/run must never import src/ralph, so the logic
// lives here as the canonical source.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { SessionStore } from './store.js';
import type { CommandRun, OrchestrationStep, PendingRetryToken, SessionState } from './schemas.js';

// Default retry ceiling mirrors the ralph decision node default (max_retries: 2
// in maestro-ralph.md). A chain step created without a retry block adopts this
// on its first retry so count/max are always both present afterwards.
const DEFAULT_RETRY_MAX = 2;
const RETRY_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

/** Index of the single `running` chain step, or null when none is active. */
export function activeStepIndex(session: SessionState): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status === 'running') return i;
  }
  return null;
}

/**
 * Index of the next `pending` execution step. Decision nodes (`decision_ref`
 * set) are skipped by default — they are evaluated by the orchestrator, not
 * dispatched as Runs.
 */
export function nextPendingIndex(session: SessionState, skipDecisions = true): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status !== 'pending') continue;
    if (skipDecisions && chain[i].decision_ref) continue;
    return i;
  }
  return null;
}

/** Index of the next `pending` decision node, or null. */
export function nextPendingDecisionIndex(session: SessionState): number | null {
  const chain = session.orchestration.chain;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status === 'pending' && chain[i].decision_ref) return i;
  }
  return null;
}

/**
 * Set a chain step's status (and optionally its run_id) through the canonical
 * store transaction. Mirrors src/ralph/session-adapter.updateChainStepStatus
 * without the ralph-meta side channel.
 */
export function updateChainStepStatus(
  projectRoot: string,
  sessionId: string,
  stepIndex: number,
  status: OrchestrationStep['status'],
  runId?: string | null,
): void {
  const store = new SessionStore(projectRoot);
  store.update(sessionId, (draft) => {
    const step = draft.session.orchestration.chain[stepIndex];
    if (!step) throw new Error(`Chain step index ${stepIndex} out of range`);
    step.status = status;
    if (runId !== undefined) step.run_id = runId;
    draft.session.activity_revision++;
    return null;
  });
}

/** The step's retry counter after a bump — count/max, both always present. */
export interface RetryState {
  count: number;
  max: number;
  /** True when count has reached (or passed) max — the ceiling is exhausted. */
  exhausted: boolean;
}

export function issueRetryToken(
  sessionId: string,
  step: OrchestrationStep,
  run: CommandRun,
  now = new Date(),
): PendingRetryToken {
  if (run.session_id !== sessionId) throw new Error(`retry parent belongs to Session ${run.session_id}`);
  if (run.chain_step_id && run.chain_step_id !== step.step_id) {
    throw new Error(`retry parent chain step mismatch: ${run.chain_step_id} != ${step.step_id}`);
  }
  run.chain_step_id = step.step_id;
  const issuedAt = now.toISOString();
  const token = `retry_${randomBytes(24).toString('hex')}`;
  const pending: PendingRetryToken = {
    token,
    session_id: sessionId,
    parent_run_id: run.run_id,
    chain_step_id: step.step_id,
    command: run.command.name,
    issued_at: issuedAt,
    expires_at: new Date(now.getTime() + RETRY_TOKEN_TTL_MS).toISOString(),
  };
  step.pending_retry = pending;
  run.retry_fence = {
    token,
    chain_step_id: step.step_id,
    issued_at: pending.issued_at,
    expires_at: pending.expires_at,
    consumed_at: null,
  };
  return pending;
}

/**
 * Requeue a chain step for retry in one store transaction: status back to
 * `pending`, run_id cleared, and `retry.count` incremented (seeding the block
 * with the default ceiling when the step had none). Equivalent to the ralph
 * NEEDS_RETRY path (`retry_count = (retry_count ?? 0) + 1`); the CLI does not cap
 * the count — the retry ceiling is a prompt-layer FSM decision — but the returned
 * `exhausted` flag lets the caller report when count has met max.
 */
export function requeueChainStepForRetry(
  projectRoot: string,
  sessionId: string,
  stepIndex: number,
): RetryState {
  const store = new SessionStore(projectRoot);
  return store.update(sessionId, (draft, tx) => {
    const step: OrchestrationStep | undefined = draft.session.orchestration.chain[stepIndex];
    if (!step) throw new Error(`Chain step index ${stepIndex} out of range`);
    if (!step.run_id) throw new Error(`Chain step ${step.step_id} has no active Run to retry`);
    const run = tx.readRun(step.run_id);
    issueRetryToken(sessionId, step, run);
    step.status = 'pending';
    step.run_id = null;
    const current = step.retry ?? { count: 0, max: DEFAULT_RETRY_MAX };
    const next = { count: current.count + 1, max: current.max };
    step.retry = next;
    draft.session.activity_revision++;
    tx.writeRun(run);
    return { count: next.count, max: next.max, exhausted: next.count >= next.max };
  });
}
