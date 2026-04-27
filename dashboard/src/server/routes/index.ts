import { Hono } from 'hono';

import type { StateManager } from '../state/state-manager.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { SSEHub } from '../sse/sse-hub.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { CommanderAgent } from '../commander/commander-agent.js';
import type { WorkflowCoordinator } from '../coordinator/workflow-coordinator.js';
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
import { createInstallRoutes } from './install.js';
import { createSpecsRoutes } from './specs.js';
import { createWikiRoutes, createSharedWikiWriter } from './wiki.js';
import { createLinearRoutes } from './linear.js';
import { createTeamRoutes } from './teams.js';
import { createCollabRoutes } from './collab.js';
import { createRoomRoutes } from './rooms.js';
import { createRoomMcpRoutes } from './room-mcp.js';
import { createCommanderRoutes } from '../commander/commander-routes.js';
import { createCoordinatorRoutes } from '../coordinator/coordinator-routes.js';
import { createRequirementRoutes } from './requirements.js';
import { createSupervisorRoutes } from './supervisor.js';
import { createWorkspaceRoutes } from './workspace.js';
import { createGitRoutes } from './git.js';
import { createObservabilityRoutes } from '../observability/observability-routes.js';
import type { RequirementExpander } from '../requirement/requirement-expander.js';
import type { SelfLearningService } from '../supervisor/self-learning-service.js';
import type { TaskSchedulerService } from '../supervisor/task-scheduler-service.js';
import type { ExtensionManager } from '../supervisor/extension-manager.js';
import type { PromptRegistry } from '../prompt/prompt-registry.js';
import type { RoomSessionManager } from '../rooms/room-session-manager.js';

/**
 * Aggregate all route modules into a single Hono app.
 *
 * Routes that need StateManager receive it via factory functions.
 * Routes that depend on workflowRoot receive a getter so they follow
 * workspace switches at runtime.
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
  coordinator?: WorkflowCoordinator,
  requirementExpander?: RequirementExpander,
  supervisorDeps?: {
    learningService: SelfLearningService;
    schedulerService: TaskSchedulerService;
    extensionManager: ExtensionManager;
    promptRegistry: PromptRegistry;
  },
  roomSessionManager?: RoomSessionManager,
): Hono {
  const routes = new Hono();

  // Dynamic getter — follows workspace switches
  const getRoot = () => stateManager.getWorkflowRoot();

  // Health (reports workspace) + workspace switch endpoint
  routes.route('/', createHealthRoute(workflowRoot, stateManager));

  // Data routes (depend on StateManager)
  routes.route('/', createBoardRoutes(stateManager));
  routes.route('/', createPhaseRoutes(stateManager));
  routes.route('/', createScratchRoutes(stateManager));

  // Artifact route (dynamic root for workspace switch)
  routes.route('/', createArtifactRoutes(getRoot));

  // Workspace tree route (project root = parent of .workflow/)
  routes.route('/', createWorkspaceRoutes(getRoot));

  // Git source control routes (project root = parent of .workflow/)
  routes.route('/', createGitRoutes(getRoot));

  // SSE events route (depends on StateManager, EventBus, SSEHub)
  routes.route('/', createEventsRoute(stateManager, eventBus, sseHub));

  // Agent routes (depends on AgentManager)
  routes.route('/', createAgentRoutes(agentManager));

  // Settings routes (depends on workflow root for config paths)
  routes.route('/', createSettingsRoutes(getRoot));

  // Issue routes (dynamic root for workspace switch)
  routes.route('/', createIssueRoutes(getRoot));

  // Execution routes (depends on ExecutionScheduler)
  if (executionScheduler) {
    routes.route('/', createExecutionRoutes(executionScheduler));
  }

  // CLI history routes (reads from ~/.maestro/cli-history/)
  routes.route('/', createCliHistoryRoutes());

  // Unified wiki endpoint (graph-aware view + scoped writes across .workflow/)
  const { routes: wikiRoutes, getWriter } = createSharedWikiWriter(getRoot, eventBus);
  routes.route('/', wikiRoutes);

  // Specs CRUD routes — delegate writes to shared WikiWriter
  routes.route('/', createSpecsRoutes(getRoot, getWriter()));

  // MCP server management routes
  routes.route('/', createMcpRoutes());

  // Install wizard routes (pure file ops, no dependencies)
  routes.route('/', createInstallRoutes());

  // Linear API proxy routes (dynamic root for workspace switch)
  routes.route('/', createLinearRoutes(getRoot));

  // Team session routes (dynamic root for workspace switch)
  routes.route('/', createTeamRoutes(getRoot));

  // Collab routes (human collaboration, dynamic root for workspace switch)
  routes.route('/', createCollabRoutes(getRoot, eventBus));

  // Room session routes (in-memory meeting room management)
  if (roomSessionManager) {
    routes.route('/', createRoomRoutes(roomSessionManager));
    routes.route('/', createRoomMcpRoutes(roomSessionManager));
  }

  // EventBus recent events endpoint (ring buffer audit)
  routes.get('/api/events/recent', (c) => {
    const limit = Number(c.req.query('limit')) || 100;
    const prefix = c.req.query('prefix') || undefined;
    return c.json(eventBus.getRecentEvents(limit, prefix));
  });

  // Commander routes (depends on CommanderAgent)
  if (commanderAgent) {
    routes.route('/', createCommanderRoutes(commanderAgent, workflowRoot));
  }

  // Coordinator routes (depends on WorkflowCoordinator)
  if (coordinator) {
    routes.route('/', createCoordinatorRoutes(coordinator));
  }

  // Requirement routes (depends on RequirementExpander)
  if (requirementExpander) {
    routes.route('/', createRequirementRoutes(requirementExpander));
  }

  // Observability routes (cross-component event timeline)
  routes.route('/', createObservabilityRoutes(workflowRoot));

  // Supervisor routes (depends on learning, scheduler, extensions, prompts)
  if (supervisorDeps) {
    routes.route('/', createSupervisorRoutes(
      supervisorDeps.learningService,
      supervisorDeps.schedulerService,
      supervisorDeps.extensionManager,
      supervisorDeps.promptRegistry,
    ));
  }

  return routes;
}

