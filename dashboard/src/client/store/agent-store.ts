import { create } from 'zustand';
import type { AgentProcess, AgentProcessStatus, NormalizedEntry, ApprovalRequest, ThoughtData } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// Token usage accumulator (per-process)
// ---------------------------------------------------------------------------

export interface TokenUsageAccumulator {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ---------------------------------------------------------------------------
// Agent store — global state for agent processes, entries, and approvals
// ---------------------------------------------------------------------------

export interface AgentStore {
  processes: Record<string, AgentProcess>;
  entries: Record<string, NormalizedEntry[]>;
  pendingApprovals: Record<string, ApprovalRequest>;
  activeProcessId: string | null;
  processThoughts: Record<string, ThoughtData>;
  processStreaming: Record<string, boolean>;
  processTokenUsage: Record<string, TokenUsageAccumulator>;

  addProcess: (process: AgentProcess) => void;
  removeProcess: (processId: string) => void;
  updateProcessStatus: (processId: string, status: AgentProcessStatus) => void;
  addEntry: (processId: string, entry: NormalizedEntry) => void;
  setApproval: (approval: ApprovalRequest) => void;
  clearApproval: (approvalId: string) => void;
  setActiveProcessId: (processId: string | null) => void;
  setProcessThought: (processId: string, thought: ThoughtData) => void;
  setProcessStreaming: (processId: string, streaming: boolean) => void;
  updateProcessTokenUsage: (processId: string, input: number, output: number, cacheRead: number, cacheWrite: number) => void;
  clearAll: () => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  processes: {},
  entries: {},
  pendingApprovals: {},
  activeProcessId: null,
  processThoughts: {},
  processStreaming: {},
  processTokenUsage: {},

  addProcess: (process) =>
    set((state) => ({
      processes: { ...state.processes, [process.id]: process },
      entries: { ...state.entries, [process.id]: state.entries[process.id] ?? [] },
    })),

  removeProcess: (processId) =>
    set((state) => {
      const { [processId]: _, ...remaining } = state.processes;
      return { processes: remaining };
    }),

  updateProcessStatus: (processId, status) =>
    set((state) => {
      const existing = state.processes[processId];
      if (!existing) return state;
      return {
        processes: { ...state.processes, [processId]: { ...existing, status } },
      };
    }),

  addEntry: (processId, entry) =>
    set((state) => {
      const existing = state.entries[processId] ?? [];
      // Idempotent: skip if entry with same id already exists (prevents duplicates on reconnect)
      if (entry.id && existing.some(e => e.id === entry.id)) return state;
      return {
        entries: {
          ...state.entries,
          [processId]: [...existing, entry],
        },
      };
    }),

  setApproval: (approval) =>
    set((state) => ({
      pendingApprovals: { ...state.pendingApprovals, [approval.id]: approval },
    })),

  clearApproval: (approvalId) =>
    set((state) => {
      const { [approvalId]: _, ...remaining } = state.pendingApprovals;
      return { pendingApprovals: remaining };
    }),

  setActiveProcessId: (processId) => set({ activeProcessId: processId }),

  setProcessThought: (processId, thought) =>
    set((state) => ({
      processThoughts: { ...state.processThoughts, [processId]: thought },
    })),

  setProcessStreaming: (processId, streaming) =>
    set((state) => ({
      processStreaming: { ...state.processStreaming, [processId]: streaming },
    })),

  updateProcessTokenUsage: (processId, input, output, cacheRead, cacheWrite) =>
    set((state) => {
      const existing = state.processTokenUsage[processId] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      return {
        processTokenUsage: {
          ...state.processTokenUsage,
          [processId]: {
            input: existing.input + input,
            output: existing.output + output,
            cacheRead: existing.cacheRead + cacheRead,
            cacheWrite: existing.cacheWrite + cacheWrite,
          },
        },
      };
    }),

  clearAll: () => set({
    processes: {},
    entries: {},
    pendingApprovals: {},
    activeProcessId: null,
    processThoughts: {},
    processStreaming: {},
    processTokenUsage: {},
  }),
}));
