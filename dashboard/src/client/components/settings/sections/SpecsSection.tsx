import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { SettingsCard, SettingsSaveBar } from '../SettingsComponents.js';
import { cn } from '@/client/lib/utils.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// SpecsSection — read-only spec directory browser
// ---------------------------------------------------------------------------

interface SpecEntry {
  name: string;
  path: string;
  createdAt?: string;
}

export function SpecsSection() {
  const { t } = useI18n();
  const [specs, setSpecs] = useState<SpecEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSpecs() {
      try {
        const res = await fetch('/api/settings/specs');
        if (!res.ok) throw new Error(`Failed to load specs: ${res.status}`);
        const data = (await res.json()) as { specs: SpecEntry[] };
        if (!cancelled) {
          setSpecs(data.specs ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load specs');
          setLoading(false);
        }
      }
    }

    void fetchSpecs();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--spacing-8)]">
        <span className="text-[length:var(--font-size-sm)] text-text-secondary">
          {t('settings.specs.loading')}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <SettingsCard title={t('settings.specs.error_card')} description={t('settings.specs.error_desc')}>
        <p className="text-[length:var(--font-size-sm)] text-status-blocked">{error}</p>
      </SettingsCard>
    );
  }

  if (specs.length === 0) {
    return (
      <div className="flex flex-col gap-[var(--spacing-6)]">
        <SettingsCard
          title={t('settings.specs.empty_card')}
          description={t('settings.specs.empty_desc')}
        >
          <p className="text-[length:var(--font-size-sm)] text-text-secondary italic">
            {t('settings.specs.empty_hint')}
          </p>
        </SettingsCard>
        <SpecInjectionConfig />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-6)]">
      <div className="flex flex-col gap-[var(--spacing-3)]">
        {specs.map((spec) => (
          <SettingsCard key={spec.name} title={spec.name} description={spec.path}>
            {spec.createdAt && (
              <span className="text-[length:var(--font-size-xs)] text-text-tertiary">
                {t('settings.specs.created')}: {spec.createdAt}
              </span>
            )}
          </SettingsCard>
        ))}
      </div>
      <SpecInjectionConfig />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types for spec injection config
// ---------------------------------------------------------------------------

interface AgentMapping {
  categories?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  extras?: string[];
}

interface CategoryDoc {
  specFiles?: string[];
  docs?: string[];
}

interface AlwaysInjectData {
  docs?: string[];
  keywords?: string[];
  categories?: string[];
}

interface SpecInjectionConfigData {
  mapping?: Record<string, AgentMapping>;
  categoryDocs?: Record<string, CategoryDoc>;
  always?: AlwaysInjectData;
  keywordFilters?: { include?: string[]; exclude?: string[] };
  maxContentLength?: number;
}

interface SpecInjectionDefaults {
  agentCategoryMap: Record<string, string[]>;
  categoryFileMap: Record<string, string>;
  validCategories: string[];
}

// ---------------------------------------------------------------------------
// TagChip — small removable tag
// ---------------------------------------------------------------------------

function TagChip({
  label,
  onRemove,
  variant = 'default',
}: {
  label: string;
  onRemove: () => void;
  variant?: 'default' | 'include' | 'exclude';
}) {
  const colorClass =
    variant === 'include'
      ? 'bg-status-active/15 text-status-active border-status-active/30'
      : variant === 'exclude'
        ? 'bg-status-blocked/15 text-status-blocked border-status-blocked/30'
        : 'bg-bg-hover text-text-secondary border-border';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-0-5)]',
        'rounded-[var(--radius-sm)] border text-[length:var(--font-size-xs)]',
        colorClass,
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-[var(--spacing-0-5)] text-current opacity-60 hover:opacity-100 focus-visible:outline-none"
        aria-label={`Remove ${label}`}
      >
        x
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TagInput — inline input that adds tags on Enter
// ---------------------------------------------------------------------------

