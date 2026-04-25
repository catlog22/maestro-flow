import { useMemo } from 'react';
import { useWikiStore, type WikiEntry, type WikiNodeType } from '@/client/store/wiki-store.js';

const TYPE_LABELS: Record<WikiNodeType, string> = {
  project: 'Project',
  roadmap: 'Roadmap',
  spec: 'Specs',
  issue: 'Issues',
  lesson: 'Lessons',
  memory: 'Memory',
  note: 'Notes',
};

const TYPE_COLORS: Record<WikiNodeType, string> = {
  project: 'var(--color-accent-blue, #3b82f6)',
  roadmap: 'var(--color-accent-purple, #8b5cf6)',
  spec: 'var(--color-accent-green, #16a34a)',
  issue: 'var(--color-accent-red, #dc2626)',
  lesson: 'var(--color-accent-yellow, #ca8a04)',
  memory: 'var(--color-accent-cyan, #0891b2)',
  note: 'var(--color-text-tertiary, #9ca3af)',
};

const TYPE_ORDER: WikiNodeType[] = [
  'project',
  'roadmap',
  'spec',
  'issue',
  'lesson',
  'memory',
  'note',
];

/** Strip leading markdown heading markers from summary text. */
function cleanSummary(s: string): string {
  return s.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * Type-grouped list of wiki entries with colored type indicators.
 */
export function WikiGroupedView() {
  const rawEntries = useWikiStore((s) => s.entries);
  const typeFilter = useWikiStore((s) => s.typeFilter);
  const tagFilter = useWikiStore((s) => s.tagFilter);
  const categoryFilter = useWikiStore((s) => s.categoryFilter);
  const statusFilter = useWikiStore((s) => s.statusFilter);
  const selectedId = useWikiStore((s) => s.selectedId);
  const setSelected = useWikiStore((s) => s.setSelected);

  const groups = useMemo(() => {
    const out: Record<WikiNodeType, WikiEntry[]> = {
      project: [], roadmap: [], spec: [],
      issue: [], lesson: [], memory: [], note: [],
    };
    for (const d of rawEntries) {
      if (typeFilter !== 'all' && d.type !== typeFilter) continue;
      if (tagFilter !== 'all' && !d.tags.includes(tagFilter)) continue;
      if (categoryFilter !== 'all' && d.category !== categoryFilter) continue;
      if (statusFilter !== 'all' && d.status !== statusFilter) continue;
      out[d.type].push(d);
    }
    return out;
  }, [rawEntries, typeFilter, tagFilter, categoryFilter, statusFilter]);

  return (
    <div className="flex flex-col gap-1 py-1 overflow-y-auto h-full">
      {TYPE_ORDER.map((type) => {
        const entries = groups[type];
        if (!entries || entries.length === 0) return null;
        return (
          <section key={type} className="px-2">
            <h3 className="flex items-center gap-1.5 px-1 py-1.5 text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">
              <span
                className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                style={{ backgroundColor: TYPE_COLORS[type] }}
              />
              {TYPE_LABELS[type]}
              <span className="text-text-quaternary font-normal ml-0.5">{entries.length}</span>
            </h3>
            <ul className="flex flex-col gap-px">
              {entries.map((entry) => (
                <WikiCard
                  key={entry.id}
                  entry={entry}
                  typeColor={TYPE_COLORS[entry.type]}
                  selected={entry.id === selectedId}
                  onSelect={() => setSelected(entry.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function WikiCard({
  entry,
  typeColor,
  selected,
  onSelect,
}: {
  entry: WikiEntry;
  typeColor: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left rounded-[var(--radius-md,6px)] px-2.5 py-2 transition-all ${
          selected
            ? 'bg-bg-secondary shadow-[inset_0_0_0_1px_var(--color-border-strong)]'
            : 'hover:bg-bg-secondary'
        }`}
        style={selected ? { borderLeft: `2px solid ${typeColor}`, paddingLeft: '8px' } : undefined}
      >
        <div className="flex items-start gap-1.5">
          {!selected && (
            <span
              className="inline-block w-[5px] h-[5px] rounded-full shrink-0 mt-[5px]"
              style={{ backgroundColor: typeColor, opacity: 0.6 }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-text-primary text-[length:var(--font-size-sm)] truncate leading-snug">
              {entry.title}
            </div>
            {entry.summary && (
              <div className="text-text-tertiary text-[11px] line-clamp-1 mt-0.5 leading-snug">
                {cleanSummary(entry.summary)}
              </div>
            )}
            {entry.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {entry.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-1 py-px text-[10px] rounded bg-bg-tertiary text-text-tertiary leading-snug"
                  >
                    {tag}
                  </span>
                ))}
                {entry.tags.length > 3 && (
                  <span className="text-[10px] text-text-quaternary">+{entry.tags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
