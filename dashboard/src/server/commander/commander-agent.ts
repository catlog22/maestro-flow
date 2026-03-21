// ---------------------------------------------------------------------------
// CommanderAgent — tick loop + assess + decide + dispatch
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

import type {
  CommanderConfig,
  CommanderState,
  Assessment,
  PriorityAction,
  Decision,
} from '../../shared/commander-types.js';
import { DEFAULT_COMMANDER_CONFIG } from '../../shared/commander-types.js';
import type { Issue } from '../../shared/issue-types.js';
import type { ProjectState } from '../../shared/types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { StateManager } from '../state/state-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { AgentManager } from '../agents/agent-manager.js';
import { loadCommanderConfig, PROFILES } from './commander-config.js';
import {
  COMMANDER_SYSTEM_PROMPT,
  COMMANDER_OUTPUT_SCHEMA,
  buildAssessmentPrompt,
} from './commander-prompts.js';
import type { AssessmentContext } from './commander-prompts.js';

// ---------------------------------------------------------------------------
// JSONL reader (local helper, same pattern as execution-scheduler)
// ---------------------------------------------------------------------------

async function readIssuesJsonl(filePath: string): Promise<Issue[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return [];
  }
  const issues: Issue[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      issues.push(JSON.parse(trimmed) as Issue);
    } catch {
      // skip malformed lines
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Risk level ordering for threshold comparison
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };

function isWithinThreshold(
  actionRisk: string,
  threshold: CommanderConfig['autoApproveThreshold'],
): boolean {
  return (RISK_ORDER[actionRisk] ?? 2) <= (RISK_ORDER[threshold] ?? 0);
}

// ---------------------------------------------------------------------------
// CommanderAgent
// ---------------------------------------------------------------------------

