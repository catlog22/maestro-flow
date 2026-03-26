import { create } from 'zustand';
import type { SupervisorTab } from '@/shared/execution-types.js';
import type { LearningStats, CommandPattern, KnowledgeEntry } from '@/shared/learning-types.js';
import type { ScheduledTask } from '@/shared/schedule-types.js';
import type { ExtensionInfo } from '@/shared/extension-types.js';

// ---------------------------------------------------------------------------
// SupervisorStore -- state for all 7 supervisor tab domains
// ---------------------------------------------------------------------------

export interface SupervisorStore {
  // State
  activeTab: SupervisorTab;
  learningStats: LearningStats | null;
  learningPatterns: CommandPattern[];
  knowledgeEntries: KnowledgeEntry[];
  scheduledTasks: ScheduledTask[];
  extensions: ExtensionInfo[];
  promptModes: string[];
  promptBindings: Record<string, string>;
  error: string | null;

  // WS event handlers (called from useWebSocket)
  onLearningUpdate: (stats: LearningStats) => void;
  onScheduleUpdate: (tasks: ScheduledTask[]) => void;
  onScheduleTriggered: (payload: { taskId: string; taskName: string; taskType: string }) => void;
  onExtensionLoaded: (payload: { extensions: ExtensionInfo[] }) => void;
  onExtensionError: (payload: { name: string; error: string }) => void;

  // REST action dispatchers
  fetchLearningStats: () => Promise<void>;
  fetchSchedules: () => Promise<void>;
  fetchExtensions: () => Promise<void>;
  fetchPromptModes: () => Promise<void>;

  // Schedule CRUD actions
  createSchedule: (task: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'history'>) => Promise<void>;
  updateSchedule: (id: string, updates: Partial<ScheduledTask>) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  toggleSchedule: (id: string, enabled: boolean) => Promise<void>;
  runSchedule: (id: string) => Promise<void>;

  // UI actions
  setActiveTab: (tab: SupervisorTab) => void;
  clearError: () => void;
}

export const useSupervisorStore = create<SupervisorStore>((set, get) => ({
  // Initial state
  activeTab: 'commander',
  learningStats: null,
  learningPatterns: [],
  knowledgeEntries: [],
  scheduledTasks: [],
  extensions: [],
  promptModes: [],
  promptBindings: {},
  error: null,

  // -------------------------------------------------------------------------
  // WS event handlers
  // -------------------------------------------------------------------------

  onLearningUpdate: (stats) =>
    set({
      learningStats: stats,
      learningPatterns: stats.topPatterns,
    }),

  onScheduleUpdate: (tasks) =>
    set({ scheduledTasks: tasks }),

  onScheduleTriggered: (payload) =>
    set((state) => {
      const now = new Date().toISOString();
      const tasks = state.scheduledTasks.map((t) => {
        if (t.id !== payload.taskId) return t;
        const lastRunMs = t.lastRun ? new Date(t.lastRun).getTime() : 0;
        const elapsed = lastRunMs > 0 ? Date.now() - lastRunMs : 0;
        return {
          ...t,
          lastRun: now,
          history: [
            ...t.history,
            {
              timestamp: now,
              status: 'success' as const,
              duration: elapsed,
            },
          ],
        };
      });
      return { scheduledTasks: tasks };
    }),

  onExtensionLoaded: (payload) =>
    set({ extensions: payload.extensions }),

  onExtensionError: (payload) =>
    set((state) => {
      const extensions = state.extensions.map((ext) => {
        if (ext.name !== payload.name) return ext;
        return { ...ext, status: 'disabled' as const };
      });
      return { extensions };
    }),

  // -------------------------------------------------------------------------
  // REST action dispatchers
  // -------------------------------------------------------------------------

  fetchLearningStats: async () => {
    try {
      const res = await fetch('/api/supervisor/learning/stats');
      if (!res.ok) {
        set({ error: `Failed to fetch learning stats: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'topPatterns' in data) {
        const stats = data as LearningStats;
        set({ learningStats: stats, learningPatterns: stats.topPatterns, error: null });
      }
    } catch (err) {
      set({ error: `Failed to fetch learning stats: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  fetchSchedules: async () => {
    try {
      const res = await fetch('/api/supervisor/schedules');
      if (!res.ok) {
        set({ error: `Failed to fetch schedules: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      const tasks = data && typeof data === 'object' && 'tasks' in data
        ? (data as { tasks: ScheduledTask[] }).tasks
        : Array.isArray(data) ? data as ScheduledTask[] : [];
      set({ scheduledTasks: tasks, error: null });
    } catch (err) {
      set({ error: `Failed to fetch schedules: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  fetchExtensions: async () => {
    try {
      const res = await fetch('/api/supervisor/extensions');
      if (!res.ok) {
        set({ error: `Failed to fetch extensions: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      const extensions = data && typeof data === 'object' && 'extensions' in data
        ? (data as { extensions: ExtensionInfo[] }).extensions
        : Array.isArray(data) ? data as ExtensionInfo[] : [];
      set({ extensions, error: null });
    } catch (err) {
      set({ error: `Failed to fetch extensions: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  fetchPromptModes: async () => {
    try {
      const res = await fetch('/api/supervisor/prompts');
      if (!res.ok) {
        set({ error: `Failed to fetch prompt modes: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        const builders = Array.isArray(obj.builders) ? obj.builders as string[] : [];
        const bindings = obj.bindings && typeof obj.bindings === 'object'
          ? obj.bindings as Record<string, string> : {};
        set({ promptModes: builders, promptBindings: bindings, error: null });
      }
    } catch (err) {
      set({ error: `Failed to fetch prompt modes: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  // -------------------------------------------------------------------------
  // Schedule CRUD
  // -------------------------------------------------------------------------

  createSchedule: async (task) => {
    try {
      const res = await fetch('/api/supervisor/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      if (!res.ok) {
        set({ error: `Failed to create schedule: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'task' in data) {
        const created = (data as { task: ScheduledTask }).task;
        set((state) => ({ scheduledTasks: [...state.scheduledTasks, created], error: null }));
      }
    } catch (err) {
      set({ error: `Failed to create schedule: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  updateSchedule: async (id, updates) => {
    try {
      const res = await fetch(`/api/supervisor/schedules/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        set({ error: `Failed to update schedule: ${res.status}` });
        return;
      }
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'task' in data) {
        const updated = (data as { task: ScheduledTask }).task;
        set((state) => ({
          scheduledTasks: state.scheduledTasks.map((t) => (t.id === id ? updated : t)),
          error: null,
        }));
      }
    } catch (err) {
      set({ error: `Failed to update schedule: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  deleteSchedule: async (id) => {
    try {
      const res = await fetch(`/api/supervisor/schedules/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        set({ error: `Failed to delete schedule: ${res.status}` });
        return;
      }
      set((state) => ({
        scheduledTasks: state.scheduledTasks.filter((t) => t.id !== id),
        error: null,
      }));
    } catch (err) {
      set({ error: `Failed to delete schedule: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  toggleSchedule: async (id, enabled) => {
    await get().updateSchedule(id, { enabled });
  },

  runSchedule: async (id) => {
    try {
      const res = await fetch(`/api/supervisor/schedules/${encodeURIComponent(id)}/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        set({ error: `Failed to run schedule: ${res.status}` });
      }
    } catch (err) {
      set({ error: `Failed to run schedule: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  // -------------------------------------------------------------------------
  // UI actions
  // -------------------------------------------------------------------------

  setActiveTab: (tab) => set({ activeTab: tab }),
  clearError: () => set({ error: null }),
}));
