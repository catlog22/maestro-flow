// ---------------------------------------------------------------------------
// MCP Config Builder -- per-adapter MCP config generation
// ---------------------------------------------------------------------------
// Produces MCP server configurations tailored to each adapter type:
//   - Claude Code CLI: stdio server config for --mcp-config
//   - Codex / other CLI: stdio server config with env vars
//   - Agent SDK: in-process SDK MCP server instance
// ---------------------------------------------------------------------------

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { MeetingRoomSession } from '../meeting-room-session.js';
import type { MeetingRoomMcpServerInfo } from './meeting-room-mcp-server.js';

// ---------------------------------------------------------------------------
// Resolve path to the stdio-bridge script (compiled .js or dev .ts)
// ---------------------------------------------------------------------------

const CURRENT_DIR = resolve(fileURLToPath(import.meta.url), '..');
const JS_PATH = join(CURRENT_DIR, 'stdio-bridge.js');
const TS_PATH = join(CURRENT_DIR, 'stdio-bridge.ts');
// Use .js in production (compiled), fall back to .ts in dev (tsx)
const IS_DEV = !existsSync(JS_PATH) && existsSync(TS_PATH);
const STDIO_BRIDGE_PATH = IS_DEV ? TS_PATH : JS_PATH;
// In dev mode, use tsx to run .ts files; in production, use node
const STDIO_BRIDGE_COMMAND = IS_DEV ? 'npx' : process.execPath;
const STDIO_BRIDGE_ARGS = IS_DEV ? ['tsx', STDIO_BRIDGE_PATH] : [STDIO_BRIDGE_PATH];

// ---------------------------------------------------------------------------
// Stdio config (for Claude Code, Codex, and other CLI adapters)
// ---------------------------------------------------------------------------

export interface StdioMcpConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build a stdio server config with env vars pointing to the TCP server.
 * Used by any CLI adapter that spawns the bridge as a child process.
 */
export function getStdioConfig(
  agentId: string,
  serverInfo: MeetingRoomMcpServerInfo,
): StdioMcpConfig {
  return {
    command: STDIO_BRIDGE_COMMAND,
    args: [...STDIO_BRIDGE_ARGS],
    env: {
      MEETING_ROOM_MCP_PORT: String(serverInfo.port),
      MEETING_ROOM_MCP_TOKEN: serverInfo.token,
      MEETING_ROOM_AGENT_ID: agentId,
    },
  };
}

/**
 * Build an McpStdioServerConfig for Claude Code's --mcp-config flag.
 * Returns the config object that can be serialized to JSON and passed
 * as mcpServers entry in Claude Code's config file.
 */
export function getClaudeCodeConfig(
  agentId: string,
  serverInfo: MeetingRoomMcpServerInfo,
): McpStdioServerConfig {
  return {
    type: 'stdio',
    command: STDIO_BRIDGE_COMMAND,
    args: [...STDIO_BRIDGE_ARGS],
    env: {
      MEETING_ROOM_MCP_PORT: String(serverInfo.port),
      MEETING_ROOM_MCP_TOKEN: serverInfo.token,
      MEETING_ROOM_AGENT_ID: agentId,
    },
  };
}

// ---------------------------------------------------------------------------
// SDK in-process server (for Agent SDK adapter)
// ---------------------------------------------------------------------------

/**
 * Build an in-process SDK MCP server that dispatches directly to the session.
 * No TCP overhead -- tools call session methods directly.
 */
export function getSdkMcpServer(
  session: MeetingRoomSession,
  agentId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'meeting-room',
    tools: buildSdkTools(session, agentId),
  });
}

// ---------------------------------------------------------------------------
// SDK tool definitions (same 8 tools, calling session directly)
// ---------------------------------------------------------------------------

