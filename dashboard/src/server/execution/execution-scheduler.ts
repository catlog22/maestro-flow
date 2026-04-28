// ---------------------------------------------------------------------------
// ExecutionScheduler — orchestrates issue execution via agent processes
// ---------------------------------------------------------------------------

import { join } from 'node:path';
import { readIssuesJsonl, writeIssuesJsonl, withIssueWriteLock } from '../utils/issue-store.js';

import type { AgentType, AgentProcess } from '../../shared/agent-types.js';
import type { Issue, IssueStatus } from '../../shared/issue-types.js';
import type {
  ExecutionSlot,
  ExecutionResult,
  IssueExecution,
  SchedulerConfig,
  SchedulerStatus,
} from '../../shared/execution-types.js';
import { DEFAULT_SCHEDULER_CONFIG } from '../../shared/execution-types.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import { WorkspaceManager, type WorkspaceConfig } from './workspace-manager.js';
import { PromptRegistry } from '../prompt/prompt-registry.js';
import type { ExecutionJournal } from './execution-journal.js';
import type { DispatchStrategy, DispatchContext, DispatchDecision } from './dispatch-strategy.js';
import type { SelfLearningService } from '../supervisor/self-learning-service.js';
import { PriorityStrategy } from './strategies/priority-strategy.js';
import { SmartStrategy } from './strategies/smart-strategy.js';
import { GraphWalkerFactory } from '../coordinator/graph-walker-factory.js';
import { WalkerEventBridge } from '../coordinator/walker-event-bridge.js';


// ---------------------------------------------------------------------------
// Valid agent types for input validation
// ---------------------------------------------------------------------------

const VALID_EXECUTORS = new Set<string>([
  'claude-code', 'codex', 'codex-server', 'gemini', 'gemini-a2a', 'qwen', 'opencode', 'agent-sdk',
]);

// ---------------------------------------------------------------------------
// ExecutionScheduler
// ---------------------------------------------------------------------------

export class ExecutionScheduler {
  private readonly runningSlots = new Map<string, ExecutionSlot>();
  private readonly queue: string[] = [];
  private readonly retryQueue = new Map<string, { retryAt: number; count: number }>();
  private readonly claimed = new Set<string>();
  private config: SchedulerConfig;
  private readonly workspaceManager: WorkspaceManager | null;
  private readonly promptRegistry: PromptRegistry;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: string | null = null;
  private stats = { totalDispatched: 0, totalCompleted: 0, totalFailed: 0 };
  private tokenUsage = { totalInputTokens: 0, totalOutputTokens: 0 };
  private readonly strategies = new Map<string, DispatchStrategy>();
  private activeStrategy: DispatchStrategy;
  private selfLearningService?: SelfLearningService;
  private isDispatching = false;
  public isCommanderActive = false;

  // Factory for GraphWalker instances (shared across dispatchViaChain calls)
  private readonly factory: GraphWalkerFactory;

  constructor(
    private readonly agentManager: AgentManager,
    private readonly eventBus: DashboardEventBus,
    private readonly jsonlPath: string,
    config?: Partial<SchedulerConfig>,
    promptRegistry?: PromptRegistry,
    private readonly journal?: ExecutionJournal,
    selfLearningService?: SelfLearningService,
  ) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
    this.factory = new GraphWalkerFactory();
    this.promptRegistry = promptRegistry ?? PromptRegistry.createDefault();
    this.selfLearningService = selfLearningService;

    // Initialize workspace manager if enabled
    const ws = this.config.workspace;
    this.workspaceManager = ws.enabled
      ? new WorkspaceManager(process.cwd(), {
          useWorktree: ws.useWorktree,
          autoCleanup: ws.autoCleanup,
        })
      : null;

    // Register built-in dispatch strategies
    const priorityStrategy = new PriorityStrategy();
    const smartStrategy = new SmartStrategy();
    this.strategies.set(priorityStrategy.name, priorityStrategy);
    this.strategies.set(smartStrategy.name, smartStrategy);
    this.activeStrategy = this.strategies.get(this.config.strategy) ?? priorityStrategy;

    this.subscribeToAgentEvents();
    // Recover state from persisted issues on startup
    void this.recoverState();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Dispatch a single issue for execution */
  async executeIssue(issueId: string, executor?: AgentType): Promise<void> {
    if (this.isDispatching) {
      console.warn(`[Execution] executeIssue(${issueId}) called while tick dispatch in progress, skipping to avoid conflict`);
      return;
    }
    if (!this.claim(issueId)) return;

    if (executor && !VALID_EXECUTORS.has(executor)) {
      this.claimed.delete(issueId);
      throw new Error(`Invalid executor: ${executor}`);
    }

    const issue = await this.findIssue(issueId);
    if (!issue) {
      this.claimed.delete(issueId);
      throw new Error(`Issue not found: ${issueId}`);
    }

    const resolvedExecutor = executor ?? issue.executor ?? this.config.defaultExecutor;
    await this.dispatch(issue, resolvedExecutor);
  }

