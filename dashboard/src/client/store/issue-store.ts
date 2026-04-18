import { create } from 'zustand';
import type { Issue, CreateIssueRequest, UpdateIssueRequest } from '@/shared/issue-types.js';
import { ISSUE_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Issue store -- global state for issues with optimistic updates
// ---------------------------------------------------------------------------

export interface IssueStore {
  issues: Issue[];
  loading: boolean;
  error: string | null;

  fetchIssues: (filters?: { status?: string; type?: string }) => Promise<void>;
  patchIssue: (issue: Issue) => void;
  createIssue: (req: CreateIssueRequest) => Promise<Issue | null>;
  updateIssue: (id: string, req: UpdateIssueRequest) => Promise<void>;
  deleteIssue: (id: string) => Promise<void>;
}

export const useIssueStore = create<IssueStore>((set, get) => ({
  issues: [],
  loading: false,
  error: null,

  patchIssue: (issue) =>
    set((state) => {
      const idx = state.issues.findIndex((i) => i.id === issue.id);
      if (idx >= 0) {
        const next = [...state.issues];
        next[idx] = issue;
        return { issues: next };
      }
      // New issue not in store yet -- append
      return { issues: [...state.issues, issue] };
    }),

  fetchIssues: async (filters) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', filters.status);
      if (filters?.type) params.set('type', filters.type);
      const qs = params.toString();
      const url = ISSUE_API_ENDPOINTS.ISSUES + (qs ? `?${qs}` : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch issues: ${res.status}`);
      const data = (await res.json()) as Issue[];
      set({ issues: data, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  createIssue: async (req) => {
    set({ error: null });
    try {
      const res = await fetch(ISSUE_API_ENDPOINTS.ISSUES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((errBody as { error: string }).error);
      }
      const created = (await res.json()) as Issue;
      // Optimistic add
      set((state) => ({ issues: [...state.issues, created] }));
      return created;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateIssue: async (id, req) => {
    set({ error: null });
    // Optimistic update
    const prev = get().issues;
    set((state) => ({
      issues: state.issues.map((i) =>
        i.id === id ? { ...i, ...req, updated_at: new Date().toISOString() } : i,
      ),
    }));
    try {
      const url = ISSUE_API_ENDPOINTS.ISSUES + `/${id}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        throw new Error(`Failed to update issue: ${res.status}`);
      }
      const updated = (await res.json()) as Issue;
      set((state) => ({
        issues: state.issues.map((i) => (i.id === id ? updated : i)),
      }));
    } catch (err) {
      // Rollback on failure
      set({ issues: prev, error: String(err) });
    }
  },

  deleteIssue: async (id) => {
    set({ error: null });
    const prev = get().issues;
    // Optimistic remove
    set((state) => ({
      issues: state.issues.filter((i) => i.id !== id),
    }));
    try {
      const url = ISSUE_API_ENDPOINTS.ISSUES + `/${id}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to delete issue: ${res.status}`);
      }
    } catch (err) {
      // Rollback on failure
      set({ issues: prev, error: String(err) });
    }
  },
}));
