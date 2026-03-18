import { useMemo } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { StatusBadge } from '@/client/components/common/StatusBadge.js';
import { ProgressBar } from '@/client/components/common/ProgressBar.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { PhaseCard, SelectedKanbanItem } from '@/shared/types.js';
import type { Issue } from '@/shared/issue-types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import TargetIcon from 'lucide-react/dist/esm/icons/target.js';
import InboxIcon from 'lucide-react/dist/esm/icons/inbox.js';
import CheckCircleIcon from 'lucide-react/dist/esm/icons/check-circle.js';

// ---------------------------------------------------------------------------
// KanbanCenterView — 3-panel centralized dashboard (参考 CommandCenterView)
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(['executing', 'verifying', 'planning', 'exploring']);

const TYPE_COLORS: Record<string, string> = {
  bug: '#C46555',
  feature: '#5B8DB8',
  improvement: '#9178B5',
  task: '#A09D97',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#C46555',
  high: '#B89540',
  medium: '#5B8DB8',
  low: '#A09D97',
};

const PHASE_STATUS_GROUPS = [
  { label: 'Executing', statuses: ['executing'], colorKey: 'executing' as const },
  { label: 'Verifying', statuses: ['verifying', 'testing'], colorKey: 'verifying' as const },
  { label: 'Planning', statuses: ['planning', 'exploring'], colorKey: 'planning' as const },
  { label: 'Pending', statuses: ['pending'], colorKey: 'pending' as const },
  { label: 'Blocked', statuses: ['blocked'], colorKey: 'blocked' as const },
  { label: 'Completed', statuses: ['completed'], colorKey: 'completed' as const },
];

interface KanbanCenterViewProps {
  localIssues?: Issue[];
  linearIssues?: LinearIssue[];
  selectedItem?: SelectedKanbanItem | null;
  onSelectItem?: (item: SelectedKanbanItem) => void;
  onSelectPhase?: (id: number) => void;
}

