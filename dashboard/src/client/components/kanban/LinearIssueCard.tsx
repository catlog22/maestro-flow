import type { LinearIssue, LinearPriority } from '@/shared/linear-types.js';
import { LINEAR_PRIORITY_LABELS, LINEAR_PRIORITY_COLORS } from '@/shared/linear-types.js';

// ---------------------------------------------------------------------------
// LinearIssueCard — kanban card for a Linear issue, matches PhaseCard style
// ---------------------------------------------------------------------------

interface LinearIssueCardProps {
  issue: LinearIssue;
  selected: boolean;
  onSelect: () => void;
}

export function LinearIssueCard({ issue, selected, onSelect }: LinearIssueCardProps) {
  const priorityColor = LINEAR_PRIORITY_COLORS[issue.priority];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <article role="listitem">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${issue.identifier}: ${issue.title}. Priority: ${LINEAR_PRIORITY_LABELS[issue.priority]}`}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className={[
          'rounded-[10px] px-[var(--spacing-4)] py-[var(--spacing-3)] space-y-[var(--spacing-2)] cursor-pointer',
          'transition-all duration-[var(--duration-normal)] ease-[var(--ease-spring)]',
          'hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-0.5',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
          'active:scale-[0.98] active:shadow-sm active:duration-[var(--duration-fast)]',
          'bg-bg-card',
          selected ? 'shadow-[inset_0_0_0_2px_var(--color-accent-blue)]' : '',
        ].join(' ')}
      >
        {/* Row 1: Identifier + priority badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[var(--spacing-1-5)]">
            {/* Linear icon dot */}
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: `#${issue.state.color}` }}
              aria-hidden="true"
            />
            <span className="text-[length:var(--font-size-xs)] font-mono font-[var(--font-weight-medium)] text-text-tertiary">
              {issue.identifier}
            </span>
          </div>
          <span
            className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] px-2 py-[var(--spacing-0-5)] rounded-full"
            style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
          >
            {LINEAR_PRIORITY_LABELS[issue.priority]}
          </span>
        </div>

        {/* Row 2: Title */}
        <h4 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary leading-snug line-clamp-2">
          {issue.title}
        </h4>

        {/* Row 3: Labels + assignee */}
        <div className="flex items-center justify-between gap-[var(--spacing-2)]">
          <div className="flex gap-[var(--spacing-1)] flex-wrap min-w-0">
            {issue.labels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="text-[length:10px] px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}` }}
                title={label.name}
              >
                {label.name}
              </span>
            ))}
          </div>
          {issue.assignee && (
            <span
              className="w-5 h-5 rounded-full bg-bg-hover shrink-0 flex items-center justify-center text-[length:10px] font-[var(--font-weight-semibold)] text-text-secondary"
              title={issue.assignee.displayName}
            >
              {issue.assignee.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
