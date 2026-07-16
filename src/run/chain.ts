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

import { SessionStore } from './store.js';
import type { SessionState } from './schemas.js';

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
  status: string,
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
