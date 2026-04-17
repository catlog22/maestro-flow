import { useBoardStore } from '@/client/store/board-store.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { PhaseStatus } from '@/shared/types.js';
import ListIcon from 'lucide-react/dist/esm/icons/list.js';
import CheckIcon from 'lucide-react/dist/esm/icons/check.js';

// ---------------------------------------------------------------------------
// QueuePanel -- all phases listed with status, progress indicators
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<PhaseStatus, string> = {
  not_started: 'Not Started',
  pending: 'Pending',
  exploring: 'Exploring',
  planning: 'Planning',
  executing: 'Executing',
  verifying: 'Verifying',
  testing: 'Testing',
  completed: 'Completed',
  blocked: 'Blocked',
};

export function QueuePanel() {
  const phases = useBoardStore((s) => s.board?.phases ?? []);

  return (
    <div className="flex flex-col overflow-hidden border-r border-r-border-divider border-b border-border-divider">
      {/* Header */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2-5)] border-b border-border-divider shrink-0">
        <ListIcon size={14} strokeWidth={2} className="text-text-tertiary" />
        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] uppercase tracking-wider text-text-tertiary">
          Phase Queue
        </span>
        <span className="ml-auto text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full bg-border-subtle text-text-secondary">
          {phases.length} phases
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-[var(--spacing-4)] py-[var(--spacing-3)]">
        {phases.map((phase) => {
          const color = STATUS_COLORS[phase.status];
          const { tasks_completed, tasks_total, current_wave } = phase.execution;
          const pct = tasks_total > 0 ? Math.round((tasks_completed / tasks_total) * 100) : 0;
          const isExecuting = phase.status === 'executing';
          const isCompleted = phase.status === 'completed';

          let subtitle = STATUS_LABELS[phase.status];
          if (isExecuting && current_wave > 0) subtitle += ` -- Wave ${current_wave}`;
          if (phase.verification.gaps.length > 0) subtitle += ` -- ${phase.verification.gaps.length} gap(s)`;

          return (
            <div
              key={phase.phase}
              className={[
                'flex items-center gap-[var(--spacing-2-5)] px-[var(--spacing-2-5)] py-[var(--spacing-2)] rounded-[var(--radius-md)] cursor-pointer transition-all duration-150 mb-0.5',
                isExecuting ? 'bg-[var(--color-tint-executing)]' : 'hover:bg-bg-primary',
              ].join(' ')}
            >
              {/* Phase number */}
              <div
                className="w-6 h-6 rounded-[7px] flex items-center justify-center text-[length:var(--font-size-xs)] font-bold text-white shrink-0"
                style={{ backgroundColor: color }}
              >
                {isCompleted ? <CheckIcon size={12} strokeWidth={2.5} /> : phase.phase}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary truncate">
                  {phase.title}
                </div>
                <div className="text-[length:var(--font-size-xs)] text-text-tertiary" style={isExecuting ? { color } : undefined}>
                  {subtitle}
                </div>
              </div>

              {/* Progress */}
              <div className="text-right shrink-0">
                <div
                  className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] font-mono text-text-tertiary"
                  style={isCompleted ? { color } : undefined}
                >
                  {tasks_completed}/{tasks_total}
                </div>
                <div className="w-10 h-[3px] bg-border rounded-full overflow-hidden mt-0.5">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
