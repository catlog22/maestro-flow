import type { PhaseStatus, TaskStatus, SSEEventType } from './types.js';
import type { WsEventType } from './ws-protocol.js';
import type { AgentType } from './agent-types.js';
import type { Issue } from './issue-types.js';

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

export const PHASE_STATUSES: readonly PhaseStatus[] = [
  'not_started',
  'pending',
  'exploring',
  'planning',
  'executing',
  'verifying',
  'testing',
  'completed',
  'blocked',
] as const;

export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
] as const;

// ---------------------------------------------------------------------------
// Kanban column configuration
// Collapsed view: 6 columns grouping the 9 statuses
// ---------------------------------------------------------------------------

export interface ColumnDefinition {
  id: string;
  label: string;
  statuses: readonly PhaseStatus[];
}

export const COLLAPSED_COLUMNS: readonly ColumnDefinition[] = [
  { id: 'backlog', label: 'Backlog', statuses: ['not_started', 'pending'] },
  { id: 'triage', label: 'Triage', statuses: [] },
  { id: 'in-progress', label: 'In Progress', statuses: ['exploring', 'planning', 'executing'] },
  { id: 'review', label: 'Review', statuses: ['verifying', 'testing'] },
  { id: 'done', label: 'Done', statuses: ['completed', 'blocked'] },
  { id: 'deferred', label: 'Deferred', statuses: [] },
] as const;

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export const SSE_EVENT_TYPES: Record<string, SSEEventType> = {
  BOARD_FULL: 'board:full',
  PHASE_UPDATED: 'phase:updated',
  TASK_UPDATED: 'task:updated',
  SCRATCH_UPDATED: 'scratch:updated',
  PROJECT_UPDATED: 'project:updated',
  WATCHER_ERROR: 'watcher:error',
  HEARTBEAT: 'heartbeat',
  CONNECTED: 'connected',
  WORKSPACE_SWITCHED: 'workspace:switched',
  WIKI_INVALIDATED: 'wiki:invalidated',
  COLLAB_MEMBERS_UPDATED: 'collab:members_updated',
  COLLAB_ACTIVITY: 'collab:activity',
  // Team events
  TEAM_MESSAGE: 'team:message',
  TEAM_DISPATCH: 'team:dispatch',
  TEAM_PHASE: 'team:phase',
  TEAM_AGENT_STATUS: 'team:agent_status',
} as const;

// ---------------------------------------------------------------------------
// API endpoint paths
// ---------------------------------------------------------------------------

export const API_ENDPOINTS = {
  HEALTH: '/api/health',
  BOARD: '/api/board',
  PROJECT: '/api/project',
  PHASES: '/api/phases',
  PHASE: '/api/phases/:n',
  PHASE_TASKS: '/api/phases/:n/tasks',
  ARTIFACTS: '/api/artifacts',
  SCRATCH: '/api/scratch',
  SETTINGS: '/api/settings',
  SETTINGS_GENERAL: '/api/settings/general',
  SETTINGS_AGENTS: '/api/settings/agents',
  SETTINGS_CLI_TOOLS: '/api/settings/cli-tools',
  SETTINGS_SPECS: '/api/settings/specs',
} as const;

// ---------------------------------------------------------------------------
// Specs API endpoint paths
// ---------------------------------------------------------------------------

export const SPECS_API_ENDPOINTS = {
  SPECS: '/api/specs',
  SPECS_FILES: '/api/specs/files',
  SPECS_FILE: '/api/specs/file/:name',
} as const;

// ---------------------------------------------------------------------------
// Wiki API endpoint paths
// ---------------------------------------------------------------------------

export const WIKI_API_ENDPOINTS = {
  WIKI: '/api/wiki',
  WIKI_STATS: '/api/wiki/stats',
  WIKI_HEALTH: '/api/wiki/health',
  WIKI_GRAPH: '/api/wiki/graph',
  WIKI_ORPHANS: '/api/wiki/orphans',
  WIKI_HUBS: '/api/wiki/hubs',
  WIKI_DETAIL: '/api/wiki/:id',
  WIKI_BACKLINKS: '/api/wiki/:id/backlinks',
  WIKI_FORWARD: '/api/wiki/:id/forward',
} as const;

