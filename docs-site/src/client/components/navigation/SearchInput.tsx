import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/client/i18n/index.js';
import { searchInventory, type SearchResult } from '@/client/routes/route-config.js';

// ---------------------------------------------------------------------------
// SearchInput — warm minimal search with Ctrl+K shortcut and dropdown
// ---------------------------------------------------------------------------

interface SearchInputProps {
  className?: string;
  placeholder?: string;
}

export function SearchInput({ className = '', placeholder }: SearchInputProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      const searchResults = searchInventory(query);
      setResults(searchResults.slice(0, 8));
      setFocusedIndex(-1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && results[focusedIndex]) {
            selectResult(results[focusedIndex]);
          } else if (results.length > 0) {
            selectResult(results[0]);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    },
    [results, focusedIndex]
  );

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectResult = (result: SearchResult) => {
    const href =
      result.type === 'command'
        ? `/${result.category}/${result.slug}`
        : result.type === 'claude_skill'
          ? `/skills/${result.slug}`
          : `/codex/${result.slug}`;
    navigate(href);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const getTypeLabel = (type: SearchResult['type']): string => {
    switch (type) {
      case 'command': return t('search.type.command');
      case 'claude_skill': return t('search.type.claude_skill');
      case 'codex_skill': return t('search.type.codex_skill');
    }
  };

  const getTypeColor = (type: SearchResult['type']): string => {
    switch (type) {
      case 'command': return 'text-accent-blue';
      case 'claude_skill': return 'text-accent-purple';
      case 'codex_skill': return 'text-accent-orange';
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Search input — warm minimal card style */}
      <div className="relative flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[7px] bg-bg-card border border-border rounded-[var(--radius-md)] text-[length:var(--font-size-sm)] text-text-tertiary cursor-text transition-all duration-[var(--duration-fast)] hover:border-text-placeholder focus-within:border-border-focused focus-within:shadow-[var(--shadow-focus-ring)]">
        <svg
          className="w-[14px] h-[14px] shrink-0 text-text-tertiary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || t('topbar.search_placeholder')}
          aria-label={t('topbar.aria_search')}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls="search-results"
          aria-activedescendant={focusedIndex >= 0 ? `result-${focusedIndex}` : undefined}
          className="flex-1 bg-transparent border-none outline-none text-text-primary placeholder:text-text-tertiary text-[length:var(--font-size-sm)] pr-14"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 text-[length:10px] font-sans px-[var(--spacing-1-5)] py-[1px] bg-bg-primary border border-border rounded text-text-placeholder pointer-events-none">
          <span className="text-[10px]">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</span>
          <span>K</span>
        </kbd>
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          id="search-results"
          role="listbox"
          className="absolute z-50 w-full mt-[var(--spacing-1)] overflow-hidden bg-bg-card border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]"
        >
          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.slug}`}
              id={`result-${index}`}
              role="option"
              aria-selected={focusedIndex === index}
              onClick={() => selectResult(result)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={[
                'w-full px-[var(--spacing-3)] py-[var(--spacing-2)]',
                'text-left transition-colors duration-[var(--duration-fast)]',
                'focus-visible:outline-none',
                focusedIndex === index ? 'bg-bg-hover' : '',
                'border-b border-border-divider last:border-b-0',
              ].join(' ')}
            >
              <div className="flex items-start gap-[var(--spacing-2)]">
                <span
                  className={[
                    'shrink-0 px-[var(--spacing-1-5)] py-[1px] text-[length:var(--font-size-xs)]',
                    'font-[var(--font-weight-medium)] rounded-[var(--radius-sm)]',
                    'bg-bg-secondary',
                    getTypeColor(result.type),
                  ].join(' ')}
                >
                  {getTypeLabel(result.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[var(--spacing-1-5)]">
                    <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary">
                      {result.name}
                    </span>
                    <span className="text-[length:var(--font-size-xs)] text-text-tertiary">
                      {result.category}
                    </span>
                  </div>
                  <p className="text-[length:var(--font-size-xs)] text-text-secondary truncate mt-0.5">
                    {result.description}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {isOpen && query.length >= 2 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-2)] bg-bg-card border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] text-[length:var(--font-size-sm)] text-text-secondary">
          {t('search.no_results')}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactSearchInput — smaller version for inline use
// ---------------------------------------------------------------------------

interface CompactSearchInputProps {
  onSearch: (query: string) => void;
  className?: string;
}

export function CompactSearchInput({ onSearch, className = '' }: CompactSearchInputProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="relative flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[7px] bg-bg-card border border-border rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] hover:border-text-placeholder focus-within:border-border-focused">
        <svg
          className="w-[14px] h-[14px] text-text-tertiary shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          className="flex-1 bg-transparent border-none outline-none text-text-primary placeholder:text-text-placeholder text-[length:var(--font-size-sm)]"
        />
      </div>
    </form>
  );
}
