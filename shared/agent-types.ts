// ---------------------------------------------------------------------------
// Agent type system — protocol abstraction for CLI agent processes
//
// CANONICAL source of truth for all agent types. Both the maestro CLI (src/)
// and dashboard (dashboard/src/) import from this file.
// ---------------------------------------------------------------------------

/** Supported agent CLI types */
export type AgentType = 'claude-code' | 'codex' | 'codex-server' | 'gemini' | 'gemini-a2a' | 'qwen' | 'opencode' | 'agent-sdk';

/** Agent process lifecycle status */
export type AgentProcessStatus =
  | 'spawning'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

// ---------------------------------------------------------------------------
// Agent configuration & process
// ---------------------------------------------------------------------------

/** Configuration for spawning an agent process */
export interface AgentConfig {
  type: AgentType;
  prompt: string;
  workDir: string;
  env?: Record<string, string>;
  model?: string;
  approvalMode?: 'suggest' | 'auto';
  baseUrl?: string;
  apiKey?: string;
  settingsFile?: string;
  /** Path to .env file for loading environment variables before spawn */
  envFile?: string;
  /** When true, spawn in interactive mode (stdin kept open for follow-up messages) */
  interactive?: boolean;
  /** Path to MCP config JSON file for CLI agents (claude-code --mcp-config) */
  mcpConfigPath?: string;
  /** Opaque metadata bag — used to pass team session context through the spawn pipeline */
  metadata?: Record<string, unknown>;
}

/** Runtime state of a spawned agent process */
export interface AgentProcess {
  id: string;
  type: AgentType;
  status: AgentProcessStatus;
  config: AgentConfig;
  startedAt: string;
  pid?: number;
  /** Whether the agent supports interactive follow-up messages */
  interactive?: boolean;
  /** Opaque metadata from config — carries team session context etc. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// NormalizedEntry — 11-type discriminated union for unified agent output
// ---------------------------------------------------------------------------

/** Base fields shared by all normalized entries */
export interface NormalizedEntryBase {
  id: string;
  processId: string;
  timestamp: string;
}

/** All possible entry type discriminators */
export type EntryType =
  | 'user_message'
  | 'assistant_message'
  | 'thinking'
  | 'tool_use'
  | 'file_change'
  | 'command_exec'
  | 'approval_request'
  | 'approval_response'
  | 'error'
  | 'status_change'
  | 'token_usage';

// --- Individual entry types ------------------------------------------------

export interface UserMessageEntry extends NormalizedEntryBase {
  type: 'user_message';
  content: string;
}

export interface AssistantMessageEntry extends NormalizedEntryBase {
  type: 'assistant_message';
  content: string;
  partial: boolean;
}

export interface ThinkingEntry extends NormalizedEntryBase {
  type: 'thinking';
  content: string;
}

export interface ToolUseEntry extends NormalizedEntryBase {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export interface FileChangeEntry extends NormalizedEntryBase {
  type: 'file_change';
  path: string;
  action: 'create' | 'modify' | 'delete';
  diff?: string;
}

export interface CommandExecEntry extends NormalizedEntryBase {
  type: 'command_exec';
  command: string;
  exitCode?: number;
  output?: string;
}

export interface ApprovalRequestEntry extends NormalizedEntryBase {
  type: 'approval_request';
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
}

export interface ApprovalResponseEntry extends NormalizedEntryBase {
  type: 'approval_response';
  requestId: string;
  allowed: boolean;
}

export interface ErrorEntry extends NormalizedEntryBase {
  type: 'error';
  message: string;
  code?: string;
}

export interface StatusChangeEntry extends NormalizedEntryBase {
  type: 'status_change';
  status: AgentProcessStatus;
  reason?: string;
}

export interface TokenUsageEntry extends NormalizedEntryBase {
  type: 'token_usage';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Discriminated union of all 11 normalized entry types */
export type NormalizedEntry =
  | UserMessageEntry
  | AssistantMessageEntry
  | ThinkingEntry
  | ToolUseEntry
  | FileChangeEntry
  | CommandExecEntry
  | ApprovalRequestEntry
  | ApprovalResponseEntry
  | ErrorEntry
  | StatusChangeEntry
  | TokenUsageEntry;

// ---------------------------------------------------------------------------
// Agent event payload types (used in WS/SSE event envelopes)
// ---------------------------------------------------------------------------

/** Thought data from agent reasoning */
export interface ThoughtData {
  subject: string;
  description: string;
}

/** Payload for agent:thought events */
export interface AgentThoughtPayload {
  processId: string;
  thought: ThoughtData;
}

/** Payload for agent:streaming events */
export interface AgentStreamingPayload {
  processId: string;
  streaming: boolean;
}

/** Payload for agent:status events */
export interface AgentStatusPayload {
  processId: string;
  status: AgentProcessStatus;
  reason?: string;
}

/** Payload for agent:stopped events */
export interface AgentStoppedPayload {
  processId: string;
  reason?: string;
}

/** Payload for agent:turnCompleted events (codex-server multi-turn) */
export interface AgentTurnCompletedPayload {
  processId: string;
}

// ---------------------------------------------------------------------------
// Approval workflow types
// ---------------------------------------------------------------------------

/** Server-side approval request (sent to client for user decision) */
export interface ApprovalRequest {
  id: string;
  processId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: string;
}

/** Client-side approval decision (sent back to server) */
export interface ApprovalDecision {
  id: string;
  allow: boolean;
  processId: string;
}
