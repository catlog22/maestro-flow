// ---------------------------------------------------------------------------
// StreamJsonAdapter — shared adapter for Gemini CLI and Qwen CLI
// Both use the `-o stream-json` output protocol with identical message shapes.
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  AgentType,
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
// Stream-json message shapes (shared by Gemini CLI and Qwen CLI)
// ---------------------------------------------------------------------------

interface StreamJsonInit {
  type: 'init';
}

interface StreamJsonMessage {
  type: 'message';
  content?: string;
  delta?: boolean;
  role?: 'user' | 'assistant';
}

interface StreamJsonToolUse {
  type: 'tool_use';
  name?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  tool_id?: string;
}

interface StreamJsonToolResult {
  type: 'tool_result';
  name?: string;
  tool_id?: string;
  content?: string;
  output?: string;
  is_error?: boolean;
  status?: string;
}

interface StreamJsonResult {
  type: 'result';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

type StreamJsonMsg =
  | StreamJsonInit
  | StreamJsonMessage
  | StreamJsonToolUse
  | StreamJsonToolResult
  | StreamJsonResult;

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class StreamJsonAdapter extends BaseAgentAdapter {
  readonly agentType: AgentType;

  private readonly executable: string;
  private readonly childProcesses = new Map<string, ChildProcess>();
  private readonly readlineInterfaces = new Map<string, ReadlineInterface>();
  private readonly lastCumulativeText = new Map<string, string>();
  private readonly toolIdNames = new Map<string, string>();
  private readonly stoppedEmitted = new Set<string>();
  private readonly streamMonitors = new Map<string, StreamMonitor>();
  private readonly thinkingEmitted = new Set<string>();

  constructor(executable: string, agentType: AgentType) {
    super();
    this.executable = executable;
    this.agentType = agentType;
  }

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const args = this.buildArgs(config);
    const [cmd, ...cmdArgs] = this.executable.split(/\s+/);

    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) {
      if (this.agentType === 'gemini') {
        envOverrides.GEMINI_API_KEY = config.apiKey;
      } else if (this.agentType === 'qwen') {
        envOverrides.DASHSCOPE_API_KEY = config.apiKey;
      }
    }
    const childEnv = cleanSpawnEnv(envOverrides);

