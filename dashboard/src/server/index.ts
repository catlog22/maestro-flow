import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { loadConfig } from './config.js';
import { DashboardEventBus } from './state/event-bus.js';
import { StateManager } from './state/state-manager.js';
import { FSWatcher } from './state/fs-watcher.js';
import { SSEHub } from './sse/sse-hub.js';
import { WebSocketManager } from './ws/ws-manager.js';
import { AgentManager } from './agents/agent-manager.js';
import { ClaudeCodeAdapter } from './agents/claude-code-adapter.js';
import { StreamJsonAdapter } from './agents/stream-json-adapter.js';
import { CodexCliAdapter } from './agents/codex-cli-adapter.js';
import { CodexAppServerAdapter } from './agents/codex-app-server-adapter.js';
import { OpenCodeAdapter } from './agents/opencode-adapter.js';
import { AgentSdkAdapter } from './agents/agent-sdk-adapter.js';
import { ExecutionScheduler } from './execution/execution-scheduler.js';
import { CommanderAgent } from './commander/commander-agent.js';
import { loadCommanderConfig } from './commander/commander-config.js';
import { createRoutes } from './routes/index.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const workflowRoot = resolve(config.workflow_root);

  // ---------------------------------------------------------------------------
  // State infrastructure
  // ---------------------------------------------------------------------------
  const eventBus = new DashboardEventBus();
  const stateManager = new StateManager(workflowRoot, eventBus);
  const fsWatcher = new FSWatcher(
    workflowRoot,
    stateManager,
    eventBus,
    config.debounce_ms,
  );

  await stateManager.buildInitialState();
  fsWatcher.start();

  // ---------------------------------------------------------------------------
  // SSE Hub — broadcasts EventBus events to connected SSE clients
  // ---------------------------------------------------------------------------
  const sseHub = new SSEHub(eventBus, {
    maxConnections: config.max_connections,
    heartbeatMs: config.heartbeat_interval_ms,
  });

  // ---------------------------------------------------------------------------
  // Agent Manager — orchestrates CLI agent processes
  // ---------------------------------------------------------------------------
  const agentManager = new AgentManager(eventBus);
  agentManager.registerAdapter(new ClaudeCodeAdapter());
  agentManager.registerAdapter(new StreamJsonAdapter('npx -y @google/gemini-cli', 'gemini'));
  agentManager.registerAdapter(new StreamJsonAdapter('qwen', 'qwen'));
  agentManager.registerAdapter(new CodexCliAdapter());
  agentManager.registerAdapter(new CodexAppServerAdapter());
  agentManager.registerAdapter(new OpenCodeAdapter());
  agentManager.registerAdapter(new AgentSdkAdapter());

  // ---------------------------------------------------------------------------
  // Execution Scheduler — orchestrates issue execution via agent processes
  // ---------------------------------------------------------------------------
  const { join } = await import('node:path');
  const jsonlPath = join(workflowRoot, 'issues', 'issues.jsonl');
  const executionScheduler = new ExecutionScheduler(agentManager, eventBus, jsonlPath);

  // ---------------------------------------------------------------------------
  // Commander Agent — autonomous tick loop for project orchestration
  // ---------------------------------------------------------------------------
  const commanderConfig = await loadCommanderConfig(workflowRoot);
  const commanderAgent = new CommanderAgent(
    eventBus,
    stateManager,
    executionScheduler,
    agentManager,
    workflowRoot,
    commanderConfig,
  );

  // ---------------------------------------------------------------------------
  // WebSocket Manager — broadcasts EventBus events to connected WS clients
  // ---------------------------------------------------------------------------
  const wsManager = new WebSocketManager(eventBus, agentManager, executionScheduler, commanderAgent);

  // ---------------------------------------------------------------------------
  // Hono application
  // ---------------------------------------------------------------------------
  const app = new Hono();

  // Middleware
  app.use('*', cors({ origin: '*' }));
  app.use('*', logger());

  // API routes
  const routes = createRoutes(stateManager, workflowRoot, eventBus, sseHub, agentManager, executionScheduler, commanderAgent);
  app.route('/', routes);

  // Resolve dashboard root relative to this file (works for both dev and npm install)
  // In dev: src/server/index.ts → ../../dist
  // In prod: dist-server/server/index.js → ../../dist
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardRoot = resolve(__dirname, '..', '..');
  const distDir = resolve(dashboardRoot, 'dist');

  // Static files — serve Vite build output for production
  app.use('/*', serveStatic({ root: distDir }));

  // SPA fallback — serve index.html for all unmatched routes so React Router
  // can handle client-side navigation (e.g. /chat, /kanban, /workflow).
  const indexHtml = await readFile(resolve(distDir, 'index.html'), 'utf-8');
  app.get('/*', (c) => c.html(indexHtml));

  // ---------------------------------------------------------------------------
  // Start server
  // ---------------------------------------------------------------------------
  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    },
    (info) => {
      console.log(`Dashboard server listening on http://${config.host}:${info.port}`);
    },
  );

  // WebSocket upgrade handler
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wsManager.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    commanderAgent.stop();
    await executionScheduler.destroy();
    await agentManager.stopAll();
    wsManager.destroy();
    sseHub.destroy();
    await fsWatcher.stop();
    eventBus.removeAllListeners();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));
}

main().catch((err: unknown) => {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
});
