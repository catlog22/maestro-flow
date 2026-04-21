/**
 * Team Message Bus - JSONL-based persistent message log for Agent Teams
 *
 * Operations:
 * - log:            Append a message (to defaults to "coordinator", summary auto-generated if omitted)
 * - read:           Read message(s) by ID
 * - list:           List recent messages with optional filters (from/to/type/last N)
 * - status:         Summarize team member activity from message history
 * - delete:         Delete a specific message by ID
 * - clear:          Clear all messages for a team
 * - broadcast:      Log a message with to="all"
 * - get_state:      Read role state from meta.json
 * - read_mailbox:   Read unread messages for a role and mark them as delivered
 * - mailbox_status: Return counts of pending/notified/delivered/failed per role
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { getProjectRoot } from '../utils/path-validator.js';

// --- Team Metadata ---

export interface TeamMeta {
  status: 'active' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  archived_at?: string;
  pipeline_mode?: string;
  pipeline_stages?: string[];
  team_name?: string;
  task_description?: string;
  roles?: string[];
  role_state?: Record<string, Record<string, unknown>>;
}

export function getMetaPath(team: string): string {
  return join(getLogDir(team), 'meta.json');
}

export function readTeamMeta(team: string): TeamMeta | null {
  const metaPath = getMetaPath(team);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as TeamMeta;
  } catch {
    return null;
  }
}

export function writeTeamMeta(team: string, meta: TeamMeta): void {
  const dir = getLogDir(team);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getMetaPath(team), JSON.stringify(meta, null, 2), 'utf-8');
}

export function inferTeamStatus(team: string): TeamMeta['status'] {
  const messages = readAllMessages(team);
  if (messages.length === 0) return 'active';
  const lastMsg = messages[messages.length - 1];
  return lastMsg.type === 'shutdown' ? 'completed' : 'active';
}

export function getEffectiveTeamMeta(team: string): TeamMeta {
  const meta = readTeamMeta(team);
  if (meta) {
    if (!meta.role_state || !meta.pipeline_mode || !meta.roles || !meta.pipeline_stages) {
      const legacyData = readLegacyFiles(team);
      if (!meta.pipeline_mode && legacyData.pipeline_mode) {
        meta.pipeline_mode = legacyData.pipeline_mode;
      }
      if (!meta.role_state && legacyData.role_state) {
        meta.role_state = legacyData.role_state;
      }
      if (!meta.pipeline_stages && legacyData.pipeline_stages) {
        meta.pipeline_stages = legacyData.pipeline_stages;
      }
      if (!meta.team_name && legacyData.team_name) {
        meta.team_name = legacyData.team_name;
      }
      if (!meta.roles && legacyData.roles) {
        meta.roles = legacyData.roles;
      }
    }
    return meta;
  }

  const status = inferTeamStatus(team);
  const dir = getLogDir(team);
  let created_at = new Date().toISOString();
  try {
    const stat = statSync(dir);
    created_at = stat.birthtime.toISOString();
  } catch { /* use now as fallback */ }

  const messages = readAllMessages(team);
  const lastMsg = messages[messages.length - 1];
  const updated_at = lastMsg?.ts || created_at;

  const legacyData = readLegacyFiles(team);

  return {
    status,
    created_at,
    updated_at,
    ...legacyData,
  };
}

