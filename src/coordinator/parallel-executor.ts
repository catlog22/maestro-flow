// ---------------------------------------------------------------------------
// Parallel Executor — Bridge between GraphWalker fork/join and ParallelCliRunner.
// Wraps ParallelCliRunner.runAll() behind a GraphWalker-friendly interface.
// ---------------------------------------------------------------------------

import type { AgentType } from './graph-types.js';
import type { ParallelCliRunner } from '../agents/parallel-cli-runner.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BranchTask {
  branchId: string;
  nodeId: string;
  prompt: string;
  workDir: string;
  agentType: AgentType;
}

export interface BranchResult {
  branchId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export interface ParallelCommandExecutor {
  executeBranches(
    branches: BranchTask[],
    joinStrategy: 'all' | 'any' | 'majority',
    signal?: AbortSignal,
  ): Promise<BranchResult[]>;
}

// ---------------------------------------------------------------------------
// AgentType -> tool name mapping (reverse of parallel-cli-runner)
// ---------------------------------------------------------------------------

const AGENT_TYPE_TO_TOOL: Record<string, string> = {
  gemini: 'gemini',
  qwen: 'qwen',
  codex: 'codex',
  'claude-code': 'claude',
  opencode: 'opencode',
  pi: 'pi',
  grok: 'grok',
};

// ---------------------------------------------------------------------------
// DefaultParallelExecutor
// ---------------------------------------------------------------------------

export class DefaultParallelExecutor implements ParallelCommandExecutor {
  constructor(private readonly runner: ParallelCliRunner) {}

  async executeBranches(
    branches: BranchTask[],
    joinStrategy: 'all' | 'any' | 'majority',
    signal?: AbortSignal,
  ): Promise<BranchResult[]> {
    const tasks = branches.map((b) => ({
      id: b.branchId,
      prompt: b.prompt,
      tool: AGENT_TYPE_TO_TOOL[b.agentType] ?? 'gemini',
      workDir: b.workDir,
      mode: 'write' as const,
    }));

    const { results } = await this.runner.runAll(tasks, {
      joinStrategy,
      signal,
    });

    return results.map((r) => ({
      branchId: r.id,
      success: r.success,
      output: r.output,
      durationMs: r.durationMs,
    }));
  }
}
