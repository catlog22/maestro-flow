import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { SSEEvent } from '../../shared/types.js';
import type { WsServerMessage, WsClientMessage, WsEventType } from '../../shared/ws-protocol.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type { WsHandler } from './ws-handler.js';
import type { SessionScopedEventFilter } from './session-scoped-event-filter.js';

// ---------------------------------------------------------------------------
// WebSocketManager — manages WS clients, bridges EventBus to WS broadcast
// ---------------------------------------------------------------------------

export class WebSocketManager {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly eventListener: (event: SSEEvent) => void;
  private readonly routingTable = new Map<string, WsHandler>();

  constructor(
    private readonly eventBus: DashboardEventBus,
    handlers: WsHandler[],
    private readonly sessionFilter?: SessionScopedEventFilter,
  ) {
    // Build routing table from handlers
    for (const handler of handlers) {
      for (const action of handler.actions) {
        this.routingTable.set(action, handler);
      }
    }

    this.wss = new WebSocketServer({ noServer: true });

    // Subscribe to all EventBus events and broadcast as WsServerMessage.
    // Session-scoped room events are only sent to subscribed clients;
    // lifecycle events (room:created, room:closed) and all non-room events
    // continue broadcasting to every connected client.
    this.eventListener = (event: SSEEvent) => {
      if (
        this.sessionFilter &&
        event.type.startsWith('room:') &&
        event.type !== 'room:created' &&
        event.type !== 'room:closed'
      ) {
        const payload = event.data as Record<string, unknown> | null;
        const sessionId = payload?.sessionId as string | undefined;
        if (sessionId) {
          this.broadcastToSubscribed(event.type, event.data, sessionId);
          return;
        }
      }
      this.broadcast(event.type, event.data);
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
        this.sessionFilter?.unsubscribeAll(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
        this.sessionFilter?.unsubscribeAll(ws);
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
   * Broadcast a session-scoped message only to clients subscribed to that session.
   */
  private broadcastToSubscribed(type: WsEventType, data: unknown, sessionId: string): void {
    if (this.clients.size === 0 || !this.sessionFilter) return;

    const msg: WsServerMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(msg);

    for (const client of this.clients) {
      if (
        client.readyState === WebSocket.OPEN &&
        this.sessionFilter.isSubscribed(client, sessionId)
      ) {
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
   * Dispatch client messages — lookup handler from routing table and delegate.
   */
  private handleClientMessage(ws: WebSocket, msg: WsClientMessage): void {
    const handler = this.routingTable.get(msg.action);
    if (!handler) {
      console.log(`[WS] Unknown client action: ${msg.action}`);
      return;
    }

    handler
      .handle(msg.action, msg, ws, (type, data) => this.broadcast(type, data))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError(ws, msg.action, message);
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
