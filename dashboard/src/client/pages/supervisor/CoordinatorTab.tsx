import { useState, useEffect, useRef, useCallback } from 'react';
import { useCoordinateStore } from '@/client/store/coordinate-store.js';
import { useI18n } from '@/client/i18n/index.js';
import type { CoordinateStep, CoordinateStepStatus, CoordinateSessionStatus } from '@/shared/coordinate-types.js';

// ---------------------------------------------------------------------------
// CoordinatorTab -- full coordinator UI matching prototype design
// ---------------------------------------------------------------------------

const TOOLS = ['claude', 'gemini', 'codex', 'qwen', 'opencode'] as const;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  running:                { bg: 'var(--color-tint-running)',    color: 'var(--color-accent-blue)' },
  classifying:            { bg: 'var(--color-tint-running)',    color: 'var(--color-accent-blue)' },
  analyzing_state:        { bg: 'var(--color-tint-running)',    color: 'var(--color-accent-blue)' },
  classifying_intent:     { bg: 'var(--color-tint-running)',    color: 'var(--color-accent-blue)' },
  reviewing:              { bg: 'var(--color-tint-running)',    color: 'var(--color-accent-blue)' },
  awaiting_clarification: { bg: 'var(--color-tint-verifying)',  color: 'var(--color-accent-orange)' },
  completed:              { bg: 'var(--color-tint-completed)',  color: 'var(--color-accent-green)' },
  failed:                 { bg: 'var(--color-tint-failed)',     color: 'var(--color-accent-red)' },
  paused:                 { bg: 'var(--color-tint-pending)',    color: 'var(--color-accent-gray)' },
  idle:                   { bg: 'var(--color-tint-pending)',    color: 'var(--color-accent-gray)' },
};

const STEP_STATUS_COLORS: Record<CoordinateStepStatus, { bg: string; dot: string }> = {
  completed: { bg: 'var(--color-tint-completed)', dot: 'var(--color-accent-green)' },
  running:   { bg: 'var(--color-tint-running)',   dot: 'var(--color-accent-blue)' },
  pending:   { bg: 'transparent',                 dot: 'var(--color-accent-gray)' },
  failed:    { bg: 'var(--color-tint-failed)',     dot: 'var(--color-accent-red)' },
  skipped:   { bg: 'var(--color-tint-pending)',    dot: 'var(--color-accent-gray)' },
};