// ---------------------------------------------------------------------------
// MCP API endpoint paths
// ---------------------------------------------------------------------------

export const MCP_API_ENDPOINTS = {
  CONFIG: '/api/mcp-config',
  TOGGLE: '/api/mcp-toggle',
  COPY_SERVER: '/api/mcp-copy-server',
  REMOVE_SERVER: '/api/mcp-remove-server',
  ADD_GLOBAL: '/api/mcp-add-global-server',
  REMOVE_GLOBAL: '/api/mcp-remove-global-server',
  UPDATE_SERVER: '/api/mcp-update-server',
  INSTALL_MAESTRO: '/api/mcp-install-maestro',
  CODEX_CONFIG: '/api/codex-mcp-config',
  CODEX_ADD: '/api/codex-mcp-add',
  CODEX_REMOVE: '/api/codex-mcp-remove',
  CODEX_TOGGLE: '/api/codex-mcp-toggle',
  TEMPLATES: '/api/mcp-templates',
  TEMPLATES_SEARCH: '/api/mcp-templates/search',
  TEMPLATES_CATEGORIES: '/api/mcp-templates/categories',
  TEMPLATES_INSTALL: '/api/mcp-templates/install',
  DETECT_COMMANDS: '/api/mcp/detect-commands',
} as const;

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------

export const SSE_ENDPOINT = '/events';

// ---------------------------------------------------------------------------
// WebSocket event types (superset of SSE — includes agent events)
// ---------------------------------------------------------------------------

export const WS_EVENT_TYPES: Record<string, WsEventType> = {
  // Agent lifecycle events
  AGENT_SPAWNED: 'agent:spawned',
  AGENT_ENTRY: 'agent:entry',
  AGENT_APPROVAL: 'agent:approval',
  AGENT_STATUS: 'agent:status',
  AGENT_STOPPED: 'agent:stopped',
  AGENT_THOUGHT: 'agent:thought',
  AGENT_STREAMING: 'agent:streaming',
  // Execution events
  EXECUTION_STARTED: 'execution:started',
  EXECUTION_COMPLETED: 'execution:completed',
  EXECUTION_FAILED: 'execution:failed',
  EXECUTION_SCHEDULER_STATUS: 'execution:scheduler_status',
  SUPERVISOR_STATUS: 'supervisor:status',
  SUPERVISOR_LEARNING_UPDATE: 'supervisor:learning_update',
  SUPERVISOR_SCHEDULE_TRIGGERED: 'supervisor:schedule_triggered',
  SUPERVISOR_SCHEDULE_UPDATE: 'supervisor:schedule_update',
  SUPERVISOR_EXTENSION_LOADED: 'supervisor:extension_loaded',
  SUPERVISOR_EXTENSION_ERROR: 'supervisor:extension_error',
  // Commander events
  COMMANDER_STATUS: 'commander:status',
  COMMANDER_TICK: 'commander:tick',
  COMMANDER_DECISION: 'commander:decision',
  COMMANDER_CONFIG: 'commander:config',
  COMMANDER_ASSESS_METRICS: 'commander:assess_metrics',
  COMMANDER_ERROR: 'commander:error',
  // Coordinate events
  COORDINATE_STATUS: 'coordinate:status',
  COORDINATE_ANALYZE_METRICS: 'coordinate:analyze_metrics',
  COORDINATE_STEP: 'coordinate:step',
  COORDINATE_ANALYSIS: 'coordinate:analysis',
  COORDINATE_CLARIFICATION_NEEDED: 'coordinate:clarification_needed',
  COORDINATE_ERROR: 'coordinate:error',
  // Requirement events
  REQUIREMENT_EXPANDED: 'requirement:expanded',
  REQUIREMENT_REFINED: 'requirement:refined',
  REQUIREMENT_COMMITTED: 'requirement:committed',
  REQUIREMENT_PROGRESS: 'requirement:progress',
  // Board events (shared with SSE)
  BOARD_FULL: 'board:full',
  PHASE_UPDATED: 'phase:updated',
  TASK_UPDATED: 'task:updated',
  SCRATCH_UPDATED: 'scratch:updated',
  PROJECT_UPDATED: 'project:updated',
  WATCHER_ERROR: 'watcher:error',
  WORKSPACE_SWITCHED: 'workspace:switched',
  WIKI_INVALIDATED: 'wiki:invalidated',
  HEARTBEAT: 'heartbeat',
  CONNECTED: 'connected',
  COLLAB_MEMBERS_UPDATED: 'collab:members_updated',
  COLLAB_ACTIVITY: 'collab:activity',
  // Team events
  TEAM_MESSAGE: 'team:message',
  TEAM_DISPATCH: 'team:dispatch',
  TEAM_PHASE: 'team:phase',
  TEAM_AGENT_STATUS: 'team:agent_status',
  // Room events
  ROOM_CREATED: 'room:created',
  ROOM_CLOSED: 'room:closed',
  ROOM_AGENT_JOINED: 'room:agent_joined',
  ROOM_AGENT_LEFT: 'room:agent_left',
  ROOM_AGENT_STATUS: 'room:agent_status',
  ROOM_MESSAGE: 'room:message',
  ROOM_BROADCAST: 'room:broadcast',
  ROOM_TASK_CREATED: 'room:task_created',
  ROOM_TASK_UPDATED: 'room:task_updated',
  ROOM_PHASE_CHANGED: 'room:phase_changed',
  ROOM_SNAPSHOT: 'room:snapshot',
} as const;

