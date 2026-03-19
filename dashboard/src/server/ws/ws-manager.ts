import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { SSEEvent } from '../../shared/types.js';
import type { WsServerMessage, WsClientMessage, WsEventType } from '../../shared/ws-protocol.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { CommanderAgent } from '../commander/commander-agent.js';

// ---------------------------------------------------------------------------
// WebSocketManager — manages WS clients, bridges EventBus to WS broadcast
// ---------------------------------------------------------------------------

export class WebSocketManager {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly eventListener: (event: SSEEvent) => void;

  constructor(
    private readonly eventBus: DashboardEventBus,
    private readonly agentManager: AgentManager,
    private readonly executionScheduler?: ExecutionScheduler,
    private readonly commanderAgent?: CommanderAgent,
    private readonly workflowRoot: string = process.cwd(),
  ) {
    this.wss = new WebSocketServer({ noServer: true });

    // Subscribe to all EventBus events and broadcast as WsServerMessage
    this.eventListener = (event: SSEEvent) => {
      this.broadcast(event.type as WsEventType, event.data);
    };
    this.eventBus.onAny(this.eventListener);

    // Handle new connections
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      // Send initial connected message
      const connectedMsg: WsServerMessage<null> = {
        type: 'connected',
        data: null,
        timestamp: new Date().toISOString(),
      };
      ws.send(JSON.stringify(connectedMsg));

      // Handle incoming messages from client
      ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const text = raw.toString();
          const msg = JSON.parse(text) as WsClientMessage;
          this.handleClientMessage(ws, msg);
        } catch {
          console.warn('[WS] Failed to parse client message');
        }
      });

      // Clean up on close
      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Handle HTTP upgrade request — call from server 'upgrade' event.
   */
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  /**
   * Broadcast a typed message to all connected WS clients.
   */
  broadcast(type: WsEventType, data: unknown): void {
    if (this.clients.size === 0) return;

    const msg: WsServerMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Send an error response back to the originating client.
   */
  private sendError(ws: WebSocket, action: string, error: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const msg: WsServerMessage<{ action: string; error: string }> = {
      type: 'agent:status',
      data: { action, error },
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(msg));
  }

  /**
   * Dispatch client messages — handles agent actions and CLI bridge forwarding.
   */
  private handleClientMessage(ws: WebSocket, msg: WsClientMessage): void {
    switch (msg.action) {
      // --- Agent actions (Dashboard UI -> AgentManager) -----------------------
      case 'spawn':
        this.agentManager.spawn(msg.config.type, msg.config)
          .then((proc) => {
            // Send spawned process info back to originating client
            const response: WsServerMessage = {
              type: 'agent:spawned',
              data: proc,
              timestamp: new Date().toISOString(),
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(response));
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'spawn', message);
          });
        break;

      case 'stop':
        this.agentManager.stop(msg.processId)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'stop', message);
          });
        break;

      case 'message':
        this.agentManager.sendMessage(msg.processId, msg.content)
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'message', message);
          });
        break;

      case 'approve':
        this.agentManager.respondApproval({
          id: msg.requestId,
          processId: msg.processId,
          allow: msg.allow,
        })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'approve', message);
          });
        break;

      // --- CLI Bridge forwarding (CLI process -> AgentManager + EventBus) -----
      case 'cli:spawned':
        this.agentManager.registerCliProcess(msg.process);
        this.eventBus.emit('agent:spawned', msg.process);
        break;
      case 'cli:entry':
        this.agentManager.addCliEntry(msg.entry.processId, msg.entry);
        this.eventBus.emit('agent:entry', msg.entry);
        break;
      case 'cli:stopped':
        this.agentManager.updateCliProcessStatus(msg.processId, 'stopped');
        this.eventBus.emit('agent:stopped', { processId: msg.processId });
        break;

      // --- Execution actions -------------------------------------------------
      case 'execute:issue':
        if (this.executionScheduler) {
          this.executionScheduler.executeIssue(msg.issueId, msg.executor)
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.sendError(ws, 'execute:issue', message);
            });
        }
        break;

      case 'execute:batch':
        if (this.executionScheduler) {
          this.executionScheduler.executeBatch(msg.issueIds, msg.executor, msg.maxConcurrency)
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.sendError(ws, 'execute:batch', message);
            });
        }
        break;

      // --- Issue analyze/plan actions (UI -> AgentManager) -------------------
      case 'issue:analyze':
        if (!msg.issueId) {
          this.sendError(ws, 'issue:analyze', 'Missing issueId');
          break;
        }
        this.agentManager.spawn('claude-code', {
          type: 'claude-code',
          prompt: `Analyze issue ${msg.issueId}: Read .workflow/issues/issues.jsonl, find the issue, explore codebase for root cause analysis, and update the issue with analysis results.`,
          workDir: this.workflowRoot,
          approvalMode: 'auto',
        })
          .then((proc) => {
            const response: WsServerMessage = {
              type: 'agent:spawned',
              data: proc,
              timestamp: new Date().toISOString(),
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(response));
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'issue:analyze', message);
          });
        break;

      case 'issue:plan':
        if (!msg.issueId) {
          this.sendError(ws, 'issue:plan', 'Missing issueId');
          break;
        }
        this.agentManager.spawn('claude-code', {
          type: 'claude-code',
          prompt: `Plan solution for issue ${msg.issueId}: Read the issue from .workflow/issues/issues.jsonl, use existing analysis, generate solution steps, and update the issue with the solution.`,
          workDir: this.workflowRoot,
          approvalMode: 'auto',
        })
          .then((proc) => {
            const response: WsServerMessage = {
              type: 'agent:spawned',
              data: proc,
              timestamp: new Date().toISOString(),
            };
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(response));
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.sendError(ws, 'issue:plan', message);
          });
        break;

      case 'supervisor:toggle':
        if (this.executionScheduler) {
          if (msg.config) {
            this.executionScheduler.updateConfig(msg.config);
          }
          if (msg.enabled === true) {
            this.executionScheduler.startSupervisor();
          } else if (msg.enabled === false) {
            this.executionScheduler.stopSupervisor();
          }
        }
        break;

      // --- Commander actions ---------------------------------------------------
      case 'commander:start':
        if (this.commanderAgent) {
          this.commanderAgent.start()
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.sendError(ws, 'commander:start', message);
            });
        }
        break;

      case 'commander:stop':
        if (this.commanderAgent) {
          this.commanderAgent.stop();
        }
        break;

      case 'commander:pause':
        if (this.commanderAgent) {
          const state = this.commanderAgent.getState();
          if (state.status === 'paused') {
            this.commanderAgent.resume();
          } else {
            this.commanderAgent.pause();
          }
        }
        break;

      case 'commander:config':
        if (this.commanderAgent) {
          this.commanderAgent.updateConfig(msg.config);
        }
        break;

      default:
        console.log(`[WS] Unknown client action: ${(msg as { action: string }).action}`);
        break;
    }
  }

  /** Return the number of connected clients */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Close all clients, unsubscribe from EventBus, close WebSocketServer */
  destroy(): void {
    this.eventBus.offAny(this.eventListener);

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    this.wss.close();
  }
}
