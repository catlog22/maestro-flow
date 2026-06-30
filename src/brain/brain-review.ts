// ---------------------------------------------------------------------------
// Review enforcement — the DETERMINISTIC, brain-specific anti-false-green
// decisions. Unlike ralph (which has no cross-session review), brain must
// enforce, as code (not prompt discretion): the invariant#7 L2-floor, the
// invariant#4 evaluator!=implementer isolation, and the fail-closed verdict
// aggregation. These three caused real bugs in the robustness campaign (R7
// reviewer-faked-green) so they are code-enforced, not left to the model.
//
// The review STAGES themselves (which agents to spawn, the verify->challenge
// prose) are LLM orchestration and stay in the prompt (A_REVIEW) — consistent
// with maestro ("review = authored agents, not a TS stage-planner"). This file
// is only the enforced decisions, kept lean and Claude-only.
// ---------------------------------------------------------------------------

export type ReviewTier = 'L1' | 'L2' | 'L3';

export interface ReviewDecisionInput {
  difficulty: 'trivial' | 'normal' | 'hard';
  selfReportedSuccess: boolean;   // child claimed "done/all green"
  codeChanged: boolean;
  critical: boolean;              // critical path / low confidence / auto hard-signal
  forcedTier?: ReviewTier;
}

/**
 * Pick the review tier. invariant#7: any round that CHANGED CODE and was
 * SELF-REPORTED successful has a hard floor of L2 (don't trust the green).
 */
export function selectTier(input: ReviewDecisionInput): ReviewTier {
  if (input.forcedTier) {
    if (input.codeChanged && input.selfReportedSuccess && input.forcedTier === 'L1') return 'L2';
    return input.forcedTier;
  }
  if (input.critical) return 'L3';
  if (!input.codeChanged) return 'L1';            // doc-only / no-code round
  if (input.difficulty === 'hard') return 'L2';
  if (input.selfReportedSuccess) return 'L2';     // L2 floor (R7/R11)
  return 'L1';
}

export type ReviewIsolation = 'different-cli' | 'distinct-instance';

/**
 * Choose the reviewer so the evaluator differs from the implementer (invariant#4).
 * Claude-only: when no other CLI is available, a distinct fresh-context instance
 * is valid isolation (Workflow treats separate agent() calls as independent).
 */
export function selectReviewIsolation(implCli: string, availableClis: string[]): {
  reviewCli: string; isolation: ReviewIsolation;
} {
  const other = availableClis.find(c => c !== implCli);
  return other
    ? { reviewCli: other, isolation: 'different-cli' }
    : { reviewCli: implCli, isolation: 'distinct-instance' };
}

export type StageVerdict = 'pass' | 'gap' | 'false-green';
export interface StageOutcome { id: string; verdict: StageVerdict; confidence: number; }

/**
 * Fail-closed aggregation: any false-green or gap fails the round (-> insert-fix);
 * low confidence (<60) also fails closed. Only an all-pass with confidence passes.
 */
export function aggregateVerdict(outcomes: StageOutcome[]): { verdict: 'pass' | 'gap' | 'false-green'; reason: string } {
  if (outcomes.some(o => o.verdict === 'false-green')) return { verdict: 'false-green', reason: 'a reviewer disproved a claimed green' };
  if (outcomes.some(o => o.verdict === 'gap')) return { verdict: 'gap', reason: 'a reviewer found an unmet requirement' };
  if (outcomes.some(o => o.confidence < 60)) return { verdict: 'gap', reason: 'fail-closed: confidence < 60' };
  return { verdict: 'pass', reason: 'all review stages passed with sufficient confidence' };
}
