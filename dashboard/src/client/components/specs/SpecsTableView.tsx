import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import Tag from 'lucide-react/dist/esm/icons/tag.js';
import { useSpecsStore, type SpecType, type SpecEntry } from '@/client/store/specs-store.js';

// ---------------------------------------------------------------------------
// SpecsTableView -- sortable, filterable table with category & keyword support
// ---------------------------------------------------------------------------

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

const DOT_COLORS: Partial<Record<SpecType, string>> = {
  coding: '#5B8DB8', arch: '#9178B5', quality: '#5A9E78',
  debug: '#B85B4A', test: '#3D8B5F', review: '#C4A055', learning: '#C46555',
  bug: '#C46555', pattern: '#5B8DB8', decision: '#9178B5', rule: '#5A9E78',
  validation: '#4A7DA8', general: '#A09D97',
};

const CATEGORY_COLORS: Record<string, string> = {
  coding: '#5B8DB8', arch: '#9178B5', quality: '#5A9E78',
  learning: '#A09D97', debug: '#C46555', test: '#5A9E78', review: '#C4A055',
};

type FilterType = 'all' | SpecType;

const FILTER_CHIPS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bug', label: 'Bug' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'decision', label: 'Decision' },
  { value: 'rule', label: 'Rule' },
  { value: 'debug', label: 'Debug' },
  { value: 'test', label: 'Test' },
  { value: 'review', label: 'Review' },
  { value: 'validation', label: 'Validation' },
  { value: 'general', label: 'General' },
];

type SortField = 'timestamp' | 'id' | 'type' | 'category';
type SortDir = 'asc' | 'desc';

// Column definitions for toggle
type ColumnKey = 'id' | 'type' | 'category' | 'content' | 'keywords' | 'file' | 'added' | 'actions';
const ALL_COLUMNS: { key: ColumnKey; label: string; width?: number; alwaysVisible?: boolean }[] = [
  { key: 'id', label: 'ID', width: 60 },
  { key: 'type', label: 'Type', width: 80 },
  { key: 'category', label: 'Category', width: 100 },
  { key: 'content', label: 'Content', alwaysVisible: true },
  { key: 'keywords', label: 'Keywords', width: 180 },
  { key: 'file', label: 'File', width: 140 },
  { key: 'added', label: 'Added', width: 90 },
  { key: 'actions', label: '', width: 80, alwaysVisible: true },
];

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

