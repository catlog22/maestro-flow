import type { Pane, PaneSet, Session, Rmux } from '@rmux/sdk';

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

export interface AgentResult {
  agent: string;
  output: string;
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
}

// ===== Patterns =====

export interface PipelineStage {
  agent: { name: string; ask: (prompt: string, opts?: AskOptions) => Promise<string> };
  transform?: (prevOutput: string) => string;
}

export interface DialogueConfig {
  agents: { name: string; ask: (prompt: string, opts?: AskOptions) => Promise<string> }[];
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
}

// ===== Logging =====

export interface InteractionLog {
  timestamp: number;
  channel: string;
  agent: string;
  direction: 'send' | 'receive';
  content: string;
  duration_ms?: number;
}

export type { Pane, PaneSet, Session, Rmux };
