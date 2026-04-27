import { WebSocket } from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { WsHandler } from '../ws-handler.js';
import type { WsEventType } from '../../../shared/ws-protocol.js';
import type { AgentConfig } from '../../../shared/agent-types.js';
import type { AgentManager } from '../../agents/agent-manager.js';
import type { DashboardEventBus } from '../../state/event-bus.js';
import { loadDashboardAgentSettings } from '../../config.js';
import { EntryNormalizer } from '../../agents/entry-normalizer.js';
import { handleDelegateMessage } from '../../../../../src/async/delegate-control.js';
import type { RoomSessionManager } from '../../rooms/room-session-manager.js';
import type { RoomMcpAgentType } from '../../rooms/meeting-room-session.js';

type DelegateMessageHandler = typeof handleDelegateMessage;

// ---------------------------------------------------------------------------
// AgentWsHandler — spawn, stop, message, approve, CLI bridge forwarding
// ---------------------------------------------------------------------------

export class AgentWsHandler implements WsHandler {
  readonly actions = [
    'spawn',
    'stop',
    'message',
    'delegate:message',
    'approve',
    'cli:spawned',
    'cli:entry',
    'cli:stopped',
  ] as const;

  constructor(
    private readonly agentManager: AgentManager,
    private readonly eventBus: DashboardEventBus,
    private readonly workflowRoot: string,
    private readonly delegateMessage: DelegateMessageHandler = handleDelegateMessage,
    private readonly roomSessionManager?: RoomSessionManager,
  ) {}

  async handle(
    action: string,
    data: unknown,
    ws: WebSocket,
    broadcast: (type: WsEventType, data: unknown) => void,
  ): Promise<void> {
    const msg = data as Record<string, unknown>;

    switch (action) {
      case 'spawn':
        await this.mergeSettingsAndSpawn(ws, msg.config as AgentConfig);
        break;

      case 'stop':
        await this.agentManager.stop(msg.processId as string);
        break;

      case 'message':
        await this.agentManager.sendMessage(
          msg.processId as string,
          msg.content as string,
        );
        break;

      case 'delegate:message': {
        const delivery = msg.delivery as string;
        const content = String(msg.content ?? '').trim();
        const execId = typeof msg.execId === 'string' && msg.execId.trim()
          ? msg.execId.trim()
          : typeof msg.processId === 'string'
            ? msg.processId
            : '';

        if (!execId) {
          throw new Error('processId or execId is required');
        }
        if (!content) {
          throw new Error('content is required');
        }
        if (delivery !== 'inject' && delivery !== 'after_complete') {
          throw new Error('delivery must be inject or after_complete');
        }

        this.delegateMessage({
          execId,
          message: content,
          delivery,
          requestedBy: 'dashboard:ws:delegate_message',
        });
        break;
      }

      case 'approve':
        await this.agentManager.respondApproval({
          id: msg.requestId as string,
          processId: msg.processId as string,
          allow: msg.allow as boolean,
        });
        break;

      case 'cli:spawned': {
        const proc = msg.process as import('../../../shared/agent-types.js').AgentProcess;
        this.agentManager.registerCliProcess(proc);
        this.eventBus.emit('agent:spawned', proc);
        if (proc.config?.prompt) {
          const userEntry = EntryNormalizer.userMessage(proc.id, proc.config.prompt);
          this.agentManager.addCliEntry(proc.id, userEntry);
          this.eventBus.emit('agent:entry', userEntry);
        }
        break;
      }

      case 'cli:entry': {
        const entry = msg.entry as import('../../../shared/agent-types.js').NormalizedEntry;
        this.agentManager.addCliEntry(entry.processId, entry);
        this.eventBus.emit('agent:entry', entry);
        break;
      }

      case 'cli:stopped':
        this.agentManager.updateCliProcessStatus(
          msg.processId as string,
          'stopped',
        );
        this.eventBus.emit('agent:stopped', { processId: msg.processId as string });
        break;
    }
  }

