import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { useLinearStore } from '@/client/store/linear-store.js';
import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import { FilterChipBar } from '@/client/components/common/FilterChipBar.js';
import { DetailPanel } from '@/client/components/common/DetailPanel.js';
import { KanbanBoard } from '@/client/components/kanban/KanbanBoard.js';
import { TimelineView } from '@/client/components/kanban/TimelineView.js';
import { KanbanDetailPanel } from '@/client/components/kanban/KanbanDetailPanel.js';
import { LinearImportDialog } from '@/client/components/kanban/LinearImportDialog.js';
import { LinearExportDialog } from '@/client/components/kanban/LinearExportDialog.js';
import type { SelectedKanbanItem } from '@/shared/types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';

// ---------------------------------------------------------------------------
// KanbanPage — Kanban + Timeline views with filter bar and detail panel
// ---------------------------------------------------------------------------

const FILTER_CHIPS = ['All', 'Executing', 'Planning', 'Pending'] as const;

type ActiveView = 'kanban' | 'timeline';

export function KanbanPage() {
  const [activeView, setActiveView] = useState<ActiveView>('kanban');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [selectedItem, setSelectedItem] = useState<SelectedKanbanItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { register, unregister } = useContext(ViewSwitcherContext);
  const selectedPhase = useBoardStore((s) => s.selectedPhase);
  const setSelectedPhase = useBoardStore((s) => s.setSelectedPhase);
  const board = useBoardStore((s) => s.board);

  // Linear integration
  const linearConfigured = useLinearStore((s) => s.configured);
  const linearBoard = useLinearStore((s) => s.board);
  const linearTeams = useLinearStore((s) => s.teams);
  const linearSelectedTeamId = useLinearStore((s) => s.selectedTeamId);
  const linearLoading = useLinearStore((s) => s.loading);
  const checkLinearStatus = useLinearStore((s) => s.checkStatus);
  const fetchLinearTeams = useLinearStore((s) => s.fetchTeams);
  const selectLinearTeam = useLinearStore((s) => s.selectTeam);
  const refreshLinear = useLinearStore((s) => s.refresh);

  // Check Linear status on mount
  useEffect(() => {
    void checkLinearStatus().then(() => {
      // fetchTeams will auto-trigger in the store if configured
    });
  }, [checkLinearStatus]);

  // Fetch teams when configured
  useEffect(() => {
    if (linearConfigured) {
      void fetchLinearTeams();
    }
  }, [linearConfigured, fetchLinearTeams]);

  // Flatten all linear issues from board columns
  const allLinearIssues = useMemo<LinearIssue[]>(() => {
    if (!linearBoard) return [];
    return linearBoard.columns.flatMap((col) => col.issues);
  }, [linearBoard]);

  const detailOpen = selectedItem !== null;

  const handleViewSwitch = useCallback((index: number) => {
    setActiveView(index === 0 ? 'kanban' : 'timeline');
  }, []);

  useEffect(() => {
    register({
      items: [
        { label: 'Kanban', icon: <LayoutGrid size={14} />, shortcut: 'K' },
        { label: 'Timeline', icon: <Clock size={14} />, shortcut: 'T' },
      ],
      activeIndex: activeView === 'kanban' ? 0 : 1,
      onSwitch: handleViewSwitch,
    });
  }, [register, activeView, handleViewSwitch]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  function handleSelectPhase(id: number) {
    const isSame = selectedItem?.type === 'phase' && selectedItem.phaseId === id;
    const next = isSame ? null : { type: 'phase' as const, phaseId: id };
    setSelectedItem(next);
    setSelectedPhase(isSame ? null : id);
  }

  function handleSelectItem(item: SelectedKanbanItem) {
    const isSame =
      selectedItem?.type === item.type &&
      (item.type === 'phase'
        ? (selectedItem as { phaseId: number }).phaseId === item.phaseId
        : (selectedItem as { issue: LinearIssue }).issue.id === item.issue.id);
    setSelectedItem(isSame ? null : item);
    // Keep board-store in sync for phase selections
    if (item.type === 'phase') {
      setSelectedPhase(isSame ? null : item.phaseId);
    } else {
      setSelectedPhase(null);
    }
  }

  function handleCloseDetail() {
    setSelectedItem(null);
    setSelectedPhase(null);
  }

  if (!board) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-[length:var(--font-size-sm)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="px-[var(--spacing-4)] py-[var(--spacing-2)] border-b border-border-divider shrink-0">
        <div className="flex items-center justify-between gap-[var(--spacing-3)]">
          <FilterChipBar
            chips={[...FILTER_CHIPS]}
            active={activeFilter}
            onSelect={setActiveFilter}
          />

          {/* Linear controls */}
          {linearConfigured && (
            <div className="flex items-center gap-[var(--spacing-2)] shrink-0">
              {/* Team selector */}
              {linearTeams.length > 0 && (
                <select
                  value={linearSelectedTeamId ?? ''}
                  onChange={(e) => selectLinearTeam(e.target.value)}
                  className="px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]"
                >
                  {linearTeams.map((team) => (
                    <option key={team.id} value={team.id}>{team.key} — {team.name}</option>
                  ))}
                </select>
              )}

              {/* Import button */}
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[length:var(--font-size-xs)] transition-colors"
                title="Import from Linear"
              >
                <Download size={12} />
                <span>Import</span>
              </button>

              {/* Export button */}
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover text-[length:var(--font-size-xs)] transition-colors"
                title="Export to Linear"
              >
                <Upload size={12} />
                <span>Export</span>
              </button>

              {/* Refresh button */}
              <button
                type="button"
                onClick={() => void refreshLinear()}
                disabled={linearLoading}
                className="flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                title="Refresh Linear board"
              >
                <RefreshCw size={12} className={linearLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content + Detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto min-w-0">
          {activeView === 'kanban' ? (
            <KanbanBoard
              onSelectPhase={handleSelectPhase}
              linearIssues={allLinearIssues}
              selectedItem={selectedItem}
              onSelectItem={handleSelectItem}
            />
          ) : (
            <TimelineView onSelectPhase={handleSelectPhase} />
          )}
        </div>

        {/* Detail panel */}
        <DetailPanel
          open={detailOpen}
          onClose={handleCloseDetail}
          title={selectedItem?.type === 'linearIssue' ? 'Linear Issue' : 'Phase Detail'}
        >
          {selectedItem && (
            <KanbanDetailPanel selectedItem={selectedItem} />
          )}
        </DetailPanel>
      </div>

      {/* Import/Export dialogs */}
      {importOpen && (
        <LinearImportDialog
          issues={allLinearIssues}
          onClose={() => setImportOpen(false)}
        />
      )}
      {exportOpen && (
        <LinearExportDialog
          teams={linearTeams}
          selectedTeamId={linearSelectedTeamId}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
