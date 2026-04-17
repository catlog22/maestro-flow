// ---------------------------------------------------------------------------
// WaveExecutor — CSV-wave-inspired parallel execution using Agent SDK
// ---------------------------------------------------------------------------
// Decomposes an issue into subtasks, groups into dependency-ordered waves,
// and executes each wave's tasks in parallel using Agent SDK queries.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

import type { Issue } from '../../shared/issue-types.js';
import type { NormalizedEntry } from '../../shared/agent-types.js';
import type { WaveTask, WaveSession, DecompositionResult } from '../../shared/wave-types.js';
import type { WaveStartedEvent, WaveTaskCompletedEvent } from '../../shared/journal-types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ExecutionScheduler } from './execution-scheduler.js';
import type { ExecutionJournal } from './execution-journal.js';
import { EntryNormalizer } from '../agents/entry-normalizer.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { loadDashboardAgentSettings, type SavedAgentSettings } from '../config.js';
import { createIssueMcpServer } from '../agents/tools/issue-mcp-server.js';
import { DecomposePromptBuilder } from '../prompt/builders/decompose-builder.js';
import type { SchedulerConfig } from '../../shared/execution-types.js';

// Shared decompose builder instance (stateless)
const decomposeBuilder = new DecomposePromptBuilder();

// ---------------------------------------------------------------------------
// Task execution prompt
// ---------------------------------------------------------------------------

