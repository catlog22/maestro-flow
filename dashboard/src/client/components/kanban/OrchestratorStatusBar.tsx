import { useState, useCallback } from 'react';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { OrchestratorPopover } from './OrchestratorPopover.js';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';

// ---------------------------------------------------------------------------
// OrchestratorStatusBar — bottom bar showing supervisor + commander state
// ---------------------------------------------------------------------------

const COMMANDER_DOT_COLORS: Record<string, string> = {
  idle: '#5A9E78',
  thinking: '#B89540',
  dispatching: '#5A84B8',
  paused: 'var(--color-text-tertiary)',
};

export function OrchestratorStatusBar() {
  const status = useExecutionStore((s) => s.supervisorStatus);
  const commanderState = useExecutionStore((s) => s.commanderState);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleToggle = useCallback(() => {
    sendWsMessage({
      action: 'supervisor:toggle',
      enabled: !status?.enabled,
    });
  }, [status?.enabled]);

  // Compute relative time for last tick
  const lastTickLabel = status?.lastTickAt
    ? formatRelative(status.lastTickAt)
    : 'never';

  return (
    <div className="relative shrink-0">
      {/* Popover (rendered above the bar) */}
      {popoverOpen && (
        <OrchestratorPopover onClose={() => setPopoverOpen(false)} />
      )}

      <div className="flex items-center gap-[var(--spacing-3)] px-[var(--spacing-4)] py-[var(--spacing-1-5)] border-t border-border-divider bg-bg-secondary text-[length:var(--font-size-xs)] shrink-0">
        {/* Supervisor section */}
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-[var(--spacing-1)] text-text-secondary hover:text-text-primary transition-colors"
        >
          <span
            className={[
              'w-2 h-2 rounded-full',
              status?.enabled ? 'bg-[#5A9E78]' : 'bg-text-tertiary',
            ].join(' ')}
          />
          <span className="font-[var(--font-weight-medium)]">
            Supervisor {status?.enabled ? 'ON' : 'OFF'}
          </span>
        </button>

        {status?.enabled && (
          <>
            <div className="w-px h-3 bg-border-divider" />

            <span className="text-text-secondary">
              Running: <span className="text-text-primary font-[var(--font-weight-medium)]">{status.running.length}</span>
            </span>

            <span className="text-text-secondary">
              Queued: <span className="text-text-primary font-[var(--font-weight-medium)]">{status.queued.length}</span>
            </span>

            {status.retrying.length > 0 && (
              <span className="text-[#B89540]">
                Retrying: <span className="font-[var(--font-weight-medium)]">{status.retrying.length}</span>
              </span>
            )}

            <span className="text-text-tertiary">
              Last tick: {lastTickLabel}
            </span>

            {status.stats.totalDispatched > 0 && (
              <>
                <div className="w-px h-3 bg-border-divider" />
                <span className="text-text-tertiary">
                  {status.stats.totalCompleted}/{status.stats.totalDispatched} done
                  {status.stats.totalFailed > 0 && (
                    <span className="text-[#C46555]"> ({status.stats.totalFailed} failed)</span>
                  )}
                </span>
              </>
            )}
          </>
        )}

        {/* Commander section */}
        {commanderState && (
          <>
            <div className="w-px h-3 bg-border-divider" />

            <div className="flex items-center gap-[var(--spacing-1)] text-text-secondary">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: COMMANDER_DOT_COLORS[commanderState.status] ?? 'var(--color-text-tertiary)' }}
              />
              <span className="font-[var(--font-weight-medium)]">
                Commander {commanderState.status}
              </span>
            </div>

            <span className="text-text-tertiary">
              Tick #{commanderState.tickCount}
            </span>

            {commanderState.lastDecision?.actions[0] && (
              <span className="text-text-tertiary">
                Last: {commanderState.lastDecision.actions[0].type}
              </span>
            )}
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Popover toggle */}
        <button
          type="button"
          onClick={() => setPopoverOpen(!popoverOpen)}
          className="flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={popoverOpen ? 'Close details' : 'Show details'}
        >
          {popoverOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
    </div>
  );
}

export function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'never';
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}