function readLegacyFiles(team: string): Partial<TeamMeta> {
  const root = getProjectRoot();
  const sessionDir = join(root, '.workflow', '.team', team);
  const result: Partial<TeamMeta> = {};

  const sharedMemPath = join(sessionDir, 'shared-memory.json');
  if (existsSync(sharedMemPath)) {
    try {
      const sharedMem = JSON.parse(readFileSync(sharedMemPath, 'utf-8'));
      if (sharedMem.pipeline_mode) result.pipeline_mode = sharedMem.pipeline_mode;
      if (sharedMem.pipeline_stages) result.pipeline_stages = sharedMem.pipeline_stages;
      const roleState: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(sharedMem)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)
            && !['pipeline_mode', 'pipeline_stages'].includes(key)) {
          roleState[key] = value as Record<string, unknown>;
        }
      }
      if (Object.keys(roleState).length > 0) result.role_state = roleState;
    } catch { /* ignore parse errors */ }
  }

  const sessionPath = join(sessionDir, 'team-session.json');
  if (existsSync(sessionPath)) {
    try {
      const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
      if (!result.pipeline_mode && session.pipeline_mode) result.pipeline_mode = session.pipeline_mode;
      if (!result.pipeline_stages && session.pipeline_stages) result.pipeline_stages = session.pipeline_stages;
      if (session.team_name) result.team_name = session.team_name;
      if (session.task_description) result.task_description = session.task_description;
      if (session.roles && Array.isArray(session.roles)) {
        if (typeof session.roles[0] === 'string') {
          result.roles = session.roles;
        } else if (typeof session.roles[0] === 'object' && session.roles[0] !== null && 'name' in session.roles[0]) {
          result.roles = session.roles.map((r: { name: string }) => r.name);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return result;
}

// --- Types ---

/** Dispatch status lifecycle: pending -> notified -> delivered (or failed) */
export type DispatchStatus = 'pending' | 'notified' | 'delivered' | 'failed';

export interface TeamMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  type: string;
  summary: string;
  data?: Record<string, unknown>;
  // Dispatch tracking fields (backward compatible - older messages lack these)
  dispatch_status?: DispatchStatus;
  delivery_method?: string;
  notified_at?: string;
  delivered_at?: string;
  failed_at?: string;
}

export interface StatusEntry {
  member: string;
  lastSeen: string;
  lastAction: string;
  messageCount: number;
}

// --- Zod Schema ---

const ParamsSchema = z.object({
  operation: z.enum(['log', 'read', 'list', 'status', 'delete', 'clear', 'broadcast', 'get_state', 'read_mailbox', 'mailbox_status']).describe('Operation to perform'),
  session_id: z.string().optional().describe('Session ID that determines message storage path'),
  team_session_id: z.string().optional().describe('[deprecated] Use session_id'),
  team: z.string().optional().describe('[deprecated] Use session_id'),
  from: z.string().optional().describe('[log/broadcast/list] Sender role name'),
  to: z.string().optional().describe('[log/list] Recipient role (defaults to "coordinator")'),
  type: z.string().optional().describe('[log/broadcast/list] Message type'),
  summary: z.string().optional().describe('[log/broadcast] One-line summary'),
  data: z.record(z.string(), z.unknown()).optional().describe('[log/broadcast] Structured data payload'),
  id: z.string().optional().describe('[read/delete] Message ID'),
  last: z.number().min(1).max(100).optional().describe('[list] Return last N messages'),
  role: z.string().optional().describe('[get_state/read_mailbox] Role name to query'),
  ref: z.string().optional().describe('[deprecated] Use data.ref instead'),
  delivery_method: z.string().optional().describe('[log] Delivery method for dispatch tracking'),
});

type Params = z.infer<typeof ParamsSchema>;

function resolveTeamId(params: Params): string | null {
  return params.session_id || params.team_session_id || params.team || null;
}

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'team_msg',
  description: `Team message bus - persistent JSONL log for Agent Team communication. Choose an operation and provide its required parameters.

**Storage Location:** .workflow/.team/{session-id}/.msg/messages.jsonl

**Operations & Required Parameters:**

*   **log**: Append a message to the log.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **from** (string, **REQUIRED**): Sender role name.
    *   *to* (string): Recipient role (default: "coordinator").
    *   *type* (string): Message type (default: "message").
    *   *summary* (string): One-line summary (auto-generated if omitted).
    *   *data* (object): Structured data payload.
    *   *delivery_method* (string): Delivery method for dispatch tracking.

*   **broadcast**: Send message to all team members.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **from** (string, **REQUIRED**): Sender role name.

*   **read**: Read a specific message by ID.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **id** (string, **REQUIRED**): Message ID.

*   **list**: List recent messages.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   *last* (number): Number of messages (default: 20).

*   **status**: Summarize team member activity.
    *   **session_id** (string, **REQUIRED**): Session ID.

*   **get_state**: Get state for a specific role.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   *role* (string): Role name to query.

*   **read_mailbox**: Read unread messages for a role and mark them delivered.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **role** (string, **REQUIRED**): Role name whose mailbox to read.

*   **mailbox_status**: Return dispatch status counts per role.
    *   **session_id** (string, **REQUIRED**): Session ID.

*   **delete**: Delete a message by ID.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **id** (string, **REQUIRED**): Message ID.

*   **clear**: Clear all messages for a session.
    *   **session_id** (string, **REQUIRED**): Session ID.`,
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['log', 'read', 'list', 'status', 'delete', 'clear', 'broadcast', 'get_state', 'read_mailbox', 'mailbox_status'],
        description: 'Operation to perform',
      },
      session_id: {
        type: 'string',
        description: 'Session ID (e.g., TLS-my-project-2026-02-27)',
      },
      from: { type: 'string', description: '[log/broadcast/list] Sender role' },
      to: { type: 'string', description: '[log/list] Recipient role' },
      type: { type: 'string', description: '[log/broadcast/list] Message type' },
      summary: { type: 'string', description: '[log/broadcast] One-line summary' },
      data: { type: 'object', description: '[log/broadcast] Structured data' },
      id: { type: 'string', description: '[read/delete] Message ID' },
      last: { type: 'number', description: '[list] Last N messages', minimum: 1, maximum: 100 },
      role: { type: 'string', description: '[get_state/read_mailbox] Role name to query' },
      delivery_method: { type: 'string', description: '[log] Delivery method for dispatch tracking' },
      team_session_id: { type: 'string', description: '[deprecated] Use session_id' },
      team: { type: 'string', description: '[deprecated] Use session_id' },
      ref: { type: 'string', description: '[deprecated] Use data.ref instead' },
    },
    required: ['operation'],
  },
};

