import type { ReactNode } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { Breadcrumbs } from '@/client/components/navigation/index.js';
import { inventoryData } from '@/client/routes/route-config.js';

// ---------------------------------------------------------------------------
// MainContent — warm minimal content area with centered max-width
// ---------------------------------------------------------------------------

interface MainContentProps {
  children?: ReactNode;
  showBreadcrumbs?: boolean;
}

export function MainContent({ children, showBreadcrumbs = true }: MainContentProps) {
  const { t } = useI18n();
  return (
    <main
      role="main"
      aria-label={t('accessibility.main_content')}
      className="ml-[var(--size-sidebar-width)] flex-1 overflow-y-auto bg-bg-primary min-h-screen"
    >
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 bg-bg-primary border border-border rounded-[var(--radius-default)] text-text-primary text-[length:var(--font-size-sm)]"
      >
        {t('accessibility.skip_to_content')}
      </a>

      <div id="main-content" className="max-w-[var(--size-content-max-width)] mx-auto px-[var(--spacing-10)] py-[var(--spacing-10)]">
        {/* Breadcrumbs */}
        {showBreadcrumbs && (
          <div className="mb-[var(--spacing-6)]">
            <Breadcrumbs categories={inventoryData.categories} />
          </div>
        )}

        {/* Content */}
        {children}
      </div>
    </main>
  );
}
