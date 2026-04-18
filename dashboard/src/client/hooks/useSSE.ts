import { useEffect, useRef } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { useWikiStore } from '@/client/store/wiki-store.js';
import { useCollabStore } from '@/client/store/collab-store.js';
import { SSE_ENDPOINT, SSE_EVENT_TYPES } from '@/shared/constants.js';
import type { BoardState, PhaseCard } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// useSSE — connect to /events, dispatch to board store, auto-reconnect
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 3000;

export function useSSE(): void {
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    // Access actions via getState() to avoid selector re-renders
    const { setBoard, updatePhase, updateTask, setConnected, setWorkspace } = useBoardStore.getState();

    function connect() {
      if (disposed) return;

      const es = new EventSource(SSE_ENDPOINT);
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
      };

      // Named event listeners matching SSE_EVENT_TYPES
      es.addEventListener(SSE_EVENT_TYPES.BOARD_FULL, (e) => {
        try {
          const board: BoardState = JSON.parse(e.data);
          setBoard(board);
        } catch (err) { console.warn('[SSE] Failed to parse board:full event', err); }
      });

      es.addEventListener(SSE_EVENT_TYPES.PHASE_UPDATED, (e) => {
        try {
          const phase: PhaseCard = JSON.parse(e.data);
          updatePhase(phase.phase, phase);
        } catch (err) { console.warn('[SSE] Failed to parse phase:updated event', err); }
      });

      es.addEventListener(SSE_EVENT_TYPES.TASK_UPDATED, (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.id) {
            updateTask(data.id, data);
          }
        } catch (err) { console.warn('[SSE] Failed to parse task:updated event', err); }
      });

      es.addEventListener(SSE_EVENT_TYPES.PROJECT_UPDATED, (e) => {
        try {
          const project = JSON.parse(e.data);
          const board = useBoardStore.getState().board;
          if (board) {
            setBoard({ ...board, project });
          }
        } catch (err) { console.warn('[SSE] Failed to parse project:updated event', err); }
      });

      es.addEventListener(SSE_EVENT_TYPES.WORKSPACE_SWITCHED, (e) => {
        try {
          const { workspace } = JSON.parse((e as MessageEvent).data);
          setBoard(null);
          setWorkspace(workspace);
        } catch (err) { console.warn('[SSE] Failed to parse workspace:switched event', err); }
      });

      // Heartbeat — just confirms connection is alive
      es.addEventListener(SSE_EVENT_TYPES.HEARTBEAT, () => {
        // no-op, connection is alive
      });

      // Wiki index refreshed on server — refetch if the wiki page is mounted
      es.addEventListener(SSE_EVENT_TYPES.WIKI_INVALIDATED, () => {
        void useWikiStore.getState().fetchEntries();
        void useWikiStore.getState().fetchHealth();
      });

      // Collab — members updated or new activity
      es.addEventListener(SSE_EVENT_TYPES.COLLAB_MEMBERS_UPDATED, () => {
        void useCollabStore.getState().fetchMembers();
      });
      es.addEventListener(SSE_EVENT_TYPES.COLLAB_ACTIVITY, () => {
        void useCollabStore.getState().fetchActivity();
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;

        // Schedule reconnect
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setConnected(false);
    };
  }, []); // No deps — actions from getState() are stable
}