  /** Enqueue multiple issues for batch execution */
  async executeBatch(
    issueIds: string[],
    executor?: AgentType,
    maxConcurrency?: number,
  ): Promise<void> {
    if (executor && !VALID_EXECUTORS.has(executor)) {
      throw new Error(`Invalid executor: ${executor}`);
    }

    const concurrency = maxConcurrency ?? this.config.maxConcurrentAgents;
    const unclaimed = issueIds.filter((id) => this.claim(id));

    // Fill available slots immediately, rest goes to queue
    const availableSlots = concurrency - this.runningSlots.size;
    const immediate = unclaimed.slice(0, Math.max(0, availableSlots));
    const queued = unclaimed.slice(Math.max(0, availableSlots));

    this.queue.push(...queued);

    // Update queued issues' execution state
    for (const id of queued) {
      await this.updateIssueFields(id, {
        execution: { status: 'queued', retryCount: 0 },
      });
    }

    // Dispatch immediate batch
    for (const id of immediate) {
      const issue = await this.findIssue(id);
      if (issue) {
        const resolvedExecutor = executor ?? issue.executor ?? this.config.defaultExecutor;
        await this.dispatch(issue, resolvedExecutor);
      }
    }
  }

  /** Cancel a running or queued issue */
  async cancelIssue(issueId: string): Promise<void> {
    // Remove from queue
    const queueIdx = this.queue.indexOf(issueId);
    if (queueIdx >= 0) this.queue.splice(queueIdx, 1);

    // Remove from retry queue
    this.retryQueue.delete(issueId);

    // Stop running agent
    for (const [processId, slot] of this.runningSlots) {
      if (slot.issueId === issueId) {
        await this.agentManager.stop(processId).catch((err: unknown) => {
          console.warn(`[Execution] Failed to stop agent ${processId}:`, err);
        });
        this.runningSlots.delete(processId);
        break;
      }
    }

    this.claimed.delete(issueId);
    await this.updateIssueFields(issueId, {
      execution: { status: 'idle', retryCount: 0 },
    });
  }

  /** Start the automatic dispatch tick loop */
  enableAutoDispatch(): void {
    if (this.tickTimer) return;
    if (this.isCommanderActive) {
      console.warn('[Execution] enableAutoDispatch skipped: Commander is managing dispatch');
      return;
    }
    this.config.enabled = true;
    this.tickTimer = setInterval(() => void this.tick(), this.config.pollIntervalMs);
    this.emitStatus();
  }

  /** @deprecated Use enableAutoDispatch() */
  startSupervisor(): void { this.enableAutoDispatch(); }

  /** Stop automatic dispatch */
  disableAutoDispatch(): void {
    this.config.enabled = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.emitStatus();
  }

  /** @deprecated Use disableAutoDispatch() */
  stopSupervisor(): void { this.disableAutoDispatch(); }

  /** Update scheduler config */
  updateConfig(partial: Partial<SchedulerConfig>): void {
    const wasEnabled = this.config.enabled;
    Object.assign(this.config, partial);

    // Sync active strategy if config.strategy changed
    if (partial.strategy) {
      const newStrategy = this.strategies.get(partial.strategy);
      if (newStrategy) {
        this.activeStrategy = newStrategy;
      }
    }

    // Restart tick timer if interval changed
    if (this.config.enabled && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(() => void this.tick(), this.config.pollIntervalMs);
    }

    if (this.config.enabled && !wasEnabled) {
      this.enableAutoDispatch();
    } else if (!this.config.enabled && wasEnabled) {
      this.disableAutoDispatch();
    }

    this.emitStatus();
  }

  /** Get a snapshot of current scheduler state */
  getStatus(): SchedulerStatus {
    return {
      enabled: this.config.enabled,
      running: Array.from(this.runningSlots.values()),
      queued: [...this.queue],
      retrying: Array.from(this.retryQueue.entries()).map(([issueId, r]) => ({
        issueId,
        retryAt: new Date(r.retryAt).toISOString(),
      })),
      lastTickAt: this.lastTickAt,
      isCommanderActive: this.isCommanderActive,
      stats: { ...this.stats },
      tokenUsage: { ...this.tokenUsage },
    };
  }

  /** Get config */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /** Get the execution slot for a given issue */
  getSlotForIssue(issueId: string): ExecutionSlot | undefined {
    for (const slot of this.runningSlots.values()) {
      if (slot.issueId === issueId) return slot;
    }
    return undefined;
  }

  /** Register a dispatch strategy (overwrites if name already exists). */
  registerStrategy(strategy: DispatchStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /** Switch the active dispatch strategy by name. Throws if not registered. */
  setStrategy(name: string): void {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new Error(`Unknown dispatch strategy: ${name}. Registered: ${[...this.strategies.keys()].join(', ')}`);
    }
    this.activeStrategy = strategy;
    this.config.strategy = name as SchedulerConfig['strategy'];
    this.emitStatus();
  }

  /** Get the name of the active dispatch strategy. */
  getActiveStrategyName(): string {
    return this.activeStrategy.name;
  }

