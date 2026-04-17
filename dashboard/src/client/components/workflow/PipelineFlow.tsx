import type { PhaseCard, PhaseStatus } from '@/shared/types.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import CheckIcon from 'lucide-react/dist/esm/icons/check.js';

// ---------------------------------------------------------------------------
// PipelineFlow -- horizontal phase node chain for Command Center
// ---------------------------------------------------------------------------

interface PipelineFlowProps {
  phases: PhaseCard[];
}

const STATUS_LABELS: Record<PhaseStatus, string> = {
  not_started: 'Pending',
  pending: 'Pending',
  exploring: 'Explore',
  planning: 'Plan',
  executing: 'Execute',
  verifying: 'Verify',
  testing: 'Test',
  completed: 'Done',
  blocked: 'Blocked',
};

function isPhaseCompleted(status: PhaseStatus): boolean {
  return status === 'completed';
}

function isPhaseActive(status: PhaseStatus): boolean {
  return status === 'executing';
}

function nodeOpacity(status: PhaseStatus): number {
  if (isPhaseCompleted(status) || isPhaseActive(status)) return 1;
  if (status === 'verifying' || status === 'testing' || status === 'planning') return 0.7;
  if (status === 'exploring') return 0.5;
  return 0.4;
}

export function PipelineFlow({ phases }: PipelineFlowProps) {
  return (
    <div className="flex items-center gap-0 px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-border bg-bg-primary overflow-x-auto shrink-0">
      {phases.map((phase, i) => {
        const color = STATUS_COLORS[phase.status];
        const completed = isPhaseCompleted(phase.status);
        const active = isPhaseActive(phase.status);
        const opacity = nodeOpacity(phase.status);

        return (
          <div key={phase.phase} className="contents">
            {/* Node */}
            <div className="flex flex-col items-center gap-1 shrink-0 cursor-pointer group">
              <div
                className="relative w-[42px] h-[42px] rounded-[12px] flex items-center justify-center text-[length:var(--font-size-sm)] font-bold text-white transition-transform duration-200 group-hover:scale-110"
                style={{ backgroundColor: color, opacity }}
              >
                {completed ? (
                  <CheckIcon size={18} strokeWidth={2.5} />
                ) : (
                  phase.phase
                )}
                {active && (
                  <span
                    className="absolute -inset-1 rounded-[14px] border-2 animate-pulse opacity-30"
                    style={{ borderColor: color }}
                  />
                )}
              </div>
              <span
                className="text-[10px] font-[var(--font-weight-semibold)] max-w-[80px] text-center truncate text-text-tertiary"
                style={active ? { color, fontWeight: 700 } : undefined}
              >
                {phase.title}
              </span>
              <span
                className="text-[8px] font-[var(--font-weight-semibold)] uppercase tracking-wide px-[5px] py-px rounded-full"
                style={{
                  backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                  color,
                }}
              >
                {STATUS_LABELS[phase.status]}
              </span>
            </div>

            {/* Connector */}
            {i < phases.length - 1 && (
              <div className="relative w-10 h-0.5 shrink-0 mb-[22px]">
                <div className="absolute inset-0 bg-border" />
                {completed && (
                  <div className="absolute top-0 left-0 h-full rounded-sm" style={{ width: '100%', backgroundColor: 'var(--color-status-completed)' }} />
                )}
                {!completed && (
                  <div className="absolute -right-px -top-[3px] border-[3px] border-transparent border-l-[5px] border-l-border" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
