import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the SDK to capture tool definitions
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
const capturedTools = new Map<string, ToolHandler>();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    capturedTools.set(name, handler);
    return { name, handler };
  },
  createSdkMcpServer: (opts: { name: string; tools: unknown[] }) => ({
    type: 'sdk',
    name: opts.name,
    instance: {},
  }),
}));

import {
  getStdioConfig,
  getClaudeCodeConfig,
  getSdkMcpServer,
} from './mcp-config-builder.js';
import { MeetingRoomSession } from '../meeting-room-session.js';
import type { DashboardEventBus } from '../../state/event-bus.js';
import type { AgentManager } from '../../agents/agent-manager.js';

function createMockSession(): MeetingRoomSession {
  const eventBus = { emit: vi.fn() } as unknown as DashboardEventBus;
  const agentManager = { sendMessage: vi.fn() } as unknown as AgentManager;
  return new MeetingRoomSession('test-session', eventBus, agentManager);
}

describe('mcp-config-builder', () => {
  const serverInfo = { port: 12345, token: 'test-token-abc' };

  describe('getStdioConfig', () => {
    it('returns correct command, args, and env', () => {
      const config = getStdioConfig('agent-1', serverInfo);
      expect(config.command).toBe(process.execPath);
      expect(config.args).toHaveLength(1);
      expect(config.args[0]).toContain('stdio-bridge');
      expect(config.env).toEqual({
        MEETING_ROOM_MCP_PORT: '12345',
        MEETING_ROOM_MCP_TOKEN: 'test-token-abc',
        MEETING_ROOM_AGENT_ID: 'agent-1',
      });
    });
  });

  describe('getClaudeCodeConfig', () => {
    it('returns McpStdioServerConfig with type stdio', () => {
      const config = getClaudeCodeConfig('agent-2', serverInfo);
      expect(config.type).toBe('stdio');
      expect(config.command).toBe(process.execPath);
      expect(config.args).toBeDefined();
      expect(config.env).toMatchObject({
        MEETING_ROOM_MCP_PORT: '12345',
        MEETING_ROOM_MCP_TOKEN: 'test-token-abc',
        MEETING_ROOM_AGENT_ID: 'agent-2',
      });
    });
  });

  describe('getSdkMcpServer', () => {
    it('returns McpSdkServerConfigWithInstance with correct name', () => {
      capturedTools.clear();
      const session = createMockSession();
      const config = getSdkMcpServer(session, 'agent-3');
      expect(config.type).toBe('sdk');
      expect(config.name).toBe('meeting-room');
    });

    it('registers all 8 tools', () => {
      capturedTools.clear();
      const session = createMockSession();
      getSdkMcpServer(session, 'agent-3');
      expect(capturedTools.size).toBe(8);
      expect(capturedTools.has('team_send_message')).toBe(true);
      expect(capturedTools.has('team_read_messages')).toBe(true);
      expect(capturedTools.has('team_create_task')).toBe(true);
      expect(capturedTools.has('team_update_task')).toBe(true);
      expect(capturedTools.has('team_list_tasks')).toBe(true);
      expect(capturedTools.has('team_get_agents')).toBe(true);
      expect(capturedTools.has('team_spawn_agent')).toBe(true);
      expect(capturedTools.has('team_shutdown_agent')).toBe(true);
    });

    it('team_spawn_agent enforces leader ACL in SDK tools', async () => {
      capturedTools.clear();
      const session = createMockSession();
      getSdkMcpServer(session, 'worker'); // non-leader

      const handler = capturedTools.get('team_spawn_agent')!;
      const result = await handler({ role: 'coder' });
      expect(result.isError).toBe(true);
      const text = JSON.parse(result.content[0].text);
      expect(text.error).toContain('requires leader role');
    });

    it('team_shutdown_agent enforces leader ACL in SDK tools', async () => {
      capturedTools.clear();
      const session = createMockSession();
      getSdkMcpServer(session, 'worker');

      const handler = capturedTools.get('team_shutdown_agent')!;
      const result = await handler({ role: 'coder' });
      expect(result.isError).toBe(true);
      const text = JSON.parse(result.content[0].text);
      expect(text.error).toContain('requires leader role');
    });

    it('team_read_messages reads unread messages via SDK tool', async () => {
      capturedTools.clear();
      const session = createMockSession();
      getSdkMcpServer(session, 'bob');

      // Write a message directly to mailbox
      session.mailbox.write('test-session', 'alice', 'bob', 'Hello!', 'normal');

      const handler = capturedTools.get('team_read_messages')!;
      const result = await handler({});
      const messages = JSON.parse(result.content[0].text);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello!');
    });

    it('team_create_task creates a task via SDK tool', async () => {
      capturedTools.clear();
      const session = createMockSession();
      getSdkMcpServer(session, 'agent-x');

      const handler = capturedTools.get('team_create_task')!;
      const result = await handler({ title: 'My Task', description: 'Do it' });
      const task = JSON.parse(result.content[0].text);
      expect(task.status).toBe('pending');
      expect(task.id).toBeDefined();
    });
  });
});
