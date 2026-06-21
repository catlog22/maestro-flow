import { useState } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { searchInventory, inventory, type SearchResult } from '@/client/routes/route-config.js';
import { CompactSearchInput } from '@/client/components/navigation/index.js';

export default function SearchPage() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const isZh = locale === 'zh-CN';

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    if (searchQuery.trim().length >= 1) {
      setResults(searchInventory(searchQuery, categoryFilter));
    } else {
      setResults([]);
    }
  };

  const handleCategoryChange = (cat: string | undefined) => {
    setCategoryFilter(cat);
    if (query.trim().length >= 1) {
      setResults(searchInventory(query, cat));
    }
  };

  return (
    <div>
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] leading-[1.3]">
          {t('nav.search')}
        </h1>
        <CompactSearchInput onSearch={handleSearch} />

        {/* Category filter chips */}
        <div className="flex flex-wrap gap-[var(--spacing-2)] mt-[var(--spacing-3)]">
          <FilterChip
            label={isZh ? '全部' : 'All'}
            active={!categoryFilter}
            onClick={() => handleCategoryChange(undefined)}
          />
          {inventory.categories.map((cat) => (
            <FilterChip
              key={cat.id}
              label={cat.name}
              active={categoryFilter === cat.id}
              onClick={() => handleCategoryChange(cat.id)}
            />
          ))}
        </div>
      </div>

      {query && results.length > 0 && (
        <p className="text-[length:12px] text-text-tertiary mb-[var(--spacing-4)]">
          {t('search.results_count', { count: results.length })}
        </p>
      )}

      {query && results.length === 0 && (
        <div className="text-center py-[var(--spacing-12)]">
          <p className="text-text-secondary">{t('search.no_results')}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-[var(--spacing-2)]">
          {results.map((result, index) => (
            <SearchResultItem key={`${result.type}-${result.slug}-${index}`} result={result} isZh={isZh} />
          ))}
        </div>
      )}

      {!query && (
        <div className="text-center py-[var(--spacing-12)]">
          <svg className="w-16 h-16 text-text-placeholder mx-auto mb-[var(--spacing-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <h2 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-2)]">
            {t('search.empty_title')}
          </h2>
          <p className="text-text-secondary max-w-md mx-auto">
            {t('search.empty_description')}
          </p>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-[var(--spacing-3)] py-[var(--spacing-1)] rounded-full text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] transition-colors duration-[var(--duration-fast)]',
        active
          ? 'bg-accent-blue text-white'
          : 'bg-bg-secondary border border-border text-text-secondary hover:border-text-placeholder',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function SearchResultItem({ result, isZh }: { result: SearchResult; isZh: boolean }) {
  const typeLabel = result.type === 'command' ? 'Command' : result.type === 'claude_skill' ? 'Claude' : 'Codex';
  const typeColor = result.type === 'command' ? 'text-accent-blue bg-tint-blue' : result.type === 'claude_skill' ? 'text-accent-purple bg-tint-purple' : 'text-accent-orange bg-tint-orange';

  const href = result.type === 'command' ? `/${result.category}/${result.slug}` : result.type === 'claude_skill' ? `/skills/${result.slug}` : `/codex/${result.slug}`;

  const displayDescription = isZh && result.descriptionZh ? result.descriptionZh : result.description;

  return (
    <a
      href={href}
      className="block p-[var(--spacing-4)] bg-bg-card border border-border rounded-[var(--radius-lg)] no-underline transition-all duration-[var(--duration-fast)] hover:border-text-placeholder hover:shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start gap-[var(--spacing-3)]">
        <span className={`shrink-0 px-[var(--spacing-2)] py-[1px] text-[length:10px] font-[var(--font-weight-semibold)] rounded-full ${typeColor}`}>
          {typeLabel}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-1)]">
            <h3 className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">{result.name}</h3>
            <span className="text-[length:var(--font-size-xs)] text-text-tertiary">{result.category}</span>
          </div>
          <p className="text-[length:12px] text-text-secondary line-clamp-2">{displayDescription}</p>
        </div>
      </div>
    </a>
  );
}
