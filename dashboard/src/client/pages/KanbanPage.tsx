import { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLinearStore } from '@/client/store/linear-store.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import { FilterChipBar } from '@/client/components/common/FilterChipBar.js';
import { DetailPanel } from '@/client/components/common/DetailPanel.js';
import { KanbanBoard } from '@/client/components/kanban/KanbanBoard.js';
import { KanbanTableView } from '@/client/components/kanban/KanbanTableView.js';
import { KanbanCenterView } from '@/client/components/kanban/KanbanCenterView.js';
import { KanbanDetailPanel } from '@/client/components/kanban/KanbanDetailPanel.js';
import { LinearImportDialog } from '@/client/components/kanban/LinearImportDialog.js';
import { LinearExportDialog } from '@/client/components/kanban/LinearExportDialog.js';
import { ExecutionCliPanel } from '@/client/components/kanban/ExecutionCliPanel.js';
import { ExecutionToolbar } from '@/client/components/kanban/ExecutionToolbar.js';
import { CommanderRecommendationsBar } from '@/client/components/kanban/CommanderRecommendationsBar.js';
import { IssueCreateModal } from '@/client/components/kanban/IssueCreateModal.js';
import { IssueDetailModal } from '@/client/components/kanban/IssueDetailModal.js';
import { useUIPrefsStore } from '@/client/store/ui-prefs-store.js';
import type { SelectedKanbanItem } from '@/shared/types.js';
import type { Issue } from '@/shared/issue-types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import TableIcon from 'lucide-react/dist/esm/icons/table.js';
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';

// ---------------------------------------------------------------------------
// KanbanPage — Issue Kanban with execution controls
// ---------------------------------------------------------------------------

const FILTER_CHIPS = ['All', 'Open', 'Registered', 'In Progress', 'Resolved', 'Deferred'] as const;

type ActiveView = 'kanban' | 'table' | 'center';

const VIEW_ORDER: ActiveView[] = ['kanban', 'table', 'center'];

