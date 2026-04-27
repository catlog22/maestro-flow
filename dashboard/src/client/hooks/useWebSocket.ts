import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { useCoordinateStore } from '@/client/store/coordinate-store.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { useRequirementStore } from '@/client/store/requirement-store.js';
import { useTeamStore } from '@/client/store/team-store.js';
import { WS_EVENT_TYPES } from '@/shared/constants.js';
import type { BoardState, PhaseCard } from '@/shared/types.js';
import type { WsServerMessage, WsClientMessage, ExecutionStartedPayload, ExecutionCompletedPayload, ExecutionFailedPayload } from '@/shared/ws-protocol.js';
import type { AgentProcess, NormalizedEntry, ApprovalRequest, AgentStatusPayload, AgentStoppedPayload, AgentThoughtPayload, AgentStreamingPayload, TokenUsageEntry } from '@/shared/agent-types.js';
import type { SupervisorStatus } from '@/shared/execution-types.js';
import type { CommanderState, Decision } from '@/shared/commander-types.js';
import type { CoordinateStatusPayload, CoordinateStepPayload, CoordinateAnalysisPayload, CoordinateClarificationPayload } from '@/shared/coordinate-types.js';
import type { RequirementProgressPayload, RequirementExpandedPayload, RequirementCommittedPayload, RequirementErrorPayload } from '@/shared/requirement-types.js';
import type { TeamMailboxMessage, TeamPhaseState, TeamAgentStatus, RoomSessionSnapshot, RoomAgent, RoomAgentStatus, RoomMailboxMessage, RoomTask } from '@/shared/team-types.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { useRoomListStore } from '@/client/store/room-list-store.js';

// ---------------------------------------------------------------------------
// useWebSocket — connect to /ws, dispatch to stores, auto-reconnect
// ---------------------------------------------------------------------------

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** Detect protocol echo: Gemini CLI echoed input prompt stored as assistant_message in old JSONL */
const PROTOCOL_ECHO_PREFIXES = ['# Analysis Mode Protocol', '# Write Mode Protocol'];
function isProtocolEcho(content: string): boolean {
  return PROTOCOL_ECHO_PREFIXES.some(prefix => content.trimStart().startsWith(prefix));
}

/**
 * Post-process history entries loaded from disk:
 * 1. Filter out protocol echo artifacts from old Gemini JSONL
 * 2. Clear partial flag on assistant messages (session is historical)
 * 3. Consolidate consecutive assistant_message fragments into single messages
 * 4. Merge tool_use running→completed pairs
 */
function consolidateHistoryEntries(raw: NormalizedEntry[], processId: string): NormalizedEntry[] {
  const merged: NormalizedEntry[] = [];
  for (const entry of raw) {
    const fixed = { ...entry, processId } as NormalizedEntry;
    if (fixed.type === 'assistant_message') {
      // Skip protocol echo artifacts from old Gemini executions
      const content = (fixed as { content: string }).content ?? '';
      if (isProtocolEcho(content)) continue;

      (fixed as { partial: boolean }).partial = false;
      const prev = merged[merged.length - 1];
      if (prev && prev.type === 'assistant_message') {
        (prev as { content: string }).content += (fixed as { content: string }).content;
        continue;
      }
    }
    if (fixed.type === 'tool_use' && ((fixed as { status?: string }).status === 'completed' || (fixed as { status?: string }).status === 'failed')) {
      const runIdx = merged.findLastIndex(
        (e) => e.type === 'tool_use' && (e as { status?: string }).status === 'running',
      );
      if (runIdx !== -1) {
        const running = merged[runIdx] as typeof fixed;
        merged[runIdx] = {
          ...running,
          status: (fixed as { status: string }).status,
          result: (fixed as { result?: string }).result ?? (running as { result?: string }).result,
          input: ((running as { input?: Record<string, unknown> }).input && Object.keys((running as { input: Record<string, unknown> }).input).length > 0)
            ? (running as { input: Record<string, unknown> }).input
            : (fixed as { input?: Record<string, unknown> }).input,
        } as NormalizedEntry;
        continue;
      }
    }
    merged.push(fixed);
  }
  return merged;
}

/** Module-level send function so external code can send messages */
let wsSendFn: ((msg: WsClientMessage) => void) | null = null;

