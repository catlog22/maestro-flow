import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock BEFORE importing CommanderAgent
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, readFile: vi.fn().mockRejectedValue(new Error('ENOENT')) };
});

vi.mock('./commander-config.js', () => ({
  loadCommanderConfig: vi.fn().mockResolvedValue({}),
  PROFILES: {
    development: { pollIntervalMs: 15_000, autoApproveThreshold: 'medium', decisionModel: 'haiku', maxConcurrentWorkers: 2 },
    production: { pollIntervalMs: 60_000, autoApproveThreshold: 'low', decisionModel: 'sonnet', maxConcurrentWorkers: 5 },
  },
}));

import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CommanderAgent } from './commander-agent.js';
import { DEFAULT_COMMANDER_CONFIG } from '../../shared/commander-types.js';
import type { CommanderConfig, Assessment, PriorityAction, Decision } from '../../shared/commander-types.js';
import { loadCommanderConfig } from './commander-config.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { StateManager } from '../state/state-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { AgentManager } from '../agents/agent-manager.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockEventBus(): DashboardEventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as DashboardEventBus;
}

function createMockStateManager(): StateManager {
  return {
    getProject: vi.fn().mockReturnValue({
      project_name: 'test-project',
      status: 'active',
      current_milestone: 'v1',
      current_phase: null,
      accumulated_context: { blockers: [] },
    }),
    getPhase: vi.fn().mockReturnValue(undefined),
    getBoard: vi.fn().mockReturnValue({}),
  } as unknown as StateManager;
}

function createMockExecutionScheduler(): ExecutionScheduler {
  return {
    getStatus: vi.fn().mockReturnValue({
      running: [],
      queued: [],
      stats: { totalCompleted: 0, totalFailed: 0 },
    }),
    executeIssue: vi.fn().mockResolvedValue(undefined),
    getActiveStrategyName: vi.fn().mockReturnValue('priority'),
    registerStrategy: vi.fn(),
    setStrategy: vi.fn(),
    disableAutoDispatch: vi.fn(),
    isCommanderActive: false,
  } as unknown as ExecutionScheduler;
}

function createMockAgentManager(): AgentManager {
  return {
    spawn: vi.fn().mockResolvedValue({ processId: 'mock-proc-1' }),
  } as unknown as AgentManager;
}

