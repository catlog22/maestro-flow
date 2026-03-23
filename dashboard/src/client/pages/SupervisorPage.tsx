import { useEffect } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { SupervisorTab } from '@/shared/execution-types.js';
import { MonitorTab } from './supervisor/MonitorTab.js';
import { CommanderTab } from './supervisor/CommanderTab.js';
import { CoordinatorTab } from './supervisor/CoordinatorTab.js';
import { PromptsTab } from './supervisor/PromptsTab.js';
import { ExtensionsTab } from './supervisor/ExtensionsTab.js';
import { LearningTab } from './supervisor/LearningTab.js';
import { ScheduleTab } from './supervisor/ScheduleTab.js';

// ---------------------------------------------------------------------------
// Tab definitions with SVG icons
// ---------------------------------------------------------------------------

const TAB_DEFS: { id: SupervisorTab; labelKey: string; icon: React.ReactNode; badge?: true }[] = [
  {
    id: 'monitor', labelKey: 'supervisor.tabs.overview',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: 'commander', labelKey: 'supervisor.tabs.commander',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  },
  {
    id: 'coordinator', labelKey: 'supervisor.tabs.coordinator',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
  {
    id: 'schedule', labelKey: 'supervisor.tabs.schedules',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    badge: true,
  },
  {
    id: 'learning', labelKey: 'supervisor.tabs.learning',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  },
  {
    id: 'prompts', labelKey: 'supervisor.tabs.prompts',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>,
  },
  {
    id: 'extensions', labelKey: 'supervisor.tabs.extensions',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
    badge: true,
  },
];

// ---------------------------------------------------------------------------
// SupervisorPage -- 7-tab layout matching reference design
// ---------------------------------------------------------------------------

export function SupervisorPage() {
  const { t } = useI18n();
  const activeTab = useSupervisorStore((s) => s.activeTab);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);
  const fetchLearningStats = useSupervisorStore((s) => s.fetchLearningStats);
  const fetchSchedules = useSupervisorStore((s) => s.fetchSchedules);
  const fetchExtensions = useSupervisorStore((s) => s.fetchExtensions);
  const fetchPromptModes = useSupervisorStore((s) => s.fetchPromptModes);
  const scheduledTasks = useSupervisorStore((s) => s.scheduledTasks);
  const extensions = useSupervisorStore((s) => s.extensions);

  useEffect(() => {
    fetchLearningStats();
    fetchSchedules();
    fetchExtensions();
    fetchPromptModes();
  }, [fetchLearningStats, fetchSchedules, fetchExtensions, fetchPromptModes]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <nav
        className="shrink-0 flex items-center"
        style={{
          padding: '0 24px',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {TAB_DEFS.map((tab) => {
          const isActive = activeTab === tab.id;
          const badgeCount = tab.id === 'schedule' ? scheduledTasks.length
            : tab.id === 'extensions' ? extensions.length
            : 0;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 border-none cursor-pointer transition-all"
              style={{
                padding: '10px 16px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                background: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--color-text-primary)' : 'transparent'}`,
              }}
            >
              <span style={{ width: 14, height: 14, strokeWidth: 1.8, display: 'flex' }}>
                {tab.icon}
              </span>
              {t(tab.labelKey)}
              {tab.badge && badgeCount > 0 && (
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '100px',
                    background: 'var(--color-bg-card)',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'monitor' && <MonitorTab />}
        {activeTab === 'commander' && <CommanderTab />}
        {activeTab === 'coordinator' && <CoordinatorTab />}
        {activeTab === 'prompts' && <PromptsTab />}
        {activeTab === 'extensions' && <ExtensionsTab />}
        {activeTab === 'learning' && <LearningTab />}
        {activeTab === 'schedule' && <ScheduleTab />}
      </div>
    </div>
  );
}