/** Send a client message to the server via the active WebSocket */
export function sendWsMessage(msg: WsClientMessage): void {
  if (wsSendFn) {
    wsSendFn(msg);
  } else {
    console.warn('[WS] Cannot send — no active WebSocket connection');
  }
}

/** Message types that bypass the buffer and are processed immediately */
const IMMEDIATE_MSG_TYPES = new Set([WS_EVENT_TYPES.AGENT_APPROVAL]);

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE_MS);

  useEffect(() => {
    let disposed = false;

    // --- Hydration gate: queue messages until initial API fetches complete ---
    let isHydrated = false;
    const hydrationQueue: WsServerMessage[] = [];

    // --- Message buffer: batch high-frequency messages at 100ms intervals ---
    let msgBuffer: WsServerMessage[] = [];
    let flushInterval: ReturnType<typeof setInterval> | null = null;

    // Access actions via getState() to avoid selector re-renders
    const { setBoard, updatePhase, updateTask, setConnected } = useBoardStore.getState();
    const {
      addProcess,
      removeProcess,
      updateProcessStatus,
      addEntry,
      setApproval,
      setProcessThought,
      setProcessStreaming,
      updateProcessTokenUsage,
    } = useAgentStore.getState();
    const {
      addSlot,
      removeSlot,
      setSupervisorStatus,
      setCommanderState,
      addDecision,
    } = useExecutionStore.getState();
    const {
      onStatus: coordinateOnStatus,
      onStep: coordinateOnStep,
      onAnalysis: coordinateOnAnalysis,
      onClarificationNeeded: coordinateOnClarificationNeeded,
    } = useCoordinateStore.getState();
    const { fetchIssues, patchIssue } = useIssueStore.getState();
    const {
      onProgress: requirementOnProgress,
      onExpanded: requirementOnExpanded,
      onCommitted: requirementOnCommitted,
      onError: requirementOnError,
    } = useRequirementStore.getState();
    const {
      handleTeamMessage,
      handleDispatchUpdate,
      handlePhaseTransition,
      handleAgentStatusUpdate,
      registerAgentProcess,
    } = useTeamStore.getState();
    const {
      handleSnapshot: roomHandleSnapshot,
      handleAgentJoined: roomHandleAgentJoined,
      handleAgentLeft: roomHandleAgentLeft,
      handleAgentStatus: roomHandleAgentStatus,
      handleMessage: roomHandleMessage,
      handleTaskCreated: roomHandleTaskCreated,
      handleTaskUpdated: roomHandleTaskUpdated,
      handleRoomClosed: roomHandleRoomClosed,
    } = useMeetingRoomStore.getState();
    const {
      handleRoomCreated: roomListHandleCreated,
      handleRoomClosed: roomListHandleClosed,
    } = useRoomListStore.getState();

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      // Expose send function at module level
      wsSendFn = (msg: WsClientMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      };

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = RECONNECT_BASE_MS; // reset on success

        // Reset hydration state for this connection
        isHydrated = false;

        // Resync state after reconnect — hydrate before processing queued WS messages
        const boardFetch = fetch('/api/board').then(r => r.ok ? r.json() : null).then(data => {
          if (data) setBoard(data as BoardState);
        }).catch(() => {});
        const agentsFetch = fetch('/api/agents').then(r => r.ok ? r.json() : null).then(async (agents: unknown) => {
          if (!Array.isArray(agents)) return;

          // Pre-fetch CLI history list for status reconciliation
          let historyMetas: Array<{ execId: string; completedAt?: string; exitCode?: number; delegateStatus?: string }> = [];
          try {
            const histRes = await fetch('/api/cli-history?limit=50');
            if (histRes.ok) historyMetas = await histRes.json() as typeof historyMetas;
          } catch { /* silent */ }
          const historyByExecId = new Map(historyMetas.map(m => [m.execId, m]));

          for (const proc of agents) {
              const agentProc = proc as AgentProcess;
              const isCliHistory = agentProc.id.startsWith('cli-history-');
              const isTerminal = agentProc.status === 'stopped' || agentProc.status === 'error';

              // Reconcile: if server says running but CLI history says completed, fix status
              if (isCliHistory && agentProc.status === 'running') {
                const execId = agentProc.id.slice('cli-history-'.length);
                const histMeta = historyByExecId.get(execId);
                if (histMeta?.completedAt) {
                  agentProc.status = (histMeta.exitCode != null && histMeta.exitCode !== 0) ? 'error' : 'stopped';
                }
              }

              addProcess(agentProc);

              // Skip entry fetch for terminal cli-history processes — they can be
              // loaded on demand from ChatSidebar when the user clicks them.
              // This avoids flooding the server with 404s for stale test sessions.
              if (isCliHistory && (agentProc.status === 'stopped' || agentProc.status === 'error')) {
                continue;
              }

              // Load buffered entries so chat history is visible after reconnect
              // Only for live agents or actively running/spawning cli-history processes
              if (isCliHistory) {
                // For running cli-history: fetch from disk directly (single request)
                const execId = agentProc.id.slice('cli-history-'.length);
                fetch(`/api/cli-history/${encodeURIComponent(execId)}/entries`)
                  .then(r => r.ok ? r.json() : null)
                  .then((entries: unknown) => {
                    const raw = Array.isArray(entries) ? entries as NormalizedEntry[] : [];
                    const merged = consolidateHistoryEntries(raw, agentProc.id);
                    for (const entry of merged) addEntry(agentProc.id, entry);
                  })
                  .catch(() => {});
              } else {
                fetch(`/api/agents/${encodeURIComponent(agentProc.id)}/entries`)
                  .then(r => r.ok ? r.json() : null)
                  .then((entries: unknown) => {
                    const raw = Array.isArray(entries) ? entries as NormalizedEntry[] : [];
                    for (const entry of raw) addEntry(agentProc.id, entry as NormalizedEntry);
                  })
                  .catch(() => {});
              }
          }
        }).catch(() => {});

        // Mark hydrated after initial fetches complete, then flush queued messages
        Promise.all([boardFetch, agentsFetch]).finally(() => {
          isHydrated = true;
          // Flush any messages that arrived during hydration
          const queued = hydrationQueue.splice(0);
          for (const m of queued) dispatchMessage(m);
        });
      };

      /** Dispatch a single parsed WS message to the appropriate store */
      function dispatchMessage(msg: WsServerMessage): void {
        switch (msg.type) {
          // --- Board events (same logic as useSSE) ---
          case WS_EVENT_TYPES.BOARD_FULL:
            setBoard(msg.data as BoardState);
            break;

          case WS_EVENT_TYPES.PHASE_UPDATED: {
            const phase = msg.data as PhaseCard;
            updatePhase(phase.phase, phase);
            break;
          }

          case WS_EVENT_TYPES.TASK_UPDATED: {
            const taskData = msg.data as { id: string };
            if (taskData.id) {
              updateTask(taskData.id, taskData);
            }
            break;
          }

          case WS_EVENT_TYPES.PROJECT_UPDATED: {
            const project = msg.data;
            const board = useBoardStore.getState().board;
            if (board) {
              setBoard({ ...board, project: project as BoardState['project'] });
            }
            break;
          }

          case WS_EVENT_TYPES.HEARTBEAT:
          case WS_EVENT_TYPES.CONNECTED:
            // no-op, connection is alive
            break;

          // --- Agent events ---
          case WS_EVENT_TYPES.AGENT_SPAWNED: {
            const spawned = msg.data as AgentProcess;
            addProcess(spawned);
            // Bridge: register in team-store if agent carries team metadata
            const teamSessionId = spawned.metadata?.teamSessionId as string | undefined;
            const teamRole = spawned.metadata?.teamRole as string | undefined;
            if (teamSessionId && teamRole) {
              registerAgentProcess(teamSessionId, teamRole, spawned.id);
            }
            break;
          }

          case WS_EVENT_TYPES.AGENT_ENTRY: {
            const entry = msg.data as NormalizedEntry;
            addEntry(entry.processId, entry);
            // Accumulate token usage from token_usage entries
            if (entry.type === 'token_usage') {
              const tu = entry as TokenUsageEntry;
              updateProcessTokenUsage(
                tu.processId,
                tu.inputTokens,
                tu.outputTokens,
                tu.cacheReadTokens ?? 0,
                tu.cacheWriteTokens ?? 0,
              );
            }
            break;
          }

          case WS_EVENT_TYPES.AGENT_APPROVAL:
            setApproval(msg.data as ApprovalRequest);
            break;

          case WS_EVENT_TYPES.AGENT_STATUS: {
            const statusPayload = msg.data as AgentStatusPayload;
            updateProcessStatus(statusPayload.processId, statusPayload.status);
            break;
          }

          case WS_EVENT_TYPES.AGENT_STOPPED: {
            const stoppedPayload = msg.data as AgentStoppedPayload;
            updateProcessStatus(stoppedPayload.processId, 'stopped');
            break;
          }

          case WS_EVENT_TYPES.AGENT_THOUGHT: {
            const thoughtPayload = msg.data as AgentThoughtPayload;
            setProcessThought(thoughtPayload.processId, thoughtPayload.thought);
            break;
          }

          case WS_EVENT_TYPES.AGENT_STREAMING: {
            const streamingPayload = msg.data as AgentStreamingPayload;
            setProcessStreaming(streamingPayload.processId, streamingPayload.streaming);
            break;
          }

          // --- Execution events ---
          case WS_EVENT_TYPES.EXECUTION_STARTED: {
            const started = msg.data as ExecutionStartedPayload;
            addSlot({
              issueId: started.issueId,
              processId: started.processId,
              executor: started.executor,
              startedAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
              turnNumber: 1,
              maxTurns: 3,
            });
            if (started.issue) {
              patchIssue(started.issue);
            } else {
              void fetchIssues();
            }
            break;
          }

          case WS_EVENT_TYPES.EXECUTION_COMPLETED: {
            const completed = msg.data as ExecutionCompletedPayload;
            removeSlot(completed.processId);
            if (completed.issue) {
              patchIssue(completed.issue);
            } else {
              void fetchIssues();
            }
            break;
          }

          case WS_EVENT_TYPES.EXECUTION_FAILED: {
            const failed = msg.data as ExecutionFailedPayload;
            removeSlot(failed.processId);
            if (failed.issue) {
              patchIssue(failed.issue);
            } else {
              void fetchIssues();
            }
            break;
          }

          case WS_EVENT_TYPES.SUPERVISOR_STATUS:
          case WS_EVENT_TYPES.EXECUTION_SCHEDULER_STATUS: {
            const status = msg.data as SupervisorStatus;
            setSupervisorStatus(status);
            break;
          }

          case WS_EVENT_TYPES.COMMANDER_STATUS: {
            const commanderStatus = msg.data as CommanderState;
            setCommanderState(commanderStatus);
            break;
          }

          case WS_EVENT_TYPES.COMMANDER_DECISION: {
            const decision = msg.data as Decision;
            addDecision(decision);
            break;
          }

          // --- Coordinate events ---
          case WS_EVENT_TYPES.COORDINATE_STATUS: {
            const statusData = msg.data as CoordinateStatusPayload;
            coordinateOnStatus(statusData.session);
            break;
          }

          case WS_EVENT_TYPES.COORDINATE_STEP: {
            const stepData = msg.data as CoordinateStepPayload;
            coordinateOnStep(stepData);
            break;
          }

          case WS_EVENT_TYPES.COORDINATE_ANALYSIS: {
            const analysisData = msg.data as CoordinateAnalysisPayload;
            coordinateOnAnalysis(analysisData);
            break;
          }

          case WS_EVENT_TYPES.COORDINATE_CLARIFICATION_NEEDED: {
            const clarificationData = msg.data as CoordinateClarificationPayload;
            coordinateOnClarificationNeeded(clarificationData);
            break;
          }

          // --- Requirement events ---
          case WS_EVENT_TYPES.REQUIREMENT_PROGRESS:
            requirementOnProgress(msg.data as RequirementProgressPayload);
            break;

          case WS_EVENT_TYPES.REQUIREMENT_EXPANDED:
            requirementOnExpanded(msg.data as RequirementExpandedPayload);
            break;

          case WS_EVENT_TYPES.REQUIREMENT_COMMITTED:
            requirementOnCommitted(msg.data as RequirementCommittedPayload);
            break;

          // --- Team events ---
          case WS_EVENT_TYPES.TEAM_MESSAGE:
            handleTeamMessage(msg.data as TeamMailboxMessage);
            break;

          case WS_EVENT_TYPES.TEAM_DISPATCH:
            handleDispatchUpdate(msg.data as TeamMailboxMessage);
            break;

          case WS_EVENT_TYPES.TEAM_PHASE:
            handlePhaseTransition(msg.data as TeamPhaseState);
            break;

          case WS_EVENT_TYPES.TEAM_AGENT_STATUS:
            handleAgentStatusUpdate(msg.data as TeamAgentStatus);
            break;

          // --- Room events ---
          case WS_EVENT_TYPES.ROOM_CREATED:
            roomListHandleCreated(msg.data as import('@/shared/team-types.js').RoomSessionSummary);
            break;

          case WS_EVENT_TYPES.ROOM_SNAPSHOT:
            roomHandleSnapshot(msg.data as RoomSessionSnapshot);
            break;

          case WS_EVENT_TYPES.ROOM_AGENT_JOINED: {
            const joinedData = msg.data as { sessionId: string; agent: RoomAgent };
            roomHandleAgentJoined(joinedData.agent);
            break;
          }

          case WS_EVENT_TYPES.ROOM_AGENT_LEFT: {
            const leftData = msg.data as { role: string };
            roomHandleAgentLeft(leftData.role);
            break;
          }

          case WS_EVENT_TYPES.ROOM_AGENT_STATUS: {
            const roomStatusData = msg.data as { role: string; status: RoomAgentStatus };
            roomHandleAgentStatus(roomStatusData.role, roomStatusData.status);
            break;
          }

          case WS_EVENT_TYPES.ROOM_MESSAGE:
          case WS_EVENT_TYPES.ROOM_BROADCAST: {
            const msgData = msg.data as { sessionId: string; message: RoomMailboxMessage };
            roomHandleMessage(msgData.message);
            break;
          }

          case WS_EVENT_TYPES.ROOM_TASK_CREATED: {
            const taskCreatedData = msg.data as { sessionId: string; task: RoomTask };
            roomHandleTaskCreated(taskCreatedData.task);
            break;
          }

          case WS_EVENT_TYPES.ROOM_TASK_UPDATED: {
            const taskUpdatedData = msg.data as { sessionId: string; task: RoomTask };
            roomHandleTaskUpdated(taskUpdatedData.task.id, taskUpdatedData.task);
            break;
          }

          case WS_EVENT_TYPES.ROOM_CLOSED: {
            const closedRoomData = msg.data as { sessionId: string };
            roomHandleRoomClosed();
            roomListHandleClosed(closedRoomData.sessionId);
            break;
          }

          default:
            // Ignore unknown event types
            break;
        }
      }

      /** Flush buffered messages — called on 100ms interval */
      function flushBuffer(): void {
        if (msgBuffer.length === 0) return;
        const batch = msgBuffer;
        msgBuffer = [];
        for (const m of batch) dispatchMessage(m);
      }

      // Start buffer flush interval
      flushInterval = setInterval(flushBuffer, 100);

      ws.onmessage = (event) => {
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          console.warn('[WS] Failed to parse message', event.data);
          return;
        }

        // Before hydration, queue all messages except immediate types
        if (!isHydrated) {
          if (IMMEDIATE_MSG_TYPES.has(msg.type)) {
            dispatchMessage(msg);
          } else {
            hydrationQueue.push(msg);
          }
          return;
        }

        // Immediate messages bypass the buffer entirely
        if (IMMEDIATE_MSG_TYPES.has(msg.type)) {
          dispatchMessage(msg);
          return;
        }

        // Buffer for batch processing
        msgBuffer.push(msg);
      };

      ws.onclose = () => {
        // Guard: stale handler from a previous effect cycle (StrictMode double-mount)
        if (disposed) return;

        setConnected(false);
        wsRef.current = null;
        wsSendFn = null;

        // Stop buffer flush and clear queues on disconnect
        if (flushInterval) {
          clearInterval(flushInterval);
          flushInterval = null;
        }
        msgBuffer = [];
        hydrationQueue.length = 0;
        isHydrated = false;

        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS);
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnect there
      };
    }

    connect();

    return () => {
      disposed = true;
      wsSendFn = null;
      // Clean up buffer flush interval
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        // Nullify handlers before closing to prevent stale callbacks
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, []); // No deps — actions from getState() are stable
}
