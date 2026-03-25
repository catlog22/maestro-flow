import { useCallback, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSettingsStore } from '@/client/store/settings-store.js';
import type { SettingsSectionType } from '@/client/store/settings-store.js';
import { SettingsSection } from './SettingsSection.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// SettingsDialog — modal with 2-pane layout (sidebar nav + content area)
// ---------------------------------------------------------------------------

interface SectionNavItem {
  id: SettingsSectionType;
  label: string;
  icon: string;
}

const SECTION_IDS: SettingsSectionType[] = ['general', 'agents', 'commander', 'cli-tools', 'specs', 'linear', 'kanban'];
const SECTION_ICONS: Record<string, string> = {
  general: 'cog', agents: 'bot', commander: 'commander',
  'cli-tools': 'terminal', specs: 'file-text', linear: 'linear', kanban: 'kanban',
};

/** Simple SVG icons to avoid heavy lucide imports for just 4 icons */
function SectionIcon({ icon }: { icon: string }) {
  const cls = "w-4 h-4 shrink-0";
  switch (icon) {
    case 'cog':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'bot':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      );
    case 'terminal':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case 'file-text':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case 'linear':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l6-6" />
          <path d="M10 18l4-4" />
          <path d="M14 20l7-7" />
        </svg>
      );
    case 'kanban':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="10" y="3" width="5" height="12" rx="1" />
          <rect x="17" y="3" width="5" height="15" rx="1" />
        </svg>
      );
    case 'commander':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 9h6" />
          <path d="M9 13h6" />
          <circle cx="9" cy="9" r="0.5" fill="currentColor" />
          <circle cx="9" cy="13" r="0.5" fill="currentColor" />
          <circle cx="15" cy="9" r="0.5" fill="currentColor" />
          <circle cx="15" cy="13" r="0.5" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

export function SettingsDialog() {
  const { t } = useI18n();
  const open = useSettingsStore((s) => s.open);
  const setOpen = useSettingsStore((s) => s.setOpen);
  const activeSection = useSettingsStore((s) => s.activeSection);
  const setActiveSection = useSettingsStore((s) => s.setActiveSection);
  const loading = useSettingsStore((s) => s.loading);
  const config = useSettingsStore((s) => s.config);
  const draft = useSettingsStore((s) => s.draft);

  // Check if any section is dirty for the close guard
  const anyDirty = useSettingsStore((s) => {
    if (!s.config || !s.draft) return false;
    return (
      JSON.stringify(s.config.general) !== JSON.stringify(s.draft.general) ||
      JSON.stringify(s.config.agents) !== JSON.stringify(s.draft.agents) ||
      s.config.cliTools !== s.draft.cliTools ||
      JSON.stringify(s.config.linear) !== JSON.stringify(s.draft.linear) ||
      s.config.searchTool !== s.draft.searchTool ||
      JSON.stringify(s.config.commander) !== JSON.stringify(s.draft.commander)
    );
  });

  // ESC handling with dirty guard
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && anyDirty) {
        const confirmed = window.confirm(
          t('settings.unsaved_confirm'),
        );
        if (!confirmed) return;
      }
      setOpen(nextOpen);
    },
    [anyDirty, setOpen],
  );

  // Keyboard shortcut: Cmd/Ctrl + , to open settings
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[900px] max-w-[95vw] h-[700px] max-h-[90vh]',
            'rounded-[var(--radius-lg)] border border-border bg-bg-primary shadow-[var(--style-modal-shadow)]',
            'flex flex-col overflow-hidden',
            'focus:outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-border shrink-0">
            <Dialog.Title className="text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-text-primary">
              {t('settings.title')}
            </Dialog.Title>
            <Dialog.Close
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)]',
                'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                'transition-colors duration-[var(--duration-fast)]',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
              )}
              aria-label="Close settings"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Body: 2-pane layout */}
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar nav */}
            <nav
              className="w-56 shrink-0 border-r border-border bg-bg-secondary p-[var(--spacing-3)] overflow-y-auto"
              aria-label="Settings sections"
            >
              <div className="flex flex-col gap-[var(--spacing-0-5)]">
                {SECTION_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveSection(id)}
                    className={cn(
                      'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-2)] py-[var(--spacing-1-5)] rounded-[var(--radius-default)] text-left text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] w-full',
                      'transition-all duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
                      'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
                      activeSection === id
                        ? 'bg-bg-active text-text-primary'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                    )}
                    aria-current={activeSection === id ? 'page' : undefined}
                  >
                    <SectionIcon icon={SECTION_ICONS[id]} />
                    <span className="truncate">{t(`settings.nav.${id === 'cli-tools' ? 'cli_tools' : id}`)}</span>
                  </button>
                ))}
              </div>
            </nav>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-[var(--spacing-6)]">
              {loading && !config ? (
                <div className="flex items-center justify-center h-full">
                  <span className="text-[length:var(--font-size-sm)] text-text-secondary">
                    {t('settings.loading')}
                  </span>
                </div>
              ) : draft ? (
                <SettingsSection section={activeSection} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <span className="text-[length:var(--font-size-sm)] text-text-secondary">
                    {t('settings.failed')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
