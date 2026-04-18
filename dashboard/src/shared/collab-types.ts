// ---------------------------------------------------------------------------
// Collab Types — shared between server and client for human collaboration
// ---------------------------------------------------------------------------

export interface CollabMember {
  uid: string;
  name: string;
  email: string;
  status: 'online' | 'offline' | 'away';
  currentPhase?: string;
  currentTask?: string;
  lastSeen: string;
  joinedAt: string;
  role: string;
  host: string;
}

export interface CollabActivityEntry {
  ts: string;
  user: string;
  host: string;
  action: string;
  phase_id?: string;
  task_id?: string;
  target?: string;
}

export interface CollabPresence {
  uid: string;
  name: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: string;
}

export interface CollabAggregatedActivity {
  phase: string;
  task: string;
  count: number;
  members: string[];
  risk: 'none' | 'low' | 'medium' | 'high';
}

export interface CollabPreflightResult {
  exists: boolean;
  memberCount: number;
  hasActivity: boolean;
}

export const COLLAB_STATUS_COLORS: Record<'online' | 'offline' | 'away', string> = {
  online: '#22c55e',
  offline: '#9ca3af',
  away: '#eab308',
} as const;

/** Color per activity action type — shared across components */
export const COLLAB_ACTION_COLORS: Record<string, string> = {
  join: '#22c55e',
  phase_change: '#a78bfa',
  task_update: '#34d399',
  message: '#60a5fa',
  discussion: '#60a5fa',
  report: '#f59e0b',
  sync: '#06b6d4',
} as const;
