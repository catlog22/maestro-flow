import { create } from 'zustand';
import type {
  LinearTeam,
  LinearBoardState,
  LinearIssue,
} from '@/shared/linear-types.js';
import type { Issue } from '@/shared/issue-types.js';
import { LINEAR_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Linear store -- global state for Linear issues kanban
// ---------------------------------------------------------------------------

export interface LinearStore {
  configured: boolean | null; // null = not checked yet
  teams: LinearTeam[];
  selectedTeamId: string | null;
  board: LinearBoardState | null;
  selectedIssue: LinearIssue | null;
  loading: boolean;
  error: string | null;

  checkStatus: () => Promise<void>;
  fetchTeams: () => Promise<void>;
  selectTeam: (teamId: string) => void;
  fetchBoard: (teamId: string) => Promise<void>;
  selectIssue: (issue: LinearIssue | null) => void;
  refresh: () => Promise<void>;
  importIssues: (issues: LinearIssue[]) => Promise<{ imported: number; errors: string[] }>;
  exportIssues: (issues: Issue[], teamId: string) => Promise<{ exported: number; errors: string[] }>;
}

export const useLinearStore = create<LinearStore>((set, get) => ({
  configured: null,
  teams: [],
  selectedTeamId: null,
  board: null,
  selectedIssue: null,
  loading: false,
  error: null,

  checkStatus: async () => {
    try {
      const res = await fetch(LINEAR_API_ENDPOINTS.STATUS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { configured: boolean };
      set({ configured: data.configured });
    } catch (err) {
      set({ configured: false, error: String(err) });
    }
  },

  fetchTeams: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(LINEAR_API_ENDPOINTS.TEAMS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const teams = (await res.json()) as LinearTeam[];
      set({ teams, loading: false });
      // Auto-select first team if none selected
      if (teams.length > 0 && !get().selectedTeamId) {
        const teamId = teams[0].id;
        set({ selectedTeamId: teamId });
        get().fetchBoard(teamId);
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  selectTeam: (teamId) => {
    set({ selectedTeamId: teamId, board: null, selectedIssue: null });
    get().fetchBoard(teamId);
  },

  fetchBoard: async (teamId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${LINEAR_API_ENDPOINTS.BOARD}?teamId=${teamId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((body as { error: string }).error);
      }
      const board = (await res.json()) as LinearBoardState;
      set({ board, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  selectIssue: (issue) => {
    set({ selectedIssue: issue });
  },

  refresh: async () => {
    const teamId = get().selectedTeamId;
    if (teamId) await get().fetchBoard(teamId);
  },

  importIssues: async (issues) => {
    const res = await fetch('/api/linear/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((body as { error: string }).error);
    }
    return (await res.json()) as { imported: number; errors: string[] };
  },

  exportIssues: async (issues, teamId) => {
    const res = await fetch('/api/linear/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues, teamId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((body as { error: string }).error);
    }
    return (await res.json()) as { exported: number; errors: string[] };
  },
}));
