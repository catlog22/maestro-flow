import { create } from 'zustand';
import { WIKI_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Types — mirror shapes from server/wiki/wiki-types.ts without importing
// server-side modules into the client bundle.
// ---------------------------------------------------------------------------

export type WikiNodeType =
  | 'project'
  | 'roadmap'
  | 'spec'
  | 'issue'
  | 'lesson'
  | 'memory'
  | 'note';

export type WikiStatus =
  | 'draft'
  | 'active'
  | 'completed'
  | 'blocked'
  | 'archived';

export interface WikiEntry {
  id: string;
  type: WikiNodeType;
  title: string;
  summary: string;
  tags: string[];
  status: WikiStatus;
  created: string;
  updated: string;
  related: string[];
  source: { kind: 'file' | 'virtual'; path: string; line?: number };
  body: string;
  raw?: unknown;
  ext: Record<string, unknown>;
  category: string | null;
  createdBy: string | null;
  sourceRef: string | null;
  parent: string | null;
}

export interface BrokenLink {
  sourceId: string;
  target: string;
}

export interface HubRank {
  id: string;
  inDegree: number;
}

export interface WikiHealth {
  score: number;
  totals: {
    entries: number;
    brokenLinks: number;
    orphans: number;
    missingTitles: number;
  };
  orphans: string[];
  hubs: HubRank[];
  brokenLinks: BrokenLink[];
  lastUpdated: number;
}

export interface WikiGraph {
  forwardLinks: Record<string, string[]>;
  backlinks: Record<string, string[]>;
  brokenLinks: BrokenLink[];
}

export type WritableWikiType = 'spec' | 'memory' | 'note';

export interface CreateWikiReq {
  type: WritableWikiType;
  slug: string;
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  category?: string;
  createdBy?: string;
  sourceRef?: string;
  parent?: string;
}

export interface UpdateWikiReq {
  title?: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
  expectedHash?: string;
}

export interface WikiStore {
  entries: WikiEntry[];
  byId: Record<string, WikiEntry>;
  loading: boolean;
  error: string | null;

  typeFilter: WikiNodeType | 'all';
  tagFilter: string;
  categoryFilter: string | 'all';
  statusFilter: WikiStatus | 'all';
  search: string;
  selectedId: string | null;
  backlinksCache: Record<string, WikiEntry[]>;

  health: WikiHealth | null;
  graph: WikiGraph | null;

  setTypeFilter: (t: WikiNodeType | 'all') => void;
  setTagFilter: (tag: string) => void;
  setCategoryFilter: (cat: string | 'all') => void;
  setStatusFilter: (s: WikiStatus | 'all') => void;
  setSearch: (q: string) => void;
  setSelected: (id: string | null) => void;

  fetchEntries: () => Promise<void>;
  fetchBacklinks: (id: string) => Promise<void>;
  fetchHealth: () => Promise<void>;
  fetchGraph: () => Promise<void>;

  createEntry: (req: CreateWikiReq) => Promise<WikiEntry>;
  updateEntry: (id: string, req: UpdateWikiReq) => Promise<WikiEntry>;
  removeEntry: (id: string) => Promise<void>;

  // Derived
  filteredEntries: () => WikiEntry[];
  entriesByType: () => Record<WikiNodeType, WikiEntry[]>;
  allTags: () => string[];
}

const EMPTY_GROUPS: Record<WikiNodeType, WikiEntry[]> = {
  project: [],
  roadmap: [],
  spec: [],
  issue: [],
  lesson: [],
  memory: [],
  note: [],
};

export const useWikiStore = create<WikiStore>((set, get) => ({
  entries: [],
  byId: {},
  loading: false,
  error: null,

  typeFilter: 'all',
  tagFilter: 'all',
  categoryFilter: 'all',
  statusFilter: 'all',
  search: '',
  selectedId: null,
  backlinksCache: {},

  health: null,
  graph: null,

  setTypeFilter: (t) => set({ typeFilter: t }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setCategoryFilter: (cat) => set({ categoryFilter: cat }),
  setStatusFilter: (s) => set({ statusFilter: s }),
  setSearch: (q) => set({ search: q }),
  setSelected: (id) => {
    set({ selectedId: id });
    if (id && !get().backlinksCache[id]) void get().fetchBacklinks(id);
  },

  fetchEntries: async () => {
    set({ loading: true, error: null });
    try {
      const { search } = get();
      const url = search
        ? `${WIKI_API_ENDPOINTS.WIKI}?q=${encodeURIComponent(search)}`
        : WIKI_API_ENDPOINTS.WIKI;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { entries: WikiEntry[] };
      const entries = data.entries ?? [];
      const byId: Record<string, WikiEntry> = {};
      for (const d of entries) byId[d.id] = d;
      set({ entries, byId, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchBacklinks: async (id) => {
    try {
      const url = WIKI_API_ENDPOINTS.WIKI_BACKLINKS.replace(':id', encodeURIComponent(id));
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { backlinks: WikiEntry[] };
      set((s) => ({
        backlinksCache: { ...s.backlinksCache, [id]: data.backlinks ?? [] },
      }));
    } catch {
      // Non-critical
    }
  },

  fetchHealth: async () => {
    try {
      const res = await fetch(WIKI_API_ENDPOINTS.WIKI_HEALTH);
      if (!res.ok) return;
      const health = (await res.json()) as WikiHealth;
      set({ health });
    } catch {
      // Non-critical
    }
  },

  fetchGraph: async () => {
    try {
      const res = await fetch(WIKI_API_ENDPOINTS.WIKI_GRAPH);
      if (!res.ok) return;
      const graph = (await res.json()) as WikiGraph;
      set({ graph });
    } catch {
      // Non-critical
    }
  },

  createEntry: async (req) => {
    const res = await fetch(WIKI_API_ENDPOINTS.WIKI, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `create failed: ${res.status}`);
    }
    const data = (await res.json()) as { entry: WikiEntry };
    await get().fetchEntries();
    return data.entry;
  },

  updateEntry: async (id, req) => {
    const url = WIKI_API_ENDPOINTS.WIKI_DETAIL.replace(':id', encodeURIComponent(id));
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `update failed: ${res.status}`);
    }
    const data = (await res.json()) as { entry: WikiEntry };
    await get().fetchEntries();
    return data.entry;
  },

  removeEntry: async (id) => {
    const url = WIKI_API_ENDPOINTS.WIKI_DETAIL.replace(':id', encodeURIComponent(id));
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `delete failed: ${res.status}`);
    }
    await get().fetchEntries();
  },

  filteredEntries: () => {
    const { entries, typeFilter, tagFilter, categoryFilter, statusFilter } = get();
    // Server applies BM25 when `search` is set, so client-side substring match
    // is only used for local tag/type/category/status narrowing.
    return entries.filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (tagFilter !== 'all' && !d.tags.includes(tagFilter)) return false;
      if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      return true;
    });
  },

  entriesByType: () => {
    const entries = get().filteredEntries();
    const out: Record<WikiNodeType, WikiEntry[]> = {
      project: [],
      roadmap: [],
      spec: [],
      issue: [],
      lesson: [],
      memory: [],
      note: [],
    };
    for (const d of entries) out[d.type].push(d);
    return out;
  },

  allTags: () => {
    const tagSet = new Set<string>();
    for (const d of get().entries) for (const t of d.tags) tagSet.add(t);
    return Array.from(tagSet).sort();
  },
}));

export { EMPTY_GROUPS };
