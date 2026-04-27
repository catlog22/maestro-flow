// ---------------------------------------------------------------------------
// Room MCP HTTP endpoint — Streamable HTTP transport for meeting room tools
// ---------------------------------------------------------------------------
// Claude Code --print mode doesn't connect stdio MCP servers. This HTTP
// endpoint implements the MCP Streamable HTTP transport (JSON-RPC over POST)
// so Claude Code can use `"type": "http"` in .mcp.json, which works reliably.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import type { RoomSessionManager } from '../rooms/room-session-manager.js';
import type { MeetingRoomSession } from '../rooms/meeting-room-session.js';

// ---------------------------------------------------------------------------
// Tool definitions (same as stdio-bridge)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'team_send_message',
    description: 'Send a message to another agent or broadcast to all agents (use to="*" for broadcast).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target agent role or "*" for broadcast' },
        content: { type: 'string', description: 'Message content' },
        priority: { type: 'string', enum: ['normal', 'high', 'urgent'], description: 'Message priority' },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: 'team_read_messages',
    description: 'Read all unread messages addressed to this agent.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'team_create_task',
    description: 'Create a new task on the team task board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        owner: { type: 'string', description: 'Agent role to own this task (defaults to caller)' },
        blockedBy: { type: 'array', items: { type: 'string' }, description: 'Task IDs this task depends on' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'team_update_task',
    description: 'Update an existing task. Can change title, description, status, or owner.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'blocked'], description: 'New status' },
        owner: { type: 'string', description: 'New owner role' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'team_list_tasks',
    description: 'List tasks on the team task board. Optionally filter by owner.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Filter tasks by owner role' },
      },
    },
  },
  {
    name: 'team_get_agents',
    description: 'List all agents currently in the meeting room.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'team_spawn_agent',
    description: 'Spawn a new agent into the meeting room (leader only).',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role name for the new agent' },
        processId: { type: 'string', description: 'Dashboard agent process ID to link' },
      },
      required: ['role'],
    },
  },
  {
    name: 'team_shutdown_agent',
    description: 'Remove an agent from the meeting room (leader only).',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role name of the agent to remove' },
      },
      required: ['role'],
    },
  },
];

const LEADER_ONLY_TOOLS = new Set(['team_spawn_agent', 'team_shutdown_agent']);

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function dispatchToolCall(
  session: MeetingRoomSession,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'team_send_message': {
      const { to, content, priority } = args as { to: string; content: string; priority?: 'normal' | 'high' | 'urgent' };
      if (!to || !content) throw new Error('Missing required args: to, content');
      const msg = to === '*'
        ? await session.broadcastMessage(agentId, content, priority)
        : await session.sendMessage(agentId, to, content, priority);
      return { id: msg.id, from: msg.from, to: msg.to, createdAt: msg.createdAt };
    }
    case 'team_read_messages': {
      const messages = session.mailbox.readUnread(session.sessionId, agentId);
      return messages.map((m) => ({ id: m.id, from: m.from, to: m.to, content: m.content, priority: m.priority, createdAt: m.createdAt }));
    }
    case 'team_create_task': {
      const title = args.title as string;
      const description = args.description as string;
      if (!title || !description) throw new Error('Missing required args: title, description');
      const task = session.createTask({ title, description, owner: (args.owner as string) ?? agentId, blockedBy: args.blockedBy as string[] });
      return { id: task.id, status: task.status, createdAt: task.createdAt };
    }
    case 'team_update_task': {
      const taskId = args.taskId as string;
      if (!taskId) throw new Error('Missing required arg: taskId');
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.status !== undefined) patch.status = args.status;
      if (args.owner !== undefined) patch.owner = args.owner;
      const task = session.updateTask(taskId, patch);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      return { id: task.id, status: task.status, updatedAt: task.updatedAt };
    }
    case 'team_list_tasks': {
      const owner = args.owner as string | undefined;
      const tasks = owner ? session.taskBoard.getByOwner(session.sessionId, owner) : session.getTasks();
      return tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, owner: t.owner, blockedBy: t.blockedBy, blocks: t.blocks }));
    }
    case 'team_get_agents': {
      const agents = session.getAgents();
      return agents.map((a) => ({ role: a.role, status: a.status, joinedAt: a.joinedAt, lastActivityAt: a.lastActivityAt }));
    }
    case 'team_spawn_agent': {
      const role = args.role as string;
      if (!role) throw new Error('Missing required arg: role');
      const agent = session.addAgent(role, args.processId as string | undefined);
      return { role: agent.role, status: agent.status, joinedAt: agent.joinedAt };
    }
    case 'team_shutdown_agent': {
      const role = args.role as string;
      if (!role) throw new Error('Missing required arg: role');
      const removed = session.removeAgent(role);
      return { role, removed };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function makeResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createRoomMcpRoutes(sessionManager: RoomSessionManager): Hono {
  const app = new Hono();

  // POST /api/rooms/:sessionId/mcp — MCP Streamable HTTP transport
  app.post('/api/rooms/:sessionId/mcp', async (c) => {
    const sessionId = c.req.param('sessionId');
    const token = c.req.query('token') ?? '';
    const agentId = c.req.query('agentId') ?? '';

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json(makeError(null, -32000, `Room not found: ${sessionId}`), 404);
    }

    // Validate token
    const mcpInfo = session.getMcpInfo?.();
    if (mcpInfo && token !== mcpInfo.token) {
      return c.json(makeError(null, -32000, 'Invalid auth token'), 401);
    }

    const body = await c.req.json<JsonRpcRequest>();
    const id = body.id ?? null;

    switch (body.method) {
      case 'initialize':
        return c.json(makeResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'meeting-room', version: '1.0.0' },
        }));

      case 'notifications/initialized':
        return c.json({});

      case 'tools/list':
        return c.json(makeResult(id, { tools: TOOL_DEFINITIONS }));

      case 'tools/call': {
        const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        if (!params?.name) {
          return c.json(makeError(id, -32602, 'Missing tool name'));
        }

        // ACL check for leader-only tools
        if (LEADER_ONLY_TOOLS.has(params.name) && agentId !== 'leader') {
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ error: `Tool '${params.name}' requires leader role. Caller: '${agentId}'` }) }],
            isError: true,
          }));
        }

        try {
          const result = await dispatchToolCall(session, agentId, params.name, params.arguments ?? {});
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.json(makeResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
            isError: true,
          }));
        }
      }

      case 'ping':
        return c.json(makeResult(id, {}));

      default:
        if (id !== null) {
          return c.json(makeError(id, -32601, `Method not found: ${body.method}`));
        }
        return c.json({});
    }
  });

  return app;
}
