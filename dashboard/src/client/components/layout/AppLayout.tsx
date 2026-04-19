import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from '@/client/components/layout/TopBar.js';
import { DockRail } from '@/client/components/layout/DockRail.js';
import { MainContent } from '@/client/components/layout/MainContent.js';
import { LayoutProvider } from '@/client/components/layout/LayoutContext.js';
import { StatusBar } from '@/client/components/layout/status-bar/StatusBar.js';
import { PanelArea } from '@/client/components/layout/status-bar/PanelArea.js';
import { useBoardStore } from '@/client/store/board-store.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useWebSocket } from '@/client/hooks/useWebSocket.js';
import { API_ENDPOINTS } from '@/shared/constants.js';
import { useI18n } from '@/client/i18n/index.js';
import { SettingsDialog } from '@/client/components/settings/SettingsDialog.js';
import { OrchestratorStatusBar } from '@/client/components/kanban/OrchestratorStatusBar.js';
import { ViewSwitcherContext, useViewSwitcherProvider } from '@/client/hooks/useViewSwitcher.js';
import type { BoardState } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// AppLayout — shared layout with TopBar + Sidebar + routed content (Outlet)
// ---------------------------------------------------------------------------

export function AppLayout() {
  const { t } = useI18n();
  const connected = useBoardStore((s) => s.connected);
  const [fetchError, setFetchError] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const togglePin = () => setIsPinned((p) => !p);
  const viewSwitcherCtx = useViewSwitcherProvider();
  const location = useLocation();
  const showOrchestrator = location.pathname.startsWith('/kanban');
  const isChatPage = location.pathname.startsWith('/chat');

  // Establish WebSocket connection for real-time updates
  useWebSocket();

  // Fetch initial board + agent state on mount
  useEffect(() => {
    async function fetchInitialState() {
      try {
        const [boardRes, agentsRes, healthRes] = await Promise.all([
          fetch(API_ENDPOINTS.BOARD),
          fetch('/api/agents'),
          fetch(API_ENDPOINTS.HEALTH),
        ]);
        if (!boardRes.ok) {
          setFetchError(true);
          return;
        }
        const data: BoardState = await boardRes.json();
        useBoardStore.getState().setBoard(data);
        setFetchError(false);

        if (agentsRes.ok) {
          const agents = await agentsRes.json() as import('@/shared/agent-types.js').AgentProcess[];
          const { addProcess } = useAgentStore.getState();
          for (const proc of agents) {
            addProcess(proc);
          }
        }

        if (healthRes.ok) {
          const health = await healthRes.json() as { workspace?: string; version?: string; latestVersion?: string | null };
          if (health.workspace) {
            useBoardStore.getState().setWorkspace(health.workspace);
          }
          if (health.latestVersion && health.version && health.latestVersion !== health.version) {
            const dismissed = localStorage.getItem('maestro-update-dismissed');
            if (dismissed !== health.latestVersion) {
              setUpdateAvailable(health.latestVersion);
            }
          }
        }
      } catch {
        setFetchError(true);
      }
    }
    fetchInitialState();
  }, []);

  return (
    <LayoutProvider>
    <ViewSwitcherContext value={viewSwitcherCtx}>
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-bg-primary">
      {/* Settings dialog (global overlay) */}
      <SettingsDialog />

      {/* Connection error banner */}
      {fetchError && !connected && (
        <div
          role="alert"
          aria-live="assertive"
          className="px-[var(--spacing-4)] py-[var(--spacing-2)] border-b text-[length:var(--font-size-xs)] text-center shrink-0 rounded-[var(--radius-default)] mx-[var(--spacing-3)] mt-[var(--spacing-2)]"
          style={{
            backgroundColor: 'var(--color-status-bg-blocked)',
            color: 'var(--color-status-blocked)',
            borderColor: 'var(--color-status-blocked)',
          }}
        >
          {t('connection_error')}
        </div>
      )}

      {/* Version update banner */}
      {updateAvailable && !updateDismissed && (
        <div
          role="status"
          className="px-[var(--spacing-4)] py-[var(--spacing-2)] border-b text-[length:var(--font-size-xs)] shrink-0 rounded-[var(--radius-default)] mx-[var(--spacing-3)] mt-[var(--spacing-2)] flex items-center justify-center gap-[var(--spacing-2)]"
          style={{
            backgroundColor: 'var(--color-status-bg-exploring)',
            color: 'var(--color-status-exploring)',
            borderColor: 'var(--color-status-exploring)',
          }}
        >
          <span>{t('update_available', { version: updateAvailable })}</span>
          <button
            type="button"
            onClick={() => {
              setUpdateDismissed(true);
              localStorage.setItem('maestro-update-dismissed', updateAvailable);
            }}
            className="ml-[var(--spacing-1)] hover:opacity-70 transition-opacity duration-[var(--duration-fast)]"
            aria-label={t('dismiss')}
          >
            &times;
          </button>
        </div>
      )}

      {/* Row 1: top bar spans full width */}
      <TopBar />

      {/* Row 2: dock rail + main content */}
      <div className="flex flex-1 overflow-hidden relative">
        <DockRail isPinned={isPinned} onTogglePin={togglePin} />
        <MainContent>
          <Outlet />
          {showOrchestrator && <OrchestratorStatusBar />}
        </MainContent>
      </div>

      {/* Row 3: status bar + collapsible bottom panel (hidden on chat page) */}
      {!isChatPage && <StatusBar />}
      {!isChatPage && <PanelArea />}
    </div>
    </ViewSwitcherContext>
    </LayoutProvider>
  );
}
