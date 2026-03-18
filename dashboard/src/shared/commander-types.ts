// ---------------------------------------------------------------------------
// Commander Agent types — config, state, assessment, and decision interfaces
// ---------------------------------------------------------------------------

import type { AgentType } from './agent-types.js';
import type { WorkspacePolicy } from './execution-types.js';

// ---------------------------------------------------------------------------
// Commander configuration
// ---------------------------------------------------------------------------

export interface CommanderSafetyConfig {
  /** Event debounce interval (ms) */
  eventDebounceMs: number;
  /** Auto-pause after N consecutive failures */
  circuitBreakerThreshold: number;
  /** Max ticks per hour (prevent runaway loops) */
  maxTicksPerHour: number;
  /** Max token budget per hour */
  maxTokensPerHour: number;
  /** File globs that Commander must not operate on */
  protectedPaths: string[];
}

export interface CommanderConfig {
  // --- Core Loop ---
  /** Tick interval (ms). Lower = more aggressive */
  pollIntervalMs: number;
  /** Maximum concurrent worker agents */
  maxConcurrentWorkers: number;
  /** Worker timeout (ms), marks stalled after this */
  stallTimeoutMs: number;
  /** Max retries per issue */
  maxRetries: number;
  /** Retry backoff interval (ms) */
  retryBackoffMs: number;

  // --- Decision ---
  /** Model used for assessment queries */
  decisionModel: 'haiku' | 'sonnet' | 'opus';
  /** Max exploration turns for assessment */
  assessMaxTurns: number;
  /** Auto-approve risk threshold: low=only low risk, medium=incl medium, high=fully auto */
  autoApproveThreshold: 'low' | 'medium' | 'high';
  /** Default executor agent type */
  defaultExecutor: AgentType;

  // --- Safety ---
  safety: CommanderSafetyConfig;

  // --- Workspace ---
  workspace: WorkspacePolicy;

  // --- Environment Profile ---
  /** Preset environment profile, overrides specific fields */
  profile: 'development' | 'staging' | 'production' | 'custom';
}

// ---------------------------------------------------------------------------
// Commander runtime state
// ---------------------------------------------------------------------------

export interface CommanderState {
  status: 'idle' | 'thinking' | 'dispatching' | 'paused';
  lastTickAt: string;
  lastDecision: Decision | null;
  activeWorkers: number;
  sessionId: string;
  tickCount: number;
}

// ---------------------------------------------------------------------------
// Assessment — output of Agent SDK read-only evaluation
// ---------------------------------------------------------------------------

export interface PriorityAction {
  type: 'execute_issue' | 'create_issue' | 'advance_phase' | 'flag_blocker';
  /** Target identifier (ISS-xxx or phase-slug) */
  target: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  /** Executor agent type identifier */
  executor: string;
}

export interface Assessment {
  priority_actions: PriorityAction[];
  observations: string[];
  risks: string[];
}

// ---------------------------------------------------------------------------
// Decision — deterministic output of the decide step (no LLM)
// ---------------------------------------------------------------------------

export interface Decision {
  id: string;
  timestamp: string;
  /** What triggered this decision (scheduled_tick, issue:created, etc.) */
  trigger: string;
  assessment: Assessment;
  /** Actions approved by threshold + capacity filter */
  actions: PriorityAction[];
  /** Actions blocked by capacity or threshold */
  deferred: PriorityAction[];
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_COMMANDER_CONFIG: CommanderConfig = {
  // Core Loop
  pollIntervalMs: 30_000,
  maxConcurrentWorkers: 3,
  stallTimeoutMs: 300_000,
  maxRetries: 2,
  retryBackoffMs: 60_000,

  // Decision
  decisionModel: 'sonnet',
  assessMaxTurns: 5,
  autoApproveThreshold: 'low',
  defaultExecutor: 'claude-code',

  // Safety
  safety: {
    eventDebounceMs: 5_000,
    circuitBreakerThreshold: 3,
    maxTicksPerHour: 120,
    maxTokensPerHour: 500_000,
    protectedPaths: ['.env', '.env.*', '*.key', '*.pem', 'credentials.*'],
  },

  // Workspace
  workspace: {
    enabled: false,
    useWorktree: true,
    autoCleanup: true,
    strict: false,
  },

  // Profile
  profile: 'development',
};
