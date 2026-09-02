// ---------------------------------------------------------------------------
// GrokAdapter — adapter for xAI Grok Build CLI (`grok`)
//
// Headless mode: `grok -p <prompt> --output-format streaming-json` emits an
// NDJSON event stream (ACP-style session updates). The prompt is passed via a
// temp file (`--prompt-file`) to avoid OS command-line length limits and
// shell quoting issues.
//
// Observed event shapes (grok 1.0.x):
//   {"type":"available_commands","tools":[...],"commands":[...]}
//   {"type":"thought","data":"..."}                         (incremental delta)
//   {"type":"text","data":"..."}                            (incremental delta)
//   {"type":"tool_call","toolCallId":"...","toolName":"...","title":"...",
//     "status":"pending","rawInput":{...},"content":[],"locations":[]}
//   {"type":"tool_call_update","toolCallId":"...","status":"completed"|null,
//     "content":[],"rawOutput":...,"locations":[]}
//   {"type":"usage","usage":{"input_tokens":N,"output_tokens":N,...}}
//   {"type":"end","stopReason":"end_turn","sessionId":"...","usage":{...},
//     "num_turns":N,"total_cost_usd":N,"modelUsage":{...}}
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentType,
  AgentConfig,
  AgentProcess,
  ApprovalDecision,
} from '../../shared/agent-types.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { loadEnvFile } from './env-file-loader.js';
import { StreamMonitor, DEFAULT_STREAM_TIMEOUT_MS } from './stream-monitor.js';
import { createStaleHandler } from './stale-handler.js';
import { killProcessTree } from './process-tree-kill.js';
import { cleanSpawnEnv } from './env-cleanup.js';

// ---------------------------------------------------------------------------
// Grok streaming-json event shapes
// ---------------------------------------------------------------------------

interface GrokThoughtEvent {
  type: 'thought';
  data?: string;
}

interface GrokTextEvent {
  type: 'text';
  data?: string;
}

interface GrokToolCallEvent {
  type: 'tool_call';
  toolCallId?: string;
  toolName?: string;
  title?: string;
  status?: string;
  rawInput?: Record<string, unknown>;
}

interface GrokToolCallUpdateEvent {
  type: 'tool_call_update';
  toolCallId?: string;
  status?: string | null;
  rawOutput?: unknown;
  content?: unknown;
}

interface GrokUsageEvent {
  type: 'usage';
  usage?: GrokUsage;
}

interface GrokEndEvent {
  type: 'end';
  stopReason?: string;
  sessionId?: string;
  usage?: GrokUsage;
}

interface GrokUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

type GrokEvent =
  | GrokThoughtEvent
  | GrokTextEvent
  | GrokToolCallEvent
  | GrokToolCallUpdateEvent
  | GrokUsageEvent
  | GrokEndEvent
  | { type: string };

/** Cap serialized tool results so huge outputs don't flood the entry stream */
const MAX_TOOL_RESULT_CHARS = 4000;

