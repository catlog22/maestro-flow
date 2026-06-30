// ---------------------------------------------------------------------------
// Brain state derivation — all read-only derivers in one file (mirrors how
// src/utils/state-schema.ts keeps deriveCurrentPhase + derivePhasesSummary
// together). Computes the per-round decision inputs the A-window assembles:
// the roadmap cursor, normalized milestone views, the machine-evaluated stop
// predicate, and the `_router.json` signals (the latent-bug fix).
// ---------------------------------------------------------------------------

import { deriveCurrentPhase, deriveRouterSignals } from '../utils/state-schema.js';
import type { RouterSignals, StateJsonV2 } from '../utils/state-schema.js';
import type { Blocker } from './brain-schema.js';
import { type MilestoneView, type StopEvaluation, evaluateStopPredicate, milestoneViews } from './stop-predicate.js';

// Router signals live in state-schema.ts (with the other derivers); re-exported
// here for brain callers/tests. graph-walker (coordinator) imports them directly
// from state-schema, so the coordinator does NOT depend on src/brain.
export { deriveRouterSignals } from '../utils/state-schema.js';
export type { RouterSignals } from '../utils/state-schema.js';

// ---------------------------------------------------------------------------
// Cursor + bundled snapshot
// ---------------------------------------------------------------------------

/**
 * Derive the roadmap cursor: "M{id}/phase-{n}" for the next-incomplete unit, the
 * milestone id when it has no phases, or null when nothing is pending. Skips
 * completed milestones and optional ones that are acknowledged-deferred.
 */
export function deriveCursor(state: StateJsonV2): string | null {
  for (const v of milestoneViews(state)) {
    if (v.status === 'completed') continue;
    if (!v.mandatory && v.status === 'deferred' && v.defer_reason && v.defer_reason.trim() !== '') continue;
    if (v.id === state.current_milestone) {
      const phase = deriveCurrentPhase(state);
      return phase === null ? v.id : `${v.id}/phase-${phase}`;
    }
    return v.id;
  }
  return null;
}

export interface BrainState {
  cursor: string | null;
  milestones: MilestoneView[];
  stop: StopEvaluation;
  router: RouterSignals;
}

/** Full decision-input snapshot for one round. `blockers` come from the ledger. */
export function deriveBrainState(state: StateJsonV2, blockers: Blocker[]): BrainState {
  const milestones = milestoneViews(state);
  return {
    cursor: deriveCursor(state),
    milestones,
    stop: evaluateStopPredicate(milestones, blockers),
    router: deriveRouterSignals(state),
  };
}
