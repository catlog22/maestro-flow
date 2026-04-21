/**
 * Team Task MCP Tools - Agent-facing task management wrapping CollabTask.
 *
 * Exposes CRUD operations over the CollabTask system for agent consumption
 * via MCP. Tasks are scoped to a team session_id under the agent pipeline
 * namespace (.workflow/.team/{session_id}/tasks/) to avoid collision with
 * the human collaboration domain (.workflow/collab/tasks/).
 *
 * Reuses the CollabTask state machine from team-tasks.ts:
 *   open -> assigned -> in_progress -> pending_review -> done -> closed
 *   closed -> open (reopen)
 *
 * Operations:
 * - create: Create a new task (title, description, owner, priority)
 * - update: Update task fields (task_id, status, owner, description)
 * - list:   List tasks with optional filters (session_id, status, owner)
 * - get:    Get a single task by ID
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { getProjectRoot } from '../utils/path-validator.js';
import type {
  CollabTask,
  TaskStatus,
  TaskPriority,
} from './team-tasks.js';
import { validateStatusTransition } from './team-tasks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent-scoped task: wraps CollabTask with a session namespace. */
export interface AgentTask extends CollabTask {
  session_id: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Absolute path to the agent task directory for a session. */
function getAgentTasksDir(sessionId: string): string {
  const dir = join(
    getProjectRoot(),
    '.workflow',
    '.team',
    sessionId,
    'tasks',
  );
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to a specific agent task file. */
function getAgentTaskFilePath(sessionId: string, id: string): string {
  return join(getAgentTasksDir(sessionId), `${id}.json`);
}

/** Absolute path to the auto-increment counter file. */
function getCounterFilePath(sessionId: string): string {
  return join(getAgentTasksDir(sessionId), '.counter');
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Read and increment the counter, returning the next ATASK-XXX id. */
function getNextTaskId(sessionId: string): string {
  const counterPath = getCounterFilePath(sessionId);
  let next = 1;
  if (existsSync(counterPath)) {
    const raw = readFileSync(counterPath, 'utf-8').trim();
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) next = parsed;
  }
  const id = `ATASK-${String(next).padStart(3, '0')}`;
  writeFileSync(counterPath, String(next + 1), 'utf-8');
  return id;
}

// ---------------------------------------------------------------------------
// Internal read/write
// ---------------------------------------------------------------------------

function readAgentTaskFile(filePath: string): AgentTask | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AgentTask>;
    if (
      typeof parsed.id === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.description === 'string' &&
      typeof parsed.status === 'string' &&
      typeof parsed.priority === 'string' &&
      typeof parsed.reporter === 'string' &&
      Array.isArray(parsed.check_log) &&
      typeof parsed.created_at === 'string' &&
      typeof parsed.updated_at === 'string' &&
      typeof parsed.updated_by === 'string' &&
      typeof parsed.session_id === 'string'
    ) {
      return parsed as AgentTask;
    }
    return null;
  } catch {
    return null;
  }
}

