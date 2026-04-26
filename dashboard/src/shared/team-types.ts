// ---------------------------------------------------------------------------
// Team Session Types — shared between server and client
// ---------------------------------------------------------------------------

export interface PipelineNode {
  id: string;
  name: string;
  status: 'done' | 'in_progress' | 'pending' | 'skipped';
  wave?: number;
}

export interface TeamRole {
  name: string;
  prefix: string;
  status: 'done' | 'active' | 'pending' | 'injected';
  taskCount: number;
  innerLoop: boolean;
  injected?: boolean;
  injectionReason?: string;
}

export interface TeamMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface SessionFileEntry {
  id: string;
  path: string;
  name: string;
  category: 'artifacts' | 'role-specs' | 'session' | 'wisdom' | 'message-bus';
  status?: string;
  isNew?: boolean;
}

export interface TeamSessionSummary {
  sessionId: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'failed' | 'archived';
  skill: string;
  roles: string[];
  taskProgress: { completed: number; total: number };
  messageCount: number;
  duration: string;
  createdAt: string;
  updatedAt: string;
  pipelineStages: PipelineNode[];
}

export interface TeamSessionDetail extends TeamSessionSummary {
  roleDetails: TeamRole[];
  messages: TeamMessage[];
  files: SessionFileEntry[];
  pipeline: { waves: { number: number; nodes: PipelineNode[] }[] };
}

// ---------------------------------------------------------------------------
// Skill prefix → label mapping
// ---------------------------------------------------------------------------

export const SKILL_PREFIX_MAP: Record<string, string> = {
  'TC-': 'Coordinate',
  'TLV4-': 'Lifecycle',
  'QA-': 'QA',
  'RV-': 'Review',
  'TST-': 'Testing',
  'TFD-': 'Frontend Debug',
  'TPO-': 'Perf Opt',
  'TTD-': 'Tech Debt',
  'TPX-': 'Plan & Execute',
  'TBS-': 'Brainstorm',
  'TRD-': 'Roadmap Dev',
  'TIS-': 'Issue',
  'TID-': 'Iter Dev',
  'TUA-': 'Ultra Analyze',
  'TUX-': 'UX Improve',
  'TUI-': 'UI Design',
  'TAO-': 'Arch Opt',
} as const;

export function inferSkill(sessionId: string): string {
  for (const [prefix, label] of Object.entries(SKILL_PREFIX_MAP)) {
    if (sessionId.startsWith(prefix)) return label;
  }
  return 'Team';
}

// ---------------------------------------------------------------------------
// Team real-time event types — mailbox, phase, agent status
// ---------------------------------------------------------------------------

export type MailboxDispatchStatus = 'pending' | 'delivered' | 'acknowledged' | 'failed';

export interface TeamMailboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  dispatch_status: MailboxDispatchStatus;
  timestamp: string;
}

export type TeamPhaseName = 'initialization' | 'planning' | 'execution' | 'review' | 'completion';

export interface TeamPhaseState {
  current: TeamPhaseName;
  history: TeamPhaseName[];
  fixAttempts: number;
}

export type TeamAgentRoleStatus = 'idle' | 'active' | 'busy' | 'error' | 'offline';

export interface TeamAgentStatus {
  role: string;
  status: TeamAgentRoleStatus;
  lastActivity: string;
}

// ---------------------------------------------------------------------------
// Room Session Types — shared between server and client
// ---------------------------------------------------------------------------

export type RoomAgentStatus = 'idle' | 'active' | 'busy' | 'error' | 'offline';

export interface RoomAgent {
  role: string;
  processId?: string;
  status: RoomAgentStatus;
  joinedAt: string;
  lastActivityAt: string;
}

export type RoomTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export interface RoomTask {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  status: RoomTaskStatus;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomTaskCreate {
  title: string;
  description: string;
  owner?: string;
  blockedBy?: string[];
}

export interface RoomTaskUpdate {
  title?: string;
  description?: string;
  status?: RoomTaskStatus;
  owner?: string;
}

export type RoomMessagePriority = 'normal' | 'high' | 'urgent';

export interface RoomMailboxMessage {
  id: string;
  sessionId: string;
  from: string;
  to: string;
  content: string;
  priority: RoomMessagePriority;
  read: boolean;
  createdAt: string;
}

export type RoomSessionStatus = 'active' | 'paused' | 'destroyed';

export interface RoomSessionSnapshot {
  sessionId: string;
  status: RoomSessionStatus;
  agents: RoomAgent[];
  messages: RoomMailboxMessage[];
  tasks: RoomTask[];
  createdAt: string;
}

export interface RoomSessionSummary {
  sessionId: string;
  status: RoomSessionStatus;
  agentCount: number;
  taskCount: number;
  messageCount: number;
  createdAt: string;
}

export interface RoomSessionConfig {
  sessionId: string;
  roles: string[];
  autoMode?: boolean;
}

// ---------------------------------------------------------------------------
// Status colors for team sessions
// ---------------------------------------------------------------------------

export const TEAM_STATUS_COLORS: Record<TeamSessionSummary['status'], string> = {
  active: '#B89540',
  completed: '#5A9E78',
  failed: '#C46555',
  archived: '#A09D97',
} as const;

export const PIPELINE_STATUS_COLORS: Record<PipelineNode['status'], string> = {
  done: '#5A9E78',
  in_progress: '#B89540',
  pending: '#A09D97',
  skipped: '#D1CEC8',
} as const;

export const ROLE_STATUS_COLORS: Record<TeamRole['status'], string> = {
  done: '#5A9E78',
  active: '#B89540',
  pending: '#A09D97',
  injected: '#8B6BBF',
} as const;

export const AGENT_STATUS_COLORS: Record<TeamAgentRoleStatus, string> = {
  idle: '#A09D97',
  active: '#4A90D9',
  busy: '#B89540',
  error: '#C46555',
  offline: '#6B6860',
} as const;
