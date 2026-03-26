import { useEffect } from 'react';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { useSupervisorStore } from '@/client/store/supervisor-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { useI18n } from '@/client/i18n/index.js';
import type { CommanderConfig } from '@/shared/commander-types.js';

// ---------------------------------------------------------------------------
// CommanderTab -- single-page scrollable view (prototype-aligned redesign)
// ---------------------------------------------------------------------------

const SUGGESTION_DOT_COLORS: Record<string, string> = {
  optimize: 'var(--color-accent-green)',
  alert: 'var(--color-accent-orange)',
  automate: 'var(--color-accent-purple)',
};

export function CommanderTab() {
  const { t } = useI18n();
  const commanderState = useExecutionStore((s) => s.commanderState);
  const commanderConfig = useExecutionStore((s) => s.commanderConfig);
  const fetchCommanderConfig = useExecutionStore((s) => s.fetchCommanderConfig);
  const recentDecisions = useExecutionStore((s) => s.recentDecisions);
  const setActiveTab = useSupervisorStore((s) => s.setActiveTab);
  const learningStats = useSupervisorStore((s) => s.learningStats);

  useEffect(() => { fetchCommanderConfig(); }, [fetchCommanderConfig]);

  const handleStop = () => sendWsMessage({ action: 'commander:stop' });

  const latestDecision = recentDecisions.length > 0 ? recentDecisions[recentDecisions.length - 1] : null;
  const suggestions = learningStats?.suggestions ?? [];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>

      {/* ── Metrics ── */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionTitleStyle}>{t('supervisor.commander.metrics')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setActiveTab('executions')} style={btnStyle}>
              {t('supervisor.commander.view_executions') ?? 'View Executions'}
            </button>
            <button type="button" onClick={handleStop} style={btnDangerStyle}>
              {t('supervisor.commander.stop')}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <InfoCard
            label={t('supervisor.commander.ticks')}
            value={String(commanderState?.tickCount ?? 0)}
            sub={commanderState?.sessionId ? `Session ${commanderState.sessionId.slice(0, 8)}` : undefined}
          />
          <InfoCard
            label={t('supervisor.commander.workers')}
            value={String(commanderState?.activeWorkers ?? 0)}
            sub={commanderConfig ? `Max: ${commanderConfig.maxConcurrentWorkers}` : undefined}
          />
          <InfoCard
            label={t('supervisor.commander.last_tick')}
            value={commanderState?.lastTickAt ? formatTime(commanderState.lastTickAt) : '--:--:--'}
            valueStyle={{ fontSize: 16 }}
            sub={commanderState?.lastTickAt ? timeAgo(commanderState.lastTickAt) : undefined}
          />
        </div>
      </div>

      {/* ── Configuration ── */}
      {commanderConfig && (
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>{t('supervisor.commander.config')}</div>
          </div>
          <div style={configGroupStyle}>
            <ConfigRow
              label={t('supervisor.commander.profile')}
              desc={t('supervisor.commander.profile_desc') ?? 'Environment-specific behavior preset'}
            >
              <select
                value={commanderConfig.profile}
                onChange={(e) => sendWsMessage({ action: 'commander:config', config: { profile: e.target.value as CommanderConfig['profile'] } })}
                style={configSelectStyle}
              >
                {['development', 'staging', 'production'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </ConfigRow>
            <ConfigRow
              label={t('supervisor.commander.decision_model')}
              desc={t('supervisor.commander.decision_model_desc') ?? 'AI model for orchestration decisions'}
            >
              <select
                value={commanderConfig.decisionModel}
                onChange={(e) => sendWsMessage({ action: 'commander:config', config: { decisionModel: e.target.value as CommanderConfig['decisionModel'] } })}
                style={configSelectStyle}
              >
                {['haiku', 'sonnet', 'opus'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </ConfigRow>
            <ConfigRow
              label={t('supervisor.commander.auto_approve')}
              desc={t('supervisor.commander.auto_approve_desc') ?? 'Confidence threshold for auto-approval'}
            >
              <select
                value={commanderConfig.autoApproveThreshold}
                onChange={(e) => sendWsMessage({ action: 'commander:config', config: { autoApproveThreshold: e.target.value as CommanderConfig['autoApproveThreshold'] } })}
                style={configSelectStyle}
              >
                {['low', 'medium', 'high'].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </ConfigRow>
            <ConfigRow
              label={t('supervisor.commander.max_workers') ?? 'Max Workers'}
              desc={t('supervisor.commander.max_workers_desc') ?? 'Maximum parallel agent executions'}
              isLast
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', padding: '4px 10px' }}>
                {commanderConfig.maxConcurrentWorkers}
              </span>
            </ConfigRow>
          </div>
        </div>
      )}

      {/* ── Two-column: Decisions + Assessment/Suggestions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left: Recent Decisions */}
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>{t('supervisor.commander.decision_history')}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              {t('supervisor.commander.decisions_count', { count: recentDecisions.length })}
            </div>
          </div>
          <div style={panelStyle}>
            <div style={{ padding: '14px 16px' }}>
              {recentDecisions.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 16 }}>
                  {t('supervisor.commander.no_decisions')}
                </div>
              ) : (
                recentDecisions.slice().reverse().map((decision, i, arr) => {
                  const timeStr = formatTime(decision.timestamp);
                  const dotColor = decision.actions.length > 0 ? 'var(--color-accent-green)' : 'var(--color-accent-gray)';
                  const isLast = i === arr.length - 1;
                  return (
                    <div key={decision.id} style={{ display: 'flex', gap: 12, padding: '10px 0', position: 'relative' }}>
                      {/* Connecting line */}
                      {!isLast && (
                        <div style={{ position: 'absolute', left: 11, top: 30, bottom: -10, width: 1, background: 'var(--color-border-divider)' }} />
                      )}
                      {/* Dot */}
                      <div style={tlDotOuterStyle}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                      </div>
                      {/* Content */}
                      <div>
                        <div style={{ fontSize: 10, fontFamily: "'SF Mono', Consolas, monospace", color: 'var(--color-text-placeholder)' }}>{timeStr}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                          {decision.trigger} - {decision.actions.length} action{decision.actions.length !== 1 ? 's' : ''}
                        </div>
                        {decision.deferred.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{decision.deferred.length} deferred</div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: Assessment + Suggestions */}
        <div style={sectionStyle}>
          {/* Latest Assessment */}
          <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>{t('supervisor.commander.latest_assessment')}</div>
          </div>
          <div style={panelStyle}>
            <div style={{ padding: '14px 16px' }}>
              {latestDecision?.assessment ? (
                <>
                  {latestDecision.assessment.observations.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={labelUpperStyle}>{t('supervisor.commander.observations')}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', paddingLeft: 8, lineHeight: 1.8 }}>
                        {latestDecision.assessment.observations.map((obs, i) => (
                          <div key={i}>- {obs}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {latestDecision.assessment.risks.length > 0 && (
                    <div>
                      <div style={labelUpperStyle}>{t('supervisor.commander.risks')}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-accent-red)', paddingLeft: 8, lineHeight: 1.8 }}>
                        {latestDecision.assessment.risks.map((risk, i) => (
                          <div key={i}>- {risk}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 8 }}>
                  {t('supervisor.commander.no_decisions')}
                </div>
              )}
            </div>
          </div>

          {/* Suggestions */}
          <div style={{ marginTop: 16 }}>
            <div style={sectionHeaderStyle}>
              <div style={sectionTitleStyle}>{t('supervisor.commander.suggestions') ?? 'Suggestions'}</div>
              {suggestions.length > 0 && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: 'var(--color-tint-verifying)', color: 'var(--color-accent-orange)' }}>
                  {suggestions.length} new
                </span>
              )}
            </div>
            <div style={panelStyle}>
              <div style={{ padding: '14px 16px' }}>
                {suggestions.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 8 }}>
                    {t('supervisor.commander.no_suggestions') ?? 'No suggestions'}
                  </div>
                ) : (
                  suggestions.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < suggestions.length - 1 ? '1px solid var(--color-border-divider)' : 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: SUGGESTION_DOT_COLORS[s.type] ?? 'var(--color-accent-gray)' }} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 1 }}>
                          {s.description} ({Math.round(s.confidence * 100)}%)
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoCard({ label, value, sub, valueStyle }: { label: string; value: string; sub?: string; valueStyle?: React.CSSProperties }) {
  return (
    <div style={infoCardStyle}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', marginTop: 2, ...valueStyle }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

function ConfigRow({ label, desc, children, isLast }: { label: string; desc: string; children: React.ReactNode; isLast?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border-divider)' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: string | number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function timeAgo(ts: string | number): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const sectionStyle: React.CSSProperties = { marginBottom: 24 };

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
};

const sectionTitleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' };

const panelStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 12, border: '1px solid var(--color-border-divider)', overflow: 'hidden',
};

const infoCardStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--color-border-divider)',
};

const configGroupStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 12, border: '1px solid var(--color-border-divider)', overflow: 'hidden',
};

const configSelectStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', padding: '4px 10px', borderRadius: 6,
  border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', minWidth: 100, textAlign: 'center', cursor: 'pointer',
};

const tlDotOuterStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0, border: '2px solid var(--color-bg-primary)',
};

const labelUpperStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-tertiary)', marginBottom: 6,
};

const btnBase: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', transition: 'all 150ms',
};

const btnStyle: React.CSSProperties = { ...btnBase };

const btnDangerStyle: React.CSSProperties = {
  ...btnBase, color: 'var(--color-accent-red)', borderColor: 'var(--color-accent-red)',
};