function createAgent(configOverride?: Partial<CommanderConfig>): {
  agent: CommanderAgent;
  eventBus: ReturnType<typeof createMockEventBus>;
  stateManager: ReturnType<typeof createMockStateManager>;
  scheduler: ReturnType<typeof createMockExecutionScheduler>;
  agentManager: ReturnType<typeof createMockAgentManager>;
} {
  const eventBus = createMockEventBus();
  const stateManager = createMockStateManager();
  const scheduler = createMockExecutionScheduler();
  const agentManager = createMockAgentManager();

  const agent = new CommanderAgent(
    eventBus,
    stateManager,
    scheduler,
    agentManager,
    '/tmp/test-workflow',
    configOverride,
  );

  return { agent, eventBus, stateManager, scheduler, agentManager };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommanderAgent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Lifecycle ---
  describe('lifecycle', () => {
    it('initializes with idle status', () => {
      const { agent } = createAgent();
      const state = agent.getState();

      expect(state.status).toBe('idle');
      expect(state.tickCount).toBe(0);
      expect(state.lastDecision).toBeNull();
      expect(state.activeWorkers).toBe(0);
      expect(state.sessionId).toBeTruthy();
    });

    it('stop sets status to idle', () => {
      const { agent } = createAgent();
      agent.stop();
      expect(agent.getState().status).toBe('idle');
    });

    it('pause sets status to paused', () => {
      const { agent } = createAgent();
      agent.pause();
      expect(agent.getState().status).toBe('paused');
    });

    it('resume from paused sets status to idle', () => {
      const { agent } = createAgent();
      agent.pause();
      expect(agent.getState().status).toBe('paused');

      agent.resume();
      expect(agent.getState().status).toBe('idle');
    });

    it('resume does nothing if not paused', () => {
      const { agent } = createAgent();
      // status is 'idle', not 'paused'
      agent.resume();
      expect(agent.getState().status).toBe('idle');
    });

    it('stop clears timers', () => {
      const { agent } = createAgent();
      // Simulate start by directly checking stop behavior
      agent.stop();
      // No timers should throw
      agent.stop(); // double stop should be safe
      expect(agent.getState().status).toBe('idle');
    });
  });

  // --- updateConfig ---
  describe('updateConfig', () => {
    it('updates config fields', () => {
      const { agent } = createAgent();
      agent.updateConfig({ maxConcurrentWorkers: 10 });
      expect(agent.getConfig().maxConcurrentWorkers).toBe(10);
    });

    it('applies profile preset when switching profiles', () => {
      const { agent } = createAgent();
      agent.updateConfig({ profile: 'production' });

      const config = agent.getConfig();
      expect(config.profile).toBe('production');
    });

    it('emits status after config update', () => {
      const { agent, eventBus } = createAgent();
      agent.updateConfig({ pollIntervalMs: 5_000 });

      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  // --- getState / getConfig ---
  describe('getState and getConfig', () => {
    it('getState returns a copy', () => {
      const { agent } = createAgent();
      const state1 = agent.getState();
      const state2 = agent.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2); // different object references
    });

    it('getConfig returns a copy', () => {
      const { agent } = createAgent();
      const config1 = agent.getConfig();
      const config2 = agent.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  // --- test_commander_decide_filters_by_threshold ---
  describe('decide: filters by threshold', () => {
    it('approves low-risk actions when threshold is low', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'low' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix bug', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-2', reason: 'Refactor', risk: 'medium', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-3', reason: 'Major change', risk: 'high', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      // Access private decide via tick simulation - use type assertion
      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 3,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // Only low-risk should be approved
      expect(decision.actions.some(a => a.target === 'ISS-1')).toBe(true);
      expect(decision.deferred.some(a => a.target === 'ISS-2')).toBe(true);
      expect(decision.deferred.some(a => a.target === 'ISS-3')).toBe(true);
    });

    it('approves medium-risk actions when threshold is medium', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'medium' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-2', reason: 'Refactor', risk: 'medium', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-3', reason: 'Major', risk: 'high', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 3,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // Low and medium should be approved
      expect(decision.actions.some(a => a.target === 'ISS-1')).toBe(true);
      expect(decision.actions.some(a => a.target === 'ISS-2')).toBe(true);
      // High risk deferred
      expect(decision.deferred.some(a => a.target === 'ISS-3')).toBe(true);
    });

    it('approves all risk levels when threshold is high', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'high' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-2', reason: 'Refactor', risk: 'medium', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-3', reason: 'Major', risk: 'high', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 3,
        recentDecisions: [],
        workDir: '/tmp',
      });

      expect(decision.actions).toHaveLength(3);
      expect(decision.deferred).toHaveLength(0);
    });
  });

  // --- test_commander_decide_respects_capacity ---
  describe('decide: respects capacity', () => {
    it('defers execute_issue actions when no worker slots available', () => {
      const { agent } = createAgent({
        autoApproveThreshold: 'high',
        maxConcurrentWorkers: 2,
      });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-2', reason: 'Refactor', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-3', reason: 'More work', risk: 'low', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 1, // 1 already running, max 2 -> 1 slot available
        maxWorkers: 2,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // Only 1 slot available, so only 1 execute_issue should be approved
      const executeActions = decision.actions.filter(a => a.type === 'execute_issue');
      expect(executeActions).toHaveLength(1);

      const deferredExecute = decision.deferred.filter(a => a.type === 'execute_issue');
      expect(deferredExecute).toHaveLength(2);
    });

    it('non-execution actions do not consume worker slots', () => {
      const { agent } = createAgent({
        autoApproveThreshold: 'high',
        maxConcurrentWorkers: 1,
      });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'flag_blocker', target: 'ISS-10', reason: 'Blocked', risk: 'low', executor: '' },
          { type: 'create_issue', target: 'new-bug', reason: 'Found bug', risk: 'low', executor: '' },
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 1,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // All 3 should be approved: flag_blocker and create_issue don't use slots
      expect(decision.actions).toHaveLength(3);
      expect(decision.deferred).toHaveLength(0);
    });

    it('sorts actions by priority (execute_issue first)', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'high' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'create_issue', target: 'new', reason: 'New', risk: 'low', executor: '' },
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
          { type: 'flag_blocker', target: 'block', reason: 'Blocked', risk: 'low', executor: '' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 5,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // Should be sorted: execute_issue, flag_blocker, create_issue
      const types = decision.actions.map(a => a.type);
      expect(types.indexOf('execute_issue')).toBeLessThan(types.indexOf('flag_blocker'));
      expect(types.indexOf('flag_blocker')).toBeLessThan(types.indexOf('create_issue'));
    });
  });

  // --- Circuit breaker and rate limiting ---
  describe('circuit breaker and rate limiting', () => {
    it('tick is skipped when paused', async () => {
      const { agent } = createAgent();
      agent.pause();

      await (agent as any).tick('test');

      expect(agent.getState().tickCount).toBe(0);
    });

    it('circuit breaker trips after consecutive failures', async () => {
      const { agent } = createAgent({
        safety: {
          circuitBreakerThreshold: 2,
          eventDebounceMs: 5000,
          maxTicksPerHour: 100,
          maxTokensPerHour: 500000,
          protectedPaths: [],
        },
      });

      // Simulate consecutive failures by setting internal counter
      (agent as any).consecutiveFailures = 2;

      await (agent as any).tick('test');

      // Should pause after hitting circuit breaker
      expect(agent.getState().status).toBe('paused');
    });

    it('rate limit skips tick when max ticks per hour reached', async () => {
      const { agent } = createAgent({
        safety: {
          circuitBreakerThreshold: 10,
          eventDebounceMs: 5000,
          maxTicksPerHour: 1,
          maxTokensPerHour: 500000,
          protectedPaths: [],
        },
      });

      // Set ticksThisHour to max
      (agent as any).ticksThisHour = 1;

      const tickCountBefore = agent.getState().tickCount;
      await (agent as any).tick('test');

      // tickCount should not have incremented
      expect(agent.getState().tickCount).toBe(tickCountBefore);
    });
  });

  // --- Decision structure ---
  describe('decision structure', () => {
    it('produces well-formed Decision object', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'low' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
        ],
        observations: ['System healthy'],
        risks: ['None'],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('scheduled_tick', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 3,
        recentDecisions: [],
        workDir: '/tmp',
      });

      expect(decision.id).toBeTruthy();
      expect(decision.timestamp).toBeTruthy();
      expect(decision.trigger).toBe('scheduled_tick');
      expect(decision.assessment).toBe(assessment);
      expect(decision.actions).toBeInstanceOf(Array);
      expect(decision.deferred).toBeInstanceOf(Array);
    });
  });

  // --- analyze_issue and plan_issue dispatch ---
  describe('dispatch: analyze_issue and plan_issue', () => {
    it('dispatches analyze_issue via agentManager.spawn', async () => {
      const { agent, agentManager } = createAgent({ autoApproveThreshold: 'high' });

      const decision: Decision = {
        id: 'test-decision',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'analyze_issue', target: 'ISS-123', reason: 'Needs analysis', risk: 'low', executor: 'claude-code' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(agentManager.spawn).toHaveBeenCalledTimes(1);
      expect(agentManager.spawn).toHaveBeenCalledWith(
        'claude-code',
        expect.objectContaining({
          type: 'claude-code',
          prompt: expect.stringContaining('ISS-123'),
          workDir: '/tmp/test-workflow',
          approvalMode: 'auto',
        }),
      );
    });

    it('dispatches plan_issue via agentManager.spawn with action.executor', async () => {
      const { agent, agentManager } = createAgent({ autoApproveThreshold: 'high' });

      const decision: Decision = {
        id: 'test-decision',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'plan_issue', target: 'ISS-456', reason: 'Needs plan', risk: 'low', executor: 'gemini' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(agentManager.spawn).toHaveBeenCalledTimes(1);
      expect(agentManager.spawn).toHaveBeenCalledWith(
        'gemini',
        expect.objectContaining({
          type: 'gemini',
          prompt: expect.stringContaining('ISS-456'),
          workDir: '/tmp/test-workflow',
        }),
      );
    });

    it('analyze_issue and plan_issue do not consume worker slots in decide', () => {
      const { agent } = createAgent({
        autoApproveThreshold: 'high',
        maxConcurrentWorkers: 1,
      });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'analyze_issue', target: 'ISS-A', reason: 'Analyze', risk: 'low', executor: 'claude-code' },
          { type: 'plan_issue', target: 'ISS-B', reason: 'Plan', risk: 'low', executor: 'gemini' },
          { type: 'execute_issue', target: 'ISS-C', reason: 'Execute', risk: 'low', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 1,
        recentDecisions: [],
        workDir: '/tmp',
      });

      // analyze and plan don't consume slots, execute gets the 1 slot
      expect(decision.actions).toHaveLength(3);
      expect(decision.deferred).toHaveLength(0);
    });

    it('dispatches execute_issue via executionScheduler', async () => {
      const { agent, scheduler } = createAgent({ autoApproveThreshold: 'high' });

      const decision = {
        id: 'test-decision',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'execute_issue', target: 'ISS-exec-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(scheduler.executeIssue).toHaveBeenCalledTimes(1);
      expect(scheduler.executeIssue).toHaveBeenCalledWith('ISS-exec-1', 'claude-code');
    });

    it('dispatches flag_blocker, create_issue, advance_phase as log-only', async () => {
      const { agent, scheduler, agentManager } = createAgent({ autoApproveThreshold: 'high' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const decision = {
        id: 'test-decision',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'flag_blocker', target: 'ISS-B', reason: 'Blocked', risk: 'low', executor: '' },
          { type: 'create_issue', target: 'new-bug', reason: 'Found bug', risk: 'low', executor: '' },
          { type: 'advance_phase', target: 'phase-2', reason: 'Ready', risk: 'low', executor: '' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      // These should NOT call executeIssue or spawn
      expect(scheduler.executeIssue).not.toHaveBeenCalled();
      expect(agentManager.spawn).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Blocker flagged'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Issue creation recommended'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Phase advancement recommended'));

      consoleSpy.mockRestore();
    });

    it('handles dispatch errors gracefully', async () => {
      const { agent, scheduler } = createAgent({ autoApproveThreshold: 'high' });
      (scheduler.executeIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('spawn failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const decision = {
        id: 'test-decision',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'execute_issue', target: 'ISS-fail', reason: 'Fix', risk: 'low', executor: 'claude-code' },
        ],
        deferred: [],
      };

      // Should not throw
      await (agent as any).dispatch(decision);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dispatch failed'),
        expect.stringContaining('spawn failed'),
      );

      errorSpy.mockRestore();
    });

    it('prioritizes actions: execute > analyze > plan', () => {
      const { agent } = createAgent({ autoApproveThreshold: 'high' });

      const assessment: Assessment = {
        priority_actions: [
          { type: 'plan_issue', target: 'ISS-P', reason: 'Plan', risk: 'low', executor: 'claude-code' },
          { type: 'execute_issue', target: 'ISS-E', reason: 'Execute', risk: 'low', executor: 'claude-code' },
          { type: 'analyze_issue', target: 'ISS-A', reason: 'Analyze', risk: 'low', executor: 'claude-code' },
        ],
        observations: [],
        risks: [],
      };

      const decide = (agent as any).decide.bind(agent);
      const decision: Decision = decide('test', assessment, {
        project: { name: 'test' },
        openIssues: [],
        runningWorkers: 0,
        maxWorkers: 5,
        recentDecisions: [],
        workDir: '/tmp',
      });

      const types = decision.actions.map(a => a.type);
      expect(types.indexOf('execute_issue')).toBeLessThan(types.indexOf('analyze_issue'));
      expect(types.indexOf('analyze_issue')).toBeLessThan(types.indexOf('plan_issue'));
    });
  });

  // --- start() method ---
  describe('start', () => {
    it('loads config from disk and starts tick timer', async () => {
      const { agent, eventBus } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();

      expect(loadCommanderConfig).toHaveBeenCalledWith('/tmp/test-workflow');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Commander] Started'));
      expect(eventBus.emit).toHaveBeenCalled();

      // Cleanup timers
      agent.stop();
      consoleSpy.mockRestore();
    });

    it('does not start again if already running', async () => {
      const { agent } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();
      const callCountAfterFirst = (loadCommanderConfig as ReturnType<typeof vi.fn>).mock.calls.length;

      await agent.start(); // second call
      // loadCommanderConfig should NOT be called again
      expect((loadCommanderConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterFirst);

      agent.stop();
      consoleSpy.mockRestore();
    });
  });

  // --- stop() with active timers ---
  describe('stop with active timers', () => {
    it('clears tick and hour reset timers', async () => {
      const { agent } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();
      agent.stop();

      expect(agent.getState().status).toBe('idle');
      expect(consoleSpy).toHaveBeenCalledWith('[Commander] Stopped');

      consoleSpy.mockRestore();
    });
  });

  // --- Concurrency conflict protection ---
  describe('concurrency conflict protection', () => {
    it('start() sets isCommanderActive and disables tick auto-dispatch', async () => {
      const { agent, scheduler } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();

      expect(scheduler.isCommanderActive).toBe(true);
      expect(scheduler.disableAutoDispatch).toHaveBeenCalled();

      agent.stop();
      consoleSpy.mockRestore();
    });

    it('stop() resets isCommanderActive to false', async () => {
      const { agent, scheduler } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();
      expect(scheduler.isCommanderActive).toBe(true);

      agent.stop();
      expect(scheduler.isCommanderActive).toBe(false);

      consoleSpy.mockRestore();
    });

    it('stop() is safe when never started (isCommanderActive stays false)', () => {
      const { agent, scheduler } = createAgent();

      agent.stop();

      expect(scheduler.isCommanderActive).toBe(false);
    });
  });

  // --- updateConfig with timer restart ---
  describe('updateConfig with timer restart', () => {
    it('restarts tick timer when pollIntervalMs changes while running', async () => {
      const { agent } = createAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await agent.start();

      const prevInterval = agent.getConfig().pollIntervalMs;
      agent.updateConfig({ pollIntervalMs: prevInterval + 1000 });

      expect(agent.getConfig().pollIntervalMs).toBe(prevInterval + 1000);

      agent.stop();
      consoleSpy.mockRestore();
    });

    it('applies custom profile preset when switching to custom does nothing', () => {
      const { agent } = createAgent();
      // switching to 'custom' profile should skip preset application
      agent.updateConfig({ profile: 'custom' });
      // no error thrown, config still valid
      expect(agent.getConfig().profile).toBe('custom');
    });
  });

  // --- Full tick flow ---
  describe('tick: full flow', () => {
    it('runs full tick: gatherContext -> assess -> decide -> dispatch', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;

      const assessmentResult: Assessment = {
        priority_actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix bug', risk: 'low', executor: 'claude-code' },
        ],
        observations: ['All healthy'],
        risks: [],
      };

      mockQuery.mockImplementation(() => ({
        [Symbol.asyncIterator]: () => {
          let done = false;
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: {
                  type: 'result',
                  subtype: 'success',
                  result: JSON.stringify(assessmentResult),
                },
              };
            },
          };
        },
      }));

      const { agent, scheduler, eventBus } = createAgent({
        autoApproveThreshold: 'high',
      });

      await (agent as any).tick('manual');

      // tick should have incremented
      expect(agent.getState().tickCount).toBe(1);
      // execute_issue should have been dispatched
      expect(scheduler.executeIssue).toHaveBeenCalledWith('ISS-1', 'claude-code');
      // Status should be idle after tick
      expect(agent.getState().status).toBe('idle');
      // lastDecision should be set
      expect(agent.getState().lastDecision).not.toBeNull();
    });

    it('handles assessment failure and increments consecutiveFailures', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;

      // Mock query to yield no result (empty assessment → throws)
      mockQuery.mockImplementation(() => ({
        [Symbol.asyncIterator]: () => ({
          async next() {
            return { done: true, value: undefined };
          },
        }),
      }));

      const { agent } = createAgent();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await (agent as any).tick('test');

      // Assessment should have failed (no result text)
      expect((agent as any).consecutiveFailures).toBe(1);
      expect(agent.getState().status).toBe('idle');

      errorSpy.mockRestore();
    });

    it('keeps last 5 decisions and shifts old ones', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;

      const assessmentResult: Assessment = {
        priority_actions: [],
        observations: [],
        risks: [],
      };

      // Return a fresh async iterable for each call
      mockQuery.mockImplementation(() => ({
        [Symbol.asyncIterator]: () => {
          let done = false;
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: { type: 'result', subtype: 'success', result: JSON.stringify(assessmentResult) },
              };
            },
          };
        },
      }));

      const { agent } = createAgent({ autoApproveThreshold: 'high' });

      // Run 6 ticks to exceed the 5-decision limit
      for (let i = 0; i < 6; i++) {
        await (agent as any).tick('test');
      }

      expect((agent as any).recentDecisions.length).toBe(5);
      expect(agent.getState().tickCount).toBe(6);
    });

    it('resets consecutiveFailures on successful assessment', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;

      const assessmentResult: Assessment = {
        priority_actions: [],
        observations: [],
        risks: [],
      };

      mockQuery.mockImplementation(() => ({
        [Symbol.asyncIterator]: () => {
          let done = false;
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: { type: 'result', subtype: 'success', result: JSON.stringify(assessmentResult) },
              };
            },
          };
        },
      }));

      const { agent } = createAgent();
      (agent as any).consecutiveFailures = 2;

      await (agent as any).tick('test');

      expect((agent as any).consecutiveFailures).toBe(0);
    });
  });

  // --- gatherContext ---
  describe('gatherContext', () => {
    it('reads issues from JSONL and builds context', async () => {
      const mockReadFile = readFile as ReturnType<typeof vi.fn>;

      // Return valid JSONL with two issues
      mockReadFile.mockResolvedValueOnce(
        '{"id":"ISS-1","status":"open","title":"Bug"}\n{"id":"ISS-2","status":"closed","title":"Done"}\n'
      );

      const { agent } = createAgent();

      const context = await (agent as any).gatherContext();

      expect(context.project).toBeDefined();
      expect(context.openIssues).toHaveLength(1); // only open issues
      expect(context.openIssues[0].id).toBe('ISS-1');
      expect(context.workDir).toBe('/tmp/test-workflow');
    });

    it('returns empty issues when JSONL file does not exist', async () => {
      // Default mock already rejects with ENOENT
      const { agent } = createAgent();
      const context = await (agent as any).gatherContext();

      expect(context.openIssues).toHaveLength(0);
    });

    it('includes currentPhase when project has current_phase', async () => {
      const { agent, stateManager } = createAgent();
      (stateManager.getProject as ReturnType<typeof vi.fn>).mockReturnValue({
        project_name: 'test',
        status: 'active',
        current_milestone: 'v1',
        current_phase: 'phase-1',
        accumulated_context: { blockers: [] },
      });
      (stateManager.getPhase as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'phase-1', name: 'Alpha' });

      const context = await (agent as any).gatherContext();

      expect(context.currentPhase).toEqual({ id: 'phase-1', name: 'Alpha' });
      expect(stateManager.getPhase).toHaveBeenCalledWith('phase-1');
    });
  });

  // --- assess ---
  describe('assess', () => {
    const validContext = {
      project: {
        project_name: 'test',
        status: 'active',
        current_milestone: 'v1',
        current_phase: 'p1',
        accumulated_context: { blockers: [] },
      },
      openIssues: [],
      runningWorkers: 0,
      maxWorkers: 3,
      recentDecisions: [],
      workDir: '/tmp',
    };

    it('throws when assessment returns no result', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          async next() { return { done: true, value: undefined }; },
        }),
      });

      const { agent } = createAgent();

      await expect((agent as any).assess(validContext)).rejects.toThrow('Assessment returned no result');
    });

    it('parses valid assessment JSON from query result', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;
      const expected: Assessment = {
        priority_actions: [],
        observations: ['Healthy'],
        risks: ['None'],
      };

      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let done = false;
          return {
            async next() {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: { type: 'result', subtype: 'success', result: JSON.stringify(expected) },
              };
            },
          };
        },
      });

      const { agent } = createAgent();
      const result = await (agent as any).assess(validContext);

      expect(result).toEqual(expected);
    });

    it('ignores non-result messages from query stream', async () => {
      const mockQuery = query as ReturnType<typeof vi.fn>;
      const expected: Assessment = {
        priority_actions: [],
        observations: [],
        risks: [],
      };

      let call = 0;
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          async next() {
            call++;
            if (call === 1) {
              return { done: false, value: { type: 'tool_use', name: 'Read' } };
            }
            if (call === 2) {
              return {
                done: false,
                value: { type: 'result', subtype: 'success', result: JSON.stringify(expected) },
              };
            }
            return { done: true, value: undefined };
          },
        }),
      });

      const { agent } = createAgent();
      const result = await (agent as any).assess(validContext);
      expect(result).toEqual(expected);
    });
  });

  // --- dispatch error for agentManager.spawn ---
  describe('dispatch: agentManager spawn error', () => {
    it('handles analyze_issue spawn error gracefully', async () => {
      const { agent, agentManager } = createAgent({ autoApproveThreshold: 'high' });
      (agentManager.spawn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Agent SDK unavailable'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const decision = {
        id: 'test',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'analyze_issue', target: 'ISS-fail', reason: 'Analyze', risk: 'low', executor: 'claude-code' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dispatch failed'),
        expect.stringContaining('Agent SDK unavailable'),
      );

      errorSpy.mockRestore();
    });

    it('handles plan_issue spawn error gracefully', async () => {
      const { agent, agentManager } = createAgent({ autoApproveThreshold: 'high' });
      (agentManager.spawn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('spawn timeout'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const decision = {
        id: 'test',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'plan_issue', target: 'ISS-plan-fail', reason: 'Plan', risk: 'low', executor: 'gemini' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dispatch failed'),
        expect.stringContaining('spawn timeout'),
      );

      errorSpy.mockRestore();
    });
  });

  // --- emitStatus and activeWorkers update ---
  describe('dispatch updates activeWorkers', () => {
    it('updates activeWorkers after dispatch completes', async () => {
      const { agent, scheduler } = createAgent({ autoApproveThreshold: 'high' });
      (scheduler.getStatus as ReturnType<typeof vi.fn>).mockReturnValue({
        running: [{ id: 'ISS-1' }],
        queued: [],
        stats: { totalCompleted: 0, totalFailed: 0 },
      });

      const decision = {
        id: 'test',
        timestamp: new Date().toISOString(),
        trigger: 'test',
        assessment: { priority_actions: [], observations: [], risks: [] },
        actions: [
          { type: 'execute_issue', target: 'ISS-1', reason: 'Fix', risk: 'low', executor: 'claude-code' },
        ],
        deferred: [],
      };

      await (agent as any).dispatch(decision);

      expect(agent.getState().activeWorkers).toBe(1);
    });
  });
});
