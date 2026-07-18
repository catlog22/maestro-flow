/**
 * Team Mailbox - MCP tools for agent-to-agent messaging with delivery tracking
 *
 * Tools:
 * - team_send_message:    Send a message to a team role (persists to JSONL + broker inject)
 * - team_read_mailbox:    Read unread messages for a role, mark as delivered
 * - team_mailbox_status:  Per-role unread/pending/delivered counts
 *
 * Storage: {run_dir}/work/team/.msg/mailbox.jsonl
 *
 * Integration points for TASK-001 (team-msg dispatch upgrade):
 * - opReadMailbox: reads messages addressed to a role
 * - opGetMailboxStatus: aggregates per-role delivery counts
 * - delivery_method field on opLog messages
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createDefaultDelegateBroker } from '../async/delegate-broker.js';
import { resolveTeamWorkDir } from './team-run-paths.js';

// --- Types ---

export type DeliveryMethod = 'inject' | 'poll' | 'broadcast';
export type DeliveryStatus = 'pending' | 'notified' | 'delivered' | 'failed';

export interface MailboxMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  type: string;
  message: string;
  delivery_method: DeliveryMethod;
  delivery_status: DeliveryStatus;
  delivered_at?: string;
  data?: Record<string, unknown>;
}

export interface MailboxRoleStatus {
  role: string;
  pending: number;
  notified: number;
  delivered: number;
  failed: number;
}

// --- Storage helpers ---

function getMailboxDir(sessionId: string): string {
  return join(resolveTeamWorkDir(sessionId), '.msg');
}

function getMailboxPath(sessionId: string): string {
  return join(getMailboxDir(sessionId), 'mailbox.jsonl');
}

function ensureMailboxFile(sessionId: string): string {
  const mailboxPath = getMailboxPath(sessionId);
  const dir = dirname(mailboxPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(mailboxPath)) {
    appendFileSync(mailboxPath, '', 'utf-8');
  }
  return mailboxPath;
}

function readAllMailboxMessages(sessionId: string): MailboxMessage[] {
  const mailboxPath = getMailboxPath(sessionId);
  if (!existsSync(mailboxPath)) return [];

  const content = readFileSync(mailboxPath, 'utf-8').trim();
  if (!content) return [];

  return content.split('\n').map(line => {
    try {
      return JSON.parse(line) as MailboxMessage;
    } catch {
      return null;
    }
  }).filter((m): m is MailboxMessage => m !== null);
}

function writeAllMailboxMessages(sessionId: string, messages: MailboxMessage[]): void {
  const mailboxPath = ensureMailboxFile(sessionId);
  writeFileSync(
    mailboxPath,
    messages.map(m => JSON.stringify(m)).join('\n') + (messages.length > 0 ? '\n' : ''),
    'utf-8',
  );
}

function getNextMailboxId(messages: MailboxMessage[]): string {
  const maxNum = messages.reduce((max, m) => {
    const match = m.id.match(/^MBX-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `MBX-${String(maxNum + 1).padStart(3, '0')}`;
}

function nowISO(): string {
  return new Date().toISOString().replace('Z', '+00:00');
}

// --- Broker integration ---

/**
 * Attempt to inject a message into a running delegate agent via the broker.
 * Returns true if injection was attempted (even if the job was not found),
 * false only if broker itself was unavailable.
 */
function attemptBrokerInject(jobId: string, message: string): { attempted: boolean; result?: string } {
  try {
    const broker = createDefaultDelegateBroker();
    const job = broker.getJob(jobId);
    if (!job) {
      return { attempted: false, result: `No running job found for: ${jobId}` };
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return { attempted: false, result: `Job ${jobId} is ${job.status}, message persisted for polling` };
    }
    const queued = broker.queueMessage({
      jobId,
      message,
      delivery: 'inject',
    });
    return { attempted: true, result: `Injected into job ${jobId} as ${queued.messageId}` };
  } catch (error) {
    return { attempted: false, result: `Broker error: ${(error as Error).message}` };
  }
}

// --- Zod Schemas ---

const SendMessageSchema = z.object({
  session_id: z.string().describe('Run ID that determines mailbox storage path; legacy team session IDs are accepted'),
  from: z.string().describe('Sender role name'),
  to: z.string().describe('Recipient role name'),
  message: z.string().describe('Message content to send'),
  type: z.string().optional().describe('Message type (default: "message")'),
  delivery_method: z.enum(['inject', 'poll', 'broadcast']).optional().default('inject').describe('Delivery method (default: "inject")'),
  data: z.record(z.string(), z.unknown()).optional().describe('Structured data payload'),
});

