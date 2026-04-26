import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import type { AgentType } from '../shared/agent-types.js';
import { loadConfig } from './config.js';
import { DashboardEventBus } from './state/event-bus.js';
import { StateManager } from './state/state-manager.js';
import { FSWatcher } from './state/fs-watcher.js';
import { SSEHub } from './sse/sse-hub.js';
import { WebSocketManager } from './ws/ws-manager.js';
import { AgentWsHandler } from './ws/handlers/agent-handler.js';
import { ExecutionWsHandler } from './ws/handlers/execution-handler.js';
import { CommanderWsHandler } from './ws/handlers/commander-handler.js';
import { CoordinateWsHandler } from './ws/handlers/coordinate-handler.js';
import { RequirementWsHandler } from './ws/handlers/requirement-handler.js';
import { AgentManager } from './agents/agent-manager.js';
import { createAdapterForType } from './agents/adapter-factory.js';
import { AgentSdkAdapter } from './agents/agent-sdk-adapter.js';
import { DelegateBrokerMonitor } from './agents/delegate-broker-monitor.js';
import { ExecutionScheduler } from './execution/execution-scheduler.js';
import { ExecutionJournal } from './execution/execution-journal.js';
import { WaveExecutor } from './execution/wave-executor.js';
import { CommanderAgent } from './commander/commander-agent.js';
import { loadCommanderConfig } from './commander/commander-config.js';
import { WorkflowCoordinator } from './coordinator/workflow-coordinator.js';
import { RequirementExpander } from './requirement/requirement-expander.js';
import { PromptRegistry } from './prompt/prompt-registry.js';
import { SelfLearningService } from './supervisor/self-learning-service.js';
import { TaskSchedulerService } from './supervisor/task-scheduler-service.js';
import { ExtensionManager } from './supervisor/extension-manager.js';
import { SupervisorWsHandler } from './ws/handlers/supervisor-handler.js';
import { TeamWsHandler } from './ws/handlers/team-handler.js';
import { RoomWsHandler } from './ws/handlers/room-handler.js';
import { SessionScopedEventFilter } from './ws/session-scoped-event-filter.js';
import { ObservabilityService } from './observability/observability-service.js';
import { RoomSessionManager } from './rooms/room-session-manager.js';
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
  const SUBPROCESS_AGENT_TYPES: AgentType[] = [
    'claude-code', 'gemini', 'gemini-a2a', 'qwen', 'codex', 'codex-server', 'opencode',
  ];
  for (const type of SUBPROCESS_AGENT_TYPES) {
    agentManager.registerAdapter(await createAdapterForType(type));
  }
  agentManager.registerAdapter(new AgentSdkAdapter(workflowRoot));
  const delegateBrokerMonitor = new DelegateBrokerMonitor({ agentManager, eventBus });
  delegateBrokerMonitor.start();

  // ---------------------------------------------------------------------------
  // Room Session Manager — multi-CLI meeting room coordination
  // ---------------------------------------------------------------------------
  const roomSessionManager = new RoomSessionManager(agentManager, eventBus);

  // ---------------------------------------------------------------------------
  // Execution Scheduler — orchestrates issue execution via agent processes
  // ---------------------------------------------------------------------------
  const { join } = await import('node:path');
  const { resolveIssuesJsonlPath } = await import('./utils/issue-store.js');
  const jsonlPath = await resolveIssuesJsonlPath(workflowRoot);
  const journal = new ExecutionJournal(workflowRoot);

  // Create SelfLearningService before ExecutionScheduler so it can be injected
  const promptRegistry = PromptRegistry.createDefault();
  const learningService = new SelfLearningService(eventBus, journal, workflowRoot);

  const executionScheduler = new ExecutionScheduler(
    agentManager, eventBus, jsonlPath,
    undefined, undefined, journal, learningService,
  );

  // ---------------------------------------------------------------------------
  // Supervisor Services — task scheduling, extension management
  // ---------------------------------------------------------------------------
  const taskSchedulerService = new TaskSchedulerService(
    eventBus, workflowRoot, executionScheduler, learningService,
  );
  const extensionManager = new ExtensionManager(eventBus, agentManager, promptRegistry);
  extensionManager.init();

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
  // Wave Executor — CSV-wave-inspired parallel execution using Agent SDK
  // ---------------------------------------------------------------------------
  const projectRoot = resolve(workflowRoot, '..');
  const waveExecutor = new WaveExecutor(eventBus, agentManager, projectRoot, executionScheduler, journal);

  // ---------------------------------------------------------------------------
  // Workflow Coordinator — multi-agent intent classification + chain execution
  // ---------------------------------------------------------------------------
  const coordinateRunner = new WorkflowCoordinator(eventBus, agentManager, stateManager, workflowRoot);

  // ---------------------------------------------------------------------------
  // Requirement Expander — expand user requirements into structured checklists
  // ---------------------------------------------------------------------------
  const requirementExpander = new RequirementExpander(coordinateRunner, jsonlPath);

  // ---------------------------------------------------------------------------
  // Observability — cross-component event timeline (timeline.jsonl)
  // ---------------------------------------------------------------------------
  const _observability = new ObservabilityService(eventBus, workflowRoot);

  // Forward requirement progress events to EventBus for WS broadcast
  requirementExpander.onProgress((payload) => {
    eventBus.emit('requirement:progress', payload);
  });

  // ---------------------------------------------------------------------------
  // WebSocket Handlers + Manager
  // ---------------------------------------------------------------------------
  const agentHandler = new AgentWsHandler(agentManager, eventBus, workflowRoot);
  const executionHandler = new ExecutionWsHandler(executionScheduler, waveExecutor, agentManager, eventBus, workflowRoot, agentHandler);
  const commanderHandler = new CommanderWsHandler(commanderAgent);
  const coordinateHandler = new CoordinateWsHandler(coordinateRunner);
  const requirementHandler = new RequirementWsHandler(requirementExpander);

  const supervisorHandler = new SupervisorWsHandler(learningService, taskSchedulerService);
  const teamHandler = new TeamWsHandler(eventBus);

  const sessionFilter = new SessionScopedEventFilter();
  const roomHandler = new RoomWsHandler(roomSessionManager, eventBus, sessionFilter);

  const wsManager = new WebSocketManager(eventBus, [
    agentHandler,
    executionHandler,
    commanderHandler,
    coordinateHandler,
    requirementHandler,
    supervisorHandler,
    teamHandler,
    roomHandler,
  ], sessionFilter);

  // ---------------------------------------------------------------------------
  // Hono application
  // ---------------------------------------------------------------------------
  const app = new Hono();

  // Middleware
  app.use('*', cors({ origin: '*' }));
  app.use('*', logger());

  // API routes
  const routes = createRoutes(stateManager, workflowRoot, eventBus, sseHub, agentManager, executionScheduler, commanderAgent, coordinateRunner, undefined, {
    learningService,
    schedulerService: taskSchedulerService,
    extensionManager,
    promptRegistry,
  });
  app.route('/', routes);

  // Resolve dashboard root relative to this file
  // In dev: src/server/index.ts → 2 levels up to dashboard/
  // In prod: dist-server/dashboard/src/server/index.js → 4 levels up to dashboard/
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardRoot = __dirname.includes('dist-server')
    ? resolve(__dirname, '..', '..', '..', '..')
    : resolve(__dirname, '..', '..');
  const distDir = resolve(dashboardRoot, 'dist');

  // Static files — serve Vite build output for production
  app.use('/*', serveStatic({ root: distDir }));

  // SPA fallback — serve index.html for client-side routes (e.g. /chat, /kanban).
  // Only for navigation requests (no file extension). Asset requests (.js, .css, etc.)
  // that weren't matched by serveStatic get a 404 instead of HTML (avoids MIME errors).
  // Read dynamically so it stays in sync after Vite rebuilds change asset hashes.
  const indexHtmlPath = resolve(distDir, 'index.html');
  app.get('/*', async (c) => {
    const path = c.req.path;
    if (/\.\w+$/.test(path)) {
      return c.notFound();
    }
    const html = await readFile(indexHtmlPath, 'utf-8');
    return c.html(html);
  });

  // ---------------------------------------------------------------------------
  // Start scheduled tasks
  // ---------------------------------------------------------------------------
  await taskSchedulerService.start();

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
    taskSchedulerService.stop();
    coordinateRunner.destroy();
    commanderAgent.stop();
    await executionScheduler.destroy();
    await roomSessionManager.destroyAll();
    await agentManager.stopAll();
    delegateBrokerMonitor.stop();
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
