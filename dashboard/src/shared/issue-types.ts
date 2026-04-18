// ---------------------------------------------------------------------------
// Issue type system -- types for the Issue tracking feature
// ---------------------------------------------------------------------------

import type { AgentType } from './agent-types.js';
import type { IssueExecution, PromptMode } from './execution-types.js';

/** Issue classification */
export type IssueType = 'bug' | 'feature' | 'improvement' | 'task';

/** Issue priority levels */
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent';

/** Issue lifecycle status */
export type IssueStatus = 'open' | 'registered' | 'in_progress' | 'resolved' | 'closed' | 'deferred';

// ---------------------------------------------------------------------------
// Solution — pre-planned execution steps (from /issue:plan)
// ---------------------------------------------------------------------------

/** A single step in an issue solution plan */
export interface SolutionStep {
  description: string;
  target?: string;        // file or module target
  verification?: string;  // how to verify this step
}

/** Pre-planned solution attached to an issue */
export interface IssueSolution {
  steps: SolutionStep[];
  context?: string;          // exploration context, key files
  promptTemplate?: string;   // custom prompt template (Liquid syntax)
  chain?: string;            // chain graph ID (e.g., 'issue-lifecycle') — routes execution through GraphWalker
  chainMode?: 'full' | 'plan-execute' | 'direct';  // chain entry mode (default: 'full')
  planned_at?: string;       // ISO timestamp when solution was planned
  planned_by?: string;       // agent or user who created the plan
}

// ---------------------------------------------------------------------------
// Analysis — structured root cause analysis (from /issue:analyze)
// ---------------------------------------------------------------------------

/** Structured root cause analysis record attached to an issue */
export interface IssueAnalysis {
  root_cause: string;           // identified root cause description
  impact: string;               // impact assessment
  related_files: string[];      // files related to the issue
  confidence: number;           // 0-1 confidence score
  suggested_approach: string;   // recommended fix approach
  analyzed_at: string;          // ISO timestamp
  analyzed_by: string;          // agent or user who performed analysis
}

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

/** Issue resolution path */
export type IssuePath = 'standalone' | 'workflow';

/** Full Issue record (stored in JSONL) */
export interface Issue {
  id: string;
  title: string;
  description: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  executor?: AgentType;
  promptMode?: PromptMode;
  solution?: IssueSolution;
  analysis?: IssueAnalysis;
  execution?: IssueExecution;
  path?: IssuePath;
  phase_id?: number;
  source_entry_id?: string;
  source_process_id?: string;
  created_at: string;
  updated_at: string;
}

/** Request body for creating a new issue */
export interface CreateIssueRequest {
  title: string;
  description: string;
  type?: IssueType;
  priority?: IssuePriority;
  executor?: AgentType;
  source_entry_id?: string;
  source_process_id?: string;
}

/** Request body for updating an existing issue */
export interface UpdateIssueRequest {
  title?: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  status?: IssueStatus;
  executor?: AgentType;
  promptMode?: PromptMode;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export const VALID_ISSUE_TYPES: ReadonlySet<string> = new Set<string>([
  'bug', 'feature', 'improvement', 'task',
]);

export const VALID_ISSUE_PRIORITIES: ReadonlySet<string> = new Set<string>([
  'low', 'medium', 'high', 'urgent',
]);

export const VALID_ISSUE_STATUSES: ReadonlySet<string> = new Set<string>([
  'open', 'registered', 'in_progress', 'resolved', 'closed', 'deferred',
]);
