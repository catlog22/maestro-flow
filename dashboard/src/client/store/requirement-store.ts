import { create } from 'zustand';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import type {
  ExpandedRequirement,
  ExpansionDepth,
  RequirementProgressPayload,
  RequirementExpandedPayload,
  RequirementCommittedPayload,
  RequirementErrorPayload,
} from '@/shared/requirement-types.js';

// ---------------------------------------------------------------------------
// Requirement store -- state for requirement expansion lifecycle
// ---------------------------------------------------------------------------

/** Stored result of a committed requirement for board page access */
export interface CommittedResult {
  requirementId: string;
  mode: 'issues' | 'coordinate';
  issueIds?: string[];
  coordinateSessionId?: string;
}

export interface RequirementStore {
  currentRequirement: ExpandedRequirement | null;
  history: ExpandedRequirement[];
  isLoading: boolean;
  error: string | null;
  progressMessage: string | null;
  committedResult: CommittedResult | null;
  /** When set, the next expand will use this requirement as context */
  continueFrom: ExpandedRequirement | null;

  // Actions that send WS messages
  expand: (text: string, depth?: ExpansionDepth, method?: string) => void;
  refine: (feedback: string) => void;
  commit: (mode: 'issues' | 'coordinate') => void;
  resetRequirement: () => void;
  loadHistory: (id: string) => void;
  setContinueFrom: (req: ExpandedRequirement | null) => void;

  // Fetch persisted history from server
  fetchHistory: () => Promise<void>;

  // WS event handlers (called from useWebSocket)
  onProgress: (payload: RequirementProgressPayload) => void;
  onExpanded: (payload: RequirementExpandedPayload) => void;
  onCommitted: (payload: RequirementCommittedPayload) => void;
  onError: (payload: RequirementErrorPayload) => void;

  // Local item editing
  updateItem: (itemId: string, updates: Partial<ExpandedRequirement['items'][number]>) => void;
}

/** Add or update a requirement in the history array */
function upsertHistory(history: ExpandedRequirement[], req: ExpandedRequirement): ExpandedRequirement[] {
  const idx = history.findIndex((h) => h.id === req.id);
  if (idx >= 0) {
    const next = [...history];
    next[idx] = req;
    return next;
  }
  return [req, ...history];
}

export const useRequirementStore = create<RequirementStore>((set, get) => ({
  currentRequirement: null,
  history: [],
  isLoading: false,
  error: null,
  progressMessage: null,
  committedResult: null,
  continueFrom: null,

  expand: (text, depth, method) => {
    const continueFrom = get().continueFrom;
    set({
      isLoading: true,
      error: null,
      progressMessage: null,
      committedResult: null,
      continueFrom: null,
      currentRequirement: {
        id: '',
        status: 'expanding',
        userInput: text,
        title: '',
        summary: '',
        items: [],
        depth: depth ?? 'standard',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    try {
      sendWsMessage({
        action: 'requirement:expand',
        text,
        depth,
        method: (method ?? 'sdk') as 'sdk' | 'cli',
        ...(continueFrom ? { previousRequirementId: continueFrom.id } : {}),
      });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refine: (feedback) => {
    const req = get().currentRequirement;
    if (!req) return;
    set({
      isLoading: true,
      error: null,
      progressMessage: null,
      currentRequirement: { ...req, status: 'expanding' },
    });
    try {
      sendWsMessage({
        action: 'requirement:refine',
        requirementId: req.id,
        feedback,
      });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  commit: (mode) => {
    const req = get().currentRequirement;
    if (!req) return;
    set({
      isLoading: true,
      error: null,
      progressMessage: null,
      currentRequirement: { ...req, status: 'committing' },
    });
    try {
      sendWsMessage({
        action: 'requirement:commit',
        requirementId: req.id,
        mode,
      });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  resetRequirement: () => {
    set({
      currentRequirement: null,
      isLoading: false,
      error: null,
      progressMessage: null,
      committedResult: null,
      continueFrom: null,
    });
  },

  setContinueFrom: (req) => {
    set({ continueFrom: req });
  },

  loadHistory: (id) => {
    const item = get().history.find((h) => h.id === id);
    if (item) {
      set({
        currentRequirement: item,
        isLoading: false,
        error: null,
        progressMessage: null,
        committedResult: null,
      });
    }
  },

  fetchHistory: async () => {
    try {
      const res = await fetch('/api/requirements');
      if (!res.ok) return;
      const data = (await res.json()) as ExpandedRequirement[];
      if (Array.isArray(data) && data.length > 0) {
        set({ history: data });
      }
    } catch {
      // Non-fatal — history is convenience, not critical
    }
  },

  onProgress: (payload) => {
    set((state) => {
      const req = state.currentRequirement;
      if (!req) return state;
      const isFailed = payload.status === 'failed';
      return {
        currentRequirement: {
          ...req,
          status: payload.status,
          ...(isFailed && payload.message ? { error: payload.message } : {}),
        },
        progressMessage: payload.message ?? null,
        ...(isFailed ? { isLoading: false, error: payload.message ?? 'Expansion failed' } : {}),
      };
    });
  },

  onExpanded: (payload) => {
    set((state) => ({
      currentRequirement: payload.requirement,
      isLoading: false,
      progressMessage: null,
      history: upsertHistory(state.history, payload.requirement),
    }));
  },

  onCommitted: (payload) => {
    set((state) => {
      const req = state.currentRequirement;
      if (!req || req.id !== payload.requirementId) return state;
      const updated = { ...req, status: 'done' as const };
      return {
        currentRequirement: updated,
        isLoading: false,
        progressMessage: null,
        committedResult: {
          requirementId: payload.requirementId,
          mode: payload.mode,
          issueIds: payload.issueIds,
          coordinateSessionId: payload.coordinateSessionId,
        },
        history: upsertHistory(state.history, updated),
      };
    });
  },

  onError: (payload) => {
    set((state) => {
      const req = state.currentRequirement;
      const updated = req
        ? { ...req, status: 'failed' as const, error: payload.error }
        : null;
      return {
        currentRequirement: updated,
        isLoading: false,
        error: payload.error,
        progressMessage: null,
      };
    });
  },

  updateItem: (itemId, updates) => {
    set((state) => {
      const req = state.currentRequirement;
      if (!req) return state;
      return {
        currentRequirement: {
          ...req,
          items: req.items.map((item) =>
            item.id === itemId ? { ...item, ...updates } : item,
          ),
        },
      };
    });
  },
}));
