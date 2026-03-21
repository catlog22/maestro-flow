import { useExecutionStore } from '@/client/store/execution-store.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import { formatRelative } from './OrchestratorStatusBar.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ActiveSlotsPanel — renders per-slot rows for running executions
// ---------------------------------------------------------------------------

export function ActiveSlotsPanel() {
  const running = useExecutionStore((s) => s.supervisorStatus?.running ?? []);
  const processThoughts = useAgentStore((s) => s.processThoughts);

  if (running.length === 0) {
    return (
      <div className="text-text-tertiary text-[length:var(--font-size-xs)] py-[var(--spacing-3)] text-center">
        No active slots
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-1)]">
      {running.map((slot) => {
        const thought = processThoughts[slot.processId];
        const dotColor = AGENT_DOT_COLORS[slot.executor as AgentType] ?? 'var(--color-text-tertiary)';
        const label = AGENT_LABELS[slot.executor as AgentType] ?? slot.executor;

        return (
          <div
            key={slot.processId}
            className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] hover:bg-bg-hover text-[length:var(--font-size-xs)]"
          >
            {/* Executor dot */}
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />

            {/* Executor label */}
            <span className="text-text-primary font-[var(--font-weight-medium)] shrink-0">
              {label}
            </span>

            {/* Issue ID */}
            <span className="text-text-secondary shrink-0">
              {slot.issueId}
            </span>

            {/* Elapsed time */}
            <span className="text-text-tertiary shrink-0">
              {formatRelative(slot.startedAt)}
            </span>

            {/* Turn progress */}
            <span className="text-text-tertiary shrink-0">
              {slot.turnNumber}/{slot.maxTurns}
            </span>

            {/* Thought subject */}
            <span className="text-text-tertiary truncate min-w-0">
              {thought?.subject ?? 'idle'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
