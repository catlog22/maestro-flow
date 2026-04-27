// ---------------------------------------------------------------------------
// ClaudeCodeAdapter — spawns Claude Code CLI with stream-json protocol
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  AgentConfig,
  AgentProcess,
  ApprovalDecision,
  ApprovalRequest,
} from '../../shared/agent-types.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { loadEnvFile } from './env-file-loader.js';
import { StreamMonitor } from './stream-monitor.js';
import { cleanSpawnEnv } from './env-cleanup.js';

/**
 * Resolve the Claude Code CLI `.js` entry point for direct `node` invocation.
 * On Windows, the global `claude` command is a `.cmd` wrapper requiring
 * `shell: true`, which adds cmd.exe nesting. Spawning `node cli.js` directly
 * avoids that overhead.
 */
function resolveClaudeCliPath(): string {
  const npmPrefix = process.env.APPDATA
    ? resolvePath(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    : '';
  if (npmPrefix && existsSync(npmPrefix)) return npmPrefix;
  return '';
}

// ---------------------------------------------------------------------------
// Claude Code stream-json message shapes (narrowed from unknown)
// ---------------------------------------------------------------------------

interface ClaudeAssistantMessage {
  type: 'assistant';
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
}

interface ClaudeContentBlockStart {
  type: 'content_block_start';
  content_block?: { type: string; text?: string };
}

interface ClaudeContentBlockDelta {
  type: 'content_block_delta';
  delta?: { type: string; text?: string };
}

interface ClaudeResultMessage {
  type: 'result';
  subtype?: string;
  result?: string;
  duration_ms?: number;
  total_cost?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface ClaudeToolUseMessage {
  type: 'tool_use';
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeToolResultMessage {
  type: 'tool_result';
  name?: string;
  content?: string;
  is_error?: boolean;
}

interface ClaudePermissionMessage {
  type: 'permission';
  permission?: {
    tool_name?: string;
    input?: Record<string, unknown>;
  };
}

interface ClaudeSystemMessage {
  type: 'system';
  subtype?: string;
  message?: string;
}

type ClaudeStreamMessage =
  | ClaudeAssistantMessage
  | ClaudeContentBlockStart
  | ClaudeContentBlockDelta
  | ClaudeResultMessage
  | ClaudeToolUseMessage
  | ClaudeToolResultMessage
  | ClaudePermissionMessage
  | ClaudeSystemMessage;

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly agentType = 'claude-code' as const;

  private readonly childProcesses = new Map<string, ChildProcess>();
  private readonly readlineInterfaces = new Map<string, ReadlineInterface>();
  private readonly pendingApprovals = new Map<
    string,
    { resolve: (allowed: boolean) => void }
  >();
  private readonly streamMonitors = new Map<string, StreamMonitor>();
  private readonly resultTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stoppedEmitted = new Set<string>();
  private readonly interactiveProcesses = new Set<string>();

  // --- Lifecycle hooks -----------------------------------------------------

  /** Whether this adapter supports interactive follow-up messages */
  supportsInteractive(): boolean {
    return true;
  }

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const interactive = config.interactive === true;

    // Build CLI arguments:
    // --input-format=stream-json requires --print (per Claude Code docs).
    // - Interactive mode: --print --input-format=stream-json (prompt sent via stdin, stdin kept open)
    // - Default mode: --print with prompt as CLI argument (stdin closed immediately)
    const args = interactive
      ? [
          '--output-format=stream-json',
          '--input-format=stream-json',
          '--print',
          '--verbose',
        ]
      : [
          '--output-format=stream-json',
          '--verbose',
          '--print',
          config.prompt,
        ];

    // Inject MCP config for meeting room tools
    if (config.mcpConfigPath) {
      args.push('--mcp-config', config.mcpConfigPath);
    }

    // Map approvalMode to Claude Code permission flags.
    // 'auto' → bypass all permission prompts (yolo) — required for non-interactive
    // --print mode where stdin is closed and no approval responder exists.
    // Claude Code only accepts: default | acceptEdits | bypassPermissions | plan.
    // 'suggest' → allow read-only tools without prompts (analysis mode).
    if (config.approvalMode === 'auto') {
      args.push('--permission-mode', 'bypassPermissions');
    } else if (config.approvalMode === 'suggest') {
      args.push('--permission-mode', 'default', '--allowedTools', 'Read,Glob,Grep,WebFetch,WebSearch');
    }

    // Resolve CLI entry point for direct node invocation (avoids cmd.exe
    // wrapper nesting on Windows which causes stdout buffering).
    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.baseUrl) envOverrides.ANTHROPIC_BASE_URL = config.baseUrl;
    if (config.apiKey) envOverrides.ANTHROPIC_API_KEY = config.apiKey;
    const childEnv = cleanSpawnEnv(envOverrides);

    const cliPath = resolveClaudeCliPath();
    const child = cliPath
      ? spawn(process.execPath, [cliPath, ...args], {
          cwd: config.workDir,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      : spawn('claude', args, {
          cwd: config.workDir,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true,
        });

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error('Failed to spawn Claude Code: stdio streams not available');
    }

    if (interactive) {
      // Interactive mode: send initial prompt as stream-json SDKUserMessage,
      // keep stdin open for follow-up messages via doSendMessage.
      const initMsg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: config.prompt },
      });
      child.stdin.write(initMsg + '\n');
    } else {
      // One-shot --print mode: close stdin immediately. Without this, the child
      // process blocks indefinitely waiting for stdin input on Windows pipes.
      child.stdin.end();
    }

    // Heartbeat monitor: detect stale streams (60s silence).
    // When stale, close stdin and kill the process — Claude CLI keeps stdout
    // open indefinitely even after finishing, so passive detection doesn't work.
    const monitor = new StreamMonitor(() => {
      this.emitEntry(
        processId,
        EntryNormalizer.error(processId, 'Stream stale: no output for 60s', 'stream_stale'),
      );
      // Close stdin to signal the process to exit naturally
      if (child.stdin?.writable) {
        child.stdin.end();
      }
      // If the process still doesn't exit after 5s, force kill it.
      // The exit/close/readline handlers will then emit stopped.
      setTimeout(() => {
        if (!this.stoppedEmitted.has(processId)) {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!this.stoppedEmitted.has(processId)) {
              child.kill('SIGKILL');
              // Last resort: force emit stopped if kill signals are ignored (Windows)
              setTimeout(() => {
                this.emitStopped(processId, 'Force stopped (stale stream fallback)');
              }, 2000);
            }
          }, 3000);
        }
      }, 5000);
    });
    this.streamMonitors.set(processId, monitor);

    // Line-by-line parsing of stream-json stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      monitor.heartbeat();
      this.parseClaudeMessage(line, processId);
    });

    // Last-resort fallback: if stdout closes but neither 'exit' nor 'close'
    // fire on the child (Windows shell: true + process tree edge case),
    // emit stopped after a short delay to let the primary handlers run first.
    rl.on('close', () => {
      setTimeout(() => {
        this.emitStopped(processId, 'stdout closed (readline fallback)');
      }, 500);
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

    // Store references for later use
    this.childProcesses.set(processId, child);
    this.readlineInterfaces.set(processId, rl);
    if (interactive) {
      this.interactiveProcesses.add(processId);
    }

    return {
      id: processId,
      type: 'claude-code',
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      pid: child.pid,
      interactive: true,
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

    // Close stdin first to let the process exit naturally
    if (child.stdin?.writable) {
      child.stdin.end();
    }

    // Graceful SIGTERM
    child.kill('SIGTERM');

    // SIGKILL fallback after 5 seconds
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      // Final fallback: if neither exit nor close events fire (Windows),
      // force-emit stopped after kill attempt.
      setTimeout(() => {
        this.emitStopped(processId, 'Force stopped (kill fallback)');
      }, 2000);
    }, 5000);

    // Wait for exit, then clean up timer
    child.once('exit', () => {
      clearTimeout(killTimer);
    });

    // Do NOT call cleanup() here — let exit/close/readline handlers do it
    // via emitStopped() to ensure status_change:stopped is emitted first.
  }

  /** Close stdin to signal no more input — process exits naturally after finishing current work */
  endInput(processId: string): void {
    const child = this.childProcesses.get(processId);
    if (child?.stdin?.writable) {
      child.stdin.end();
    }
  }

  protected async doSendMessage(
    processId: string,
    content: string,
  ): Promise<void> {
    const child = this.childProcesses.get(processId);
    if (!child?.stdin?.writable) {
      throw new Error(`Cannot send message: stdin not writable for process ${processId}`);
    }
    // SDKUserMessage format required by --input-format=stream-json
    const message = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
    });
    child.stdin.write(message + '\n');
  }

  protected async doRespondApproval(decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.id);
    if (!pending) {
      throw new Error(`No pending approval found with id: ${decision.id}`);
    }

    const child = this.childProcesses.get(decision.processId);
    if (!child?.stdin?.writable) {
      throw new Error(
        `Cannot respond to approval: stdin not writable for process ${decision.processId}`,
      );
    }

    // Write approval decision to stdin
    const response = JSON.stringify({
      decision: decision.allow ? 'allow' : 'deny',
    });
    child.stdin.write(response + '\n');

    // Emit approval response entry
    this.emitEntry(
      decision.processId,
      EntryNormalizer.approvalResponse(decision.processId, decision.id, decision.allow),
    );

    // Resolve the pending promise and clean up
    pending.resolve(decision.allow);
    this.pendingApprovals.delete(decision.id);
  }



  // --- Stream-json parsing -------------------------------------------------

  private parseClaudeMessage(line: string, processId: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let msg: ClaudeStreamMessage;
    try {
      msg = JSON.parse(trimmed) as ClaudeStreamMessage;
    } catch {
      // Non-JSON lines are silently skipped (e.g. npx output)
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      return;
    }

    switch (msg.type) {
      case 'assistant': {
        const content = this.extractAssistantContent(msg);
        if (content.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, content, false),
          );
        }
        break;
      }

      case 'content_block_start': {
        const text = msg.content_block?.text ?? '';
        if (text.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, text, true),
          );
        }
        break;
      }

      case 'content_block_delta': {
        const text = msg.delta?.text ?? '';
        if (text.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, text, true),
          );
        }
        break;
      }

      case 'result': {
        // Note: msg.result duplicates the assistant message text already emitted
        // via 'assistant' / 'content_block_*' events, so we skip it here.
        if (msg.usage) {
          this.emitEntry(
            processId,
            EntryNormalizer.tokenUsage(
              processId,
              msg.usage.input_tokens ?? 0,
              msg.usage.output_tokens ?? 0,
              msg.usage.cache_read_input_tokens,
              msg.usage.cache_creation_input_tokens,
            ),
          );
        }
        // 'result' with usage = final message from Claude CLI.
        if (this.interactiveProcesses.has(processId)) {
          // Interactive mode: agent stays alive for follow-up messages.
          // Emit a status change to 'paused' (which triggers turnCompleted
          // in AgentManager) instead of killing the process.
          this.emitEntry(
            processId,
            EntryNormalizer.statusChange(processId, 'paused', 'Turn completed, waiting for input'),
          );
        } else {
          // One-shot mode: start a completion timer — if the process doesn't
          // exit within 10s, force-kill it. Claude CLI sometimes keeps running
          // after completion (waiting for MCP connections, stdin, etc.).
          this.startResultTimer(processId);
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

      case 'tool_result': {
        const name = msg.name ?? 'unknown';
        const status = msg.is_error ? 'failed' : 'completed';
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(processId, name, {}, status, msg.content),
        );
        break;
      }

      case 'permission': {
        this.handlePermissionRequest(msg, processId);
        break;
      }

      case 'system': {
        // System messages are informational; skip silently
        break;
      }

      default:
        console.warn(`[ClaudeCodeAdapter] Unknown stream-json message type: ${(msg as { type: string }).type}`);
        break;
    }
  }

  // --- Helpers -------------------------------------------------------------

  private extractAssistantContent(msg: ClaudeAssistantMessage): string {
    const contentBlocks = msg.message?.content;
    if (!Array.isArray(contentBlocks)) {
      return '';
    }
    // Single-pass loop avoids intermediate array allocations from filter().map().join()
    let result = '';
    for (const block of contentBlocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        result += block.text;
      }
    }
    return result;
  }

  private handlePermissionRequest(
    msg: ClaudePermissionMessage,
    processId: string,
  ): void {
    const toolName = msg.permission?.tool_name ?? 'unknown';
    const toolInput = msg.permission?.input ?? {};
    const requestId = randomUUID();

    // Create a promise that will be resolved when the user responds
    new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(requestId, { resolve });
    });

    // Build and emit approval request
    const request: ApprovalRequest = {
      id: requestId,
      processId,
      toolName,
      toolInput,
      timestamp: new Date().toISOString(),
    };

    this.emitEntry(
      processId,
      EntryNormalizer.approvalRequest(processId, toolName, toolInput, requestId),
    );
    this.emitApproval(processId, request);
  }

  /**
   * After receiving a 'result' message, give the process 10s to exit naturally.
   * If it doesn't, force-kill it. This handles Claude CLI hanging after
   * completion (stdin closed but process doesn't exit on Windows).
   */
  private startResultTimer(processId: string): void {
    // Clear any existing timer (in case of multiple result messages)
    const existing = this.resultTimers.get(processId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.resultTimers.delete(processId);
      if (this.stoppedEmitted.has(processId)) return;

      const child = this.childProcesses.get(processId);
      if (!child) {
        this.emitStopped(processId, 'Process lost after result');
        return;
      }

      // Force kill — exit/close/readline handlers will emit stopped
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!this.stoppedEmitted.has(processId)) {
          child.kill('SIGKILL');
          setTimeout(() => {
            this.emitStopped(processId, 'Force stopped after result (kill fallback)');
          }, 2000);
        }
      }, 3000);
    }, 10_000);

    this.resultTimers.set(processId, timer);
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
    // where 'exit' is missed on Windows process trees (shell: true).
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
    const resultTimer = this.resultTimers.get(processId);
    if (resultTimer) {
      clearTimeout(resultTimer);
      this.resultTimers.delete(processId);
    }
    this.childProcesses.delete(processId);
    this.interactiveProcesses.delete(processId);

    // Clean up any pending approvals for this process
    this.pendingApprovals.forEach((pending, id) => {
      pending.resolve(false);
      this.pendingApprovals.delete(id);
    });
    // Note: stoppedEmitted is intentionally NOT cleared here — it must persist
    // to guard against the readline close fallback timer firing after cleanup.
  }
}
