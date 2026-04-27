import { create } from 'zustand';
import type { AgentProcess, AgentProcessStatus, NormalizedEntry, ApprovalRequest, ThoughtData } from '@/shared/agent-types.js';

const MAX_ENTRIES_PER_PROCESS = 500;

/** Auto-dismiss stale stopped/error processes after 30 minutes */
const STALE_PROCESS_TTL_MS = 30 * 60 * 1000;

/** localStorage key for custom session titles */
const TITLES_STORAGE_KEY = 'maestro-session-titles';

/** Load persisted session titles from localStorage */
function loadPersistedTitles(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TITLES_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** Persist session titles to localStorage */
function persistTitles(titles: Record<string, string>): void {
  try {
    localStorage.setItem(TITLES_STORAGE_KEY, JSON.stringify(titles));
  } catch {
    // Storage full or unavailable — best effort
  }
}

/** Track pending TTL timers so they can be cancelled on manual dismiss or unmount */
const ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  selectedProcessIds: Set<string>;
  processTitles: Record<string, string>;

  addProcess: (process: AgentProcess) => void;
  removeProcess: (processId: string) => void;
  updateProcessStatus: (processId: string, status: AgentProcessStatus) => void;
  addEntry: (processId: string, entry: NormalizedEntry) => void;
  /** Bulk-set all entries for a process in a single state update (avoids O(n) re-renders) */
  setEntries: (processId: string, entries: NormalizedEntry[]) => void;
  /** Bulk-add entries for multiple processes in a single state update (buffer flush) */
  batchAddEntries: (batch: Record<string, NormalizedEntry[]>) => void;
  setApproval: (approval: ApprovalRequest) => void;
  clearApproval: (approvalId: string) => void;
  setActiveProcessId: (processId: string | null) => void;
  setProcessThought: (processId: string, thought: ThoughtData) => void;
  setProcessStreaming: (processId: string, streaming: boolean) => void;
  updateProcessTokenUsage: (processId: string, input: number, output: number, cacheRead: number, cacheWrite: number) => void;
  /** Remove a process and all associated state (entries, thoughts, streaming, tokens) */
  dismissProcess: (processId: string) => void;
  /** Remove processes that have been stopped/error for longer than TTL */
  cleanupStaleProcesses: () => void;
  clearAll: () => void;
  toggleProcessSelection: (id: string) => void;
  clearProcessSelection: () => void;
  renameProcess: (id: string, title: string) => void;
  batchDismissProcesses: (ids: Iterable<string>) => void;
  getProcessTitle: (id: string) => string | undefined;
}

export const useAgentStore = create<AgentStore>((set) => ({
  processes: {},
  entries: {},
  pendingApprovals: {},
  activeProcessId: null,
  processThoughts: {},
  processStreaming: {},
  processTokenUsage: {},
  selectedProcessIds: new Set<string>(),
  processTitles: loadPersistedTitles(),

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

  updateProcessStatus: (processId, status) => {
    // Schedule TTL cleanup when process enters a terminal state
    if (status === 'stopped' || status === 'error') {
      if (!ttlTimers.has(processId)) {
        const timer = setTimeout(() => {
          ttlTimers.delete(processId);
          const { processes, activeProcessId, dismissProcess } = useAgentStore.getState();
          const proc = processes[processId];
          // Only cleanup if still terminal and not actively viewed
          if (proc && (proc.status === 'stopped' || proc.status === 'error') && activeProcessId !== processId) {
            dismissProcess(processId);
          }
        }, STALE_PROCESS_TTL_MS);
        ttlTimers.set(processId, timer);
      }
    } else {
      // Process revived — cancel pending TTL timer
      const existing = ttlTimers.get(processId);
      if (existing) {
        clearTimeout(existing);
        ttlTimers.delete(processId);
      }
    }
    set((state) => {
      const proc = state.processes[processId];
      if (!proc) return state;
      return {
        processes: { ...state.processes, [processId]: { ...proc, status } },
      };
    });
  },

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

  setEntries: (processId, entries) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [processId]: entries.length > MAX_ENTRIES_PER_PROCESS
          ? entries.slice(-MAX_ENTRIES_PER_PROCESS)
          : entries,
      },
    })),

  batchAddEntries: (batch) =>
    set((state) => {
      const updated = { ...state.entries };
      for (const [processId, newEntries] of Object.entries(batch)) {
        const existing = updated[processId] ?? [];
        // Filter duplicates by id
        const existingIds = new Set(existing.map(e => e.id).filter(Boolean));
        const deduped = newEntries.filter(e => !e.id || !existingIds.has(e.id));
        if (deduped.length === 0) continue;
        const combined = [...existing, ...deduped];
        updated[processId] = combined.length > MAX_ENTRIES_PER_PROCESS
          ? combined.slice(-MAX_ENTRIES_PER_PROCESS)
          : combined;
      }
      return { entries: updated };
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

  dismissProcess: (processId) => {
    // Cancel any pending TTL timer for this process
    const pendingTimer = ttlTimers.get(processId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      ttlTimers.delete(processId);
    }
    // Delete from server — agent memory + CLI history files
    if (processId.startsWith('cli-history-')) {
      const execId = processId.slice('cli-history-'.length);
      fetch(`/api/cli-history/${encodeURIComponent(execId)}`, { method: 'DELETE' }).catch(() => {});
    }
    fetch(`/api/agents/${encodeURIComponent(processId)}`, { method: 'DELETE' }).catch(() => {});
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
    });
  },

  cleanupStaleProcesses: () => {
    const { processes, activeProcessId, dismissProcess } = useAgentStore.getState();
    for (const [processId, proc] of Object.entries(processes)) {
      if ((proc.status === 'stopped' || proc.status === 'error') && activeProcessId !== processId) {
        dismissProcess(processId);
      }
    }
  },

  toggleProcessSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedProcessIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedProcessIds: next };
    }),

  clearProcessSelection: () => set({ selectedProcessIds: new Set<string>() }),

  renameProcess: (id, title) =>
    set((state) => {
      const titles = { ...state.processTitles, [id]: title };
      persistTitles(titles);
      return { processTitles: titles };
    }),

  batchDismissProcesses: (ids) => {
    const { dismissProcess } = useAgentStore.getState();
    for (const id of ids) {
      dismissProcess(id);
    }
    set({ selectedProcessIds: new Set<string>() });
  },

  getProcessTitle: (id: string): string | undefined => {
    const state = useAgentStore.getState();
    return state.processTitles[id] || undefined;
  },

  clearAll: () => {
    // Cancel all pending TTL timers
    for (const timer of ttlTimers.values()) {
      clearTimeout(timer);
    }
    ttlTimers.clear();
    set({
      processes: {},
      entries: {},
      pendingApprovals: {},
      activeProcessId: null,
      processThoughts: {},
      processStreaming: {},
      processTokenUsage: {},
      selectedProcessIds: new Set<string>(),
    });
  },
}));
