import { create } from 'zustand';
import type { ExecutionSlot, SupervisorStatus } from '@/shared/execution-types.js';
import type { CommanderState, CommanderConfig, Decision } from '@/shared/commander-types.js';

// ---------------------------------------------------------------------------
// Execution store — global state for execution slots, multi-select, CLI panel
// ---------------------------------------------------------------------------

export interface ExecutionStore {
  slots: Record<string, ExecutionSlot>;       // processId -> slot
  queue: string[];
  supervisorStatus: SupervisorStatus | null;
  commanderState: CommanderState | null;
  commanderConfig: CommanderConfig | null;
  recentDecisions: Decision[];
  selectedIssueIds: Set<string>;              // multi-select for batch
  cliPanelIssueId: string | null;             // which issue's CLI to show

  // Slot actions
  addSlot: (slot: ExecutionSlot) => void;
  removeSlot: (processId: string) => void;
  setQueue: (queue: string[]) => void;
  setSupervisorStatus: (status: SupervisorStatus) => void;
  setCommanderState: (state: CommanderState) => void;
  setCommanderConfig: (config: CommanderConfig) => void;
  fetchCommanderConfig: () => Promise<void>;
  addDecision: (decision: Decision) => void;

  // Multi-select actions
  toggleSelect: (issueId: string) => void;
  selectAll: (issueIds: string[]) => void;
  clearSelection: () => void;

  // CLI panel actions
  openCliPanel: (issueId: string) => void;
  closeCliPanel: () => void;

  // Supervisor control
  toggleSupervisor: (enabled: boolean) => Promise<void>;

  // Derived helpers
  getSlotForIssue: (issueId: string) => ExecutionSlot | undefined;
  isIssueRunning: (issueId: string) => boolean;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  slots: {},
  queue: [],
  supervisorStatus: null,
  commanderState: null,
  commanderConfig: null,
  recentDecisions: [],
  selectedIssueIds: new Set(),
  cliPanelIssueId: null,

  addSlot: (slot) =>
    set((state) => ({
      slots: { ...state.slots, [slot.processId]: slot },
    })),

  removeSlot: (processId) =>
    set((state) => {
      const { [processId]: _, ...remaining } = state.slots;
      return { slots: remaining };
    }),

  setQueue: (queue) => set({ queue }),

  setSupervisorStatus: (status) =>
    set({
      supervisorStatus: status,
      queue: status.queued,
    }),

  setCommanderState: (commanderState) =>
    set({ commanderState }),

  setCommanderConfig: (commanderConfig) =>
    set({ commanderConfig }),

  fetchCommanderConfig: async () => {
    try {
      const res = await fetch('/api/commander/config');
      if (res.ok) {
        const config = await res.json();
        set({ commanderConfig: config });
      }
    } catch {
      // ignore fetch errors
    }
  },

  toggleSupervisor: async (enabled) => {
    try {
      const res = await fetch('/api/execution/supervisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          set({ supervisorStatus: data.status });
        }
      }
    } catch {
      // ignore fetch errors
    }
  },

  addDecision: (decision) =>
    set((state) => {
      const next = [...state.recentDecisions, decision];
      if (next.length > 20) next.shift();
      return { recentDecisions: next };
    }),

  toggleSelect: (issueId) =>
    set((state) => {
      const next = new Set(state.selectedIssueIds);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return { selectedIssueIds: next };
    }),

  selectAll: (issueIds) =>
    set({ selectedIssueIds: new Set(issueIds) }),

  clearSelection: () =>
    set({ selectedIssueIds: new Set() }),

  openCliPanel: (issueId) =>
    set({ cliPanelIssueId: issueId }),

  closeCliPanel: () =>
    set({ cliPanelIssueId: null }),

  getSlotForIssue: (issueId) => {
    const slots = get().slots;
    for (const slot of Object.values(slots)) {
      if (slot.issueId === issueId) return slot;
    }
    return undefined;
  },

  isIssueRunning: (issueId) => {
    const slots = get().slots;
    return Object.values(slots).some((s) => s.issueId === issueId);
  },
}));
