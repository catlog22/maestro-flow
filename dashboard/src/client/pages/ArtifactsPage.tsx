import { useState, useEffect, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import Code from 'lucide-react/dist/esm/icons/code.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import GitFork from 'lucide-react/dist/esm/icons/git-fork.js';
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js';
import Library from 'lucide-react/dist/esm/icons/library.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useShallow } from 'zustand/react/shallow';

import { useArtifacts } from '@/client/hooks/useArtifacts.js';
import { TreeBrowser } from '@/client/components/artifacts/TreeBrowser.js';
import { ReaderView } from '@/client/components/artifacts/ReaderView.js';
import { GalleryView } from '@/client/components/artifacts/GalleryView.js';
import { StructuredView } from '@/client/components/artifacts/StructuredView.js';
import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import { useWikiStore, type WikiNodeType } from '@/client/store/wiki-store.js';
import { WikiGroupedView } from '@/client/components/wiki/WikiGroupedView.js';
import { WikiReaderPanel } from '@/client/components/wiki/WikiReaderPanel.js';
import { WikiHealthPanel } from '@/client/components/wiki/WikiHealthPanel.js';
import { WikiGalleryView } from '@/client/components/wiki/WikiGalleryView.js';
import { WikiGraphView } from '@/client/components/wiki/WikiGraphView.js';

// ---------------------------------------------------------------------------
// ArtifactsPage -- unified browser with Files / Wiki sidebar modes
// ---------------------------------------------------------------------------

type SidebarMode = 'files' | 'wiki';

// --- Files mode views ---
type FileView = 'reader' | 'gallery' | 'structured';
const FILE_VIEW_ITEMS = [
  { label: 'Reader', icon: <FileText size={14} strokeWidth={2} />, shortcut: '1' },
  { label: 'Gallery', icon: <LayoutGrid size={14} strokeWidth={2} />, shortcut: '2' },
  { label: 'Structured', icon: <Code size={14} strokeWidth={2} />, shortcut: '3' },
] as const;
const FILE_VIEWS: FileView[] = ['reader', 'gallery', 'structured'];

// --- Wiki mode views ---
type WikiView = 'reader' | 'gallery' | 'graph';
const WIKI_VIEW_ITEMS = [
  { label: 'Reader', icon: <BookOpen size={14} strokeWidth={2} />, shortcut: '1' },
  { label: 'Gallery', icon: <LayoutGrid size={14} strokeWidth={2} />, shortcut: '2' },
  { label: 'Graph', icon: <GitFork size={14} strokeWidth={2} />, shortcut: '3' },
] as const;
const WIKI_VIEWS: WikiView[] = ['reader', 'gallery', 'graph'];

const TYPE_FILTERS: Array<{ value: WikiNodeType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'project', label: 'Project' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'spec', label: 'Specs' },
  { value: 'issue', label: 'Issues' },
  { value: 'lesson', label: 'Lessons' },
  { value: 'memory', label: 'Memory' },
  { value: 'note', label: 'Notes' },
];

const viewVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function ArtifactsPage() {
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('files');
  const [fileView, setFileView] = useState<FileView>('reader');
  const [wikiView, setWikiView] = useState<WikiView>('reader');

  // --- Artifacts state ---
  const { tree, selectedPath, content, loading, treeLoading, error, selectFile } =
    useArtifacts();

  // --- Wiki state ---
  const {
    fetchEntries,
    loading: wikiLoading,
    error: wikiError,
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

  // Fetch wiki data when switching to wiki mode
  useEffect(() => {
    if (sidebarMode === 'wiki') {
      void fetchEntries();
    }
  }, [sidebarMode, fetchEntries]);

  // Re-fetch wiki when search changes (BM25 server-side)
  useEffect(() => {
    if (sidebarMode !== 'wiki') return;
    const t = setTimeout(() => void fetchEntries(), 200);
    return () => clearTimeout(t);
  }, [search, fetchEntries, sidebarMode]);

  // --- ViewSwitcher registration ---
  const { register, unregister } = useContext(ViewSwitcherContext);

  const handleViewSwitch = useCallback(
    (index: number) => {
      if (sidebarMode === 'files') setFileView(FILE_VIEWS[index]);
      else setWikiView(WIKI_VIEWS[index]);
    },
    [sidebarMode],
  );

  useEffect(() => {
    const items = sidebarMode === 'files' ? FILE_VIEW_ITEMS : WIKI_VIEW_ITEMS;
    const activeIndex = sidebarMode === 'files'
      ? FILE_VIEWS.indexOf(fileView)
      : WIKI_VIEWS.indexOf(wikiView);

    register({
      items: items.map((v) => ({ label: v.label, icon: v.icon, shortcut: v.shortcut })),
      activeIndex,
      onSwitch: handleViewSwitch,
    });
  }, [sidebarMode, fileView, wikiView, register, handleViewSwitch]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  // Keyboard shortcut: 1/2/3 to switch views
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (sidebarMode === 'files') {
        if (e.key === '1') setFileView('reader');
        else if (e.key === '2') setFileView('gallery');
        else if (e.key === '3') setFileView('structured');
      } else {
        if (e.key === '1') setWikiView('reader');
        else if (e.key === '2') setWikiView('gallery');
        else if (e.key === '3') setWikiView('graph');
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sidebarMode]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-[272px] shrink-0 border-r border-border overflow-hidden flex flex-col bg-bg-primary">
        {/* Sidebar mode toggle */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border shrink-0">
          <SidebarToggle
            mode="files"
            active={sidebarMode === 'files'}
            icon={<FolderTree size={13} strokeWidth={2} />}
            label="Files"
            onClick={() => setSidebarMode('files')}
          />
          <SidebarToggle
            mode="wiki"
            active={sidebarMode === 'wiki'}
            icon={<Library size={13} strokeWidth={2} />}
            label="Wiki"
            onClick={() => setSidebarMode('wiki')}
          />
        </div>

        {/* Sidebar content */}
        {sidebarMode === 'files' ? (
          <TreeBrowser
            tree={tree}
            selectedPath={selectedPath}
            onSelectFile={selectFile}
            loading={treeLoading}
          />
        ) : (
          <>
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
                {wikiLoading && <span className="animate-pulse">· loading…</span>}
                {wikiError && <span className="text-accent-red ml-1">{wikiError}</span>}
              </div>
            </div>
            {/* Entry list */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <WikiGroupedView />
            </div>
          </>
        )}
      </div>

      {/* Right: animated view content */}
      <div className="flex-1 overflow-hidden relative min-w-0">
        <AnimatePresence mode="wait">
          {sidebarMode === 'files' ? (
            <>
              {fileView === 'reader' && (
                <motion.div
                  key="file-reader"
                  className="absolute inset-0 flex flex-col"
                  variants={viewVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                >
                  <ReaderView
                    content={content}
                    path={selectedPath}
                    onNavigate={selectFile}
                    loading={loading}
                    error={error}
                  />
                </motion.div>
              )}
              {fileView === 'gallery' && (
                <motion.div
                  key="file-gallery"
                  className="absolute inset-0 flex flex-col"
                  variants={viewVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                >
                  <GalleryView
                    tree={tree}
                    onSelectFile={selectFile}
                    selectedPath={selectedPath}
                  />
                </motion.div>
              )}
              {fileView === 'structured' && (
                <motion.div
                  key="file-structured"
                  className="absolute inset-0 flex flex-col"
                  variants={viewVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                >
                  <StructuredView content={content} path={selectedPath} />
                </motion.div>
              )}
            </>
          ) : (
            <>
              {wikiView === 'reader' && (
                <motion.div
                  key="wiki-reader"
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
              {wikiView === 'gallery' && (
                <motion.div
                  key="wiki-gallery"
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
              {wikiView === 'graph' && (
                <motion.div
                  key="wiki-graph"
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
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarToggle — mode switch button
// ---------------------------------------------------------------------------

function SidebarToggle({
  active,
  icon,
  label,
  onClick,
}: {
  mode: SidebarMode;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-md,6px)]',
        'text-[length:var(--font-size-sm)] font-medium transition-all duration-150',
        active
          ? 'bg-bg-active text-text-primary shadow-sm'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
