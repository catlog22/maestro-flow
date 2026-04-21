import { useI18n } from '@/client/i18n/index.js';
import { MarkdownRenderer } from '@/client/components/content/MarkdownRenderer.js';
import { FloatingToc } from '@/client/components/content/FloatingToc.js';
import { getGuideIcon } from '@/client/utils/guideIcons.js';
import { loadGuide, type GuideContent } from '@/client/data/index.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// GuidePage — renders a guide markdown file with cross-linked commands
// ---------------------------------------------------------------------------

interface GuidePageProps {
  slug: string;
}

export default function GuidePage({ slug }: GuidePageProps) {
  const { t, locale } = useI18n();
  const [content, setContent] = useState<GuideContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isZh = locale === 'zh-CN';

  useEffect(() => {
    async function fetchGuide() {
      try {
        setLoading(true);
        setError(null);
        const data = await loadGuide(slug);
        setContent(data);
        if (!data) setError(`Guide "${slug}" not found`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load guide');
      } finally {
        setLoading(false);
      }
    }
    fetchGuide();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--spacing-12)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-blue" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-[var(--spacing-4)] bg-tint-orange border border-border rounded-[var(--radius-lg)]">
        <p className="text-accent-red">{error}</p>
      </div>
    );
  }

  const displayTitle = isZh && content?.title_zh ? content.title_zh : content?.title;
  const displayDesc = isZh && content?.description_zh ? content.description_zh : content?.description;

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
          <span className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] bg-tint-purple text-accent-purple">
            {getGuideIcon(content?.icon || 'book-open', 'w-4 h-4')}
          </span>
          <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3]">
            {displayTitle}
          </h1>
        </div>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {displayDesc}
        </p>
        {/* Back to guides */}
        <Link
          to="/guides"
          className="inline-flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-accent-blue no-underline hover:underline mt-[var(--spacing-3)]"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {isZh ? '所有指南' : 'All Guides'}
        </Link>
      </div>

      {/* Guide content + floating TOC */}
      <div className="relative">
        <FloatingToc content={content?.rawContent || ''} />
        <MarkdownRenderer content={content?.rawContent || ''} />
      </div>
    </div>
  );
}
