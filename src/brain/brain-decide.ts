// ---------------------------------------------------------------------------
// Decision engine — A_DECIDE as enforced code (command v3..v8).
//
// Priority-ordered, mutually-exclusive, exhaustive, with convergence caps that
// turn the old infinite-loop / bounded-thrash / starvation failure modes into
// deterministic give-up + advance. Pure function over an explicit context so it
// is fully unit-testable (the prompt FSM calls this; it does not re-derive it).
// ---------------------------------------------------------------------------

import {
  type BrainDecision,
  type Convergence,
  type TerminalStatus,
  REVISES_CAP,
  STUCK_CAP,
} from './brain-schema.js';
import type { StopEvaluation } from './stop-predicate.js';

/** The reconciled situation the brain faces this round. */
export type RoundSignal =
  | { kind: 'ok' }                                   // last child passed clean
  | { kind: 'result-problem' }                       // gap / false-green in delivered code
  | { kind: 'roadmap-problem'; issue: string }       // the plan itself is wrong
  | { kind: 'unfixable-external' }                    // external dead dependency (fast-path defer)
  | { kind: 'first-round' };                          // nothing returned yet

export interface DecideContext {
  stop: StopEvaluation;
  round: number;
  maxRounds: number;
  autonomous: boolean;
  cursorUnit: string | null;
  signal: RoundSignal;
  convergence: Convergence;
}

export interface DecideResult {
  decision: BrainDecision;
  terminalStatus?: TerminalStatus;   // set when decision === 'terminate'
  /** counter mutation to apply before next round (caller applies via mutators). */
  bump?: { counter: 'stuck' | 'revises'; key: string };
  giveUp?: boolean;                  // unit exhausted -> defer + advance past (auto) / escalate (non-auto)
  demote?: boolean;                  // roadmap issue capped -> treat as result problem
  escalate?: boolean;                // non-auto hard stop
  reason: string;
}

function count(map: Record<string, number>, key: string | null): number {
  if (!key) return 0;
  return map[key] ?? 0;
}

/**
 * Decide the next brain action. Order matters and is the whole point:
 *   1. terminate (stop predicate satisfied, or budget exhausted)
 *   2. revise-roadmap (roadmap problem, unless revise-capped -> demote)
 *   3. insert-fix (result problem, unless stuck-capped -> give up; external -> defer fast-path)
 *   4. advance (default)
 */
export function decide(ctx: DecideContext): DecideResult {
  const { stop, round, maxRounds, autonomous, cursorUnit, signal, convergence } = ctx;

  // 1. Terminate — checked FIRST so "all done" never falls through to advance.
  if (stop.satisfied) {
    return { decision: 'terminate', terminalStatus: stop.terminalStatus, reason: 'stop_predicate satisfied' };
  }
  if (round >= maxRounds) {
    return { decision: 'terminate', terminalStatus: 'partial', reason: `budget exhausted (round ${round} >= max ${maxRounds})` };
  }

  // 2. Roadmap problem — highest-priority exception, but anti-starvation capped.
  if (signal.kind === 'roadmap-problem') {
    const issue = signal.issue;
    if (count(convergence.revises, issue) < REVISES_CAP) {
      return { decision: 'revise-roadmap', bump: { counter: 'revises', key: issue }, reason: `revise roadmap issue=${issue}` };
    }
    // revises capped -> DEMOTE to result-problem (don't let revise starve the real fix, N2)
    return demoteToResultProblem(ctx, `revises[${issue}] reached cap ${REVISES_CAP}`);
  }

  // 3. Result problem (gap / false-green / unfixable-external).
  if (signal.kind === 'result-problem' || signal.kind === 'unfixable-external') {
    return resultProblem(ctx, signal.kind === 'unfixable-external');
  }

  // 4. Default — advance to the next roadmap unit.
  return { decision: 'advance', reason: 'default advance' };
}

function resultProblem(ctx: DecideContext, unfixableExternal: boolean): DecideResult {
  const { autonomous, cursorUnit, convergence } = ctx;

  // Fast-path: confirmed external dead dependency -> defer immediately (R6-O1), no need to burn the cap.
  if (unfixableExternal) {
    return giveUpOrEscalate(autonomous, cursorUnit, 'unfixable-external dependency -> defer');
  }

  if (count(convergence.stuck, cursorUnit) < STUCK_CAP) {
    return { decision: 'insert-fix', bump: { counter: 'stuck', key: cursorUnit ?? '?' }, reason: 'insert remediation' };
  }
  // stuck capped -> give up (N1 bounded-thrash): defer + advance (auto) / escalate (non-auto)
  return giveUpOrEscalate(autonomous, cursorUnit, `stuck[${cursorUnit}] reached cap ${STUCK_CAP}`);
}

function demoteToResultProblem(ctx: DecideContext, reason: string): DecideResult {
  // After demote the unit is handled by the result-problem path keyed on stuck[cursorUnit] (R4-D2).
  const r = resultProblem(ctx, false);
  return { ...r, demote: true, reason: `${reason} -> demote: ${r.reason}` };
}

function giveUpOrEscalate(autonomous: boolean, cursorUnit: string | null, reason: string): DecideResult {
  if (autonomous) {
    // mark deferred + defect blocker and ADVANCE past it (don't spin the whole budget on one dead unit)
    return { decision: 'advance', giveUp: true, reason: `give up unit=${cursorUnit} -> defer + advance (${reason})` };
  }
  return { decision: 'advance', escalate: true, reason: `escalate unit=${cursorUnit} (${reason})` };
}

// ---------------------------------------------------------------------------
// Convergence mutators — apply the bump/reset decisions to the counters.
// ---------------------------------------------------------------------------

export function applyBump(conv: Convergence, bump: { counter: 'stuck' | 'revises'; key: string }): void {
  const map = conv[bump.counter];
  map[bump.key] = (map[bump.key] ?? 0) + 1;
}

/** On a successful advance to a NEW unit, clear the prior unit's stuck/crash counters. */
export function resetUnit(conv: Convergence, unit: string | null): void {
  if (!unit) return;
  delete conv.stuck[unit];
  delete conv.crash_retries[unit];
}

export function bumpCrashRetry(conv: Convergence, unit: string | null): number {
  if (!unit) return 0;
  conv.crash_retries[unit] = (conv.crash_retries[unit] ?? 0) + 1;
  return conv.crash_retries[unit];
}
