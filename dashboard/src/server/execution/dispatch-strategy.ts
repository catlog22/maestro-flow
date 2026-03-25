// ---------------------------------------------------------------------------
// DispatchStrategy — pluggable interface for issue selection in tick loop
// ---------------------------------------------------------------------------

import type { Issue } from '../../shared/issue-types.js';
import type { ExecutionSlot, SchedulerConfig } from '../../shared/execution-types.js';
import type { LearningSuggestion } from '../../shared/learning-types.js';

// ---------------------------------------------------------------------------
// Context provided to strategies each tick
// ---------------------------------------------------------------------------

export interface DispatchContext {
  /** All issues from JSONL */
  issues: Issue[];
  /** Currently running slots */
  runningSlots: ReadonlyMap<string, ExecutionSlot>;
  /** Issues already claimed/queued */
  claimed: ReadonlySet<string>;
  /** Current scheduler config */
  config: SchedulerConfig;
  /** Available capacity (maxConcurrent - running) */
  availableSlots: number;
  /** Optional: learning suggestions from SelfLearningService */
  learningSuggestions?: LearningSuggestion[];
}

// ---------------------------------------------------------------------------
// Decision returned by a strategy
// ---------------------------------------------------------------------------

export interface DispatchDecision {
  issueId: string;
  /** Optional: override executor for this issue */
  executor?: string;
  /** Optional: override prompt mode */
  promptMode?: string;
  /** Reason for selection (for logging) */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface DispatchStrategy {
  readonly name: string;
  /** Select issues to dispatch given current context. Return empty array to skip. */
  selectIssues(context: DispatchContext): Promise<DispatchDecision[]>;
}