export function SpecsTableView() {
  const allEntries = useSpecsStore((s) => s.entries);
  const typeFilter = useSpecsStore((s) => s.typeFilter);
  const setTypeFilter = useSpecsStore((s) => s.setTypeFilter);
  const categoryFilter = useSpecsStore((s) => s.categoryFilter);
  const setCategoryFilter = useSpecsStore((s) => s.setCategoryFilter);
  const keywordFilter = useSpecsStore((s) => s.keywordFilter);
  const setKeywordFilter = useSpecsStore((s) => s.setKeywordFilter);
  const search = useSpecsStore((s) => s.search);
  const selectedEntry = useSpecsStore((s) => s.selectedEntry);
  const setSelectedEntry = useSpecsStore((s) => s.setSelectedEntry);
  const deleteEntry = useSpecsStore((s) => s.deleteEntry);
  const addEntry = useSpecsStore((s) => s.addEntry);

  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showNewRow, setShowNewRow] = useState(false);
  const [newType, setNewType] = useState<SpecType>('bug');
  const [newContent, setNewContent] = useState('');
  const [hiddenCols, setHiddenCols] = useState<Set<ColumnKey>>(new Set());

  const toggleCol = useCallback((key: ColumnKey) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => ALL_COLUMNS.filter((c) => c.alwaysVisible || !hiddenCols.has(c.key)),
    [hiddenCols],
  );

  // Discover categories and keywords from entries
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const e of allEntries) if (e.category) cats.add(e.category);
    return Array.from(cats).sort();
  }, [allEntries]);

  const allKeywords = useMemo(() => {
    const kws = new Set<string>();
    for (const e of allEntries) for (const k of e.keywords) kws.add(k);
    return Array.from(kws).sort();
  }, [allEntries]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allEntries.length, bug: 0, pattern: 0, decision: 0, rule: 0, general: 0 };
    for (const e of allEntries) c[e.type] = (c[e.type] ?? 0) + 1;
    return c as Record<SpecType | 'all', number>;
  }, [allEntries]);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of allEntries) {
      const cat = e.category || 'general';
      c[cat] = (c[cat] ?? 0) + 1;
    }
    return c;
  }, [allEntries]);

  const entries = useMemo(() => {
    let result = allEntries;
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (categoryFilter !== 'all') result = result.filter((e) => e.category === categoryFilter);
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
  }, [allEntries, typeFilter, categoryFilter, keywordFilter, search]);

  const sorted = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'timestamp') {
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortField === 'id') {
        cmp = a.id.localeCompare(b.id);
      } else if (sortField === 'type') {
        cmp = a.type.localeCompare(b.type);
      } else if (sortField === 'category') {
        cmp = (a.category || '').localeCompare(b.category || '');
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [entries, sortField, sortDir]);

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
        return prev;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  const handleSaveNew = useCallback(async () => {
    if (!newContent.trim()) return;
    await addEntry(newType, newContent.trim(), 'learnings.md');
    setNewContent('');
    setShowNewRow(false);
  }, [newType, newContent, addEntry]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      void deleteEntry(id);
    },
    [deleteEntry],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-2 border-b border-border-divider bg-bg-primary shrink-0">
        {/* Type filter */}
        <span className="text-[10px] font-semibold text-text-quaternary uppercase tracking-[0.06em]">
          Type
        </span>
        {FILTER_CHIPS.map((chip) => {
          const active = typeFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setTypeFilter(chip.value as FilterType)}
              className={[
                'text-[11px] font-medium px-3 py-1 rounded-full border cursor-pointer transition-all',
                'flex items-center gap-[5px]',
                active
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-bg-card text-text-secondary border-border hover:border-text-tertiary hover:text-text-primary',
              ].join(' ')}
            >
              {chip.value !== 'all' && (
                <span
                  className="w-[6px] h-[6px] rounded-full"
                  style={{ background: active ? '#fff' : DOT_COLORS[chip.value as SpecType] }}
                />
              )}
              {chip.label}
              <span className="text-[10px] font-mono opacity-70">
                {counts[chip.value as SpecType | 'all'] ?? 0}
              </span>
            </button>
          );
        })}

        {/* Category filter */}
        {allCategories.length > 0 && (
          <>
            <div className="w-px h-[18px] bg-border-divider mx-1" />
            <span className="text-[10px] font-semibold text-text-quaternary uppercase tracking-[0.06em]">
              Category
            </span>
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={[
                'text-[11px] font-medium px-2 py-[3px] rounded-full border cursor-pointer transition-all',
                categoryFilter === 'all'
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-bg-card text-text-secondary border-border hover:border-text-tertiary hover:text-text-primary',
              ].join(' ')}
            >
              All
            </button>
            {allCategories.map((cat) => {
              const active = categoryFilter === cat;
              const color = CATEGORY_COLORS[cat] ?? '#A09D97';
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(active ? 'all' : cat)}
                  className={[
                    'text-[11px] font-medium px-[10px] py-[3px] rounded-full border cursor-pointer transition-all',
                    'flex items-center gap-[5px]',
                    active
                      ? 'border-transparent text-white'
                      : 'bg-bg-card text-text-secondary border-border hover:border-text-tertiary hover:text-text-primary',
                  ].join(' ')}
                  style={active ? { background: color } : undefined}
                >
                  <span
                    className="w-[6px] h-[6px] rounded-full"
                    style={{ background: active ? '#fff' : color }}
                  />
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  <span className="text-[10px] font-mono opacity-70">
                    {categoryCounts[cat] ?? 0}
                  </span>
                </button>
              );
            })}
          </>
        )}

        {/* Keyword filter */}
        {allKeywords.length > 0 && (
          <>
            <div className="w-px h-[18px] bg-border-divider mx-1" />
            <span className="text-[10px] font-semibold text-text-quaternary uppercase tracking-[0.06em]">
              <Tag size={10} strokeWidth={2} className="inline-block mr-[2px] align-middle" />
            </span>
            {allKeywords.map((kw) => {
              const active = keywordFilter === kw;
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => setKeywordFilter(active ? 'all' : kw)}
                  className={[
                    'text-[10px] font-medium px-2 py-[2px] rounded-[4px] border cursor-pointer transition-all',
                    active
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

        <div className="flex-1" />

        {/* Column visibility + Sort */}
        <div className="flex items-center gap-1">
          {ALL_COLUMNS.filter((c) => !c.alwaysVisible).map((col) => {
            const isHidden = hiddenCols.has(col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleCol(col.key)}
                className={[
                  'text-[10px] font-medium px-[6px] py-[3px] rounded-[4px] border cursor-pointer transition-all',
                  'flex items-center gap-[3px]',
                  isHidden
                    ? 'bg-bg-secondary text-text-quaternary border-border-divider opacity-50'
                    : 'bg-bg-card text-text-tertiary border-border hover:text-text-primary',
                ].join(' ')}
                title={`${isHidden ? 'Show' : 'Hide'} ${col.label} column`}
              >
                {isHidden ? <EyeOff size={9} strokeWidth={2} /> : <Eye size={9} strokeWidth={2} />}
                {col.label}
              </button>
            );
          })}
        </div>

        <div className="w-px h-[18px] bg-border-divider" />

        {/* Sort button */}
        <button
          type="button"
          onClick={() => toggleSort('timestamp')}
          className="text-[11px] font-medium px-[10px] py-1 rounded-[6px] border border-border bg-bg-card text-text-tertiary cursor-pointer font-sans transition-all hover:border-text-tertiary hover:text-text-primary flex items-center gap-1"
        >
          <ArrowDown
            size={12}
            strokeWidth={2}
            className={sortDir === 'asc' ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
          {sortDir === 'desc' ? 'Newest' : 'Oldest'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const sortable: Record<string, SortField> = { id: 'id', type: 'type', category: 'category', added: 'timestamp' };
                const sf = sortable[col.key];
                return (
                  <Th
                    key={col.key}
                    width={col.width}
                    active={sf ? sortField === sf : false}
                    onClick={sf ? () => toggleSort(sf) : undefined}
                  >
                    {col.label}
                  </Th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Inline new entry row */}
            {showNewRow && (
              <tr>
                {visibleColumns.map((col) => {
                  const bg = 'var(--color-tint-planning)';
                  const borderColor = 'rgba(145,120,181,0.3)';
                  if (col.key === 'id')
                    return (
                      <td key={col.key} className="px-3 py-[10px] border-b-2 align-top" style={{ background: bg, borderBottomColor: borderColor }}>
                        <span className="font-mono text-[11px] font-semibold" style={{ color: '#9178B5' }}>NEW</span>
                      </td>
                    );
                  if (col.key === 'type')
                    return (
                      <td key={col.key} className="px-3 py-[10px] border-b-2 align-top" style={{ background: bg, borderBottomColor: borderColor }}>
                        <select
                          value={newType}
                          onChange={(e) => setNewType(e.target.value as SpecType)}
                          className="px-2 py-1 rounded-[6px] border border-border bg-bg-card text-[11px] text-text-primary font-sans outline-none cursor-pointer"
                        >
                          <option value="bug">bug</option>
                          <option value="pattern">pattern</option>
                          <option value="decision">decision</option>
                          <option value="rule">rule</option>
                          <option value="debug">debug</option>
                          <option value="test">test</option>
                          <option value="review">review</option>
                          <option value="validation">validation</option>
                          <option value="general">general</option>
                        </select>
                      </td>
                    );
                  if (col.key === 'content')
                    return (
                      <td key={col.key} className="px-3 py-[10px] border-b-2 align-top" style={{ background: bg, borderBottomColor: borderColor }}>
                        <input
                          type="text"
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="Describe the entry..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSaveNew();
                            if (e.key === 'Escape') setShowNewRow(false);
                          }}
                          className="w-full px-[10px] py-[6px] rounded-[6px] border border-border bg-bg-card text-[13px] text-text-primary font-sans outline-none focus:border-[#9178B5] transition-colors"
                        />
                      </td>
                    );
                  if (col.key === 'actions')
                    return (
                      <td key={col.key} className="px-3 py-[10px] border-b-2 align-top" style={{ background: bg, borderBottomColor: borderColor }}>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => void handleSaveNew()} className="px-3 py-[5px] rounded-[6px] border-none bg-text-primary text-white text-[11px] font-semibold cursor-pointer font-sans hover:bg-[#1A1816] transition-all">Save</button>
                          <button type="button" onClick={() => setShowNewRow(false)} className="px-3 py-[5px] rounded-[6px] border-none bg-bg-secondary text-text-secondary text-[11px] font-semibold cursor-pointer font-sans hover:bg-bg-tertiary transition-all">Cancel</button>
                        </div>
                      </td>
                    );
                  return (
                    <td key={col.key} className="px-3 py-[10px] border-b-2 align-top font-mono text-[11px] text-text-tertiary" style={{ background: bg, borderBottomColor: borderColor }}>
                      &mdash;
                    </td>
                  );
                })}
              </tr>
            )}

            {/* Data rows */}
            {sorted.map((entry, idx) => (
              <TableRow
                key={entry.id}
                entry={entry}
                selected={selectedEntry === entry.id}
                onClick={() => setSelectedEntry(entry.id)}
                onDelete={handleDelete}
                index={idx}
                visibleColumns={visibleColumns}
              />
            ))}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="text-center py-12 text-[13px] text-text-tertiary">
                  No entries found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Th -- sticky table header cell
// ---------------------------------------------------------------------------

function Th({
  children,
  width,
  active,
  onClick,
}: {
  children: React.ReactNode;
  width?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      style={{ width: width ? `${width}px` : undefined }}
      onClick={onClick}
      className={[
        'sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.06em] px-3 py-2',
        'bg-bg-secondary border-b border-border select-none whitespace-nowrap',
        onClick ? 'cursor-pointer' : '',
        active ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary',
      ].join(' ')}
    >
      {children}
      {active && (
        <ArrowDown size={10} strokeWidth={2} className="inline-block align-middle ml-[3px]" />
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// TableRow -- individual table row with hover actions
// ---------------------------------------------------------------------------

function TableRow({
  entry,
  selected,
  onClick,
  onDelete,
  index,
  visibleColumns,
}: {
  entry: SpecEntry;
  selected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  index: number;
  visibleColumns: { key: ColumnKey; label: string; width?: number }[];
}) {
  const badge = BADGE_STYLES[entry.type] ?? DEFAULT_BADGE;
  const catColor = CATEGORY_COLORS[entry.category] ?? '#A09D97';

  const cellMap: Record<ColumnKey, React.ReactNode> = {
    id: (
      <span className="font-mono text-[11px] text-text-tertiary whitespace-nowrap">
        {entry.id}
      </span>
    ),
    type: (
      <span
        className="text-[9px] font-bold px-[7px] py-[2px] rounded-[4px] uppercase font-mono tracking-[0.04em] whitespace-nowrap inline-block"
        style={{ background: badge.bg, color: badge.text }}
      >
        {entry.type}
      </span>
    ),
    category: (
      <span
        className="text-[10px] font-semibold px-[7px] py-[2px] rounded-[4px] uppercase font-mono tracking-[0.04em] whitespace-nowrap inline-block"
        style={{ background: `${catColor}15`, color: catColor }}
      >
        {entry.category || 'general'}
      </span>
    ),
    content: (
      <span className="text-[13px] text-text-primary font-medium leading-[1.5] max-w-[500px] block">
        {entry.content || entry.title}
      </span>
    ),
    keywords: (
      <div className="flex flex-wrap gap-[3px]">
        {entry.keywords.slice(0, 3).map((kw) => (
          <span
            key={kw}
            className="text-[9px] px-[5px] py-[1px] rounded-[3px] bg-bg-secondary text-text-tertiary font-mono whitespace-nowrap"
          >
            {kw}
          </span>
        ))}
        {entry.keywords.length > 3 && (
          <span className="text-[9px] text-text-quaternary font-mono">+{entry.keywords.length - 3}</span>
        )}
      </div>
    ),
    file: (
      <span className="font-mono text-[11px] text-text-tertiary whitespace-nowrap">
        {entry.file ? entry.file.split('/').pop() : ''}
      </span>
    ),
    added: (
      <span className="font-mono text-[11px] text-text-quaternary whitespace-nowrap">
        {formatTimestamp(entry.timestamp)}
      </span>
    ),
    actions: (
      <div className="flex gap-[2px] whitespace-nowrap">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="w-7 h-7 rounded-[6px] border-none bg-transparent cursor-pointer text-text-quaternary flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary"
        >
          <Edit3 size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={(e) => onDelete(e, entry.id)}
          className="w-7 h-7 rounded-[6px] border-none bg-transparent cursor-pointer text-text-quaternary flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:bg-[rgba(196,101,85,0.08)] hover:text-[#C46555]"
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    ),
  };

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: Math.min(index * 0.02, 0.3) }}
      onClick={onClick}
      className={[
        'cursor-pointer transition-colors group',
        selected ? '[&>td]:bg-tint-planning' : 'hover:[&>td]:bg-bg-hover',
      ].join(' ')}
    >
      {visibleColumns.map((col) => (
        <td key={col.key} className="px-3 py-[10px] border-b border-border-divider align-top">
          {cellMap[col.key]}
        </td>
      ))}
    </motion.tr>
  );
}
