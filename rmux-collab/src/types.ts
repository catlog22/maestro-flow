import type { Pane, PaneSet, Session, Rmux } from '@rmux/sdk';
import type { RetryConfig } from './middleware/retry.js';

// ===== Agent =====

export type AgentTool = 'claude' | 'codex' | 'gemini' | 'opencode' | 'shell';

export interface AgentConfig {
  name: string;
  tool: AgentTool;
  model?: string;
  settings?: string;
  completionMarker?: string | RegExp;
  launchCommand?: string;
  cwd?: string;
}

export interface OutputSegment {
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'intermediate' | 'final';
  content: string;
}

export interface AgentResult {
  agent: string;
  status: 'completed' | 'timeout' | 'degraded' | 'error';
  confidence: 'exact' | 'observed' | 'degraded';
  output: string;
  raw: string;
  segments: OutputSegment[];
  error?: string;
  duration_ms: number;
}

// ===== Channel =====

export interface ChannelConfig {
  name: string;
  agents: AgentConfig[];
  cwd?: string;
  visible?: boolean;
}

// ===== Coordinator =====

export interface CoordinatorConfig {
  channels?: ChannelConfig[];
  logFile?: string;
  monitor?: boolean;
}

// ===== Patterns =====

export interface PipelineStage {
  agent: { name: string; ask: (prompt: string, opts?: AskOptions) => Promise<AgentResult> };
  transform?: (prevOutput: string) => string;
}

export interface DialogueConfig {
  agents: { name: string; ask: (prompt: string, opts?: AskOptions) => Promise<AgentResult> }[];
  topic: string;
  maxRounds: number;
  shouldContinue?: (round: number, messages: DialogueMessage[]) => boolean;
}

export interface DialogueMessage {
  from: string;
  content: string;
  round: number;
}

// ===== Options =====

export interface AskOptions {
  timeout?: number;
  pasteThreshold?: number;
  retry?: RetryConfig;
}

// ===== Logging =====

export interface InteractionLog {
  timestamp: number;
  channel: string;
  agent: string;
  direction: 'send' | 'receive';
  content: string;
  duration_ms?: number;
  status?: 'completed' | 'timeout' | 'degraded' | 'error';
  confidence?: 'exact' | 'observed' | 'degraded';
}

export type { Pane, PaneSet, Session, Rmux };