function buildTaskPrompt(task: WaveTask, issue: Issue, prevContext: string): string {
  const lines = [
    `You are executing a subtask of issue "${issue.title}".`,
    '',
    `## Your Task`,
    `**ID**: ${task.id}`,
    `**Title**: ${task.title}`,
    '',
    task.description,
  ];

  if (prevContext) {
    lines.push(
      '',
      '## Context from Completed Tasks',
      prevContext,
    );
  }

  lines.push(
    '',
    '## Guidelines',
    '- Focus only on this specific subtask',
    '- Follow existing code patterns and conventions',
    '- Make atomic, focused changes',
    '- Provide a brief summary of what you changed when done',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Topological sort: assign wave numbers
// ---------------------------------------------------------------------------

function assignWaves(tasks: WaveTask[]): number {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, task.deps.length);
    for (const dep of task.deps) {
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  // BFS (Kahn's algorithm) with wave grouping
  let wave = 0;
  let current = tasks.filter((t) => t.deps.length === 0).map((t) => t.id);

  while (current.length > 0) {
    for (const id of current) {
      const task = taskMap.get(id);
      if (task) task.wave = wave;
    }

    const next: string[] = [];
    for (const id of current) {
      for (const depId of dependents.get(id) ?? []) {
        const deg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, deg);
        if (deg === 0) next.push(depId);
      }
    }

    wave++;
    current = next;
  }

  return wave; // total number of waves
}

// ---------------------------------------------------------------------------
// WaveExecutor
// ---------------------------------------------------------------------------

export class WaveExecutor {
  private readonly sessions = new Map<string, WaveSession>();
  private readonly abortControllers = new Map<string, AbortController>();
  private issueMcpServer: McpSdkServerConfigWithInstance | null = null;
  private issueMcpServerPromise: Promise<McpSdkServerConfigWithInstance>;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly agentManager: AgentManager,
    private readonly workDir: string,
    private readonly executionScheduler?: ExecutionScheduler,
    private readonly journal?: ExecutionJournal,
  ) {
    this.issueMcpServerPromise = createIssueMcpServer(workDir);
  }

  private async getIssueMcpServer(): Promise<McpSdkServerConfigWithInstance> {
    if (!this.issueMcpServer) {
      this.issueMcpServer = await this.issueMcpServerPromise;
    }
    return this.issueMcpServer;
  }

  /**
   * Execute an issue using wave-based decomposition and parallel execution.
   * Returns a processId that can be used to track progress in the chat UI.
   */
  async execute(issue: Issue): Promise<string> {
    const processId = randomUUID();
    const abortController = new AbortController();
    this.abortControllers.set(processId, abortController);

    const session: WaveSession = {
      issueId: issue.id,
      processId,
      status: 'decomposing',
      tasks: [],
      totalWaves: 0,
      currentWave: 0,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(processId, session);

    // Register the virtual process with AgentManager so it appears in
    // listProcesses() and entries are buffered for late-joining clients.
    const agentProcess = {
      id: processId,
      type: 'agent-sdk' as const,
      status: 'running' as const,
      config: {
        type: 'agent-sdk' as const,
        prompt: `[Wave Execute] ${issue.title}`,
        workDir: this.workDir,
      },
      startedAt: session.startedAt,
      interactive: false,
    };
    this.agentManager.registerCliProcess(agentProcess);
    this.eventBus.emit('agent:spawned', agentProcess);

    // Emit user message entry
    this.emitEntry(processId, EntryNormalizer.userMessage(
      processId,
      `Wave Execute: ${issue.title}\n\n${issue.description}`,
    ));

    // Fire-and-forget — errors are handled inside
    this.runWaveExecution(processId, issue, abortController)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emitEntry(processId, EntryNormalizer.error(processId, message, 'wave_error'));
        this.emitEntry(processId, EntryNormalizer.statusChange(processId, 'error', message));
        this.agentManager.updateCliProcessStatus(processId, 'error');
        session.status = 'failed';
      })
      .finally(() => {
        this.abortControllers.delete(processId);
      });

    return processId;
  }

  /** Stop a running wave execution */
  stop(processId: string): void {
    const controller = this.abortControllers.get(processId);
    if (controller) {
      controller.abort();
    }
    const session = this.sessions.get(processId);
    if (session) {
      session.status = 'failed';
    }
  }

  /** Get session state */
  getSession(processId: string): WaveSession | undefined {
    return this.sessions.get(processId);
  }

  /** Load saved agent-sdk settings and build env overrides */
  private async loadSettings(): Promise<{ settings: SavedAgentSettings | undefined; settingsFile: string | undefined; env: Record<string, string> | undefined }> {
    // workDir points to project root; .workflow is a sibling
    const workflowRoot = join(this.workDir, '.workflow');
    const settings = await loadDashboardAgentSettings(workflowRoot, 'agent-sdk');
    const settingsFile = settings?.settingsFile || undefined;
    let env: Record<string, string> | undefined;
    if (!settingsFile && (settings?.baseUrl || settings?.apiKey)) {
      env = {};
      if (settings.baseUrl) env['ANTHROPIC_BASE_URL'] = settings.baseUrl;
      if (settings.apiKey) env['ANTHROPIC_API_KEY'] = settings.apiKey;
    }
    return { settings, settingsFile, env };
  }

  // -------------------------------------------------------------------------
  // Private: Main execution flow
  // -------------------------------------------------------------------------

  private async runWaveExecution(
    processId: string,
    issue: Issue,
    abortController: AbortController,
  ): Promise<void> {
    const session = this.sessions.get(processId)!;

    // Load settings once for the entire execution
    const { settings, settingsFile, env } = await this.loadSettings();

    // --- Resume check: see if journal has an existing wave session ---
    let completedTaskIds = new Set<string>();
    let resumedDecomposition: DecompositionResult | null = null;

    if (this.journal) {
      try {
        const events = await this.journal.getEventsForIssue(issue.id);
        const waveStarted = events.find((e) => e.type === 'wave:started') as WaveStartedEvent | undefined;
        if (waveStarted && waveStarted.decomposition) {
          resumedDecomposition = waveStarted.decomposition as DecompositionResult;
          completedTaskIds = new Set(
            events
              .filter((e): e is WaveTaskCompletedEvent => e.type === 'wave:task_completed')
              .map((e) => e.taskId),
          );
          if (completedTaskIds.size > 0) {
            this.emitEntry(processId, EntryNormalizer.assistantMessage(
              processId,
              `Resuming wave execution: ${completedTaskIds.size} task(s) already completed.`,
              false,
            ));
          }
        }
      } catch {
        // Journal read failed — fall back to full execution
        resumedDecomposition = null;
        completedTaskIds = new Set();
      }
    }

    // --- Phase 1: Decompose (or reuse from journal) ---
    let decomposition: DecompositionResult | null;

    if (resumedDecomposition) {
      decomposition = resumedDecomposition;
    } else {
      this.emitEntry(processId, EntryNormalizer.assistantMessage(
        processId,
        '### Phase 1: Decomposing issue into subtasks...',
        false,
      ));

      decomposition = await this.decompose(processId, issue, abortController, settings, settingsFile, env);
      if (!decomposition || abortController.signal.aborted) return;
    }

    // Build WaveTask array — mark already-completed tasks
    session.tasks = decomposition.tasks.map((t) => ({
      ...t,
      wave: 0,
      status: (completedTaskIds.has(t.id) ? 'completed' : 'pending') as WaveTask['status'],
    }));

    // Assign waves via topological sort
    session.totalWaves = assignWaves(session.tasks);

    // Emit decomposition summary
    const taskSummary = session.tasks
      .map((t) => `- **${t.id}** (wave ${t.wave}): ${t.title}${t.status === 'completed' ? ' [resumed]' : ''}`)
      .join('\n');
    this.emitEntry(processId, EntryNormalizer.assistantMessage(
      processId,
      `Decomposed into **${session.tasks.length} tasks** across **${session.totalWaves} waves**:\n\n${taskSummary}`,
      false,
    ));

    // Journal: record wave:started event (only for fresh executions)
    if (!resumedDecomposition) {
      await this.journal?.append({
        type: 'wave:started',
        issueId: issue.id,
        sessionId: processId,
        taskCount: session.tasks.length,
        decomposition,
        timestamp: new Date().toISOString(),
      });
    }

    // --- Phase 2+: Execute waves ---
    session.status = 'executing';

    for (let wave = 0; wave < session.totalWaves; wave++) {
      if (abortController.signal.aborted) break;

      session.currentWave = wave;
      const waveTasks = session.tasks.filter((t) => t.wave === wave);
      const pendingTasks = waveTasks.filter((t) => t.status === 'pending');

      if (pendingTasks.length === 0) {
        this.emitEntry(processId, EntryNormalizer.assistantMessage(
          processId,
          `\n### Wave ${wave + 1}/${session.totalWaves}: All ${waveTasks.length} task(s) already completed (resumed).`,
          false,
        ));
        continue;
      }

      this.emitEntry(processId, EntryNormalizer.assistantMessage(
        processId,
        `\n### Wave ${wave + 1}/${session.totalWaves}: Executing ${pendingTasks.length} task(s) in parallel...`,
        false,
      ));

      // Execute pending tasks in this wave concurrently
      await Promise.allSettled(
        pendingTasks.map((task) =>
          this.executeTask(processId, task, issue, session.tasks, abortController, settings, settingsFile, env),
        ),
      );

      // Report wave results
      const completed = waveTasks.filter((t) => t.status === 'completed').length;
      const failed = waveTasks.filter((t) => t.status === 'failed').length;
      this.emitEntry(processId, EntryNormalizer.assistantMessage(
        processId,
        `Wave ${wave + 1} complete: ${completed} succeeded, ${failed} failed.`,
        false,
      ));
    }

    // --- Aggregation ---
    const allCompleted = session.tasks.every((t) => t.status === 'completed');
    session.status = allCompleted ? 'completed' : 'failed';
    session.completedAt = new Date().toISOString();

    // Final summary
    const summaryLines = session.tasks.map((t) => {
      const icon = t.status === 'completed' ? '✓' : '✕';
      const detail = t.findings ? `: ${t.findings.slice(0, 120)}` : '';
      return `${icon} **${t.id}** ${t.title}${detail}`;
    });

    this.emitEntry(processId, EntryNormalizer.assistantMessage(
      processId,
      `\n### Execution Summary\n\n${summaryLines.join('\n')}`,
      false,
    ));

    this.emitEntry(processId, EntryNormalizer.statusChange(
      processId,
      'stopped',
      allCompleted ? 'Wave execution completed successfully' : 'Wave execution completed with failures',
    ));

    this.agentManager.updateCliProcessStatus(processId, 'stopped');
    this.eventBus.emit('agent:stopped', { processId });
  }

  // -------------------------------------------------------------------------
  // Private: Decompose issue into tasks
  // -------------------------------------------------------------------------

  private async decompose(
    processId: string,
    issue: Issue,
    abortController: AbortController,
    settings: SavedAgentSettings | undefined,
    settingsFile: string | undefined,
    env: Record<string, string> | undefined,
  ): Promise<DecompositionResult | null> {
    const promptResult = await decomposeBuilder.build({
      issue,
      config: {} as SchedulerConfig,
      promptMode: 'decompose',
    });
    const prompt = promptResult.userPrompt;
    let resultText = '';
    let structuredResult: DecompositionResult | null = null;

    this.emitEntry(processId, EntryNormalizer.toolUse(
      processId, 'AgentSDK:decompose', { issueId: issue.id }, 'running',
    ));

    // Build query options — use settings file path when available
    const queryOptions: Record<string, unknown> = {
      abortController,
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'dontAsk',
      cwd: this.workDir,
      maxTurns: 6,
      persistSession: false,
      mcpServers: { 'issue-monitor': await this.getIssueMcpServer() },
    };

    if (settingsFile) {
      queryOptions.settings = settingsFile;
    } else {
      queryOptions.model = settings?.model || 'sonnet';
      if (env) queryOptions.env = { ...process.env, ...env };
    }

    try {
      for await (const message of query({
        prompt,
        options: queryOptions as import('@anthropic-ai/claude-agent-sdk').Options,
      })) {
        const msg = message as Record<string, unknown>;
        if (msg.type === 'result' && msg.subtype === 'success') {
          const success = message as unknown as SDKResultSuccess;
          // Prefer structured_output (parsed JSON) over raw result string
          if (success.structured_output) {
            structuredResult = success.structured_output as DecompositionResult;
          }
          resultText = success.result;
        }
      }
    } catch (err) {
      if (abortController.signal.aborted) return null;
      throw err;
    }

    // Parse result: prefer structured_output, then extract JSON from text via regex
    let result = structuredResult;
    if (!result && resultText) {
      const jsonMatch = resultText.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]) as DecompositionResult;
      }
    }
    if (!result || !result.tasks || result.tasks.length === 0) {
      throw new Error('Decomposition returned no valid tasks');
    }

    this.emitEntry(processId, EntryNormalizer.toolUse(
      processId, 'AgentSDK:decompose', { issueId: issue.id }, 'completed',
      `Decomposed into ${result.tasks.length} tasks`,
    ));

    return result;
  }

  // -------------------------------------------------------------------------
  // Private: Execute a single task within a wave
  // -------------------------------------------------------------------------

  private async executeTask(
    processId: string,
    task: WaveTask,
    issue: Issue,
    allTasks: WaveTask[],
    abortController: AbortController,
    settings: SavedAgentSettings | undefined,
    settingsFile: string | undefined,
    env: Record<string, string> | undefined,
  ): Promise<void> {
    if (abortController.signal.aborted) return;

    // Generate a unique processId for this subtask's slot
    const taskProcessId = `wave-${processId}-task-${task.id}`;

    // Acquire a scheduler slot before executing (if scheduler is available)
    if (this.executionScheduler) {
      const acquired = await this.executionScheduler.waitForSlot(
        issue.id, taskProcessId, 'agent-sdk', 60000,
      );
      if (!acquired) {
        task.status = 'failed';
        task.error = 'Slot acquisition timed out';
        this.emitEntry(processId, EntryNormalizer.toolUse(
          processId, `Task:${task.id}`, { title: task.title, error: task.error }, 'failed', task.error,
        ));
        return;
      }
    }

    try {
      task.status = 'running';

      // Build prev_context from completed contextFrom tasks
      const prevContext = task.contextFrom
        .map((id) => allTasks.find((t) => t.id === id))
        .filter((t): t is WaveTask => t != null && t.status === 'completed' && !!t.findings)
        .map((t) => `**${t.id} (${t.title})**: ${t.findings}`)
        .join('\n\n');

      const taskPrompt = buildTaskPrompt(task, issue, prevContext);

      this.emitEntry(processId, EntryNormalizer.toolUse(
        processId, `Task:${task.id}`, { title: task.title }, 'running',
      ));

      let resultText = '';

      // Build query options — use settings file path when available
      const taskOptions: Record<string, unknown> = {
        abortController,
        cwd: this.workDir,
        maxTurns: 10,
        persistSession: false,
        mcpServers: { 'issue-monitor': await this.getIssueMcpServer() },
      };

      if (settingsFile) {
        taskOptions.settings = settingsFile;
        taskOptions.permissionMode = 'dontAsk';
      } else {
        taskOptions.permissionMode = 'bypassPermissions';
        taskOptions.allowDangerouslySkipPermissions = true;
        taskOptions.model = settings?.model || 'sonnet';
        if (env) taskOptions.env = { ...process.env, ...env };
      }

      try {
        for await (const message of query({
          prompt: taskPrompt,
          options: taskOptions as import('@anthropic-ai/claude-agent-sdk').Options,
        })) {
          const msg = message as Record<string, unknown>;
          if (msg.type === 'result' && msg.subtype === 'success') {
            resultText = (message as unknown as SDKResultSuccess).result;
          }
        }

        task.status = 'completed';
        task.findings = resultText.slice(0, 1000);

        this.emitEntry(processId, EntryNormalizer.toolUse(
          processId, `Task:${task.id}`, { title: task.title }, 'completed',
          task.findings.slice(0, 200),
        ));

        // Journal: record wave:task_completed event
        await this.journal?.append({
          type: 'wave:task_completed',
          issueId: issue.id,
          sessionId: processId,
          taskId: task.id,
          waveIndex: task.wave,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        if (abortController.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        task.status = 'failed';
        task.error = message;

        this.emitEntry(processId, EntryNormalizer.toolUse(
          processId, `Task:${task.id}`, { title: task.title, error: message }, 'failed', message,
        ));
      }
    } finally {
      // Always release the slot, even on failure or abort
      this.executionScheduler?.releaseSlot(taskProcessId);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Entry emission helper
  // -------------------------------------------------------------------------

  private emitEntry(processId: string, entry: NormalizedEntry): void {
    this.agentManager.addCliEntry(processId, entry);
    this.eventBus.emit('agent:entry', entry);
  }
}
