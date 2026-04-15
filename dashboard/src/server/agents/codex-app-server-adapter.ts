// ---------------------------------------------------------------------------
// CodexAppServerAdapter — Codex app-server mode (JSON-RPC 2.0 over stdio)
//
// Reference: G:\github_lib\symphony\elixir\lib\symphony_elixir\codex\app_server.ex
//
// Protocol flow:
//   spawn  → start process → initialize → thread/start → turn/start
//   message → turn/start (new turn in same thread)
//   stop   → SIGTERM → SIGKILL fallback
//
// Unlike exec mode, app-server supports:
//   - Multi-turn sessions (continuation)
//   - Configurable approval policies
//   - Workspace-scoped sandboxing
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
import { cleanSpawnEnv } from './env-cleanup.js';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  method: string;
  id?: number;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface AppServerSession {
  child: ChildProcess;
  rl: ReadlineInterface;
  threadId: string | null;
  turnId: string | null;
  nextRpcId: number;
  pendingRpc: Map<number, {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>;
  /** Accumulated final assistant message text from the current/last turn. */
  lastAssistantMessage: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CodexAppServerConfig {
  /** Codex command. Defaults to 'codex app-server' */
  command?: string;
  /** Approval policy: 'never' (auto-approve all) or 'unless-allow-listed' */
  approvalPolicy?: string;
  /** Thread sandbox: 'workspace-write' */
  threadSandbox?: string;
}

const DEFAULT_APP_CONFIG: Required<CodexAppServerConfig> = {
  command: 'codex',
  approvalPolicy: 'never',
  threadSandbox: 'workspace-write',
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CodexAppServerAdapter extends BaseAgentAdapter {
  readonly agentType = 'codex-server' as const;

  override supportsInteractive(): boolean {
    return true;
  }

  private readonly sessions = new Map<string, AppServerSession>();
  private readonly appConfig: Required<CodexAppServerConfig>;

  constructor(config?: CodexAppServerConfig) {
    super();
    this.appConfig = { ...DEFAULT_APP_CONFIG, ...config };
  }

  // --- Lifecycle -----------------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) envOverrides.OPENAI_API_KEY = config.apiKey;
    const childEnv = cleanSpawnEnv(envOverrides);

    const child = spawn(this.appConfig.command, ['app-server'], {
      cwd: config.workDir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error('Failed to spawn Codex app-server: stdio not available');
    }

    const rl = createInterface({ input: child.stdout });
    const session: AppServerSession = {
      child,
      rl,
      threadId: null,
      turnId: null,
      nextRpcId: 1,
      pendingRpc: new Map(),
      lastAssistantMessage: '',
    };

    this.sessions.set(processId, session);

    // Wire up line-by-line JSON-RPC processing
    rl.on('line', (line: string) => {
      this.handleLine(processId, session, line);
    });

    // Stderr → error entries
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text.length > 0) {
        // Codex app-server may write progress/debug to stderr
        if (/\b(error|fatal)\b/i.test(text)) {
          this.emitEntry(processId, EntryNormalizer.error(processId, text, 'stderr'));
        }
      }
    });

    // Process exit
    this.setupProcessListeners(child, processId);

    // --- Initialize session ---
    try {
      await this.rpcCall(session, 'initialize', {
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            'item/agentMessage/delta',
            'item/reasoning/summaryTextDelta',
            'item/reasoning/summaryPartAdded',
            'item/reasoning/textDelta',
          ],
        },
        clientInfo: {
          name: 'maestro-dashboard',
          title: 'Maestro Dashboard',
          version: '1.0.0',
        },
      });

      // Send 'initialized' notification (no id = notification)
      this.sendNotification(session, 'initialized', {});

      // Start thread
      const threadResult = await this.rpcCall(session, 'thread/start', {
        approvalPolicy: this.appConfig.approvalPolicy,
        sandbox: this.appConfig.threadSandbox,
        cwd: config.workDir,
      });

      const threadId = (threadResult as { thread?: { id?: string } }).thread?.id;
      if (!threadId) {
        throw new Error('thread/start did not return thread.id');
      }
      session.threadId = threadId;

      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'running', 'Codex app-server session started'),
      );

      // Start first turn with the prompt
      await this.startTurn(processId, session, config.prompt, config.workDir);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEntry(processId, EntryNormalizer.error(processId, message, 'init_error'));
      child.kill('SIGTERM');
      throw err;
    }

    return {
      id: processId,
      type: 'codex-server',
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      pid: child.pid,
      interactive: true,
    };
  }

  protected async doStop(processId: string): Promise<void> {
    const session = this.sessions.get(processId);
    if (!session) return;

    const proc = this.getProcess(processId);
    if (proc) {
      proc.status = 'stopping';
      this.emitEntry(
        processId,
        EntryNormalizer.statusChange(processId, 'stopping', 'User requested stop'),
      );
    }

    session.child.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      if (!session.child.killed) {
        session.child.kill('SIGKILL');
      }
    }, 5000);

    session.child.once('exit', () => clearTimeout(killTimer));

    this.cleanup(processId);
  }

  protected async doSendMessage(
    processId: string,
    content: string,
  ): Promise<void> {
    const session = this.sessions.get(processId);
    if (!session?.threadId) {
      throw new Error('No active session for interactive messaging');
    }

    const config = this.getProcess(processId)?.config;
    const workDir = config?.workDir ?? process.cwd();

    // Start a new turn in the existing thread
    await this.startTurn(processId, session, content, workDir);
  }

  protected async doRespondApproval(decision: ApprovalDecision): Promise<void> {
    const rpcId = Number(decision.id);
    if (Number.isNaN(rpcId)) return;

    const result = decision.allow
      ? { decision: 'acceptForSession' }
      : { decision: 'reject' };

    this.sendRpcResponse(decision.processId, rpcId, result);
    this.emitEntry(
      decision.processId,
      EntryNormalizer.approvalResponse(decision.processId, decision.id, decision.allow),
    );
  }

  // --- Turn management -----------------------------------------------------

  private async startTurn(
    processId: string,
    session: AppServerSession,
    prompt: string,
    workDir: string,
  ): Promise<void> {
    const result = await this.rpcCall(session, 'turn/start', {
      threadId: session.threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: workDir,
      approvalPolicy: this.appConfig.approvalPolicy,
      sandboxPolicy: { type: 'workspaceWrite' },
    });

    const turnId = (result as { turn?: { id?: string } }).turn?.id;
    session.turnId = turnId ?? null;
  }

  // --- JSON-RPC 2.0 communication -----------------------------------------

  private rpcCall(
    session: AppServerSession,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = session.nextRpcId++;

      // Timeout for RPC calls (30s) — cleared on resolve/reject
      const timeoutId = setTimeout(() => {
        if (session.pendingRpc.has(id)) {
          session.pendingRpc.delete(id);
          reject(new Error(`RPC timeout: ${method} (id=${id})`));
        }
      }, 30_000);

      const cleanup = () => clearTimeout(timeoutId);

      session.pendingRpc.set(id, {
        resolve: (result) => { cleanup(); resolve(result); },
        reject: (error) => { cleanup(); reject(error); },
      });

      const request: JsonRpcRequest = { method, id, params };
      const line = JSON.stringify(request);

      if (session.child.stdin?.writable) {
        session.child.stdin.write(line + '\n');
      } else {
        session.pendingRpc.get(id)!.reject(new Error('stdin not writable'));
        session.pendingRpc.delete(id);
      }
    });
  }

  private sendNotification(
    session: AppServerSession,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const notification: JsonRpcNotification = { method, params };
    if (session.child.stdin?.writable) {
      session.child.stdin.write(JSON.stringify(notification) + '\n');
    }
  }

  /** Send a JSON-RPC 2.0 response to a server-initiated request (e.g. approval) */
  private sendRpcResponse(
    processId: string,
    id: number,
    result: Record<string, unknown>,
  ): void {
    const session = this.sessions.get(processId);
    if (!session) return;

    const response: JsonRpcResponse = { id, result };
    if (session.child.stdin?.writable) {
      session.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...response }) + '\n');
    }
  }

  // --- Line processing -----------------------------------------------------

  private handleLine(
    processId: string,
    session: AppServerSession,
    line: string,
  ): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    // JSON-RPC response (has id, matches pending)
    if (typeof msg.id === 'number' && session.pendingRpc.has(msg.id)) {
      const pending = session.pendingRpc.get(msg.id)!;
      session.pendingRpc.delete(msg.id);

      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message ?? 'RPC error'));
      } else {
        pending.resolve((msg.result as Record<string, unknown>) ?? {});
      }
      return;
    }

    // JSON-RPC notification or server-initiated request (method-based events)
    const method = msg.method as string | undefined;
    if (!method) return;

    // Server-initiated requests have an id field — needed for approval responses
    const rpcId = typeof msg.id === 'number' ? msg.id : undefined;
    this.handleNotification(processId, method, msg.params as Record<string, unknown> ?? {}, rpcId);
  }

  private handleNotification(
    processId: string,
    method: string,
    params: Record<string, unknown>,
    rpcId?: number,
  ): void {
    switch (method) {
      case 'turn/completed':
        // Emit 'paused' (not 'stopped') — the process stays alive between turns.
        // AgentManager detects this and emits 'agent:turnCompleted' so the
        // scheduler can trigger multi-turn continuation without process cleanup.
        this.emitEntry(
          processId,
          EntryNormalizer.statusChange(processId, 'paused', 'Turn completed'),
        );
        break;

      case 'turn/failed': {
        const reason = (params.reason as string) ?? 'Turn failed';
        this.emitEntry(processId, EntryNormalizer.error(processId, reason, 'turn_failed'));
        break;
      }

      case 'turn/cancelled':
        this.emitEntry(
          processId,
          EntryNormalizer.statusChange(processId, 'stopped', 'Turn cancelled'),
        );
        break;

      case 'item/completed': {
        const item = params.item as Record<string, unknown> | undefined;
        if (item) {
          this.classifyItem(processId, item);
        }
        break;
      }

      case 'usage/updated': {
        const usage = params as { inputTokens?: number; outputTokens?: number };
        if (usage.inputTokens || usage.outputTokens) {
          this.emitEntry(
            processId,
            EntryNormalizer.tokenUsage(
              processId,
              usage.inputTokens ?? 0,
              usage.outputTokens ?? 0,
            ),
          );
        }
        break;
      }

      // --- Approval requests (server-initiated JSON-RPC requests) ---
      // Auto-approve to prevent blocking in non-interactive sessions.

      case 'item/commandExecution/requestApproval': {
        if (rpcId == null) break;
        const requestId = String(rpcId);
        this.emitApproval(processId, {
          id: requestId,
          processId,
          toolName: 'commandExecution',
          toolInput: params,
          timestamp: new Date().toISOString(),
        });
        this.sendRpcResponse(processId, rpcId, { decision: 'acceptForSession' });
        this.emitEntry(processId, EntryNormalizer.approvalResponse(processId, requestId, true));
        break;
      }

      case 'execCommandApproval': {
        if (rpcId == null) break;
        const requestId = String(rpcId);
        this.emitApproval(processId, {
          id: requestId,
          processId,
          toolName: 'execCommand',
          toolInput: params,
          timestamp: new Date().toISOString(),
        });
        this.sendRpcResponse(processId, rpcId, { decision: 'approved_for_session' });
        this.emitEntry(processId, EntryNormalizer.approvalResponse(processId, requestId, true));
        break;
      }

      case 'applyPatchApproval': {
        if (rpcId == null) break;
        const requestId = String(rpcId);
        this.emitApproval(processId, {
          id: requestId,
          processId,
          toolName: 'applyPatch',
          toolInput: params,
          timestamp: new Date().toISOString(),
        });
        this.sendRpcResponse(processId, rpcId, { decision: 'approved_for_session' });
        this.emitEntry(processId, EntryNormalizer.approvalResponse(processId, requestId, true));
        break;
      }

      case 'item/fileChange/requestApproval': {
        if (rpcId == null) break;
        const requestId = String(rpcId);
        this.emitApproval(processId, {
          id: requestId,
          processId,
          toolName: 'fileChange',
          toolInput: params,
          timestamp: new Date().toISOString(),
        });
        this.sendRpcResponse(processId, rpcId, { decision: 'acceptForSession' });
        this.emitEntry(processId, EntryNormalizer.approvalResponse(processId, requestId, true));
        break;
      }

      case 'item/tool/requestUserInput': {
        if (rpcId == null) break;
        const requestId = String(rpcId);
        this.emitApproval(processId, {
          id: requestId,
          processId,
          toolName: 'userInput',
          toolInput: params,
          timestamp: new Date().toISOString(),
        });
        this.sendRpcResponse(processId, rpcId, {
          message: 'Non-interactive session. Unable to provide user input.',
        });
        this.emitEntry(processId, EntryNormalizer.approvalResponse(processId, requestId, false));
        break;
      }

      // Other methods: silently skip
      default:
        break;
    }
  }

  private classifyItem(processId: string, item: Record<string, unknown>): void {
    const type = item.type as string | undefined;
    const name = (item.name as string | undefined)?.toLowerCase() ?? '';

    // Semantic phase mapping — emit phase changes for dashboard/MCP visibility
    const phase = this.inferPhase(type, name, item);
    if (phase) {
      this.emitEntry(processId, EntryNormalizer.statusChange(processId, 'running', phase));
    }

    // Function call output (command execution)
    if (type === 'function_call_output' || (type === 'function_call' && /exec|shell|command|run|bash/.test(name))) {
      this.emitEntry(
        processId,
        EntryNormalizer.commandExec(
          processId,
          (item.name as string) ?? 'codex_exec',
          undefined,
          (item.output as string) ?? '',
        ),
      );
      return;
    }

    // File operation
    if (type === 'function_call' && /file|write|create|patch|edit|apply/.test(name)) {
      const filePath = (item.filename as string) ?? (item.path as string) ?? name;
      const action = /create|new/.test(name) ? 'create' as const
        : /delete|remove/.test(name) ? 'delete' as const
        : 'modify' as const;
      this.emitEntry(
        processId,
        EntryNormalizer.fileChange(processId, filePath, action, item.diff as string | undefined),
      );
      return;
    }

    // Text content
    const text = this.extractText(item);
    if (text.length > 0) {
      // Accumulate assistant message for efficient result retrieval
      const session = this.sessions.get(processId);
      if (session) {
        session.lastAssistantMessage = text;
      }
      this.emitEntry(
        processId,
        EntryNormalizer.assistantMessage(processId, text, false),
      );
    }
  }

  /** Get the last assistant message for a process (O(1) without re-parsing JSONL). */
  getLastMessage(processId: string): string {
    return this.sessions.get(processId)?.lastAssistantMessage ?? '';
  }

  /** Map codex item type/name to a semantic phase label. */
  private inferPhase(
    type: string | undefined,
    name: string,
    item: Record<string, unknown>,
  ): string | null {
    if (type === 'function_call' || type === 'function_call_output') {
      // File operations → editing
      if (/file|write|create|patch|edit|apply/.test(name)) return 'editing';
      // Command execution → verifying or running
      if (/exec|shell|command|run|bash/.test(name)) {
        const cmd = (item.command as string) ?? (item.output as string) ?? '';
        if (/\b(test|lint|build|typecheck|check|verify|validate|pytest|jest|vitest|tsc|eslint)\b/i.test(cmd)) {
          return 'verifying';
        }
        return 'running';
      }
      // Search/read operations → investigating
      if (/search|read|find|grep|glob|list|mcp|tool/.test(name)) return 'investigating';
    }
    // Agent message (final answer) → finalizing
    if (type === 'message') return 'finalizing';
    return null;
  }

  private extractText(item: Record<string, unknown>): string {
    const content = item.content as Array<{ type?: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      return content.filter((c) => typeof c.text === 'string').map((c) => c.text!).join('');
    }
    if (typeof item.text === 'string') return item.text;
    if (typeof item.output === 'string') return item.output;
    return '';
  }

  // --- Process lifecycle ---------------------------------------------------

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
    const session = this.sessions.get(processId);
    if (session) {
      session.rl.close();
      // Reject any pending RPCs
      for (const [, pending] of session.pendingRpc) {
        pending.reject(new Error('Session closed'));
      }
      session.pendingRpc.clear();
      this.sessions.delete(processId);
    }
  }
}
