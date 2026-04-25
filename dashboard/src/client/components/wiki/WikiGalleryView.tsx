import { useMemo } from 'react';
import { useWikiStore, type WikiEntry, type WikiNodeType } from '@/client/store/wiki-store.js';

const TYPE_COLORS: Record<WikiNodeType, string> = {
  project: 'var(--color-accent-blue, #3b82f6)',
  roadmap: 'var(--color-accent-purple, #8b5cf6)',
  spec: 'var(--color-accent-green, #16a34a)',
  issue: 'var(--color-accent-red, #dc2626)',
  lesson: 'var(--color-accent-yellow, #ca8a04)',
  memory: 'var(--color-accent-cyan, #0891b2)',
  note: 'var(--color-text-tertiary, #9ca3af)',
};

/** Strip leading markdown heading markers. */
function cleanText(s: string): string {
  return s.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * WikiGalleryView — responsive card grid of wiki entries.
 */
export function WikiGalleryView() {
  const rawEntries = useWikiStore((s) => s.entries);
  const typeFilter = useWikiStore((s) => s.typeFilter);
  const tagFilter = useWikiStore((s) => s.tagFilter);
  const categoryFilter = useWikiStore((s) => s.categoryFilter);
  const statusFilter = useWikiStore((s) => s.statusFilter);
  const setSelected = useWikiStore((s) => s.setSelected);
  const selectedId = useWikiStore((s) => s.selectedId);

  const filtered = useMemo(() => {
    return rawEntries.filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (tagFilter !== 'all' && !d.tags.includes(tagFilter)) return false;
      if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      return true;
    });
  }, [rawEntries, typeFilter, tagFilter, categoryFilter, statusFilter]);

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
        No entries match the current filters
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {filtered.map((entry) => (
          <GalleryCard
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedId}
            onSelect={() => setSelected(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

function GalleryCard({
  entry,
  selected,
  onSelect,
}: {
  entry: WikiEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = TYPE_COLORS[entry.type];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-[var(--radius-md,6px)] border p-3 transition-all flex flex-col gap-1.5 ${
        selected
          ? 'border-border-strong bg-bg-secondary shadow-sm'
          : 'border-border bg-bg-primary hover:bg-bg-secondary hover:border-border-strong'
      }`}
    >
      {/* Type + Status */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
          {entry.type}
        </span>
        <span className="text-[10px] text-text-quaternary ml-auto">{entry.status}</span>
      </div>

      {/* Title */}
      <div className="font-medium text-text-primary text-[length:var(--font-size-sm)] leading-snug line-clamp-2">
        {entry.title}
      </div>

      {/* Summary */}
      {entry.summary && (
        <div className="text-text-tertiary text-[11px] line-clamp-2 leading-snug">
          {cleanText(entry.summary)}
        </div>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {entry.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-1 py-px text-[10px] rounded bg-bg-tertiary text-text-tertiary"
            >
              {tag}
            </span>
          ))}
          {entry.tags.length > 4 && (
            <span className="text-[10px] text-text-quaternary">+{entry.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Source */}
      <div className="text-[10px] text-text-quaternary font-mono truncate mt-auto pt-1">
        {entry.source.path}
      </div>
    </button>
  );
}