// ---------------------------------------------------------------------------
// Agent API endpoint paths
// ---------------------------------------------------------------------------

export const AGENT_API_ENDPOINTS = {
  SPAWN: '/api/agent/spawn',
  STOP: '/api/agent/stop',
  MESSAGE: '/api/agent/message',
  APPROVE: '/api/agent/approve',
  LIST: '/api/agent/list',
  ENTRIES: '/api/agent/entries',
} as const;

// ---------------------------------------------------------------------------
// Issue API endpoint paths
// ---------------------------------------------------------------------------

export const ISSUE_API_ENDPOINTS = {
  ISSUES: '/api/issues',
  ISSUE: '/api/issues/:id',
} as const;

// ---------------------------------------------------------------------------
// Execution API endpoint paths
// ---------------------------------------------------------------------------

export const EXECUTION_API_ENDPOINTS = {
  DISPATCH: '/api/execution/dispatch',
  BATCH: '/api/execution/batch',
  CANCEL: '/api/execution/cancel',
  STATUS: '/api/execution/status',
  SUPERVISOR: '/api/execution/supervisor',
} as const;

// ---------------------------------------------------------------------------
// Linear API endpoint paths
// ---------------------------------------------------------------------------

export const LINEAR_API_ENDPOINTS = {
  STATUS: '/api/linear/status',
  TEAMS: '/api/linear/teams',
  BOARD: '/api/linear/board',
  IMPORT: '/api/linear/import',
  EXPORT: '/api/linear/export',
} as const;

// ---------------------------------------------------------------------------
// Team API endpoint paths
// ---------------------------------------------------------------------------

export const TEAM_API_ENDPOINTS = {
  SESSIONS: '/api/teams/sessions',
  SESSION: '/api/teams/sessions/:sessionId',
  SESSION_MESSAGES: '/api/teams/sessions/:sessionId/messages',
  SESSION_FILE: '/api/teams/sessions/:sessionId/files',
} as const;

// ---------------------------------------------------------------------------
// Collab API endpoint paths
// ---------------------------------------------------------------------------