export function CoordinatorTab() {
  const { t } = useI18n();
  const session = useCoordinateStore((s) => s.session);
  const selectedStepIndex = useCoordinateStore((s) => s.selectedStepIndex);
  const clarificationQuestion = useCoordinateStore((s) => s.clarificationQuestion);
  const startSession = useCoordinateStore((s) => s.start);
  const stopSession = useCoordinateStore((s) => s.stop);
  const resumeSession = useCoordinateStore((s) => s.resume);
  const selectStep = useCoordinateStore((s) => s.selectStep);
  const sendClarification = useCoordinateStore((s) => s.sendClarification);

  const [intent, setIntent] = useState('');
  const [tool, setTool] = useState<string>('claude');
  const [autoMode, setAutoMode] = useState(true);
  const [clarifyInput, setClarifyInput] = useState('');
  const [elapsed, setElapsed] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasSession = session != null && session.status !== 'idle';
  const isActive = hasSession && (session.status === 'running' || session.status === 'classifying' || session.status === 'analyzing_state' || session.status === 'classifying_intent' || session.status === 'reviewing');
  const isClarifying = session?.status === 'awaiting_clarification';
  const steps = session?.steps ?? [];
  const selectedStep = selectedStepIndex != null ? steps[selectedStepIndex] ?? null : null;

  // Compute metrics
  const completedSteps = steps.filter((s) => s.status === 'completed');
  const totalSteps = steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0;
  const avgQuality = session?.avgQuality ?? (completedSteps.length > 0
    ? completedSteps.reduce((sum, s) => sum + (s.qualityScore ?? 0), 0) / completedSteps.length
    : null);

  // Elapsed timer
  const computeElapsed = useCallback(() => {
    if (!session || !steps.length) return '--';
    // Use first step's startedAt or fall back to now
    const firstStart = steps[0]?.startedAt;
    if (!firstStart) return '--';
    const diffMs = Date.now() - new Date(firstStart).getTime();
    if (diffMs < 0) return '--';
    const secs = Math.floor(diffMs / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  }, [session, steps]);

  useEffect(() => {
    if (isActive) {
      setElapsed(computeElapsed());
      timerRef.current = setInterval(() => setElapsed(computeElapsed()), 1000);
    } else {
      setElapsed(computeElapsed());
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive, computeElapsed]);

  // Auto-select the running step when session updates
  useEffect(() => {
    if (!hasSession) return;
    if (selectedStepIndex != null) return;
    const runningIdx = steps.findIndex((s) => s.status === 'running');
    if (runningIdx >= 0) selectStep(runningIdx);
    else if (steps.length > 0) selectStep(0);
  }, [hasSession, steps, selectedStepIndex, selectStep]);

  const handleStart = () => {
    if (!intent.trim()) return;
    startSession(intent.trim(), tool, autoMode);
    setIntent('');
  };

  const handleSendClarification = () => {
    if (!clarifyInput.trim() || !session) return;
    sendClarification(session.sessionId, clarifyInput.trim());
    setClarifyInput('');
  };

  const formatDuration = (step: CoordinateStep): string => {
    if (step.durationMs != null) {
      const s = Math.floor(step.durationMs / 1000);
      const m = Math.floor(s / 60);
      if (m > 0) return `${m}m ${s % 60}s`;
      return `${s}s`;
    }
    if (step.status === 'running' && step.startedAt) {
      const diff = Math.floor((Date.now() - new Date(step.startedAt).getTime()) / 1000);
      const m = Math.floor(diff / 60);
      if (m > 0) return `${m}m ${diff % 60}s...`;
      return `${diff}s...`;
    }
    return '';
  };

  const qualityColor = (score: number) =>
    score >= 70 ? 'var(--color-accent-green)' : score >= 40 ? 'var(--color-accent-orange)' : 'var(--color-accent-red)';

  const qualityTintColor = (score: number) =>
    score >= 70 ? 'var(--color-tint-completed)' : score >= 40 ? 'var(--color-tint-verifying)' : 'var(--color-tint-failed)';

  const sessionStatusLabel = (status: CoordinateSessionStatus): string => {
    switch (status) {
      case 'running': return 'Running';
      case 'classifying': case 'classifying_intent': return 'Classifying';
      case 'analyzing_state': return 'Analyzing';
      case 'reviewing': return 'Reviewing';
      case 'awaiting_clarification': return 'Needs Clarification';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'paused': return 'Paused';
      default: return status;
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>

      {/* ── 1. Intent Input Section ── */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div style={sectionTitleStyle}>{t('supervisor.coordinator.title')}</div>
          {hasSession && (
            <div style={{ display: 'flex', gap: 6 }}>
              {isActive && (
                <button type="button" onClick={stopSession} style={btnDangerStyle}>
                  {t('supervisor.coordinator.stop')}
                </button>
              )}
              {(session.status === 'paused' || session.status === 'failed') && (
                <button type="button" onClick={() => resumeSession()} style={btnSuccessStyle}>
                  {t('supervisor.coordinator.resume')}
                </button>
              )}
            </div>
          )}
        </div>
        <div style={intentPanelStyle}>
          <div style={intentInnerStyle}>
            <input
              style={intentInputStyle}
              placeholder={t('supervisor.coordinator.describe_intent')}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <select
                style={toolSelectStyle}
                value={tool}
                onChange={(e) => setTool(e.target.value)}
              >
                {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="button"
                style={autoMode ? autoChipOnStyle : autoChipOffStyle}
                onClick={() => setAutoMode(!autoMode)}
              >
                {autoMode ? t('supervisor.coordinator.auto') : t('supervisor.coordinator.manual')}
              </button>
              <button type="button" style={btnPrimaryStyle} onClick={handleStart}>
                {t('supervisor.coordinator.start')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Session Metrics ── */}
      {hasSession && (
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>Session</div>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
              background: (STATUS_COLORS[session.status] ?? STATUS_COLORS.idle).bg,
              color: (STATUS_COLORS[session.status] ?? STATUS_COLORS.idle).color,
            }}>
              {sessionStatusLabel(session.status)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {/* Chain */}
            <div style={infoCardStyle}>
              <div style={infoCardLabelStyle}>{t('supervisor.coordinator.chain')}</div>
              <div style={{ ...infoCardValueStyle, fontSize: 16 }}>{session.chainName ?? '--'}</div>
              <div style={infoCardSubStyle}>{session.intent || '--'}</div>
            </div>
            {/* Progress */}
            <div style={infoCardStyle}>
              <div style={infoCardLabelStyle}>{t('supervisor.coordinator.progress')}</div>
              <div style={infoCardValueStyle}>
                {completedSteps.length}
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-tertiary)' }}> / {totalSteps}</span>
              </div>
              <div style={infoCardSubStyle}>
                <div style={{ height: 3, background: 'rgba(0,0,0,0.06)', borderRadius: 100, overflow: 'hidden', marginTop: 4 }}>
                  <div style={{ height: '100%', borderRadius: 100, background: 'linear-gradient(90deg, var(--color-accent-blue), var(--color-accent-green))', width: `${progressPct}%`, transition: 'width 0.6s' }} />
                </div>
              </div>
            </div>
            {/* Avg Quality */}
            <div style={infoCardStyle}>
              <div style={infoCardLabelStyle}>{t('supervisor.coordinator.avg_quality')}</div>
              <div style={{ ...infoCardValueStyle, color: avgQuality != null ? qualityColor(avgQuality) : 'var(--color-text-primary)' }}>
                {avgQuality != null ? avgQuality.toFixed(1) : '--'}
              </div>
              <div style={infoCardSubStyle}>
                {completedSteps.length > 0
                  ? t('supervisor.coordinator.from_steps', { count: completedSteps.length })
                  : '--'}
              </div>
            </div>
            {/* Elapsed */}
            <div style={infoCardStyle}>
              <div style={infoCardLabelStyle}>{t('supervisor.coordinator.elapsed')}</div>
              <div style={{ ...infoCardValueStyle, fontSize: 16 }}>{elapsed}</div>
              <div style={infoCardSubStyle}>{t('supervisor.coordinator.tool_label')}: {session.tool ?? tool}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. Clarification Panel ── */}
      {isClarifying && clarificationQuestion && (
        <div style={sectionStyle}>
          <div style={clarifyPanelStyle}>
            <div style={clarifyBannerStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={clarifyBannerTextStyle}>{t('supervisor.coordinator.clarification_needed')}</span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div style={clarifyQuestionStyle}>{clarificationQuestion}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={clarifyInputStyle}
                  placeholder={t('supervisor.coordinator.type_response')}
                  value={clarifyInput}
                  onChange={(e) => setClarifyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendClarification(); }}
                />
                <button type="button" style={clarifySendStyle} onClick={handleSendClarification}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                  {t('supervisor.coordinator.send')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. Chain Steps + Step Detail ── */}
      {hasSession && steps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Left: Chain Steps Timeline */}
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <div style={sectionTitleStyle}>{t('supervisor.coordinator.chain_steps')}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                {t('supervisor.coordinator.steps_count', { count: totalSteps })}
              </div>
            </div>
            <div style={panelStyle}>
              <div style={{ padding: '14px 16px' }}>
                {steps.map((step, idx) => {
                  const sc = STEP_STATUS_COLORS[step.status] ?? STEP_STATUS_COLORS.pending;
                  const isSelected = selectedStepIndex === idx;
                  const isLast = idx === steps.length - 1;
                  const dur = formatDuration(step);
                  return (
                    <div
                      key={step.index}
                      onClick={() => selectStep(idx)}
                      style={{
                        display: 'flex', gap: 12, padding: '10px 8px', position: 'relative', cursor: 'pointer',
                        background: isSelected ? 'var(--color-bg-hover)' : 'transparent',
                        borderRadius: isSelected ? 8 : 0,
                        margin: isSelected ? '0 -8px' : '0',
                      }}
                    >
                      {/* Connecting line */}
                      {!isLast && (
                        <div style={{
                          position: 'absolute', left: isSelected ? 19 : 11, top: 30, bottom: -10,
                          width: 1,
                          background: step.status === 'completed' ? 'var(--color-accent-green)' : 'var(--color-border-divider)',
                          opacity: step.status === 'completed' ? 0.4 : 1,
                        }} />
                      )}
                      {/* Dot */}
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, background: sc.bg, border: '2px solid var(--color-bg-primary)',
                      }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', background: sc.dot,
                          animation: step.status === 'running' ? 'pulse 2s infinite' : undefined,
                        }} />
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{step.cmd}</div>
                        {step.args && <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{step.args}</div>}
                        {(dur || step.qualityScore != null || step.status === 'running') && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                            {dur && <span style={{ fontSize: 10, fontFamily: "'SF Mono', Consolas, monospace", color: 'var(--color-text-placeholder)' }}>{dur}</span>}
                            {step.qualityScore != null && (
                              <span style={{
                                fontSize: 9, fontWeight: 600, padding: '1px 7px', borderRadius: 100,
                                background: qualityTintColor(step.qualityScore),
                                color: qualityColor(step.qualityScore),
                              }}>
                                {step.qualityScore}
                              </span>
                            )}
                            {step.status === 'running' && step.qualityScore == null && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                                background: 'var(--color-tint-running)', color: 'var(--color-accent-blue)',
                              }}>
                                running
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Step Detail */}
          <div style={sectionStyle}>
            {selectedStep ? (
              <>
                <div style={sectionHeaderStyle}>
                  <div style={sectionTitleStyle}>
                    Step {(selectedStepIndex ?? 0) + 1}: {selectedStep.cmd}
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                    background: (STEP_STATUS_COLORS[selectedStep.status] ?? STEP_STATUS_COLORS.pending).bg || 'var(--color-tint-pending)',
                    color: (STEP_STATUS_COLORS[selectedStep.status] ?? STEP_STATUS_COLORS.pending).dot,
                  }}>
                    {selectedStep.status}
                  </span>
                </div>

                {/* Quality panel (completed) */}
                {selectedStep.status === 'completed' && selectedStep.qualityScore != null && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={panelStyle}>
                      <div style={panelHeaderStyle}>
                        <span style={panelTitleStyle}>{t('supervisor.coordinator.quality_score')}</span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 100,
                          background: qualityTintColor(selectedStep.qualityScore),
                          color: qualityColor(selectedStep.qualityScore),
                        }}>
                          {selectedStep.qualityScore}
                        </span>
                      </div>
                      <div style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          {/* Quality donut SVG */}
                          <div style={{ width: 48, height: 48, position: 'relative', flexShrink: 0 }}>
                            <svg viewBox="0 0 36 36" width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
                              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-bg-secondary)" strokeWidth="5" />
                              <circle cx="18" cy="18" r="15.9" fill="none"
                                stroke={qualityColor(selectedStep.qualityScore)}
                                strokeWidth="5" strokeLinecap="round"
                                strokeDasharray="100" strokeDashoffset={100 - selectedStep.qualityScore}
                              />
                            </svg>
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)',
                            }}>
                              {selectedStep.qualityScore}
                            </div>
                          </div>
                          {selectedStep.summary && (
                            <div style={{ flex: 1, fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                              {selectedStep.summary}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Summary panel (completed) */}
                {selectedStep.status === 'completed' && selectedStep.summary && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={panelStyle}>
                      <div style={panelHeaderStyle}>
                        <span style={panelTitleStyle}>{t('supervisor.coordinator.summary')}</span>
                      </div>
                      <div style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.7 }}>
                          {selectedStep.summary}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analysis panel (running + completed) */}
                {(selectedStep.status === 'running' || selectedStep.status === 'completed') && selectedStep.analysis && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={panelStyle}>
                      <div style={panelHeaderStyle}>
                        <span style={panelTitleStyle}>{t('supervisor.coordinator.analysis')}</span>
                      </div>
                      <pre style={codePreviewStyle}>{selectedStep.analysis}</pre>
                    </div>
                  </div>
                )}

                {/* Pending hint */}
                {(selectedStep.status === 'pending' || selectedStep.status === 'skipped') && (
                  <div style={panelStyle}>
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-tertiary)' }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2, margin: '0 auto 10px', display: 'block' }}>
                          <circle cx="12" cy="12" r="10"/>
                          <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                          {t('supervisor.coordinator.waiting_execute')}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 4, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                          {t('supervisor.coordinator.pending_desc')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={panelStyle}>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                    Select a step to view details
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 5. Empty State ── */}
      {!hasSession && (
        <div style={panelStyle}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-tertiary)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2, margin: '0 auto 10px', display: 'block' }}>
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {t('supervisor.coordinator.no_session')}
              </div>
              <div style={{ fontSize: 11, marginTop: 4, maxWidth: 300, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                {t('supervisor.coordinator.no_session_desc')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', borderBottom: '1px solid var(--color-border-divider)',
};

const panelTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' };

const infoCardStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--color-border-divider)',
};

const infoCardLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-text-tertiary)',
};

const infoCardValueStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', marginTop: 2,
};

