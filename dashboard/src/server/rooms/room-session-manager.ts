// ---------------------------------------------------------------------------
// RoomSessionManager — manages all MeetingRoomSession instances
// ---------------------------------------------------------------------------

import type { AgentManager } from '../agents/agent-manager.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import { MeetingRoomSession } from './meeting-room-session.js';

export class RoomSessionManager {
  private readonly sessions = new Map<string, MeetingRoomSession>();

  constructor(
    private readonly agentManager: AgentManager,
    private readonly eventBus: DashboardEventBus,
  ) {}

  /** Create a new meeting room session */
  createSession(sessionId: string): MeetingRoomSession {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Room session already exists: ${sessionId}`);
    }

    const session = new MeetingRoomSession(sessionId, this.eventBus, this.agentManager);
    this.sessions.set(sessionId, session);
    return session;
  }

  /** Get an existing session by ID */
  getSession(sessionId: string): MeetingRoomSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all active session IDs */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Destroy a specific session and clean up resources */
  async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    await session.destroy();
    this.sessions.delete(sessionId);
    return true;
  }

  /** Destroy all sessions — used during server shutdown */
  async destroyAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.sessions.values()).map((session) => session.destroy()),
    );
    this.sessions.clear();
  }
}
