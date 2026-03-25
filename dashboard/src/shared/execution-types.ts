// ---------------------------------------------------------------------------
// Execution system types — orchestrator state, supervisor config, slots
// ---------------------------------------------------------------------------

import type { AgentType } from './agent-types.js';

// ---------------------------------------------------------------------------
// Execution slot — tracks a running agent for an issue
// ---------------------------------------------------------------------------

export interface ExecutionSlot {
  issueId: string;
  processId: string;
  executor: AgentType;
  startedAt: string;
  lastActivityAt: string;
  /** Current turn number (1-based) for multi-turn continuation */
  turnNumber: number;
  /** Maximum turns allowed for this execution */
  maxTurns: number;
}

// ---------------------------------------------------------------------------
// Issue execution state — embedded in Issue record
// ---------------------------------------------------------------------------

export type IssueExecutionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying';

export interface ExecutionResult {
  summary?: string;     // Agent's completion summary
  commitHash?: string;  // Git commit created by agent
  prUrl?: string;       // PR URL if created
  filesChanged?: number;
}

export interface IssueExecution {
  status: IssueExecutionStatus;
  processId?: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  lastError?: string;
  result?: ExecutionResult;
}

// ---------------------------------------------------------------------------
// Prompt & supervisor configuration
// ---------------------------------------------------------------------------

export type PromptMode = 'direct' | 'skill' | 'template' | 'decompose' | 'assessment' | 'custom';
export type DispatchStrategyName = 'priority' | 'smart' | 'commander';
/** @deprecated Use DispatchStrategyName */
export type SupervisorStrategy = DispatchStrategyName;

export interface WorkspacePolicy {
  /** Enable per-issue workspace isolation */
  enabled: boolean;
  /** Use git worktree (true) or plain directory (false) */
  useWorktree: boolean;
  /** Auto-cleanup workspaces after completion */
  autoCleanup: boolean;
  /** Strict mode: fail execution if workspace creation fails (instead of falling back to cwd) */
  strict: boolean;
}

export interface SchedulerConfig {
  enabled: boolean;
  strategy: DispatchStrategyName;
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  stallTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  defaultPromptMode: PromptMode;
  defaultExecutor: AgentType;
  workspace: WorkspacePolicy;
  /** Maximum continuation turns per issue for codex-server (default 3) */
  maxTurnsPerIssue?: number;
}
/** @deprecated Use SchedulerConfig */
export type SupervisorConfig = SchedulerConfig;

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  strategy: 'priority',
  pollIntervalMs: 30_000,
  maxConcurrentAgents: 3,
  stallTimeoutMs: 300_000,
  maxRetries: 2,
  retryBackoffMs: 60_000,
  defaultPromptMode: 'direct',
  defaultExecutor: 'claude-code',
  workspace: {
    enabled: false,
    useWorktree: true,
    autoCleanup: true,
    strict: false,
  },
};
/** @deprecated Use DEFAULT_SCHEDULER_CONFIG */
export const DEFAULT_SUPERVISOR_CONFIG: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG;

// ---------------------------------------------------------------------------
// Scheduler runtime status snapshot
// ---------------------------------------------------------------------------

export interface SchedulerStatus {
  enabled: boolean;
  running: ExecutionSlot[];
  queued: string[];
  retrying: { issueId: string; retryAt: string }[];
  lastTickAt: string | null;
  isCommanderActive: boolean;
  stats: {
    totalDispatched: number;
    totalCompleted: number;
    totalFailed: number;
  };
  tokenUsage?: {
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}
/** @deprecated Use SchedulerStatus */
export type SupervisorStatus = SchedulerStatus;

// ---------------------------------------------------------------------------
// Supervisor tab discriminator
// ---------------------------------------------------------------------------

export type SupervisorTab =
  | 'monitor'
  | 'commander'
  | 'coordinator'
  | 'prompts'
  | 'extensions'
  | 'learning'
  | 'schedule';