    const child = spawn(cmd, [...cmdArgs, ...args], {
      cwd: config.workDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error(
        `Failed to spawn ${this.agentType}: stdio streams not available`,
      );
    }

    // Pipe prompt to stdin then close the write end
    child.stdin.write(config.prompt);
    child.stdin.end();

    // Heartbeat monitor: detect stale streams (60s silence)
    const monitor = new StreamMonitor(() => {
      this.emitEntry(
        processId,
        EntryNormalizer.error(processId, 'Stream stale: no output for 60s', 'stream_stale'),
      );
    });
    this.streamMonitors.set(processId, monitor);

    // Line-by-line parsing of stream-json stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      monitor.heartbeat();
      this.parseStreamJsonMessage(line, processId);
    });

    // Stderr => error entries
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length > 0) {
        this.emitEntry(processId, EntryNormalizer.error(processId, text, 'stderr'));
      }
    });

    // Last-resort fallback: if stdout closes but neither 'exit' nor 'close'
    // fire on the child (Windows shell: true + npx process tree edge case),
    // emit stopped after a short delay to let the primary handlers run first.
    rl.on('close', () => {
      setTimeout(() => {
        this.emitStopped(processId, 'stdout closed (readline fallback)');
      }, 500);
    });

    // Process exit handling
    this.setupProcessListeners(child, processId);

    // Store references
    this.childProcesses.set(processId, child);
    this.readlineInterfaces.set(processId, rl);

    return {
      id: processId,
      type: this.agentType,
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
    processId: string,
    _content: string,
  ): Promise<void> {
    // Gemini/Qwen receive prompt via stdin at spawn time.
    // Follow-up messages are not supported in stream-json mode.
    throw new Error(
      `[${this.agentType}] Follow-up messages are not supported in stream-json mode`,
    );
  }

  protected async doRespondApproval(_decision: ApprovalDecision): Promise<void> {
    // Gemini/Qwen handle approvals via --approval-mode flag, not stdin.
    // No-op.
  }

  // --- Stream-json parsing -------------------------------------------------

  private parseStreamJsonMessage(line: string, processId: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let msg: StreamJsonMsg;
    try {
      msg = JSON.parse(trimmed) as StreamJsonMsg;
    } catch {
      // Non-JSON lines (e.g. npx bootstrap output) are silently skipped
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      return;
    }

    switch (msg.type) {
      case 'init': {
        this.emitEntry(
          processId,
          EntryNormalizer.statusChange(processId, 'running', 'Session started'),
        );
        break;
      }

      case 'message': {
        this.handleMessageEntry(msg, processId);
        break;
      }

      case 'tool_use': {
        const name = msg.tool_name ?? msg.name ?? 'unknown';
        const input = msg.parameters ?? msg.input ?? {};
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(processId, name, input, 'running'),
        );
        // Track tool_id → name mapping for tool_result correlation
        if (msg.tool_id) {
          this.toolIdNames.set(msg.tool_id, name);
        }
        break;
      }

      case 'tool_result': {
        const name = msg.tool_id
          ? (this.toolIdNames.get(msg.tool_id) ?? msg.name ?? 'unknown')
          : (msg.name ?? 'unknown');
        const isError = msg.is_error || (msg.status !== undefined && msg.status !== 'success');
        const status = isError ? 'failed' : 'completed';
        const content = msg.content ?? msg.output;
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(processId, name, {}, status, content),
        );
        // Reset cumulative text tracker so the next assistant message turn
        // starts fresh instead of continuing from the previous turn.
        this.lastCumulativeText.delete(processId);
        break;
      }

      case 'result': {
        const usage = msg.usage ?? msg.stats;
        if (usage) {
          this.emitEntry(
            processId,
            EntryNormalizer.tokenUsage(
              processId,
              usage.input_tokens ?? 0,
              usage.output_tokens ?? 0,
            ),
          );
        }
        break;
      }

      default:
        break;
    }
  }

  private handleMessageEntry(msg: StreamJsonMessage, processId: string): void {
    // Skip user-role messages (echoed input prompt from Gemini CLI)
    if (msg.role === 'user') {
      return;
    }

    let content = msg.content ?? '';

    // Think tag extraction: skip check entirely once already emitted for this process
    if (!this.thinkingEmitted.has(processId) && content.includes('<think>')) {
      if (content.includes('</think>')) {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          const thought = thinkMatch[1].trim();
          if (thought.length > 0) {
            this.emitEntry(processId, EntryNormalizer.thinking(processId, thought));
          }
          this.thinkingEmitted.add(processId);
        }
        content = content.replace(/<think>[\s\S]*?<\/think>/, '').trimStart();
      } else {
        // Incomplete think tag — wait for closing tag in next cumulative chunk
        return;
      }
    }

    if (msg.delta) {
      // Auto-detect cumulative vs incremental delta:
      // If new content starts with the previously seen text, it's cumulative
      // (each message contains all text so far). Otherwise it's an actual
      // incremental delta (each message is only the new portion).
      const lastText = this.lastCumulativeText.get(processId);
      if (lastText !== undefined) {
        // Length pre-check: early bailout when lengths don't match cumulative pattern
        if (content.length >= lastText.length && content.startsWith(lastText)) {
          // Cumulative: extract only the new portion
          const delta = content.slice(lastText.length);
          this.lastCumulativeText.set(processId, content);
          if (delta.length > 0) {
            this.emitEntry(
              processId,
              EntryNormalizer.assistantMessage(processId, delta, true),
            );
          }
        } else {
          // Actual incremental delta (content doesn't start with previous text)
          this.lastCumulativeText.set(processId, content);
          if (content.length > 0) {
            this.emitEntry(
              processId,
              EntryNormalizer.assistantMessage(processId, content, true),
            );
          }
        }
      } else {
        // First message in this turn
        this.lastCumulativeText.set(processId, content);
        if (content.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, content, true),
          );
        }
      }
    } else {
      // Complete message — reset cumulative tracker and emit full content
      this.lastCumulativeText.delete(processId);
      if (content.length > 0) {
        this.emitEntry(
          processId,
          EntryNormalizer.assistantMessage(processId, content, false),
        );
      }
    }
  }

  // --- Helpers -------------------------------------------------------------

  private buildArgs(config: AgentConfig): string[] {
    const args: string[] = ['-o', 'stream-json'];

    if (config.model) {
      args.push('-m', config.model);
    }

    if (config.approvalMode === 'auto') {
      args.push('--approval-mode', 'yolo');
    }

    return args;
  }

  private emitStopped(processId: string, reason: string): void {
    if (this.stoppedEmitted.has(processId)) return;
    this.stoppedEmitted.add(processId);

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
  }

  private setupProcessListeners(child: ChildProcess, processId: string): void {
    child.on('exit', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Terminated by signal: ${signal}`
        : `Exited with code: ${code ?? 'unknown'}`;
      this.emitStopped(processId, reason);
    });

    // Fallback: 'close' fires after exit + stdio close — covers edge cases
    // where 'exit' is missed on Windows process trees (shell: true + npx).
    child.on('close', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Terminated by signal: ${signal}`
        : `Exited with code: ${code ?? 'unknown'}`;
      this.emitStopped(processId, reason);
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
    this.lastCumulativeText.delete(processId);
    this.thinkingEmitted.delete(processId);
    this.toolIdNames.clear();
    // Note: stoppedEmitted is intentionally NOT cleared here — it must persist
    // to guard against the readline close fallback timer firing after cleanup.
  }
}
