import { useBoardStore } from '@/client/store/board-store.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { PhaseCard, PhaseStatus } from '@/shared/types.js';
import { ProgressRing } from './ProgressRing.js';
import CheckIcon from 'lucide-react/dist/esm/icons/check.js';
import AlertCircleIcon from 'lucide-react/dist/esm/icons/circle-alert.js';

// ---------------------------------------------------------------------------
// PhaseTimelineView -- vertical timeline with pipeline dots per phase
// ---------------------------------------------------------------------------

/** The 6 pipeline stages in order */
const STAGE_ORDER: PhaseStatus[] = ['exploring', 'planning', 'executing', 'verifying', 'testing', 'completed'];
const STAGE_LABELS = ['Explore', 'Plan', 'Execute', 'Verify', 'Test', 'Done'];

/** Map a phase's status to which stages are done / current */
function stageState(status: PhaseStatus, stageIdx: number): 'done' | 'current' | 'future' {
  const statusIdx = STAGE_ORDER.indexOf(status);
  if (status === 'completed') return 'done';
  if (status === 'pending' || status === 'not_started') return 'future';
  if (stageIdx < statusIdx) return 'done';
  if (stageIdx === statusIdx) return 'current';
  return 'future';
}

export function PhaseTimelineView() {
  const board = useBoardStore((s) => s.board);
  const phases = board?.phases ?? [];
  const selectedPhase = useBoardStore((s) => s.selectedPhase);
  const setSelectedPhase = useBoardStore((s) => s.setSelectedPhase);

  const tasksComplete = phases.reduce((s, p) => s + p.execution.tasks_completed, 0);
  const tasksTotal = phases.reduce((s, p) => s + p.execution.tasks_total, 0);
  const phasesComplete = phases.filter((p) => p.status === 'completed').length;
  const overallPct = tasksTotal > 0 ? Math.round((tasksComplete / tasksTotal) * 100) : 0;
  const totalGaps = phases.reduce((s, p) => s + p.verification.gaps.length, 0);
  const milestone = board?.project?.current_milestone ?? '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Project strip */}
      <div className="flex items-center gap-[var(--spacing-4)] px-[var(--spacing-6)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary shrink-0">
        {milestone && (
          <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">{milestone}</span>
        )}
        <span className="text-[length:var(--font-size-xs)] text-text-tertiary font-mono">{phases.length} phases</span>
        <div className="flex items-center gap-[var(--spacing-2)] ml-auto">
          <ProgressRing progress={overallPct} />
          <span className="text-[length:var(--font-size-xs)] text-text-secondary">
            Tasks: <strong className="font-[var(--font-weight-semibold)] text-text-primary">{tasksComplete}/{tasksTotal}</strong>
          </span>
          <span className="text-[length:var(--font-size-xs)] text-text-secondary">
            Phases: <strong className="font-[var(--font-weight-semibold)] text-text-primary">{phasesComplete}/{phases.length}</strong>
          </span>
          {totalGaps > 0 && (
            <span className="flex items-center gap-1 text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-px rounded-full" style={{ backgroundColor: 'rgba(196, 101, 85, 0.08)', color: STATUS_COLORS.blocked }}>
              <AlertCircleIcon size={11} strokeWidth={2} />
              {totalGaps} gap{totalGaps > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Phase list */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-[800px] mx-auto px-[var(--spacing-6)] py-[var(--spacing-3)]">
          {/* Column headers */}
          <div className="grid grid-cols-[200px_1fr_80px_40px] items-center px-[var(--spacing-3)] mb-1">
            <span className="text-[10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-quaternary">Phase</span>
            <div className="flex justify-between px-1">
              {STAGE_LABELS.map((l) => (
                <span key={l} className="text-[10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-quaternary">{l}</span>
              ))}
            </div>
            <span className="text-[10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-quaternary text-right">Progress</span>
            <span />
          </div>

          {/* Phase rows */}
          {phases.map((phase) => (
            <PhaseRow
              key={phase.phase}
              phase={phase}
              isSelected={selectedPhase === phase.phase}
              onSelect={() => setSelectedPhase(selectedPhase === phase.phase ? null : phase.phase)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PhaseRow({ phase, isSelected, onSelect }: { phase: PhaseCard; isSelected: boolean; onSelect: () => void }) {
  const color = STATUS_COLORS[phase.status];
  const { tasks_completed, tasks_total } = phase.execution;
  const pct = tasks_total > 0 ? Math.round((tasks_completed / tasks_total) * 100) : 0;
  const isComplete = phase.status === 'completed';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={[
        'grid grid-cols-[200px_1fr_80px_40px] items-center px-[var(--spacing-3)] py-[var(--spacing-2-5)] rounded-[10px] cursor-pointer transition-all duration-150 border mt-0.5',
        isSelected
          ? 'bg-bg-primary border-[var(--color-status-planning)] shadow-sm'
          : 'border-transparent hover:bg-bg-primary hover:border-border',
      ].join(' ')}
    >
      {/* Phase info */}
      <div className="flex items-center gap-[var(--spacing-2-5)]">
        <div
          className="w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center text-[length:var(--font-size-sm)] font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {phase.phase}
        </div>
        <div className="min-w-0">
          <div className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary truncate">{phase.title}</div>
          {phase.goal && (
            <div className="text-[length:var(--font-size-xs)] text-text-tertiary truncate mt-px">{phase.goal}</div>
          )}
        </div>
      </div>

      {/* Pipeline dots */}
      <div className="flex items-center gap-0 px-[var(--spacing-2)]">
        {STAGE_ORDER.map((stage, i) => {
          const state = stageState(phase.status, i);
          return (
            <div key={stage} className="contents">
              <div
                className={[
                  'w-3 h-3 rounded-full border-2 shrink-0 transition-all duration-200',
                  state === 'done' ? 'border-[var(--color-status-completed)] bg-[var(--color-status-completed)]' : '',
                  state === 'current' ? 'scale-[1.2] border-[3px]' : '',
                  state === 'future' ? 'border-border bg-bg-primary' : '',
                ].join(' ')}
                style={state === 'current' ? {
                  borderColor: color,
                  backgroundColor: `color-mix(in srgb, ${color} 15%, var(--color-bg-primary))`,
                } : undefined}
              />
              {i < STAGE_ORDER.length - 1 && (
                <div
                  className={[
                    'flex-1 h-0.5 min-w-[6px]',
                    state === 'done' ? 'bg-[var(--color-status-completed)]' : 'bg-border',
                  ].join(' ')}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] font-mono text-text-secondary">
          {tasks_completed}/{tasks_total}
        </span>
        <div className="w-[60px] h-1 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>

      {/* Status icon */}
      <div className="flex items-center justify-center">
        {isComplete && <CheckIcon size={16} strokeWidth={1.8} style={{ color: STATUS_COLORS.completed }} />}
        {phase.verification.gaps.length > 0 && !isComplete && (
          <AlertCircleIcon size={16} strokeWidth={1.8} style={{ color: STATUS_COLORS[phase.status] }} />
        )}
      </div>
    </div>
  );
}
