// ---------------------------------------------------------------------------
// Brain ledger schema — TypeScript shape for the maestro-brain outer loop.
//
// Mirrors the two-layer design of src/ralph/: the authored .md FSM
// (.claude/commands/maestro-brain.md) plans and routes; this engine
// deterministically derives decision inputs, evaluates the stop predicate,
// enforces convergence caps, and persists ledger.json.
//
// Source of truth: `.workflow/.brain/brain-{ts}/ledger.json`.
// ---------------------------------------------------------------------------

/** Blocker severity — only `defect` blocks termination; `info` (env/cap degradations) does not. */
export type BlockerSeverity = 'defect' | 'info';

/** Blocker lifecycle. `acknowledged` = an accepted info-degradation; never blocks a clean terminate. */
export type BlockerState = 'open' | 'acknowledged' | 'resolved';

export interface Blocker {
  id: string;
  severity: BlockerSeverity;
  state: BlockerState;
  note: string;
}

/** The per-round decision the brain self-determines (A_DECIDE). */
export type BrainDecision = 'advance' | 'insert-fix' | 'revise-roadmap' | 'terminate';

/** Terminal outcomes. */
export type TerminalStatus =
  | 'completed'
  | 'completed-with-optional-deferred'
  | 'partial';

export type LedgerStatus = 'running' | TerminalStatus | 'escalated';

/** Verdict on a returned child session. */
export type Verdict = 'pass' | 'gap' | 'false-green' | 'hard-signal' | 'unfixable-external';

export interface BrainRound {
  round: number;
  cursor: string | null;            // "M1/phase-2" or milestone id
  decision: BrainDecision;
  executor?: string;                // ralph | odyssey-*
  impl_cli?: string;
  review_cli?: string;
  review_tier?: 'L1' | 'L2' | 'L3';
  verdict?: Verdict;
  child_status?: string;            // real child terminal status
  auto_resolved?: boolean;
  rationale?: string;
  evidence_refs?: string[];
  artifacts?: string[];
  caveats?: string[];
  deferred?: string[];
}

export interface Convergence {
  /** consecutive insert-fix attempts per cursor-unit; reset on advance/unit-change. */
  stuck: Record<string, number>;
  /** consecutive revise-roadmap on the same issue; reset on advance/issue-change. */
  revises: Record<string, number>;
  /** crash/timeout retries per unit (independent of stuck). */
  crash_retries: Record<string, number>;
}

export interface StopPredicate {
  mandatory_all_completed: boolean;
  optional_all_resolved: boolean;
  no_open_defect_blocker: boolean;
  no_open_mandatory_deferred: boolean;
}

export interface BrainLedger {
  session_id: string;               // brain-{ts}
  intent: string;
  autonomous: boolean;              // -y present
  max_rounds: number;
  await_timeout_min: number;
  mode: 'maestro-cli' | 'skill-only';
  executor_default: string;
  available_clis: string[];
  stop_condition: string;
  stop_predicate: StopPredicate;
  key_decisions: string[];
  blockers: Blocker[];
  deferred: string[];
  convergence: Convergence;
  rounds: BrainRound[];
  status: LedgerStatus;
}

// ---------------------------------------------------------------------------
// Convergence thresholds — the anti-thrash caps validated in the robustness
// campaign (Wave B/D). Calibrate per-project; defaults below match the
// command's <validation> V7 baseline.
// ---------------------------------------------------------------------------
export const REVISES_CAP = 2;       // same roadmap issue revised >= this -> demote (N2 anti-starvation)
export const STUCK_CAP = 3;         // same unit insert-fixed >= this -> give up (N1 bounded-thrash)
export const CRASH_RETRIES_CAP = 2; // crash/timeout retries per unit before defer (R10-D2)
export const DEFAULT_MAX_ROUNDS = 30;
// Durations follow maestro's convention: human units at the config layer
// (`_MIN`/`_SEC`, small integers), engine converts to ms internally.
export const DEFAULT_AWAIT_TIMEOUT_MIN = 10;   // hard deadline (minutes)
export const DEFAULT_AWAIT_FLOOR_SEC = 2;      // event-driven safety floor (seconds); matches terminal-adapter's 2s

export function newConvergence(): Convergence {
  return { stuck: {}, revises: {}, crash_retries: {} };
}
