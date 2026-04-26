// ---------------------------------------------------------------------------
// MeetingRoomMcpServer -- TCP server exposing 8 MCP tools for room subsystems
// ---------------------------------------------------------------------------
// Listens on port 0 (loopback only) with a random auth token.
// Each incoming connection receives length-framed JSON messages (see tcp-helpers).
// Tool calls are dispatched to the MeetingRoomSession subsystems.
// ---------------------------------------------------------------------------

import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { writeTcpMessage, createTcpMessageReader } from './tcp-helpers.js';
import type { MeetingRoomSession } from '../meeting-room-session.js';
import type {
  MessagePriority,
  RoomTaskUpdate,
} from '../room-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolRequest {
  id: string;
  token: string;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface McpToolResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export interface MeetingRoomMcpServerInfo {
  port: number;
  token: string;
}

// Leader-only tools that require the calling agent to have the 'leader' role
const LEADER_ONLY_TOOLS = new Set(['team_spawn_agent', 'team_shutdown_agent']);

// ---------------------------------------------------------------------------
// MeetingRoomMcpServer
// ---------------------------------------------------------------------------

export class MeetingRoomMcpServer {
  private server: Server | null = null;
  private readonly token: string;
  private port = 0;
  private readonly connections = new Set<Socket>();

  constructor(private readonly session: MeetingRoomSession) {
    this.token = randomBytes(16).toString('hex');
  }

  // --- Lifecycle -----------------------------------------------------------

