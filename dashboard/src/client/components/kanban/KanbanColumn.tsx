import type { PhaseCard as PhaseCardType, SelectedKanbanItem } from '@/shared/types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import type { Issue } from '@/shared/issue-types.js';
import { PhaseCard } from '@/client/components/kanban/PhaseCard.js';
import { LinearIssueCard } from '@/client/components/kanban/LinearIssueCard.js';
import { IssueCard } from '@/client/components/kanban/IssueCard.js';
import { InlineIssueComposer } from '@/client/components/kanban/InlineIssueComposer.js';
import { useI18n } from '@/client/i18n/index.js';

interface KanbanColumnProps {
  columnId: string;
  title: string;
  phases: PhaseCardType[];
  color: string;
  animationDelay?: number;
  onSelectPhase: (id: number) => void;
  linearIssues?: LinearIssue[];
  localIssues?: Issue[];
  selectedItem?: SelectedKanbanItem | null;
  onSelectItem?: (item: SelectedKanbanItem) => void;
  composingColumnId?: string | null;
  onStartCompose?: (columnId: string) => void;
  onStopCompose?: () => void;
  onIssueCreated?: () => void;
  batchMode?: boolean;
  selectedIssueIds?: Set<string>;
  onToggleIssueCheck?: (issueId: string) => void;
}

export function KanbanColumn({ columnId, title, phases, color, animationDelay = 0, onSelectPhase, linearIssues, localIssues, selectedItem, onSelectItem, composingColumnId, onStartCompose, onStopCompose, onIssueCreated, batchMode, selectedIssueIds, onToggleIssueCheck }: KanbanColumnProps) {
  const { t } = useI18n();
  const noPhasesLabel = t('kanban.no_phases');
  const hasNoCards = phases.length === 0 && (!localIssues || localIssues.length === 0) && (!linearIssues || linearIssues.length === 0);

  return (
    <section
      className="group/col flex flex-col min-w-[var(--size-card-min-width)] flex-1 bg-bg-secondary rounded-[var(--radius-lg)] overflow-hidden motion-safe:animate-[column-enter_200ms_ease-out_both]"
      style={{ animationDelay: `${animationDelay}ms` }}
      aria-label={`${title} column, ${phases.length} phases`}
    >
      {/* Header */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-2-5)]">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
          {title}
        </h3>
        <span className="text-[length:var(--font-size-xs)] text-text-tertiary bg-bg-card rounded-full px-[var(--spacing-1-5)] tabular-nums">
          {phases.length + (localIssues?.length ?? 0) + (linearIssues?.length ?? 0)}
        </span>
        {/* Add issue button */}
        <button
          type="button"
          onClick={() => onStartCompose?.(columnId)}
          className="ml-auto w-5 h-5 flex items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100"
          aria-label="Create issue in this column"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Card list */}
      <div className="flex flex-col gap-[var(--spacing-2)] px-[var(--spacing-2)] pb-[var(--spacing-2)] overflow-y-auto flex-1" role="list">
        {/* Inline composer — appears at top when composing in this column */}
        {composingColumnId === columnId && onStopCompose && (
          <InlineIssueComposer
            columnId={columnId}
            onClose={onStopCompose}
            onCreated={onIssueCreated}
          />
        )}

        {hasNoCards ? (
          <div className="text-[length:var(--font-size-xs)] text-text-secondary text-center py-[var(--spacing-6)] italic">
            {noPhasesLabel}
          </div>
        ) : (
          <>
            {/* Phase cards */}
            {phases.map((phase) => (
              <PhaseCard key={phase.phase} phase={phase} />
            ))}

            {/* Local issue cards */}
            {localIssues && localIssues.length > 0 && (
              <>
                {phases.length > 0 && (
                  <div className="flex items-center gap-[var(--spacing-2)] py-[var(--spacing-1)]">
                    <div className="flex-1 h-px bg-border-divider" />
                    <span className="text-[length:10px] text-text-tertiary font-[var(--font-weight-medium)] uppercase tracking-wider">Issues</span>
                    <div className="flex-1 h-px bg-border-divider" />
                  </div>
                )}
                {localIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    selected={selectedItem?.type === 'issue' && selectedItem.issue.id === issue.id}
                    onSelect={() => onSelectItem?.({ type: 'issue', issue })}
                    batchMode={batchMode}
                    isChecked={selectedIssueIds?.has(issue.id)}
                    onToggleCheck={onToggleIssueCheck}
                  />
                ))}
              </>
            )}

            {/* Linear issue cards */}
            {linearIssues && linearIssues.length > 0 && (
              <>
                {(phases.length > 0 || (localIssues && localIssues.length > 0)) && (
                  <div className="flex items-center gap-[var(--spacing-2)] py-[var(--spacing-1)]">
                    <div className="flex-1 h-px bg-border-divider" />
                    <span className="text-[length:10px] text-text-tertiary font-[var(--font-weight-medium)] uppercase tracking-wider">Linear</span>
                    <div className="flex-1 h-px bg-border-divider" />
                  </div>
                )}
                {linearIssues.map((issue) => (
                  <LinearIssueCard
                    key={issue.id}
                    issue={issue}
                    selected={selectedItem?.type === 'linearIssue' && selectedItem.issue.id === issue.id}
                    onSelect={() => onSelectItem?.({ type: 'linearIssue', issue })}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
