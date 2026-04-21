import { useI18n } from '@/client/i18n/index.js';
import { getAllGuideMeta } from '@/client/data/index.js';
import { getGuideIcon } from '@/client/utils/guideIcons.js';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// GuidesIndexPage — grid listing of all available guides
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
          {isZh ? '指南' : 'Guides'}
        </h1>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)] max-w-[520px]">
          {isZh
            ? '深入了解 Maestro 的各个子系统 — 命令体系、Overlay 扩展、团队协作、并行开发等'
            : 'Deep-dive guides into Maestro subsystems — commands, overlays, team collaboration, parallel development, and more'}
        </p>
      </div>

      {/* Guide cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--spacing-4)]">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            to={`/guides/${guide.slug}`}
            className="block p-[var(--spacing-5)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[180ms] ease-[var(--ease-bounce)] hover:border-text-placeholder hover:-translate-y-[2px] hover:shadow-[var(--shadow-md)]"
          >
            {/* Icon + Title */}
            <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-2)]">
              <span className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] bg-tint-purple text-accent-purple">
                {getGuideIcon(guide.icon, 'w-4 h-4')}
              </span>
              <h3 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">
                {isZh && guide.title_zh ? guide.title_zh : guide.title}
              </h3>
            </div>

            {/* Description */}
            <p className="text-[length:12px] text-text-secondary leading-[var(--line-height-normal)] line-clamp-3">
              {isZh && guide.description_zh ? guide.description_zh : guide.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
