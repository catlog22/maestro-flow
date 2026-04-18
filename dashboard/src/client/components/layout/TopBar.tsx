import { useBoardStore } from '@/client/store/board-store.js';
import { useSettingsStore } from '@/client/store/settings-store.js';
import { useI18n } from '@/client/i18n/index.js';
import { ViewSwitcher } from '@/client/components/common/ViewSwitcher.js';
import { WorkspaceSwitcher } from '@/client/components/common/WorkspaceSwitcher.js';
import { OnlineAvatarGroup } from '@/client/components/collab/OnlineAvatarGroup.js';

// ---------------------------------------------------------------------------
// TopBar — project name, milestone badge, current phase, connection dot
// ---------------------------------------------------------------------------

export function TopBar() {
  const board = useBoardStore((s) => s.board);
  const connected = useBoardStore((s) => s.connected);
  const setSettingsOpen = useSettingsStore((s) => s.setOpen);
  const { t, locale, setLocale } = useI18n();

  const project = board?.project;

  // Toggle between English and Chinese
  const toggleLocale = () => {
    setLocale(locale === 'en' ? 'zh-CN' : 'en');
  };

  return (
    <header
      role="banner"
      className="flex items-center justify-between px-[var(--spacing-4)] h-[var(--size-topbar-height)] bg-bg-secondary border-b border-border shrink-0"
    >
      {/* Left: branding + project */}
      <div className="flex items-center gap-[var(--spacing-3)]">
        <span
          className="font-[800] text-[length:var(--font-size-base)] text-text-primary tracking-[-0.02em]"
          aria-hidden="true"
        >
          Maestro
        </span>

        <WorkspaceSwitcher />

        {project && (
          <>
            <span className="text-text-placeholder text-[length:var(--font-size-sm)]">&middot;</span>
            <span className="text-text-secondary text-[length:var(--font-size-sm)] truncate max-w-[200px]">
              {project.current_milestone || project.project_name}
            </span>
          </>
        )}
      </div>

      {/* Center: ViewSwitcher from page context */}
      <div className="flex-1 flex justify-center">
        <ViewSwitcher />
      </div>

      {/* Right: language switcher + phase indicator + connection */}
      <div className="flex items-center gap-[var(--spacing-4)]">
        {/* Language switcher */}
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t('language_switcher.aria_label')}
          className={[
            'flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
            'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
            'transition-all duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
            'hover:bg-bg-hover',
            locale === 'zh-CN' ? 'text-accent-blue' : 'text-text-secondary',
          ].join(' ')}
        >
          <span className="tabular-nums">{locale === 'en' ? t('language_switcher.en') : t('language_switcher.zh')}</span>
          <span className="text-text-tertiary">/</span>
          <span className="tabular-nums">{locale === 'en' ? t('language_switcher.zh') : t('language_switcher.en')}</span>
        </button>

        {project && <OnlineAvatarGroup />}

        {project && (
          <span className="text-[length:var(--font-size-sm)] text-text-secondary transition-opacity duration-[var(--duration-normal)] ease-[var(--ease-in-out)] hidden sm:inline">
            {t('topbar.phase')} {project.current_phase} {t('topbar.of')} {project.phases_summary.total}
          </span>
        )}

        {/* Settings gear */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
          className={[
            'flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)]',
            'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
            'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
          ].join(' ')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Connection pill */}
        <span
          role="status"
          aria-live="polite"
          aria-label={connected ? t('topbar.connection.aria_connected') : t('topbar.connection.aria_disconnected')}
          className={[
            'flex items-center gap-[5px] text-[length:10px] font-[var(--font-weight-semibold)] px-[10px] py-[3px] rounded-full',
            'transition-colors duration-[var(--duration-smooth)] ease-[var(--ease-notion)]',
            connected
              ? 'bg-[rgba(90,158,120,0.12)] text-status-completed'
              : 'bg-[rgba(196,101,85,0.12)] text-status-blocked',
          ].join(' ')}
        >
          <span className={`w-1.5 h-1.5 rounded-full bg-current ${connected ? 'animate-pulse' : ''}`} />
          {connected ? t('topbar.connection.connected') : t('topbar.connection.disconnected')}
        </span>
      </div>
    </header>
  );
}
