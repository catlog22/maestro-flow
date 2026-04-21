import { useMemo } from 'react';
import { motion } from 'framer-motion';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Circle from 'lucide-react/dist/esm/icons/circle.js';
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Compass from 'lucide-react/dist/esm/icons/compass.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Tag from 'lucide-react/dist/esm/icons/tag.js';
import { useSpecsStore, type SpecType, type SpecEntry } from '@/client/store/specs-store.js';

// ---------------------------------------------------------------------------
// SpecsKanbanView -- dynamic kanban grouped by category
// Click category tag to toggle column visibility
// ---------------------------------------------------------------------------

interface SpecsKanbanViewProps {
  onAddEntry: () => void;
}

// All 7 categories from specs-setup workflow
const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; tintBg: string; color: string }> = {
  general: {
    label: 'General',
    icon: <Circle size={14} strokeWidth={1.8} />,
    tintBg: 'var(--color-tint-pending)',
    color: '#A09D97',
  },
  planning: {
    label: 'Planning',
    icon: <Compass size={14} strokeWidth={1.8} />,
    tintBg: 'var(--color-tint-planning)',
    color: '#9178B5',
  },
  execution: {
    label: 'Execution',
    icon: <Settings size={14} strokeWidth={1.8} />,
    tintBg: 'var(--color-tint-exploring)',
    color: '#5B8DB8',
  },
  debug: {
    label: 'Debug',
    icon: <AlertCircle size={14} strokeWidth={1.8} />,
    tintBg: 'var(--color-tint-blocked)',
    color: '#C46555',
  },
  test: {
    label: 'Test',
    icon: <Shield size={14} strokeWidth={1.8} />,
    tintBg: 'var(--color-tint-completed)',
    color: '#5A9E78',
  },
  review: {
    label: 'Review',
    icon: <Layers size={14} strokeWidth={1.8} />,
    tintBg: 'rgba(219,176,108,0.12)',
    color: '#C4A055',
  },
  validation: {
    label: 'Validation',
    icon: <Shield size={14} strokeWidth={1.8} />,
    tintBg: 'rgba(90,158,120,0.10)',
    color: '#3D8B5F',
  },
};

const KNOWN_ORDER = ['general', 'planning', 'execution', 'debug', 'test', 'review', 'validation'];

const DEFAULT_CAT_CONFIG = {
  label: '',
  icon: <Circle size={14} strokeWidth={1.8} />,
  tintBg: 'var(--color-tint-pending)',
  color: '#A09D97',
};

function getCategoryConfig(cat: string) {
  return CATEGORY_CONFIG[cat] ?? { ...DEFAULT_CAT_CONFIG, label: cat.charAt(0).toUpperCase() + cat.slice(1) };
}

const BADGE_STYLES: Partial<Record<SpecType, { bg: string; text: string }>> = {
  coding: { bg: 'var(--color-tint-exploring)', text: '#5B8DB8' },
  arch: { bg: 'var(--color-tint-planning)', text: '#9178B5' },
  quality: { bg: 'var(--color-tint-completed)', text: '#5A9E78' },
  debug: { bg: 'rgba(196,101,85,0.10)', text: '#B85B4A' },
  test: { bg: 'rgba(90,158,120,0.10)', text: '#3D8B5F' },
  review: { bg: 'rgba(219,176,108,0.12)', text: '#C4A055' },
  learning: { bg: 'var(--color-tint-blocked)', text: '#C46555' },
  bug: { bg: 'var(--color-tint-blocked)', text: '#C46555' },
  pattern: { bg: 'var(--color-tint-exploring)', text: '#5B8DB8' },
  decision: { bg: 'var(--color-tint-planning)', text: '#9178B5' },
  rule: { bg: 'var(--color-tint-completed)', text: '#5A9E78' },
  validation: { bg: 'rgba(91,141,184,0.10)', text: '#4A7DA8' },
  general: { bg: 'var(--color-tint-pending)', text: '#A09D97' },
};
const DEFAULT_BADGE = { bg: 'var(--color-tint-pending)', text: '#A09D97' };

