import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { SSEEvent } from '../../shared/types.js';
import type { WsServerMessage, WsClientMessage, WsEventType } from '../../shared/ws-protocol.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { AgentManager } from '../agents/agent-manager.js';
import type { ExecutionScheduler } from '../execution/execution-scheduler.js';
import type { WaveExecutor } from '../execution/wave-executor.js';
import type { CommanderAgent } from '../commander/commander-agent.js';
import { loadDashboardAgentSettings } from '../config.js';
import { readIssuesJsonl } from '../utils/issue-store.js';
import { EntryNormalizer } from '../agents/entry-normalizer.js';

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
    private readonly waveExecutor?: WaveExecutor,
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
        this.mergeSettingsAndSpawn(ws, msg.config);
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
        // Inject user_message so the prompt appears as the first chat entry
        if (msg.process.config?.prompt) {
          const userEntry = EntryNormalizer.userMessage(msg.process.id, msg.process.config.prompt);
          this.agentManager.addCliEntry(msg.process.id, userEntry);
          this.eventBus.emit('agent:entry', userEntry);
        }
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
        this.handleIssueAnalyze(ws, msg.issueId, msg.tool, msg.depth);
        break;

      case 'issue:plan':
        if (!msg.issueId) {
          this.sendError(ws, 'issue:plan', 'Missing issueId');
          break;
        }
        this.handleIssuePlan(ws, msg.issueId, msg.tool);
        break;

      // --- Wave execution (Agent SDK wave mode) ---------------------------
      case 'execute:wave':
        if (this.waveExecutor) {
          this.handleWaveExecute(ws, msg.issueId)
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.sendError(ws, 'execute:wave', message);
            });
        } else {
          this.sendError(ws, 'execute:wave', 'WaveExecutor not available');
        }
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

  /**
   * Merge saved agent settings into spawn config, then spawn.
   */
  private mergeSettingsAndSpawn(ws: WebSocket, config: import('../../shared/agent-types.js').AgentConfig): void {
    loadDashboardAgentSettings(this.workflowRoot, config.type)
      .then((saved) => {
        const mergedConfig = {
          ...config,
          model: (config.model ?? saved?.model) || undefined,
          approvalMode: config.approvalMode ?? saved?.approvalMode ?? undefined,
          baseUrl: (config.baseUrl ?? saved?.baseUrl) || undefined,
          apiKey: (config.apiKey ?? saved?.apiKey) || undefined,
          settingsFile: (config.settingsFile ?? saved?.settingsFile) || undefined,
        };
        return this.agentManager.spawn(mergedConfig.type, mergedConfig);
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
        this.sendError(ws, 'spawn', message);
      });
  }

  /**
   * Handle wave execution: read issue from JSONL, launch WaveExecutor.
   */
  private async handleWaveExecute(ws: WebSocket, issueId: string): Promise<void> {
    if (!issueId) {
      this.sendError(ws, 'execute:wave', 'Missing issueId');
      return;
    }

    const { join } = await import('node:path');
    const jsonlPath = join(this.workflowRoot, 'issues', 'issues.jsonl');

    try {
      const issues = await readIssuesJsonl(jsonlPath);
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) {
        this.sendError(ws, 'execute:wave', `Issue not found: ${issueId}`);
        return;
      }
      await this.waveExecutor!.execute(issue);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(ws, 'execute:wave', message);
    }
  }

  /**
   * Handle issue:analyze — spawn agent with /manage-issue-analyze slash command.
   */
  private handleIssueAnalyze(ws: WebSocket, issueId: string, tool?: string, depth?: string): void {
    const resolvedTool = tool || 'gemini';
    const resolvedDepth = depth || 'standard';
    const prompt = `/manage-issue-analyze ${issueId} --tool ${resolvedTool} --depth ${resolvedDepth}`;
    this.buildIssuePromptAndSpawn(ws, 'issue:analyze', issueId, () => prompt);
  }

  /**
   * Handle issue:plan — read issue, spawn agent with type-aware prompt.
   */
  private handleIssuePlan(ws: WebSocket, issueId: string, tool?: string): void {
    const resolvedTool = tool || 'gemini';
    const prompt = `/manage-issue-plan ${issueId} --tool ${resolvedTool}`;
    this.buildIssuePromptAndSpawn(ws, 'issue:plan', issueId, () => prompt);
  }

  /**
   * Shared helper: read issue from JSONL, determine agent type from settings, build prompt, spawn.
   */
  private buildIssuePromptAndSpawn(
    ws: WebSocket,
    action: string,
    issueId: string,
    buildPrompt: (issue: import('../../shared/issue-types.js').Issue, agentType: import('../../shared/agent-types.js').AgentType) => string,
  ): void {
    import('node:path').then(async ({ join }) => {
      const jsonlPath = join(this.workflowRoot, 'issues', 'issues.jsonl');
      const issues = await readIssuesJsonl(jsonlPath);
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) {
        this.sendError(ws, action, `Issue not found: ${issueId}`);
        return;
      }

      // Determine agent type from saved settings (default: claude-code)
      const savedSettings = await loadDashboardAgentSettings(this.workflowRoot, 'agent-sdk');
      const agentType = (savedSettings?.settingsFile || savedSettings?.baseUrl || savedSettings?.apiKey) ? 'agent-sdk' as const : 'claude-code' as const;

      const prompt = buildPrompt(issue, agentType);
      this.mergeSettingsAndSpawn(ws, {
        type: agentType,
        prompt,
        workDir: this.workflowRoot,
        approvalMode: 'auto',
      });
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(ws, action, message);
    });
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
