import { useExecutionStore } from '@/client/store/execution-store.js';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// MonitorTab -- Overview: stat boxes, patterns, suggestions, activity
// ---------------------------------------------------------------------------

function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const SUGGESTION_DOT: Record<string, string> = {
  optimize: 'var(--color-accent-green)',
  alert: 'var(--color-accent-yellow)',
  automate: 'var(--color-accent-purple)',
};

const TYPE_TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  'auto-dispatch': { bg: 'rgba(200,134,58,0.12)', fg: 'var(--color-accent-orange)' },
  'cleanup': { bg: 'rgba(91,141,184,0.12)', fg: 'var(--color-accent-blue)' },
  'report': { bg: 'rgba(145,120,181,0.12)', fg: 'var(--color-accent-purple)' },
  'health-check': { bg: 'rgba(90,158,120,0.12)', fg: 'var(--color-accent-green)' },
  'learning-analysis': { bg: 'rgba(184,149,64,0.12)', fg: 'var(--color-accent-yellow)' },
  'custom': { bg: 'rgba(160,157,151,0.12)', fg: 'var(--color-accent-gray)' },
};

export function MonitorTab() {
  const { t } = useI18n();
  const slots = useExecutionStore((s) => s.slots);
  const queue = useExecutionStore((s) => s.queue);
  const status = useExecutionStore((s) => s.supervisorStatus);
  const learningStats = useSupervisorStore((s) => s.learningStats);
  const learningPatterns = useSupervisorStore((s) => s.learningPatterns);
  const scheduledTasks = useSupervisorStore((s) => s.scheduledTasks);
  const extensions = useSupervisorStore((s) => s.extensions);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);

  const slotList = Object.values(slots);
  const maxFrequency = learningPatterns.reduce((max, p) => Math.max(max, p.frequency), 1);
  const enabledSchedules = scheduledTasks.filter((t) => t.enabled).length;

  return (
    <div className="flex flex-col overflow-y-auto h-full" style={{ padding: 24, gap: 20 }}>
      {/* Title */}
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
        {t('supervisor.overview.title')}
      </div>

      {/* Stat boxes row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatBox
          label={t('supervisor.overview.dispatched')}
          value={String(status?.stats.totalDispatched ?? 0)}
          sub={`${slotList.length} ${t('supervisor.overview.active')}`}
        />
        <StatBox
          label={t('supervisor.overview.success_rate')}
          value={
            status?.stats.totalDispatched
              ? `${Math.round(((status.stats.totalCompleted) / status.stats.totalDispatched) * 100)}%`
              : '-'
          }
          valueColor="var(--color-accent-green)"
          sub={`${status?.stats.totalCompleted ?? 0} ${t('supervisor.overview.completed')}`}
        />
        <StatBox
          label={t('supervisor.overview.active_schedules')}
          value={`${enabledSchedules} / ${scheduledTasks.length}`}
          sub={`${queue.length} ${t('supervisor.overview.queued')}`}
        />
        <StatBox
          label={t('supervisor.overview.extensions')}
          value={String(extensions.length)}
          sub={`${extensions.filter((e) => e.status === 'enabled').length} ${t('supervisor.overview.enabled')}`}
        />
      </div>

      {/* Two-column: patterns + suggestions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Top Patterns */}
        <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.overview.top_patterns')}</span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            {learningPatterns.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>
                {t('supervisor.overview.no_patterns')}
              </div>
            ) : (
              learningPatterns.slice(0, 5).map((pattern) => {
                const pct = Math.round((pattern.frequency / maxFrequency) * 100);
                const rateColor = pattern.successRate >= 0.9
                  ? 'var(--color-accent-green)'
                  : pattern.successRate >= 0.7
                    ? 'var(--color-accent-blue)'
                    : 'var(--color-accent-yellow)';
                return (
                  <div key={pattern.command} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--color-border-divider)' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: "'SF Mono', Consolas, monospace", minWidth: 130 }}>
                      {pattern.command}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 100, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 100, background: rateColor }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                      {pattern.frequency} / {Math.round(pattern.successRate * 100)}%
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Suggestions */}
        <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.overview.suggestions')}</span>
            {learningStats && learningStats.suggestions.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(200,134,58,0.12)', color: 'var(--color-accent-orange)' }}>
                {t('supervisor.overview.new_count', { count: learningStats.suggestions.length })}
              </span>
            )}
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(!learningStats || learningStats.suggestions.length === 0) ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>
                {t('supervisor.overview.no_suggestions')}
              </div>
            ) : (
              learningStats.suggestions.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: SUGGESTION_DOT[s.type] ?? 'var(--color-accent-gray)', marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{s.description} ({Math.round(s.confidence * 100)}%)</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Active slots */}
      {slotList.length > 0 && (
        <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.overview.active_executions')}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('supervisor.overview.running_count', { count: slotList.length })}</span>
          </div>
          <div style={{ padding: 0 }}>
            {slotList.map((slot) => {
              const dotColor = AGENT_DOT_COLORS[slot.executor as AgentType] ?? 'var(--color-text-tertiary)';
              const label = AGENT_LABELS[slot.executor as AgentType] ?? slot.executor;
              return (
                <div
                  key={slot.processId}
                  className="flex items-center gap-3"
                  style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{slot.issueId}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Turn {slot.turnNumber}/{slot.maxTurns}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{formatElapsed(slot.startedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Schedule Activity */}
      <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.overview.recent_activity')}</span>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
          >
            {t('supervisor.overview.view_all')}
          </button>
        </div>
        <div style={{ padding: 0 }}>
          {scheduledTasks.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>
              {t('supervisor.overview.no_tasks')}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[t('supervisor.overview.th_task'), t('supervisor.overview.th_type'), t('supervisor.overview.th_last_run'), t('supervisor.overview.th_status')].map((h) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)', textAlign: 'left', padding: '8px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduledTasks.slice(0, 5).map((task) => {
                  const typeColors = TYPE_TAG_COLORS[task.taskType] ?? TYPE_TAG_COLORS.custom;
                  return (
                    <tr key={task.id} className="cursor-pointer" style={{ transition: 'background 120ms' }} onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-bg-hover)'; }} onMouseOut={(e) => { e.currentTarget.style.background = ''; }}>
                      <td style={{ fontSize: 12, padding: '10px 16px', fontWeight: 500, borderBottom: '1px solid var(--color-border-divider)' }}>
                        {task.name}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                        <span style={{ display: 'inline-flex', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: typeColors.bg, color: typeColors.fg }}>
                          {task.taskType}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                        {task.lastRun ? new Date(task.lastRun).toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                        <span style={{ display: 'inline-flex', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: task.enabled ? 'rgba(90,158,120,0.12)' : 'rgba(160,157,151,0.12)', color: task.enabled ? 'var(--color-accent-green)' : 'var(--color-accent-gray)' }}>
                          {task.enabled ? 'active' : 'paused'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
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