/** Grok CLI prints update prompts on stderr; they must not become error entries. */
export function isGrokUpdateNotice(text: string): boolean {
  return /checking for updates|update available|new version|auto-?update|downloading update|npm notice/i.test(text);
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class GrokAdapter extends BaseAgentAdapter {
  readonly agentType: AgentType = 'grok';

  private readonly executable: string;
  private readonly childProcesses = new Map<string, ChildProcess>();
  private readonly readlineInterfaces = new Map<string, ReadlineInterface>();
  /** toolCallId → tool name, scoped per process to avoid cross-session collisions */
  private readonly toolIdNames = new Map<string, Map<string, string>>();
  private readonly stoppedEmitted = new Set<string>();
  private readonly streamMonitors = new Map<string, StreamMonitor>();
  private readonly promptFiles = new Map<string, string>();
  /** Thought deltas are accumulated and flushed as a single thinking entry */
  private readonly thoughtBuffers = new Map<string, string>();
  /** Bumps on each spawn of a processId so a previous child's exit cannot tear down the replacement. */
  private readonly spawnGenerations = new Map<string, number>();

  constructor(executable = 'grok') {
    super();
    this.executable = executable;
  }

  // --- Lifecycle hooks -----------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    // Validate before any side effects (prompt file creation) so a rejected
    // config never leaks temp files.
    this.assertValidModel(config.model);
    const generation = (this.spawnGenerations.get(processId) ?? 0) + 1;
    this.spawnGenerations.set(processId, generation);
    this.stoppedEmitted.delete(processId);

    // Prompt goes through a temp file: grok takes it as a flag value, and
    // delegate prompts can exceed OS command-line limits / break quoting.
    // mode 0o600 — the prompt can contain repo context; keep it owner-only.
    const promptFile = join(tmpdir(), `maestro-grok-prompt-${processId}.md`);
    writeFileSync(promptFile, config.prompt, { encoding: 'utf-8', mode: 0o600 });
    this.promptFiles.set(processId, promptFile);

    const args = this.buildArgs(config, promptFile);
    const [cmd, ...cmdArgs] = this.executable.split(/\s+/);

    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) {
      envOverrides.XAI_API_KEY = config.apiKey;
    }
    const childEnv = cleanSpawnEnv(envOverrides);

    // shell is required on Windows to resolve the npm-installed `grok` shim
    // (grok.cmd); on POSIX the binary is spawned directly, so args are never
    // shell-interpreted. Model is validated in buildArgs regardless.
    const useShell = process.platform === 'win32';
    let child: ChildProcess;
    try {
      child = spawn(cmd, [...cmdArgs, ...args], {
        cwd: config.workDir,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: useShell,
        windowsHide: true,
        // POSIX: own process group so killProcessTree can signal the tree.
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      this.deletePromptFile(processId);
      throw err;
    }

    if (!child.stdout || !child.stdin || !child.stderr) {
      this.deletePromptFile(processId);
      throw new Error('Failed to spawn grok: stdio streams not available');
    }
    // Prompt was passed via file — close stdin so grok never blocks on it.
    child.stdin.end();

    // Heartbeat monitor: detect stale streams and terminate the process tree
    // (shared cascade with claude/codex/opencode — see stale-handler.ts).
    const staleTimeoutMs = config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
    const monitor = new StreamMonitor(
      createStaleHandler({
        processId,
        child,
        timeoutMs: staleTimeoutMs,
        onStaleDetected: (message) =>
          this.emitEntry(processId, EntryNormalizer.error(processId, message, 'stream_stale')),
        isStopped: () => this.stoppedEmitted.has(processId),
        emitStopped: (reason) => this.emitStopped(processId, reason, generation),
      }),
      staleTimeoutMs,
    );
    this.streamMonitors.set(processId, monitor);

    // Line-by-line parsing of streaming-json stdout
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      monitor.heartbeat();
      this.parseStreamJsonMessage(line, processId);
    });

    // Stderr => error entries. Update / auto-update notices are not errors.
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length === 0 || isGrokUpdateNotice(text)) {
        return;
      }
      this.emitEntry(processId, EntryNormalizer.error(processId, text, 'stderr'));
    });

    // Last-resort fallback: if stdout closes but neither 'exit' nor 'close'
    // fire on the child, emit stopped after a short delay to let the primary
    // handlers run first.
    rl.on('close', () => {
      setTimeout(() => {
        this.emitStopped(processId, 'stdout closed (readline fallback)', generation);
      }, 500);
    });

    // Process exit handling
    this.setupProcessListeners(child, processId, generation);

    // Store references
    this.childProcesses.set(processId, child);
    this.readlineInterfaces.set(processId, rl);

    this.emitEntry(
      processId,
      EntryNormalizer.statusChange(processId, 'running', 'Session started'),
    );

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

    // Graceful SIGTERM — whole process tree (cmd.exe/npx grandchildren)
    killProcessTree(child.pid, 'SIGTERM');

    // SIGKILL fallback after 5 seconds
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        killProcessTree(child.pid, 'SIGKILL');
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(killTimer);
    });

    this.cleanup(processId);
  }

  protected async doSendMessage(
    processId: string,
    content: string,
  ): Promise<void> {
    const previous = this.getProcess(processId);
    if (!previous) {
      throw new Error(`[grok] Cannot send follow-up: process ${processId} not found`);
    }

    // Invalidate the current child's stopped handler before killing it, so
    // its exit cannot remove the process we are about to respawn.
    this.spawnGenerations.set(processId, (this.spawnGenerations.get(processId) ?? 0) + 1);
    this.stoppedEmitted.delete(processId);

    const child = this.childProcesses.get(processId);
    if (child) {
      await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        child.once('exit', done);
        child.once('close', done);
        void this.doStop(processId).catch(done);
        setTimeout(done, 6000);
      });
    }

    const nextConfig: AgentConfig = {
      ...previous.config,
      prompt: content,
      metadata: { ...previous.config.metadata, continueSession: true },
    };
    const next = await this.doSpawn(processId, nextConfig);
    Object.assign(previous, next);
  }

  protected async doRespondApproval(_decision: ApprovalDecision): Promise<void> {
    // Grok headless handles approvals via --always-approve / --permission-mode
    // flags, not stdin. No-op.
  }

  // --- Streaming-json parsing ------------------------------------------------

  private parseStreamJsonMessage(line: string, processId: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let msg: GrokEvent;
    try {
      msg = JSON.parse(trimmed) as GrokEvent;
    } catch {
      // Non-JSON lines (e.g. bootstrap / update notices) are silently skipped
      return;
    }

    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
      return;
    }

    switch (msg.type) {
      case 'thought': {
        const data = (msg as GrokThoughtEvent).data ?? '';
        if (data.length > 0) {
          const prev = this.thoughtBuffers.get(processId) ?? '';
          this.thoughtBuffers.set(processId, prev + data);
        }
        break;
      }

      case 'text': {
        // Any pending thought output ends when assistant text begins.
        this.flushThoughts(processId);
        const data = (msg as GrokTextEvent).data ?? '';
        if (data.length > 0) {
          this.emitEntry(
            processId,
            EntryNormalizer.assistantMessage(processId, data, true),
          );
        }
        break;
      }

      case 'tool_call': {
        this.flushThoughts(processId);
        const event = msg as GrokToolCallEvent;
        const name = event.toolName ?? event.title ?? 'unknown';
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(processId, name, event.rawInput ?? {}, 'running'),
        );
        // Track toolCallId → name mapping for tool_call_update correlation
        if (event.toolCallId) {
          let names = this.toolIdNames.get(processId);
          if (!names) {
            names = new Map();
            this.toolIdNames.set(processId, names);
          }
          names.set(event.toolCallId, name);
        }
        break;
      }

      case 'tool_call_update': {
        const event = msg as GrokToolCallUpdateEvent;
        // Intermediate updates (status null / 'in_progress') carry no result.
        if (event.status !== 'completed' && event.status !== 'failed') {
          break;
        }
        const name = event.toolCallId
          ? (this.toolIdNames.get(processId)?.get(event.toolCallId) ?? 'unknown')
          : 'unknown';
        const result = this.extractToolResult(event);
        this.emitEntry(
          processId,
          EntryNormalizer.toolUse(
            processId,
            name,
            {},
            event.status === 'failed' ? 'failed' : 'completed',
            result,
          ),
        );
        break;
      }

      case 'end': {
        this.flushThoughts(processId);
        const usage = (msg as GrokEndEvent).usage;
        if (usage) {
          this.emitEntry(
            processId,
            EntryNormalizer.tokenUsage(
              processId,
              usage.input_tokens ?? 0,
              usage.output_tokens ?? 0,
              usage.cache_read_input_tokens,
              usage.cache_creation_input_tokens,
            ),
          );
        }
        break;
      }

      // 'available_commands', 'usage' (per-turn duplicates of 'end'), and
      // unknown events are ignored.
      default:
        break;
    }
  }

  /** Emit any buffered thought deltas as one thinking entry */
  private flushThoughts(processId: string): void {
    const buffered = this.thoughtBuffers.get(processId);
    if (buffered !== undefined && buffered.trim().length > 0) {
      this.emitEntry(processId, EntryNormalizer.thinking(processId, buffered.trim()));
    }
    this.thoughtBuffers.delete(processId);
  }

  /** Best-effort extraction of a readable result string from a tool update */
  private extractToolResult(event: GrokToolCallUpdateEvent): string | undefined {
    const raw = event.rawOutput ?? event.content;
    if (raw === null || raw === undefined) {
      return undefined;
    }
    let text: string;
    if (typeof raw === 'string') {
      text = raw;
    } else {
      try {
        text = JSON.stringify(raw);
      } catch {
        return undefined;
      }
    }
    if (text.length > MAX_TOOL_RESULT_CHARS) {
      return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)`;
    }
    return text;
  }

  // --- Helpers ---------------------------------------------------------------

  protected buildArgs(config: AgentConfig, promptFile: string): string[] {
    // Quoting is only needed for the cmd.exe shell parse on Windows.
    const promptArg = process.platform === 'win32' ? `"${promptFile}"` : promptFile;
    const args: string[] = [
      '--output-format', 'streaming-json',
      '--prompt-file', promptArg,
      '--no-auto-update',
    ];

    if (config.model) {
      args.push('-m', config.model);
    }

    if (config.metadata?.continueSession === true) {
      args.push('--continue');
    }

    if (config.approvalMode === 'auto') {
      args.push('--always-approve');
    } else {
      // Headless has no approval channel (stdin is closed). dontAsk keeps
      // read-only tools working and cleanly denies the rest instead of
      // blocking on a prompt until the stale timeout kills the session.
      args.push('--permission-mode', 'dontAsk');
    }

    return args;
  }

  /**
   * Model id is config/request data — restrict to safe characters so it can
   * never inject a second command under the Windows shell spawn.
   */
  private assertValidModel(model: string | undefined): void {
    if (model && !/^[A-Za-z0-9._:/-]+$/.test(model)) {
      throw new Error(`[grok] Invalid model id: ${JSON.stringify(model)}`);
    }
  }

  private deletePromptFile(processId: string): void {
    const promptFile = this.promptFiles.get(processId);
    if (promptFile) {
      this.promptFiles.delete(processId);
      try {
        unlinkSync(promptFile);
      } catch {
        // Best-effort cleanup — the temp file may already be gone.
      }
    }
  }

  private emitStopped(processId: string, reason: string, generation?: number): void {
    if (generation !== undefined && this.spawnGenerations.get(processId) !== generation) {
      return;
    }
    if (this.stoppedEmitted.has(processId)) return;
    this.stoppedEmitted.add(processId);

    this.flushThoughts(processId);
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

  private setupProcessListeners(child: ChildProcess, processId: string, generation: number): void {
    child.on('exit', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Terminated by signal: ${signal}`
        : `Exited with code: ${code ?? 'unknown'}`;
      this.emitStopped(processId, reason, generation);
    });

    // Fallback: 'close' fires after exit + stdio close — covers edge cases
    // where 'exit' is missed on Windows process trees (shell: true + npx).
    child.on('close', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `Terminated by signal: ${signal}`
        : `Exited with code: ${code ?? 'unknown'}`;
      this.emitStopped(processId, reason, generation);
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
    this.thoughtBuffers.delete(processId);
    this.toolIdNames.delete(processId);
    this.deletePromptFile(processId);
    // Note: stoppedEmitted is intentionally NOT cleared here — it must persist
    // to guard against the readline close fallback timer firing after cleanup.
  }
}
