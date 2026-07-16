import type { ReactNode } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { useVersion } from '@/client/version/index.js';
import { Breadcrumbs } from '@/client/components/navigation/index.js';
import { getInventory } from '@/client/routes/route-config.js';

// ---------------------------------------------------------------------------
// MainContent — Gemini CLI style: clean content area
// ---------------------------------------------------------------------------

interface MainContentProps {
  children?: ReactNode;
  showBreadcrumbs?: boolean;
}

export function MainContent({ children, showBreadcrumbs = true }: MainContentProps) {
  const { t } = useI18n();
  const { version } = useVersion();
  return (
    <main
      role="main"
      aria-label={t('accessibility.main_content')}
      className="lg:ml-[var(--size-sidebar-width)] flex-1 overflow-y-auto bg-bg-primary"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 bg-bg-primary border border-border rounded-[var(--radius-default)] text-text-primary text-[length:var(--font-size-sm)]"
      >
        {t('accessibility.skip_to_content')}
      </a>

      <div id="main-content" className="max-w-[var(--size-content-max-width)] mx-auto px-[var(--spacing-6)] sm:px-[var(--spacing-8)] lg:px-[var(--spacing-10)] py-[var(--spacing-8)] lg:py-[var(--spacing-10)]">
        {showBreadcrumbs && (
          <div className="mb-[var(--spacing-6)]">
            <Breadcrumbs categories={getInventory(version).categories} />
          </div>
        )}
        {children}
      </div>
    </main>
  );
}
