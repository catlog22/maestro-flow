// ---------------------------------------------------------------------------
// Phase status — maps to kanban columns (from index.json status enum)
// ---------------------------------------------------------------------------
export type PhaseStatus =
  | 'pending'
  | 'exploring'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'testing'
  | 'completed'
  | 'blocked';

// ---------------------------------------------------------------------------
// Task status (from task.json meta.status enum)
// ---------------------------------------------------------------------------
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Task type (from task.json type enum)
// ---------------------------------------------------------------------------
export type TaskType = 'feature' | 'fix' | 'refactor' | 'test' | 'docs';

// ---------------------------------------------------------------------------
// Project-level status (from state.json status enum)
// ---------------------------------------------------------------------------
export type ProjectStatus = 'planning' | 'executing' | 'verifying' | 'idle';

// ---------------------------------------------------------------------------
// Kanban item selection — unified type for phases and Linear issues
// ---------------------------------------------------------------------------
import type { LinearIssue } from './linear-types.js';
import type { Issue } from './issue-types.js';

export type SelectedKanbanItem =
  | { type: 'phase'; phaseId: number }
  | { type: 'linearIssue'; issue: LinearIssue }
  | { type: 'issue'; issue: Issue };

// ---------------------------------------------------------------------------
// Re-export agent types for convenience
// ---------------------------------------------------------------------------
export type { AgentProcess, NormalizedEntry, ApprovalRequest, AgentStatusPayload, AgentStoppedPayload } from './agent-types.js';
import type { AgentProcess, NormalizedEntry, ApprovalRequest, AgentStatusPayload, AgentStoppedPayload } from './agent-types.js';
import type { SupervisorStatus } from './execution-types.js';
import type { CommanderState, Decision, CommanderConfig } from './commander-types.js';
import type { ExecutionStartedPayload, ExecutionCompletedPayload, ExecutionFailedPayload } from './ws-protocol.js';

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------
export type SSEEventType =
  | 'board:full'
  | 'phase:updated'
  | 'task:updated'
  | 'scratch:updated'
  | 'project:updated'
  | 'watcher:error'
  | 'heartbeat'
  | 'connected'
  | 'agent:spawned'
  | 'agent:entry'
  | 'agent:approval'
  | 'agent:status'
  | 'agent:stopped'
  | 'agent:turnCompleted'
  | 'execution:started'
  | 'execution:completed'
  | 'execution:failed'
  | 'supervisor:status'
  | 'commander:status'
  | 'commander:tick'
  | 'commander:decision'
  | 'commander:config'
  | 'workspace:switched';

// ---------------------------------------------------------------------------
// Core interfaces — derived from fusion-design.md JSON schemas
// ---------------------------------------------------------------------------

/** Mirrors state.json — top-level project state */
export interface ProjectState {
  version: string;
  project_name: string;
  current_milestone: string;
  current_phase: number;
  status: ProjectStatus;
  phases_summary: {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
  };
  last_updated: string;
  accumulated_context: {
    key_decisions: string[];
    blockers: string[];
    deferred: string[];
  };
}

/** Mirrors index.json — one phase in the lifecycle pipeline */
export interface PhaseCard {
  phase: number;
  slug: string;
  title: string;
  status: PhaseStatus;
  created_at: string;
  updated_at: string;
  goal: string;
  success_criteria: string[];
  requirements: string[];
  spec_ref: string | null;
  plan: {
    task_ids: string[];
    task_count: number;
    complexity: string | null;
    waves: number[][];
  };
  execution: {
    method: string;
    started_at: string | null;
    completed_at: string | null;
    tasks_completed: number;
    tasks_total: number;
    current_wave: number;
    commits: string[];
  };
  verification: {
    status: string;
    verified_at: string | null;
    must_haves: string[];
    gaps: string[];
  };
  validation: {
    status: string;
    test_coverage: number | null;
    gaps: string[];
  };
  uat: {
    status: string;
    test_count: number;
    passed: number;
    gaps: string[];
  };
  reflection: {
    rounds: number;
    strategy_adjustments: string[];
  };
}

/** Mirrors TASK-*.json — a task within a phase */
export interface TaskCard {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: string;
  effort: string;
  action: string;
  scope: string;
  focus_paths: string[];
  depends_on: string[];
  parallel_group: string | null;
  convergence: {
    criteria: string[];
    verification: string;
    definition_of_done: string;
  };
  files: Array<{
    path: string;
    action: string;
    target: string;
    change: string;
  }>;
  implementation: string[];
  test: {
    commands: string[];
    unit: string[];
    integration: string[];
    success_metrics: string[];
  };
  reference: {
    pattern: string;
    files: string[];
    examples: string | null;
  };
  rationale: {
    chosen_approach: string;
    decision_factors: string[];
    tradeoffs: string | null;
  };
  risks: string[];
  code_skeleton: string | null;
  doc_context: {
    affected_features: string[];
    affected_components: string[];
    affected_requirements: string[];
    adr_ids: string[];
  };
  meta: {
    status: TaskStatus;
    estimated_time: string | null;
    risk: string;
    autonomous: boolean;
    checkpoint: boolean;
    wave: number;
    execution_group: string | null;
    executor: string;
  };
}

/** Non-phase scratch tasks (from scratch-index.json) */
export interface ScratchCard {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  created_at: string;
  updated_at: string;
  description: string;
  files: string[];
}

/** Full board state — assembled by the server from .workflow/ files */
export interface BoardState {
  project: ProjectState;
  phases: PhaseCard[];
  scratch: ScratchCard[];
  lastUpdated: string;
}

/** SSE event envelope */
export interface SSEEvent {
  type: SSEEventType;
  data: BoardState | PhaseCard | TaskCard | ScratchCard | ProjectState | AgentProcess | NormalizedEntry | ApprovalRequest | AgentStatusPayload | AgentStoppedPayload | ExecutionStartedPayload | ExecutionCompletedPayload | ExecutionFailedPayload | SupervisorStatus | CommanderState | Decision | CommanderConfig | { workspace: string } | string | null;
  timestamp: string;
}
