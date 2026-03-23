import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// MainContent — wrapper for the main content area (route outlet)
// ---------------------------------------------------------------------------

/** Routes that need full-bleed layout (no padding, no overflow-y) */
const FULL_BLEED_ROUTES = ['/supervisor'];

export function MainContent({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <main
      role="main"
      aria-label={t('accessibility.main_content')}
      className={
        isFullBleed
          ? 'flex-1 overflow-hidden bg-bg-primary'
          : 'flex-1 overflow-y-auto bg-bg-primary p-[var(--spacing-4)] sm:p-[var(--spacing-4)] max-sm:p-[var(--spacing-2)]'
      }
    >
      {children}
    </main>
  );
}
