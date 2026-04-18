import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Issue } from '@/shared/issue-types.js';
import { getDisplayStatus, ISSUE_DISPLAY_STATUS_COLORS } from '@/shared/constants.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { AnalysisSection } from '../issue/AnalysisSection.js';
import { SolutionSection } from '../issue/SolutionSection.js';
import { ExecutionResultSection } from '../issue/ExecutionResultSection.js';

// ---------------------------------------------------------------------------
// IssueDetailModal — 3 style variants for viewing an issue (Linear-style)
// Style 1: Right slide panel (380px, enhanced)
// Style 2: Centered two-column overlay modal
// Style 3: Full-page takeover (breadcrumb, main + sidebar)
// ---------------------------------------------------------------------------

export type DetailModalStyle = 1 | 2 | 3;

const TYPE_COLORS: Record<string, string> = {
  bug: '#C46555',
  feature: '#5B8DB8',
  improvement: '#9178B5',
  task: '#A09D97',
};

const PRI_COLORS: Record<string, string> = {
  urgent: '#C46555',
  high: '#B89540',
  medium: '#5B8DB8',
  low: '#A09D97',
};

const EXEC_COLORS: Record<string, string> = {
  idle: '#A09D97',
  queued: '#5B8DB8',
  running: '#B89540',
  completed: '#5A9E78',
  failed: '#C46555',
  retrying: '#B89540',
};

interface Props {
  issue: Issue;
  style: DetailModalStyle;
  onClose: () => void;
}

// Shared close icon
function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Shared badge
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

// Shared property row for metadata display
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const TOOL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'qwen', label: 'Qwen' },
];

const DEPTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'deep', label: 'Deep' },
];

