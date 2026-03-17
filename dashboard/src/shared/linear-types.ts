// ---------------------------------------------------------------------------
// Linear API types -- shared between server and client
// ---------------------------------------------------------------------------

/** Linear workflow state (maps to kanban columns) */
export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string; // 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
  color: string;
  position: number;
}

/** Linear issue label */
export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

/** Linear user (assignee) */
export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Linear issue priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low */
export type LinearPriority = 0 | 1 | 2 | 3 | 4;

export const LINEAR_PRIORITY_LABELS: Record<LinearPriority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const LINEAR_PRIORITY_COLORS: Record<LinearPriority, string> = {
  0: '#A09D97',
  1: '#C46555',
  2: '#B89540',
  3: '#5B8DB8',
  4: '#A09D97',
};

/** Linear issue -- flattened from GraphQL response */
export interface LinearIssue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  description: string | null;
  priority: LinearPriority;
  state: LinearWorkflowState;
  assignee: LinearUser | null;
  labels: LinearLabel[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** Linear team info */
export interface LinearTeam {
  id: string;
  name: string;
  key: string; // e.g. "ENG"
}

/** Kanban column definition for Linear workflow states */
export interface LinearKanbanColumn {
  id: string;
  name: string;
  type: string;
  color: string;
  issues: LinearIssue[];
}

/** Full Linear board state returned by the API */
export interface LinearBoardState {
  team: LinearTeam | null;
  columns: LinearKanbanColumn[];
  totalIssues: number;
}
