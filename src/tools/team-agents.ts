/**
 * Team Agents - MCP tools for agent lifecycle management via delegate broker
 *
 * Tools:
 * - team_spawn_agent:    Spawn a new agent (register session + create job)
 * - team_shutdown_agent: Cancel a running agent's delegate job
 * - team_remove_agent:   Remove agent from team config
 * - team_members:        List team members with live status from broker
 *
 * Storage: {run_dir}/work/team/members.json
 *
 * Integration:
 * - Delegate broker for job lifecycle (registerSession, publishEvent, requestCancel)
 * - Team config (members.json) for persistent member registry
 */

import { z } from 'zod';
import type { ToolSchema, CcwToolResult } from '../types/tool-schema.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createDefaultDelegateBroker } from '../async/delegate-broker.js';
import { resolveTeamWorkDir } from './team-run-paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMember {
  role: string;
  tool: string;
  prompt: string;
  job_id: string;
  exec_id: string;
  spawned_at: string;
}

interface TeamConfig {
  members: TeamMember[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getTeamDir(sessionId: string): string {
  const dir = resolveTeamWorkDir(sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getMembersPath(sessionId: string): string {
  return join(getTeamDir(sessionId), 'members.json');
}

function readMembers(sessionId: string): TeamMember[] {
  const path = getMembersPath(sessionId);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const config = JSON.parse(raw) as TeamConfig;
    return Array.isArray(config.members) ? config.members : [];
  } catch {
    return [];
  }
}

function writeMembers(sessionId: string, members: TeamMember[]): void {
  const path = getMembersPath(sessionId);
  writeFileSync(path, JSON.stringify({ members }, null, 2), 'utf-8');
}

/** Derive a deterministic job ID from session + role. */
function deriveJobId(sessionId: string, role: string): string {
  return `${sessionId}-${role}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Broker helpers (lazy initialization)
// ---------------------------------------------------------------------------

function getBroker() {
  return createDefaultDelegateBroker();
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opSpawnAgent(params: {
  session_id: string;
  role: string;
  prompt: string;
  tool?: string;
}): CcwToolResult {
  const { session_id, role, prompt } = params;
  const tool = params.tool || 'gemini';

  // Ensure session is registered with broker
  const broker = getBroker();
  broker.registerSession({
    sessionId: session_id,
    metadata: { source: 'team-agents', role },
  });

  // Derive deterministic job ID
  const jobId = deriveJobId(session_id, role);

  // Create a 'queued' event to register the job with the broker
  const event = broker.publishEvent({
    jobId,
    type: 'queued',
    payload: {
      summary: `Agent spawned: ${role}`,
      prompt: prompt.substring(0, 200),
      tool,
    },
    jobMetadata: {
      role,
      tool,
      sessionId: session_id,
    },
  });

  const execId = `agent-${event.eventId}`;

  // Persist member entry
  const members = readMembers(session_id);
  const existing = members.find(m => m.role === role);
  if (existing) {
    return {
      success: false,
      error: `Agent with role "${role}" already exists in session ${session_id}`,
    };
  }

  const member: TeamMember = {
    role,
    tool,
    prompt,
    job_id: jobId,
    exec_id: execId,
    spawned_at: nowISO(),
  };
  members.push(member);
  writeMembers(session_id, members);

  return {
    success: true,
    result: {
      job_id: jobId,
      exec_id: execId,
      role,
      tool,
    },
  };
}

function opShutdownAgent(params: {
  session_id: string;
  role: string;
}): CcwToolResult {
  const { session_id, role } = params;
  const members = readMembers(session_id);
  const member = members.find(m => m.role === role);

  if (!member) {
    return {
      success: false,
      error: `Agent with role "${role}" not found in session ${session_id}`,
    };
  }

  const broker = getBroker();
  const job = broker.getJob(member.job_id);

  if (!job) {
    return {
      success: false,
      error: `No delegate job found for ${role} (${member.job_id})`,
    };
  }

  // Skip if already terminal or cancel already requested
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
  if (terminalStatuses.has(job.status)) {
    return {
      success: true,
      result: {
        job_id: member.job_id,
        role,
        status: job.status,
        message: `Job ${member.job_id} is already ${job.status}`,
      },
    };
  }
  if (job.metadata?.cancelRequestedAt) {
    return {
      success: true,
      result: {
        job_id: member.job_id,
        role,
        status: job.status,
        message: `Job ${member.job_id} already has a pending cancel request`,
      },
    };
  }

  broker.requestCancel({
    jobId: member.job_id,
    requestedBy: 'team-agents',
    reason: `Shutdown requested for agent role: ${role}`,
  });

  return {
    success: true,
    result: {
      job_id: member.job_id,
      role,
      status: 'cancelling',
      message: `Shutdown requested for agent "${role}"`,
    },
  };
}

function opRemoveAgent(params: {
  session_id: string;
  role: string;
}): CcwToolResult {
  const { session_id, role } = params;
  const members = readMembers(session_id);
  const idx = members.findIndex(m => m.role === role);

  if (idx === -1) {
    return {
      success: false,
      error: `Agent with role "${role}" not found in session ${session_id}`,
    };
  }

  const removed = members.splice(idx, 1)[0];
  writeMembers(session_id, members);

  return {
    success: true,
    result: {
      role: removed.role,
      job_id: removed.job_id,
      message: `Removed agent "${role}" from session ${session_id}`,
    },
  };
}

function opMembers(params: {
  session_id: string;
}): CcwToolResult {
  const { session_id } = params;
  const members = readMembers(session_id);

  if (members.length === 0) {
    return {
      success: true,
      result: {
        members: [],
        total: 0,
        formatted: `No agents registered in session ${session_id}.`,
      },
    };
  }

  const broker = getBroker();

  type MemberStatus = 'running' | 'idle' | 'offline';
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

  const result = members.map(m => {
    const job = broker.getJob(m.job_id);
    let status: MemberStatus = 'offline';

    if (job) {
      if (terminalStatuses.has(job.status)) {
        status = 'idle';
      } else if (job.metadata?.cancelRequestedAt) {
        // Cancel was requested but job not yet terminal
        status = 'idle';
      } else if (job.status === 'running' || job.status === 'queued' || job.status === 'input_required') {
        status = 'running';
      }
    }

    return {
      role: m.role,
      status,
      tool: m.tool,
      job_id: m.job_id,
      spawned_at: m.spawned_at,
    };
  });

  const formatted = result.map(m =>
    `${m.role.padEnd(16)} | status: ${m.status.padEnd(7)} | tool: ${m.tool} | job: ${m.job_id}`
  ).join('\n');

  return {
    success: true,
    result: {
      members: result,
      total: result.length,
      formatted,
    },
  };
}

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

const ParamsSchema = z.object({
  operation: z
    .enum(['spawn_agent', 'shutdown_agent', 'remove_agent', 'members'])
    .describe('Operation to perform'),
  session_id: z.string().describe('Run ID for team namespace scoping; legacy team session IDs are accepted'),
  // spawn_agent params
  role: z.string().optional().describe('[spawn/shutdown/remove] Agent role name'),
  prompt: z.string().optional().describe('[spawn] Prompt/instructions for the agent'),
  tool: z.string().optional().describe('[spawn] CLI tool to use (default: gemini)'),
});

type Params = z.infer<typeof ParamsSchema>;

// ---------------------------------------------------------------------------
// Tool Schema
// ---------------------------------------------------------------------------

export const schema: ToolSchema = {
  name: 'team_agent',
  description: `Team agent lifecycle management - spawn, shutdown, remove agents via delegate broker.

**Storage Location:** {run_dir}/work/team/members.json (legacy team session IDs fall back to .workflow/.team/{session_id})

**Operations & Required Parameters:**

*   **spawn_agent**: Spawn a new agent in the team.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **role** (string, **REQUIRED**): Unique role name for the agent.
    *   **prompt** (string, **REQUIRED**): Instructions for the agent.
    *   *tool* (string): CLI tool to use (default: "gemini").

*   **shutdown_agent**: Cancel a running agent's delegate job.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **role** (string, **REQUIRED**): Role name of the agent to shut down.

*   **remove_agent**: Remove agent from team config.
    *   **session_id** (string, **REQUIRED**): Session ID.
    *   **role** (string, **REQUIRED**): Role name to remove.

*   **members**: List team members with live status from broker.
    *   **session_id** (string, **REQUIRED**): Session ID.`,

  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['spawn_agent', 'shutdown_agent', 'remove_agent', 'members'],
        description: 'Operation to perform',
      },
      session_id: {
        type: 'string',
        description: 'Run ID for team namespace scoping; legacy team session ID accepted',
      },
      role: {
        type: 'string',
        description: '[spawn/shutdown/remove] Agent role name',
      },
      prompt: {
        type: 'string',
        description: '[spawn] Prompt/instructions for the agent',
      },
      tool: {
        type: 'string',
        description: '[spawn] CLI tool to use (default: "gemini")',
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
    case 'spawn_agent': {
      if (!p.role) return { success: false, error: 'spawn_agent requires "role"' };
      if (!p.prompt) return { success: false, error: 'spawn_agent requires "prompt"' };
      return opSpawnAgent({
        session_id: p.session_id,
        role: p.role,
        prompt: p.prompt,
        tool: p.tool,
      });
    }
    case 'shutdown_agent': {
      if (!p.role) return { success: false, error: 'shutdown_agent requires "role"' };
      return opShutdownAgent({
        session_id: p.session_id,
        role: p.role,
      });
    }
    case 'remove_agent': {
      if (!p.role) return { success: false, error: 'remove_agent requires "role"' };
      return opRemoveAgent({
        session_id: p.session_id,
        role: p.role,
      });
    }
    case 'members': {
      return opMembers({ session_id: p.session_id });
    }
    default:
      return { success: false, error: `Unknown operation: ${p.operation}` };
  }
}
