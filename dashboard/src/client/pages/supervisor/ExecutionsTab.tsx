import { useExecutionStore } from '@/client/store/execution-store.js';
import { useI18n } from '@/client/i18n/index.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ExecutionsTab -- execution slots, queue, and stats (replaces MonitorTab)
// ---------------------------------------------------------------------------

function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function ExecutionsTab() {
  const { t } = useI18n();
  const slots = useExecutionStore((s) => s.slots);
  const queue = useExecutionStore((s) => s.queue);
  const status = useExecutionStore((s) => s.supervisorStatus);

  const slotList = Object.values(slots);
  const dispatched = status?.stats.totalDispatched ?? 0;
  const completed = status?.stats.totalCompleted ?? 0;
  const failed = status?.stats.totalFailed ?? 0;
  const successRate = dispatched > 0 ? Math.round((completed / dispatched) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: 24, gap: 20 }}>
      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatBox
          label={t('supervisor.overview.dispatched')}
          value={String(dispatched)}
          sub={`${slotList.length} ${t('supervisor.overview.active')}`}
        />
        <StatBox
          label={t('supervisor.overview.success_rate')}
          value={dispatched ? `${successRate}%` : '-'}
          valueColor="var(--color-accent-green)"
          sub={`${completed} ${t('supervisor.overview.completed')}`}
        />
        <StatBox
          label={t('supervisor.overview.queued')}
          value={String(queue.length)}
          sub={`${status?.retrying?.length ?? 0} retrying`}
        />
        <StatBox
          label="Failed"
          value={String(failed)}
          valueColor={failed > 0 ? 'var(--color-accent-red)' : undefined}
          sub={dispatched > 0 ? `${Math.round((failed / dispatched) * 100)}% fail rate` : '-'}
        />
      </div>

      {/* Active slots */}
      <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {t('supervisor.overview.active_executions')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {t('supervisor.overview.running_count', { count: slotList.length })}
          </span>
        </div>
        <div>
          {slotList.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>
              No active executions
            </div>
          ) : (
            slotList.map((slot) => {
              const dotColor = AGENT_DOT_COLORS[slot.executor as AgentType] ?? 'var(--color-text-tertiary)';
              const label = AGENT_LABELS[slot.executor as AgentType] ?? slot.executor;
              return (
                <div
                  key={slot.processId}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{slot.issueId}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Turn {slot.turnNumber}/{slot.maxTurns}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{formatElapsed(slot.startedAt)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Queue ({queue.length})
            </span>
          </div>
          <div>
            {queue.map((issueId, i) => (
              <div key={issueId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)', minWidth: 20 }}>#{i + 1}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{issueId}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatBox
// ---------------------------------------------------------------------------

function StatBox({ label, value, sub, valueColor }: { label: string; value: string; sub: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border-divider)' }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor ?? 'var(--color-text-primary)', marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{sub}</div>
    </div>
  );
}