  // -------------------------------------------------------------------------
  // Public: External slot management (e.g., WaveExecutor subtasks)
  // -------------------------------------------------------------------------

  /** Acquire a slot for external use (e.g., WaveExecutor subtasks). Returns false if no capacity. */
  acquireSlot(issueId: string, processId: string, executor: AgentType): boolean {
    if (this.runningSlots.size >= this.config.maxConcurrentAgents) {
      return false;
    }
    const slot: ExecutionSlot = {
      issueId,
      processId,
      executor,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      turnNumber: 1,
      maxTurns: 1,
    };
    this.runningSlots.set(processId, slot);
    this.emitStatus();
    return true;
  }

  /** Release a slot after external use */
  releaseSlot(processId: string): void {
    this.runningSlots.delete(processId);
    this.emitStatus();
  }

  /** Wait for a slot to become available, with timeout. Resolves true if acquired, false on timeout. */
  async waitForSlot(issueId: string, processId: string, executor: AgentType, timeoutMs = 60000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.acquireSlot(issueId, processId, executor)) return true;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  }

  /** Clean shutdown */
  async destroy(): Promise<void> {
    this.disableAutoDispatch();
    await this.workspaceManager?.destroy();
  }

  // -------------------------------------------------------------------------
  // Private: Atomic claim
  // -------------------------------------------------------------------------

  /** Atomically claim an issue. Returns true if successfully claimed. */
  private claim(issueId: string): boolean {
    if (this.claimed.has(issueId)) return false;
    this.claimed.add(issueId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Private: State recovery on startup
  // -------------------------------------------------------------------------

  /** Recover in-memory state from persisted JSONL on startup */
  private async recoverState(): Promise<void> {
    const issues = await readIssuesJsonl(this.jsonlPath);

    for (const issue of issues) {
      if (!issue.execution) continue;

      switch (issue.execution.status) {
        case 'running':
          // Agent process is gone after restart — mark as failed for retry
          this.claimed.add(issue.id);
          await this.updateIssueFields(issue.id, {
            execution: {
              ...issue.execution,
              status: 'retrying',
              lastError: 'Server restarted while executing',
            },
          });
          this.retryQueue.set(issue.id, {
            retryAt: Date.now() + this.config.retryBackoffMs,
            count: (issue.execution.retryCount ?? 0) + 1,
          });
          break;

        case 'queued':
          // Re-enqueue
          this.claimed.add(issue.id);
          this.queue.push(issue.id);
          break;

        case 'retrying': {
          // Re-add to retry queue
          this.claimed.add(issue.id);
          const count = issue.execution.retryCount ?? 1;
          const backoff = this.config.retryBackoffMs * Math.pow(2, count - 1);
          this.retryQueue.set(issue.id, {
            retryAt: Date.now() + backoff,
            count,
          });
          break;
        }

        // idle, completed, failed — no recovery needed
      }
    }

    // Journal-based recovery: augment state with journal analysis
    if (this.journal) {
      try {
        const recoveryActions = await this.journal.recover();
        for (const action of recoveryActions) {
          if (action.action === 'retry' && !this.claimed.has(action.issueId)) {
            // Journal says this was dispatched but never completed — ensure it retries
            this.claimed.add(action.issueId);
            this.retryQueue.set(action.issueId, {
              retryAt: Date.now() + this.config.retryBackoffMs,
              count: 1,
            });
            console.log(`[Execution] Journal recovery: scheduling retry for ${action.issueId} — ${action.reason}`);
          }
          // resume-wave actions are informational — wave executor handles its own resume
        }
      } catch (err) {
        console.warn('[Execution] Journal recovery failed, continuing with JSONL state:', err);
      }
    }

    if (this.queue.length > 0 || this.retryQueue.size > 0) {
      console.log(`[Execution] Recovered state: ${this.queue.length} queued, ${this.retryQueue.size} retrying`);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Dispatch
  // -------------------------------------------------------------------------

  private async dispatch(issue: Issue, executor: AgentType): Promise<void> {
    // Route to chain-based execution when issue has a chain defined
    if (issue.solution?.chain) {
      await this.dispatchViaChain(issue, executor);
      return;
    }

    const prompt = await this.buildPrompt(issue);
    const now = new Date().toISOString();
    const retryCount = issue.execution?.retryCount ?? 0;

    // Create isolated workspace if manager is active
    let workDir = process.cwd();
    if (this.workspaceManager) {
      try {
        const ws = await this.workspaceManager.createForIssue(issue.id);
        workDir = ws.path;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (this.config.workspace.strict) {
          // Strict mode: fail execution rather than running in project root
          await this.handleFailure(issue.id, `Workspace creation failed: ${message}`);
          return;
        }
        console.error(`[Execution] Workspace creation failed for ${issue.id}, falling back to cwd:`, message);
      }
    }

    // Update issue: execution state + status in a single write
    await this.updateIssueFields(issue.id, {
      status: 'in_progress',
      execution: {
        status: 'running',
        retryCount,
        startedAt: now,
      },
    });

    let proc: AgentProcess;
    try {
      proc = await this.agentManager.spawn(executor, {
        type: executor,
        prompt,
        workDir,
        approvalMode: 'auto',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.handleFailure(issue.id, message);
      return;
    }

    const slot: ExecutionSlot = {
      issueId: issue.id,
      processId: proc.id,
      executor,
      startedAt: now,
      lastActivityAt: now,
      turnNumber: 1,
      maxTurns: this.config.maxTurnsPerIssue ?? 3,
    };

    this.runningSlots.set(proc.id, slot);

    // Update processId on issue
    await this.updateIssueFields(issue.id, {
      execution: {
        status: 'running',
        processId: proc.id,
        retryCount,
        startedAt: now,
      },
    });

    this.stats.totalDispatched++;

    // Journal: record dispatch event for crash recovery
    await this.journal?.append({
      type: 'issue:dispatched',
      issueId: issue.id,
      processId: proc.id,
      executor,
      timestamp: now,
    });

    // Read updated issue for incremental client push
    const startedIssue = await this.findIssue(issue.id);

    this.eventBus.emit('execution:started', {
      issueId: issue.id,
      processId: proc.id,
      executor,
      issue: startedIssue ?? undefined,
    });
  }

  /**
   * Chain-based dispatch — routes issue execution through a GraphWalker chain.
   * The chain (e.g., 'issue-lifecycle') defines the multi-step execution flow.
   */
  private async dispatchViaChain(issue: Issue, executor: AgentType): Promise<void> {
    const now = new Date().toISOString();
    const retryCount = issue.execution?.retryCount ?? 0;
    const chainId = issue.solution!.chain!;
    const chainMode = issue.solution?.chainMode ?? 'full';

    // Workspace isolation
    let workDir = process.cwd();
    if (this.workspaceManager) {
      try {
        const ws = await this.workspaceManager.createForIssue(issue.id);
        workDir = ws.path;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (this.config.workspace.strict) {
          await this.handleFailure(issue.id, `Workspace creation failed: ${message}`);
          return;
        }
        console.error(`[Execution] Workspace creation failed for ${issue.id}, falling back to cwd:`, message);
      }
    }

    // Update issue status
    await this.updateIssueFields(issue.id, {
      status: 'in_progress',
      execution: { status: 'running', retryCount, startedAt: now },
    });

    this.stats.totalDispatched++;

    this.eventBus.emit('execution:started', {
      issueId: issue.id,
      processId: `chain-${issue.id}`,
      executor,
    });

    // Create GraphWalker via factory
    try {
      const bridge = new WalkerEventBridge('coordinate', this.eventBus, `chain-${issue.id}`);
      const sessionDir = join(workDir, '.workflow', '.maestro', `chain-${issue.id}`);
      const { walker } = await this.factory.create({
        agentManager: this.agentManager,
        eventBus: this.eventBus,
        workDir,
        emitter: bridge,
        analyzer: null,
        sessionDir,
      });

      const walkerState = await walker.start(chainId, issue.description, {
        tool: executor,
        autoMode: true,
        workflowRoot: workDir,
        inputs: {
          issue_id: issue.id,
          description: issue.description,
          mode: chainMode,
        },
      });

      // Determine success from walker state
      if (walkerState.status === 'completed') {
        const lastCmd = walkerState.history.filter((h: { node_type: string; summary?: string }) => h.node_type === 'command').pop();
        await this.updateIssueFields(issue.id, {
          status: 'resolved',
          execution: {
            status: 'completed',
            retryCount,
            completedAt: new Date().toISOString(),
            result: { summary: lastCmd?.summary ?? 'Chain completed' },
          },
        });
        this.claimed.delete(issue.id);
        this.stats.totalCompleted++;

        const completedIssue = await this.findIssue(issue.id);
        this.eventBus.emit('execution:completed', {
          issueId: issue.id,
          processId: `chain-${issue.id}`,
          issue: completedIssue ?? undefined,
        });
      } else {
        const failedStep = walkerState.history.filter((h: { outcome?: string; summary?: string }) => h.outcome === 'failure').pop();
        await this.handleFailure(issue.id, failedStep?.summary ?? 'Chain execution failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.handleFailure(issue.id, `Chain dispatch failed: ${message}`);
    }

    // Workspace cleanup
    if (this.workspaceManager?.getWorkspacePath(issue.id)) {
      void this.workspaceManager.removeForIssue(issue.id);
    }
  }

  private async buildPrompt(issue: Issue): Promise<string> {
    const mode = issue.promptMode ?? this.config.defaultPromptMode;

    // Check for custom prompt template — routes to 'template' builder
    if (issue.solution?.promptTemplate) {
      const builder = this.promptRegistry.get('template');
      if (builder) {
        const result = await builder.build({
          issue,
          config: this.config,
          promptMode: 'template',
          customTemplate: issue.solution.promptTemplate,
        });
        return result.userPrompt;
      }
      // Fallback if template builder not registered
      return this.applyTemplate(issue.solution.promptTemplate, issue);
    }

    // Delegate to registered builder
    const builder = this.promptRegistry.get(mode);
    if (builder) {
      const result = await builder.build({
        issue,
        config: this.config,
        promptMode: mode,
      });
      return result.userPrompt;
    }

    // Fallback: inline logic (kept for safety)
    return this.buildPromptFallback(issue, mode);
  }

  /** Inline fallback — preserves original logic for backward compatibility */
  private buildPromptFallback(issue: Issue, mode: string): string {
    if (mode === 'skill') {
      return `Execute the following issue:\n\nIssue ID: ${issue.id}\nTitle: ${issue.title}\nType: ${issue.type}\nPriority: ${issue.priority}\n\nDescription:\n${issue.description}`;
    }

    const lines: string[] = [
      `You are working on the following ${issue.type} issue:`,
      '',
      `## ${issue.title}`,
      '',
      issue.description,
      '',
      `Priority: ${issue.priority}`,
    ];

    if (issue.solution) {
      lines.push('', '## Solution Plan', '');

      if (issue.solution.context) {
        lines.push('### Context', '', issue.solution.context, '');
      }

      if (issue.solution.steps.length > 0) {
        lines.push('### Steps', '');
        for (let i = 0; i < issue.solution.steps.length; i++) {
          const step = issue.solution.steps[i];
          lines.push(`${i + 1}. ${step.description}`);
          if (step.target) lines.push(`   - Target: ${step.target}`);
          if (step.verification) lines.push(`   - Verify: ${step.verification}`);
        }
      }

      lines.push(
        '',
        'Follow the solution plan above. Execute each step in order.',
        'After completing all steps, verify each step\'s criteria.',
        'When done, provide a summary of the changes made.',
      );
    } else {
      lines.push(
        '',
        'Please implement this issue. Follow existing code patterns and conventions.',
        'When done, provide a summary of the changes made.',
      );
    }

    return lines.join('\n');
  }

  /** Simple variable substitution for custom prompt templates */
  private applyTemplate(template: string, issue: Issue): string {
    return template
      .replace(/\{\{\s*issue\.id\s*\}\}/g, issue.id)
      .replace(/\{\{\s*issue\.title\s*\}\}/g, issue.title)
      .replace(/\{\{\s*issue\.description\s*\}\}/g, issue.description)
      .replace(/\{\{\s*issue\.type\s*\}\}/g, issue.type)
      .replace(/\{\{\s*issue\.priority\s*\}\}/g, issue.priority)
      .replace(/\{\{\s*issue\.status\s*\}\}/g, issue.status);
  }

  // -------------------------------------------------------------------------
  // Private: Agent event handling
  // -------------------------------------------------------------------------

  private subscribeToAgentEvents(): void {
    this.eventBus.on('agent:stopped', (event) => {
      const payload = event.data as { processId: string; reason?: string };
      void this.handleAgentStopped(payload.processId, payload.reason);
    });

    // Multi-turn continuation: triggered by turn/completed notification in
    // codex app-server mode. The process stays alive between turns.
    this.eventBus.on('agent:turnCompleted', (event) => {
      const payload = event.data as { processId: string };
      void this.handleTurnCompleted(payload.processId);
    });

    // Track activity for stall detection + accumulate token usage
    this.eventBus.on('agent:entry', (event) => {
      const entry = event.data as { processId: string; type: string; inputTokens?: number; outputTokens?: number };
      const slot = this.runningSlots.get(entry.processId);
      if (slot) {
        slot.lastActivityAt = new Date().toISOString();
      }

      // Accumulate token usage from token_usage entries
      if (entry.type === 'token_usage') {
        this.tokenUsage.totalInputTokens += entry.inputTokens ?? 0;
        this.tokenUsage.totalOutputTokens += entry.outputTokens ?? 0;
      }
    });
  }

  private async handleAgentStopped(processId: string, reason?: string): Promise<void> {
    const slot = this.runningSlots.get(processId);
    if (!slot) return;

    // Check entries for success/failure
    const entries = this.agentManager.getEntries(processId);
    const lastEntries = entries.slice(-5);
    const hasError = lastEntries.some(
      (e) => e.type === 'error' || (e.type === 'status_change' && e.status === 'error'),
    );

    if (hasError || reason === 'error') {
      this.runningSlots.delete(processId);
      const errorMsg = reason ?? 'Agent stopped with error';
      await this.handleFailure(slot.issueId, errorMsg);
      await this.dispatchNext();
      return;
    }

    // Process exited normally — treat as completion.
    // Multi-turn continuation is handled by handleTurnCompleted (triggered by
    // turn/completed notification while the process is still alive).
    this.runningSlots.delete(processId);
    await this.handleCompletion(slot.issueId, processId);
    await this.dispatchNext();
  }

  /**
   * Handle turn/completed notification from a codex-server agent.
   * The process is still alive — attempt continuation or complete.
   */
  private async handleTurnCompleted(processId: string): Promise<void> {
    const slot = this.runningSlots.get(processId);
    if (!slot) return;

    if (await this.attemptContinuation(slot, processId)) {
      return; // Continuation started, slot stays in runningSlots
    }

    // No more turns — complete the execution.
    // Stop the still-alive process since we're done with it.
    await this.agentManager.stop(processId).catch((err: unknown) => {
      console.warn(`[Execution] Failed to stop completed agent ${processId}:`, err);
    });

    this.runningSlots.delete(processId);
    await this.handleCompletion(slot.issueId, processId);
    await this.dispatchNext();
  }

  private async handleCompletion(issueId: string, processId: string): Promise<void> {
    // Extract result from agent entries
    const result = this.extractResult(processId);

    // Journal: record completion event
    await this.journal?.append({
      type: 'issue:completed',
      issueId,
      processId,
      timestamp: new Date().toISOString(),
      result: result ? {
        summary: result.summary,
        commitHash: result.commitHash,
        filesChanged: result.filesChanged,
      } : undefined,
    });

    await this.updateIssueFields(issueId, {
      status: 'resolved',
      execution: {
        status: 'completed',
        retryCount: 0,
        completedAt: new Date().toISOString(),
        result,
      },
    });
    this.claimed.delete(issueId);
    this.stats.totalCompleted++;

    // Clean up workspace if auto-cleanup is enabled
    if (this.workspaceManager?.getWorkspacePath(issueId)) {
      void this.workspaceManager.removeForIssue(issueId);
    }

    // Read updated issue for incremental client push
    const completedIssue = await this.findIssue(issueId);

    this.eventBus.emit('execution:completed', { issueId, processId, issue: completedIssue ?? undefined });
  }

  /** Extract structured result from agent entry history */
  private extractResult(processId: string): ExecutionResult | undefined {
    const entries = this.agentManager.getEntries(processId);
    if (entries.length === 0) return undefined;

    const result: ExecutionResult = {};

    // Count file changes
    const fileChanges = entries.filter((e) => e.type === 'file_change');
    if (fileChanges.length > 0) {
      result.filesChanged = fileChanges.length;
    }

    // Extract last assistant message as summary
    const assistantMessages = entries.filter(
      (e) => e.type === 'assistant_message' && !(e as { partial?: boolean }).partial,
    );
    if (assistantMessages.length > 0) {
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      const text = (lastMsg as { content?: string }).content ?? '';
      // Truncate to reasonable length for storage
      result.summary = text.slice(0, 2000);
    }

    // Look for commit hash or PR URL in command outputs
    const commandOutputs = entries.filter((e) => e.type === 'command_exec');
    for (const entry of commandOutputs) {
      const output = (entry as { output?: string }).output ?? '';

      // Match git commit hash
      const commitMatch = output.match(/\b([a-f0-9]{7,40})\b.*(?:commit|created)/i)
        ?? output.match(/(?:commit|created).*\b([a-f0-9]{7,40})\b/i);
      if (commitMatch && !result.commitHash) {
        result.commitHash = commitMatch[1];
      }

      // Match PR URL
      const prMatch = output.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
      if (prMatch && !result.prUrl) {
        result.prUrl = prMatch[1];
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  private async handleFailure(issueId: string, error: string): Promise<void> {
    const issue = await this.findIssue(issueId);
    const currentRetry = issue?.execution?.retryCount ?? 0;

    // Journal: record failure event
    await this.journal?.append({
      type: 'issue:failed',
      issueId,
      processId: issue?.execution?.processId ?? '',
      error,
      retryCount: currentRetry + 1,
      timestamp: new Date().toISOString(),
    });

    if (currentRetry < this.config.maxRetries) {
      // Schedule retry with exponential backoff
      const backoff = this.config.retryBackoffMs * Math.pow(2, currentRetry);
      this.retryQueue.set(issueId, {
        retryAt: Date.now() + backoff,
        count: currentRetry + 1,
      });
      await this.updateIssueFields(issueId, {
        execution: {
          status: 'retrying',
          retryCount: currentRetry + 1,
          lastError: error,
        },
      });
    } else {
      await this.updateIssueFields(issueId, {
        execution: {
          status: 'failed',
          retryCount: currentRetry,
          lastError: error,
        },
      });
      this.claimed.delete(issueId);
      this.stats.totalFailed++;
    }

    // Find processId for the failed issue (may already be removed from runningSlots)
    let processId = '';
    for (const [pid, slot] of this.runningSlots) {
      if (slot.issueId === issueId) {
        processId = pid;
        this.runningSlots.delete(pid);
        break;
      }
    }

    // Read updated issue for incremental client push
    const failedIssue = await this.findIssue(issueId);

    this.eventBus.emit('execution:failed', { issueId, processId, error, issue: failedIssue ?? undefined });
  }

  // -------------------------------------------------------------------------
  // Private: Multi-turn continuation (codex-server only)
  // -------------------------------------------------------------------------

  /**
   * Attempt to continue a codex-server agent for another turn.
   * Returns true if continuation was initiated; false if normal completion should proceed.
   */
  private async attemptContinuation(slot: ExecutionSlot, processId: string): Promise<boolean> {
    // Only codex-server supports interactive follow-up messages
    if (slot.executor !== 'codex-server') return false;

    // Check turn budget
    if (slot.turnNumber >= slot.maxTurns) return false;

    // Re-read issue from JSONL to check current status
    let issue: Issue | null;
    try {
      issue = await this.findIssue(slot.issueId);
    } catch {
      // IO failure — don't continue, fall through to normal completion
      return false;
    }
    if (!issue) return false;

    // If issue is already resolved or closed, no need to continue
    if (issue.status === 'resolved' || issue.status === 'closed') return false;

    // Check that the agent process is still registered in agentManager
    // (sendMessage will throw if process is gone)
    const continuationPrompt = this.buildContinuationPrompt(
      slot.turnNumber + 1,
      slot.maxTurns,
    );

    try {
      await this.agentManager.sendMessage(processId, continuationPrompt);
    } catch {
      // Process already exited — fall through to normal completion
      return false;
    }

    // Update slot for next turn
    slot.turnNumber++;
    slot.lastActivityAt = new Date().toISOString();
    // Slot remains in runningSlots (not deleted)

    console.log(
      `[Execution] Continuation turn ${slot.turnNumber}/${slot.maxTurns} for issue ${slot.issueId} (process ${processId})`,
    );

    return true;
  }

  /** Build a continuation prompt for multi-turn execution */
  private buildContinuationPrompt(turnNumber: number, maxTurns: number): string {
    return [
      `Continuation turn #${turnNumber} of ${maxTurns}.`,
      '',
      'Continuation guidance:',
      '- The previous turn completed normally, but the issue is still in an active state.',
      '- Resume from the current workspace and workpad state instead of restarting from scratch.',
      '- Review what was accomplished in the previous turn and continue from where it left off.',
    ].join('\n');
  }

  // -------------------------------------------------------------------------
  // Private: Supervisor tick
  // -------------------------------------------------------------------------

  private async tick(): Promise<void> {
    this.lastTickAt = new Date().toISOString();

    // 1. Reconcile running issues (detect externally resolved/closed)
    await this.reconcileRunningIssues();

    // 2. Stall detection
    await this.detectStalls();

    // 3. Process retry queue
    this.processRetries();

    // 4. Dispatch queued issues first
    await this.dispatchNext();

    // 5. Auto-dispatch via active strategy
    await this.dispatchViaStrategy();

    // 6. Emit status
    this.emitStatus();
  }

  /** Delegate issue selection to the active strategy and execute returned decisions. */
  private async dispatchViaStrategy(): Promise<void> {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      const availableSlots = this.config.maxConcurrentAgents - this.runningSlots.size;
      if (availableSlots <= 0) return;

      const issues = await readIssuesJsonl(this.jsonlPath);
      const context: DispatchContext = {
        issues,
        runningSlots: this.runningSlots,
        claimed: this.claimed,
        config: this.config,
        availableSlots,
        learningSuggestions: this.selfLearningService?.getStats().suggestions ?? [],
      };

      const decisions = await this.activeStrategy.selectIssues(context);

      for (const decision of decisions) {
        // Re-check capacity (previous dispatches in this batch may have filled slots)
        if (this.runningSlots.size >= this.config.maxConcurrentAgents) break;

        if (!this.claim(decision.issueId)) continue;

        const issue = issues.find((i) => i.id === decision.issueId);
        if (!issue) {
          this.claimed.delete(decision.issueId);
          continue;
        }

        const executor = (decision.executor ?? issue.executor ?? this.config.defaultExecutor) as AgentType;
        await this.dispatch(issue, executor);
      }
    } finally {
      this.isDispatching = false;
    }
  }

  /**
   * Reconcile running slots against persisted issue state.
   * If an issue was externally resolved or closed, stop its agent.
   */
  private async reconcileRunningIssues(): Promise<void> {
    for (const [processId, slot] of this.runningSlots) {
      const issue = await this.findIssue(slot.issueId);
      if (!issue) continue;

      if (issue.status === 'resolved' || issue.status === 'closed') {
        console.log(
          `[Execution] Reconcile: issue ${slot.issueId} is ${issue.status}, stopping agent ${processId}`,
        );

        await this.agentManager.stop(processId).catch((err: unknown) => {
          console.warn(`[Execution] Failed to stop reconciled agent ${processId}:`, err);
        });

        // Update JSONL status before removing the slot
        await this.updateIssueFields(slot.issueId, {
          status: 'resolved',
          execution: {
            status: 'completed',
            completedAt: new Date().toISOString(),
          },
        });

        this.runningSlots.delete(processId);
        this.claimed.delete(slot.issueId);
        this.stats.totalCompleted++;

        // Read updated issue for incremental client push
        const reconciledIssue = await this.findIssue(slot.issueId);

        this.eventBus.emit('execution:completed', {
          issueId: slot.issueId,
          processId,
          issue: reconciledIssue ?? undefined,
        });
      }
    }
  }

  private async detectStalls(): Promise<void> {
    const now = Date.now();
    for (const [processId, slot] of this.runningSlots) {
      const lastActivity = new Date(slot.lastActivityAt).getTime();
      if (now - lastActivity > this.config.stallTimeoutMs) {
        console.warn(`[Execution] Stall detected for issue ${slot.issueId} (process ${processId})`);
        await this.agentManager.stop(processId).catch((err: unknown) => {
          console.warn(`[Execution] Failed to stop stalled agent ${processId}:`, err);
        });
        // handleAgentStopped will clean up
      }
    }
  }

  private processRetries(): void {
    const now = Date.now();
    for (const [issueId, retry] of this.retryQueue) {
      if (now >= retry.retryAt) {
        this.retryQueue.delete(issueId);
        this.queue.unshift(issueId); // Priority position
      }
    }
  }

  /** @deprecated Superseded by PriorityStrategy via dispatchViaStrategy(). Kept for reference. */
  private async autoDispatchByPriority(): Promise<void> {
    if (this.queue.length === 0) {
      // Check for unqueued open issues to auto-enqueue
      const issues = await readIssuesJsonl(this.jsonlPath);
      const priorityOrder: Record<string, number> = {
        urgent: 0,
        high: 1,
        medium: 2,
        low: 3,
      };

      const candidates = issues
        .filter(
          (i) =>
            (i.status === 'open') &&
            (!i.execution || i.execution.status === 'idle') &&
            !this.claimed.has(i.id),
        )
        .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

      for (const issue of candidates) {
        if (this.claim(issue.id)) {
          this.queue.push(issue.id);
          await this.updateIssueFields(issue.id, {
            execution: { status: 'queued', retryCount: 0 },
          });
        }
      }
    }

    await this.dispatchNext();
  }

  /**
   * @deprecated Superseded by SmartStrategy via dispatchViaStrategy(). Kept for reference.
   *
   * Smart strategy: priority + executor affinity + failure avoidance.
   * - Prioritize issues matching idle executor types (spread load across agents)
   * - Deprioritize issue types that have recently failed
   */
  private async autoDispatchSmart(): Promise<void> {
    if (this.queue.length === 0) {
      const issues = await readIssuesJsonl(this.jsonlPath);
      const priorityOrder: Record<string, number> = {
        urgent: 0, high: 1, medium: 2, low: 3,
      };

      // Determine which executor types are currently in use
      const busyExecutors = new Map<string, number>();
      for (const slot of this.runningSlots.values()) {
        busyExecutors.set(slot.executor, (busyExecutors.get(slot.executor) ?? 0) + 1);
      }

      const candidates = issues
        .filter(
          (i) =>
            i.status === 'open' &&
            (!i.execution || i.execution.status === 'idle') &&
            !this.claimed.has(i.id),
        )
        .map((issue) => {
          const executor = issue.executor ?? this.config.defaultExecutor;
          const priorityScore = priorityOrder[issue.priority] ?? 3;
          // Prefer executors with fewer running slots (load balancing)
          const affinityScore = busyExecutors.get(executor) ?? 0;
          // Penalize if previous execution failed (avoid re-failing)
          const failurePenalty = issue.execution?.lastError ? 2 : 0;

          return {
            issue,
            score: priorityScore + affinityScore + failurePenalty,
          };
        })
        .sort((a, b) => a.score - b.score);

      for (const { issue } of candidates) {
        if (this.claim(issue.id)) {
          this.queue.push(issue.id);
          await this.updateIssueFields(issue.id, {
            execution: { status: 'queued', retryCount: 0 },
          });
        }
      }
    }

    await this.dispatchNext();
  }

  private async dispatchNext(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.runningSlots.size < this.config.maxConcurrentAgents
    ) {
      const issueId = this.queue.shift()!;
      const issue = await this.findIssue(issueId);
      if (!issue) {
        this.claimed.delete(issueId);
        continue;
      }
      const executor = issue.executor ?? this.config.defaultExecutor;
      await this.dispatch(issue, executor);
    }
  }

  // -------------------------------------------------------------------------
  // Private: JSONL operations (all serialized via writeLock)
  // -------------------------------------------------------------------------

  private async findIssue(issueId: string): Promise<Issue | null> {
    const issues = await readIssuesJsonl(this.jsonlPath);
    return issues.find((i) => i.id === issueId) ?? null;
  }

  /** Atomically update multiple fields on an issue in a single read-modify-write */
  private async updateIssueFields(
    issueId: string,
    fields: {
      status?: IssueStatus;
      execution?: Partial<IssueExecution>;
    },
  ): Promise<void> {
    await withIssueWriteLock(async () => {
      const issues = await readIssuesJsonl(this.jsonlPath);
      const idx = issues.findIndex((i) => i.id === issueId);
      if (idx === -1) return;

      const issue = issues[idx];

      if (fields.status !== undefined) {
        issue.status = fields.status;
      }

      if (fields.execution !== undefined) {
        issue.execution = {
          status: 'idle',
          retryCount: 0,
          ...issue.execution,
          ...fields.execution,
        };
      }

      issue.updated_at = new Date().toISOString();
      issues[idx] = issue;

      await writeIssuesJsonl(this.jsonlPath, issues);
    });
  }

  private emitStatus(): void {
    this.eventBus.emit('supervisor:status', this.getStatus());
  }
}
