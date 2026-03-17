import { NavLink, useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import type { Category } from '@/client/routes/route-config.js';

// ---------------------------------------------------------------------------
// Breadcrumbs — warm minimal breadcrumb trail with chevron separators
// ---------------------------------------------------------------------------

interface BreadcrumbItem {
  label: string;
  href?: string;
  isCurrent: boolean;
}

interface BreadcrumbsProps {
  categories: Category[];
  className?: string;
}

export function Breadcrumbs({ categories, className = '' }: BreadcrumbsProps) {
  const { t } = useI18n();
  const location = useLocation();

  const items = useMemo(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];

    breadcrumbs.push({
      label: t('nav.home'),
      href: '/',
      isCurrent: pathParts.length === 0,
    });

    if (pathParts.length === 0) return breadcrumbs;

    const categoryId = pathParts[0];
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      breadcrumbs.push({
        label: category.name,
        href: `/${categoryId}`,
        isCurrent: pathParts.length === 1,
      });
    }

    if (pathParts.length >= 2) {
      const slug = pathParts[1];
      breadcrumbs.push({
        label: slug,
        href: `/${categoryId}/${slug}`,
        isCurrent: true,
      });
    }

    return breadcrumbs;
  }, [location.pathname, categories, t]);

  if (items.length <= 1) return null;

  return (
    <nav
      className={className}
      aria-label="Breadcrumb"
      itemScope
      itemType="https://schema.org/BreadcrumbList"
    >
      <ol className="flex items-center gap-[var(--spacing-1-5)] text-[length:12px] text-text-tertiary">
        {items.map((item, index) => (
          <li
            key={item.href || index}
            className="flex items-center"
            itemProp="itemListElement"
            itemScope
            itemType="https://schema.org/ListItem"
          >
            <meta itemProp="position" content={String(index + 1)} />

            {index > 0 && (
              <svg
                className="w-[10px] h-[10px] text-text-placeholder mx-[var(--spacing-1)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}

            {item.isCurrent ? (
              <span
                className="text-text-primary font-[var(--font-weight-medium)]"
                aria-current="page"
                itemProp="name"
              >
                {item.label}
              </span>
            ) : (
              <NavLink
                to={item.href!}
                className="text-text-tertiary transition-colors duration-[var(--duration-fast)] hover:text-text-primary rounded"
                itemProp="item"
              >
                <span itemProp="name">{item.label}</span>
              </NavLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// CompactBreadcrumbs — simplified version for mobile
// ---------------------------------------------------------------------------

interface CompactBreadcrumbsProps {
  maxItems?: number;
  categories: Category[];
  className?: string;
}

export function CompactBreadcrumbs({
  maxItems = 3,
  categories,
  className = '',
}: CompactBreadcrumbsProps) {
  const { t } = useI18n();
  const location = useLocation();

  const items = useMemo(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];

    breadcrumbs.push({
      label: t('nav.home'),
      href: '/',
      isCurrent: pathParts.length === 0,
    });

    if (pathParts.length === 0) return breadcrumbs;

    const categoryId = pathParts[0];
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      breadcrumbs.push({
        label: category.name,
        href: `/${categoryId}`,
        isCurrent: pathParts.length === 1,
      });
    }

    if (pathParts.length >= 2) {
      breadcrumbs.push({
        label: pathParts[pathParts.length - 1],
        href: undefined,
        isCurrent: true,
      });
    }

    return breadcrumbs;
  }, [location.pathname, categories, t]);

  if (items.length <= 1) return null;

  const displayItems =
    items.length > maxItems
      ? [items[0], { label: '...', href: undefined, isCurrent: false }, items[items.length - 1]]
      : items;

  return (
    <nav className={className} aria-label="Breadcrumb">
      <div className="flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-xs)] text-text-tertiary">
        {displayItems.map((item, index) => (
          <span key={index} className="flex items-center">
            {index > 0 && (
              <svg
                className="w-[10px] h-[10px] text-text-placeholder mx-[var(--spacing-1)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
            {item.href && !item.isCurrent ? (
              <a
                href={item.href}
                className="hover:text-text-primary transition-colors truncate max-w-[100px]"
              >
                {item.label}
              </a>
            ) : (
              <span className="text-text-primary font-[var(--font-weight-medium)] truncate max-w-[120px]">
                {item.label}
              </span>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}
