import { create } from 'zustand';
import { COLLAB_API_ENDPOINTS } from '@/shared/constants.js';
import type {
  CollabMember,
  CollabActivityEntry,
  CollabPresence,
  CollabAggregatedActivity,
  CollabPreflightResult,
} from '@/shared/collab-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CollabTab = 'overview' | 'analysis' | 'history';

interface CollabStoreState {
  // State
  members: CollabMember[];
  activity: CollabActivityEntry[];
  presence: CollabPresence[];
  aggregated: CollabAggregatedActivity[];
  loading: boolean;
  error: string | null;
  activeTab: CollabTab;
  statusFilter: string;
  typeFilter: string;
  memberFilter: string;

  // Async fetch actions
  fetchMembers: () => Promise<void>;
  fetchActivity: (limit?: number, since?: string) => Promise<void>;
  fetchPresence: () => Promise<void>;
  fetchAggregated: () => Promise<void>;
  fetchPreflight: () => Promise<CollabPreflightResult | null>;

  // Setters
  setActiveTab: (tab: CollabTab) => void;
  setStatusFilter: (filter: string) => void;
  setTypeFilter: (filter: string) => void;
  setMemberFilter: (filter: string) => void;

  // Derived
  filteredMembers: () => CollabMember[];
  filteredActivity: () => CollabActivityEntry[];
  recentActivity: (limit: number) => CollabActivityEntry[];

  // Cleanup
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCollabStore = create<CollabStoreState>((set, get) => ({
  members: [],
  activity: [],
  presence: [],
  aggregated: [],
  loading: false,
  error: null,
  activeTab: 'overview',
  statusFilter: 'all',
  typeFilter: 'all',
  memberFilter: 'all',

  // -- Async fetch actions ---------------------------------------------------

  fetchMembers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(COLLAB_API_ENDPOINTS.MEMBERS);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as CollabMember[];
      set({ members: data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchActivity: async (limit?: number, since?: string) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (since !== undefined) params.set('since', since);
      const qs = params.toString();
      const url = qs
        ? `${COLLAB_API_ENDPOINTS.ACTIVITY}?${qs}`
        : COLLAB_API_ENDPOINTS.ACTIVITY;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as CollabActivityEntry[];
      set({ activity: data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchPresence: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(COLLAB_API_ENDPOINTS.STATUS);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as CollabPresence[];
      set({ presence: data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchAggregated: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(COLLAB_API_ENDPOINTS.AGGREGATED);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as CollabAggregatedActivity[];
      set({ aggregated: data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchPreflight: async () => {
    try {
      const res = await fetch(COLLAB_API_ENDPOINTS.PREFLIGHT);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return (await res.json()) as CollabPreflightResult;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  // -- Setters ---------------------------------------------------------------
  // Note: SSE event routing is handled centrally by useSSE.ts which calls
  // store actions directly on collab events. No store-level subscribe/unsubscribe needed.

  setActiveTab: (tab) => set({ activeTab: tab }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setTypeFilter: (filter) => set({ typeFilter: filter }),
  setMemberFilter: (filter) => set({ memberFilter: filter }),

  // -- Derived ---------------------------------------------------------------

  filteredMembers: () => {
    const { members, statusFilter } = get();
    if (statusFilter === 'all') return members;
    return members.filter((m) => m.status === statusFilter);
  },

  filteredActivity: () => {
    const { activity, typeFilter, memberFilter } = get();
    let result = activity;
    if (typeFilter !== 'all') {
      result = result.filter((a) => a.action === typeFilter);
    }
    if (memberFilter !== 'all') {
      result = result.filter((a) => a.user === memberFilter);
    }
    return result;
  },

  recentActivity: (limit) => {
    const { activity } = get();
    return activity.slice(-limit);
  },

  // -- Cleanup ---------------------------------------------------------------

  clearAll: () =>
    set({
      members: [],
      activity: [],
      presence: [],
      aggregated: [],
      loading: false,
      error: null,
      activeTab: 'overview',
      statusFilter: 'all',
      typeFilter: 'all',
      memberFilter: 'all',
    }),
}));
