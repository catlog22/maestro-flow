import { useState } from 'react';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { ActiveSlotsPanel } from './ActiveSlotsPanel.js';

// ---------------------------------------------------------------------------
// OrchestratorPopover — tabbed panel above the status bar
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'slots' | 'decisions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'slots', label: 'Active Slots' },
  { id: 'decisions', label: 'Decisions' },
];

export function OrchestratorPopover({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const supervisorStatus = useExecutionStore((s) => s.supervisorStatus);
  const commanderState = useExecutionStore((s) => s.commanderState);
  const recentDecisions = useExecutionStore((s) => s.recentDecisions);

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mx-[var(--spacing-4)] mb-[var(--spacing-1)] rounded-[var(--radius-md)] border border-border-divider bg-bg-primary shadow-lg">
      {/* Tab bar */}
      <div className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] pt-[var(--spacing-2)] border-b border-border-divider">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-[var(--spacing-2)] py-[var(--spacing-1)] text-[length:var(--font-size-xs)] rounded-t-[var(--radius-sm)] transition-colors',
              activeTab === tab.id
                ? 'text-text-primary font-[var(--font-weight-medium)] border-b-2 border-accent-blue'
                : 'text-text-secondary hover:text-text-primary',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}

        {/* Close area (click outside tabs to close) */}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary text-[length:var(--font-size-xs)] px-[var(--spacing-1)] transition-colors"
        >
          Close
        </button>
      </div>

      {/* Tab content */}
      <div className="p-[var(--spacing-3)] max-h-64 overflow-auto">
        {activeTab === 'overview' && (
          <OverviewTab
            supervisorStatus={supervisorStatus}
            commanderState={commanderState}
          />
        )}
        {activeTab === 'slots' && <ActiveSlotsPanel />}
        {activeTab === 'decisions' && <DecisionsTab decisions={recentDecisions} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  supervisorStatus,
  commanderState,
}: {
  supervisorStatus: ReturnType<typeof useExecutionStore.getState>['supervisorStatus'];
  commanderState: ReturnType<typeof useExecutionStore.getState>['commanderState'];
}) {
  return (
    <div className="flex flex-col gap-[var(--spacing-3)] text-[length:var(--font-size-xs)]">
      {/* Supervisor stats */}
      <div>
        <div className="text-text-primary font-[var(--font-weight-medium)] mb-[var(--spacing-1)]">Supervisor</div>
        {supervisorStatus ? (
          <div className="flex items-center gap-[var(--spacing-4)] text-text-secondary">
            <span>Dispatched: <span className="text-text-primary">{supervisorStatus.stats.totalDispatched}</span></span>
            <span>Completed: <span className="text-text-primary">{supervisorStatus.stats.totalCompleted}</span></span>
            <span>Failed: <span className="text-text-primary">{supervisorStatus.stats.totalFailed}</span></span>
          </div>
        ) : (
          <span className="text-text-tertiary">No supervisor data</span>
        )}
      </div>

      {/* Commander config summary */}
      <div>
        <div className="text-text-primary font-[var(--font-weight-medium)] mb-[var(--spacing-1)]">Commander</div>
        {commanderState ? (
          <div className="flex items-center gap-[var(--spacing-4)] text-text-secondary">
            <span>Status: <span className="text-text-primary">{commanderState.status}</span></span>
            <span>Workers: <span className="text-text-primary">{commanderState.activeWorkers}</span></span>
            <span>Ticks: <span className="text-text-primary">{commanderState.tickCount}</span></span>
            <span>Session: <span className="text-text-primary">{commanderState.sessionId}</span></span>
          </div>
        ) : (
          <span className="text-text-tertiary">Commander not active</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisions tab
// ---------------------------------------------------------------------------

function DecisionsTab({ decisions }: { decisions: ReturnType<typeof useExecutionStore.getState>['recentDecisions'] }) {
  if (decisions.length === 0) {
    return (
      <div className="text-text-tertiary text-[length:var(--font-size-xs)] py-[var(--spacing-3)] text-center">
        No recent decisions
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-1)]">
      {decisions.slice().reverse().map((decision) => {
        const time = new Date(decision.timestamp);
        const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

        return (
          <div
            key={decision.id}
            className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] hover:bg-bg-hover text-[length:var(--font-size-xs)]"
          >
            <span className="text-text-tertiary shrink-0">{timeStr}</span>
            <span className="text-text-secondary shrink-0">{decision.trigger}</span>
            <span className="text-text-primary shrink-0">
              {decision.actions.length} action{decision.actions.length !== 1 ? 's' : ''}
            </span>
            {decision.deferred.length > 0 && (
              <span className="text-text-tertiary shrink-0">
                ({decision.deferred.length} deferred)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
