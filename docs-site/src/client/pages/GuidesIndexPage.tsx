import { useI18n } from '@/client/i18n/index.js';
import { getAllGuideMeta, guideCategories } from '@/client/data/index.js';
import { getGuideIcon } from '@/client/utils/guideIcons.js';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// GuidesIndexPage — categorized guide listing with smooth learning curve
// ---------------------------------------------------------------------------

export default function GuidesIndexPage() {
  const { t, locale } = useI18n();
  const guides = getAllGuideMeta();
  const isZh = locale === 'zh-CN';

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-2)] leading-[1.3]">
          {t('guides.title')}
        </h1>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)] max-w-[520px]">
          {t('guides.description')}
        </p>
      </div>

      {/* Categorized sections */}
      <div className="space-y-[var(--spacing-8)]">
        {guideCategories.map((cat) => {
          const catGuides = guides.filter((g) => g.category === cat.id);
          if (catGuides.length === 0) return null;

          return (
            <section key={cat.id}>
              {/* Category header */}
              <div className="mb-[var(--spacing-4)]">
                <h2 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-1)]">
                  {isZh ? cat.title_zh : cat.title}
                </h2>
                <p className="text-[length:12px] text-text-tertiary">
                  {isZh ? cat.description_zh : cat.description}
                </p>
              </div>

              {/* Guide cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--spacing-3)]">
                {catGuides.map((guide) => (
                  <Link
                    key={guide.slug}
                    to={`/guides/${guide.slug}`}
                    className="block p-[var(--spacing-4)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[180ms] ease-[var(--ease-bounce)] hover:border-text-placeholder hover:-translate-y-[1px] hover:shadow-[var(--shadow-md)]"
                  >
                    {/* Icon + Title */}
                    <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-1)]">
                      <span className="flex items-center justify-center w-7 h-7 rounded-[var(--radius-default)] bg-tint-purple text-accent-purple">
                        {getGuideIcon(guide.icon, 'w-3.5 h-3.5')}
                      </span>
                      <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
                        {isZh && guide.title_zh ? guide.title_zh : guide.title}
                      </h3>
                    </div>

                    {/* Description */}
                    <p className="text-[length:11px] text-text-secondary leading-[var(--line-height-normal)] line-clamp-2 pl-9">
                      {isZh && guide.description_zh ? guide.description_zh : guide.description}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
