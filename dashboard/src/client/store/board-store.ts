import { create } from 'zustand';
import type { BoardState, PhaseCard, TaskCard } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// Board store — global state for dashboard
// ---------------------------------------------------------------------------

export interface BoardStore {
  board: BoardState | null;
  connected: boolean;
  selectedPhase: number | null;
  workspace: string | null;

  setBoard: (board: BoardState | null) => void;
  updatePhase: (phase: number, data: Partial<PhaseCard>) => void;
  updateTask: (taskId: string, data: Partial<TaskCard>) => void;
  setConnected: (status: boolean) => void;
  setSelectedPhase: (phase: number | null) => void;
  setWorkspace: (path: string | null) => void;
}

export const useBoardStore = create<BoardStore>((set) => ({
  board: null,
  connected: false,
  selectedPhase: null,
  workspace: null,

  setBoard: (board) => set({ board }),

  updatePhase: (phase, data) =>
    set((state) => {
      if (!state.board) return state;
      const phases = state.board.phases.map((p) =>
        p.phase === phase ? { ...p, ...data } : p,
      );
      return { board: { ...state.board, phases } };
    }),

  // NOTE: v0.1 limitation — TaskCard objects are not stored client-side.
  // This action bumps the parent phase's updated_at to trigger re-renders.
  // Full task data is fetched on-demand via GET /api/phases/:n/tasks.
  updateTask: (taskId, _data) =>
    set((state) => {
      if (!state.board) return state;
      const phases = state.board.phases.map((p) => {
        const idx = p.plan.task_ids.indexOf(taskId);
        if (idx === -1) return p;
        return { ...p, updated_at: new Date().toISOString() };
      });
      return { board: { ...state.board, phases } };
    }),

  setConnected: (status) => set({ connected: status }),

  setSelectedPhase: (phase) => set({ selectedPhase: phase }),

  setWorkspace: (path) => set({ workspace: path }),
}));
