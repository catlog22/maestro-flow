import { useEffect, useState } from 'react';
import { extractToc } from './MarkdownRenderer.js';

// ---------------------------------------------------------------------------
// FloatingToc — sticky right-side table of contents with scroll tracking
// ---------------------------------------------------------------------------

interface FloatingTocProps {
  content: string;
}

export function FloatingToc({ content }: FloatingTocProps) {
  const headings = extractToc(content);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px' }
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav
      className="hidden xl:block fixed top-[calc(var(--size-topbar-height)+var(--spacing-10))] w-[var(--size-toc-width)] ml-[var(--size-content-max-width)] pl-[var(--spacing-8)]"
      aria-label="Table of contents"
    >
      <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[var(--letter-spacing-wide)] text-text-tertiary mb-[var(--spacing-3)]">
        On this page
      </div>
      <ul className="flex flex-col gap-[var(--spacing-1)] border-l border-border-divider">
        {headings.map(({ id, level, text }) => {
          const isActive = activeId === id;
          const indent = level > 2 ? (level - 2) * 12 : 0;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={[
                  'block text-[length:12px] leading-[1.4] py-[2px] transition-colors duration-150 no-underline',
                  isActive
                    ? 'text-accent-blue font-[var(--font-weight-medium)] border-l-2 border-accent-blue -ml-px pl-[calc(var(--spacing-2)-1px)]'
                    : 'text-text-tertiary hover:text-text-secondary pl-[var(--spacing-2)]',
                ].join(' ')}
                style={{ paddingLeft: `calc(var(--spacing-2) + ${indent}px)` }}
              >
                {text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