// --- Helpers ---

export function getLogDir(sessionId: string): string {
  const root = getProjectRoot();
  return join(root, '.workflow', '.team', sessionId, '.msg');
}

export function getLogDirWithFallback(sessionId: string): string {
  const newPath = getLogDir(sessionId);
  if (existsSync(newPath)) {
    return newPath;
  }
  const root = getProjectRoot();
  return join(root, '.workflow', '.team-msg', sessionId);
}

function getLogPath(teamId: string): string {
  return join(getLogDir(teamId), 'messages.jsonl');
}

function ensureLogFile(teamId: string): string {
  const logPath = getLogPath(teamId);
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(logPath)) {
    appendFileSync(logPath, '', 'utf-8');
  }
  return logPath;
}

export function readAllMessages(teamId: string): TeamMessage[] {
  const logPath = getLogPath(teamId);
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf-8').trim();
  if (!content) return [];

  return content.split('\n').map(line => {
    try {
      return JSON.parse(line) as TeamMessage;
    } catch {
      return null;
    }
  }).filter((m): m is TeamMessage => m !== null);
}

function getNextId(messages: TeamMessage[]): string {
  const maxNum = messages.reduce((max, m) => {
    const match = m.id.match(/^MSG-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `MSG-${String(maxNum + 1).padStart(3, '0')}`;
}

function nowISO(): string {
  return new Date().toISOString().replace('Z', '+00:00');
}

// --- Operations ---

function opLog(params: Params, teamId: string): CcwToolResult {
  if (!params.from) return { success: false, error: 'log requires "from"' };

  const to = params.to || 'coordinator';

  if (params.ref) {
    if (!params.data) params.data = {};
    if (!params.data.ref) params.data.ref = params.ref;
  }

  const summary = params.summary || `[${params.from}] ${params.type || 'message'} → ${to}`;

  const logPath = ensureLogFile(teamId);
  const messages = readAllMessages(teamId);
  const id = getNextId(messages);

  const now = nowISO();

  // When delivery_method is provided, the message starts as 'pending' (explicit delivery).
  // When no delivery_method, it's a legacy direct message and defaults to 'delivered'.
  const dispatchStatus: DispatchStatus = params.delivery_method ? 'pending' : 'delivered';

  const msg: TeamMessage = {
    id,
    ts: now,
    from: params.from,
    to,
    type: params.type || 'message',
    summary,
    dispatch_status: dispatchStatus,
  };

  if (params.data) msg.data = params.data;
  if (params.delivery_method) msg.delivery_method = params.delivery_method;

  // Set delivered_at for legacy messages (backward compat)
  if (dispatchStatus === 'delivered') {
    msg.delivered_at = now;
  }

  appendFileSync(logPath, JSON.stringify(msg) + '\n', 'utf-8');

  if (params.type === 'state_update' && params.data) {
    const meta = getEffectiveTeamMeta(teamId);

    if (params.from) {
      if (!meta.role_state) meta.role_state = {};
      meta.role_state[params.from] = {
        ...meta.role_state[params.from],
        ...params.data,
        _updated_at: nowISO(),
      };
    }

    const topLevelKeys = ['pipeline_mode', 'pipeline_stages', 'team_name', 'task_description', 'roles'] as const;
    for (const key of topLevelKeys) {
      if (params.data[key] !== undefined) {
        (meta as any)[key] = params.data[key];
      }
    }

    meta.updated_at = nowISO();
    writeTeamMeta(teamId, meta);
  }

  return { success: true, result: { id, message: `Logged ${id}: [${msg.from} → ${msg.to}] ${msg.summary}` } };
}

function opRead(params: Params, teamId: string): CcwToolResult {
  if (!params.id) return { success: false, error: 'read requires "id"' };

  const messages = readAllMessages(teamId);
  const msg = messages.find(m => m.id === params.id);

  if (!msg) {
    return { success: false, error: `Message ${params.id} not found in team "${teamId}"` };
  }

  return { success: true, result: msg };
}

function opList(params: Params, teamId: string): CcwToolResult {
  let messages = readAllMessages(teamId);

  if (params.from) messages = messages.filter(m => m.from === params.from);
  if (params.to) messages = messages.filter(m => m.to === params.to);
  if (params.type) messages = messages.filter(m => m.type === params.type);

  const last = params.last || 20;
  const sliced = messages.slice(-last);

  const lines = sliced.map(m => `${m.id} [${m.ts.substring(11, 19)}] ${m.from} → ${m.to} (${m.type}) ${m.summary}`);

  return {
    success: true,
    result: {
      total: messages.length,
      showing: sliced.length,
      messages: sliced,
      formatted: lines.join('\n'),
    },
  };
}

function opStatus(params: Params, teamId: string): CcwToolResult {
  const messages = readAllMessages(teamId);

  if (messages.length === 0) {
    return { success: true, result: { members: [], summary: 'No messages recorded yet.' } };
  }

  const memberMap = new Map<string, StatusEntry>();

  for (const msg of messages) {
    for (const role of [msg.from, msg.to]) {
      if (!memberMap.has(role)) {
        memberMap.set(role, { member: role, lastSeen: msg.ts, lastAction: '', messageCount: 0 });
      }
    }
    const fromEntry = memberMap.get(msg.from)!;
    fromEntry.lastSeen = msg.ts;
    fromEntry.lastAction = `sent ${msg.type} → ${msg.to}`;
    fromEntry.messageCount++;
  }

  const members = Array.from(memberMap.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));

  const formatted = members.map(m =>
    `${m.member.padEnd(12)} | last: ${m.lastSeen.substring(11, 19)} | msgs: ${m.messageCount} | ${m.lastAction}`
  ).join('\n');

  return {
    success: true,
    result: {
      members,
      total_messages: messages.length,
      formatted,
    },
  };
}

function opDelete(params: Params, teamId: string): CcwToolResult {
  if (!params.id) return { success: false, error: 'delete requires "id"' };

  const messages = readAllMessages(teamId);
  const idx = messages.findIndex(m => m.id === params.id);

  if (idx === -1) {
    return { success: false, error: `Message ${params.id} not found in team "${teamId}"` };
  }

  const removed = messages.splice(idx, 1)[0];
  const logPath = ensureLogFile(teamId);
  writeFileSync(logPath, messages.map(m => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : ''), 'utf-8');

  return { success: true, result: { deleted: removed.id, message: `Deleted ${removed.id}: [${removed.from} → ${removed.to}] ${removed.summary}` } };
}

function opBroadcast(params: Params, teamId: string): CcwToolResult {
  if (!params.from) return { success: false, error: 'broadcast requires "from"' };
  return opLog({ ...params, operation: 'log', to: 'all' }, teamId);
}

function opGetState(params: Params, teamId: string): CcwToolResult {
  const meta = getEffectiveTeamMeta(teamId);
  const roleState = meta.role_state || {};

  if (params.role) {
    const state = roleState[params.role];
    if (!state) {
      return { success: true, result: { role: params.role, state: null, message: `No state found for role "${params.role}"` } };
    }
    return { success: true, result: { role: params.role, state } };
  }

  return { success: true, result: { role_state: roleState } };
}

function opClear(params: Params, teamId: string): CcwToolResult {
  const logPath = getLogPath(teamId);
  const dir = getLogDir(teamId);

  if (!existsSync(logPath)) {
    return { success: true, result: { message: `Team "${teamId}" has no messages to clear.` } };
  }

  const count = readAllMessages(teamId).length;
  rmSync(dir, { recursive: true, force: true });

  return { success: true, result: { cleared: count, message: `Cleared ${count} messages for team "${teamId}".` } };
}

// --- Handler ---

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const p = parsed.data;

  const teamId = resolveTeamId(p);
  if (!teamId) {
    return { success: false, error: 'Missing required parameter: session_id (or legacy "team_session_id" / "team")' };
  }

  switch (p.operation) {
    case 'log': return opLog(p, teamId);
    case 'read': return opRead(p, teamId);
    case 'list': return opList(p, teamId);
    case 'status': return opStatus(p, teamId);
    case 'delete': return opDelete(p, teamId);
    case 'clear': return opClear(p, teamId);
    case 'broadcast': return opBroadcast(p, teamId);
    case 'get_state': return opGetState(p, teamId);
    default:
      return { success: false, error: `Unknown operation: ${p.operation}` };
  }
}
