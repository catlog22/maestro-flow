// ---------------------------------------------------------------------------
// OpenCodeAdapter — spawns OpenCode CLI with NDJSON protocol
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  AgentConfig,
  AgentProcess,
  ApprovalDecision,
} from '../../shared/agent-types.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { loadEnvFile } from './env-file-loader.js';
import { StreamMonitor } from './stream-monitor.js';
import { cleanSpawnEnv } from './env-cleanup.js';

// ---------------------------------------------------------------------------
// OpenCode NDJSON message shapes
// ---------------------------------------------------------------------------

interface OpenCodeStepStart {
  type: 'step_start';
  step?: string;
}

interface OpenCodeText {
  type: 'text';
  content: string;
}

interface OpenCodeToolUse {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

interface OpenCodeStepFinish {
  type: 'step_finish';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  duration_ms?: number;
}

type OpenCodeMessage =
  | OpenCodeStepStart
  | OpenCodeText
  | OpenCodeToolUse
  | OpenCodeStepFinish;

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly agentType = 'opencode' as const;

  private readonly childProcesses = new Map<string, ChildProcess>();
  private readonly readlineInterfaces = new Map<string, ReadlineInterface>();
  private readonly streamMonitors = new Map<string, StreamMonitor>();

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const args = ['run', '--format', 'json'];

    // Optional model flag
    if (config.model) {
      args.push('--model', config.model);
    }

    // Prompt is a positional argument (last)
    args.push(config.prompt);

    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) envOverrides.OPENAI_API_KEY = config.apiKey;
    const childEnv = cleanSpawnEnv(envOverrides);

    const child = spawn('opencode', args, {
      cwd: config.workDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    if (!child.stdout || !child.stderr) {
      throw new Error('Failed to spawn OpenCode: stdio streams not available');
    }

    // Heartbeat monitor: detect stale streams (60s silence)
    const monitor = new StreamMonitor(() => {
      this.emitEntry(
        processId,
        EntryNormalizer.error(processId, 'Stream stale: no output for 60s', 'stream_stale'),
      );
    });
    this.streamMonitors.set(processId, monitor);

    // Line-by-line parsing of NDJSON stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      monitor.heartbeat();
      this.parseOpenCodeMessage(line, processId);
    });

    // Stderr => error entries
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length > 0) {
        this.emitEntry(processId, EntryNormalizer.error(processId, text, 'stderr'));
      }
    });

    // Process exit handling
    this.setupProcessListeners(child, processId);

    // Store references
    this.childProcesses.set(processId, child);
    this.readlineInterfaces.set(processId, rl);

    return {
      id: processId,
      type: 'opencode',
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      pid: child.pid,
    };
  }

  protected async doStop(processId: string): Promise<void> {
    const child = this.childProcesses.get(processId);
    if (!child) {
      return;
    }

    // Update status to stopping
    const proc = this.getProcess(processId);
    if (proc) {
      proc.status = 'stopping';
      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'stopping', 'User requested stop'),
      );
    }

    // Graceful SIGTERM
    child.kill('SIGTERM');

    // SIGKILL fallback after 5 seconds
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(killTimer);
    });

    this.cleanup(processId);
  }

  protected async doSendMessage(
    _processId: string,
    _content: string,
  ): Promise<void> {
    throw new Error('OpenCode does not support interactive messages');
  }

  protected async doRespondApproval(_decision: ApprovalDecision): Promise<void> {
    // No-op: OpenCode does not have an approval workflow
  }

  // --- NDJSON parsing ------------------------------------------------------

  private parseOpenCodeMessage(line: string, processId: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let msg: OpenCodeMessage;
    try {
      msg = JSON.parse(trimmed) as OpenCodeMessage;
    } catch {
      // Non-JSON lines are silently skipped
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      return;
    }

    switch (msg.type) {
      case 'step_start': {
        const reason = msg.step ?? 'Step started';
        this.emitEntry(
          processId,
          EntryNormalizer.statusChange(processId, 'running', reason),
        );
        break;
      }

      case 'text': {
        const content = msg.content ?? '';
        if (content.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, content, false),
          );
        }
        break;
      }

      case 'tool_use': {
        const name = msg.name ?? 'unknown';
        const input = msg.input ?? {};
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(processId, name, input, 'running'),
        );
        break;
      }

      case 'step_finish': {
        if (msg.usage) {
          this.emitEntry(
            processId,
            EntryNormalizer.tokenUsage(
              processId,
              msg.usage.input_tokens ?? 0,
              msg.usage.output_tokens ?? 0,
            ),
          );
        }
        break;
      }

      default:
        // Unknown message types are silently ignored
        break;
    }
  }

  // --- Helpers -------------------------------------------------------------

  private setupProcessListeners(child: ChildProcess, processId: string): void {
    child.on('exit', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Terminated by signal: ${signal}`
        : `Exited with code: ${code ?? 'unknown'}`;

      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'stopped', reason),
      );

      const proc = this.getProcess(processId);
      if (proc) {
        proc.status = 'stopped';
      }

      this.cleanup(processId);
      this.removeProcess(processId);
    });

    child.on('error', (err: Error) => {
      this.emitEntry(
        processId,
        EntryNormalizer.error(processId, err.message, 'spawn_error'),
      );

      const proc = this.getProcess(processId);
      if (proc) {
        proc.status = 'error';
      }
    });
  }

  private cleanup(processId: string): void {
    const rl = this.readlineInterfaces.get(processId);
    if (rl) {
      rl.close();
      this.readlineInterfaces.delete(processId);
    }
    const monitor = this.streamMonitors.get(processId);
    if (monitor) {
      monitor.dispose();
      this.streamMonitors.delete(processId);
    }
    this.childProcesses.delete(processId);
  }
}
