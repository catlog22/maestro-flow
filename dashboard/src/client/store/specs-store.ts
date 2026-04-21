import { create } from 'zustand';
import { SPECS_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpecType = 'coding' | 'arch' | 'quality' | 'debug' | 'test' | 'review' | 'learning' | 'bug' | 'pattern' | 'decision' | 'rule' | 'validation' | 'general';

export interface SpecEntry {
  id: string;
  type: SpecType;
  title: string;
  content: string;
  file: string;
  timestamp: string;
  category: string;
  keywords: string[];
}

export interface SpecFile {
  name: string;
  path: string;
  title: string;
  category: string;
  entryCount: number;
}

type TypeFilter = 'all' | SpecType;
type SpecsView = 'kanban' | 'table';

export interface SpecsStore {
  entries: SpecEntry[];
  files: SpecFile[];
  loading: boolean;
  error: string | null;
  activeView: SpecsView;
  typeFilter: TypeFilter;
  categoryFilter: string; // 'all' or category name
  keywordFilter: string; // 'all' or keyword
  search: string;
  selectedEntry: string | null;
  hiddenColumns: Set<string>; // hidden category or type keys in kanban

  setActiveView: (view: SpecsView) => void;
  setTypeFilter: (filter: TypeFilter) => void;
  setCategoryFilter: (filter: string) => void;
  setKeywordFilter: (filter: string) => void;
  setSearch: (q: string) => void;
  setSelectedEntry: (id: string | null) => void;
  toggleColumn: (key: string) => void;

  fetchEntries: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  addEntry: (type: SpecType, content: string, file: string) => Promise<SpecEntry | null>;
  deleteEntry: (id: string) => Promise<void>;

  // Derived
  filteredEntries: () => SpecEntry[];
  entriesByType: () => Record<SpecType, SpecEntry[]>;
  typeCounts: () => Record<SpecType | 'all', number>;
  allCategories: () => string[];
  allKeywords: () => string[];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSpecsStore = create<SpecsStore>((set, get) => ({
  entries: [],
  files: [],
  loading: false,
  error: null,
  activeView: 'kanban',
  typeFilter: 'all',
  categoryFilter: 'all',
  keywordFilter: 'all',
  search: '',
  selectedEntry: null,
  hiddenColumns: new Set<string>(),

  setActiveView: (view) => set({ activeView: view }),
  setTypeFilter: (filter) => set({ typeFilter: filter }),
  setCategoryFilter: (filter) => set({ categoryFilter: filter }),
  setKeywordFilter: (filter) => set({ keywordFilter: filter }),
  setSearch: (q) => set({ search: q }),
  setSelectedEntry: (id) => set({ selectedEntry: id }),
  toggleColumn: (key) =>
    set((s) => {
      const next = new Set(s.hiddenColumns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { hiddenColumns: next };
    }),

  fetchEntries: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(SPECS_API_ENDPOINTS.SPECS);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { entries: SpecEntry[] };
      set({ entries: data.entries ?? [], loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchFiles: async () => {
    try {
      const res = await fetch(SPECS_API_ENDPOINTS.SPECS_FILES);
      if (!res.ok) return;
      const data = (await res.json()) as { files: SpecFile[] };
      set({ files: data.files ?? [] });
    } catch {
      // Non-critical
    }
  },

  addEntry: async (type, content, file) => {
    set({ error: null });
    try {
      const res = await fetch(SPECS_API_ENDPOINTS.SPECS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, file }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((errBody as { error: string }).error);
      }
      // Refresh full list to get correct IDs
      void get().fetchEntries();
      return null;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  deleteEntry: async (id) => {
    set({ error: null });
    const prev = get().entries;
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    try {
      const res = await fetch(`${SPECS_API_ENDPOINTS.SPECS}/${id}`, { method: 'DELETE' });
      if (!res.ok) set({ entries: prev });
    } catch {
      set({ entries: prev });
    }
  },

  filteredEntries: () => {
    const { entries, typeFilter, categoryFilter, keywordFilter, search } = get();
    let result = entries;
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (categoryFilter !== 'all') result = result.filter((e) => e.category === categoryFilter);
    if (keywordFilter !== 'all') result = result.filter((e) => e.keywords.includes(keywordFilter));
    if (search) {
      const lc = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(lc) ||
          e.content.toLowerCase().includes(lc) ||
          e.id.toLowerCase().includes(lc) ||
          e.keywords.some((k) => k.toLowerCase().includes(lc)),
      );
    }
    return result;
  },

  entriesByType: () => {
    const entries = get().filteredEntries();
    const grouped: Record<SpecType, SpecEntry[]> = {
      bug: [],
      pattern: [],
      decision: [],
      rule: [],
      debug: [],
      test: [],
      review: [],
      validation: [],
      general: [],
    };
    for (const e of entries) {
      (grouped[e.type] ?? grouped.general).push(e);
    }
    return grouped;
  },

  typeCounts: () => {
    const { entries } = get();
    const counts: Record<string, number> = { all: entries.length, bug: 0, pattern: 0, decision: 0, rule: 0, debug: 0, test: 0, review: 0, validation: 0, general: 0 };
    for (const e of entries) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return counts as Record<SpecType | 'all', number>;
  },

  allCategories: () => {
    const { entries } = get();
    const cats = new Set<string>();
    for (const e of entries) if (e.category) cats.add(e.category);
    return Array.from(cats).sort();
  },

  allKeywords: () => {
    const { entries } = get();
    const kws = new Set<string>();
    for (const e of entries) {
      for (const k of e.keywords) kws.add(k);
    }
    return Array.from(kws).sort();
  },
}));
