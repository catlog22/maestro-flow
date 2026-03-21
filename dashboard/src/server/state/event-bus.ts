import { EventEmitter } from 'node:events';

import type {
  SSEEvent,
  SSEEventType,
  BoardState,
  PhaseCard,
  TaskCard,
  ScratchCard,
  ProjectState,
} from '../../shared/types.js';
import type {
  AgentProcess,
  NormalizedEntry,
  ApprovalRequest,
  AgentStatusPayload,
  AgentStoppedPayload,
  AgentTurnCompletedPayload,
} from '../../shared/agent-types.js';
import type { SupervisorStatus } from '../../shared/execution-types.js';
import type { CommanderState, Decision, CommanderConfig } from '../../shared/commander-types.js';
import type {
  ExecutionStartedPayload,
  ExecutionCompletedPayload,
  ExecutionFailedPayload,
} from '../../shared/ws-protocol.js';

// ---------------------------------------------------------------------------
// All event types — single source of truth for onAny / offAny
// ---------------------------------------------------------------------------

const ALL_EVENT_TYPES: SSEEventType[] = [
  'board:full',
  'phase:updated',
  'task:updated',
  'scratch:updated',
  'project:updated',
  'watcher:error',
  'heartbeat',
  'connected',
  'agent:spawned',
  'agent:entry',
  'agent:approval',
  'agent:status',
  'agent:stopped',
  'agent:turnCompleted',
  'execution:started',
  'execution:completed',
  'execution:failed',
  'supervisor:status',
  'commander:status',
  'commander:tick',
  'commander:decision',
  'commander:config',
  'workspace:switched',
];

// ---------------------------------------------------------------------------
// Event payload map — each SSEEventType maps to its expected data shape
// ---------------------------------------------------------------------------

export interface DashboardEventMap {
  'board:full': BoardState;
  'phase:updated': PhaseCard;
  'task:updated': TaskCard;
  'scratch:updated': ScratchCard;
  'project:updated': ProjectState;
  'watcher:error': string;
  'heartbeat': null;
  'connected': null;
  // Agent lifecycle events
  'agent:spawned': AgentProcess;
  'agent:entry': NormalizedEntry;
  'agent:approval': ApprovalRequest;
  'agent:status': AgentStatusPayload;
  'agent:stopped': AgentStoppedPayload;
  'agent:turnCompleted': AgentTurnCompletedPayload;
  // Execution events
  'execution:started': ExecutionStartedPayload;
  'execution:completed': ExecutionCompletedPayload;
  'execution:failed': ExecutionFailedPayload;
  'supervisor:status': SupervisorStatus;
  // Commander events
  'commander:status': CommanderState;
  'commander:tick': CommanderState;
  'commander:decision': Decision;
  'commander:config': CommanderConfig;
  // Workspace events
  'workspace:switched': { workspace: string };
}

// ---------------------------------------------------------------------------
// Typed event bus wrapping Node.js EventEmitter
// ---------------------------------------------------------------------------

export class DashboardEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Raise limit — multiple SSE clients may subscribe
    this.emitter.setMaxListeners(50);
  }

  /** Emit a typed dashboard event */
  emit<K extends SSEEventType & keyof DashboardEventMap>(
    type: K,
    data: DashboardEventMap[K],
  ): void {
    const event: SSEEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emitter.emit(type, event);
  }

  /** Subscribe to a specific event type */
  on<K extends SSEEventType & keyof DashboardEventMap>(
    type: K,
    listener: (event: SSEEvent) => void,
  ): void {
    this.emitter.on(type, listener);
  }

  /** Unsubscribe from a specific event type */
  off<K extends SSEEventType & keyof DashboardEventMap>(
    type: K,
    listener: (event: SSEEvent) => void,
  ): void {
    this.emitter.off(type, listener);
  }

  /** Subscribe to all event types */
  onAny(listener: (event: SSEEvent) => void): void {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.on(type, listener);
    }
  }

  /** Unsubscribe from all event types */
  offAny(listener: (event: SSEEvent) => void): void {
    for (const type of ALL_EVENT_TYPES) {
      this.emitter.off(type, listener);
    }
  }

  /** Remove all listeners */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
