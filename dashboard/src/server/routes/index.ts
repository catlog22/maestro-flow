import { Hono } from 'hono';

import type { StateManager } from '../state/state-manager.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { SSEHub } from '../sse/sse-hub.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { CommanderAgent } from '../commander/commander-agent.js';
import { createHealthRoute } from './health.js';
import { createBoardRoutes } from './board.js';
import { createPhaseRoutes } from './phases.js';
import { createArtifactRoutes } from './artifacts.js';
import { createScratchRoutes } from './scratch.js';
import { createEventsRoute } from './events.js';
import { createAgentRoutes } from './agents.js';
import { createSettingsRoutes } from './settings.js';
import { createIssueRoutes } from './issues.js';
import { createExecutionRoutes } from './execution.js';
import { createCliHistoryRoutes } from './cli-history.js';
import { createMcpRoutes } from './mcp.js';
import { createSpecsRoutes } from './specs.js';
import { createLinearRoutes } from './linear.js';
import { createTeamRoutes } from './teams.js';
import { createCommanderRoutes } from '../commander/commander-routes.js';

/**
 * Aggregate all route modules into a single Hono app.
 *
 * Routes that need StateManager receive it via factory functions.
 * The artifact route receives the workflow root path directly.
 * The events route receives StateManager, EventBus, and SSEHub.
 * The agent routes receive the AgentManager.
 */
export function createRoutes(
  stateManager: StateManager,
  workflowRoot: string,
  eventBus: DashboardEventBus,
  sseHub: SSEHub,
  agentManager: AgentManager,
  executionScheduler?: ExecutionScheduler,
  commanderAgent?: CommanderAgent,
): Hono {
  const routes = new Hono();

  // Health (reports workspace) + workspace switch endpoint
  routes.route('/', createHealthRoute(workflowRoot, stateManager));

  // Data routes (depend on StateManager)
  routes.route('/', createBoardRoutes(stateManager));
  routes.route('/', createPhaseRoutes(stateManager));
  routes.route('/', createScratchRoutes(stateManager));

  // Artifact route (depends on workflow root path)
  routes.route('/', createArtifactRoutes(workflowRoot));

  // SSE events route (depends on StateManager, EventBus, SSEHub)
  routes.route('/', createEventsRoute(stateManager, eventBus, sseHub));

  // Agent routes (depends on AgentManager)
  routes.route('/', createAgentRoutes(agentManager));

  // Settings routes (depends on workflow root for config paths)
  routes.route('/', createSettingsRoutes(workflowRoot));

  // Issue routes (depends on workflow root for JSONL storage)
  routes.route('/', createIssueRoutes(workflowRoot));

  // Execution routes (depends on ExecutionScheduler)
  if (executionScheduler) {
    routes.route('/', createExecutionRoutes(executionScheduler));
  }

  // CLI history routes (reads from ~/.maestro/cli-history/)
  routes.route('/', createCliHistoryRoutes());

  // Specs CRUD routes (depends on workflow root for .workflow/specs/)
  routes.route('/', createSpecsRoutes(workflowRoot));

  // MCP server management routes
  routes.route('/', createMcpRoutes());

  // Linear API proxy routes (needs workflowRoot for import/export)
  routes.route('/', createLinearRoutes(workflowRoot));

  // Team session routes (reads from .workflow/.team/)
  routes.route('/', createTeamRoutes(workflowRoot));

  // Commander routes (depends on CommanderAgent)
  if (commanderAgent) {
    routes.route('/', createCommanderRoutes(commanderAgent));
  }

  return routes;
}