const ReadMailboxSchema = z.object({
  session_id: z.string().describe('Run ID that determines mailbox storage path; legacy team session IDs are accepted'),
  role: z.string().describe('Role name to read mailbox for'),
  limit: z.number().min(1).max(100).optional().default(50).describe('Max messages to return (default: 50)'),
  mark_delivered: z.boolean().optional().default(true).describe('Mark returned messages as delivered (default: true)'),
});

const MailboxStatusSchema = z.object({
  session_id: z.string().describe('Run ID that determines mailbox storage path; legacy team session IDs are accepted'),
});

type SendMessageParams = z.infer<typeof SendMessageSchema>;
type ReadMailboxParams = z.infer<typeof ReadMailboxSchema>;
type MailboxStatusParams = z.infer<typeof MailboxStatusSchema>;

// --- Operations ---

function opSendMessage(params: SendMessageParams): CcwToolResult {
  const { session_id, from, to, message, type, delivery_method, data } = params;

  ensureMailboxFile(session_id);
  const messages = readAllMailboxMessages(session_id);
  const id = getNextMailboxId(messages);
  const ts = nowISO();

  const mailboxMsg: MailboxMessage = {
    id,
    ts,
    from,
    to,
    type: type || 'message',
    message,
    delivery_method,
    delivery_status: 'pending',
  };
  if (data) mailboxMsg.data = data;

  // Persist to JSONL
  const mailboxPath = ensureMailboxFile(session_id);
  appendFileSync(mailboxPath, JSON.stringify(mailboxMsg) + '\n', 'utf-8');

  // Attempt broker injection for 'inject' delivery method
  let injectResult: { attempted: boolean; result?: string } | null = null;
  if (delivery_method === 'inject') {
    // Derive job ID from role name convention: {session_id}-{role}
    const jobId = `${session_id}-${to}`;
    injectResult = attemptBrokerInject(jobId, message);

    // Update delivery status based on injection result
    if (injectResult.attempted) {
      const allMessages = readAllMailboxMessages(session_id);
      const saved = allMessages.find(m => m.id === id);
      if (saved) {
        saved.delivery_status = 'notified';
        writeAllMailboxMessages(session_id, allMessages);
      }
    }
  }

  const statusLine = injectResult
    ? ` | inject: ${injectResult.result}`
    : '';

  return {
    success: true,
    result: {
      id,
      message: `Sent ${id}: [${from} -> ${to}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}${statusLine}`,
      delivery_method,
      delivery_status: injectResult?.attempted ? 'notified' : 'pending',
    },
  };
}

function opReadMailbox(params: ReadMailboxParams): CcwToolResult {
  const { session_id, role, limit, mark_delivered } = params;

  const allMessages = readAllMailboxMessages(session_id);
  const unread = allMessages.filter(m => m.to === role && m.delivery_status !== 'delivered');

  const toReturn = unread.slice(0, limit || 50);

  if (mark_delivered && toReturn.length > 0) {
    const now = nowISO();
    const deliveredIds = new Set(toReturn.map(m => m.id));
    for (const msg of allMessages) {
      if (deliveredIds.has(msg.id)) {
        msg.delivery_status = 'delivered';
        msg.delivered_at = now;
      }
    }
    writeAllMailboxMessages(session_id, allMessages);
  }

  const formatted = toReturn.map(m =>
    `${m.id} [${m.ts.substring(11, 19)}] ${m.from} -> ${m.to} (${m.type}) ${m.message.substring(0, 100)}`
  );

  return {
    success: true,
    result: {
      role,
      unread_count: toReturn.length,
      total_pending: unread.length,
      messages: toReturn,
      formatted: formatted.join('\n'),
    },
  };
}

function opMailboxStatus(params: MailboxStatusParams): CcwToolResult {
  const { session_id } = params;

  const allMessages = readAllMailboxMessages(session_id);

  if (allMessages.length === 0) {
    return {
      success: true,
      result: {
        roles: [],
        total_messages: 0,
        summary: 'No mailbox messages recorded yet.',
      },
    };
  }

  // Aggregate per-role counts
  const roleMap = new Map<string, MailboxRoleStatus>();

  for (const msg of allMessages) {
    // Count by recipient role
    if (!roleMap.has(msg.to)) {
      roleMap.set(msg.to, { role: msg.to, pending: 0, notified: 0, delivered: 0, failed: 0 });
    }
    const entry = roleMap.get(msg.to)!;
    switch (msg.delivery_status) {
      case 'pending': entry.pending++; break;
      case 'notified': entry.notified++; break;
      case 'delivered': entry.delivered++; break;
      case 'failed': entry.failed++; break;
    }
  }

  const roles = Array.from(roleMap.values());

  const formatted = roles.map(r =>
    `${r.role.padEnd(12)} | pending: ${r.pending} | notified: ${r.notified} | delivered: ${r.delivered} | failed: ${r.failed}`
  ).join('\n');

  return {
    success: true,
    result: {
      roles,
      total_messages: allMessages.length,
      formatted,
    },
  };
}