const infoCardSubStyle: React.CSSProperties = { fontSize: 10, color: 'var(--color-text-tertiary)' };

const btnBase: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer',
  color: 'var(--color-text-secondary)', transition: 'all 150ms',
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnBase, background: 'var(--color-text-primary)', color: '#fff', borderColor: 'var(--color-text-primary)',
};

const btnDangerStyle: React.CSSProperties = {
  ...btnBase, color: 'var(--color-accent-red)', borderColor: 'var(--color-accent-red)',
};

const btnSuccessStyle: React.CSSProperties = {
  ...btnBase, color: 'var(--color-accent-green)', borderColor: 'var(--color-accent-green)',
};

// Intent panel
const intentPanelStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 12, border: '1px solid var(--color-border-divider)', overflow: 'hidden',
};

const intentInnerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
};

const intentInputStyle: React.CSSProperties = {
  flex: 1, border: 'none', background: 'transparent', fontSize: 13,
  color: 'var(--color-text-primary)', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
};

const toolSelectStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  border: '1px solid var(--color-border-divider)', background: 'var(--color-bg-primary)',
  color: 'var(--color-text-secondary)', cursor: 'pointer', outline: 'none',
};

const autoChipOnStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 100, border: 'none', cursor: 'pointer',
  transition: 'all 150ms', background: 'var(--color-tint-completed)', color: 'var(--color-accent-green)',
};

const autoChipOffStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 100, border: 'none', cursor: 'pointer',
  transition: 'all 150ms', background: 'var(--color-tint-pending)', color: 'var(--color-accent-gray)',
};

// Clarification panel
const clarifyPanelStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)', borderRadius: 12, border: '2px solid var(--color-accent-orange)', overflow: 'hidden',
};

const clarifyBannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
  background: 'var(--color-tint-verifying)', color: 'var(--color-accent-orange)',
};

const clarifyBannerTextStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
};

const clarifyQuestionStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.6, marginBottom: 10,
};

const clarifyInputStyle: React.CSSProperties = {
  flex: 1, padding: '7px 12px', fontSize: 12, borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)', outline: 'none',
};

const clarifySendStyle: React.CSSProperties = {
  padding: '7px 14px', border: 'none', borderRadius: 8,
  background: 'var(--color-accent-orange)', color: '#fff',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
};

// Code preview
const codePreviewStyle: React.CSSProperties = {
  margin: 0, padding: '14px 16px', fontSize: 11, lineHeight: 1.6,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: "'SF Mono', Consolas, monospace",
  background: '#2C2723', color: '#D9D0C4',
  borderRadius: '0 0 12px 12px', maxHeight: 220, overflowY: 'auto',
};
