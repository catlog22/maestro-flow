import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeetingRoomMcpServer } from './meeting-room-mcp-server.js';
import { sendTcpRequest } from './tcp-helpers.js';
import { MeetingRoomSession } from '../meeting-room-session.js';
import type { DashboardEventBus } from '../../state/event-bus.js';
import type { AgentManager } from '../../agents/agent-manager.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockEventBus(): DashboardEventBus {
  return { emit: vi.fn() } as unknown as DashboardEventBus;
}

function createMockAgentManager(): AgentManager {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentManager;
}

// ---------------------------------------------------------------------------
// Helper: send a tool request to the TCP server
// ---------------------------------------------------------------------------

interface ToolResponse {
  id: string;
  result?: unknown;
  error?: string;
}

async function callTool(
  port: number,
  token: string,
  agentId: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<ToolResponse> {
  return sendTcpRequest({
    port,
    payload: { id: `test-${Date.now()}`, token, agentId, tool, args },
    timeoutMs: 5000,
  }) as Promise<ToolResponse>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeetingRoomMcpServer', () => {
  let session: MeetingRoomSession;
  let mcpServer: MeetingRoomMcpServer;
  let port: number;
  let token: string;

  beforeEach(async () => {
    session = new MeetingRoomSession(
      'test-session',
      createMockEventBus(),
      createMockAgentManager(),
    );
    mcpServer = new MeetingRoomMcpServer(session);
    const info = await mcpServer.start();
    port = info.port;
    token = info.token;
  });

  afterEach(async () => {
    await mcpServer.destroy();
  });

  // --- Server lifecycle ---

  it('starts on a random port with a valid token', () => {
    expect(port).toBeGreaterThan(0);
    expect(token).toHaveLength(32); // 16 hex bytes
  });

  it('rejects requests with invalid auth token', async () => {
    const resp = await callTool(port, 'bad-token', 'agent1', 'team_get_agents');
    expect(resp.error).toBe('Invalid auth token');
  });

  // --- team_get_agents ---

  it('team_get_agents returns empty list initially', async () => {
    const resp = await callTool(port, token, 'agent1', 'team_get_agents');
    expect(resp.error).toBeUndefined();
    expect(resp.result).toEqual([]);
  });

  // --- team_spawn_agent / team_shutdown_agent (leader ACL) ---

  it('team_spawn_agent rejects non-leader callers', async () => {
    const resp = await callTool(port, token, 'worker', 'team_spawn_agent', { role: 'coder' });
    expect(resp.error).toContain('requires leader role');
    expect(resp.error).toContain("Caller: 'worker'");
  });

  it('team_spawn_agent succeeds for leader', async () => {
    // Register leader first so ACL check finds the agent
    session.addAgent('leader');
    const resp = await callTool(port, token, 'leader', 'team_spawn_agent', { role: 'coder' });
    expect(resp.error).toBeUndefined();
    expect(resp.result).toMatchObject({ role: 'coder', status: 'idle' });
  });

  it('team_shutdown_agent rejects non-leader callers', async () => {
    session.addAgent('coder');
    const resp = await callTool(port, token, 'coder', 'team_shutdown_agent', { role: 'coder' });
    expect(resp.error).toContain('requires leader role');
  });

  it('team_shutdown_agent succeeds for leader', async () => {
    session.addAgent('leader');
    session.addAgent('coder');
    const resp = await callTool(port, token, 'leader', 'team_shutdown_agent', { role: 'coder' });
    expect(resp.error).toBeUndefined();
    expect(resp.result).toEqual({ role: 'coder', removed: true });
  });

  // --- team_send_message + team_read_messages ---

  it('sends and reads messages', async () => {
    session.addAgent('alice');
    session.addAgent('bob');

    const sendResp = await callTool(port, token, 'alice', 'team_send_message', {
      to: 'bob',
      content: 'Hello Bob!',
    });
    expect(sendResp.error).toBeUndefined();
    expect(sendResp.result).toMatchObject({ from: 'alice', to: 'bob' });

    const readResp = await callTool(port, token, 'bob', 'team_read_messages');
    expect(readResp.error).toBeUndefined();
    const messages = readResp.result as Array<{ content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello Bob!');
  });

  it('broadcasts to all agents', async () => {
    session.addAgent('alice');
    session.addAgent('bob');

    const sendResp = await callTool(port, token, 'alice', 'team_send_message', {
      to: '*',
      content: 'Hello everyone!',
    });
    expect(sendResp.error).toBeUndefined();
    expect(sendResp.result).toMatchObject({ to: '*' });
  });

  // --- team_create_task + team_update_task + team_list_tasks ---

  it('creates and lists tasks', async () => {
    const createResp = await callTool(port, token, 'agent1', 'team_create_task', {
      title: 'Task 1',
      description: 'Do something',
    });
    expect(createResp.error).toBeUndefined();
    expect(createResp.result).toMatchObject({ status: 'pending' });

    const listResp = await callTool(port, token, 'agent1', 'team_list_tasks');
    expect(listResp.error).toBeUndefined();
    const tasks = listResp.result as Array<{ title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Task 1');
  });

  it('updates task status', async () => {
    const createResp = await callTool(port, token, 'agent1', 'team_create_task', {
      title: 'Task 1',
      description: 'Do something',
    });
    const taskId = (createResp.result as { id: string }).id;

    const updateResp = await callTool(port, token, 'agent1', 'team_update_task', {
      taskId,
      status: 'completed',
    });
    expect(updateResp.error).toBeUndefined();
    expect(updateResp.result).toMatchObject({ status: 'completed' });
  });

  it('filters tasks by owner', async () => {
    await callTool(port, token, 'alice', 'team_create_task', {
      title: 'Alice Task',
      description: 'Alice work',
      owner: 'alice',
    });
    await callTool(port, token, 'bob', 'team_create_task', {
      title: 'Bob Task',
      description: 'Bob work',
      owner: 'bob',
    });

    const aliceTasks = await callTool(port, token, 'alice', 'team_list_tasks', {
      owner: 'alice',
    });
    const tasks = aliceTasks.result as Array<{ owner: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].owner).toBe('alice');
  });

  // --- Error handling ---

  it('returns error for unknown tool', async () => {
    const resp = await callTool(port, token, 'agent1', 'nonexistent_tool');
    expect(resp.error).toContain('Unknown tool');
  });

  it('returns error for missing required args', async () => {
    const resp = await callTool(port, token, 'agent1', 'team_create_task', {});
    expect(resp.error).toContain('Missing required args');
  });

  // --- wake-after-write pattern ---

  it('triggers safeWake after task completion with dependent tasks', async () => {
    // Register agents with process IDs so wake can find them
    session.addAgent('alice', 'proc-alice');
    session.addAgent('bob', 'proc-bob');

    // Create blocking task owned by alice
    const createResp1 = await callTool(port, token, 'alice', 'team_create_task', {
      title: 'Blocker',
      description: 'Blocking task',
      owner: 'alice',
    });
    const blockerId = (createResp1.result as { id: string }).id;

    // Create blocked task owned by bob
    await callTool(port, token, 'bob', 'team_create_task', {
      title: 'Blocked',
      description: 'Blocked task',
      owner: 'bob',
      blockedBy: [blockerId],
    });

    // Complete the blocker -- should trigger wake for alice (owner) and bob (unblocked)
    await callTool(port, token, 'alice', 'team_update_task', {
      taskId: blockerId,
      status: 'completed',
    });

    // Give fire-and-forget promises a tick to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The wake calls are fire-and-forget, so we verify indirectly by checking
    // that the blocked task is now pending (unblocked)
    const listResp = await callTool(port, token, 'bob', 'team_list_tasks', { owner: 'bob' });
    const bobTasks = listResp.result as Array<{ status: string }>;
    expect(bobTasks[0].status).toBe('pending');
  });
});