function TagInput({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      onAdd(value.trim());
      setValue('');
    }
  };

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={cn(
        'px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
        'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
        'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
        'transition-colors duration-[var(--duration-fast)]',
        'placeholder:text-text-tertiary w-40',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — togglable section header
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  description,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-[var(--radius-default)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between px-[var(--spacing-4)] py-[var(--spacing-3)]',
          'bg-bg-secondary hover:bg-bg-hover transition-colors duration-[var(--duration-fast)]',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
        )}
      >
        <div className="text-left">
          <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
            {title}
          </span>
          {description && (
            <p className="mt-[var(--spacing-0-5)] text-[length:var(--font-size-xs)] text-text-secondary">
              {description}
            </p>
          )}
        </div>
        <span className="text-[length:var(--font-size-xs)] text-text-tertiary shrink-0 ml-[var(--spacing-2)]">
          {expanded ? '[-]' : '[+]'}
        </span>
      </button>
      {expanded && (
        <div className="px-[var(--spacing-4)] py-[var(--spacing-3)] border-t border-border bg-bg-primary">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category color mapping for visual distinction
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  coding: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
  arch: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
  debug: 'bg-accent-orange/15 text-accent-orange border-accent-orange/30',
  test: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  review: 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30',
  learning: 'bg-status-active/15 text-status-active border-status-active/30',
  ui: 'bg-accent-purple/15 text-accent-purple border-accent-purple/30',
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? 'bg-bg-hover text-text-secondary border-border';
}

// ---------------------------------------------------------------------------
// CategoryPill — colored pill for a category name
// ---------------------------------------------------------------------------

function CategoryPill({ name }: { name: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-[var(--spacing-1-5)] py-[var(--spacing-0-5)]',
        'rounded-full border text-[length:var(--font-size-xs)]',
        getCategoryColor(name),
      )}
    >
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PathListWithSuggestions — editable path list with suggestions & validation
// ---------------------------------------------------------------------------

function PathListWithSuggestions({
  paths,
  onChange,
  placeholder,
  suggestions,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isValidPath = (p: string): boolean => {
    if (!p.trim()) return false;
    // Basic path validation: should have at least one segment and look like a path
    return /^[.\/~]|^\w/.test(p) && !p.includes(' ') || p.includes('/') || p.includes('.');
  };

  const handleAdd = (value: string) => {
    const v = value.trim();
    if (v && !paths.includes(v)) {
      onChange([...paths, v]);
    }
    setInputValue('');
    setShowSuggestions(false);
  };

  const filteredSuggestions = (suggestions ?? []).filter(
    (s) => !paths.includes(s) && (!inputValue || s.toLowerCase().includes(inputValue.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-[var(--spacing-1-5)]">
      {paths.map((p, i) => (
        <div key={`${p}-${i}`} className="flex items-center gap-[var(--spacing-2)]">
          <span className="text-[length:var(--font-size-xs)] text-text-secondary font-mono truncate flex-1 min-w-0">
            {p}
          </span>
          <span className={cn(
            'text-[length:var(--font-size-xs)] shrink-0',
            isValidPath(p) ? 'text-accent-green' : 'text-accent-orange',
          )}>
            {isValidPath(p) ? '[ok]' : '[?]'}
          </span>
          <button
            type="button"
            onClick={() => onChange(paths.filter((_, idx) => idx !== i))}
            className="text-[length:var(--font-size-xs)] text-status-blocked opacity-60 hover:opacity-100 shrink-0 focus-visible:outline-none"
            aria-label={`Remove ${p}`}
          >
            x
          </button>
        </div>
      ))}
      <div className="relative">
        <div className="flex items-center gap-[var(--spacing-1)]">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // Delay to allow click on suggestions
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                e.preventDefault();
                handleAdd(inputValue);
              }
            }}
            placeholder={placeholder}
            className={cn(
              'px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
              'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
              'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
              'transition-colors duration-[var(--duration-fast)]',
              'placeholder:text-text-tertiary w-56',
            )}
          />
          {inputValue && (
            <span className={cn(
              'text-[length:var(--font-size-xs)] shrink-0',
              isValidPath(inputValue) ? 'text-accent-green' : 'text-accent-orange',
            )}>
              {isValidPath(inputValue) ? '[ok]' : '[?]'}
            </span>
          )}
        </div>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className={cn(
            'absolute top-full left-0 mt-[var(--spacing-0-5)] z-10',
            'border border-border rounded-[var(--radius-sm)] bg-bg-secondary shadow-lg',
            'max-h-32 overflow-y-auto w-56',
          )}>
            {filteredSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAdd(s)}
                className={cn(
                  'w-full text-left px-[var(--spacing-2)] py-[var(--spacing-1)]',
                  'text-[length:var(--font-size-xs)] text-text-secondary font-mono',
                  'hover:bg-bg-hover hover:text-text-primary',
                  'transition-colors duration-[var(--duration-fast)]',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeywordBrowser — keyword discovery panel
// ---------------------------------------------------------------------------

function KeywordBrowser({
  config,
  defaults,
  onQuickBind,
}: {
  config: SpecInjectionConfigData;
  defaults: SpecInjectionDefaults;
  onQuickBind: (keyword: string, agent: string) => void;
}) {
  const [filterInput, setFilterInput] = useState('');
  const [expandedKeyword, setExpandedKeyword] = useState<string | null>(null);
  const [quickBindAgent, setQuickBindAgent] = useState<Record<string, string>>({});

  // Collect all keywords referenced across the config
  const keywordMap = useMemo(() => {
    const map = new Map<string, { agents: string[]; type: 'include' | 'exclude'; source: string }[]>();

    const addRef = (kw: string, agent: string, type: 'include' | 'exclude', source: string) => {
      if (!map.has(kw)) map.set(kw, []);
      map.get(kw)!.push({ agents: [agent], type, source });
    };

    // From agent mappings
    for (const [agent, mapping] of Object.entries(config.mapping ?? {})) {
      for (const kw of mapping.includeKeywords ?? []) {
        addRef(kw, agent, 'include', 'agent');
      }
      for (const kw of mapping.excludeKeywords ?? []) {
        addRef(kw, agent, 'exclude', 'agent');
      }
    }

    // From global keyword filters
    for (const kw of config.keywordFilters?.include ?? []) {
      addRef(kw, '(global)', 'include', 'global');
    }
    for (const kw of config.keywordFilters?.exclude ?? []) {
      addRef(kw, '(global)', 'exclude', 'global');
    }

    return map;
  }, [config]);

  const allKeywords = useMemo(() => {
    const kws = Array.from(keywordMap.keys()).sort();
    if (!filterInput.trim()) return kws;
    const q = filterInput.toLowerCase();
    return kws.filter((k) => k.toLowerCase().includes(q));
  }, [keywordMap, filterInput]);

  const allAgents = Object.keys(defaults.agentCategoryMap);

  return (
    <div className="flex flex-col gap-[var(--spacing-3)]">
      {/* Search input */}
      <div>
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="Filter or type a new keyword..."
          className={cn(
            'w-full px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
            'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
            'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
            'transition-colors duration-[var(--duration-fast)]',
            'placeholder:text-text-tertiary',
          )}
        />
      </div>

      {allKeywords.length === 0 ? (
        <p className="text-[length:var(--font-size-xs)] text-text-tertiary italic">
          {keywordMap.size === 0
            ? 'No keywords configured yet. Add keywords to agent mappings or global filters below.'
            : 'No keywords match the filter.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-[var(--spacing-1-5)]">
          {allKeywords.map((kw) => {
            const refs = keywordMap.get(kw) ?? [];
            const hasInclude = refs.some((r) => r.type === 'include');
            const hasExclude = refs.some((r) => r.type === 'exclude');
            const isExpanded = expandedKeyword === kw;
            const variant = hasExclude && !hasInclude ? 'exclude' : hasInclude ? 'include' : 'default';

            const colorClass =
              variant === 'include'
                ? 'bg-status-active/15 text-status-active border-status-active/30'
                : variant === 'exclude'
                  ? 'bg-status-blocked/15 text-status-blocked border-status-blocked/30'
                  : 'bg-bg-hover text-text-secondary border-border';

            return (
              <div key={kw} className="relative">
                <button
                  type="button"
                  onClick={() => setExpandedKeyword(isExpanded ? null : kw)}
                  className={cn(
                    'inline-flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-0-5)]',
                    'rounded-[var(--radius-sm)] border text-[length:var(--font-size-xs)]',
                    'cursor-pointer transition-opacity duration-[var(--duration-fast)]',
                    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
                    colorClass,
                    isExpanded && 'ring-1 ring-accent-blue',
                  )}
                >
                  {kw}
                  <span className="text-[length:10px] opacity-60">
                    ({refs.length})
                  </span>
                </button>

                {/* Expanded detail popover */}
                {isExpanded && (
                  <div className={cn(
                    'absolute top-full left-0 mt-[var(--spacing-1)] z-20',
                    'border border-border rounded-[var(--radius-sm)] bg-bg-secondary shadow-lg',
                    'p-[var(--spacing-2)] min-w-48',
                  )}>
                    <div className="flex flex-col gap-[var(--spacing-1-5)]">
                      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-primary">
                        Referenced by:
                      </span>
                      {refs.map((ref, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-xs)]"
                        >
                          <span className={cn(
                            'px-[var(--spacing-1)] rounded-[2px]',
                            ref.type === 'include'
                              ? 'bg-status-active/15 text-status-active'
                              : 'bg-status-blocked/15 text-status-blocked',
                          )}>
                            {ref.type}
                          </span>
                          <span className="text-text-secondary">
                            {ref.agents[0]}
                          </span>
                        </div>
                      ))}

                      {/* Quick Bind controls */}
                      <div className="border-t border-border-divider pt-[var(--spacing-1-5)] mt-[var(--spacing-0-5)]">
                        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                          Quick Bind:
                        </span>
                        <div className="flex items-center gap-[var(--spacing-1)]">
                          <select
                            value={quickBindAgent[kw] ?? ''}
                            onChange={(e) => setQuickBindAgent((prev) => ({ ...prev, [kw]: e.target.value }))}
                            className={cn(
                              'flex-1 px-[var(--spacing-1)] py-[var(--spacing-0-5)] rounded-[var(--radius-sm)]',
                              'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
                              'focus:outline-none focus:border-accent-blue',
                            )}
                          >
                            <option value="" disabled>Agent...</option>
                            {allAgents.map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!quickBindAgent[kw]}
                            onClick={() => {
                              if (quickBindAgent[kw]) {
                                onQuickBind(kw, quickBindAgent[kw]);
                                setExpandedKeyword(null);
                                setQuickBindAgent((prev) => {
                                  const next = { ...prev };
                                  delete next[kw];
                                  return next;
                                });
                              }
                            }}
                            className={cn(
                              'px-[var(--spacing-1-5)] py-[var(--spacing-0-5)] rounded-[var(--radius-sm)]',
                              'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                              'bg-accent-blue text-white',
                              'hover:opacity-90 transition-opacity duration-[var(--duration-fast)]',
                              'disabled:opacity-40 disabled:pointer-events-none',
                              'focus-visible:outline-none',
                            )}
                          >
                            +Add
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentPreviewModal — shows effective injection summary for an agent
// ---------------------------------------------------------------------------

function AgentPreviewModal({
  agent,
  mapping,
  defaults,
  config,
  onClose,
}: {
  agent: string;
  mapping: AgentMapping;
  defaults: SpecInjectionDefaults;
  config: SpecInjectionConfigData;
  onClose: () => void;
}) {
  const defaultCats = defaults.agentCategoryMap[agent] ?? [];
  const effectiveCats = mapping.categories ?? defaultCats;
  const includeKw = [
    ...(config.keywordFilters?.include ?? []),
    ...(mapping.includeKeywords ?? []),
  ];
  const excludeKw = [
    ...(config.keywordFilters?.exclude ?? []),
    ...(mapping.excludeKeywords ?? []),
  ];
  const specFiles: string[] = [];
  for (const cat of effectiveCats) {
    const defaultFile = defaults.categoryFileMap[cat];
    if (defaultFile) specFiles.push(defaultFile);
    const catDoc = config.categoryDocs?.[cat];
    if (catDoc?.specFiles) specFiles.push(...catDoc.specFiles);
    if (catDoc?.docs) specFiles.push(...catDoc.docs);
  }
  const alwaysDocs = config.always?.docs ?? [];
  const alwaysKeywords = config.always?.keywords ?? [];
  const alwaysCategories = config.always?.categories ?? [];
  const extraDocs = mapping.extras ?? [];
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full right-0 mt-[var(--spacing-1)] z-20',
        'border border-border rounded-[var(--radius-sm)] bg-bg-secondary shadow-lg',
        'p-[var(--spacing-3)] min-w-64 max-w-80',
      )}
    >
      <div className="flex items-center justify-between mb-[var(--spacing-2)]">
        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-primary">
          Effective Injection: {agent}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[length:var(--font-size-xs)] text-text-tertiary hover:text-text-primary focus-visible:outline-none"
        >
          [x]
        </button>
      </div>

      <div className="flex flex-col gap-[var(--spacing-2)] text-[length:var(--font-size-xs)]">
        {/* Categories */}
        <div>
          <span className="font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-0-5)]">
            Categories:
          </span>
          <div className="flex flex-wrap gap-[var(--spacing-1)]">
            {effectiveCats.length > 0 ? (
              effectiveCats.map((c) => <CategoryPill key={c} name={c} />)
            ) : (
              <span className="text-text-tertiary italic">none</span>
            )}
          </div>
        </div>

        {/* Spec files */}
        <div>
          <span className="font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-0-5)]">
            Spec Files ({specFiles.length}):
          </span>
          {specFiles.length > 0 ? (
            <div className="flex flex-col gap-[var(--spacing-0-5)]">
              {specFiles.map((f, i) => (
                <span key={`${f}-${i}`} className="text-text-secondary font-mono truncate">{f}</span>
              ))}
            </div>
          ) : (
            <span className="text-text-tertiary italic">none</span>
          )}
        </div>

        {/* Keyword filters */}
        {(includeKw.length > 0 || excludeKw.length > 0) && (
          <div>
            <span className="font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-0-5)]">
              Keyword Filters:
            </span>
            {includeKw.length > 0 && (
              <div className="flex flex-wrap gap-[var(--spacing-0-5)] mb-[var(--spacing-0-5)]">
                {includeKw.map((kw, i) => (
                  <span key={`inc-${kw}-${i}`} className="px-[var(--spacing-1)] rounded-[2px] bg-status-active/15 text-status-active">
                    +{kw}
                  </span>
                ))}
              </div>
            )}
            {excludeKw.length > 0 && (
              <div className="flex flex-wrap gap-[var(--spacing-0-5)]">
                {excludeKw.map((kw, i) => (
                  <span key={`exc-${kw}-${i}`} className="px-[var(--spacing-1)] rounded-[2px] bg-status-blocked/15 text-status-blocked">
                    -{kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Always inject (session start) */}
        {(alwaysDocs.length > 0 || alwaysKeywords.length > 0 || alwaysCategories.length > 0) && (
          <div>
            <span className="font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-0-5)]">
              Always (session start):
            </span>
            <div className="flex flex-col gap-[var(--spacing-0-5)]">
              {alwaysDocs.map((f, i) => (
                <span key={`doc-${f}-${i}`} className="text-text-secondary font-mono truncate">{f}</span>
              ))}
              {alwaysKeywords.map((k, i) => (
                <span key={`kw-${k}-${i}`} className="text-accent-green text-[length:var(--font-size-xs)]">kw:{k}</span>
              ))}
              {alwaysCategories.map((c, i) => (
                <span key={`cat-${c}-${i}`} className="text-accent-purple text-[length:var(--font-size-xs)]">cat:{c}</span>
              ))}
            </div>
          </div>
        )}

        {/* Extra docs */}
        {extraDocs.length > 0 && (
          <div>
            <span className="font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-0-5)]">
              Extra Docs ({extraDocs.length}):
            </span>
            <div className="flex flex-col gap-[var(--spacing-0-5)]">
              {extraDocs.map((f, i) => (
                <span key={`${f}-${i}`} className="text-text-secondary font-mono truncate">{f}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Common path suggestions for document paths
// ---------------------------------------------------------------------------

const DOC_PATH_SUGGESTIONS = [
  '.workflow/docs/',
  '.workflow/knowhow/',
  'docs/',
  '.workflow/specs/',
  '.maestro/specs/',
  '.maestro/knowhow/',
];

// ---------------------------------------------------------------------------
// SpecInjectionConfig — main config panel
// ---------------------------------------------------------------------------

function SpecInjectionConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<SpecInjectionConfigData>({});
  const [defaults, setDefaults] = useState<SpecInjectionDefaults | null>(null);
  const [original, setOriginal] = useState<string>('{}');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  const [addingAgent, setAddingAgent] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [previewAgent, setPreviewAgent] = useState<string | null>(null);

  const isDirty = JSON.stringify(config) !== original;

  useEffect(() => {
    let cancelled = false;

    async function fetchConfig() {
      try {
        const res = await fetch('/api/settings/spec-injection');
        if (!res.ok) throw new Error(`Failed to load spec injection config: ${res.status}`);
        const data = (await res.json()) as {
          config: SpecInjectionConfigData;
          defaults: SpecInjectionDefaults;
        };
        if (!cancelled) {
          setConfig(data.config ?? {});
          setOriginal(JSON.stringify(data.config ?? {}));
          setDefaults(data.defaults);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load config');
          setLoading(false);
        }
      }
    }

    void fetchConfig();
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/spec-injection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setOriginal(JSON.stringify(config));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleDiscard = useCallback(() => {
    setConfig(JSON.parse(original));
    setError(null);
  }, [original]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAgent = (agent: string) => {
    setExpandedAgents((prev) => ({ ...prev, [agent]: !prev[agent] }));
  };

  // --- Mutation helpers ---

  const updateMapping = (agent: string, patch: Partial<AgentMapping>) => {
    setConfig((prev) => ({
      ...prev,
      mapping: {
        ...prev.mapping,
        [agent]: { ...prev.mapping?.[agent], ...patch },
      },
    }));
  };

  const removeAgent = (agent: string) => {
    setConfig((prev) => {
      const next = { ...prev.mapping };
      delete next[agent];
      return { ...prev, mapping: Object.keys(next).length > 0 ? next : undefined };
    });
  };

  const updateCategoryDocs = (cat: string, patch: Partial<CategoryDoc>) => {
    setConfig((prev) => ({
      ...prev,
      categoryDocs: {
        ...prev.categoryDocs,
        [cat]: { ...prev.categoryDocs?.[cat], ...patch },
      },
    }));
  };

  const removeCategory = (cat: string) => {
    setConfig((prev) => {
      const next = { ...prev.categoryDocs };
      delete next[cat];
      return { ...prev, categoryDocs: Object.keys(next).length > 0 ? next : undefined };
    });
  };

  const quickBindKeyword = useCallback((keyword: string, agent: string) => {
    setConfig((prev) => {
      const existingMapping = prev.mapping?.[agent] ?? {};
      const currentIncludes = existingMapping.includeKeywords ?? [];
      if (currentIncludes.includes(keyword)) return prev;
      const defaultCats = defaults?.agentCategoryMap[agent] ?? [];
      return {
        ...prev,
        mapping: {
          ...prev.mapping,
          [agent]: {
            ...existingMapping,
            categories: existingMapping.categories ?? [...defaultCats],
            includeKeywords: [...currentIncludes, keyword],
          },
        },
      };
    });
  }, [defaults]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[var(--spacing-4)]">
        <span className="text-[length:var(--font-size-sm)] text-text-secondary">
          Loading injection config...
        </span>
      </div>
    );
  }

  if (!defaults) return null;

  const mappedAgents = Object.keys(config.mapping ?? {});
  const unmappedAgents = Object.keys(defaults.agentCategoryMap).filter(
    (a) => !mappedAgents.includes(a),
  );
  const configuredCategories = Object.keys(config.categoryDocs ?? {});
  const unconfiguredCategories = defaults.validCategories.filter(
    (c) => !configuredCategories.includes(c),
  );

  return (
    <div className="flex flex-col gap-[var(--spacing-3)]">
      <div className="mb-[var(--spacing-1)]">
        <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
          Spec Injection Config
        </h3>
        <p className="mt-[var(--spacing-0-5)] text-[length:var(--font-size-xs)] text-text-secondary">
          Configure which specs and docs are injected into agent contexts
        </p>
      </div>

      {error && (
        <p className="text-[length:var(--font-size-xs)] text-status-blocked px-[var(--spacing-1)]">
          {error}
        </p>
      )}

      {/* --- Keyword Browser --- */}
      <CollapsibleSection
        title="Keyword Browser"
        description="Discover and manage keywords referenced across agent mappings and global filters"
        expanded={!!expandedSections['keywords-browser']}
        onToggle={() => toggleSection('keywords-browser')}
      >
        <KeywordBrowser
          config={config}
          defaults={defaults}
          onQuickBind={quickBindKeyword}
        />
      </CollapsibleSection>

      {/* --- Agent Mappings --- */}
      <CollapsibleSection
        title="Agent Mappings"
        description="Per-agent category overrides, keyword filters, and extra docs"
        expanded={!!expandedSections['agents']}
        onToggle={() => toggleSection('agents')}
      >
        {mappedAgents.length === 0 && (
          <p className="text-[length:var(--font-size-xs)] text-text-tertiary italic mb-[var(--spacing-2)]">
            No custom agent mappings. Defaults are used for all agents.
          </p>
        )}

        <div className="flex flex-col gap-[var(--spacing-2)]">
          {mappedAgents.map((agent) => {
            const mapping = config.mapping![agent]!;
            const defaultCats = defaults.agentCategoryMap[agent] ?? [];
            const isExpanded = !!expandedAgents[agent];

            const effectiveCats = mapping.categories ?? defaultCats;
            const kwIncCount = (mapping.includeKeywords ?? []).length;
            const kwExcCount = (mapping.excludeKeywords ?? []).length;

            return (
              <div key={agent} className="border border-border-divider rounded-[var(--radius-sm)]">
                <div className="flex items-center justify-between px-[var(--spacing-3)] py-[var(--spacing-2)]">
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleAgent(agent)}
                      className="text-left text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary hover:text-accent-blue focus-visible:outline-none"
                    >
                      {agent}
                    </button>
                    {/* Effective injection summary */}
                    <div className="flex flex-wrap items-center gap-[var(--spacing-1)] mt-[var(--spacing-0-5)]">
                      {effectiveCats.map((c) => (
                        <CategoryPill key={c} name={c} />
                      ))}
                      {kwIncCount > 0 && (
                        <span className="text-[length:10px] px-[var(--spacing-1)] rounded-[2px] bg-status-active/15 text-status-active">
                          +{kwIncCount} kw
                        </span>
                      )}
                      {kwExcCount > 0 && (
                        <span className="text-[length:10px] px-[var(--spacing-1)] rounded-[2px] bg-status-blocked/15 text-status-blocked">
                          -{kwExcCount} kw
                        </span>
                      )}
                      {(mapping.extras ?? []).length > 0 && (
                        <span className="text-[length:10px] px-[var(--spacing-1)] rounded-[2px] bg-bg-hover text-text-tertiary">
                          {(mapping.extras ?? []).length} docs
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-[var(--spacing-2)] shrink-0 relative">
                    <button
                      type="button"
                      onClick={() => setPreviewAgent(previewAgent === agent ? null : agent)}
                      className={cn(
                        'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                        'text-accent-purple hover:text-accent-purple/80 focus-visible:outline-none',
                      )}
                    >
                      test
                    </button>
                    <span className="text-[length:var(--font-size-xs)] text-text-tertiary">
                      {isExpanded ? '[-]' : '[+]'}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAgent(agent)}
                      className="text-[length:var(--font-size-xs)] text-status-blocked opacity-60 hover:opacity-100 focus-visible:outline-none"
                      aria-label={`Remove ${agent}`}
                    >
                      remove
                    </button>
                    {previewAgent === agent && (
                      <AgentPreviewModal
                        agent={agent}
                        mapping={mapping}
                        defaults={defaults}
                        config={config}
                        onClose={() => setPreviewAgent(null)}
                      />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-[var(--spacing-3)] pb-[var(--spacing-3)] border-t border-border-divider pt-[var(--spacing-2)] flex flex-col gap-[var(--spacing-3)]">
                    {/* Categories with color-coded checkboxes */}
                    <div>
                      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                        Categories
                        <span className="font-normal text-text-tertiary ml-[var(--spacing-1)]">
                          (default: {defaultCats.join(', ') || 'none'})
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-[var(--spacing-1-5)]">
                        {defaults.validCategories.map((cat) => {
                          const checked = (mapping.categories ?? defaultCats).includes(cat);
                          return (
                            <label
                              key={cat}
                              className={cn(
                                'flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-xs)] cursor-pointer',
                                'px-[var(--spacing-1-5)] py-[var(--spacing-0-5)] rounded-[var(--radius-sm)]',
                                'border transition-colors duration-[var(--duration-fast)]',
                                checked
                                  ? getCategoryColor(cat)
                                  : 'border-transparent text-text-tertiary hover:text-text-secondary',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const current = mapping.categories ?? [...defaultCats];
                                  const next = checked
                                    ? current.filter((c) => c !== cat)
                                    : [...current, cat];
                                  updateMapping(agent, { categories: next });
                                }}
                                className="accent-accent-blue"
                              />
                              {cat}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Include Keywords */}
                    <div>
                      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                        Include Keywords
                      </span>
                      <div className="flex flex-wrap items-center gap-[var(--spacing-1)]">
                        {(mapping.includeKeywords ?? []).map((kw, i) => (
                          <TagChip
                            key={`${kw}-${i}`}
                            label={kw}
                            variant="include"
                            onRemove={() =>
                              updateMapping(agent, {
                                includeKeywords: mapping.includeKeywords!.filter((_, idx) => idx !== i),
                              })
                            }
                          />
                        ))}
                        <TagInput
                          placeholder="Add keyword..."
                          onAdd={(v) =>
                            updateMapping(agent, {
                              includeKeywords: [...(mapping.includeKeywords ?? []), v],
                            })
                          }
                        />
                      </div>
                    </div>

                    {/* Exclude Keywords */}
                    <div>
                      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                        Exclude Keywords
                      </span>
                      <div className="flex flex-wrap items-center gap-[var(--spacing-1)]">
                        {(mapping.excludeKeywords ?? []).map((kw, i) => (
                          <TagChip
                            key={`${kw}-${i}`}
                            label={kw}
                            variant="exclude"
                            onRemove={() =>
                              updateMapping(agent, {
                                excludeKeywords: mapping.excludeKeywords!.filter((_, idx) => idx !== i),
                              })
                            }
                          />
                        ))}
                        <TagInput
                          placeholder="Add keyword..."
                          onAdd={(v) =>
                            updateMapping(agent, {
                              excludeKeywords: [...(mapping.excludeKeywords ?? []), v],
                            })
                          }
                        />
                      </div>
                    </div>

                    {/* Extra Docs with suggestions */}
                    <div>
                      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                        Extra Docs
                      </span>
                      <PathListWithSuggestions
                        paths={mapping.extras ?? []}
                        onChange={(extras) => updateMapping(agent, { extras })}
                        placeholder="Add path (e.g. .workflow/docs/...)"
                        suggestions={DOC_PATH_SUGGESTIONS}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add agent button / selector */}
        {unmappedAgents.length > 0 && (
          <div className="mt-[var(--spacing-2)]">
            {addingAgent ? (
              <div className="flex items-center gap-[var(--spacing-2)]">
                <select
                  className={cn(
                    'px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
                    'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
                    'focus:outline-none focus:border-accent-blue',
                  )}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      const agent = e.target.value;
                      const defaultCats = defaults.agentCategoryMap[agent] ?? [];
                      updateMapping(agent, { categories: [...defaultCats] });
                      setAddingAgent(false);
                      setExpandedAgents((prev) => ({ ...prev, [agent]: true }));
                    }
                  }}
                >
                  <option value="" disabled>
                    Select agent type...
                  </option>
                  {unmappedAgents.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingAgent(false)}
                  className="text-[length:var(--font-size-xs)] text-text-tertiary hover:text-text-secondary focus-visible:outline-none"
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingAgent(true)}
                className={cn(
                  'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                  'text-accent-blue hover:underline',
                  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] rounded-[var(--radius-sm)]',
                )}
              >
                + Customize Agent
              </button>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* --- Category Documents --- */}
      <CollapsibleSection
        title="Category Documents"
        description="Extra spec files and docs injected per category"
        expanded={!!expandedSections['categories']}
        onToggle={() => toggleSection('categories')}
      >
        {configuredCategories.length === 0 && (
          <p className="text-[length:var(--font-size-xs)] text-text-tertiary italic mb-[var(--spacing-2)]">
            No custom category documents configured.
          </p>
        )}

        <div className="flex flex-col gap-[var(--spacing-3)]">
          {configuredCategories.map((cat) => {
            const doc = config.categoryDocs![cat]!;
            const defaultFile = defaults.categoryFileMap[cat];

            return (
              <div key={cat} className="border border-border-divider rounded-[var(--radius-sm)] p-[var(--spacing-3)]">
                <div className="flex items-center justify-between mb-[var(--spacing-2)]">
                  <div className="flex items-center gap-[var(--spacing-2)]">
                    <CategoryPill name={cat} />
                    <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary">
                      {cat}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCategory(cat)}
                    className="text-[length:var(--font-size-xs)] text-status-blocked opacity-60 hover:opacity-100 focus-visible:outline-none"
                    aria-label={`Remove ${cat}`}
                  >
                    remove
                  </button>
                </div>

                {defaultFile && (
                  <p className="text-[length:var(--font-size-xs)] text-text-tertiary mb-[var(--spacing-2)]">
                    Default spec: {defaultFile}
                  </p>
                )}

                <div className="flex flex-col gap-[var(--spacing-2)]">
                  <div>
                    <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                      Extra Spec Files
                    </span>
                    <PathListWithSuggestions
                      paths={doc.specFiles ?? []}
                      onChange={(specFiles) => updateCategoryDocs(cat, { specFiles })}
                      placeholder="Add spec file..."
                      suggestions={['.workflow/specs/', '.maestro/specs/']}
                    />
                  </div>
                  <div>
                    <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
                      Extra Docs
                    </span>
                    <PathListWithSuggestions
                      paths={doc.docs ?? []}
                      onChange={(docs) => updateCategoryDocs(cat, { docs })}
                      placeholder="Add doc path..."
                      suggestions={DOC_PATH_SUGGESTIONS}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add category button / selector */}
        {unconfiguredCategories.length > 0 && (
          <div className="mt-[var(--spacing-2)]">
            {addingCategory ? (
              <div className="flex items-center gap-[var(--spacing-2)]">
                <select
                  className={cn(
                    'px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
                    'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
                    'focus:outline-none focus:border-accent-blue',
                  )}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      updateCategoryDocs(e.target.value, { specFiles: [], docs: [] });
                      setAddingCategory(false);
                    }
                  }}
                >
                  <option value="" disabled>
                    Select category...
                  </option>
                  {unconfiguredCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setAddingCategory(false)}
                  className="text-[length:var(--font-size-xs)] text-text-tertiary hover:text-text-secondary focus-visible:outline-none"
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingCategory(true)}
                className={cn(
                  'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                  'text-accent-blue hover:underline',
                  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] rounded-[var(--radius-sm)]',
                )}
              >
                + Add Category
              </button>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* --- Always Inject (Session Start) --- */}
      <CollapsibleSection
        title="Always Inject (Session Start)"
        description="Documents, keywords, and categories always injected at session start"
        expanded={!!expandedSections['always']}
        onToggle={() => toggleSection('always')}
      >
        <div className="flex flex-col gap-[var(--spacing-4)]">
          {/* Docs */}
          <div>
            <p className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary mb-[var(--spacing-1)]">
              Documents
            </p>
            <PathListWithSuggestions
              paths={config.always?.docs ?? []}
              onChange={(docs) => {
                const always = { ...config.always, docs: docs.length > 0 ? docs : undefined };
                if (!always.docs && !always.keywords?.length && !always.categories?.length) {
                  setConfig((prev) => ({ ...prev, always: undefined }));
                } else {
                  setConfig((prev) => ({ ...prev, always }));
                }
              }}
              placeholder="Add doc path..."
              suggestions={DOC_PATH_SUGGESTIONS}
            />
          </div>

          {/* Keywords */}
          <div>
            <p className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary mb-[var(--spacing-1)]">
              Keywords (always inject matching entries)
            </p>
            <div className="flex flex-wrap gap-[var(--spacing-1)] mb-[var(--spacing-1)]">
              {(config.always?.keywords ?? []).map((kw) => (
                <TagChip key={kw} label={kw} variant="include" onRemove={() => {
                  const next = (config.always?.keywords ?? []).filter(k => k !== kw);
                  const always = { ...config.always, keywords: next.length > 0 ? next : undefined };
                  if (!always.docs?.length && !always.keywords && !always.categories?.length) {
                    setConfig((prev) => ({ ...prev, always: undefined }));
                  } else {
                    setConfig((prev) => ({ ...prev, always }));
                  }
                }} />
              ))}
            </div>
            <TagInput placeholder="Add keyword..." onAdd={(kw) => {
              const current = config.always?.keywords ?? [];
              if (current.includes(kw)) return;
              setConfig((prev) => ({
                ...prev,
                always: { ...prev.always, keywords: [...current, kw] },
              }));
            }} />
          </div>

          {/* Categories */}
          <div>
            <p className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary mb-[var(--spacing-1)]">
              Categories (always inject all entries from these)
            </p>
            <div className="flex flex-wrap gap-[var(--spacing-1)]">
              {(defaults?.validCategories ?? []).map((cat) => {
                const active = (config.always?.categories ?? []).includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      const current = config.always?.categories ?? [];
                      const next = active ? current.filter(c => c !== cat) : [...current, cat];
                      const always = { ...config.always, categories: next.length > 0 ? next : undefined };
                      if (!always.docs?.length && !always.keywords?.length && !always.categories) {
                        setConfig((prev) => ({ ...prev, always: undefined }));
                      } else {
                        setConfig((prev) => ({ ...prev, always }));
                      }
                    }}
                    className={`px-[var(--spacing-2)] py-[var(--spacing-0-5)] rounded-full text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] transition-all ${
                      active
                        ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/40'
                        : 'bg-bg-secondary text-text-tertiary border border-border-default hover:text-text-secondary'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* --- Global Keyword Filters --- */}
      <CollapsibleSection
        title="Global Keyword Filters"
        description="Include or exclude spec entries by keyword across all agents"
        expanded={!!expandedSections['keywords']}
        onToggle={() => toggleSection('keywords')}
      >
        <div className="flex flex-col gap-[var(--spacing-3)]">
          <div>
            <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
              Include Keywords
            </span>
            <div className="flex flex-wrap items-center gap-[var(--spacing-1)]">
              {(config.keywordFilters?.include ?? []).map((kw, i) => (
                <TagChip
                  key={`${kw}-${i}`}
                  label={kw}
                  variant="include"
                  onRemove={() =>
                    setConfig((prev) => ({
                      ...prev,
                      keywordFilters: {
                        ...prev.keywordFilters,
                        include: (prev.keywordFilters?.include ?? []).filter((_, idx) => idx !== i),
                      },
                    }))
                  }
                />
              ))}
              <TagInput
                placeholder="Add keyword..."
                onAdd={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    keywordFilters: {
                      ...prev.keywordFilters,
                      include: [...(prev.keywordFilters?.include ?? []), v],
                    },
                  }))
                }
              />
            </div>
          </div>

          <div>
            <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary block mb-[var(--spacing-1)]">
              Exclude Keywords
            </span>
            <div className="flex flex-wrap items-center gap-[var(--spacing-1)]">
              {(config.keywordFilters?.exclude ?? []).map((kw, i) => (
                <TagChip
                  key={`${kw}-${i}`}
                  label={kw}
                  variant="exclude"
                  onRemove={() =>
                    setConfig((prev) => ({
                      ...prev,
                      keywordFilters: {
                        ...prev.keywordFilters,
                        exclude: (prev.keywordFilters?.exclude ?? []).filter((_, idx) => idx !== i),
                      },
                    }))
                  }
                />
              ))}
              <TagInput
                placeholder="Add keyword..."
                onAdd={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    keywordFilters: {
                      ...prev.keywordFilters,
                      exclude: [...(prev.keywordFilters?.exclude ?? []), v],
                    },
                  }))
                }
              />
            </div>
          </div>

          {/* Max Content Length */}
          <div className="flex items-center gap-[var(--spacing-3)]">
            <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-secondary">
              Max Content Length
            </span>
            <input
              type="number"
              value={config.maxContentLength ?? ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                setConfig((prev) => ({
                  ...prev,
                  maxContentLength: val && val > 0 ? val : undefined,
                }));
              }}
              placeholder="8000"
              className={cn(
                'w-24 px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
                'border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]',
                'focus:outline-none focus:border-accent-blue focus:shadow-[var(--shadow-focus-ring)]',
                'transition-colors duration-[var(--duration-fast)]',
              )}
            />
          </div>
        </div>
      </CollapsibleSection>

      <SettingsSaveBar
        dirty={isDirty}
        saving={saving}
        onSave={() => void handleSave()}
        onDiscard={handleDiscard}
      />
    </div>
  );
}
