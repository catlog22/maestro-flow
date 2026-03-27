// ---------------------------------------------------------------------------
// DashboardExecutor — CommandExecutor implementation for the Dashboard.
// Bridges the Graph Coordinator's ExecuteRequest/ExecuteResult interface
// to the Dashboard's AgentManager spawn/stop lifecycle.
// ---------------------------------------------------------------------------

import type { AgentStoppedPayload, NormalizedEntry } from '../../shared/agent-types.js';
import type { SSEEvent } from '../../shared/types.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';

// ---------------------------------------------------------------------------
// Locally-defined interfaces matching graph-types.ts CommandExecutor contract.
// Avoids cross-project import issues until monorepo shared types are set up.
// TODO: Replace with import from '../../../../src/coordinator/graph-types.js'
//       once a shared types package exists.
// ---------------------------------------------------------------------------

type AgentType = 'claude-code' | 'codex' | 'gemini' | 'qwen' | 'opencode';

interface ExecuteRequest {
  prompt: string;
  agent_type: AgentType;
  work_dir: string;
  approval_mode: 'suggest' | 'auto';
  timeout_ms: number;
  node_id: string;
  cmd: string;
}

interface ExecuteResult {
  success: boolean;
  raw_output: string;
  exec_id: string;
  duration_ms: number;
  process_id?: string;
}

interface CommandExecutor {
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  abort(): Promise<void>;
}

// ---------------------------------------------------------------------------
// DashboardExecutor
// ---------------------------------------------------------------------------

export class DashboardExecutor implements CommandExecutor {
  private activeProcessId: string | null = null;

  constructor(
    private readonly agentManager: AgentManager,
    private readonly eventBus: DashboardEventBus,
  ) {}

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const startTime = Date.now();

    try {
      const proc = await this.agentManager.spawn(request.agent_type, {
        type: request.agent_type,
        prompt: request.prompt,
        workDir: request.work_dir,
        approvalMode: request.approval_mode,
      });

      this.activeProcessId = proc.id;

      // Wait for the agent to stop (completed or errored)
      const reason = await this.waitForStopped(proc.id, request.timeout_ms);
      this.activeProcessId = null;

      const output = this.collectOutput(proc.id);
      const durationMs = Date.now() - startTime;

      return {
        success: !reason?.startsWith('error'),
        raw_output: output,
        exec_id: proc.id,
        duration_ms: durationMs,
        process_id: proc.id,
      };
    } catch (err: unknown) {
      this.activeProcessId = null;
      return {
        success: false,
        raw_output: err instanceof Error ? err.message : String(err),
        exec_id: '',
        duration_ms: Date.now() - startTime,
      };
    }
  }

  async abort(): Promise<void> {
    if (!this.activeProcessId) return;
    try {
      await this.agentManager.stop(this.activeProcessId);
    } catch { /* Agent may have already stopped */ }
    this.activeProcessId = null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private waitForStopped(processId: string, timeoutMs: number): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const handler = (event: SSEEvent) => {
        const payload = event.data as AgentStoppedPayload;
        if (payload.processId !== processId) return;
        cleanup();
        resolve(payload.reason);
      };

      const cleanup = () => {
        this.eventBus.off('agent:stopped', handler);
        if (timer) clearTimeout(timer);
      };

      this.eventBus.on('agent:stopped', handler);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  private collectOutput(processId: string): string {
    const entries: NormalizedEntry[] = this.agentManager.getEntries(processId);
    const parts: string[] = [];

    for (const entry of entries) {
      if (entry.type === 'assistant_message') {
        const msg = entry as NormalizedEntry & { content?: string; message?: string };
        parts.push(msg.content ?? msg.message ?? '');
      }
    }

    const joined = parts.join('\n');
    return joined.length > 50_000 ? joined.slice(-50_000) : joined;
  }
}
