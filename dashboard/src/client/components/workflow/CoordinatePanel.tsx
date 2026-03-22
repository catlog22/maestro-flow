import { useState, useCallback } from 'react';
import { useCoordinateStore } from '@/client/store/coordinate-store.js';
import type { CoordinateStep, CoordinateStepStatus } from '@/shared/coordinate-types.js';
import PlayIcon from 'lucide-react/dist/esm/icons/play.js';
import SquareIcon from 'lucide-react/dist/esm/icons/square.js';
import RotateCcwIcon from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import CheckCircleIcon from 'lucide-react/dist/esm/icons/check-circle.js';
import XCircleIcon from 'lucide-react/dist/esm/icons/x-circle.js';
import MinusIcon from 'lucide-react/dist/esm/icons/minus.js';
import CircleIcon from 'lucide-react/dist/esm/icons/circle.js';
import LoaderIcon from 'lucide-react/dist/esm/icons/loader.js';
import SendIcon from 'lucide-react/dist/esm/icons/send.js';
import MessageCircleIcon from 'lucide-react/dist/esm/icons/message-circle.js';

// ---------------------------------------------------------------------------
// CoordinatePanel -- control bar + chain progress + step detail
// ---------------------------------------------------------------------------

const TOOL_OPTIONS = ['claude', 'gemini', 'codex', 'qwen', 'opencode'] as const;

function StepStatusIcon({ status }: { status: CoordinateStepStatus }) {
  switch (status) {
    case 'running':
      return <LoaderIcon size={14} className="animate-spin" style={{ color: 'var(--color-accent-blue)' }} />;
    case 'completed':
      return <CheckCircleIcon size={14} style={{ color: 'var(--color-accent-green)' }} />;
    case 'failed':
      return <XCircleIcon size={14} style={{ color: 'var(--color-accent-red)' }} />;
    case 'skipped':
      return <MinusIcon size={14} style={{ color: 'var(--color-text-tertiary)' }} />;
    case 'pending':
    default:
      return <CircleIcon size={14} style={{ color: 'var(--color-text-tertiary)' }} />;
  }
}

