import type { WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// SessionScopedEventFilter — tracks which room sessions each WS client
// subscribes to, so room:* events are only sent to interested clients.
// ---------------------------------------------------------------------------

export class SessionScopedEventFilter {
  /** Map of WebSocket client -> set of subscribed session IDs */
  private readonly subscriptions = new Map<WebSocket, Set<string>>();

  /** Subscribe a client to a specific room session */
  subscribe(ws: WebSocket, sessionId: string): void {
    let sessions = this.subscriptions.get(ws);
    if (!sessions) {
      sessions = new Set();
      this.subscriptions.set(ws, sessions);
    }
    sessions.add(sessionId);
  }

  /** Unsubscribe a client from a specific room session */
  unsubscribe(ws: WebSocket, sessionId: string): void {
    const sessions = this.subscriptions.get(ws);
    if (!sessions) return;
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      this.subscriptions.delete(ws);
    }
  }

  /** Check if a client is subscribed to a specific room session */
  isSubscribed(ws: WebSocket, sessionId: string): boolean {
    const sessions = this.subscriptions.get(ws);
    return sessions !== undefined && sessions.has(sessionId);
  }

  /** Remove all subscriptions for a client (called on disconnect) */
  unsubscribeAll(ws: WebSocket): void {
    this.subscriptions.delete(ws);
  }
}
