#!/usr/bin/env node
// ---------------------------------------------------------------------------
// stdio-bridge — standalone Node.js script spawned as MCP server by CLI agents
// ---------------------------------------------------------------------------
// Reads MEETING_ROOM_MCP_PORT, MEETING_ROOM_MCP_TOKEN, MEETING_ROOM_AGENT_ID
// from env. Implements the MCP JSON-RPC stdio protocol: reads requests from
// stdin, forwards tool calls to the TCP server, writes responses to stdout.
// ---------------------------------------------------------------------------

import { createInterface } from 'node:readline';
import { sendTcpRequest } from './tcp-helpers.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.MEETING_ROOM_MCP_PORT ?? '', 10);
const TOKEN = process.env.MEETING_ROOM_MCP_TOKEN ?? '';
const AGENT_ID = process.env.MEETING_ROOM_AGENT_ID ?? '';

if (!PORT || !TOKEN || !AGENT_ID) {
  process.stderr.write(
    'Missing required env: MEETING_ROOM_MCP_PORT, MEETING_ROOM_MCP_TOKEN, MEETING_ROOM_AGENT_ID\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MCP tool definitions (matches the 8 tools from MeetingRoomMcpServer)
// ---------------------------------------------------------------------------

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: McpToolDef[] = [
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
    inputSchema: {
      type: 'object',
      properties: {},
    },
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
    inputSchema: {
      type: 'object',
      properties: {},
    },
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

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sendResponse(resp: JsonRpcResponse): void {
  const body = JSON.stringify(resp);
  // MCP stdio uses Content-Length header framing
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function makeResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function makeError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Request counter for TCP request IDs
// ---------------------------------------------------------------------------

let reqCounter = 0;
function nextReqId(): string {
  return `bridge-${++reqCounter}`;
}

// ---------------------------------------------------------------------------
// Forward a tool call to the TCP server
// ---------------------------------------------------------------------------

async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await sendTcpRequest({
    port: PORT,
    payload: {
      id: nextReqId(),
      token: TOKEN,
      agentId: AGENT_ID,
      tool: toolName,
      args,
    },
  }) as { result?: unknown; error?: string };

  if (response.error) {
    throw new Error(response.error);
  }
  return response.result;
}

// ---------------------------------------------------------------------------
// Handle MCP JSON-RPC methods
// ---------------------------------------------------------------------------

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize': {
      sendResponse(makeResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'meeting-room',
          version: '1.0.0',
        },
      }));
      break;
    }

    case 'notifications/initialized': {
      // Notification -- no response needed
      break;
    }

    case 'tools/list': {
      sendResponse(makeResult(id, {
        tools: TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      }));
      break;
    }

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        sendResponse(makeError(id, -32602, 'Missing tool name'));
        return;
      }

      const toolDef = TOOL_DEFINITIONS.find((t) => t.name === params.name);
      if (!toolDef) {
        sendResponse(makeError(id, -32602, `Unknown tool: ${params.name}`));
        return;
      }

      try {
        const result = await forwardToolCall(params.name, params.arguments ?? {});
        sendResponse(makeResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse(makeResult(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true,
        }));
      }
      break;
    }

    case 'ping': {
      sendResponse(makeResult(id, {}));
      break;
    }

    default: {
      if (id !== null) {
        sendResponse(makeError(id, -32601, `Method not found: ${req.method}`));
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Stdio transport: Content-Length framed JSON-RPC
// ---------------------------------------------------------------------------

function startStdioTransport(): void {
  let buffer = '';

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  // MCP stdio transport uses Content-Length header framing.
  // We accumulate input and parse header + body pairs.
  let contentLength = -1;

  process.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (contentLength === -1) {
        // Look for Content-Length header
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const headerSection = buffer.substring(0, headerEnd);
        const match = headerSection.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Skip malformed header
          buffer = buffer.substring(headerEnd + 4);
          continue;
        }

        contentLength = parseInt(match[1], 10);
        buffer = buffer.substring(headerEnd + 4);
      }

      if (contentLength >= 0 && Buffer.byteLength(buffer, 'utf-8') >= contentLength) {
        // Extract exactly contentLength bytes
        const bodyBytes = Buffer.from(buffer, 'utf-8').subarray(0, contentLength);
        const bodyStr = bodyBytes.toString('utf-8');
        buffer = Buffer.from(buffer, 'utf-8').subarray(contentLength).toString('utf-8');
        contentLength = -1;

        try {
          const req = JSON.parse(bodyStr) as JsonRpcRequest;
          handleRequest(req).catch((err) => {
            process.stderr.write(`Error handling request: ${err}\n`);
          });
        } catch {
          process.stderr.write('Failed to parse JSON-RPC request\n');
        }
      } else {
        break;
      }
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

startStdioTransport();