// --- Tool Schema ---

export const schema: ToolSchema = {
  name: 'team_mailbox',
  description: `Team mailbox - agent-to-agent messaging with delivery tracking and broker injection.

**Storage Location:** {run_dir}/work/team/.msg/mailbox.jsonl (legacy team session IDs fall back to .workflow/.team/{session-id})

**Operations & Required Parameters:**

*   **send**: Send a message to a team role.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **from** (string, **REQUIRED**): Sender role name.
    *   **to** (string, **REQUIRED**): Recipient role name.
    *   **message** (string, **REQUIRED**): Message content.
    *   *type* (string): Message type (default: "message").
    *   *delivery_method* (string): "inject" | "poll" | "broadcast" (default: "inject").
    *   *data* (object): Structured data payload.

*   **read**: Read unread messages for a role and mark as delivered.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **role** (string, **REQUIRED**): Role name to read mailbox for.
    *   *limit* (number): Max messages to return (default: 50).
    *   *mark_delivered* (boolean): Mark messages as delivered (default: true).

*   **status**: Per-role unread/delivered counts.
    *   **session_id** (string, **REQUIRED**): Session ID.`,
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['send', 'read', 'status'],
        description: 'Operation to perform',
      },
      session_id: {
        type: 'string',
        description: 'Run ID (e.g., 20260717-001-team-testing); legacy team session ID accepted',
      },
      from: {
        type: 'string',
        description: '[send] Sender role name',
      },
      to: {
        type: 'string',
        description: '[send] Recipient role name',
      },
      message: {
        type: 'string',
        description: '[send] Message content',
      },
      type: {
        type: 'string',
        description: '[send] Message type (default: "message")',
      },
      delivery_method: {
        type: 'string',
        enum: ['inject', 'poll', 'broadcast'],
        description: '[send] Delivery method (default: "inject")',
      },
      data: {
        type: 'object',
        description: '[send] Structured data payload',
      },
      role: {
        type: 'string',
        description: '[read] Role name to read mailbox for',
      },
      limit: {
        type: 'number',
        description: '[read] Max messages to return (default: 50)',
        minimum: 1,
        maximum: 100,
      },
      mark_delivered: {
        type: 'boolean',
        description: '[read] Mark returned messages as delivered (default: true)',
      },
    },
    required: ['operation'],
  },
};

// --- Unified Params Schema for dispatch ---

const DispatchParamsSchema = z.object({
  operation: z.enum(['send', 'read', 'status']),
  // send params
  session_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  message: z.string().optional(),
  type: z.string().optional(),
  delivery_method: z.enum(['inject', 'poll', 'broadcast']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  // read params
  role: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  mark_delivered: z.boolean().optional(),
});

type DispatchParams = z.infer<typeof DispatchParamsSchema>;

// --- Handler ---

export async function handler(params: Record<string, unknown>): Promise<CcwToolResult> {
  const parsed = DispatchParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid params: ${parsed.error.message}` };
  }

  const p = parsed.data;

  if (!p.session_id) {
    return { success: false, error: 'Missing required parameter: session_id' };
  }

  switch (p.operation) {
    case 'send': {
      if (!p.from) return { success: false, error: 'send requires "from"' };
      if (!p.to) return { success: false, error: 'send requires "to"' };
      if (!p.message) return { success: false, error: 'send requires "message"' };
      return opSendMessage({
        session_id: p.session_id,
        from: p.from,
        to: p.to,
        message: p.message,
        type: p.type || 'message',
        delivery_method: p.delivery_method || 'inject',
        data: p.data,
      });
    }
    case 'read': {
      if (!p.role) return { success: false, error: 'read requires "role"' };
      return opReadMailbox({
        session_id: p.session_id,
        role: p.role,
        limit: p.limit || 50,
        mark_delivered: p.mark_delivered !== false,
      });
    }
    case 'status': {
      return opMailboxStatus({ session_id: p.session_id });
    }
    default:
      return { success: false, error: `Unknown operation: ${p.operation}` };
  }
}
