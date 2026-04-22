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

// ---------------------------------------------------------------------------
// Collab Task types
// ---------------------------------------------------------------------------

export type CollabTaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
export type CollabTaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type CollabCheckAction = 'confirm' | 'reject' | 'comment';

export interface CollabCheckEntry {
  ts: string;
  author: string;
  action: CollabCheckAction;
  comment?: string;
}

export interface CollabTask {
  id: string;
  title: string;
  description: string;
  status: CollabTaskStatus;
  priority: CollabTaskPriority;
  assignee: string | null;
  reporter: string | null;
  tags: string[];
  check_log: CollabCheckEntry[];
  created_at: string;
  updated_at: string;
}

export const COLLAB_TASK_STATUS_COLORS: Record<CollabTaskStatus, string> = {
  backlog: '#9ca3af',
  todo: '#60a5fa',
  in_progress: '#a78bfa',
  review: '#f59e0b',
  done: '#22c55e',
} as const;

export const COLLAB_TASK_PRIORITY_COLORS: Record<CollabTaskPriority, string> = {
  low: '#9ca3af',
  medium: '#60a5fa',
  high: '#f59e0b',
  critical: '#ef4444',
} as const;

export const COLLAB_TASK_COLUMNS: { id: CollabTaskStatus; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: COLLAB_TASK_STATUS_COLORS.backlog },
  { id: 'todo', label: 'To Do', color: COLLAB_TASK_STATUS_COLORS.todo },
  { id: 'in_progress', label: 'In Progress', color: COLLAB_TASK_STATUS_COLORS.in_progress },
  { id: 'review', label: 'Review', color: COLLAB_TASK_STATUS_COLORS.review },
  { id: 'done', label: 'Done', color: COLLAB_TASK_STATUS_COLORS.done },
];

/** Allowed status transitions per current status */
export const COLLAB_TASK_TRANSITIONS: Record<CollabTaskStatus, CollabTaskStatus[]> = {
  backlog: ['todo'],
  todo: ['in_progress', 'backlog'],
  in_progress: ['review', 'todo'],
  review: ['done', 'in_progress'],
  done: ['review'],
};