function writeAgentTaskFile(filePath: string, task: AgentTask): void {
  writeFileSync(filePath, JSON.stringify(task, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

function createAgentTask(
  sessionId: string,
  opts: {
    title: string;
    description?: string;
    owner?: string;
    priority?: TaskPriority;
  },
): AgentTask {
  const id = getNextTaskId(sessionId);
  const now = new Date().toISOString();
  const owner = opts.owner || 'agent';

  const task: AgentTask = {
    session_id: sessionId,
    id,
    title: opts.title,
    description: opts.description ?? '',
    status: 'open',
    priority: opts.priority ?? 'medium',
    reporter: owner,
    check_log: [],
    created_at: now,
    updated_at: now,
    updated_by: owner,
  };

  writeAgentTaskFile(getAgentTaskFilePath(sessionId, id), task);
  return task;
}

function getAgentTask(sessionId: string, id: string): AgentTask | null {
  return readAgentTaskFile(getAgentTaskFilePath(sessionId, id));
}

function updateAgentTask(
  sessionId: string,
  id: string,
  partial: {
    status?: TaskStatus;
    owner?: string;
    description?: string;
    title?: string;
    priority?: TaskPriority;
  },
): AgentTask {
  const task = getAgentTask(sessionId, id);
  if (!task) return null as unknown as AgentTask; // caller checks null

  // Validate status transition if status is being changed.
  if (partial.status !== undefined && partial.status !== task.status) {
    if (!validateStatusTransition(task.status, partial.status)) {
      throw new Error(
        `Invalid status transition: ${task.status} -> ${partial.status}`,
      );
    }
  }

  const now = new Date().toISOString();
  const updatedBy = partial.owner || task.updated_by;

  const updated: AgentTask = {
    ...task,
    ...(partial.status !== undefined ? { status: partial.status } : {}),
    ...(partial.description !== undefined
      ? { description: partial.description }
      : {}),
    ...(partial.title !== undefined ? { title: partial.title } : {}),
    ...(partial.priority !== undefined ? { priority: partial.priority } : {}),
    ...(partial.owner !== undefined ? { assignee: partial.owner } : {}),
    id: task.id,
    session_id: task.session_id,
    created_at: task.created_at,
    updated_at: now,
    updated_by: updatedBy,
  };

  writeAgentTaskFile(getAgentTaskFilePath(sessionId, updated.id), updated);
  return updated;
}

function listAgentTasks(
  sessionId: string,
  filters?: {
    status?: TaskStatus;
    owner?: string;
  },
): AgentTask[] {
  const dir = getAgentTasksDir(sessionId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: AgentTask[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const task = readAgentTaskFile(join(dir, entry));
    if (!task) continue;

    if (filters) {
      if (
        filters.status !== undefined &&
        task.status !== filters.status
      )
        continue;
      if (
        filters.owner !== undefined &&
        task.assignee !== filters.owner &&
        task.reporter !== filters.owner
      )
        continue;
    }

    out.push(task);
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

const TaskStatusEnum = z.enum([
  'open',
  'assigned',
  'in_progress',
  'pending_review',
  'done',
  'closed',
]);

const TaskPriorityEnum = z.enum(['low', 'medium', 'high', 'critical']);

const ParamsSchema = z.object({
  operation: z
    .enum(['create', 'update', 'list', 'get'])
    .describe('Operation to perform'),
  session_id: z.string().describe('Session ID for task namespace scoping'),
  // create params
  title: z.string().optional().describe('[create] Task title'),
  description: z.string().optional().describe('[create/update] Task description'),
  owner: z.string().optional().describe('[create/update] Owner (reporter/assignee)'),
  priority: TaskPriorityEnum.optional().describe('[create] Priority (low, medium, high, critical)'),
  // update params
  task_id: z.string().optional().describe('[update/get] Task ID (e.g., ATASK-001)'),
  status: TaskStatusEnum.optional().describe(
    '[update] New status (open, assigned, in_progress, pending_review, done, closed)',
  ),
});

type Params = z.infer<typeof ParamsSchema>;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opCreate(params: Params): CcwToolResult {
  if (!params.title) {
    return { success: false, error: 'create requires "title"' };
  }

  const task = createAgentTask(params.session_id, {
    title: params.title,
    description: params.description,
    owner: params.owner,
    priority: params.priority,
  });

  return {
    success: true,
    result: {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      owner: task.reporter,
      created_at: task.created_at,
    },
  };
}

function opUpdate(params: Params): CcwToolResult {
  if (!params.task_id) {
    return { success: false, error: 'update requires "task_id"' };
  }

  const existing = getAgentTask(params.session_id, params.task_id);
  if (!existing) {
    return {
      success: false,
      error: `Task not found: ${params.task_id}`,
    };
  }

  try {
    const updated = updateAgentTask(params.session_id, params.task_id, {
      status: params.status,
      owner: params.owner,
      description: params.description,
    });

    return {
      success: true,
      result: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        priority: updated.priority,
        assignee: updated.assignee,
        updated_at: updated.updated_at,
        updated_by: updated.updated_by,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

function opList(params: Params): CcwToolResult {
  const tasks = listAgentTasks(params.session_id, {
    status: params.status,
    owner: params.owner,
  });

  const items = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    reporter: t.reporter,
    updated_at: t.updated_at,
  }));

  return {
    success: true,
    result: {
      total: items.length,
      tasks: items,
    },
  };
}

function opGet(params: Params): CcwToolResult {
  if (!params.task_id) {
    return { success: false, error: 'get requires "task_id"' };
  }

  const task = getAgentTask(params.session_id, params.task_id);
  if (!task) {
    return {
      success: false,
      error: `Task not found: ${params.task_id}`,
    };
  }

  return {
    success: true,
    result: task,
  };
}

// ---------------------------------------------------------------------------
// Tool Schema
// ---------------------------------------------------------------------------

export const schema: ToolSchema = {
  name: 'team_task',
  description: `Team task management for agent teams. Wraps the CollabTask system with session-scoped namespaces.

**Storage Location:** .workflow/.team/{session_id}/tasks/{id}.json

**State Machine:** open -> assigned -> in_progress -> pending_review -> done -> closed (closed -> open: reopen)

**Operations & Required Parameters:**

*   **create**: Create a new task.
    *   **session_id** (string, **REQUIRED**): Session ID for task scoping.
    *   **title** (string, **REQUIRED**): Task title.
    *   *description* (string): Task description.
    *   *owner* (string): Task owner/reporter (defaults to "agent").
    *   *priority* (string): Priority level (low, medium, high, critical; default: medium).

*   **update**: Update an existing task.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **task_id** (string, **REQUIRED**): Task ID (e.g., ATASK-001).
    *   *status* (string): New status (must follow valid state transitions).
    *   *owner* (string): New assignee.
    *   *description* (string): Updated description.

*   **list**: List tasks with optional filters.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   *status* (string): Filter by status.
    *   *owner* (string): Filter by owner (assignee or reporter).

*   **get**: Get a single task by ID.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **task_id** (string, **REQUIRED**): Task ID (e.g., ATASK-001).`,

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'update', 'list', 'get'],
        description: 'Operation to perform',
      },
      session_id: {
        type: 'string',
        description: 'Session ID for task namespace scoping',
      },
      title: {
        type: 'string',
        description: '[create] Task title',
      },
      description: {
        type: 'string',
        description: '[create/update] Task description',
      },
      owner: {
        type: 'string',
        description: '[create/update] Owner (reporter/assignee)',
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: '[create] Priority',
      },
      task_id: {
        type: 'string',
        description: '[update/get] Task ID (e.g., ATASK-001)',
      },
      status: {
        type: 'string',
        enum: [
          'open',
          'assigned',
          'in_progress',
          'pending_review',
          'done',
          'closed',
        ],
        description:
          '[update] New status (must follow valid transitions)',
      },
    },
    required: ['operation', 'session_id'],
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  params: Record<string, unknown>,
): Promise<CcwToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const p = parsed.data;

  switch (p.operation) {
    case 'create':
      return opCreate(p);
    case 'update':
      return opUpdate(p);
    case 'list':
      return opList(p);
    case 'get':
      return opGet(p);
    default:
      return { success: false, error: `Unknown operation: ${p.operation}` };
  }
}
