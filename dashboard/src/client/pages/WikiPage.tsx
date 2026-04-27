import { useState, useEffect, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import GitFork from 'lucide-react/dist/esm/icons/git-fork.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useShallow } from 'zustand/react/shallow';

import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import { useWikiStore, type WikiNodeType } from '@/client/store/wiki-store.js';
import { WikiGroupedView } from '@/client/components/wiki/WikiGroupedView.js';
import { WikiReaderPanel } from '@/client/components/wiki/WikiReaderPanel.js';
import { WikiHealthPanel } from '@/client/components/wiki/WikiHealthPanel.js';
import { WikiGalleryView } from '@/client/components/wiki/WikiGalleryView.js';
import { WikiGraphView } from '@/client/components/wiki/WikiGraphView.js';

// ---------------------------------------------------------------------------
// View configuration
// ---------------------------------------------------------------------------

type WikiView = 'reader' | 'gallery' | 'graph';

const VIEW_ITEMS = [
  { label: 'Reader', icon: <BookOpen size={14} strokeWidth={2} />, shortcut: '1' },
  { label: 'Gallery', icon: <LayoutGrid size={14} strokeWidth={2} />, shortcut: '2' },
  { label: 'Graph', icon: <GitFork size={14} strokeWidth={2} />, shortcut: '3' },
] as const;

const VIEWS: WikiView[] = ['reader', 'gallery', 'graph'];

const TYPE_FILTERS: Array<{ value: WikiNodeType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'project', label: 'Project' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'spec', label: 'Specs' },
  { value: 'issue', label: 'Issues' },
  { value: 'lesson', label: 'Lessons' },
  { value: 'knowhow', label: 'KnowHow' },
  { value: 'note', label: 'Notes' },
];

const viewVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// ---------------------------------------------------------------------------
// WikiPage
// ---------------------------------------------------------------------------

export function WikiPage() {
  const [activeView, setActiveView] = useState<WikiView>('reader');

  const {
    fetchEntries,
    loading,
    error,
    entries,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
  } = useWikiStore(
    useShallow((s) => ({
      fetchEntries: s.fetchEntries,
      loading: s.loading,
      error: s.error,
      entries: s.entries,
      search: s.search,
      setSearch: s.setSearch,
      typeFilter: s.typeFilter,
      setTypeFilter: s.setTypeFilter,
    })),
  );

  // Register ViewSwitcher in TopBar
  const { register, unregister } = useContext(ViewSwitcherContext);

  const handleViewSwitch = useCallback(
    (index: number) => setActiveView(VIEWS[index]),
    [],
  );

  useEffect(() => {
    register({
      items: VIEW_ITEMS.map((v) => ({ label: v.label, icon: v.icon, shortcut: v.shortcut })),
      activeIndex: VIEWS.indexOf(activeView),
      onSwitch: handleViewSwitch,
    });
  }, [activeView, register, handleViewSwitch]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  // Keyboard shortcut: 1/2/3
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setActiveView('reader');
      else if (e.key === '2') setActiveView('gallery');
      else if (e.key === '3') setActiveView('graph');
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Fetch data on mount
  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // Re-fetch when search changes (BM25 server-side)
  useEffect(() => {
    const t = setTimeout(() => void fetchEntries(), 200);
    return () => clearTimeout(t);
  }, [search, fetchEntries]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — shared across all views */}
      <aside className="flex flex-col w-72 shrink-0 border-r border-border bg-bg-primary">
        <WikiHealthPanel />

        {/* Search + Filters */}
        <div className="flex flex-col gap-2 px-3 py-2 border-b border-border">
          <div className="relative">
            <Search
              size={13}
              strokeWidth={2}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              type="text"
              value={search}
              placeholder="Search…"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-7 py-1.5 bg-bg-secondary border border-border rounded-[var(--radius-md,6px)] text-[length:var(--font-size-sm)] text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-border-strong transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setTypeFilter(f.value)}
                className={`px-2 py-0.5 rounded-[var(--radius-full,999px)] text-[10px] font-medium transition-all ${
                  typeFilter === f.value
                    ? 'bg-text-primary text-bg-primary'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-secondary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-text-quaternary">
            <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
            {loading && <span className="animate-pulse">· loading…</span>}
            {error && <span className="text-accent-red ml-1">{error}</span>}
          </div>
        </div>

        {/* Entry list */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <WikiGroupedView />
        </div>
      </aside>

      {/* Right: animated view content */}
      <div className="flex-1 overflow-hidden relative min-w-0">
        <AnimatePresence mode="wait">
          {activeView === 'reader' && (
            <motion.div
              key="reader"
              className="absolute inset-0"
              variants={viewVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2 }}
            >
              <WikiReaderPanel />
            </motion.div>
          )}

          {activeView === 'gallery' && (
            <motion.div
              key="gallery"
              className="absolute inset-0"
              variants={viewVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2 }}
            >
              <WikiGalleryView />
            </motion.div>
          )}

          {activeView === 'graph' && (
            <motion.div
              key="graph"
              className="absolute inset-0"
              variants={viewVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2 }}
            >
              <WikiGraphView />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
