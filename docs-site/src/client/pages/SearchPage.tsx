import { useState } from 'react';
import { useI18n } from '@/client/i18n/index.js';
import { searchInventory, type SearchResult } from '@/client/routes/route-config.js';
import { CompactSearchInput } from '@/client/components/navigation/index.js';

// ---------------------------------------------------------------------------
// SearchPage — warm minimal search results page
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    if (searchQuery.trim().length >= 2) {
      setResults(searchInventory(searchQuery));
    } else {
      setResults([]);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary mb-[var(--spacing-4)] leading-[1.3]">
          {t('nav.search')}
        </h1>
        <CompactSearchInput onSearch={handleSearch} />
      </div>

      {/* Results count */}
      {query && results.length > 0 && (
        <p className="text-[length:12px] text-text-tertiary mb-[var(--spacing-4)]">
          {t('search.results_count', { count: results.length })}
        </p>
      )}

      {/* No results */}
      {query && results.length === 0 && (
        <div className="text-center py-[var(--spacing-12)]">
          <p className="text-text-secondary">{t('search.no_results')}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-[var(--spacing-2)]">
          {results.map((result, index) => (
            <SearchResultItem key={`${result.type}-${result.slug}-${index}`} result={result} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!query && (
        <div className="text-center py-[var(--spacing-12)]">
          <svg className="w-16 h-16 text-text-placeholder mx-auto mb-[var(--spacing-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <h2 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-text-primary mb-[var(--spacing-2)]">
            Search Maestro Documentation
          </h2>
          <p className="text-text-secondary max-w-md mx-auto">
            Enter a search term to find commands, Claude skills, and Codex skills.
          </p>
        </div>
      )}
    </div>
  );
}

function SearchResultItem({ result }: { result: SearchResult }) {
  const typeLabel = result.type === 'command' ? 'Command' : result.type === 'claude_skill' ? 'Claude' : 'Codex';
  const typeColor = result.type === 'command' ? 'text-accent-blue bg-tint-blue' : result.type === 'claude_skill' ? 'text-accent-purple bg-tint-purple' : 'text-accent-orange bg-tint-orange';

  const href = result.type === 'command' ? `/${result.category}/${result.slug}` : result.type === 'claude_skill' ? `/skills/${result.slug}` : `/codex/${result.slug}`;

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
          <p className="text-[length:12px] text-text-secondary line-clamp-2">{result.description}</p>
        </div>
      </div>
    </a>
  );
}
