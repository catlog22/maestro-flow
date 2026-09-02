import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '../core/tool-registry.js';
import { loadConfig } from '../config/index.js';
import { paths } from '../config/paths.js';
import { registerBuiltinTools } from '../tools/index.js';
import { DelegateChannelRelay } from './delegate-channel-relay.js';
import { createMcpToolRequestHandlers } from './tool-access.js';

// Exported for use by CliAgentRunner to push delegate-completion notifications
let _server: Server | null = null;
let _delegateRelay: DelegateChannelRelay | null = null;

export function getMcpServer(): Server | null {
  return _server;
}

export function getDelegateRelay(): DelegateChannelRelay | null {
  return _delegateRelay;
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const toolHandlers = createMcpToolRequestHandlers(
    registry,
    config.mcp.enabledTools,
    process.env.MAESTRO_ENABLED_TOOLS,
  );

  const server = new Server(
    { name: 'maestro', version: config.version },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions:
        'Use the delegate tool to spawn, follow, or cancel external CLI agents. ' +
        'Default mode is analysis (read-only); set mode="write" only when files must change. ' +
        'Delegate notifications also arrive as <channel source="maestro" exec_id="..." event_type="..." status="...">. ' +
        'When a delegate completes or fails, call delegate with operation=output (or status) using that exec_id.',
    }
  );

  _server = server;

  // DIAGNOSTIC: capture client capabilities/version after handshake completes.
  // 默认关闭（曾在每次 init 落一个 client-handshake-<pid>.json，堆积数百个残骸文件）；
  // 需要对比 CC 启动模式时用 MAESTRO_DEBUG_HANDSHAKE=1 显式开启。
  if (process.env.MAESTRO_DEBUG_HANDSHAKE === '1') {
    server.oninitialized = () => {
      try {
        const dir = join(paths.data, 'async');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `client-handshake-${process.pid}.json`);
        writeFileSync(file, JSON.stringify({
          pid: process.pid,
          ppid: process.ppid,
          ssePort: process.env.CLAUDE_CODE_SSE_PORT ?? null,
          capturedAt: new Date().toISOString(),
          clientVersion: server.getClientVersion() ?? null,
          clientCapabilities: server.getClientCapabilities() ?? null,
        }, null, 2), 'utf-8');
      } catch {
        // best-effort
      }
    };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => toolHandlers.list());

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    return toolHandlers.call(
      name,
      (args ?? {}) as Record<string, unknown>,
    ) as any;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const relay = new DelegateChannelRelay({ server });
  await relay.start();
  _delegateRelay = relay;
}

startMcpServer().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