export function KanbanPage() {
  const [activeView, setActiveView] = useState<ActiveView>('kanban');
  const [activeFilter, setActiveFilter] = useState<string>('All');
  const [selectedItem, setSelectedItem] = useState<SelectedKanbanItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [composingColumnId, setComposingColumnId] = useState<string | null>(null);

  // Create modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalColumnId, setCreateModalColumnId] = useState('backlog');

  // Detail modal state
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);

  // Style prefs from settings (persisted to localStorage)
  const createStyle = useUIPrefsStore((s) => s.createModalStyle);
  const detailStyle = useUIPrefsStore((s) => s.detailModalStyle);

  const { register, unregister } = useContext(ViewSwitcherContext);

  // Issue store
  const { issues, fetchIssues } = useIssueStore(useShallow((s) => ({ issues: s.issues, fetchIssues: s.fetchIssues })));

  // Execution store
  const { selectedIssueIds, toggleSelect, cliPanelIssueId, supervisorStatus } = useExecutionStore(useShallow((s) => ({ selectedIssueIds: s.selectedIssueIds, toggleSelect: s.toggleSelect, cliPanelIssueId: s.cliPanelIssueId, supervisorStatus: s.supervisorStatus })));

  const batchMode = selectedIssueIds.size > 0;

  // Linear integration
  const {
    configured: linearConfigured,
    board: linearBoard,
    teams: linearTeams,
    selectedTeamId: linearSelectedTeamId,
    loading: linearLoading,
    checkStatus: checkLinearStatus,
    fetchTeams: fetchLinearTeams,
    selectTeam: selectLinearTeam,
    refresh: refreshLinear,
  } = useLinearStore(useShallow((s) => ({
    configured: s.configured,
    board: s.board,
    teams: s.teams,
    selectedTeamId: s.selectedTeamId,
    loading: s.loading,
    checkStatus: s.checkStatus,
    fetchTeams: s.fetchTeams,
    selectTeam: s.selectTeam,
    refresh: s.refresh,
  })));

  // Fetch issues on mount
  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  // Check Linear status on mount
  useEffect(() => {
    void checkLinearStatus();
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

  const detailOpen = selectedItem !== null && !cliPanelIssueId;

  const handleViewSwitch = useCallback((index: number) => {
    setActiveView(VIEW_ORDER[index] ?? 'kanban');
  }, []);

  useEffect(() => {
    register({
      items: [
        { label: 'Kanban', icon: <LayoutGrid size={14} />, shortcut: 'K' },
        { label: 'Table', icon: <TableIcon size={14} />, shortcut: 'L' },
        { label: 'Center', icon: <LayoutDashboard size={14} />, shortcut: 'C' },
      ],
      activeIndex: VIEW_ORDER.indexOf(activeView),
      onSwitch: handleViewSwitch,
    });
  }, [register, activeView, handleViewSwitch]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only when no input is focused
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        // 'C' to open create modal in backlog
        setCreateModalColumnId('backlog');
        setCreateModalOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSelectItem(item: SelectedKanbanItem) {
    // Local issues open the detail modal instead of the side panel
    if (item.type === 'issue') {
      setDetailIssue(item.issue);
      setSelectedItem(null);
      return;
    }

    const isSame =
      selectedItem?.type === item.type &&
      item.type === 'linearIssue' &&
      (selectedItem as { issue: LinearIssue }).issue.id === item.issue.id;
    setSelectedItem(isSame ? null : item);
  }

  function handleOpenCreateModal(columnId: string) {
    setCreateModalColumnId(columnId);
    setCreateModalOpen(true);
  }

  function handleCloseDetail() {
    setSelectedItem(null);
  }

  function handleIssueCreated() {
    void fetchIssues();
  }

  const detailTitle = selectedItem?.type === 'linearIssue'
    ? 'Linear Issue'
    : 'Issue Detail';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Commander recommendations */}
      <CommanderRecommendationsBar />
      {/* Filter bar */}
      <div className="px-[var(--spacing-4)] py-[var(--spacing-2)] border-b border-border-divider shrink-0">
        <div className="flex items-center justify-between gap-[var(--spacing-3)]">
          <div className="flex items-center gap-[var(--spacing-2)]">
            <FilterChipBar
              chips={[...FILTER_CHIPS]}
              active={activeFilter}
              onSelect={setActiveFilter}
            />

            {/* Show Done toggle */}
            <button
              type="button"
              onClick={() => setShowDone(!showDone)}
              className={[
                'flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] text-[length:var(--font-size-xs)] transition-colors',
                showDone
                  ? 'border-accent-blue text-accent-blue bg-[var(--color-accent-blue-10,rgba(90,130,200,0.1))]'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
              style={showDone ? undefined : { border: 'var(--style-btn-secondary-border)', background: 'var(--style-btn-secondary-bg)' }}
              title={showDone ? 'Hide Done column' : 'Show Done column'}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Done
            </button>
          </div>

          {/* Linear controls */}
          {linearConfigured && (
            <div className="flex items-center gap-[var(--spacing-2)] shrink-0">
              {/* Team selector */}
              {linearTeams.length > 0 && (
                <select
                  value={linearSelectedTeamId ?? ''}
                  onChange={(e) => selectLinearTeam(e.target.value)}
                  className="px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] text-text-primary text-[length:var(--font-size-xs)]"
                  style={{ border: 'var(--style-btn-secondary-border)', background: 'var(--style-btn-secondary-bg)' }}
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
                className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary text-[length:var(--font-size-xs)] transition-colors"
                style={{ border: 'var(--style-btn-secondary-border)', background: 'var(--style-btn-secondary-bg)' }}
                title="Import from Linear"
              >
                <Download size={12} />
                <span>Import</span>
              </button>

              {/* Export button */}
              <button
                type="button"
                onClick={() => setExportOpen(true)}
                className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary text-[length:var(--font-size-xs)] transition-colors"
                style={{ border: 'var(--style-btn-secondary-border)', background: 'var(--style-btn-secondary-bg)' }}
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
                className="flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                style={{ border: 'var(--style-btn-secondary-border)', background: 'var(--style-btn-secondary-bg)' }}
                title="Refresh Linear board"
              >
                <RefreshCw size={12} className={linearLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content + Detail + CLI Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto min-w-0">
          {activeView === 'kanban' && (
            <KanbanBoard
              linearIssues={allLinearIssues}
              localIssues={issues}
              selectedItem={selectedItem}
              onSelectItem={handleSelectItem}
              composingColumnId={composingColumnId}
              onStartCompose={handleOpenCreateModal}
              onStopCompose={() => setComposingColumnId(null)}
              onIssueCreated={handleIssueCreated}
              showDone={showDone}
              batchMode={batchMode}
              selectedIssueIds={selectedIssueIds}
              onToggleIssueCheck={toggleSelect}
            />
          )}
          {activeView === 'table' && (
            <KanbanTableView
              localIssues={issues}
              linearIssues={allLinearIssues}
              selectedItem={selectedItem}
              onSelectItem={handleSelectItem}
            />
          )}
          {activeView === 'center' && (
            <KanbanCenterView
              localIssues={issues}
              linearIssues={allLinearIssues}
              selectedItem={selectedItem}
              onSelectItem={handleSelectItem}
            />
          )}
        </div>

        {/* CLI Panel (takes priority over detail panel) */}
        {cliPanelIssueId && (
          <ExecutionCliPanel />
        )}

        {/* Detail panel */}
        {!cliPanelIssueId && (
          <DetailPanel
            open={detailOpen}
            onClose={handleCloseDetail}
            title={detailTitle}
          >
            {selectedItem && (
              <KanbanDetailPanel selectedItem={selectedItem} />
            )}
          </DetailPanel>
        )}
      </div>

      {/* Batch execution toolbar (floating) */}
      <ExecutionToolbar />

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

      {/* Create modal */}
      <IssueCreateModal
        open={createModalOpen}
        columnId={createModalColumnId}
        style={createStyle}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleIssueCreated}
      />

      {/* Issue detail modal */}
      {detailIssue && !cliPanelIssueId && (
        <IssueDetailModal
          issue={detailIssue}
          style={detailStyle}
          onClose={() => setDetailIssue(null)}
        />
      )}
    </div>
  );
}
