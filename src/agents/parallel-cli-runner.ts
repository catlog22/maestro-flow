// ---------------------------------------------------------------------------
// Parallel CLI Runner — Async multi-CLI scheduler with semaphore concurrency.
// Standalone scheduler with SpawnFn injection, decoupled from GraphWalker.
//
// Concurrency model (from Bridge's PerSessionWorkerPool):
// - Tasks with same sessionKey (tool+workDir) run serially
// - Tasks with different sessionKeys run in parallel
// - Global maxConcurrency limits total parallel processes
// ---------------------------------------------------------------------------

import type { SpawnFn } from '../coordinator/cli-executor.js';
import type { AgentType } from '../coordinator/graph-types.js';
import type { TerminalBackend } from './terminal-backend.js';

// ---------------------------------------------------------------------------
// Tool name -> AgentType mapping (mirrors cli-agent-runner.ts)
// ---------------------------------------------------------------------------

const TOOL_TO_AGENT_TYPE: Record<string, AgentType> = {
  gemini: 'gemini',
  qwen: 'qwen',
  codex: 'codex',
  claude: 'claude-code',
  opencode: 'opencode',
  pi: 'pi',
  grok: 'grok',
};

const TOOL_TO_TERMINAL_CMD: Record<string, string> = {
  gemini: 'gemini',
  qwen: 'qwen',
  codex: 'codex',
  claude: 'claude',
  opencode: 'opencode',
  pi: 'pi',
  grok: 'grok',
};

// ---------------------------------------------------------------------------
// Task & Result types
// ---------------------------------------------------------------------------

export interface ParallelTask {
  id: string;
  prompt: string;
  tool: string;
  workDir: string;
  mode: 'analysis' | 'write';
  backend?: 'direct' | 'terminal';
  sessionKey?: string;
}

export interface ParallelResult {
  id: string;
  success: boolean;
  output: string;
  execId: string;
  durationMs: number;
}

export interface RunAllOptions {
  maxConcurrency?: number;
  joinStrategy: 'all' | 'any' | 'majority';
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Semaphore — simple counter-based concurrency limiter
// ---------------------------------------------------------------------------

class Semaphore {
  private current = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Default per-task timeout (10 min ceiling)
// ---------------------------------------------------------------------------

const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// ParallelCliRunner
// ---------------------------------------------------------------------------

export class ParallelCliRunner {
  constructor(
    private readonly spawn: SpawnFn,
    private readonly terminalBackend?: TerminalBackend,
  ) {}

  /**
   * Execute tasks in parallel with session-key grouping and join strategy.
   *
   * Tasks sharing the same sessionKey (defaults to tool+workDir) execute
   * serially within their group. Different groups run in parallel, limited
   * by maxConcurrency.
   */
  async runAll(
    tasks: ParallelTask[],
    options: RunAllOptions,
  ): Promise<{ results: ParallelResult[]; success: boolean }> {
    const {
      maxConcurrency = 4,
      joinStrategy,
      signal: globalSignal,
    } = options;

    if (tasks.length === 0) {
      return { results: [], success: true };
    }

    // Group by session key
    const groups = this.groupBySession(tasks);

    const semaphore = new Semaphore(maxConcurrency);
    const results: ParallelResult[] = [];

    // For 'any' strategy, wrap global signal so we can abort remaining
    // groups once the first group completes.
    const effectiveAbort = joinStrategy === 'any'
      ? new AbortController()
      : undefined;

    if (effectiveAbort && globalSignal) {
      globalSignal.addEventListener(
        'abort', () => effectiveAbort.abort(), { once: true },
      );
    }

    const effectiveSignal = effectiveAbort?.signal ?? globalSignal;

    // Create per-group serial chains, run groups in parallel
    const groupPromises = [...groups.values()].map((queue) =>
      this.runSessionGroup(queue, semaphore, results, effectiveSignal),
    );

    if (joinStrategy === 'any') {
      // First group to finish triggers abort of the rest
      await Promise.race(groupPromises);
      effectiveAbort!.abort();
      await Promise.allSettled(groupPromises);
    } else {
      // 'all' and 'majority' both wait for all groups to settle
      await Promise.allSettled(groupPromises);
    }

    const success = this.evaluateJoin(results, tasks.length, joinStrategy);
    return { results, success };
  }

  // -------------------------------------------------------------------------
  // Session grouping
  // -------------------------------------------------------------------------