export class CommanderAgent {
  private config: CommanderConfig;
  private state: CommanderState;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private recentDecisions: Decision[] = [];
  private consecutiveFailures = 0;
  private ticksThisHour = 0;
  private hourResetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly stateManager: StateManager,
    private readonly executionScheduler: ExecutionScheduler,
    private readonly agentManager: AgentManager,
    private readonly workflowRoot: string,
    config?: Partial<CommanderConfig>,
  ) {
    this.config = { ...DEFAULT_COMMANDER_CONFIG, ...config };
    this.state = {
      status: 'idle',
      lastTickAt: '',
      lastDecision: null,
      activeWorkers: 0,
      sessionId: randomUUID(),
      tickCount: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start the Commander tick loop. Loads config from disk on first start. */
  async start(): Promise<void> {
    if (this.tickTimer) return;

    // Load config from disk layers (user + project + env)
    const diskConfig = await loadCommanderConfig(this.workflowRoot);
    this.config = { ...diskConfig, ...this.config };

    this.tickTimer = setInterval(() => void this.tick('scheduled_tick'), this.config.pollIntervalMs);

    // Hourly tick counter reset
    this.hourResetTimer = setInterval(() => {
      this.ticksThisHour = 0;
    }, 3_600_000);

    this.emitStatus();
    console.log(
      `[Commander] Started (interval=${this.config.pollIntervalMs}ms, model=${this.config.decisionModel}, workers=${this.config.maxConcurrentWorkers})`,
    );
  }

  /** Stop the Commander tick loop. */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.hourResetTimer) {
      clearInterval(this.hourResetTimer);
      this.hourResetTimer = null;
    }
    this.state.status = 'idle';
    this.emitStatus();
    console.log('[Commander] Stopped');
  }

  /** Pause — keep timer running but skip ticks. */
  pause(): void {
    this.state.status = 'paused';
    this.emitStatus();
    console.log('[Commander] Paused');
  }

  /** Resume from paused state. */
  resume(): void {
    if (this.state.status !== 'paused') return;
    this.state.status = 'idle';
    this.consecutiveFailures = 0;
    this.emitStatus();
    console.log('[Commander] Resumed');
  }

  /** Update config at runtime, restart tick timer if interval changed. */
  updateConfig(partial: Partial<CommanderConfig>): void {
    const prevInterval = this.config.pollIntervalMs;
    const prevProfile = this.config.profile;

    // If switching profiles, apply profile preset first
    if (partial.profile && partial.profile !== prevProfile && partial.profile !== 'custom') {
      const profilePreset = PROFILES[partial.profile];
      if (profilePreset) {
        Object.assign(this.config, profilePreset);
      }
    }

    // Apply explicit overrides
    Object.assign(this.config, partial);

    // Restart tick timer if interval changed
    if (this.config.pollIntervalMs !== prevInterval && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(() => void this.tick('scheduled_tick'), this.config.pollIntervalMs);
    }

    this.emitStatus();
  }

  /** Get current state snapshot. */
  getState(): CommanderState {
    return { ...this.state };
  }

  /** Get current config snapshot. */
  getConfig(): CommanderConfig {
    return { ...this.config };
  }

  // -------------------------------------------------------------------------
  // Core tick loop
  // -------------------------------------------------------------------------

  /**
   * Single tick of the Commander loop:
   *   1. Gather context
   *   2. Assess (Agent SDK query, read-only)
   *   3. Decide (deterministic filtering)
   *   4. Dispatch (execute approved actions)
   *   5. Emit events
   */
  async tick(trigger: string = 'scheduled_tick'): Promise<void> {
    // Skip if paused
    if (this.state.status === 'paused') return;

    // Circuit breaker: too many consecutive failures
    if (this.consecutiveFailures >= this.config.safety.circuitBreakerThreshold) {
      console.warn(
        `[Commander] Circuit breaker tripped after ${this.consecutiveFailures} consecutive failures. Pausing.`,
      );
      this.pause();
      return;
    }

    // Rate limit: max ticks per hour
    if (this.ticksThisHour >= this.config.safety.maxTicksPerHour) {
      console.warn('[Commander] Max ticks per hour reached, skipping tick');
      return;
    }

    this.ticksThisHour++;
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();

    // --- Step 1: Gather context ---
    const context = await this.gatherContext();

    // --- Step 2: Assess (Agent SDK query) ---
    let assessment: Assessment;
    this.state.status = 'thinking';
    this.emitStatus();

    try {
      assessment = await this.assess(context);
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Commander] Assessment failed (${this.consecutiveFailures}x):`, message);
      this.state.status = 'idle';
      this.emitStatus();
      return;
    }

    // --- Step 3: Decide (deterministic, no LLM) ---
    const decision = this.decide(trigger, assessment, context);

    // --- Step 4: Dispatch ---
    this.state.status = 'dispatching';
    this.emitStatus();

    await this.dispatch(decision);

    // --- Step 5: Emit events + update state ---
    this.state.lastDecision = decision;
    this.state.status = 'idle';

    // Keep last 5 decisions
    this.recentDecisions.push(decision);
    if (this.recentDecisions.length > 5) {
      this.recentDecisions.shift();
    }

    this.emitStatus();
    this.eventBus.emit('supervisor:status', this.executionScheduler.getStatus());
  }

  // -------------------------------------------------------------------------
  // Step 1: Gather context
  // -------------------------------------------------------------------------

  private async gatherContext(): Promise<AssessmentContext> {
    const project = this.stateManager.getProject();
    const schedulerStatus = this.executionScheduler.getStatus();

    // Read open issues from JSONL
    const jsonlPath = join(this.workflowRoot, 'issues', 'issues.jsonl');
    const allIssues = await readIssuesJsonl(jsonlPath);
    const openIssues = allIssues.filter((i) => i.status === 'open');

    // Get current phase card
    const currentPhase = project.current_phase
      ? this.stateManager.getPhase(project.current_phase)
      : undefined;

    return {
      project,
      openIssues,
      runningWorkers: schedulerStatus.running.length,
      maxWorkers: this.config.maxConcurrentWorkers,
      recentDecisions: this.recentDecisions.slice(-5),
      currentPhase,
      workDir: this.workflowRoot,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Assess (Agent SDK query, read-only)
  // -------------------------------------------------------------------------

  private async assess(context: AssessmentContext): Promise<Assessment> {
    const prompt = buildAssessmentPrompt(context);
    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        tools: ['Read', 'Glob', 'Grep'],
        allowedTools: ['Read', 'Glob', 'Grep'],
        permissionMode: 'dontAsk',
        systemPrompt: COMMANDER_SYSTEM_PROMPT,
        model: this.config.decisionModel,
        outputFormat: COMMANDER_OUTPUT_SCHEMA,
        cwd: this.workflowRoot,
        maxTurns: this.config.assessMaxTurns,
        persistSession: false,
      },
    })) {
      // Extract result from the success message
      const msg = message as Record<string, unknown>;
      if (msg.type === 'result' && msg.subtype === 'success') {
        const successMsg = message as unknown as SDKResultSuccess;
        resultText = successMsg.result;
      }
    }

    if (!resultText) {
      throw new Error('Assessment returned no result');
    }

    return JSON.parse(resultText) as Assessment;
  }

  // -------------------------------------------------------------------------
  // Step 3: Decide (deterministic — no LLM)
  // -------------------------------------------------------------------------

  private decide(
    trigger: string,
    assessment: Assessment,
    context: AssessmentContext,
  ): Decision {
    const availableSlots = context.maxWorkers - context.runningWorkers;

    // Filter actions by risk threshold
    const withinThreshold = assessment.priority_actions.filter((a) =>
      isWithinThreshold(a.risk, this.config.autoApproveThreshold),
    );

    const aboveThreshold = assessment.priority_actions.filter(
      (a) => !isWithinThreshold(a.risk, this.config.autoApproveThreshold),
    );

    // Sort approved actions by priority (execute_issue first, then by risk ascending)
    const priorityOrder: Record<string, number> = {
      execute_issue: 0,
      analyze_issue: 1,
      plan_issue: 2,
      flag_blocker: 3,
      create_issue: 4,
      advance_phase: 5,
    };

    withinThreshold.sort((a, b) => {
      const typeDiff = (priorityOrder[a.type] ?? 9) - (priorityOrder[b.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return (RISK_ORDER[a.risk] ?? 2) - (RISK_ORDER[b.risk] ?? 2);
    });

    // Limit to available worker capacity (only execute_issue consumes a slot)
    const actions: PriorityAction[] = [];
    const deferred: PriorityAction[] = [...aboveThreshold];
    let slotsUsed = 0;

    for (const action of withinThreshold) {
      if (action.type === 'execute_issue') {
        if (slotsUsed < availableSlots) {
          actions.push(action);
          slotsUsed++;
        } else {
          deferred.push(action);
        }
      } else {
        // Non-execution actions (flag_blocker, create_issue, advance_phase)
        // don't consume worker slots
        actions.push(action);
      }
    }

    const decision: Decision = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      trigger,
      assessment,
      actions,
      deferred,
    };

    this.eventBus.emit('commander:decision', decision);

    return decision;
  }

  // -------------------------------------------------------------------------
  // Step 4: Dispatch
  // -------------------------------------------------------------------------

  private async dispatch(decision: Decision): Promise<void> {
    for (const action of decision.actions) {
      try {
        switch (action.type) {
          case 'execute_issue':
            await this.executionScheduler.executeIssue(
              action.target,
              action.executor as Parameters<typeof this.executionScheduler.executeIssue>[1],
            );
            break;

          case 'analyze_issue':
            // Use AgentManager for lightweight analysis (don't occupy Scheduler slots)
            await this.agentManager.spawn(action.executor as any, {
              type: action.executor as any,
              prompt: `Analyze issue ${action.target}: Read .workflow/issues/issues.jsonl, find the issue by ID, analyze root cause by exploring codebase, and write analysis results back to the issue record. Follow the manage-issue-analyze workflow pattern.`,
              workDir: this.workflowRoot,
              approvalMode: 'auto',
            });
            console.log(`[Commander] Dispatched analyze_issue: ${action.target}`);
            break;

          case 'plan_issue':
            await this.agentManager.spawn(action.executor as any, {
              type: action.executor as any,
              prompt: `Plan solution for issue ${action.target}: Read the issue from .workflow/issues/issues.jsonl, use the existing analysis if available, generate a solution with steps[], context, and promptTemplate, then write it back to the issue record. Follow the manage-issue-plan workflow pattern.`,
              workDir: this.workflowRoot,
              approvalMode: 'auto',
            });
            console.log(`[Commander] Dispatched plan_issue: ${action.target}`);
            break;

          case 'flag_blocker':
            console.log(`[Commander] Blocker flagged: ${action.target} — ${action.reason}`);
            break;

          case 'create_issue':
            console.log(`[Commander] Issue creation recommended: ${action.target} — ${action.reason}`);
            break;

          case 'advance_phase':
            console.log(`[Commander] Phase advancement recommended: ${action.target} — ${action.reason}`);
            break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Commander] Dispatch failed for ${action.type}:${action.target}:`, message);
      }
    }

    this.state.activeWorkers = this.executionScheduler.getStatus().running.length;
  }

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  private emitStatus(): void {
    this.eventBus.emit('supervisor:status', this.executionScheduler.getStatus());
    this.eventBus.emit('commander:status', this.state);
  }
}