// Pipeline progress indicator — 3-dot step visualization
function PipelineProgress({ issue }: { issue: Issue }) {
  const steps = [
    { label: 'Analyze', done: !!issue.analysis },
    { label: 'Plan', done: !!issue.solution && issue.solution.steps.length > 0 },
    { label: 'Execute', done: !!issue.execution?.result },
  ];

  return (
    <div className="flex items-center gap-1 mb-2.5">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-1">
          {i > 0 && (
            <div
              className="w-6 h-px"
              style={{ backgroundColor: step.done || steps[i - 1].done ? 'var(--color-accent-blue)' : 'var(--color-border)' }}
            />
          )}
          <div className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex items-center justify-center text-[7px]"
              style={{
                backgroundColor: step.done ? 'var(--color-accent-blue)' : 'transparent',
                border: step.done ? 'none' : '1.5px solid var(--color-border)',
                color: step.done ? 'white' : 'var(--color-text-tertiary)',
              }}
            >
              {step.done ? '\u2713' : ''}
            </span>
            <span
              className="text-[9px]"
              style={{ color: step.done ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}
            >
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Action buttons for issue lifecycle — navigate to chat after dispatching
function ActionButtons({ issue }: { issue: Issue }) {
  const navigate = useNavigate();
  const [selectedTool, setSelectedTool] = useState('gemini');
  const [selectedDepth, setSelectedDepth] = useState('standard');
  const displayStatus = getDisplayStatus(issue);
  if (displayStatus !== 'open' && displayStatus !== 'analyzing' && displayStatus !== 'planned') return null;

  const dispatchAndOpenChat = (action: Parameters<typeof sendWsMessage>[0]) => {
    sendWsMessage(action);
    navigate('/chat');
  };

  // Pipeline button label adapts to issue state
  const pipelineLabel = issue.solution && issue.solution.steps.length > 0
    ? 'Execute'
    : issue.analysis
      ? 'Continue'
      : 'Run Pipeline';

  // Single-step secondary action
  const singleStepAction = !issue.analysis
    ? { label: 'Analyze', onClick: () => dispatchAndOpenChat({ action: 'issue:analyze', issueId: issue.id, tool: selectedTool, depth: selectedDepth }) }
    : !issue.solution
      ? { label: 'Plan', onClick: () => dispatchAndOpenChat({ action: 'issue:plan', issueId: issue.id, tool: selectedTool }) }
      : { label: 'Execute', onClick: () => dispatchAndOpenChat({ action: 'execute:issue', issueId: issue.id }) };

  return (
    <div>
      <PipelineProgress issue={issue} />
      <div className="flex items-center gap-2">
        {/* Tool / Depth selectors — left side */}
        <select
          value={selectedTool}
          onChange={(e) => setSelectedTool(e.target.value)}
          className="text-[10px] px-1.5 py-1 rounded border cursor-pointer"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}
        >
          {TOOL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={selectedDepth}
          onChange={(e) => setSelectedDepth(e.target.value)}
          className="text-[10px] px-1.5 py-1 rounded border cursor-pointer"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}
        >
          {DEPTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Single-step secondary action */}
        <button
          type="button"
          onClick={singleStepAction.onClick}
          className="text-[11px] font-medium px-3.5 py-1.5 rounded-md transition-colors hover:opacity-90 border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'transparent' }}
        >
          {singleStepAction.label}
        </button>

        {/* Pipeline primary action — rightmost */}
        <button
          type="button"
          onClick={() => dispatchAndOpenChat({ action: 'issue:pipeline', issueId: issue.id, tool: selectedTool })}
          className="text-[11px] font-medium px-3.5 py-1.5 rounded-md transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent-blue)', color: 'white' }}
        >
          {pipelineLabel}
        </button>
      </div>
    </div>
  );
}

// Conditional sections for analysis/solution/execution result
function DetailSections({ issue }: { issue: Issue }) {
  return (
    <>
      {issue.analysis && (
        <PropRow label="Analysis">
          <AnalysisSection analysis={issue.analysis} />
        </PropRow>
      )}
      {issue.solution && (
        <PropRow label="Solution">
          <SolutionSection solution={issue.solution} />
        </PropRow>
      )}
      {issue.execution && issue.execution.result && (
        <PropRow label="Execution Result">
          <ExecutionResultSection execution={issue.execution} />
        </PropRow>
      )}
    </>
  );
}

export function IssueDetailModal({ issue, style, onClose }: Props) {
  const typeColor = TYPE_COLORS[issue.type] ?? '#A09D97';
  const priColor = PRI_COLORS[issue.priority] ?? '#A09D97';
  const execColor = issue.execution ? (EXEC_COLORS[issue.execution.status] ?? '#A09D97') : '#A09D97';

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Style 1: Right slide panel ───────────────────────────────────────────
  if (style === 1) {
    return (
      <>
        {/* Dim backdrop */}
        <div
          className="fixed inset-0 z-[60]"
          style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}
          onClick={onClose}
        />
        {/* Panel */}
        <div
          className="fixed right-0 top-0 bottom-0 z-[70] w-[400px] flex flex-col overflow-hidden motion-safe:animate-[slide-in-right_180ms_ease-out_both]"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            borderLeft: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Panel header */}
          <div
            className="shrink-0 flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: 'var(--color-border-divider)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-mono"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {issue.id.slice(0, 14)}
              </span>
              <Badge label={issue.type} color={typeColor} bg={`${typeColor}20`} />
              <Badge label={issue.priority} color={priColor} bg={`${priColor}20`} />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <h2
              className="font-bold leading-snug"
              style={{ fontSize: 'var(--font-size-lg)', color: 'var(--color-text-primary)' }}
            >
              {issue.title}
            </h2>

            {/* Status */}
            <PropRow label="Status">
              {(() => {
                const ds = getDisplayStatus(issue);
                const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
                return (
                  <span
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${dsColor}20`, color: dsColor }}
                  >
                    {ds.replace('_', ' ')}
                  </span>
                );
              })()}
            </PropRow>

            {issue.executor && (
              <PropRow label="Executor">
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{issue.executor}</span>
              </PropRow>
            )}

            {issue.description && (
              <PropRow label="Description">
                <p
                  className="leading-relaxed whitespace-pre-wrap"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {issue.description}
                </p>
              </PropRow>
            )}

            {/* Analysis / Solution / Execution Result */}
            <DetailSections issue={issue} />

            {issue.execution && issue.execution.status !== 'idle' && (
              <PropRow label="Execution">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: execColor }} />
                    <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                      {issue.execution.status}
                    </span>
                    {issue.execution.retryCount > 0 && (
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                        (x{issue.execution.retryCount})
                      </span>
                    )}
                  </div>
                  {issue.execution.lastError && (
                    <div
                      className="rounded px-2.5 py-2"
                      style={{ fontSize: 'var(--font-size-xs)', color: '#C46555', backgroundColor: '#C4655510', border: '1px solid #C4655530' }}
                    >
                      {issue.execution.lastError}
                    </div>
                  )}
                </div>
              </PropRow>
            )}

            <PropRow label="Activity">
              <div className="space-y-1" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                <div>Created {formatRelative(issue.created_at)}</div>
                <div>Updated {formatRelative(issue.updated_at)}</div>
              </div>
            </PropRow>
          </div>

          {/* Action Buttons — fixed at bottom */}
          <div className="shrink-0 px-5 py-3" style={{ borderTop: '1px solid var(--color-border-divider)' }}>
            <ActionButtons issue={issue} />
          </div>
        </div>
      </>
    );
  }

  // ── Style 2: Centered two-column overlay ─────────────────────────────────
  if (style === 2) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-6"
        style={{ backgroundColor: 'rgba(0,0,0,0.52)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-[880px] rounded-[var(--radius-xl)] border overflow-hidden flex max-h-[86vh] motion-safe:animate-[modal-enter_180ms_ease-out_both]"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left: main content */}
          <div
            className="flex-1 flex flex-col overflow-hidden border-r"
            style={{ borderColor: 'var(--color-border-divider)' }}
          >
            {/* Content header */}
            <div
              className="shrink-0 flex items-center justify-between px-6 py-3.5 border-b"
              style={{ borderColor: 'var(--color-border-divider)' }}
            >
              <span
                className="text-[10px] font-mono"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {issue.id}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Badges row */}
              <div className="flex items-center gap-2 mb-4">
                <Badge label={issue.type} color={typeColor} bg={`${typeColor}20`} />
                <Badge label={issue.priority} color={priColor} bg={`${priColor}20`} />
                {(() => {
                  const ds = getDisplayStatus(issue);
                  const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
                  return <Badge label={ds.replace('_', ' ')} color={dsColor} bg={`${dsColor}20`} />;
                })()}
              </div>

              <h2
                className="font-bold leading-snug mb-5"
                style={{ fontSize: 'var(--font-size-xl)', color: 'var(--color-text-primary)' }}
              >
                {issue.title}
              </h2>

              {issue.description ? (
                <p
                  className="leading-relaxed whitespace-pre-wrap"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
                >
                  {issue.description}
                </p>
              ) : (
                <p
                  className="italic"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-placeholder)' }}
                >
                  No description provided.
                </p>
              )}

              {issue.execution?.lastError && (
                <div
                  className="mt-5 rounded-[var(--radius-md)] p-3"
                  style={{ backgroundColor: '#C4655510', border: '1px solid #C4655330' }}
                >
                  <div
                    className="font-semibold mb-1"
                    style={{ fontSize: 'var(--font-size-xs)', color: '#C46555' }}
                  >
                    Execution Error
                  </div>
                  <div
                    className="whitespace-pre-wrap"
                    style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                  >
                    {issue.execution.lastError}
                  </div>
                </div>
              )}

              {/* Analysis / Solution / Execution Result */}
              <div className="mt-5 space-y-5">
                <DetailSections issue={issue} />
              </div>
            </div>
          </div>

          {/* Action Buttons — fixed at bottom of left column */}
          <div className="shrink-0 px-6 py-3" style={{ borderTop: '1px solid var(--color-border-divider)' }}>
            <ActionButtons issue={issue} />
          </div>

          {/* Right: properties sidebar */}
          <div
            className="w-[270px] shrink-0 overflow-y-auto px-5 py-5 space-y-5"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Properties
            </div>

            <PropRow label="Type">
              <Badge label={issue.type} color={typeColor} bg={`${typeColor}25`} />
            </PropRow>

            <PropRow label="Priority">
              <Badge label={issue.priority} color={priColor} bg={`${priColor}25`} />
            </PropRow>

            <PropRow label="Status">
              {(() => {
                const ds = getDisplayStatus(issue);
                const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
                return (
                  <span
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: `${dsColor}20`, color: dsColor }}
                  >
                    {ds.replace('_', ' ')}
                  </span>
                );
              })()}
            </PropRow>

            {issue.executor && (
              <PropRow label="Executor">
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{issue.executor}</span>
              </PropRow>
            )}

            {issue.execution && issue.execution.status !== 'idle' && (
              <PropRow label="Execution">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: execColor }} />
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    {issue.execution.status}
                    {issue.execution.retryCount > 0 && ` (x${issue.execution.retryCount})`}
                  </span>
                </div>
                {issue.execution.startedAt && (
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                    Started {formatRelative(issue.execution.startedAt)}
                  </div>
                )}
              </PropRow>
            )}

            <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--color-border-divider)' }}>
              <PropRow label="Created">
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{formatRelative(issue.created_at)}</span>
              </PropRow>
              <PropRow label="Updated">
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{formatRelative(issue.updated_at)}</span>
              </PropRow>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Style 3: Full-page takeover ──────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col motion-safe:animate-[slide-up_220ms_ease-out_both]"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      {/* Breadcrumb top bar */}
      <div
        className="shrink-0 flex items-center justify-between px-6 py-2.5 border-b"
        style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-card)' }}
      >
        <nav
          className="flex items-center gap-1.5"
          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
        >
          <span>Kanban</span>
          <span>›</span>
          <span>Issues</span>
          <span>›</span>
          <span
            className="font-medium truncate max-w-[360px]"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {issue.title}
          </span>
        </nav>

        <div className="flex items-center gap-2">
          <Badge label={issue.type} color={typeColor} bg={`${typeColor}20`} />
          <Badge label={issue.priority} color={priColor} bg={`${priColor}20`} />
          {(() => {
            const ds = getDisplayStatus(issue);
            const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
            return <Badge label={ds.replace('_', ' ')} color={dsColor} bg={`${dsColor}20`} />;
          })()}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-default)] border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            style={{ borderColor: 'var(--color-border)', fontSize: 'var(--font-size-xs)' }}
          >
            <CloseIcon />
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-12 py-10">
          <div className="max-w-[740px] mx-auto">
            <div
              className="font-mono mb-4"
              style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}
            >
              {issue.id}
            </div>

            <h1
              className="font-bold leading-tight mb-6"
              style={{ fontSize: 'var(--font-size-2xl)', color: 'var(--color-text-primary)' }}
            >
              {issue.title}
            </h1>

            {issue.description ? (
              <div
                className="leading-relaxed whitespace-pre-wrap"
                style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-secondary)' }}
              >
                {issue.description}
              </div>
            ) : (
              <div
                className="italic"
                style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-placeholder)' }}
              >
                No description provided.
              </div>
            )}

            {issue.execution?.lastError && (
              <div
                className="mt-8 rounded-[var(--radius-md)] p-5"
                style={{ backgroundColor: '#C4655510', border: '1px solid #C4655330' }}
              >
                <div
                  className="font-semibold mb-2"
                  style={{ fontSize: 'var(--font-size-sm)', color: '#C46555' }}
                >
                  Execution Error
                </div>
                <pre
                  className="whitespace-pre-wrap leading-relaxed"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}
                >
                  {issue.execution.lastError}
                </pre>
              </div>
            )}

            {/* Analysis / Solution / Execution Result */}
            <div className="mt-8 space-y-6">
              <DetailSections issue={issue} />
            </div>
          </div>
        </div>

        {/* Action Buttons — fixed at bottom */}
        <div className="shrink-0 px-12 py-3" style={{ borderTop: '1px solid var(--color-border-divider)' }}>
          <div className="max-w-[740px] mx-auto">
            <ActionButtons issue={issue} />
          </div>
        </div>
        </div>

        {/* Right sidebar */}
        <div
          className="w-[280px] shrink-0 border-l overflow-y-auto px-6 py-8 space-y-6"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}
        >
          <PropRow label="Type">
            <Badge label={issue.type} color={typeColor} bg={`${typeColor}20`} />
          </PropRow>

          <PropRow label="Priority">
            <Badge label={issue.priority} color={priColor} bg={`${priColor}20`} />
          </PropRow>

          <PropRow label="Status">
            {(() => {
              const ds = getDisplayStatus(issue);
              const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
              return (
                <span
                  className="text-[11px] font-medium px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: `${dsColor}20`, color: dsColor }}
                >
                  {ds.replace('_', ' ')}
                </span>
              );
            })()}
          </PropRow>

          {issue.executor && (
            <PropRow label="Executor">
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>{issue.executor}</span>
            </PropRow>
          )}

          {issue.execution && issue.execution.status !== 'idle' && (
            <PropRow label="Execution">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: execColor }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                    {issue.execution.status}
                  </span>
                </div>
                {issue.execution.retryCount > 0 && (
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                    {issue.execution.retryCount} retry attempt{issue.execution.retryCount > 1 ? 's' : ''}
                  </div>
                )}
                {issue.execution.startedAt && (
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                    Started {formatRelative(issue.execution.startedAt)}
                  </div>
                )}
                {issue.execution.completedAt && (
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                    Completed {formatRelative(issue.execution.completedAt)}
                  </div>
                )}
              </div>
            </PropRow>
          )}

          <div className="pt-4 border-t space-y-4" style={{ borderColor: 'var(--color-border-divider)' }}>
            <PropRow label="Created">
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                {formatRelative(issue.created_at)}
              </span>
            </PropRow>
            <PropRow label="Updated">
              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                {formatRelative(issue.updated_at)}
              </span>
            </PropRow>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
