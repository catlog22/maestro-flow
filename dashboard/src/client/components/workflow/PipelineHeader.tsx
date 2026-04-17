import type { PhaseCard, PhaseStatus } from '@/shared/types.js';
import { STATUS_COLORS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// PipelineHeader -- horizontal stage flow: dots + arrows + counts
// ---------------------------------------------------------------------------

const PIPELINE_STAGES: Array<{ status: PhaseStatus; label: string }> = [
  { status: 'pending', label: 'Pending' },
  { status: 'exploring', label: 'Exploring' },
  { status: 'planning', label: 'Planning' },
  { status: 'executing', label: 'Executing' },
  { status: 'verifying', label: 'Verifying' },
  { status: 'completed', label: 'Complete' },
];

interface PipelineHeaderProps {
  phases: PhaseCard[];
}

function countByStatus(phases: PhaseCard[], status: PhaseStatus): number {
  if (status === 'completed') {
    return phases.filter((p) => p.status === 'completed').length;
  }
  if (status === 'verifying') {
    return phases.filter((p) => p.status === 'verifying' || p.status === 'testing').length;
  }
  if (status === 'pending') {
    return phases.filter((p) => p.status === 'pending' || p.status === 'not_started').length;
  }
  return phases.filter((p) => p.status === status).length;
}

export function PipelineHeader({ phases }: PipelineHeaderProps) {
  return (
    <div className="flex items-center px-[var(--spacing-4)] py-[var(--spacing-3)] border-b border-border-divider bg-bg-primary shrink-0 gap-0 overflow-x-auto">
      {PIPELINE_STAGES.map((stage, i) => {
        const count = countByStatus(phases, stage.status);
        const color = STATUS_COLORS[stage.status];
        return (
          <div key={stage.status} className="contents">
            {/* Stage chip */}
            <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3-5)] py-[var(--spacing-1-5)] text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-tertiary">
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              {stage.label}
              <span className="text-[10px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-px rounded-full bg-bg-secondary text-text-tertiary font-mono">
                {count}
              </span>
            </div>

            {/* Arrow connector */}
            {i < PIPELINE_STAGES.length - 1 && (
              <div className="relative w-5 h-px bg-border shrink-0">
                <div className="absolute -right-px -top-[3px] border-[3px] border-transparent border-l-[4px] border-l-border" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
