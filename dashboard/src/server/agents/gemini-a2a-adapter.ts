// ---------------------------------------------------------------------------
// GeminiA2aAdapter — Gemini A2A Server mode (HTTP JSON-RPC + SSE)
//
// Protocol flow:
//   spawn  → start A2A server → poll readiness → message/stream (initial prompt)
//   message → message/send (inject into running task)
//   stop   → CancelTask → SIGTERM → SIGKILL fallback
//
// Unlike headless gemini mode, A2A server supports:
//   - Mid-task message injection (true interactive)
//   - Multi-turn sessions (task continuity)
//   - Streaming via SSE
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AgentConfig,
  AgentProcess,
  ApprovalDecision,
} from '../../shared/agent-types.js';
import { BaseAgentAdapter } from './base-adapter.js';
import { EntryNormalizer } from './entry-normalizer.js';
import { loadEnvFile } from './env-file-loader.js';
import { killProcessTree } from './process-tree-kill.js';
import { cleanSpawnEnv } from './env-cleanup.js';

// ---------------------------------------------------------------------------
// A2A protocol types
// ---------------------------------------------------------------------------

interface A2aSession {
  serverProcess: ChildProcess;
  port: number;
  rpcUrl: string;       // JSON-RPC endpoint from agent card
  taskId: string | null;
  nextRpcId: number;
  abortController: AbortController | null;
}