function buildSdkTools(session: MeetingRoomSession, agentId: string) {
  const sendMessageTool = tool(
    'team_send_message',
    'Send a message to another agent or broadcast to all agents (use to="*" for broadcast).',
    {
      to: z.string().describe('Target agent role or "*" for broadcast'),
      content: z.string().describe('Message content'),
      priority: z.enum(['normal', 'high', 'urgent']).optional().describe('Message priority'),
    },
    async (args) => {
      const msg = args.to === '*'
        ? await session.broadcastMessage(agentId, args.content, args.priority)
        : await session.sendMessage(agentId, args.to, args.content, args.priority);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: msg.id, from: msg.from, to: msg.to, createdAt: msg.createdAt }) }] };
    },
  );

  const readMessagesTool = tool(
    'team_read_messages',
    'Read all unread messages addressed to this agent.',
    {},
    async () => {
      const messages = session.mailbox.readUnread(session.sessionId, agentId);
      const result = messages.map((m) => ({
        id: m.id, from: m.from, to: m.to,
        content: m.content, priority: m.priority, createdAt: m.createdAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  const createTaskTool = tool(
    'team_create_task',
    'Create a new task on the team task board.',
    {
      title: z.string().describe('Task title'),
      description: z.string().describe('Task description'),
      owner: z.string().optional().describe('Agent role to own this task (defaults to caller)'),
      blockedBy: z.array(z.string()).optional().describe('Task IDs this task depends on'),
    },
    async (args) => {
      const task = session.createTask({
        title: args.title,
        description: args.description,
        owner: args.owner ?? agentId,
        blockedBy: args.blockedBy,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: task.id, status: task.status, createdAt: task.createdAt }) }] };
    },
  );

  const updateTaskTool = tool(
    'team_update_task',
    'Update an existing task. Can change title, description, status, or owner.',
    {
      taskId: z.string().describe('Task ID to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'blocked']).optional().describe('New status'),
      owner: z.string().optional().describe('New owner role'),
    },
    async (args) => {
      const { taskId, ...patch } = args;
      const task = session.updateTask(taskId, patch);
      if (!task) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Task not found: ${taskId}` }) }], isError: true };
      }

      // safeWake after task completion
      if (patch.status === 'completed') {
        safeWakeAfterTaskComplete(session, task.id);
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: task.id, status: task.status, updatedAt: task.updatedAt }) }] };
    },
  );

  const listTasksTool = tool(
    'team_list_tasks',
    'List tasks on the team task board. Optionally filter by owner.',
    {
      owner: z.string().optional().describe('Filter tasks by owner role'),
    },
    async (args) => {
      const tasks = args.owner
        ? session.taskBoard.getByOwner(session.sessionId, args.owner)
        : session.getTasks();
      const result = tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status,
        owner: t.owner, blockedBy: t.blockedBy, blocks: t.blocks,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  const getAgentsTool = tool(
    'team_get_agents',
    'List all agents currently in the meeting room.',
    {},
    async () => {
      const agents = session.getAgents();
      const result = agents.map((a) => ({
        role: a.role, status: a.status,
        joinedAt: a.joinedAt, lastActivityAt: a.lastActivityAt,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  const spawnAgentTool = tool(
    'team_spawn_agent',
    'Spawn a new agent into the meeting room (leader only).',
    {
      role: z.string().describe('Role name for the new agent'),
      processId: z.string().optional().describe('Dashboard agent process ID to link'),
    },
    async (args) => {
      // Leader-only ACL
      if (agentId !== 'leader') {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Tool 'team_spawn_agent' requires leader role. Caller: '${agentId}'` }) }], isError: true };
      }
      const agent = session.addAgent(args.role, args.processId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ role: agent.role, status: agent.status, joinedAt: agent.joinedAt }) }] };
    },
  );

  const shutdownAgentTool = tool(
    'team_shutdown_agent',
    'Remove an agent from the meeting room (leader only).',
    {
      role: z.string().describe('Role name of the agent to remove'),
    },
    async (args) => {
      // Leader-only ACL
      if (agentId !== 'leader') {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Tool 'team_shutdown_agent' requires leader role. Caller: '${agentId}'` }) }], isError: true };
      }
      const removed = session.removeAgent(args.role);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ role: args.role, removed }) }] };
    },
  );

  return [
    sendMessageTool,
    readMessagesTool,
    createTaskTool,
    updateTaskTool,
    listTasksTool,
    getAgentsTool,
    spawnAgentTool,
    shutdownAgentTool,
  ];
}

// ---------------------------------------------------------------------------
// safeWake helper (shared with SDK tools)
// ---------------------------------------------------------------------------

function safeWakeAfterTaskComplete(session: MeetingRoomSession, taskId: string): void {
  const tasks = session.getTasks();
  const completed = tasks.find((t) => t.id === taskId);
  if (!completed) return;

  const toWake = new Set<string>();
  if (completed.owner) toWake.add(completed.owner);

  for (const blockedId of completed.blocks) {
    const blocked = tasks.find((t) => t.id === blockedId);
    if (blocked?.owner && blocked.status === 'pending') {
      toWake.add(blocked.owner);
    }
  }

  for (const role of toWake) {
    session.agentRegistry
      .wake(session.sessionId, role, `Task ${taskId} completed`)
      .catch(() => { /* fire-and-forget */ });
  }
}
