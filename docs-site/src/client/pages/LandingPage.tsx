import { useI18n } from '@/client/i18n/index.js';
import type { Category } from '@/client/routes/route-config.js';
import { getCategoryIcon } from '@/client/utils/categoryIcons.js';

// ---------------------------------------------------------------------------
// LandingPage — warm minimal home page with hero + card grid
// ---------------------------------------------------------------------------

interface LandingPageProps {
  categories: Category[];
}

export default function LandingPage({ categories }: LandingPageProps) {
  const { t } = useI18n();

  return (
    <div>
      {/* Hero section */}
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-2)] leading-[1.3]">
          {t('landing.title')}
        </h1>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)] max-w-[520px]">
          {t('landing.description')}
        </p>
      </div>

      {/* Quick guide */}
      <div className="mb-[var(--spacing-8)] p-[var(--spacing-5)] bg-bg-card border border-border rounded-[var(--radius-lg)]">
        <h2 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-3)]">
          {t('landing.quick_guide_title')}
        </h2>
        <ol className="flex flex-col gap-[var(--spacing-2)] list-decimal list-inside text-[length:var(--font-size-sm)] text-text-secondary">
          {Array.from({ length: 4 }, (_, i) => i + 1).map((step) => (
            t(`landing.quick_guide_step${step}`) !== `landing.quick_guide_step${step}` ? (
              <li key={step}>{t(`landing.quick_guide_step${step}`)}</li>
            ) : null
          ))}
        </ol>
      </div>

      {/* Category card grid — 2 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--spacing-3)]">
        {categories.map((category) => (
          <CategoryCard key={category.id} category={category} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoryCard — warm minimal card with icon, hover lift effect
// ---------------------------------------------------------------------------

function CategoryCard({ category }: { category: Category }) {
  const { t } = useI18n();

  // Resolve localized name and description via i18n, fall back to inventory data
  const name = t(`categories.${category.id}`) !== `categories.${category.id}`
    ? t(`categories.${category.id}`) : category.name;
  const description = t(`category_descriptions.${category.id}`) !== `category_descriptions.${category.id}`
    ? t(`category_descriptions.${category.id}`) : category.description;

  // Tint color mapping
  const tintColors: Record<string, string> = {
    pipeline: 'bg-tint-green',
    spec: 'bg-tint-blue',
    quality: 'bg-tint-orange',
    manage: 'bg-tint-gray',
    maestro: 'bg-tint-purple',
    team: 'bg-tint-yellow',
    cli: 'bg-tint-blue',
    brainstorm: 'bg-tint-orange',
    workflow: 'bg-tint-green',
    ddd: 'bg-tint-purple',
    issue: 'bg-tint-orange',
    ui_design: 'bg-tint-purple',
    session: 'bg-tint-blue',
    learn: 'bg-tint-green',
    wiki: 'bg-tint-blue',
  };
  const tint = tintColors[category.id] || 'bg-tint-gray';

  return (
    <a
      href={`/${category.id}`}
      className="block p-[var(--spacing-5)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[180ms] ease-[var(--ease-bounce)] hover:border-text-placeholder hover:-translate-y-[2px] hover:shadow-[var(--shadow-md)]"
    >
      {/* Icon */}
      <div className={`w-8 h-8 rounded-[var(--radius-default)] flex items-center justify-center mb-[var(--spacing-3)] ${tint}`}>
        <span className="text-[length:18px]">{getCategoryIcon(category.id)}</span>
      </div>

      {/* Title */}
      <h3 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-1)]">
        {name}
      </h3>

      {/* Description */}
      <p className="text-[length:12px] text-text-secondary leading-[var(--line-height-normal)] line-clamp-2">
        {description}
      </p>
    </a>
  );
}