  private groupBySession(tasks: ParallelTask[]): Map<string, ParallelTask[]> {
    const groups = new Map<string, ParallelTask[]>();
    for (const task of tasks) {
      const key = task.sessionKey ?? `${task.tool}:${task.workDir}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }
    return groups;
  }

  // -------------------------------------------------------------------------
  // Serial execution within a session group
  // -------------------------------------------------------------------------

  private async runSessionGroup(
    queue: ParallelTask[],
    semaphore: Semaphore,
    results: ParallelResult[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (const task of queue) {
      if (signal?.aborted) break;

      await semaphore.acquire();
      if (signal?.aborted) {
        semaphore.release();
        break;
      }

      try {
        const result = await this.executeTask(task, signal);
        results.push(result);
      } finally {
        semaphore.release();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Single task execution — routes to SpawnFn or TerminalAdapter
  // -------------------------------------------------------------------------

  private async executeTask(
    task: ParallelTask,
    globalSignal?: AbortSignal,
  ): Promise<ParallelResult> {
    if (task.backend === 'terminal' && this.terminalBackend) {
      return this.executeViaTerminal(task, globalSignal);
    }
    return this.executeViaSpawn(task, globalSignal);
  }

  // -------------------------------------------------------------------------
  // Execution via SpawnFn (direct adapter — default)
  // -------------------------------------------------------------------------

  private async executeViaSpawn(
    task: ParallelTask,
    globalSignal?: AbortSignal,
  ): Promise<ParallelResult> {
    const startTime = Date.now();
    const agentType = TOOL_TO_AGENT_TYPE[task.tool];

    if (!agentType) {
      return {
        id: task.id,
        success: false,
        output: `Unknown tool: ${task.tool}`,
        execId: '',
        durationMs: Date.now() - startTime,
      };
    }

    // Per-task abort: merges global signal + timeout ceiling
    const taskAbort = new AbortController();
    const timeout = setTimeout(() => taskAbort.abort(), DEFAULT_TASK_TIMEOUT_MS);

    const onGlobalAbort = () => taskAbort.abort();
    globalSignal?.addEventListener('abort', onGlobalAbort, { once: true });

    try {
      const result = await this.spawn({
        type: agentType,
        prompt: task.prompt,
        workDir: task.workDir,
        approvalMode: task.mode === 'write' ? 'auto' : 'suggest',
        signal: taskAbort.signal,
      });

      return {
        id: task.id,
        success: result.success,
        output: result.output,
        execId: result.execId,
        durationMs: result.durationMs,
      };
    } catch (err: unknown) {
      return {
        id: task.id,
        success: false,
        output: err instanceof Error ? err.message : String(err),
        execId: '',
        durationMs: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeout);
      globalSignal?.removeEventListener('abort', onGlobalAbort);
    }
  }

  // -------------------------------------------------------------------------
  // Execution via TerminalAdapter (tmux/wezterm pane)
  // -------------------------------------------------------------------------

  private async executeViaTerminal(
    task: ParallelTask,
    globalSignal?: AbortSignal,
  ): Promise<ParallelResult> {
    const startTime = Date.now();
    const agentType = TOOL_TO_AGENT_TYPE[task.tool];

    if (!agentType) {
      return {
        id: task.id, success: false,
        output: `Unknown tool: ${task.tool}`, execId: '', durationMs: 0,
      };
    }

    const { TerminalAdapter } = await import('./terminal-adapter.js');
    const cmd = TOOL_TO_TERMINAL_CMD[task.tool] ?? task.tool;
    const adapter = new TerminalAdapter(this.terminalBackend!, cmd);

    // Cast needed: graph-types AgentType includes 'claude', terminal-adapter's is narrower
    const proc = await adapter.spawn({
      type: agentType as string,
      prompt: task.prompt,
      workDir: task.workDir,
      approvalMode: task.mode === 'write' ? 'auto' : 'suggest',
    } as Parameters<typeof adapter.spawn>[0]);

    return new Promise<ParallelResult>((resolve) => {
      let output = '';
      let settled = false;

      const settle = (success: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        globalSignal?.removeEventListener('abort', onAbort);
        unsub();
        resolve({
          id: task.id, success, output,
          execId: proc.id, durationMs: Date.now() - startTime,
        });
      };

      const timeout = setTimeout(() => {
        adapter.stop(proc.id);
        settle(false);
      }, DEFAULT_TASK_TIMEOUT_MS);

      const onAbort = () => {
        adapter.stop(proc.id);
        settle(false);
      };
      globalSignal?.addEventListener('abort', onAbort, { once: true });

      const unsub = adapter.onEntry(proc.id, (entry) => {
        if (entry.type === 'assistant_message') {
          output += entry.content;
        }
        if (entry.type === 'status_change') {
          if (entry.status === 'stopped') settle(true);
          else if (entry.status === 'error') settle(false);
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // Join strategy evaluation
  // -------------------------------------------------------------------------

  private evaluateJoin(
    results: ParallelResult[],
    totalTasks: number,
    strategy: 'all' | 'any' | 'majority',
  ): boolean {
    const successCount = results.filter((r) => r.success).length;

    switch (strategy) {
      case 'all':
        return successCount === totalTasks;
      case 'any':
        return successCount >= 1;
      case 'majority':
        return successCount > totalTasks / 2;
    }
  }
}
