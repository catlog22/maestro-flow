import { useState } from 'react';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { ScheduledTask, ScheduledTaskType } from '@/shared/schedule-types.js';

// ---------------------------------------------------------------------------
// ScheduleTab -- list-detail split pane
// ---------------------------------------------------------------------------

const TASK_TYPES: ScheduledTaskType[] = ['auto-dispatch', 'cleanup', 'report', 'health-check', 'learning-analysis', 'custom'];

const TYPE_ICON_COLORS: Record<string, { bg: string; fg: string }> = {
  'auto-dispatch': { bg: 'var(--color-tint-verifying)', fg: 'var(--color-accent-orange)' },
  'cleanup': { bg: 'var(--color-tint-exploring)', fg: 'var(--color-accent-blue)' },
  'report': { bg: 'var(--color-tint-planning)', fg: 'var(--color-accent-purple)' },
  'health-check': { bg: 'var(--color-tint-completed)', fg: 'var(--color-accent-green)' },
  'learning-analysis': { bg: 'var(--color-tint-executing)', fg: 'var(--color-accent-yellow)' },
  'custom': { bg: 'var(--color-tint-pending)', fg: 'var(--color-accent-gray)' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'auto-dispatch': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>,
  'cleanup': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  'report': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>,
  'health-check': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  'learning-analysis': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  'custom': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09"/></svg>,
};

export function ScheduleTab() {
  const { t } = useI18n();
  const scheduledTasks = useSupervisorStore((s) => s.scheduledTasks);
  const createSchedule = useSupervisorStore((s) => s.createSchedule);
  const deleteSchedule = useSupervisorStore((s) => s.deleteSchedule);
  const toggleSchedule = useSupervisorStore((s) => s.toggleSchedule);
  const runSchedule = useSupervisorStore((s) => s.runSchedule);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCron, setFormCron] = useState('');
  const [formType, setFormType] = useState<ScheduledTaskType>('custom');

  const filtered = searchQuery
    ? scheduledTasks.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : scheduledTasks;
  const selected = scheduledTasks.find((t) => t.id === selectedId) ?? null;

  const handleCreate = async () => {
    if (!formName.trim() || !formCron.trim()) return;
    await createSchedule({ name: formName.trim(), cronExpression: formCron.trim(), taskType: formType, config: {}, enabled: true });
    setFormName('');
    setFormCron('');
    setFormType('custom');
    setShowForm(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* List pane */}
      <div style={{ width: 320, background: 'var(--color-bg-primary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* List header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.schedule.title')}</span>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            style={{ fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--color-text-primary)', color: '#fff' }}
          >
            {showForm ? t('supervisor.schedule.cancel') : t('supervisor.schedule.new')}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('supervisor.schedule.task_name')} style={{ ...inputStyle }} />
            <input value={formCron} onChange={(e) => setFormCron(e.target.value)} placeholder="*/5 * * * *" style={{ ...inputStyle, fontFamily: "'SF Mono', Consolas, monospace" }} />
            <select value={formType} onChange={(e) => setFormType(e.target.value as ScheduledTaskType)} style={{ ...inputStyle }}>
              {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button type="button" onClick={handleCreate} disabled={!formName.trim() || !formCron.trim()} style={{ fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--color-accent-green)', color: '#fff', opacity: (!formName.trim() || !formCron.trim()) ? 0.4 : 1 }}>
              {t('supervisor.schedule.create')}
            </button>
          </div>
        )}

        {/* Search */}
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('supervisor.schedule.filter')}
          style={{ margin: '10px 12px 6px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border-divider)', background: 'var(--color-bg-card)', fontSize: 12, color: 'var(--color-text-primary)', outline: 'none' }}
        />

        {/* List body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map((task) => {
            const isActive = task.id === selectedId;
            const colors = TYPE_ICON_COLORS[task.taskType] ?? TYPE_ICON_COLORS.custom;
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedId(task.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                  cursor: 'pointer', border: 'none', background: isActive ? 'var(--color-tint-exploring)' : 'none',
                  borderLeft: `3px solid ${isActive ? 'var(--color-accent-blue)' : 'transparent'}`,
                  width: '100%', textAlign: 'left', transition: 'all 120ms',
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.fg, flexShrink: 0 }}>
                  <span style={{ width: 14, height: 14, strokeWidth: 1.8, display: 'flex' }}>{TYPE_ICONS[task.taskType] ?? TYPE_ICONS.custom}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8 }}>
                    <span style={{ fontFamily: "'SF Mono', Consolas, monospace" }}>{task.cronExpression}</span>
                    {task.lastRun && <span>{formatTimeAgo(task.lastRun)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: task.enabled ? 'rgba(90,158,120,0.12)' : 'rgba(160,157,151,0.12)', color: task.enabled ? 'var(--color-accent-green)' : 'var(--color-accent-gray)' }}>
                    {task.enabled ? t('supervisor.schedule.active') : t('supervisor.schedule.paused')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {selected ? (
          <ScheduleDetail task={selected} onToggle={toggleSchedule} onRun={runSchedule} onDelete={deleteSchedule} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
            {t('supervisor.schedule.select_detail')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduleDetail
// ---------------------------------------------------------------------------

function ScheduleDetail({ task, onToggle, onRun, onDelete }: {
  task: ScheduledTask;
  onToggle: (id: string, enabled: boolean) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const colors = TYPE_ICON_COLORS[task.taskType] ?? TYPE_ICON_COLORS.custom;

  return (
    <>
      {/* Detail header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.fg }}>
            <span style={{ width: 18, height: 18, strokeWidth: 1.8, display: 'flex' }}>{TYPE_ICONS[task.taskType] ?? TYPE_ICONS.custom}</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{task.name}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{task.taskType}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => onRun(task.id)} style={{ ...btnGhostStyle }}>{t('supervisor.schedule.run_now')}</button>
          <ToggleSwitch on={task.enabled} onToggle={() => onToggle(task.id, !task.enabled)} />
          <button type="button" onClick={() => onDelete(task.id)} style={{ ...btnGhostStyle, color: 'var(--color-accent-red)' }}>{t('supervisor.schedule.delete')}</button>
        </div>
      </div>

      {/* Detail body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border-divider)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>{t('supervisor.schedule.total_runs')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 2 }}>{task.history.length}</div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border-divider)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>{t('supervisor.schedule.success_rate')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-accent-green)', marginTop: 2 }}>
              {task.history.length > 0 ? `${Math.round((task.history.filter((h) => h.status === 'success').length / task.history.length) * 100)}%` : '-'}
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--color-bg-primary)', borderRadius: 10, padding: 14, border: '1px solid var(--color-border-divider)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>{t('supervisor.schedule.next_run')}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginTop: 6 }}>
              {task.nextRun ? new Date(task.nextRun).toLocaleString() : '-'}
            </div>
          </div>
        </div>

        {/* Configuration */}
        <Section title={t('supervisor.schedule.configuration')}>
          <KvRow label={t('supervisor.schedule.schedule_label')} value={task.cronExpression} mono />
          <KvRow label={t('supervisor.schedule.type')} value={task.taskType} />
          <KvRow label={t('supervisor.schedule.last_run')} value={task.lastRun ? new Date(task.lastRun).toLocaleString() : t('supervisor.schedule.never')} />
          {Object.entries(task.config).map(([k, v]) => (
            <KvRow key={k} label={k} value={String(v)} />
          ))}
        </Section>

        {/* Run History */}
        <Section title={t('supervisor.schedule.run_history')}>
          {task.history.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>{t('supervisor.schedule.no_runs')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {task.history.slice(-10).reverse().map((run, i) => {
                const dotColor = run.status === 'success' ? 'var(--color-accent-green)' : run.status === 'failed' ? 'var(--color-accent-red)' : 'var(--color-accent-gray)';
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', position: 'relative' }}>
                    {i < Math.min(task.history.length, 10) - 1 && (
                      <div style={{ position: 'absolute', left: 11, top: 24, bottom: -8, width: 1, background: 'var(--color-border-divider)' }} />
                    )}
                    <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid var(--color-bg-card)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-placeholder)', fontFamily: "'SF Mono', Consolas, monospace" }}>
                        {new Date(run.timestamp).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{run.status}</div>
                      {run.duration != null && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{Math.round(run.duration / 1000)}s</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</span>
      </div>
      <div style={{ padding: '14px 16px' }}>{children}</div>
    </div>
  );
}

function KvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-divider)' }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500, fontFamily: mono ? "'SF Mono', Consolas, monospace" : undefined }}>{value}</span>
    </div>
  );
}

function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: 36, height: 20, borderRadius: 100,
        background: on ? 'var(--color-accent-green)' : 'var(--color-border)',
        border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 200ms',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 200ms', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }} />
    </button>
  );
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--color-border-divider)',
  background: 'var(--color-bg-card)', fontSize: 12,
  color: 'var(--color-text-primary)', outline: 'none',
};

const btnGhostStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'none',
  color: 'var(--color-text-secondary)', cursor: 'pointer',
};
