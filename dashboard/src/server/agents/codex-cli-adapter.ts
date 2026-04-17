// ---------------------------------------------------------------------------
// CodexCliAdapter -- spawns OpenAI Codex CLI with NDJSON protocol
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
// Codex NDJSON message shapes
// ---------------------------------------------------------------------------

interface CodexThreadStarted {
  type: 'thread.started';
}

interface CodexTurnStarted {
  type: 'turn.started';
}

interface CodexItemCompleted {
  type: 'item.completed';
  item?: CodexItem;
}

interface CodexTurnCompleted {
  type: 'turn.completed';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface CodexItem {
  type?: string;
  name?: string;
  output?: string;
  content?: Array<{ type?: string; text?: string }>;
  text?: string;
  arguments?: string;
  // File change fields
  filename?: string;
  path?: string;
  action?: string;
  diff?: string;
}

type CodexMessage =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexItemCompleted
  | CodexTurnCompleted;

// ---------------------------------------------------------------------------
// Stderr error pattern
// ---------------------------------------------------------------------------

const STDERR_ERROR_RE = /\b(error|fatal)\b/i;

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class CodexCliAdapter extends BaseAgentAdapter {
  readonly agentType = 'codex' as const;

  private readonly childProcesses = new Map<string, ChildProcess>();
  private readonly readlineInterfaces = new Map<string, ReadlineInterface>();
  private readonly streamMonitors = new Map<string, StreamMonitor>();

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const args = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '--skip-git-repo-check',
      '-',
    ];

    // Profile from config.toml
    if (config.settingsFile) {
      args.push('--profile', config.settingsFile);
    }

    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) envOverrides.OPENAI_API_KEY = config.apiKey;
    const childEnv = cleanSpawnEnv(envOverrides);

    const child = spawn('codex', args, {
      cwd: config.workDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error('Failed to spawn Codex CLI: stdio streams not available');
    }

    // Pipe prompt to stdin then close it
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

    // Line-by-line parsing of NDJSON stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      monitor.heartbeat();
      this.parseCodexMessage(line, processId);
    });

    // Stderr handling: Codex sends warnings, reasoning, and progress to stderr.
    // Try JSON parse first to detect structured messages (warnings/errors).
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length === 0) return;

      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        // Try to parse as JSON — Codex emits structured warnings/errors to stderr
        try {
          const json = JSON.parse(trimmed);
          if (json && typeof json === 'object' && json.type === 'error') {
            // Codex structured warning/error — emit as thinking (non-fatal info)
            this.emitEntry(processId, EntryNormalizer.thinking(processId, json.message ?? trimmed));
            continue;
          }
        } catch {
          // Not JSON — fall through to text classification
        }

        if (STDERR_ERROR_RE.test(trimmed)) {
          this.emitEntry(processId, EntryNormalizer.error(processId, trimmed, 'stderr'));
        } else {
          // Codex emits reasoning/progress text to stderr; treat as thinking, not output
          this.emitEntry(processId, EntryNormalizer.thinking(processId, trimmed));
        }
      }
    });

    // Process exit handling
    this.setupProcessListeners(child, processId);

    // Store references
    this.childProcesses.set(processId, child);
    this.readlineInterfaces.set(processId, rl);

    return {
      id: processId,
      type: 'codex',
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      pid: child.pid,
      interactive: false,
    };
  }

  protected async doStop(processId: string): Promise<void> {
    const child = this.childProcesses.get(processId);
    if (!child) return;

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
    // Codex exec uses single-prompt mode via stdin (already closed after spawn).
    // Interactive messaging is not supported.
    throw new Error('CodexCliAdapter does not support interactive messaging');
  }

  protected async doRespondApproval(_decision: ApprovalDecision): Promise<void> {
    // Codex --full-auto mode does not request approvals; no-op.
  }

  // --- NDJSON parsing ------------------------------------------------------

  private parseCodexMessage(line: string, processId: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let msg: CodexMessage;
    try {
      msg = JSON.parse(trimmed) as CodexMessage;
    } catch {
      // Non-JSON lines silently skipped
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    switch (msg.type) {
      case 'thread.started': {
        this.emitEntry(
          processId,
          EntryNormalizer.statusChange(processId, 'running', 'Codex session started'),
        );
        break;
      }

      case 'item.completed': {
        const item = (msg as CodexItemCompleted).item;
        if (item) {
          this.classifyItem(item, processId);
        }
        break;
      }

      case 'turn.completed': {
        const usage = (msg as CodexTurnCompleted).usage;
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

      // turn.started and unknown types are silently skipped
      default:
        break;
    }
  }

  // --- Item classification -------------------------------------------------

  private classifyItem(item: CodexItem, processId: string): void {
    const itemType = item.type ?? '';
    const itemName = (item.name ?? '').toLowerCase();

    // Function call that looks like a command execution
    if (
      itemType === 'function_call_output' ||
      (itemType === 'function_call' && this.isCommandCall(itemName)) ||
      (typeof item.output === 'string' && itemType !== 'message')
    ) {
      const command = item.name ?? item.arguments ?? 'codex_exec';
      const output = item.output ?? '';
      this.emitEntry(
        processId,
        EntryNormalizer.commandExec(processId, command, undefined, output),
      );
      return;
    }

    // Function call that looks like a file operation
    if (itemType === 'function_call' && this.isFileCall(itemName)) {
      const filePath = item.filename ?? item.path ?? itemName;
      const action = this.inferFileAction(itemName);
      this.emitEntry(
        processId,
        EntryNormalizer.fileChange(processId, filePath, action, item.diff),
      );
      return;
    }

    // Default: treat as assistant message
    const text = this.extractItemText(item);
    if (text.length > 0) {
      this.emitEntry(
        processId,
        EntryNormalizer.assistantMessage(processId, text, false),
      );
    }
  }

  private isCommandCall(name: string): boolean {
    return /exec|shell|command|run|bash/.test(name);
  }

  private isFileCall(name: string): boolean {
    return /file|write|create|patch|edit|apply|read/.test(name);
  }

  private inferFileAction(name: string): 'create' | 'modify' | 'delete' {
    if (/create|new/.test(name)) return 'create';
    if (/delete|remove/.test(name)) return 'delete';
    return 'modify';
  }

  private extractItemText(item: CodexItem): string {
    // Try content array first
    if (Array.isArray(item.content)) {
      const parts = item.content
        .filter((c): c is { type?: string; text: string } => typeof c.text === 'string')
        .map((c) => c.text);
      if (parts.length > 0) return parts.join('');
    }

    // Try direct text field
    if (typeof item.text === 'string') return item.text;

    // Try output field
    if (typeof item.output === 'string') return item.output;

    // Fallback: stringify the item (skip empty objects)
    const json = JSON.stringify(item);
    return json === '{}' ? '' : json;
  }

  // --- Process lifecycle helpers -------------------------------------------

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
