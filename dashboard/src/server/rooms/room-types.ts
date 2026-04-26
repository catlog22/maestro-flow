// ---------------------------------------------------------------------------
// Room Types — internal types for meeting room subsystems
// ---------------------------------------------------------------------------

// --- Mailbox types ---

export type MessagePriority = 'normal' | 'high' | 'urgent';

export interface RoomMailboxMessage {
  id: string;
  sessionId: string;
  from: string;
  to: string;           // agent role or '*' for broadcast
  content: string;
  priority: MessagePriority;
  read: boolean;
  createdAt: string;
}

// --- Task board types ---

export type RoomTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export interface RoomTask {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  status: RoomTaskStatus;
  owner?: string;        // agent role
  blockedBy: string[];   // task IDs this task depends on
  blocks: string[];      // task IDs that depend on this task
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

// --- Agent registry types ---

export type RoomAgentStatus = 'idle' | 'active' | 'busy' | 'error' | 'offline';

export interface RoomAgent {
  role: string;
  processId?: string;    // linked dashboard agent process ID
  status: RoomAgentStatus;
  joinedAt: string;
  lastActivityAt: string;
}

// --- Session types ---

export type RoomSessionStatus = 'active' | 'paused' | 'destroyed';

export interface RoomSessionSnapshot {
  sessionId: string;
  status: RoomSessionStatus;
  agents: RoomAgent[];
  messages: RoomMailboxMessage[];
  tasks: RoomTask[];
  createdAt: string;
}
