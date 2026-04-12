/**
 * Transition Recorder — Records phase/milestone transitions in state.json
 *
 * Provides pure functions for building transition entries and appending
 * them to the transition_history array in .workflow/state.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionSnapshot {
  phases_completed: number;
  phases_total: number;
  deferred_count: number;
  verification_status: string;
  learnings_count: number;
}

export interface TransitionEntry {
  type: 'phase' | 'milestone';
  from_phase: number | null;
  to_phase: number | null;
  milestone: string;
  transitioned_at: string;
  trigger: string;
  force: boolean;
  snapshot: TransitionSnapshot;
}

export interface BuildTransitionOpts {
  type: 'phase' | 'milestone';
  fromPhase: number | null;
  toPhase: number | null;
  milestone: string;
  trigger: string;
  force: boolean;
  phasesCompleted: number;
  phasesTotal: number;
  deferredCount: number;
  verificationStatus: string;
  learningsCount: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a transition entry from the given parameters.
 * Pure function — no I/O.
 */
export function buildTransitionEntry(opts: BuildTransitionOpts): TransitionEntry {
  return {
    type: opts.type,
    from_phase: opts.fromPhase,
    to_phase: opts.toPhase,
    milestone: opts.milestone,
    transitioned_at: new Date().toISOString(),
    trigger: opts.trigger,
    force: opts.force,
    snapshot: {
      phases_completed: opts.phasesCompleted,
      phases_total: opts.phasesTotal,
      deferred_count: opts.deferredCount,
      verification_status: opts.verificationStatus,
      learnings_count: opts.learningsCount,
    },
  };
}

/**
 * Append a transition entry to state.json's transition_history[].
 * Creates the array if it doesn't exist.
 */
export function appendTransition(statePath: string, entry: TransitionEntry): void {
  if (!existsSync(statePath)) return;

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (!Array.isArray(state.transition_history)) {
    state.transition_history = [];
  }
  state.transition_history.push(entry);
  state.last_updated = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