  async start(): Promise<MeetingRoomMcpServerInfo> {
    return new Promise((resolve, reject) => {
      const srv = createServer((socket) => this.handleConnection(socket));
      this.server = srv;

      srv.on('error', reject);

      // Listen on port 0, loopback only
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }
        this.port = addr.port;
        resolve({ port: this.port, token: this.token });
      });
    });
  }

  async destroy(): Promise<void> {
    // Close all active connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  getInfo(): MeetingRoomMcpServerInfo {
    return { port: this.port, token: this.token };
  }

  // --- Connection handling -------------------------------------------------

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    const reader = createTcpMessageReader();

    socket.on('data', (chunk: Buffer) => {
      const messages = reader.feed(chunk);
      for (const msg of messages) {
        this.handleMessage(socket, msg as McpToolRequest);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  private async handleMessage(socket: Socket, req: McpToolRequest): Promise<void> {
    // Validate auth token
    if (req.token !== this.token) {
      writeTcpMessage(socket, { id: req.id, error: 'Invalid auth token' } satisfies McpToolResponse);
      return;
    }

    // Check leader-only ACL
    if (LEADER_ONLY_TOOLS.has(req.tool)) {
      const agent = this.session.agentRegistry.getAgentByRole(
        this.session.sessionId,
        req.agentId,
      );
      if (!agent || req.agentId !== 'leader') {
        writeTcpMessage(socket, {
          id: req.id,
          error: `Tool '${req.tool}' requires leader role. Caller: '${req.agentId}'`,
        } satisfies McpToolResponse);
        return;
      }
    }

    try {
      const result = await this.handleToolCall(req);
      writeTcpMessage(socket, { id: req.id, result } satisfies McpToolResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeTcpMessage(socket, { id: req.id, error: message } satisfies McpToolResponse);
    }
  }

  // --- Tool dispatch -------------------------------------------------------

  private async handleToolCall(req: McpToolRequest): Promise<unknown> {
    switch (req.tool) {
      case 'team_send_message':
        return this.toolSendMessage(req);
      case 'team_read_messages':
        return this.toolReadMessages(req);
      case 'team_create_task':
        return this.toolCreateTask(req);
      case 'team_update_task':
        return this.toolUpdateTask(req);
      case 'team_list_tasks':
        return this.toolListTasks(req);
      case 'team_get_agents':
        return this.toolGetAgents(req);
      case 'team_spawn_agent':
        return this.toolSpawnAgent(req);
      case 'team_shutdown_agent':
        return this.toolShutdownAgent(req);
      default:
        throw new Error(`Unknown tool: ${req.tool}`);
    }
  }

  // --- Tool implementations ------------------------------------------------

  private async toolSendMessage(req: McpToolRequest): Promise<unknown> {
    const { to, content, priority } = req.args as {
      to: string;
      content: string;
      priority?: MessagePriority;
    };

    if (!to || !content) {
      throw new Error('Missing required args: to, content');
    }

    const msg = to === '*'
      ? await this.session.broadcastMessage(req.agentId, content, priority)
      : await this.session.sendMessage(req.agentId, to, content, priority);

    // safeWake is already handled inside sendMessage/broadcastMessage
    return { id: msg.id, from: msg.from, to: msg.to, createdAt: msg.createdAt };
  }

  private toolReadMessages(req: McpToolRequest): unknown {
    const messages = this.session.mailbox.readUnread(
      this.session.sessionId,
      req.agentId,
    );
    return messages.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      content: m.content,
      priority: m.priority,
      createdAt: m.createdAt,
    }));
  }

  private toolCreateTask(req: McpToolRequest): unknown {
    const title = req.args.title as string | undefined;
    const description = req.args.description as string | undefined;
    const owner = (req.args.owner as string | undefined) ?? req.agentId;
    const blockedBy = req.args.blockedBy as string[] | undefined;

    if (!title || !description) {
      throw new Error('Missing required args: title, description');
    }

    const task = this.session.createTask({
      title,
      description,
      owner,
      blockedBy,
    });
    return { id: task.id, status: task.status, createdAt: task.createdAt };
  }

  private toolUpdateTask(req: McpToolRequest): unknown {
    const taskId = req.args.taskId as string | undefined;
    const patch: RoomTaskUpdate = {};
    if (req.args.title !== undefined) patch.title = req.args.title as string;
    if (req.args.description !== undefined) patch.description = req.args.description as string;
    if (req.args.status !== undefined) patch.status = req.args.status as RoomTaskUpdate['status'];
    if (req.args.owner !== undefined) patch.owner = req.args.owner as string;

    if (!taskId) {
      throw new Error('Missing required arg: taskId');
    }

    const task = this.session.updateTask(taskId, patch);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // safeWake: if task completed, wake owner and any newly unblocked task owners
    if (patch.status === 'completed') {
      this.safeWakeAfterTaskComplete(task.id);
    }

    return { id: task.id, status: task.status, updatedAt: task.updatedAt };
  }

  private toolListTasks(req: McpToolRequest): unknown {
    const { owner } = req.args as { owner?: string };
    const tasks = owner
      ? this.session.taskBoard.getByOwner(this.session.sessionId, owner)
      : this.session.getTasks();

    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      owner: t.owner,
      blockedBy: t.blockedBy,
      blocks: t.blocks,
    }));
  }

  private toolGetAgents(_req: McpToolRequest): unknown {
    const agents = this.session.getAgents();
    return agents.map((a) => ({
      role: a.role,
      status: a.status,
      joinedAt: a.joinedAt,
      lastActivityAt: a.lastActivityAt,
    }));
  }

  private toolSpawnAgent(req: McpToolRequest): unknown {
    const { role, processId } = req.args as { role: string; processId?: string };

    if (!role) {
      throw new Error('Missing required arg: role');
    }

    const agent = this.session.addAgent(role, processId);
    return { role: agent.role, status: agent.status, joinedAt: agent.joinedAt };
  }

  private toolShutdownAgent(req: McpToolRequest): unknown {
    const { role } = req.args as { role: string };

    if (!role) {
      throw new Error('Missing required arg: role');
    }

    const removed = this.session.removeAgent(role);
    return { role, removed };
  }

  // --- safeWake pattern: fire-and-forget after state changes ---------------

  /**
   * Fire-and-forget wake after task completion.
   * Wakes the task owner and any agents whose tasks became unblocked.
   */
  private safeWakeAfterTaskComplete(taskId: string): void {
    const tasks = this.session.getTasks();
    const completed = tasks.find((t) => t.id === taskId);
    if (!completed) return;

    // Build set of agents to wake: task owner + owners of tasks that were blocked by this task
    const toWake = new Set<string>();
    if (completed.owner) toWake.add(completed.owner);

    for (const blockedId of completed.blocks) {
      const blocked = tasks.find((t) => t.id === blockedId);
      if (blocked?.owner && blocked.status === 'pending') {
        toWake.add(blocked.owner);
      }
    }

    // Fire-and-forget: errors are silently caught
    for (const role of toWake) {
      this.session.agentRegistry
        .wake(this.session.sessionId, role, `Task ${taskId} completed`)
        .catch(() => { /* fire-and-forget */ });
    }
  }
}
