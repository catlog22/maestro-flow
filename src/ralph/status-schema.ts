// ---------------------------------------------------------------------------
// Ralph status.json schema — TypeScript shape only.
//
// Source of truth: `.workflow/.maestro/ralph-{ts}/status.json`.
// All new fields are additive — legacy sessions (without `ralph_protocol_version`)
// fall back to pre-CLI ralph-execute inline logic.
// ---------------------------------------------------------------------------

export const RALPH_PROTOCOL_VERSION = '2';

export type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
export type CompletionStatus = 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_RETRY' | 'BLOCKED';
export type SessionStatus = 'running' | 'paused' | 'completed' | 'failed';
export type CommandScope = 'global' | 'project' | 'missing' | null;
export type SessionPlatform = 'claude' | 'codex' | 'agent' | 'agy';

export interface RalphStepLoad {
  loaded_at: string | null;        // ISO timestamp
  required_files: string[];        // absolute paths actually read
  deferred_files: string[];        // recorded only, not read
  resolve_version: string;         // schema version of the load block
}

export interface RalphStep {
  index: number;
  skill: string;                   // empty for decision nodes
  args: string;
  stage: string;
  scope?: 'phase' | 'standalone' | 'milestone' | null;
  decision: string | null;         // non-null → decision node; null → execution step
  retry_count?: number;
  max_retries?: number;
  command_scope: CommandScope;
  command_path: string | null;
  milestone_id?: string | null;
  source_artifact_ref?: string | null;
  status: StepStatus;
  goal_ref?: string | null;
  completion_confirmed: boolean;
  completion_status: CompletionStatus | null;
  completion_evidence: string | string[] | null;
  completion_summary?: string | null;
  completion_decisions?: string[] | null;
  completion_caveats?: string | null;
  completion_deferred?: string[] | null;
  completed_at: string | null;
  concerns?: string | null;
  retried?: boolean;
  deferred_reads?: string[];
  load?: RalphStepLoad;            // populated by `ralph next`
}

export interface RalphTaskDecompositionItem {
  id: string;
  goal: string;
  boundary?: string;
  done_when?: string;
  evidence?: string;
  lifecycle?: string[];
  status: 'pending' | 'done' | 'superseded';
  completion_confirmed?: boolean;
  completed_at?: string | null;
  superseded_by?: string | null;
  superseded_at?: string | null;
  origin?: string | null;          // CHG-xxx that created this goal
}

export interface GoalChangelogEntry {
  id: string;                       // CHG-001, CHG-002, ...
  timestamp: string;
  change_type: 'modify' | 'add' | 'remove' | 'boundary';
  reason: string;
  impact_assessment?: {
    risk_level: 'low' | 'medium' | 'high';
    invalidated_steps: number[];
    new_steps_inserted: number;
  };
  before: {
    goals: Pick<RalphTaskDecompositionItem, 'id' | 'goal' | 'done_when'>[];
    boundary_snippet?: string;
  };
  after: {
    goals: Pick<RalphTaskDecompositionItem, 'id' | 'goal' | 'done_when'>[];
    boundary_snippet?: string;
  };
}

export interface RalphSessionContext {
  issue_id?: string | null;
  scratch_dir?: string | null;
  plan_dir?: string | null;
  analysis_dir?: string | null;
  brainstorm_dir?: string | null;
  blueprint_dir?: string | null;
}

export interface VerificationLedgerEntry {
  authority: string;
  dimension: string;
  subject_ids: string[];
  evidence_hashes: Record<string, string>;
  scope_hash: string;
  verdict: 'pass' | 'fail' | string;
  confidence: 'high' | 'medium' | 'low';
  concerns?: string | null;
  risk_ceiling: 'low' | 'medium' | 'high';
  created_at: string;
}

export interface RalphSession {
  session_id: string;
  source: 'ralph' | 'maestro' | string;
  status: SessionStatus;
  intent: string;
  lifecycle_position: string;
  phase: number | null;
  phase_is_new?: boolean;
  milestone: string;
  auto_mode?: boolean;
  quality_mode?: 'full' | 'standard' | 'quick';
  planning_mode?: 'unified' | 'independent';
  scope_verdict?: 'large' | 'medium' | 'small' | 'unknown' | null;
  analyze_macro_id?: string | null;
  blueprint_id?: string | null;
  cli_tool?: string;
  platform?: SessionPlatform;       // 'claude' (.claude/) | 'codex' (.codex/); absent → claude
  passed_gates?: string[];
  context?: RalphSessionContext;
  decomposition_owner?: 'maestro' | 'ralph' | string; // absent → infer from `source`
  steps: RalphStep[];
  waves?: unknown[];
  current_step?: number;
  // CLI protocol fields (additive; absent → legacy behavior)
  ralph_protocol_version?: string;
  active_step_index?: number | null;
  // Lease and Ownership
  execution_owner?: 'ralph-execute' | 'maestro-inline' | string;
  owner_epoch?: number;
  lease_id?: string;
  verification_ledger?: VerificationLedgerEntry[];
  // Optional decomposition block
  boundary_contract?: {
    in_scope?: string[];
    out_of_scope?: string[];
    constraints?: string[];
    definition_of_done?: string;
  };
  execution_criteria?: string[];
  task_decomposition?: RalphTaskDecompositionItem[];
  task_decomposition_all_done?: boolean;
  goal_changelog?: GoalChangelogEntry[];
}

export interface CheckFinding {
  level: 'E' | 'W';
  code: string;
  message: string;
  step_index?: number;
}
