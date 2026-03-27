// ---------------------------------------------------------------------------
// CLI Executor — CommandExecutor implementation for the Graph Coordinator.
// Delegates process spawning to an injected SpawnFn, keeping this module
// decoupled from adapter implementations (dashboard package boundary).
// ---------------------------------------------------------------------------

import type {
  AgentType,
  CommandExecutor,
  ExecuteRequest,
  ExecuteResult,
} from './graph-types.js';

// ---------------------------------------------------------------------------
// SpawnFn — injected delegate for agent process lifecycle
// ---------------------------------------------------------------------------

export type SpawnFn = (config: {
  type: AgentType;
  prompt: string;
  workDir: string;
  approvalMode: 'suggest' | 'auto';
  model?: string;
}) => Promise<{
  output: string;
  success: boolean;
  execId: string;
  durationMs: number;
}>;

// ---------------------------------------------------------------------------
// CliExecutor
// ---------------------------------------------------------------------------

export class CliExecutor implements CommandExecutor {
  private abortController: AbortController | null = null;

  constructor(private readonly spawn: SpawnFn) {}

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    this.abortController = new AbortController();
    const startTime = Date.now();

    try {
      const result = await this.spawn({
        type: request.agent_type,
        prompt: request.prompt,
        workDir: request.work_dir,
        approvalMode: request.approval_mode,
      });

      return {
        success: result.success,
        raw_output: result.output,
        exec_id: result.execId,
        duration_ms: result.durationMs,
      };
    } catch (err: unknown) {
      return {
        success: false,
        raw_output: err instanceof Error ? err.message : String(err),
        exec_id: '',
        duration_ms: Date.now() - startTime,
      };
    } finally {
      this.abortController = null;
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
  }
}
