import { useState, useEffect } from 'react';
import type { PhaseCard as PhaseCardType, SelectedKanbanItem } from '@/shared/types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import { PhaseCard } from '@/client/components/kanban/PhaseCard.js';
import { KanbanTaskRow } from '@/client/components/kanban/TaskRow.js';
import { LinearIssueCard } from '@/client/components/kanban/LinearIssueCard.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// KanbanColumn — header with count badge, color stripe, phase card list
// ---------------------------------------------------------------------------

/** Statuses that should show inline task rows */
const ACTIVE_STATUSES = new Set(['executing', 'verifying', 'planning']);

interface TaskRowData {
  id: string;
  title: string;
  type: string;
  status: string;
}

interface KanbanColumnProps {
  title: string;
  phases: PhaseCardType[];
  color: string;
  animationDelay?: number;
  onSelectPhase: (id: number) => void;
  linearIssues?: LinearIssue[];
  selectedItem?: SelectedKanbanItem | null;
  onSelectItem?: (item: SelectedKanbanItem) => void;
}

export function KanbanColumn({ title, phases, color, animationDelay = 0, onSelectPhase, linearIssues, selectedItem, onSelectItem }: KanbanColumnProps) {
  const { t } = useI18n();
  const noPhasesLabel = t('kanban.no_phases');

  // Fetch tasks for active phases
  const [tasksByPhase, setTasksByPhase] = useState<Record<number, TaskRowData[]>>({});

  useEffect(() => {
    const activePhases = phases.filter((p) => ACTIVE_STATUSES.has(p.status));
    if (activePhases.length === 0) {
      setTasksByPhase({});
      return;
    }

    let cancelled = false;
    const fetches = activePhases.map((p) =>
      fetch(`/api/phases/${p.phase}/tasks`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Array<{ id: string; title: string; type: string; meta: { status: string } }>) =>
          [p.phase, data.map((t) => ({ id: t.id, title: t.title, type: t.type, status: t.meta.status }))] as const,
        )
        .catch(() => [p.phase, [] as TaskRowData[]] as const),
    );

    Promise.all(fetches).then((results) => {
      if (cancelled) return;
      const map: Record<number, TaskRowData[]> = {};
      for (const [phaseNum, tasks] of results) {
        if (tasks.length > 0) map[phaseNum] = tasks;
      }
      setTasksByPhase(map);
    });

    return () => { cancelled = true; };
  }, [phases]);

  return (
    <section
      className="flex flex-col min-w-[var(--size-card-min-width)] flex-1 bg-bg-secondary rounded-[var(--radius-lg)] overflow-hidden motion-safe:animate-[column-enter_200ms_ease-out_both]"
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
          {phases.length + (linearIssues?.length ?? 0)}
        </span>
      </div>

      {/* Card list */}
      <div className="flex flex-col gap-[var(--spacing-2)] px-[var(--spacing-2)] pb-[var(--spacing-2)] overflow-y-auto flex-1" role="list">
        {phases.length === 0 && (!linearIssues || linearIssues.length === 0) ? (
          <div className="text-[length:var(--font-size-xs)] text-text-secondary text-center py-[var(--spacing-6)] italic">
            {noPhasesLabel}
          </div>
        ) : (
          <>
            {phases.map((phase) => (
              <div key={phase.phase}>
                <PhaseCard phase={phase} />
                {/* Inline task rows for active phases */}
                {ACTIVE_STATUSES.has(phase.status) && tasksByPhase[phase.phase]?.map((task) => (
                  <div key={task.id} className="mt-[var(--spacing-1)]">
                    <KanbanTaskRow task={task} />
                  </div>
                ))}
              </div>
            ))}
            {/* Linear issues separator + cards */}
            {linearIssues && linearIssues.length > 0 && (
              <>
                {phases.length > 0 && (
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
