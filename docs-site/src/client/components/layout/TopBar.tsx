import { useState } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { useVersion } from '@/client/version/index.js';
import { useSidebar } from './SidebarContext.js';
import { SearchInput } from '@/client/components/navigation/index.js';
import { Link } from 'react-router-dom';

declare const __APP_VERSION__: string;

// ---------------------------------------------------------------------------
// TopBar — Gemini CLI style header: logo, search, nav, theme toggle
// ---------------------------------------------------------------------------

export function TopBar() {
  const { t, locale, setLocale } = useI18n();
  const { version, setVersion } = useVersion();
  const { toggle: toggleSidebar } = useSidebar();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('docs-site-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const toggleLocale = () => {
    setLocale(locale === 'en' ? 'zh-CN' : 'en');
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      localStorage.setItem('docs-site-theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    } catch {}
  };

  return (
    <header
      role="banner"
      className="fixed left-0 right-0 flex items-center justify-between px-[var(--spacing-6)] h-[var(--size-topbar-height)] bg-bg-primary border-b border-border-divider shrink-0 z-[100]"
      style={{ top: 'var(--size-banner-height)' }}
    >
      {/* Left: Hamburger (mobile) + Logo */}
      <div className="flex items-center gap-[var(--spacing-4)]">
        {/* Mobile hamburger menu */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={t('sidebar.toggle')}
          className="lg:hidden flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] transition-all duration-[var(--duration-fast)] hover:bg-bg-hover text-text-tertiary hover:text-text-primary"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link to="/" className="flex items-center gap-[var(--spacing-2)] no-underline">
          {/* Logo icon — Gemini CLI style solid square */}
          <span className="w-7 h-7 rounded-[var(--radius-default)] bg-accent-blue flex items-center justify-center">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </span>
          <span className="font-[var(--font-weight-bold)] text-[17px] text-text-primary tracking-[var(--letter-spacing-tight)]">
            Maestro
          </span>
        </Link>
        <span className="w-px h-5 bg-border-divider hidden sm:block"></span>
        <span className="hidden sm:block text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary">
          {t('topbar.title')}
        </span>
      </div>

      {/* Right: search + nav + controls */}
      <div className="flex items-center gap-[var(--spacing-2)]">
        {/* Search */}
        <div className="hidden sm:block w-64">
          <SearchInput placeholder={t('topbar.search_placeholder')} />
        </div>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-[var(--spacing-0-5)]">
          <Link
            to="/"
            className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary no-underline px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-default)] transition-all duration-[var(--duration-fast)] hover:text-text-primary hover:bg-bg-hover"
          >
            {t('nav.home')}
          </Link>
        </nav>

        {/* GitHub link */}
        <a
          href="https://github.com/catlog22/maestro-flow"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] transition-all duration-[var(--duration-fast)] hover:bg-bg-hover text-text-tertiary hover:text-text-primary"
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>

        {/* Version switcher */}
        <button
          type="button"
          onClick={() => setVersion(version === 'v2' ? 'v1' : 'v2')}
          aria-label="Switch documentation version"
          className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] transition-all duration-[var(--duration-fast)] hover:bg-bg-hover text-text-secondary"
        >
          <span className={version === 'v2' ? 'text-accent-blue font-[var(--font-weight-bold)]' : ''}>v2</span>
          <span className="text-text-placeholder">/</span>
          <span className={version === 'v1' ? 'text-accent-orange font-[var(--font-weight-bold)]' : ''}>v1</span>
        </button>

        {/* Language switcher */}
        <button
          type="button"
          onClick={toggleLocale}
          aria-label={t('language_switcher.aria_label')}
          className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] transition-all duration-[var(--duration-fast)] hover:bg-bg-hover text-text-secondary"
        >
          <span>{locale === 'en' ? t('language_switcher.en') : t('language_switcher.zh')}</span>
          <span className="text-text-placeholder">/</span>
          <span>{locale === 'en' ? t('language_switcher.zh') : t('language_switcher.en')}</span>
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t('theme_toggle.aria_label')}
          className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] transition-all duration-[var(--duration-fast)] hover:bg-bg-hover text-text-tertiary hover:text-text-primary"
        >
          {theme === 'light' ? (
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>

        {/* Version badge */}
        <span className="hidden sm:inline-flex text-[length:11px] font-[var(--font-weight-medium)] px-[var(--spacing-2)] py-[2px] rounded-[var(--radius-full)] bg-tint-green text-accent-green">
          v{__APP_VERSION__}
        </span>
      </div>
    </header>
  );
}
