import type { PhaseStatus, TaskStatus, SSEEventType } from './types.js';
import type { WsEventType } from './ws-protocol.js';
import type { AgentType } from './agent-types.js';
import type { Issue } from './issue-types.js';

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

export const PHASE_STATUSES: readonly PhaseStatus[] = [
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
// Collapsed view: 4 columns grouping the 8 statuses
// ---------------------------------------------------------------------------

export interface ColumnDefinition {
  id: string;
  label: string;
  statuses: readonly PhaseStatus[];
}

export const COLLAPSED_COLUMNS: readonly ColumnDefinition[] = [
  { id: 'backlog', label: 'Backlog', statuses: ['pending'] },
  { id: 'in-progress', label: 'In Progress', statuses: ['exploring', 'planning', 'executing'] },
  { id: 'review', label: 'Review', statuses: ['verifying', 'testing'] },
  { id: 'done', label: 'Done', statuses: ['completed', 'blocked'] },
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
// MCP API endpoint paths
// ---------------------------------------------------------------------------

export const MCP_API_ENDPOINTS = {
  CONFIG: '/api/mcp-config',
  TOGGLE: '/api/mcp-toggle',
  COPY_SERVER: '/api/mcp-copy-server',
  REMOVE_SERVER: '/api/mcp-remove-server',
  ADD_GLOBAL: '/api/mcp-add-global-server',
  REMOVE_GLOBAL: '/api/mcp-remove-global-server',
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
  SUPERVISOR_STATUS: 'supervisor:status',
  // Board events (shared with SSE)
  BOARD_FULL: 'board:full',
  PHASE_UPDATED: 'phase:updated',
  TASK_UPDATED: 'task:updated',
  SCRATCH_UPDATED: 'scratch:updated',
  PROJECT_UPDATED: 'project:updated',
  WATCHER_ERROR: 'watcher:error',
  HEARTBEAT: 'heartbeat',
  CONNECTED: 'connected',
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
// Status colors (Linear-inspired design tokens)
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<PhaseStatus, string> = {
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
  'qwen': 'var(--color-accent-orange)',
  'opencode': 'var(--color-text-tertiary)',
  'agent-sdk': 'var(--color-accent-purple)',
} as const;

export const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'codex-server': 'Codex Server',
  'gemini': 'Gemini',
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
  | 'analyzing'
  | 'planned'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export const ISSUE_DISPLAY_STATUS_COLORS: Record<DisplayStatus, string> = {
  open: '#A09D97',
  analyzing: '#5B8DB8',
  planned: '#9178B5',
  in_progress: '#B89540',
  resolved: '#5A9E78',
  closed: '#6B6966',
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
    case 'open':
      if (issue.solution) return 'planned';
      if (issue.analysis) return 'analyzing';
      return 'open';
    default:
      return 'open';
  }
}