function formatTimestamp(ts: string): string {
  if (!ts) return '--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SpecsKanbanView({ onAddEntry }: SpecsKanbanViewProps) {
  const entries = useSpecsStore((s) => s.entries);
  const typeFilter = useSpecsStore((s) => s.typeFilter);
  const keywordFilter = useSpecsStore((s) => s.keywordFilter);
  const search = useSpecsStore((s) => s.search);
  const selectedEntry = useSpecsStore((s) => s.selectedEntry);
  const setSelectedEntry = useSpecsStore((s) => s.setSelectedEntry);
  const setKeywordFilter = useSpecsStore((s) => s.setKeywordFilter);
  const hiddenColumns = useSpecsStore((s) => s.hiddenColumns);
  const toggleColumn = useSpecsStore((s) => s.toggleColumn);

  // All categories: known order first, then any unknown from data — only include categories with entries
  const allCategories = useMemo(() => {
    const fromData = new Set<string>();
    for (const e of entries) if (e.category) fromData.add(e.category);
    const result: string[] = [];
    for (const k of KNOWN_ORDER) {
      if (fromData.has(k)) {
        result.push(k);
        fromData.delete(k);
      }
    }
    for (const c of Array.from(fromData).sort()) result.push(c);
    return result;
  }, [entries]);

  // All keywords from data
  const allKeywords = useMemo(() => {
    const kws = new Set<string>();
    for (const e of entries) for (const k of e.keywords) kws.add(k);
    return Array.from(kws).sort();
  }, [entries]);

  // Filter entries (type + keyword + search, but NOT category — category controls column visibility)
  const filtered = useMemo(() => {
    let result = entries;
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (keywordFilter !== 'all') result = result.filter((e) => e.keywords.includes(keywordFilter));
    if (search) {
      const lc = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(lc) ||
          e.content.toLowerCase().includes(lc) ||
          e.id.toLowerCase().includes(lc) ||
          e.keywords.some((k) => k.toLowerCase().includes(lc)),
      );
    }
    return result;
  }, [entries, typeFilter, keywordFilter, search]);

  // Group by category
  const grouped = useMemo(() => {
    const result: Record<string, SpecEntry[]> = {};
    for (const cat of allCategories) result[cat] = [];
    for (const e of filtered) {
      const cat = e.category || 'general';
      if (!result[cat]) result[cat] = [];
      result[cat].push(e);
    }
    return result;
  }, [filtered, allCategories]);

  // Category counts (from all entries, unfiltered)
  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) {
      const cat = e.category || 'general';
      c[cat] = (c[cat] ?? 0) + 1;
    }
    return c;
  }, [entries]);

  // Visible categories
  const visibleCategories = useMemo(
    () => allCategories.filter((c) => !hiddenColumns.has(c)),
    [allCategories, hiddenColumns],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tag bar: category toggles + keyword filters */}
      <div className="flex flex-wrap items-center gap-[6px] px-5 py-2 border-b border-border-divider bg-bg-primary shrink-0">
        {/* Category tags — click to toggle column visibility */}
        {allCategories.map((cat) => {
          const cfg = getCategoryConfig(cat);
          const isVisible = !hiddenColumns.has(cat);
          const count = categoryCounts[cat] ?? 0;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggleColumn(cat)}
              className={[
                'text-[11px] font-medium px-[10px] py-[4px] rounded-full border cursor-pointer transition-all',
                'flex items-center gap-[5px]',
                isVisible
                  ? 'bg-bg-card text-text-primary border-border hover:shadow-sm'
                  : 'bg-bg-secondary text-text-quaternary border-border-divider opacity-60',
              ].join(' ')}
              style={isVisible ? { borderColor: cfg.color, boxShadow: `0 0 0 1px ${cfg.color}22` } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0 transition-opacity"
                style={{ background: cfg.color, opacity: isVisible ? 1 : 0.35 }}
              />
              {cfg.label}
              <span className="text-[10px] font-mono opacity-60">{count}</span>
            </button>
          );
        })}

        {/* Keyword filter */}
        {allKeywords.length > 0 && (
          <>
            <div className="w-px h-[18px] bg-border-divider mx-1" />
            <Tag size={11} strokeWidth={2} className="text-text-quaternary shrink-0" />
            {allKeywords.map((kw) => {
              const isActive = keywordFilter === kw;
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => setKeywordFilter(isActive ? 'all' : kw)}
                  className={[
                    'text-[10px] font-medium px-2 py-[2px] rounded-[4px] border cursor-pointer transition-all',
                    isActive
                      ? 'bg-text-primary text-white border-text-primary'
                      : 'bg-bg-card text-text-tertiary border-border-divider hover:border-text-tertiary hover:text-text-primary',
                  ].join(' ')}
                >
                  {kw}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 flex-1 overflow-x-auto p-3">
        {visibleCategories.map((cat, colIdx) => {
          const cfg = getCategoryConfig(cat);
          const items = grouped[cat] ?? [];
          return (
            <div
              key={cat}
              className="flex flex-col min-w-[260px] flex-1 bg-bg-secondary rounded-[12px] overflow-hidden"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-[14px] py-3 border-b border-black/[0.04]">
                <div
                  className="w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0"
                  style={{ background: cfg.tintBg, color: cfg.color }}
                >
                  {cfg.icon}
                </div>
                <span className="text-[13px] font-bold text-text-primary">{cfg.label}</span>
                <span className="text-[10px] text-text-tertiary bg-bg-card px-[6px] rounded-full font-mono">
                  {items.length}
                </span>
                <button
                  type="button"
                  onClick={onAddEntry}
                  className="ml-auto w-6 h-6 rounded-[6px] border border-dashed border-border bg-transparent cursor-pointer flex items-center justify-center text-text-quaternary hover:border-text-tertiary hover:text-text-primary hover:bg-bg-card transition-all"
                >
                  <Plus size={12} strokeWidth={2} />
                </button>
              </div>

              {/* Column body */}
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                {items.map((entry, idx) => (
                  <SpecCard
                    key={entry.id}
                    entry={entry}
                    selected={selectedEntry === entry.id}
                    onClick={() => setSelectedEntry(entry.id)}
                    index={colIdx * 100 + idx}
                  />
                ))}
                {items.length === 0 && (
                  <div className="flex items-center justify-center py-8 text-[11px] text-text-quaternary">
                    No entries
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {visibleCategories.length === 0 && (
          <div className="flex items-center justify-center flex-1 text-[13px] text-text-tertiary">
            All columns hidden — click a category tag above to show it.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpecCard
// ---------------------------------------------------------------------------

function SpecCard({
  entry,
  selected,
  onClick,
  index,
}: {
  entry: SpecEntry;
  selected: boolean;
  onClick: () => void;
  index: number;
}) {
  const badge = BADGE_STYLES[entry.type] ?? DEFAULT_BADGE;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
      onClick={onClick}
      className={[
        'bg-bg-card rounded-[10px] px-[14px] py-3 border cursor-pointer',
        'transition-all duration-[180ms]',
        'hover:-translate-y-[2px] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:border-border',
        selected
          ? 'border-[#9178B5] shadow-[0_0_0_2px_rgba(145,120,181,0.2)]'
          : 'border-border-divider',
      ].join(' ')}
    >
      {/* Top: type badge + id */}
      <div className="flex items-center gap-[6px] mb-2">
        <span
          className="text-[9px] font-bold px-[7px] py-[2px] rounded-[4px] uppercase font-mono tracking-[0.04em]"
          style={{ background: badge.bg, color: badge.text }}
        >
          {entry.type}
        </span>
        <span className="text-[10px] font-mono text-text-quaternary ml-auto">{entry.id}</span>
      </div>

      {/* Content (3-line clamp) */}
      <div className="text-[13px] text-text-primary font-medium leading-[1.5] mb-2 line-clamp-3">
        {entry.content || entry.title}
      </div>

      {/* Keywords */}
      {entry.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {entry.keywords.slice(0, 4).map((kw) => (
            <span
              key={kw}
              className="text-[9px] px-[5px] py-[1px] rounded-[3px] bg-bg-secondary text-text-tertiary font-mono"
            >
              {kw}
            </span>
          ))}
          {entry.keywords.length > 4 && (
            <span className="text-[9px] text-text-quaternary font-mono">
              +{entry.keywords.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Meta: timestamp + file */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-quaternary font-mono flex items-center gap-[3px]">
          <Clock size={10} strokeWidth={2} />
          {formatTimestamp(entry.timestamp)}
        </span>
        {entry.file && (
          <span className="text-[10px] text-text-tertiary flex items-center gap-[3px] ml-auto">
            <FileText size={10} strokeWidth={2} />
            {entry.file.split('/').pop()}
          </span>
        )}
      </div>
    </motion.div>
  );
}