function StepItem({
  step,
  isSelected,
  onSelect,
}: {
  step: CoordinateStep;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-[var(--spacing-2)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-left transition-colors"
      style={{
        background: isSelected ? 'var(--color-bg-tertiary)' : 'transparent',
      }}
    >
      <StepStatusIcon status={step.status} />
      <span
        className="flex-1 text-[length:var(--font-size-sm)] truncate"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {step.cmd}
        {step.args ? ` ${step.args}` : ''}
      </span>
      {step.qualityScore != null && (
        <span
          className="text-[length:var(--font-size-xs)] shrink-0 px-[var(--spacing-1)] rounded"
          style={{
            color: '#fff',
            background:
              step.qualityScore >= 70
                ? 'var(--color-accent-green)'
                : step.qualityScore >= 40
                  ? 'var(--color-accent-orange, #B89540)'
                  : 'var(--color-accent-red)',
          }}
        >
          {step.qualityScore}
        </span>
      )}
    </button>
  );
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  analyzing_state: 'Analyzing State…',
  classifying: 'Classifying…',
  classifying_intent: 'Classifying Intent…',
  awaiting_clarification: 'Needs Clarification',
  running: 'Running',
  reviewing: 'Reviewing…',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

export function CoordinatePanel() {
  const session = useCoordinateStore((s) => s.session);
  const selectedStepIndex = useCoordinateStore((s) => s.selectedStepIndex);
  const clarificationQuestion = useCoordinateStore((s) => s.clarificationQuestion);
  const start = useCoordinateStore((s) => s.start);
  const stop = useCoordinateStore((s) => s.stop);
  const resume = useCoordinateStore((s) => s.resume);
  const selectStep = useCoordinateStore((s) => s.selectStep);
  const sendClarification = useCoordinateStore((s) => s.sendClarification);

  const [intent, setIntent] = useState('');
  const [tool, setTool] = useState<string>('claude');
  const [autoMode, setAutoMode] = useState(true);
  const [clarifyResponse, setClarifyResponse] = useState('');

  const isRunning = session?.status === 'running' || session?.status === 'classifying' || session?.status === 'analyzing_state' || session?.status === 'classifying_intent' || session?.status === 'reviewing';
  const isAwaitingClarification = session?.status === 'awaiting_clarification';
  const isIdle = !session || session.status === 'idle' || session.status === 'completed' || session.status === 'failed';

  const handleStart = useCallback(() => {
    if (!intent.trim()) return;
    start(intent.trim(), tool, autoMode);
    setIntent('');
  }, [intent, tool, autoMode, start]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleStart();
      }
    },
    [handleStart],
  );

  const selectedStep =
    selectedStepIndex != null ? session?.steps.find((s) => s.index === selectedStepIndex) ?? null : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control Bar */}
      <div
        className="shrink-0 flex items-center gap-[var(--spacing-3)] px-[var(--spacing-4)] py-[var(--spacing-3)]"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter intent..."
          disabled={isRunning}
          className="flex-1 px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] outline-none"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
          }}
        />

        <select
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          disabled={isRunning}
          className="px-[var(--spacing-2)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)]"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {TOOL_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label
          className="flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-xs)] cursor-pointer select-none"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(e) => setAutoMode(e.target.checked)}
            disabled={isRunning}
          />
          Auto
        </label>

        {isIdle ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={!intent.trim()}
            className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] font-medium transition-opacity disabled:opacity-40"
            style={{
              background: 'var(--color-accent-green)',
              color: '#fff',
            }}
          >
            <PlayIcon size={14} />
            Start
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] font-medium"
            style={{
              background: 'var(--color-accent-red)',
              color: '#fff',
            }}
          >
            <SquareIcon size={14} />
            Stop
          </button>
        )}

        {session?.status === 'paused' && (
          <button
            type="button"
            onClick={() => resume()}
            className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-2)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] font-medium"
            style={{
              background: 'var(--color-accent-blue)',
              color: '#fff',
            }}
          >
            <RotateCcwIcon size={14} />
            Resume
          </button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chain progress list */}
        <div
          className="w-[280px] shrink-0 flex flex-col overflow-y-auto"
          style={{ borderRight: '1px solid var(--color-border)' }}
        >
          {/* Chain header */}
          {session && (
            <div
              className="px-[var(--spacing-4)] py-[var(--spacing-3)] shrink-0"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-[var(--spacing-2)]">
                <div
                  className="text-[length:var(--font-size-sm)] font-medium"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {session.chainName ?? 'Classifying...'}
                </div>
                <span
                  className="text-[length:var(--font-size-xs)] px-[var(--spacing-2)] py-px rounded-full"
                  style={{
                    background: isRunning ? 'var(--color-accent-blue)' : session.status === 'awaiting_clarification' ? 'var(--color-accent-orange, #B89540)' : session.status === 'completed' ? 'var(--color-accent-green)' : session.status === 'failed' ? 'var(--color-accent-red)' : 'var(--color-bg-tertiary)',
                    color: isRunning || session.status === 'awaiting_clarification' || session.status === 'completed' || session.status === 'failed' ? '#fff' : 'var(--color-text-secondary)',
                  }}
                >
                  {STATUS_LABELS[session.status] ?? session.status}
                </span>
              </div>
              <div
                className="text-[length:var(--font-size-xs)] mt-[var(--spacing-1)]"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Step {session.currentStep + 1} / {session.steps.length || '?'}
                {session.avgQuality != null && ` | Quality: ${session.avgQuality}`}
              </div>
            </div>
          )}

          {/* Clarification dialog */}
          {clarificationQuestion && session && (
            <div
              className="px-[var(--spacing-4)] py-[var(--spacing-3)] shrink-0 flex flex-col gap-[var(--spacing-2)]"
              style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
            >
              <div className="flex items-start gap-[var(--spacing-2)]">
                <MessageCircleIcon size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-accent-orange, #B89540)' }} />
                <span className="text-[length:var(--font-size-sm)]" style={{ color: 'var(--color-text-primary)' }}>
                  {clarificationQuestion}
                </span>
              </div>
              <div className="flex items-center gap-[var(--spacing-2)]">
                <input
                  type="text"
                  value={clarifyResponse}
                  onChange={(e) => setClarifyResponse(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && clarifyResponse.trim()) {
                      sendClarification(session.sessionId, clarifyResponse.trim());
                      setClarifyResponse('');
                    }
                  }}
                  placeholder="Type your response..."
                  className="flex-1 px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] text-[length:var(--font-size-sm)] outline-none"
                  style={{
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (clarifyResponse.trim()) {
                      sendClarification(session.sessionId, clarifyResponse.trim());
                      setClarifyResponse('');
                    }
                  }}
                  disabled={!clarifyResponse.trim()}
                  className="p-[var(--spacing-1)] rounded-[var(--radius-sm)] transition-opacity disabled:opacity-40"
                  style={{ color: 'var(--color-accent-blue)' }}
                >
                  <SendIcon size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Step list */}
          <div className="flex-1 overflow-y-auto p-[var(--spacing-2)]">
            {session?.steps.map((step) => (
              <StepItem
                key={step.index}
                step={step}
                isSelected={selectedStepIndex === step.index}
                onSelect={() => selectStep(step.index)}
              />
            ))}
            {!session && (
              <div
                className="text-[length:var(--font-size-sm)] text-center py-[var(--spacing-6)]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                No active session
              </div>
            )}
          </div>
        </div>

        {/* Step detail */}
        <div className="flex-1 overflow-y-auto p-[var(--spacing-4)]">
          {selectedStep ? (
            <div className="flex flex-col gap-[var(--spacing-3)]">
              <div className="flex items-center gap-[var(--spacing-2)]">
                <StepStatusIcon status={selectedStep.status} />
                <span
                  className="text-[length:var(--font-size-base)] font-medium"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {selectedStep.cmd}
                </span>
                {selectedStep.args && (
                  <span
                    className="text-[length:var(--font-size-sm)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {selectedStep.args}
                  </span>
                )}
              </div>

              {selectedStep.qualityScore != null && (
                <div className="flex items-center gap-[var(--spacing-2)]">
                  <span
                    className="text-[length:var(--font-size-xs)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    Quality
                  </span>
                  <span
                    className="text-[length:var(--font-size-sm)] font-medium px-[var(--spacing-2)] py-px rounded"
                    style={{
                      color: '#fff',
                      background:
                        selectedStep.qualityScore >= 70
                          ? 'var(--color-accent-green)'
                          : selectedStep.qualityScore >= 40
                            ? 'var(--color-accent-orange, #B89540)'
                            : 'var(--color-accent-red)',
                    }}
                  >
                    {selectedStep.qualityScore}/100
                  </span>
                </div>
              )}

              {selectedStep.summary && (
                <div>
                  <div
                    className="text-[length:var(--font-size-xs)] font-medium mb-[var(--spacing-1)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    Summary
                  </div>
                  <div
                    className="text-[length:var(--font-size-sm)] rounded-[var(--radius-sm)] p-[var(--spacing-3)]"
                    style={{
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-bg-secondary)',
                    }}
                  >
                    {selectedStep.summary}
                  </div>
                </div>
              )}

              {selectedStep.analysis && (
                <div>
                  <div
                    className="text-[length:var(--font-size-xs)] font-medium mb-[var(--spacing-1)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    Analysis
                  </div>
                  <pre
                    className="text-[length:var(--font-size-xs)] rounded-[var(--radius-sm)] p-[var(--spacing-3)] overflow-x-auto whitespace-pre-wrap"
                    style={{
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-bg-secondary)',
                    }}
                  >
                    {selectedStep.analysis}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div
              className="text-[length:var(--font-size-sm)] text-center py-[var(--spacing-6)]"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {session ? 'Select a step to view details' : 'Start a coordinate session'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
