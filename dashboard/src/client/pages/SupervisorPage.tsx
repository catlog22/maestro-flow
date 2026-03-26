import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { useCoordinateStore } from '@/client/store/coordinate-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { SupervisorTab } from '@/shared/execution-types.js';
import { ExecutionsTab } from './supervisor/ExecutionsTab.js';
import { CommanderTab } from './supervisor/CommanderTab.js';
import { CoordinatorTab } from './supervisor/CoordinatorTab.js';
import { PromptsTab } from './supervisor/PromptsTab.js';
import { ExtensionsTab } from './supervisor/ExtensionsTab.js';
import { LearningTab } from './supervisor/LearningTab.js';
import { ScheduleTab } from './supervisor/ScheduleTab.js';

// ---------------------------------------------------------------------------
// Tab definitions — order matches prototype
// ---------------------------------------------------------------------------

const TAB_DEFS: { id: SupervisorTab; labelKey: string; icon: React.ReactNode }[] = [
  {
    id: 'commander', labelKey: 'supervisor.tabs.commander',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  },
  {
    id: 'executions', labelKey: 'supervisor.tabs.executions',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: 'schedule', labelKey: 'supervisor.tabs.schedules',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
  {
    id: 'learning', labelKey: 'supervisor.tabs.learning',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  },
  {
    id: 'extensions', labelKey: 'supervisor.tabs.extensions',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  },
  {
    id: 'prompts', labelKey: 'supervisor.tabs.prompts',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>,
  },
  {
    id: 'coordinator', labelKey: 'supervisor.tabs.coordinator',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];

// ---------------------------------------------------------------------------
// SupervisorPage -- shell layout with tabs, overlay, and status bar
// ---------------------------------------------------------------------------

export function SupervisorPage() {
  const { t } = useI18n();

  // Supervisor store
  const activeTab = useSupervisorStore((s) => s.activeTab);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);
  const fetchLearningStats = useSupervisorStore((s) => s.fetchLearningStats);
  const fetchSchedules = useSupervisorStore((s) => s.fetchSchedules);
  const fetchExtensions = useSupervisorStore((s) => s.fetchExtensions);
  const fetchPromptModes = useSupervisorStore((s) => s.fetchPromptModes);
  const scheduledTasks = useSupervisorStore((s) => s.scheduledTasks);
  const extensions = useSupervisorStore((s) => s.extensions);

  // Execution store
  const slots = useExecutionStore((s) => s.slots);
  const queue = useExecutionStore((s) => s.queue);
  const supervisorStatus = useExecutionStore((s) => s.supervisorStatus);
  const toggleSupervisor = useExecutionStore((s) => s.toggleSupervisor);
  const commanderState = useExecutionStore((s) => s.commanderState);

  // Coordinate store
  const session = useCoordinateStore((s) => s.session);
  const startCoordinate = useCoordinateStore((s) => s.start);
  const stopCoordinate = useCoordinateStore((s) => s.stop);

  // Overlay state
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    fetchLearningStats();
    fetchSchedules();
    fetchExtensions();
    fetchPromptModes();
  }, [fetchLearningStats, fetchSchedules, fetchExtensions, fetchPromptModes]);

  // Derived stats
  const slotList = useMemo(() => Object.values(slots), [slots]);
  const isEnabled = supervisorStatus?.enabled ?? false;
  const dispatched = supervisorStatus?.stats.totalDispatched ?? 0;
  const completed = supervisorStatus?.stats.totalCompleted ?? 0;
  const successRate = dispatched > 0 ? `${Math.round((completed / dispatched) * 100)}%` : '-';
  const sessionRunning = session != null && session.status !== 'idle' && session.status !== 'completed' && session.status !== 'failed';
  const sessionSteps = session?.steps ?? [];
  const sessionDoneSteps = sessionSteps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;

  // Toggle handlers
  const handleToggleIssues = useCallback(async () => {
    await toggleSupervisor(!isEnabled);
  }, [toggleSupervisor, isEnabled]);

  const handleToggleWorkflow = useCallback(() => {
    if (sessionRunning) {
      stopCoordinate();
    } else {
      startCoordinate('continue', undefined, true);
    }
  }, [sessionRunning, stopCoordinate, startCoordinate]);

  const handleOverlayTabClick = useCallback((tab: SupervisorTab) => {
    setActiveTab(tab);
    setOverlayOpen(false);
  }, [setActiveTab]);

  // Badge counts
  const badgeCounts: Partial<Record<SupervisorTab, number>> = {
    schedule: scheduledTasks.length,
    extensions: extensions.length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-primary)' }}>
      {/* ---- Tab row ---- */}
      <nav style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        background: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {TAB_DEFS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = badgeCounts[tab.id] ?? 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--color-text-primary)' : 'transparent'}`,
                cursor: 'pointer',
                transition: 'color 120ms, border-color 120ms',
              }}
            >
              <span style={{ width: 14, height: 14, display: 'flex' }}>{tab.icon}</span>
              {t(tab.labelKey)}
              {count > 0 && (
                <span style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 100,
                  background: 'var(--color-bg-card)',
                  color: 'var(--color-text-tertiary)',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ---- Tab content ---- */}
      <main style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'commander' && <CommanderTab />}
        {activeTab === 'executions' && <ExecutionsTab />}
        {activeTab === 'coordinator' && <CoordinatorTab />}
        {activeTab === 'prompts' && <PromptsTab />}
        {activeTab === 'extensions' && <ExtensionsTab />}
        {activeTab === 'learning' && <LearningTab />}
        {activeTab === 'schedule' && <ScheduleTab />}
      </main>

      {/* ---- Overlay backdrop ---- */}
      {overlayOpen && (
        <div
          onClick={() => setOverlayOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.25)',
            zIndex: 90,
            transition: 'opacity 200ms',
          }}
        />
      )}

      {/* ---- Overlay panel ---- */}
      <div style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 36,
        maxHeight: overlayOpen ? '60vh' : 0,
        overflow: 'hidden',
        background: 'var(--color-bg-card)',
        borderTop: overlayOpen ? '1px solid var(--color-border)' : 'none',
        borderRadius: '12px 12px 0 0',
        zIndex: 91,
        transition: 'max-height 300ms cubic-bezier(0.4,0,0.2,1)',
        boxShadow: overlayOpen ? '0 -4px 24px rgba(0,0,0,0.08)' : 'none',
      }}>
        {/* Drag handle */}
        <div
          style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px', cursor: 'pointer' }}
          onClick={() => setOverlayOpen(false)}
        >
          <div style={{ width: 32, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>

        {/* 3-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 16, padding: '8px 24px 24px', overflowY: 'auto', maxHeight: 'calc(60vh - 40px)' }}>
          {/* Col 1: Navigation */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)', padding: '4px 8px', marginBottom: 4 }}>
              Navigate
            </div>
            {TAB_DEFS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleOverlayTabClick(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color: activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  background: activeTab === tab.id ? 'var(--color-bg-active)' : 'none',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 120ms',
                }}
              >
                <span style={{ width: 14, height: 14, display: 'flex' }}>{tab.icon}</span>
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          {/* Col 2: Issue Executions + Workflow Sessions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Issue Executions */}
            <div style={{ borderRadius: 10, border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent-blue)' }}>Issue Executions</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{slotList.length} running</span>
              </div>
              <div style={{ padding: '8px 14px' }}>
                {slotList.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '4px 0' }}>No active slots</div>
                ) : (
                  slotList.slice(0, 5).map((slot) => (
                    <div key={slot.processId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 11 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-blue)', flexShrink: 0 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{slot.issueId}</span>
                      <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{slot.executor}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Workflow Sessions */}
            <div style={{ borderRadius: 10, border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent-purple)' }}>Workflow Sessions</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{session ? session.status : 'idle'}</span>
              </div>
              <div style={{ padding: '8px 14px' }}>
                {!session ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', padding: '4px 0' }}>No active session</div>
                ) : (
                  <div style={{ fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                      <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{session.chainName ?? 'Session'}</span>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>Step {session.currentStep + 1}/{sessionSteps.length}</span>
                    </div>
                    {session.intent && (
                      <div style={{ color: 'var(--color-text-secondary)', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.intent}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Col 3: Commander status + Suggestions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ borderRadius: 10, border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-divider)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)' }}>Commander</span>
              </div>
              <div style={{ padding: '8px 14px', fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                  <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Status:</span>
                  <span style={{
                    fontWeight: 600,
                    color: commanderState?.status === 'dispatching' ? 'var(--color-accent-green)'
                      : commanderState?.status === 'thinking' ? 'var(--color-accent-blue)'
                      : 'var(--color-text-tertiary)',
                  }}>
                    {commanderState?.status ?? 'idle'}
                  </span>
                </div>
                {supervisorStatus?.isCommanderActive !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Active:</span>
                    <span style={{ color: supervisorStatus.isCommanderActive ? 'var(--color-accent-green)' : 'var(--color-text-tertiary)' }}>
                      {supervisorStatus.isCommanderActive ? 'Yes' : 'No'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderRadius: 10, border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-divider)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)' }}>Suggestions</span>
              </div>
              <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                No suggestions
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Status bar ---- */}
      <footer style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        height: 36,
        padding: '0 16px',
        background: 'var(--color-bg-secondary)',
        borderTop: '1px solid var(--color-border)',
        gap: 12,
        fontSize: 11,
        zIndex: 92,
      }}>
        {/* Left: Supervisor title + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Supervisor</span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 100,
            background: isEnabled ? 'rgba(90,158,120,0.12)' : 'rgba(160,157,151,0.12)',
            color: isEnabled ? 'var(--color-accent-green)' : 'var(--color-accent-gray)',
          }}>
            {/* Pulse dot */}
            {isEnabled && (
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent-green)',
                animation: 'pulse 2s ease-in-out infinite',
              }} />
            )}
            {isEnabled ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 16, background: 'var(--color-border-divider)' }} />

        {/* Middle: Issues stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-accent-blue)' }}>Issues</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {slotList.length} running
          </span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>
            {queue.length} queued
          </span>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {successRate} success
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 16, background: 'var(--color-border-divider)' }} />

        {/* Middle: Workflow stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-accent-purple)' }}>Workflow</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {sessionRunning ? '1 running' : '0 running'}
          </span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>
            {sessionSteps.length > 0 ? `${sessionDoneSteps}/${sessionSteps.length} steps` : '-'}
          </span>
        </div>

        {/* Right side: spacer + controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Overview button */}
          <button
            type="button"
            onClick={() => setOverlayOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: overlayOpen ? 'var(--color-bg-active)' : 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              transition: 'background 120ms',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
              <polyline points={overlayOpen ? '6 15 12 9 18 15' : '6 9 12 15 18 9'} />
            </svg>
            Overview
          </button>

          {/* Issues toggle */}
          <button
            type="button"
            onClick={handleToggleIssues}
            style={{
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid',
              borderColor: isEnabled ? 'var(--color-accent-blue)' : 'var(--color-border)',
              background: isEnabled ? 'rgba(91,141,184,0.12)' : 'none',
              color: isEnabled ? 'var(--color-accent-blue)' : 'var(--color-text-tertiary)',
              cursor: 'pointer',
              transition: 'all 120ms',
            }}
          >
            Issues
          </button>

          {/* Workflow toggle */}
          <button
            type="button"
            onClick={handleToggleWorkflow}
            style={{
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 6,
              border: '1px solid',
              borderColor: sessionRunning ? 'var(--color-accent-purple)' : 'var(--color-border)',
              background: sessionRunning ? 'rgba(145,120,181,0.12)' : 'none',
              color: sessionRunning ? 'var(--color-accent-purple)' : 'var(--color-text-tertiary)',
              cursor: 'pointer',
              transition: 'all 120ms',
            }}
          >
            Workflow
          </button>
        </div>
      </footer>

      {/* Pulse animation (injected once) */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
