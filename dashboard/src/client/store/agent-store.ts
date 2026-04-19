import { create } from 'zustand';
import type { AgentProcess, AgentProcessStatus, NormalizedEntry, ApprovalRequest, ThoughtData } from '@/shared/agent-types.js';

const MAX_ENTRIES_PER_PROCESS = 500;

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
  /** Remove a process and all associated state (entries, thoughts, streaming, tokens) */
  dismissProcess: (processId: string) => void;
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
    set((state) => {
      const existing = state.entries[process.id];
      if (existing && existing.length > 0) {
        return { processes: { ...state.processes, [process.id]: process } };
      }
      // Synthesize user_message from config.prompt so every session shows what was asked
      const prompt = process.config?.prompt;
      const initialEntries: NormalizedEntry[] = prompt
        ? [{
            id: `synth-user-${process.id}`,
            processId: process.id,
            timestamp: process.startedAt,
            type: 'user_message',
            content: prompt,
          } as NormalizedEntry]
        : [];
      return {
        processes: { ...state.processes, [process.id]: process },
        entries: { ...state.entries, [process.id]: initialEntries },
      };
    }),

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

      let newEntries: NormalizedEntry[];

      if (entry.type === 'assistant_message') {
        // Find the last entry in the list
        const lastIdx = existing.length - 1;
        const last = lastIdx >= 0 ? existing[lastIdx] : null;

        if (entry.partial && last?.type === 'assistant_message' && last.partial) {
          // Merge: accumulate delta into the existing partial entry
          // Optimized: single slice + mutate instead of spread + slice
          const merged = { ...last, content: last.content + entry.content, id: entry.id };
          newEntries = existing.slice();
          newEntries[lastIdx] = merged;
        } else if (!entry.partial && last?.type === 'assistant_message' && last.partial) {
          // Final message replaces accumulated partial
          newEntries = existing.slice();
          newEntries[lastIdx] = entry;
        } else {
          newEntries = [...existing, entry];
        }
      } else {
        newEntries = [...existing, entry];
      }

      return {
        entries: {
          ...state.entries,
          [processId]: newEntries.length > MAX_ENTRIES_PER_PROCESS
            ? newEntries.slice(-MAX_ENTRIES_PER_PROCESS)
            : newEntries,
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

  dismissProcess: (processId) =>
    set((state) => {
      const { [processId]: _p, ...remainingProcesses } = state.processes;
      const { [processId]: _e, ...remainingEntries } = state.entries;
      const { [processId]: _t, ...remainingThoughts } = state.processThoughts;
      const { [processId]: _s, ...remainingStreaming } = state.processStreaming;
      const { [processId]: _u, ...remainingTokenUsage } = state.processTokenUsage;
      // Clear any pending approvals for this process
      const remainingApprovals: Record<string, typeof state.pendingApprovals[string]> = {};
      for (const [id, approval] of Object.entries(state.pendingApprovals)) {
        if (approval.processId !== processId) remainingApprovals[id] = approval;
      }
      return {
        processes: remainingProcesses,
        entries: remainingEntries,
        processThoughts: remainingThoughts,
        processStreaming: remainingStreaming,
        processTokenUsage: remainingTokenUsage,
        pendingApprovals: remainingApprovals,
        activeProcessId: state.activeProcessId === processId ? null : state.activeProcessId,
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