interface A2aPart {
  kind: string;
  text?: string;
  file?: { name?: string; mimeType?: string; bytes?: string };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVER_READY_TIMEOUT_MS = 20_000;
const SERVER_READY_POLL_MS = 500;
const KILL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GeminiA2aAdapter extends BaseAgentAdapter {
  readonly agentType = 'gemini-a2a' as const;

  private readonly sessions = new Map<string, A2aSession>();

  override supportsInteractive(): boolean {
    return true;
  }

  // --- Lifecycle -----------------------------------------------------------

  protected async doSpawn(
    processId: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    const port = await findFreePort();

    const envFromFile = config.envFile ? loadEnvFile(config.envFile) : {};
    const envOverrides: Record<string, string | undefined> = { ...envFromFile, ...config.env };
    if (config.apiKey) envOverrides.GEMINI_API_KEY = config.apiKey;
    const childEnv = cleanSpawnEnv(envOverrides);

    const serverProcess = spawn(
      'npx',
      ['-y', '@google/gemini-cli-a2a-server', '--port', String(port)],
      {
        cwd: config.workDir,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
        // POSIX: own process group so killProcessTree can signal the npx tree.
        detached: process.platform !== 'win32',
      },
    );

    // Capture stderr for debugging
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && /\b(error|fatal)\b/i.test(text)) {
        this.emitEntry(processId, EntryNormalizer.error(processId, text, 'stderr'));
      }
    });

    const session: A2aSession = {
      serverProcess,
      port,
      rpcUrl: `http://127.0.0.1:${port}`,
      taskId: null,
      nextRpcId: 1,
      abortController: null,
    };

    this.sessions.set(processId, session);
    this.setupProcessListeners(serverProcess, processId);

    // Wait for server readiness
    try {
      const agentCard = await this.waitForReady(port);
      // Use agent card's URL if available
      if (agentCard?.url) {
        session.rpcUrl = agentCard.url as string;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEntry(processId, EntryNormalizer.error(processId, message, 'server_start_failed'));
      serverProcess.kill('SIGTERM');
      throw err;
    }

    this.emitEntry(
      processId,
      EntryNormalizer.statusChange(processId, 'running', `A2A server started on port ${port}`),
    );

    // Send initial prompt via streaming
    await this.sendStreamingMessage(processId, session, config.prompt);

    return {
      id: processId,
      type: 'gemini-a2a',
      status: 'running',
      config,
      startedAt: new Date().toISOString(),
      pid: serverProcess.pid,
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

    // Cancel running task
    if (session.taskId) {
      try {
        await this.rpcCall(session, 'tasks/cancel', { id: session.taskId });
      } catch { /* best-effort */ }
    }

    // Abort SSE connection
    session.abortController?.abort();

    // Kill server — whole process tree (npx → node grandchildren)
    killProcessTree(session.serverProcess.pid, 'SIGTERM');
    const killTimer = setTimeout(() => {
      if (!session.serverProcess.killed) {
        killProcessTree(session.serverProcess.pid, 'SIGKILL');
      }
    }, KILL_TIMEOUT_MS);
    session.serverProcess.once('exit', () => clearTimeout(killTimer));

    this.cleanup(processId);
  }

  protected async doSendMessage(
    processId: string,
    content: string,
  ): Promise<void> {
    const session = this.sessions.get(processId);
    if (!session) {
      throw new Error('No active A2A session for interactive messaging');
    }

    // Send message to existing task — A2A injects into running task
    const params: Record<string, unknown> = {
      message: {
        messageId: randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text: content }],
      },
    };
    if (session.taskId) {
      params.id = session.taskId;
    }

    const result = await this.rpcCall(session, 'message/send', params) as Record<string, unknown>;
    // Update taskId if returned
    if (result?.id && typeof result.id === 'string') {
      session.taskId = result.id;
    }
  }

  protected async doRespondApproval(_decision: ApprovalDecision): Promise<void> {
    // A2A server handles approvals internally
  }

  // --- Streaming message (SSE) ---------------------------------------------

  private async sendStreamingMessage(
    processId: string,
    session: A2aSession,
    prompt: string,
  ): Promise<void> {
    const params = {
      message: {
        messageId: randomUUID(),
        role: 'user',
        parts: [{ kind: 'text', text: prompt }],
      },
    };

    if (session.taskId) {
      (params as Record<string, unknown>).id = session.taskId;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: session.nextRpcId++,
      method: 'message/stream',
      params,
    });

    const controller = new AbortController();
    session.abortController = controller;

    const url = new URL(session.rpcUrl);

    return new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port || session.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`A2A stream request failed: ${res.statusCode}`));
            return;
          }

          // Resolved once we get the first event — spawn can proceed
          let resolved = false;

          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data) {
                  this.handleSseEvent(processId, session, data);
                  if (!resolved) {
                    resolved = true;
                    resolve();
                  }
                }
              }
            }
          });

          res.on('end', () => {
            // Process remaining buffer
            if (buffer.startsWith('data:')) {
              const data = buffer.slice(5).trim();
              if (data) {
                this.handleSseEvent(processId, session, data);
              }
            }
            if (!resolved) {
              resolved = true;
              resolve();
            }
          });

          res.on('error', (err) => {
            if (!resolved) {
              resolved = true;
              reject(err);
            }
          });
        },
      );

      req.on('error', (err) => {
        if (controller.signal.aborted) return; // Expected on stop
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  // --- SSE event handling --------------------------------------------------

  private handleSseEvent(
    processId: string,
    session: A2aSession,
    data: string,
  ): void {
    let event: Record<string, unknown>;
    try {
      // SSE data is a JSON-RPC response wrapper
      const parsed = JSON.parse(data) as Record<string, unknown>;
      event = (parsed.result ?? parsed) as Record<string, unknown>;
    } catch {
      return;
    }

    const kind = event.kind as string | undefined;

    // Extract taskId from any event
    const taskId = (event.id ?? event.taskId) as string | undefined;
    if (taskId && !session.taskId) {
      session.taskId = taskId;
    }

    switch (kind) {
      case 'task': {
        // Initial task creation — mark running
        session.taskId = (event.id as string) ?? session.taskId;
        break;
      }

      case 'status-update': {
        const status = event.status as { state?: string; message?: { parts?: A2aPart[] } } | undefined;
        const state = status?.state;

        switch (state) {
          case 'working':
            // Already running, no need to re-emit
            break;
          case 'completed':
            this.emitEntry(
              processId,
              EntryNormalizer.statusChange(processId, 'stopped', 'Task completed'),
            );
            break;
          case 'failed': {
            const failMsg = this.extractTextFromParts(status?.message?.parts) || 'Task failed';
            this.emitEntry(processId, EntryNormalizer.error(processId, failMsg, 'task_failed'));
            this.emitEntry(
              processId,
              EntryNormalizer.statusChange(processId, 'stopped', failMsg),
            );
            break;
          }
          case 'canceled':
            this.emitEntry(
              processId,
              EntryNormalizer.statusChange(processId, 'stopped', 'Task cancelled'),
            );
            break;
          case 'input-required':
            this.emitEntry(
              processId,
              EntryNormalizer.statusChange(processId, 'paused', 'Input required'),
            );
            break;
          default:
            break;
        }
        break;
      }

      case 'artifact-update': {
        const artifact = event.artifact as {
          parts?: A2aPart[];
          append?: boolean;
          lastChunk?: boolean;
        } | undefined;

        if (artifact?.parts) {
          const text = this.extractTextFromParts(artifact.parts);
          if (text) {
            this.emitEntry(
              processId,
              EntryNormalizer.assistantMessage(processId, text, !artifact.lastChunk),
            );
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // --- HTTP helpers --------------------------------------------------------

  private async rpcCall(
    session: A2aSession,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: session.nextRpcId++,
      method,
      params,
    });

    const url = new URL(session.rpcUrl);

    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port || session.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              if (parsed.error) {
                const err = parsed.error as { message?: string };
                reject(new Error(err.message ?? 'A2A RPC error'));
              } else {
                resolve(parsed.result);
              }
            } catch {
              reject(new Error(`Invalid A2A response: ${data.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', reject);

      const timeout = setTimeout(() => {
        req.destroy(new Error(`A2A RPC timeout: ${method}`));
      }, 30_000);

      req.once('close', () => clearTimeout(timeout));
      req.write(body);
      req.end();
    });
  }

  private async waitForReady(port: number): Promise<Record<string, unknown> | null> {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const card = await this.fetchAgentCard(port);
        if (card) return card;
      } catch { /* server not ready yet */ }
      await new Promise((r) => setTimeout(r, SERVER_READY_POLL_MS));
    }

    throw new Error(`A2A server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
  }

  private fetchAgentCard(port: number): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/.well-known/agent.json',
          method: 'GET',
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data) as Record<string, unknown>);
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(2000, () => {
        req.destroy(new Error('Agent card request timeout'));
      });
      req.end();
    });
  }

  // --- Helpers -------------------------------------------------------------

  private extractTextFromParts(parts?: A2aPart[]): string {
    if (!Array.isArray(parts)) return '';
    return parts
      .filter((p) => p.kind === 'text' && typeof p.text === 'string')
      .map((p) => p.text!)
      .join('');
  }

  private setupProcessListeners(child: ChildProcess, processId: string): void {
    child.on('exit', (code: number | null, signal: string | null) => {
      const reason = signal
        ? `A2A server terminated by signal: ${signal}`
        : `A2A server exited with code: ${code ?? 'unknown'}`;

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
      session.abortController?.abort();
      this.sessions.delete(processId);
    }
  }
}

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate port')));
      }
    });
    server.on('error', reject);
  });
}
