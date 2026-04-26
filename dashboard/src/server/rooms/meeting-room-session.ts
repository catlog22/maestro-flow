// ---------------------------------------------------------------------------
// MeetingRoomSession — thin coordinator composing subsystems + EventBus
// ---------------------------------------------------------------------------

import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { McpSdkServerConfigWithInstance, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { RoomMailbox } from './room-mailbox.js';
import { RoomTaskBoard } from './room-task-board.js';
import { RoomAgentRegistry } from './room-agent-registry.js';
import { MeetingRoomMcpServer } from './mcp-server/meeting-room-mcp-server.js';
import type { MeetingRoomMcpServerInfo } from './mcp-server/meeting-room-mcp-server.js';
import {
  getStdioConfig,
  getClaudeCodeConfig,
  getSdkMcpServer,
} from './mcp-server/mcp-config-builder.js';
import type { StdioMcpConfig } from './mcp-server/mcp-config-builder.js';
import type {
  RoomSessionStatus,
  RoomSessionSnapshot,
  RoomMailboxMessage,
  RoomTask,
  RoomTaskCreate,
  RoomTaskUpdate,
  RoomAgent,
  RoomAgentStatus,
  MessagePriority,
} from './room-types.js';

export type RoomMcpAgentType = 'claude-code' | 'codex' | 'agent-sdk';

export class MeetingRoomSession {
  readonly sessionId: string;
  private status: RoomSessionStatus = 'active';
  private readonly createdAt: string;

  readonly mailbox: RoomMailbox;
  readonly taskBoard: RoomTaskBoard;
  readonly agentRegistry: RoomAgentRegistry;

  private mcpServer: MeetingRoomMcpServer | null = null;
  private mcpServerInfo: MeetingRoomMcpServerInfo | null = null;

  constructor(
    sessionId: string,
    private readonly eventBus: DashboardEventBus,
    agentManager: AgentManager,
  ) {
    this.sessionId = sessionId;
    this.createdAt = new Date().toISOString();
    this.mailbox = new RoomMailbox();
    this.taskBoard = new RoomTaskBoard();
    this.agentRegistry = new RoomAgentRegistry(agentManager);
  }

  // --- Agent management ---

  addAgent(role: string, processId?: string): RoomAgent {
    const agent = this.agentRegistry.register(this.sessionId, role, processId);
    this.eventBus.emit('team:agent_status', {
      role: agent.role,
      status: agent.status,
      lastActivity: agent.lastActivityAt,
    });
    return agent;
  }

  removeAgent(role: string): boolean {
    const removed = this.agentRegistry.unregister(this.sessionId, role);
    if (removed) {
      this.eventBus.emit('team:agent_status', {
        role,
        status: 'offline',
        lastActivity: new Date().toISOString(),
      });
    }
    return removed;
  }

  setAgentStatus(role: string, status: RoomAgentStatus): boolean {
    const updated = this.agentRegistry.setStatus(this.sessionId, role, status);
    if (updated) {
      const agent = this.agentRegistry.getAgentByRole(this.sessionId, role);
      if (agent) {
        this.eventBus.emit('team:agent_status', {
          role: agent.role,
          status: agent.status,
          lastActivity: agent.lastActivityAt,
        });
      }
    }
    return updated;
  }

  getAgents(): RoomAgent[] {
    return this.agentRegistry.getAgents(this.sessionId);
  }

  // --- Messaging ---

  /** Send a message to a specific agent, write to mailbox + emit event + wake agent */
  async sendMessage(
    from: string,
    to: string,
    content: string,
    priority: MessagePriority = 'normal',
  ): Promise<RoomMailboxMessage> {
    const msg = this.mailbox.write(this.sessionId, from, to, content, priority);

    this.eventBus.emit('team:message', {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      dispatch_status: 'pending',
      timestamp: msg.createdAt,
    });

    // Wake the target agent
    if (to !== '*') {
      await this.agentRegistry.wake(this.sessionId, to, content);
    }

    return msg;
  }

  /** Broadcast a message to all agents */
  async broadcastMessage(
    from: string,
    content: string,
    priority: MessagePriority = 'normal',
  ): Promise<RoomMailboxMessage> {
    const msg = this.mailbox.write(this.sessionId, from, '*', content, priority);

    this.eventBus.emit('team:dispatch', {
      id: msg.id,
      from: msg.from,
      to: '*',
      content: msg.content,
      dispatch_status: 'pending',
      timestamp: msg.createdAt,
    });

    // Wake all agents
    const agents = this.agentRegistry.getAgents(this.sessionId);
    await Promise.allSettled(
      agents.map((agent) =>
        this.agentRegistry.wake(this.sessionId, agent.role, content),
      ),
    );

    return msg;
  }

  // --- Task management ---

  createTask(input: RoomTaskCreate): RoomTask {
    return this.taskBoard.create(this.sessionId, input);
  }

  updateTask(taskId: string, patch: RoomTaskUpdate): RoomTask | undefined {
    const task = this.taskBoard.update(this.sessionId, taskId, patch);

    // If task was marked completed, cascade unblocks
    if (task && patch.status === 'completed') {
      this.taskBoard.checkUnblocks(this.sessionId, taskId);
    }

    return task;
  }

  getTasks(): RoomTask[] {
    return this.taskBoard.list(this.sessionId);
  }

  // --- MCP server lifecycle ---

  /** Start the MCP TCP server. Must be called before getMcpConfig(). */
  async startMcp(): Promise<MeetingRoomMcpServerInfo> {
    if (this.mcpServer) {
      return this.mcpServer.getInfo();
    }
    this.mcpServer = new MeetingRoomMcpServer(this);
    this.mcpServerInfo = await this.mcpServer.start();
    return this.mcpServerInfo;
  }

  /** Stop the MCP TCP server and release resources. */
  async stopMcp(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.destroy();
      this.mcpServer = null;
      this.mcpServerInfo = null;
    }
  }

  /**
   * Get MCP config for a specific adapter type and agent.
   * - 'claude-code': returns McpStdioServerConfig for --mcp-config
   * - 'codex': returns StdioMcpConfig with env vars
   * - 'agent-sdk': returns McpSdkServerConfigWithInstance for in-process SDK
   */
  getMcpConfig(agentType: RoomMcpAgentType, agentId: string): McpStdioServerConfig | StdioMcpConfig | McpSdkServerConfigWithInstance {
    if (agentType === 'agent-sdk') {
      // SDK adapter uses in-process server -- no TCP needed
      return getSdkMcpServer(this, agentId);
    }

    // CLI adapters need the TCP server running
    if (!this.mcpServerInfo) {
      throw new Error('MCP server not started. Call startMcp() first.');
    }

    if (agentType === 'claude-code') {
      return getClaudeCodeConfig(agentId, this.mcpServerInfo);
    }

    // Default: stdio config (codex and other CLI adapters)
    return getStdioConfig(agentId, this.mcpServerInfo);
  }

  // --- Session lifecycle ---

  getSnapshot(): RoomSessionSnapshot {
    return {
      sessionId: this.sessionId,
      status: this.status,
      agents: this.agentRegistry.getAgents(this.sessionId),
      messages: this.mailbox.getHistory(this.sessionId),
      tasks: this.taskBoard.list(this.sessionId),
      createdAt: this.createdAt,
    };
  }

  getStatus(): RoomSessionStatus {
    return this.status;
  }

  pause(): void {
    this.status = 'paused';
  }

  resume(): void {
    this.status = 'active';
  }

  async destroy(): Promise<void> {
    this.status = 'destroyed';
    await this.stopMcp();
    this.mailbox.clear(this.sessionId);
    this.taskBoard.clear(this.sessionId);
    this.agentRegistry.clear(this.sessionId);
  }
}
