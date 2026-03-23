import { useExecutionStore } from '@/client/store/execution-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// CommanderTab -- list-detail split pane for commander state + decisions
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  idle: { bg: 'var(--color-tint-pending)', fg: 'var(--color-accent-gray)' },
  thinking: { bg: 'var(--color-tint-exploring)', fg: 'var(--color-accent-blue)' },
  dispatching: { bg: 'var(--color-tint-completed)', fg: 'var(--color-accent-green)' },
  paused: { bg: 'var(--color-tint-verifying)', fg: 'var(--color-accent-orange)' },
};

export function CommanderTab() {
  const { t } = useI18n();
  const commanderState = useExecutionStore((s) => s.commanderState);
  const recentDecisions = useExecutionStore((s) => s.recentDecisions);

  const handleStart = () => sendWsMessage({ action: 'commander:start' });
  const handlePause = () => sendWsMessage({ action: 'commander:pause' });
  const handleStop = () => sendWsMessage({ action: 'commander:stop' });

  const isActive = commanderState?.status === 'thinking' || commanderState?.status === 'dispatching';
  const isPaused = commanderState?.status === 'paused';
  const latestDecision = recentDecisions.length > 0 ? recentDecisions[recentDecisions.length - 1] : null;
  const statusKey = commanderState?.status ?? 'idle';
  const statusColors = STATUS_COLORS[statusKey] ?? STATUS_COLORS.idle;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane -- commander state */}
      <div style={{ width: 320, background: 'var(--color-bg-primary)', borderRight: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.commander.title')}</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: statusColors.bg, color: statusColors.fg }}>
            {statusKey}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!isActive && !isPaused && (
              <button type="button" onClick={handleStart} style={{ ...btnStyle, background: 'var(--color-accent-green)' }}>{t('supervisor.commander.start')}</button>
            )}
            {isActive && (
              <button type="button" onClick={handlePause} style={{ ...btnStyle, background: 'var(--color-accent-orange)' }}>{t('supervisor.commander.pause')}</button>
            )}
            {(isActive || isPaused) && (
              <button type="button" onClick={handleStop} style={{ ...btnStyle, background: 'var(--color-accent-red)' }}>{t('supervisor.commander.stop')}</button>
            )}
            {isPaused && (
              <button type="button" onClick={handleStart} style={{ ...btnStyle, background: 'var(--color-accent-blue)' }}>{t('supervisor.commander.resume')}</button>
            )}
          </div>

          {/* Metrics */}
          {commanderState && (
            <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.commander.metrics')}</span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <KvRow label={t('supervisor.commander.ticks')} value={String(commanderState.tickCount)} />
                <KvRow label={t('supervisor.commander.workers')} value={String(commanderState.activeWorkers)} />
                <KvRow label={t('supervisor.commander.session')} value={commanderState.sessionId} />
                {commanderState.lastTickAt && (
                  <KvRow label={t('supervisor.commander.last_tick')} value={new Date(commanderState.lastTickAt).toLocaleTimeString()} />
                )}
              </div>
            </div>
          )}

          {/* Latest assessment */}
          {latestDecision?.assessment && (
            <div style={{ borderRadius: 12, background: 'var(--color-bg-card)', border: '1px solid var(--color-border-divider)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{t('supervisor.commander.latest_assessment')}</span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {latestDecision.assessment.observations.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{t('supervisor.commander.observations')}</div>
                    {latestDecision.assessment.observations.map((obs, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingLeft: 8 }}>- {obs}</div>
                    ))}
                  </div>
                )}
                {latestDecision.assessment.risks.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{t('supervisor.commander.risks')}</div>
                    {latestDecision.assessment.risks.map((risk, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--color-accent-red)', paddingLeft: 8 }}>- {risk}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right pane -- decision history */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--color-border-divider)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('supervisor.commander.decision_history')}</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('supervisor.commander.decisions_count', { count: recentDecisions.length })}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {recentDecisions.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>{t('supervisor.commander.no_decisions')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentDecisions.slice().reverse().map((decision, i) => {
                const time = new Date(decision.timestamp);
                const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;
                const dotColor = decision.actions.length > 0 ? 'var(--color-accent-green)' : 'var(--color-accent-gray)';
                return (
                  <div key={decision.id} style={{ display: 'flex', gap: 12, padding: '8px 0', position: 'relative' }}>
                    {i < recentDecisions.length - 1 && (
                      <div style={{ position: 'absolute', left: 11, top: 24, bottom: -8, width: 1, background: 'var(--color-border-divider)' }} />
                    )}
                    <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid var(--color-bg-card)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-placeholder)', fontFamily: "'SF Mono', Consolas, monospace" }}>{timeStr}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                        {decision.trigger} - {decision.actions.length} action{decision.actions.length !== 1 ? 's' : ''}
                      </div>
                      {decision.deferred.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{decision.deferred.length} deferred</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-divider)' }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', width: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8,
  border: 'none', cursor: 'pointer', color: '#fff', transition: 'opacity 150ms',
};