  /**
   * Merge saved agent settings into spawn config, then spawn.
   * Public so ExecutionWsHandler can reuse it for issue analyze/plan.
   */
  async mergeSettingsAndSpawn(ws: WebSocket, config: AgentConfig): Promise<void> {
    const saved = await loadDashboardAgentSettings(this.workflowRoot, config.type);
    const mergedConfig = {
      ...config,
      model: (config.model ?? saved?.model) || undefined,
      approvalMode: config.approvalMode ?? saved?.approvalMode ?? undefined,
      baseUrl: (config.baseUrl ?? saved?.baseUrl) || undefined,
      apiKey: (config.apiKey ?? saved?.apiKey) || undefined,
      settingsFile: (config.settingsFile ?? saved?.settingsFile) || undefined,
      envFile: (config.envFile ?? saved?.envFile) || undefined,
    };
    // Inject MCP config if agent is being added to a meeting room
    const roomSessionId = mergedConfig.metadata?.roomSessionId as string | undefined;
    const roomRole = mergedConfig.metadata?.roomRole as string | undefined;
    if (roomSessionId && roomRole && this.roomSessionManager) {
      const session = this.roomSessionManager.getSession(roomSessionId);
      if (session) {
        // Ensure MCP TCP server is running (idempotent)
        await session.startMcp();

        const projectRoot = resolve(this.workflowRoot, '..');

        // Inject MCP config based on agent type
        const MCP_AGENT_TYPES: Record<string, RoomMcpAgentType> = {
          'claude-code': 'claude-code',
          'agent-sdk': 'agent-sdk',
          'codex': 'codex',
        };
        const mcpAgentType = MCP_AGENT_TYPES[mergedConfig.type];
        if (mcpAgentType) {
          if (mcpAgentType === 'claude-code') {
            // Use HTTP transport — Claude Code --print mode doesn't connect
            // stdio MCP servers (stays "pending" forever). HTTP servers connect
            // immediately since the dashboard HTTP server is already running.
            const mcpInfo = session.getMcpInfo();
            const httpUrl = `http://127.0.0.1:3001/api/rooms/${roomSessionId}/mcp?token=${mcpInfo?.token ?? ''}&agentId=${roomRole}`;
            const mcpJsonPath = join(projectRoot, '.mcp.json');
            try {
              const existing = existsSync(mcpJsonPath)
                ? JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
                : { mcpServers: {} };
              existing.mcpServers['meeting-room'] = {
                type: 'http',
                url: httpUrl,
              };
              writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2));
            } catch {
              // Fallback to --mcp-config tmp file
              const tmpPath = join(tmpdir(), `mr-mcp-${roomSessionId}-${roomRole}.json`);
              writeFileSync(tmpPath, JSON.stringify({
                mcpServers: { 'meeting-room': { type: 'http', url: httpUrl } },
              }));
              mergedConfig.mcpConfigPath = tmpPath;
            }
          } else if (mcpAgentType === 'agent-sdk') {
            const mcpServer = session.getMcpConfig('agent-sdk', roomRole);
            mergedConfig.metadata = { ...mergedConfig.metadata, roomMcpServer: mcpServer };
          }
          // codex uses stdio config via env vars (handled by adapter)
        }

        // Claude Code in room → force interactive mode for follow-up wake messages
        // Also set workDir to project root so it finds .mcp.json
        if (mergedConfig.type === 'claude-code') {
          mergedConfig.interactive = true;
          mergedConfig.workDir = projectRoot;
        }

        // Leader → auto bypass permissions (needs free MCP tool access)
        if (roomRole === 'leader') {
          mergedConfig.approvalMode = mergedConfig.approvalMode ?? 'auto';
        }
      }
    }

    const proc = await this.agentManager.spawn(mergedConfig.type, mergedConfig);

    // Auto-link to meeting room if metadata contains room context
    if (roomSessionId && roomRole && this.roomSessionManager) {
      const session = this.roomSessionManager.getSession(roomSessionId);
      if (session) {
        const agent = session.addAgent(roomRole, proc.id);
        this.eventBus.emit('room:agent_joined', { sessionId: roomSessionId, agent });
      }
    }

    const response = {
      type: 'agent:spawned' as const,
      data: proc,
      timestamp: new Date().toISOString(),
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }
}
