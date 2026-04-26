// ---------------------------------------------------------------------------
// RoomAgentRegistry — agent lifecycle management with activeWakes guard
// ---------------------------------------------------------------------------

import type { AgentManager } from '../agents/agent-manager.js';
import type { RoomAgent, RoomAgentStatus } from './room-types.js';

const DEFAULT_WAKE_TIMEOUT_MS = 5_000;

export class RoomAgentRegistry {
  private readonly agents = new Map<string, RoomAgent[]>();
  private readonly activeWakes = new Set<string>(); // "sessionId:role" keys
  private readonly wakeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly agentManager: AgentManager,
    private readonly wakeTimeoutMs: number = DEFAULT_WAKE_TIMEOUT_MS,
  ) {}

  /** Register an agent in a session */
  register(sessionId: string, role: string, processId?: string): RoomAgent {
    const now = new Date().toISOString();
    const agent: RoomAgent = {
      role,
      processId,
      status: 'idle',
      joinedAt: now,
      lastActivityAt: now,
    };

    let list = this.agents.get(sessionId);
    if (!list) {
      list = [];
      this.agents.set(sessionId, list);
    }

    // Replace existing agent with same role if present
    const existingIdx = list.findIndex((a) => a.role === role);
    if (existingIdx !== -1) {
      list[existingIdx] = agent;
    } else {
      list.push(agent);
    }

    return agent;
  }

  /** Unregister an agent from a session */
  unregister(sessionId: string, role: string): boolean {
    const list = this.agents.get(sessionId);
    if (!list) return false;

    const idx = list.findIndex((a) => a.role === role);
    if (idx === -1) return false;

    list.splice(idx, 1);

    // Clean up wake guard
    const wakeKey = `${sessionId}:${role}`;
    this.clearWakeGuard(wakeKey);

    return true;
  }

  /** Get all agents in a session */
  getAgents(sessionId: string): RoomAgent[] {
    return this.agents.get(sessionId) ?? [];
  }

  /** Get a specific agent by role in a session */
  getAgentByRole(sessionId: string, role: string): RoomAgent | undefined {
    const list = this.agents.get(sessionId);
    if (!list) return undefined;
    return list.find((a) => a.role === role);
  }

  /** Update agent status */
  setStatus(sessionId: string, role: string, status: RoomAgentStatus): boolean {
    const agent = this.getAgentByRole(sessionId, role);
    if (!agent) return false;

    agent.status = status;
    agent.lastActivityAt = new Date().toISOString();
    return true;
  }

  /**
   * Wake an agent by sending a message to its process.
   * Uses an activeWakes guard set to prevent concurrent wake calls for the same agent.
   * Guard auto-clears after wakeTimeoutMs.
   */
  async wake(sessionId: string, role: string, message: string): Promise<boolean> {
    const agent = this.getAgentByRole(sessionId, role);
    if (!agent?.processId) return false;

    const wakeKey = `${sessionId}:${role}`;

    // Guard: prevent concurrent wakes for the same agent
    if (this.activeWakes.has(wakeKey)) {
      return false;
    }

    this.activeWakes.add(wakeKey);

    // Auto-clear guard after timeout
    const timer = setTimeout(() => {
      this.clearWakeGuard(wakeKey);
    }, this.wakeTimeoutMs);
    this.wakeTimeouts.set(wakeKey, timer);

    try {
      await this.agentManager.sendMessage(agent.processId, message);
      agent.lastActivityAt = new Date().toISOString();
      return true;
    } catch {
      // Clear guard on failure so retry is possible
      this.clearWakeGuard(wakeKey);
      return false;
    }
  }

  /** Clear all agents for a session */
  clear(sessionId: string): void {
    const list = this.agents.get(sessionId);
    if (list) {
      for (const agent of list) {
        const wakeKey = `${sessionId}:${agent.role}`;
        this.clearWakeGuard(wakeKey);
      }
    }
    this.agents.delete(sessionId);
  }

  private clearWakeGuard(wakeKey: string): void {
    this.activeWakes.delete(wakeKey);
    const timer = this.wakeTimeouts.get(wakeKey);
    if (timer) {
      clearTimeout(timer);
      this.wakeTimeouts.delete(wakeKey);
    }
  }
}
