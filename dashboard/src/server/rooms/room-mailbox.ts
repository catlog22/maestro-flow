// ---------------------------------------------------------------------------
// RoomMailbox — in-memory message store with atomic readUnread
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import type { RoomMailboxMessage, MessagePriority } from './room-types.js';

export class RoomMailbox {
  private readonly messages = new Map<string, RoomMailboxMessage[]>();

  /** Write a message into the session mailbox. Returns the generated message. */
  write(
    sessionId: string,
    from: string,
    to: string,
    content: string,
    priority: MessagePriority = 'normal',
  ): RoomMailboxMessage {
    const msg: RoomMailboxMessage = {
      id: randomUUID(),
      sessionId,
      from,
      to,
      content,
      priority,
      read: false,
      createdAt: new Date().toISOString(),
    };

    let list = this.messages.get(sessionId);
    if (!list) {
      list = [];
      this.messages.set(sessionId, list);
    }
    list.push(msg);

    return msg;
  }

  /**
   * Atomically read all unread messages for an agent in a session.
   * Marks returned messages as read so subsequent calls won't return them again.
   * Pass `to = '*'` to read broadcast messages only.
   */
  readUnread(sessionId: string, agentRole: string): RoomMailboxMessage[] {
    const list = this.messages.get(sessionId);
    if (!list) return [];

    const unread: RoomMailboxMessage[] = [];
    for (const msg of list) {
      if (msg.read) continue;
      if (msg.to === agentRole || msg.to === '*') {
        msg.read = true;
        unread.push(msg);
      }
    }

    return unread;
  }

  /** Get full message history for a session */
  getHistory(sessionId: string): RoomMailboxMessage[] {
    return this.messages.get(sessionId) ?? [];
  }

  /** Get message history filtered to a specific agent (sent or received) */
  getHistoryForAgent(sessionId: string, agentRole: string): RoomMailboxMessage[] {
    const list = this.messages.get(sessionId);
    if (!list) return [];
    return list.filter(
      (msg) => msg.from === agentRole || msg.to === agentRole || msg.to === '*',
    );
  }

  /** Clear all messages for a session */
  clear(sessionId: string): void {
    this.messages.delete(sessionId);
  }
}