export const COLLAB_API_ENDPOINTS = {
  MEMBERS: '/api/collab/members',
  ACTIVITY: '/api/collab/activity',
  STATUS: '/api/collab/status',
  AGGREGATED: '/api/collab/activity/aggregated',
  PREFLIGHT: '/api/collab/preflight',
} as const;

// ---------------------------------------------------------------------------
// WebSocket endpoint
// ---------------------------------------------------------------------------

export const WS_ENDPOINT = '/ws';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  serverPort: 3001,
  serverHost: '127.0.0.1',
  watchDebounceMs: 150,
  sseHeartbeatMs: 30_000,
  sseMaxConnections: 10,
} as const;

// ---------------------------------------------------------------------------
// CLI History directory name (shared constant for server-side path resolution)
// ---------------------------------------------------------------------------

export const CLI_HISTORY_DIR_NAME = 'cli-history';

// ---------------------------------------------------------------------------
// Install Wizard API endpoint paths
// ---------------------------------------------------------------------------

export const INSTALL_API_ENDPOINTS = {
  DETECT: '/api/install/detect',
  EXECUTE: '/api/install/execute',
  MANIFESTS: '/api/install/manifests',
} as const;

// ---------------------------------------------------------------------------
// Status colors (Linear-inspired design tokens)
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<PhaseStatus, string> = {
  not_started: '#A09D97',
  pending: '#A09D97',
  exploring: '#5B8DB8',
  planning: '#9178B5',
  executing: '#B89540',
  verifying: '#C8863A',
  testing: '#5B8DB8',
  completed: '#5A9E78',
  blocked: '#C46555',
} as const;

// ---------------------------------------------------------------------------
// Agent display constants (dot colors & labels)
// ---------------------------------------------------------------------------

export const AGENT_DOT_COLORS: Record<AgentType, string> = {
  'claude-code': 'var(--color-accent-purple)',
  'codex': 'var(--color-accent-green)',
  'codex-server': 'var(--color-accent-green)',
  'gemini': 'var(--color-accent-blue)',
  'gemini-a2a': 'var(--color-accent-blue)',
  'qwen': 'var(--color-accent-orange)',
  'opencode': 'var(--color-text-tertiary)',
  'agent-sdk': 'var(--color-accent-purple)',
} as const;

export const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'codex-server': 'Codex Server',
  'gemini': 'Gemini',
  'gemini-a2a': 'Gemini (A2A)',
  'qwen': 'Qwen',
  'opencode': 'OpenCode',
  'agent-sdk': 'Agent SDK',
} as const;

// ---------------------------------------------------------------------------
// Issue display status (derived from issue metadata for UI)
// ---------------------------------------------------------------------------

/** UI-derived status that includes metadata-based states */
export type DisplayStatus =
  | 'open'
  | 'registered'
  | 'analyzing'
  | 'planned'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'deferred';

export const ISSUE_DISPLAY_STATUS_COLORS: Record<DisplayStatus, string> = {
  open: '#A09D97',
  registered: '#C8863A',
  analyzing: '#5B8DB8',
  planned: '#9178B5',
  in_progress: '#B89540',
  resolved: '#5A9E78',
  closed: '#6B6966',
  deferred: '#8B8685',
} as const;

/**
 * Derive display status from issue.status + metadata (analysis/solution presence).
 * Maps the raw IssueStatus to a richer UI state based on attached data.
 */
export function getDisplayStatus(issue: Issue): DisplayStatus {
  switch (issue.status) {
    case 'closed':
      return 'closed';
    case 'resolved':
      return 'resolved';
    case 'in_progress':
      return 'in_progress';
    case 'deferred':
      return 'deferred';
    case 'registered':
      if (issue.solution) return 'planned';
      if (issue.analysis) return 'analyzing';
      return 'registered';
    case 'open':
      if (issue.solution) return 'planned';
      if (issue.analysis) return 'analyzing';
      return 'open';
    default:
      return 'open';
  }
}
