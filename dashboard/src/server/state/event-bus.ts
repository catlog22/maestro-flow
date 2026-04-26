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
import type { LearningStats } from '../../shared/learning-types.js';
import type { ScheduledTask } from '../../shared/schedule-types.js';
import type { ExtensionInfo } from '../../shared/extension-types.js';
import type { CommanderState, Decision, CommanderConfig, AssessMetrics } from '../../shared/commander-types.js';
import type {
  CoordinateStatusPayload,
  CoordinateStepPayload,
  CoordinateAnalysisPayload,
  CoordinateClarificationPayload,
} from '../../shared/coordinate-types.js';
import type {
  RequirementProgressPayload,
  RequirementExpandedPayload,
  RequirementCommittedPayload,
} from '../../shared/requirement-types.js';
import type {
  ExecutionStartedPayload,
  ExecutionCompletedPayload,
  ExecutionFailedPayload,
} from '../../shared/ws-protocol.js';
import type { CollabMember, CollabActivityEntry } from '../../shared/collab-types.js';
import type {
  TeamMailboxMessage,
  TeamPhaseState,
  TeamAgentStatus,
  RoomSessionSnapshot,
  RoomSessionSummary,
  RoomAgent,
  RoomAgentStatus as RoomAgentStatusType,
  RoomMailboxMessage,
  RoomTask,
  RoomSessionStatus,
} from '../../shared/team-types.js';

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
  'execution:scheduler_status',
  'supervisor:status',
  'supervisor:learning_update',
  'supervisor:schedule_triggered',
  'supervisor:schedule_update',
  'supervisor:extension_loaded',
  'supervisor:extension_error',
  'commander:status',
  'commander:tick',
  'commander:decision',
  'commander:config',
  'commander:assess_metrics',
  'commander:error',
  'coordinate:status',
  'coordinate:analyze_metrics',
  'coordinate:step',
  'coordinate:analysis',
  'coordinate:clarification_needed',
  'coordinate:error',
  'requirement:expanded',
  'requirement:refined',
  'requirement:committed',
  'requirement:progress',
  'workspace:switched',
  'wiki:invalidated',
  'collab:members_updated',
  'collab:activity',
  // Team events
  'team:message',
  'team:dispatch',
  'team:phase',
  'team:agent_status',
  // Room events
  'room:created',
  'room:closed',
  'room:agent_joined',
  'room:agent_left',
  'room:agent_status',
  'room:message',
  'room:broadcast',
  'room:task_created',
  'room:task_updated',
  'room:phase_changed',
  'room:snapshot',
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
  'execution:scheduler_status': SupervisorStatus;
  'supervisor:status': SupervisorStatus;
  'supervisor:learning_update': LearningStats;
  'supervisor:schedule_triggered': { taskId: string; taskName: string; taskType: string };
  'supervisor:schedule_update': { tasks: ScheduledTask[] };
  'supervisor:extension_loaded': { extensions: ExtensionInfo[] };
  'supervisor:extension_error': { name: string; error: string };
  // Commander events
  'commander:status': CommanderState;
  'commander:tick': CommanderState;
  'commander:decision': Decision;
  'commander:config': CommanderConfig;
  'commander:assess_metrics': AssessMetrics;
  'commander:error': { error: string; context: string; timestamp: number };
  // Coordinate events
  'coordinate:status': CoordinateStatusPayload;
  'coordinate:step': CoordinateStepPayload;
  'coordinate:analysis': CoordinateAnalysisPayload;
  'coordinate:clarification_needed': CoordinateClarificationPayload;
  'coordinate:analyze_metrics': AssessMetrics;
  'coordinate:error': { error: string; context: string; step: number; timestamp: number };
  // Requirement events
  'requirement:expanded': RequirementExpandedPayload;
  'requirement:refined': RequirementExpandedPayload;
  'requirement:committed': RequirementCommittedPayload;
  'requirement:progress': RequirementProgressPayload;
  // Workspace events
  'workspace:switched': { workspace: string };
  // Wiki index events
  'wiki:invalidated': { at: number; path?: string };
  // Collab events
  'collab:members_updated': CollabMember[];
  'collab:activity': CollabActivityEntry;
  // Team events
  'team:message': TeamMailboxMessage;
  'team:dispatch': TeamMailboxMessage;
  'team:phase': TeamPhaseState;
  'team:agent_status': TeamAgentStatus;
  // Room events
  'room:created': RoomSessionSummary;
  'room:closed': { sessionId: string };
  'room:agent_joined': { sessionId: string; agent: RoomAgent };
  'room:agent_left': { sessionId: string; role: string };
  'room:agent_status': { sessionId: string; role: string; status: RoomAgentStatusType };
  'room:message': { sessionId: string; message: RoomMailboxMessage };
  'room:broadcast': { sessionId: string; message: RoomMailboxMessage };
  'room:task_created': { sessionId: string; task: RoomTask };
  'room:task_updated': { sessionId: string; task: RoomTask };
  'room:phase_changed': { sessionId: string; status: RoomSessionStatus };
  'room:snapshot': RoomSessionSnapshot;
}

// ---------------------------------------------------------------------------
// Typed event bus wrapping Node.js EventEmitter
// ---------------------------------------------------------------------------

export class DashboardEventBus {
  private readonly emitter = new EventEmitter();
  private readonly ringBuffer: SSEEvent[] = [];
  private readonly maxBufferSize = 1000;

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

    // Append to ring buffer for audit trail
    this.ringBuffer.push(event);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.ringBuffer.shift();
    }
  }

  /** Get recent events from the ring buffer, optionally filtered by type prefix */
  getRecentEvents(limit = 100, typePrefix?: string): SSEEvent[] {
    let events = this.ringBuffer;
    if (typePrefix) {
      events = events.filter((e) => e.type.startsWith(typePrefix));
    }
    return events.slice(-limit);
  }

  /** Get current ring buffer size */
  getBufferSize(): number {
    return this.ringBuffer.length;
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
