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

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    // Build CLI arguments — use --print for one-shot prompts.
    // stdin is kept open only when --input-format=stream-json is used (interactive).
    const args = [
      '--output-format=stream-json',
      '--verbose',
      '--print',
      config.prompt,
    ];

    // Resolve CLI entry point for direct node invocation (avoids cmd.exe
    // wrapper nesting on Windows which causes stdout buffering).
    const cliPath = resolveClaudeCliPath();
    const child = cliPath
      ? spawn(process.execPath, [cliPath, ...args], {
          cwd: config.workDir,
          env: { ...process.env, ...config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : spawn('claude', args, {
          cwd: config.workDir,
          env: { ...process.env, ...config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error('Failed to spawn Claude Code: stdio streams not available');
    }

    // Close stdin immediately for --print mode. Without this, the child process
    // blocks indefinitely waiting for stdin input on Windows pipes.
    child.stdin.end();

    // Line-by-line parsing of stream-json stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      this.parseClaudeMessage(line, processId);
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

    // Graceful SIGTERM
    child.kill('SIGTERM');

    // SIGKILL fallback after 5 seconds
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000);

    // Wait for exit, then clean up timer
    child.once('exit', () => {
      clearTimeout(killTimer);
    });

    this.cleanup(processId);
  }

  protected async doSendMessage(
    processId: string,
    content: string,
  ): Promise<void> {
    const child = this.childProcesses.get(processId);
    if (!child?.stdin?.writable) {
      throw new Error(`Cannot send message: stdin not writable for process ${processId}`);
    }
    const message = JSON.stringify({ type: 'user_message', content });
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
    return contentBlocks
      .filter((block): block is { type: string; text: string } =>
        block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('');
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
    this.childProcesses.delete(processId);

    // Clean up any pending approvals for this process
    this.pendingApprovals.forEach((pending, id) => {
      pending.resolve(false);
      this.pendingApprovals.delete(id);
    });
  }
}
