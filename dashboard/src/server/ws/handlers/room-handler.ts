import { WebSocket } from 'ws';

import type { WsHandler } from '../ws-handler.js';
import type { WsEventType } from '../../../shared/ws-protocol.js';
import type { DashboardEventBus } from '../../state/event-bus.js';
import type { RoomSessionManager } from '../../rooms/room-session-manager.js';
import type { SessionScopedEventFilter } from '../session-scoped-event-filter.js';
import type {
  RoomTaskCreate,
  RoomTaskUpdate,
  RoomAgentStatus,
  RoomMessagePriority,
} from '../../../shared/team-types.js';

// ---------------------------------------------------------------------------
// RoomWsHandler — client-to-server room actions
//   room:create           -> create a new room session
//   room:close            -> destroy a room session
//   room:subscribe        -> subscribe to session events + get snapshot
//   room:unsubscribe      -> unsubscribe from session events
//   room:add_agent        -> add agent to session
//   room:remove_agent     -> remove agent from session
//   room:set_agent_status -> update agent status
//   room:send_message     -> send message to specific agent
//   room:broadcast        -> broadcast message to all agents
//   room:create_task      -> create a task
//   room:update_task      -> update a task
//   room:snapshot         -> request current snapshot
// ---------------------------------------------------------------------------

export class RoomWsHandler implements WsHandler {
  readonly actions = [
    'room:create',
    'room:close',
    'room:subscribe',
    'room:unsubscribe',
    'room:add_agent',
    'room:remove_agent',
    'room:set_agent_status',
    'room:send_message',
    'room:broadcast',
    'room:create_task',
    'room:update_task',
    'room:snapshot',
  ] as const;

  constructor(
    private readonly sessionManager: RoomSessionManager,
    private readonly eventBus: DashboardEventBus,
    private readonly filter: SessionScopedEventFilter,
  ) {}

  async handle(
    action: string,
    data: unknown,
    ws: WebSocket,
    _broadcast: (type: WsEventType, data: unknown) => void,
  ): Promise<void> {
    const msg = data as Record<string, unknown>;
    const sessionId = (msg.sessionId ?? msg.roomId) as string;

    switch (action) {
      case 'room:create': {
        const session = this.sessionManager.createSession(sessionId);
        // Start MCP TCP server for this room (agents will connect to it)
        await session.startMcp();
        // Auto-subscribe the creator so they receive room:created and all subsequent events
        this.filter.subscribe(ws, sessionId);
        const snapshot = session.getSnapshot();
        this.eventBus.emit('room:created', {
          sessionId: snapshot.sessionId,
          status: snapshot.status,
          agentCount: snapshot.agents.length,
          taskCount: snapshot.tasks.length,
          messageCount: snapshot.messages.length,
          createdAt: snapshot.createdAt,
        });
        break;
      }

      case 'room:close': {
        const destroyed = await this.sessionManager.destroySession(sessionId);
        if (destroyed) {
          this.eventBus.emit('room:closed', { sessionId });
        }
        break;
      }

      case 'room:subscribe': {
        this.filter.subscribe(ws, sessionId);
        // Send current snapshot to the subscribing client
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
          const snapshot = session.getSnapshot();
          this.eventBus.emit('room:snapshot', snapshot);
        }
        break;
      }

      case 'room:unsubscribe': {
        this.filter.unsubscribe(ws, sessionId);
        break;
      }

      case 'room:add_agent': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        const agent = session.addAgent(
          msg.role as string,
          msg.processId as string | undefined,
        );
        this.eventBus.emit('room:agent_joined', { sessionId, agent });
        break;
      }

      case 'room:remove_agent': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        const removed = session.removeAgent(msg.role as string);
        if (removed) {
          this.eventBus.emit('room:agent_left', {
            sessionId,
            role: msg.role as string,
          });
        }
        break;
      }

      case 'room:set_agent_status': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        session.setAgentStatus(
          msg.role as string,
          msg.status as RoomAgentStatus,
        );
        this.eventBus.emit('room:agent_status', {
          sessionId,
          role: msg.role as string,
          status: msg.status as RoomAgentStatus,
        });
        break;
      }

      case 'room:send_message': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        const from = (msg.from as string) || 'user';
        const mailMsg = await session.sendMessage(
          from,
          msg.to as string,
          msg.content as string,
          (msg.priority as RoomMessagePriority) || 'normal',
        );
        this.eventBus.emit('room:message', { sessionId, message: mailMsg });
        break;
      }

      case 'room:broadcast': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        const bcastFrom = (msg.from as string) || 'user';
        const bcastMsg = await session.broadcastMessage(
          bcastFrom,
          msg.content as string,
          (msg.priority as RoomMessagePriority) || 'normal',
        );
        this.eventBus.emit('room:broadcast', { sessionId, message: bcastMsg });
        break;
      }

      case 'room:create_task': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        // Accept both nested msg.task and flat fields
        const taskInput: RoomTaskCreate = (msg.task as RoomTaskCreate) ?? {
          title: msg.title as string,
          description: (msg.description as string) ?? '',
          owner: (msg.assignedTo as string) ?? (msg.owner as string),
          blockedBy: msg.blockedBy as string[] | undefined,
        };
        const task = session.createTask(taskInput);
        this.eventBus.emit('room:task_created', { sessionId, task });
        break;
      }

      case 'room:update_task': {
        const session = this.sessionManager.getSession(sessionId);
        if (!session) break;
        const updated = session.updateTask(
          msg.taskId as string,
          msg.patch as RoomTaskUpdate,
        );
        if (updated) {
          this.eventBus.emit('room:task_updated', { sessionId, task: updated });
        }
        break;
      }

      case 'room:snapshot': {
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
          this.eventBus.emit('room:snapshot', session.getSnapshot());
        }
        break;
      }
    }
  }
}
