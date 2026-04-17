import { useState, useRef, useEffect } from 'react';
import type { PhaseCard } from '@/shared/types.js';
import { useBoardStore } from '@/client/store/board-store.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import PlayIcon from 'lucide-react/dist/esm/icons/play.js';

// ---------------------------------------------------------------------------
// ActiveExecutionPanel -- shows the current executing phase with wave details
// ---------------------------------------------------------------------------

const STATUS_NEXT_COMMAND: Record<string, string> = {
  not_started: '/maestro-analyze {N}',
  pending: '/maestro-analyze {N}',
  exploring: '/maestro-plan {N}',
  planning: '/maestro-execute {N}',
  executing: '/maestro-execute {N}',
  verifying: '/quality-review {N}',
  testing: '/quality-test {N}',
  completed: '/maestro-phase-transition',
  blocked: '/quality-debug',
};

function getNextActionPhase(phases: PhaseCard[]): PhaseCard | null {
  const active = phases.filter((p) => p.status !== 'completed' && p.status !== 'blocked');
  if (active.length === 0) return null;
  return active.reduce((min, p) => (p.phase < min.phase ? p : min), active[0]);
}

function NextActionPanel({ phase }: { phase: PhaseCard | null }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!phase) {
    return (
      <div className="text-[length:var(--font-size-sm)] text-text-tertiary italic text-center py-[var(--spacing-6)]">
        All phases complete
      </div>
    );
  }

  const rawCommand = STATUS_NEXT_COMMAND[phase.status] ?? '';
  const command = rawCommand.replace('{N}', String(phase.phase));
  const color = STATUS_COLORS[phase.status as keyof typeof STATUS_COLORS];

  function handleCopy() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-2)]">
      {/* Phase info */}
      <div className="flex items-center gap-[var(--spacing-2-5)] mb-[var(--spacing-2)]">
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[length:var(--font-size-base)] font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {phase.phase}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[length:var(--font-size-sm)] font-bold text-text-primary truncate">{phase.title}</div>
          <span
            className="inline-block text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full mt-px"
            style={{ backgroundColor: `${color}1a`, color }}
          >
            {phase.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        </div>
      </div>

      {/* Command row */}
      <div className="flex items-center gap-[var(--spacing-2)]">
        <code className="flex-1 font-mono bg-bg-primary border border-border-divider rounded px-[var(--spacing-1-5)] py-[var(--spacing-0-5)] text-[length:var(--font-size-xs)] text-text-primary truncate">
          {command}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 cursor-pointer text-text-tertiary hover:text-text-primary transition-colors text-[length:var(--font-size-xs)]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ActiveExecutionPanel() {
  const phases = useBoardStore((s) => s.board?.phases ?? []);
  const executing = phases.find((p) => p.status === 'executing') ?? null;

  return (
    <div className="flex flex-col overflow-hidden border-r border-r-border-divider border-b border-b-border-divider">
      {/* Header */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2-5)] border-b border-border-divider shrink-0">
        <PlayIcon size={14} strokeWidth={2} className="text-text-tertiary" />
        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] uppercase tracking-wider text-text-tertiary">
          Active Execution
        </span>
        {executing && executing.execution.current_wave > 0 && (
          <span
            className="ml-auto text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full"
            style={{
              backgroundColor: 'rgba(184, 149, 64, 0.12)',
              color: STATUS_COLORS.executing,
            }}
          >
            Wave {executing.execution.current_wave}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-[var(--spacing-4)] py-[var(--spacing-3)]">
        {!executing ? (
          <NextActionPanel phase={getNextActionPhase(phases)} />
        ) : (
          <ExecutionContent phase={executing} />
        )}
      </div>
    </div>
  );
}

function ExecutionContent({ phase }: { phase: PhaseCard }) {
  const { tasks_completed, tasks_total, current_wave } = phase.execution;
  const pct = tasks_total > 0 ? Math.round((tasks_completed / tasks_total) * 100) : 0;
  const color = STATUS_COLORS[phase.status];

  return (
    <>
      {/* Phase info */}
      <div className="flex items-center gap-[var(--spacing-2-5)] mb-[var(--spacing-3)]">
        <div
          className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[length:var(--font-size-base)] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {phase.phase}
        </div>
        <div>
          <div className="text-[length:var(--font-size-base)] font-bold text-text-primary">{phase.title}</div>
          {phase.goal && (
            <div className="text-[length:var(--font-size-xs)] text-text-tertiary">{phase.goal}</div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-[var(--spacing-3-5)]">
        <div className="h-1.5 bg-border rounded-full overflow-hidden mb-1">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%`, backgroundColor: 'var(--color-status-completed)' }}
          />
        </div>
        <div className="flex justify-between text-[length:var(--font-size-xs)] text-text-tertiary">
          <span>{tasks_completed} of {tasks_total} tasks complete</span>
          <span>{pct}%</span>
        </div>
      </div>

      {/* Wave info */}
      {current_wave > 0 && (
        <div className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary mb-[var(--spacing-1-5)]">
          Wave {current_wave}
        </div>
      )}
      {phase.plan.task_ids.length > 0 && (
        <div className="flex flex-col gap-1">
          {phase.plan.task_ids.map((taskId) => (
            <div
              key={taskId}
              className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-2-5)] py-[var(--spacing-1-5)] rounded-[var(--radius-md)] bg-bg-primary border border-border-divider text-[length:var(--font-size-sm)]"
            >
              <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-text-quaternary" />
              <span className="flex-1 text-text-primary font-[var(--font-weight-medium)] truncate">{taskId}</span>
              <span className="text-[length:var(--font-size-xs)] font-mono text-text-quaternary">{taskId}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
