import { create } from 'zustand';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import type { CoordinateSession, CoordinateStep, CoordinateStepPayload, CoordinateAnalysisPayload, CoordinateClarificationPayload } from '@/shared/coordinate-types.js';

// ---------------------------------------------------------------------------
// Coordinate store -- session state for coordinate runner UI
// ---------------------------------------------------------------------------

export interface CoordinateStore {
  session: CoordinateSession | null;
  selectedStepIndex: number | null;
  clarificationQuestion: string | null;

  // WS event handlers (called from useWebSocket)
  onStatus: (session: CoordinateSession) => void;
  onStep: (payload: CoordinateStepPayload) => void;
  onAnalysis: (payload: CoordinateAnalysisPayload) => void;
  onClarificationNeeded: (payload: CoordinateClarificationPayload) => void;

  // Actions that send WS messages
  start: (intent: string, tool?: string, autoMode?: boolean) => void;
  stop: () => void;
  resume: (sessionId?: string) => void;
  sendClarification: (sessionId: string, response: string) => void;

  // UI actions
  selectStep: (index: number | null) => void;
}

export const useCoordinateStore = create<CoordinateStore>((set) => ({
  session: null,
  selectedStepIndex: null,
  clarificationQuestion: null,

  onStatus: (session) =>
    set({ session }),

  onStep: (payload) =>
    set((state) => {
      if (!state.session || state.session.sessionId !== payload.sessionId) return state;
      const steps = [...state.session.steps];
      const idx = steps.findIndex((s) => s.index === payload.step.index);
      if (idx >= 0) {
        steps[idx] = payload.step;
      } else {
        steps.push(payload.step);
      }
      return {
        session: { ...state.session, steps },
      };
    }),

  onAnalysis: (payload) =>
    set((state) => {
      if (!state.session || state.session.sessionId !== payload.sessionId) return state;
      const steps: CoordinateStep[] = payload.steps.map((s, i) => ({
        index: i,
        cmd: s.cmd,
        args: s.args,
        status: 'pending',
        processId: null,
        analysis: null,
        summary: null,
      }));
      return {
        session: {
          ...state.session,
          chainName: payload.chainName,
          intent: payload.intent,
          steps,
        },
      };
    }),

  onClarificationNeeded: (payload) =>
    set((state) => {
      if (!state.session || state.session.sessionId !== payload.sessionId) return state;
      return { clarificationQuestion: payload.question };
    }),

  start: (intent, tool, autoMode) => {
    sendWsMessage({
      action: 'coordinate:start',
      intent,
      tool,
      autoMode,
    });
  },

  stop: () => {
    sendWsMessage({ action: 'coordinate:stop' });
  },

  resume: (sessionId) => {
    const sid = sessionId ?? useCoordinateStore.getState().session?.sessionId;
    sendWsMessage({ action: 'coordinate:resume', sessionId: sid });
  },

  sendClarification: (sessionId, response) => {
    sendWsMessage({ action: 'coordinate:clarify', sessionId, response });
    set({ clarificationQuestion: null });
  },

  selectStep: (index) =>
    set({ selectedStepIndex: index }),
}));
