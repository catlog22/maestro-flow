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
import { createMcpToolRequestHandlers, type McpRepositoryAccessOptions } from './tool-access.js';
import { resolveAgentRepositoryContext } from '../repository/context.js';

// Exported for use by CliAgentRunner to push delegate-completion notifications
let _server: Server | null = null;
let _delegateRelay: DelegateChannelRelay | null = null;

export function getMcpServer(): Server | null {
  return _server;
}

export function getDelegateRelay(): DelegateChannelRelay | null {
  return _delegateRelay;
}

/** Bind the MCP process to the installed manifest identity without cwd fallback. */
export function resolveMcpRepositoryAccess(
  env: NodeJS.ProcessEnv = process.env,
): McpRepositoryAccessOptions {
  const projectRoot = env.MAESTRO_PROJECT_ROOT;
  const installedRepoId = env.MAESTRO_REPO_ID;
  if (!projectRoot || !installedRepoId) {
    return { repositoryBindingError: 'MCP server is not installed with MAESTRO_PROJECT_ROOT and MAESTRO_REPO_ID' };
  }
  try {
    const repositoryContext = resolveAgentRepositoryContext(projectRoot);
    if (repositoryContext.currentRepoId !== installedRepoId) {
      return {
        repositoryBindingError: `installed repository identity mismatch: expected ${installedRepoId}, found ${repositoryContext.currentRepoId ?? 'none'}`,
      };
    }
    return { repositoryContext };
  } catch (error) {
    return { repositoryBindingError: error instanceof Error ? error.message : String(error) };
  }
}

export async function startMcpServer(): Promise<void> {
  const config = loadConfig();
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  const toolHandlers = createMcpToolRequestHandlers(
    registry,
    config.mcp.enabledTools,
    process.env.MAESTRO_ENABLED_TOOLS,
    resolveMcpRepositoryAccess(),
  );

  const server = new Server(
    { name: 'maestro', version: config.version },
    {
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      instructions:
        'Delegate task notifications arrive as <channel source="maestro" exec_id="..." event_type="..." status="...">. ' +
        'These are one-way status updates from async delegate workers. ' +
        'When a delegate completes (status=completed) or fails (status=failed), report the result. ' +
        'For full output details, run "maestro delegate status <exec_id>" or "maestro delegate output <exec_id>" in the shell.',
    }
  );

  _server = server;

  // DIAGNOSTIC: capture client capabilities/version after handshake completes.
  // Compare two CC startup modes:
  //   1) plain `claude` (or `claude mcp add maestro`)
  //   2) `claude --dangerously-load-development-channels server:maestro`
  // and diff the two files to learn whether CC announces a channel-aware
  // reciprocal capability the server can detect.
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
