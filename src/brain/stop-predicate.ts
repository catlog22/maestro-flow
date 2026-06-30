// ---------------------------------------------------------------------------
// Stop predicate — the machine-checkable termination contract (command v7/v8).
//
// Normal termination = every MANDATORY milestone completed AND every OPTIONAL
// milestone resolved (completed OR acknowledged-deferred with a reason) AND no
// open `defect` blocker AND no open mandatory deferred. `info` blockers
// (skill-only / review-tier-capped degradations) never block termination.
//
// This replaces the naive "all milestones completed" predicate that was wrong
// in both directions for optional units (R12-HIGH).
// ---------------------------------------------------------------------------

import type { Blocker, StopPredicate, TerminalStatus } from './brain-schema.js';
import type { MilestoneEntry, StateJsonV2 } from '../utils/state-schema.js';

/** Normalized milestone view the predicate operates on. */
export interface MilestoneView {
  id: string;
  mandatory: boolean;             // default true; optional/stretch units = false
  status: 'pending' | 'active' | 'completed' | 'deferred';
  defer_reason?: string | null;   // non-empty => acknowledged-deferred
}

/** A milestone is "resolved" for stop purposes. */
function isResolved(m: MilestoneView): boolean {
  if (m.status === 'completed') return true;
  if (!m.mandatory && m.status === 'deferred' && !!m.defer_reason && m.defer_reason.trim() !== '') {
    return true; // acknowledged-deferred optional unit
  }
  return false;
}

export interface StopEvaluation {
  predicate: StopPredicate;
  satisfied: boolean;
  /** terminal status to record IF satisfied (or if budget-exhausted -> caller uses 'partial'). */
  terminalStatus: TerminalStatus;
}

/**
 * Evaluate the stop predicate against the reconciled milestone views + blockers.
 * Pure function — the linchpin of correct termination (not too early, not never).
 */
export function evaluateStopPredicate(
  milestones: MilestoneView[],
  blockers: Blocker[],
): StopEvaluation {
  const mandatory = milestones.filter(m => m.mandatory);
  const optional = milestones.filter(m => !m.mandatory);

  const mandatory_all_completed = mandatory.every(m => m.status === 'completed');
  const optional_all_resolved = optional.every(isResolved);
  const no_open_defect_blocker = !blockers.some(b => b.severity === 'defect' && b.state === 'open');
  const no_open_mandatory_deferred = !mandatory.some(m => m.status === 'deferred');

  const predicate: StopPredicate = {
    mandatory_all_completed,
    optional_all_resolved,
    no_open_defect_blocker,
    no_open_mandatory_deferred,
  };

  const satisfied =
    mandatory_all_completed &&
    optional_all_resolved &&
    no_open_defect_blocker &&
    no_open_mandatory_deferred;

  // Terminal label: distinguish a fully-green completion from one that relied on
  // an optional unit being acknowledged-deferred (the latter is NOT a failure).
  const hasOptionalDeferred = optional.some(m => m.status === 'deferred');
  const terminalStatus: TerminalStatus = hasOptionalDeferred
    ? 'completed-with-optional-deferred'
    : 'completed';

  return { predicate, satisfied, terminalStatus };
}

/**
 * Project state.json milestones (+ optional `mandatory`/`defer_reason` extensions)
 * into the normalized MilestoneView[] the predicate consumes.
 *
 * `mandatory` defaults to true when absent (back-compat with plain state.json).
 */
export function milestoneViews(state: StateJsonV2): MilestoneView[] {
  return (state.milestones ?? []).map((m: MilestoneEntry & { mandatory?: boolean; defer_reason?: string | null; status: MilestoneView['status'] }) => ({
    id: m.id,
    mandatory: (m as { mandatory?: boolean }).mandatory ?? true,
    status: m.status,
    defer_reason: (m as { defer_reason?: string | null }).defer_reason ?? null,
  }));
}
