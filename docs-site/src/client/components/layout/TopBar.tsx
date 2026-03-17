import { useState } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { SearchInput } from '@/client/components/navigation/index.js';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// TopBar — warm minimal header with logo, search, nav links, version badge
// ---------------------------------------------------------------------------

export function TopBar() {
  const { t, locale, setLocale } = useI18n();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('docs-site-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // Ignore localStorage errors
    }
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
    } catch {
      // Ignore errors
    }
  };

  return (
    <header
      role="banner"
      className="fixed top-0 left-0 right-0 flex items-center justify-between px-[var(--spacing-6)] h-[var(--size-topbar-height)] bg-bg-secondary/85 backdrop-blur-[12px] border-b border-border shrink-0 z-[100]"
    >
      {/* Left: Logo + separator + subtitle */}
      <div className="flex items-center gap-[var(--spacing-4)]">
        <Link to="/" className="flex items-center gap-[var(--spacing-2)] no-underline">
          {/* Logo icon */}
          <span className="w-6 h-6 rounded-[var(--radius-default)] bg-text-primary flex items-center justify-center">
            <svg className="w-[14px] h-[14px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </span>
          <span className="font-[var(--font-weight-bold)] text-[length:16px] text-text-primary">
            Maestro
          </span>
        </Link>
        <span className="w-px h-5 bg-border"></span>
        <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary">
          {t('topbar.title')}
        </span>
      </div>

      {/* Right: search + nav links + language + theme + version */}
      <div className="flex items-center gap-[var(--spacing-3)]">
        {/* Search */}
        <div className="hidden sm:block w-60">
          <SearchInput placeholder={t('topbar.search_placeholder')} />
        </div>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-[var(--spacing-1)]">
          <Link
            to="/"
            className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary no-underline px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-default)] transition-all duration-[var(--duration-fast)] hover:text-text-primary hover:bg-bg-hover"
          >
            {t('nav.home')}
          </Link>
        </nav>

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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>

        {/* Version badge */}
        <span className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2-5)] py-[3px] rounded-full bg-status-bg-completed text-accent-green">
          v0.1.0
        </span>
      </div>
    </header>
  );
}