export function KanbanCenterView({ localIssues, linearIssues, selectedItem, onSelectItem, onSelectPhase }: KanbanCenterViewProps) {
  const board = useBoardStore((s) => s.board);
  const phases = board?.phases ?? [];

  const activePhases = useMemo(() => phases.filter((p) => ACTIVE_STATUSES.has(p.status)), [phases]);
  const completedPhases = useMemo(() => phases.filter((p) => p.status === 'completed'), [phases]);

  const openIssues = useMemo(
    () => (localIssues ?? []).filter((i) => i.status === 'open' || i.status === 'in_progress'),
    [localIssues],
  );
  const closedIssues = useMemo(
    () => (localIssues ?? []).filter((i) => i.status === 'resolved' || i.status === 'closed'),
    [localIssues],
  );

  const totalTasks = phases.reduce((sum, p) => sum + p.execution.tasks_total, 0);
  const completedTasks = phases.reduce((sum, p) => sum + p.execution.tasks_completed, 0);
  const totalIssues = (localIssues?.length ?? 0) + (linearIssues?.length ?? 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats strip — mirrors PipelineFlow's compact header */}
      <div className="flex items-center gap-[var(--spacing-4)] px-[var(--spacing-4)] py-[var(--spacing-2-5)] border-b border-border-divider shrink-0 bg-bg-secondary">
        <Stat label="Phases" value={phases.length} sub={`${completedPhases.length} done`} color={STATUS_COLORS.completed} />
        <div className="w-px h-6 bg-border-divider" />
        <Stat label="Active" value={activePhases.length} sub="in progress" color={STATUS_COLORS.executing} />
        <div className="w-px h-6 bg-border-divider" />
        <Stat label="Tasks" value={totalTasks} sub={`${completedTasks} done`} color={STATUS_COLORS.verifying} />
        <div className="w-px h-6 bg-border-divider" />
        <Stat label="Issues" value={totalIssues} sub={`${openIssues.length} open`} color={STATUS_COLORS.pending} />
        {totalTasks > 0 && (
          <div className="ml-auto flex items-center gap-[var(--spacing-2)]">
            <div className="w-[140px]">
              <ProgressBar completed={completedTasks} total={totalTasks} color={STATUS_COLORS.executing} />
            </div>
            <span className="text-[length:var(--font-size-xs)] text-text-tertiary tabular-nums shrink-0 w-[32px] text-right">
              {Math.round((completedTasks / totalTasks) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* 3-panel grid — same structure as CommandCenterView */}
      <div className="flex-1 grid grid-cols-[1fr_1fr_280px] overflow-hidden">

        {/* Panel 1: Active Phases */}
        <div className="flex flex-col overflow-hidden border-r border-border-divider">
          <PanelHeader icon={<TargetIcon size={14} strokeWidth={2} />} label="Active Phases">
            {activePhases.length > 0 && (
              <span
                className="ml-auto text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full"
                style={{ backgroundColor: 'rgba(184,149,64,0.12)', color: STATUS_COLORS.executing }}
              >
                {activePhases.length}
              </span>
            )}
          </PanelHeader>
          <div className="flex-1 overflow-y-auto px-[var(--spacing-3)] py-[var(--spacing-3)] flex flex-col gap-[var(--spacing-2)]">
            {activePhases.length === 0 ? (
              <EmptyState message="No active phases" />
            ) : (
              activePhases.map((phase) => {
                const isSelected = selectedItem?.type === 'phase' && (selectedItem as { phaseId: number }).phaseId === phase.phase;
                return (
                  <ActivePhaseRow
                    key={phase.phase}
                    phase={phase}
                    selected={isSelected}
                    onSelect={() => onSelectPhase?.(phase.phase)}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Panel 2: Issue Queue */}
        <div className="flex flex-col overflow-hidden border-r border-border-divider">
          <PanelHeader icon={<InboxIcon size={14} strokeWidth={2} />} label="Issue Queue">
            <span className="ml-auto text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full bg-border-subtle text-text-secondary">
              {openIssues.length} open
            </span>
          </PanelHeader>
          <div className="flex-1 overflow-y-auto py-[var(--spacing-1)]">
            {openIssues.length === 0 ? (
              <EmptyState message="No open issues" />
            ) : (
              openIssues.map((issue) => {
                const typeColor = TYPE_COLORS[issue.type] ?? '#A09D97';
                const priorityColor = PRIORITY_COLORS[issue.priority] ?? '#A09D97';
                const isSelected = selectedItem?.type === 'issue' && (selectedItem as { issue: Issue }).issue.id === issue.id;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => onSelectItem?.({ type: 'issue', issue })}
                    className={[
                      'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2)] w-full text-left transition-colors',
                      isSelected ? 'bg-[rgba(90,130,200,0.08)]' : 'hover:bg-bg-hover',
                    ].join(' ')}
                  >
                    <span
                      className="text-[length:9px] font-[var(--font-weight-semibold)] px-[6px] py-[2px] rounded-full shrink-0"
                      style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
                    >
                      {issue.type}
                    </span>
                    <span className="flex-1 text-[length:var(--font-size-xs)] text-text-primary line-clamp-1">
                      {issue.title}
                    </span>
                    <span
                      className="text-[length:9px] font-[var(--font-weight-semibold)] px-[6px] py-[2px] rounded-full shrink-0"
                      style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
                    >
                      {issue.priority}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Panel 3: Summary */}
        <div className="flex flex-col overflow-hidden">
          <PanelHeader icon={<CheckCircleIcon size={14} strokeWidth={2} />} label="Summary" />
          <div className="flex-1 overflow-y-auto px-[var(--spacing-4)] py-[var(--spacing-3)] flex flex-col gap-[var(--spacing-4)]">

            {/* Phase status breakdown */}
            <div>
              <span className="text-[length:10px] text-text-tertiary uppercase tracking-wider font-[var(--font-weight-semibold)]">
                Phase Status
              </span>
              <div className="mt-[var(--spacing-2)] flex flex-col gap-[var(--spacing-1-5)]">
                {PHASE_STATUS_GROUPS.map(({ label, statuses, colorKey }) => {
                  const count = phases.filter((p) => (statuses as string[]).includes(p.status)).length;
                  if (count === 0) return null;
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[length:var(--font-size-xs)] text-text-secondary">{label}</span>
                      <span
                        className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] tabular-nums"
                        style={{ color: STATUS_COLORS[colorKey] }}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Issue breakdown */}
            {(localIssues?.length ?? 0) > 0 && (
              <div>
                <span className="text-[length:10px] text-text-tertiary uppercase tracking-wider font-[var(--font-weight-semibold)]">
                  Issues
                </span>
                <div className="mt-[var(--spacing-2)] flex flex-col gap-[var(--spacing-1-5)]">
                  <div className="flex items-center justify-between">
                    <span className="text-[length:var(--font-size-xs)] text-text-secondary">Open</span>
                    <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-primary tabular-nums">{openIssues.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[length:var(--font-size-xs)] text-text-secondary">Resolved</span>
                    <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-primary tabular-nums">{closedIssues.length}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Completed phases list */}
            {completedPhases.length > 0 && (
              <div>
                <span className="text-[length:10px] text-text-tertiary uppercase tracking-wider font-[var(--font-weight-semibold)]">
                  Completed ({completedPhases.length})
                </span>
                <div className="mt-[var(--spacing-2)] flex flex-col gap-[var(--spacing-1-5)]">
                  {completedPhases.slice(0, 6).map((phase) => (
                    <button
                      key={phase.phase}
                      type="button"
                      onClick={() => onSelectPhase?.(phase.phase)}
                      className="flex items-center gap-[var(--spacing-1-5)] w-full text-left hover:bg-bg-hover rounded-[var(--radius-sm)] px-[var(--spacing-1)] -mx-[var(--spacing-1)] transition-colors"
                    >
                      <span className="text-[length:10px] font-mono text-text-tertiary shrink-0">
                        P-{String(phase.phase).padStart(2, '0')}
                      </span>
                      <span className="text-[length:var(--font-size-xs)] text-text-secondary line-clamp-1 flex-1">
                        {phase.title}
                      </span>
                    </button>
                  ))}
                  {completedPhases.length > 6 && (
                    <span className="text-[length:10px] text-text-tertiary pl-[var(--spacing-1)]">
                      +{completedPhases.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function Stat({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[length:var(--font-size-xs)] text-text-tertiary">{label}</span>
      <div className="flex items-baseline gap-[var(--spacing-1-5)]">
        <span className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)]" style={{ color }}>
          {value}
        </span>
        <span className="text-[length:10px] text-text-tertiary">{sub}</span>
      </div>
    </div>
  );
}

function PanelHeader({ icon, label, children }: { icon: React.ReactNode; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2-5)] border-b border-border-divider shrink-0">
      <span className="text-text-tertiary">{icon}</span>
      <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
      {children}
    </div>
  );
}

function ActivePhaseRow({ phase, selected, onSelect }: { phase: PhaseCard; selected: boolean; onSelect: () => void }) {
  const { tasks_completed, tasks_total, current_wave } = phase.execution;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left rounded-[var(--radius-default)] px-[var(--spacing-3)] py-[var(--spacing-2-5)] transition-all',
        'bg-bg-card hover:bg-bg-hover',
        selected ? 'shadow-[inset_0_0_0_2px_var(--color-accent-blue)]' : 'shadow-[var(--shadow-sm)]',
      ].join(' ')}
    >
      <div className="flex items-center gap-[var(--spacing-2)] mb-[var(--spacing-1)]">
        <StatusBadge status={phase.status} cardVariant />
        <span className="text-[length:var(--font-size-xs)] font-mono text-text-tertiary ml-auto">
          P-{String(phase.phase).padStart(2, '0')}
        </span>
      </div>
      <div className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-primary line-clamp-1 mb-[var(--spacing-1)]">
        {phase.title}
      </div>
      {tasks_total > 0 && (
        <div className="flex items-center gap-[var(--spacing-2)]">
          <div className="flex-1">
            <ProgressBar completed={tasks_completed} total={tasks_total} color={STATUS_COLORS[phase.status]} />
          </div>
          <span className="text-[length:10px] text-text-tertiary tabular-nums shrink-0">
            {tasks_completed}/{tasks_total}
          </span>
        </div>
      )}
      {phase.status === 'executing' && current_wave > 0 && (
        <div className="flex items-center gap-[var(--spacing-1)] mt-[var(--spacing-1)]">
          <span className="w-1.5 h-1.5 rounded-full bg-status-executing animate-pulse motion-reduce:animate-none" />
          <span className="text-[length:10px] text-status-executing">Wave {current_wave}</span>
        </div>
      )}
    </button>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-[length:var(--font-size-xs)] text-text-tertiary text-center py-[var(--spacing-6)] italic">
      {message}
    </div>
  );
}
