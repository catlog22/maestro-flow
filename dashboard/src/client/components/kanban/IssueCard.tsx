import { useState, useCallback } from 'react';
import type { Issue } from '@/shared/issue-types.js';
import type { AgentType } from '@/shared/agent-types.js';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { getDisplayStatus, ISSUE_DISPLAY_STATUS_COLORS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// IssueCard — kanban card with execution controls
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  bug: '#C46555',
  feature: '#5B8DB8',
  improvement: '#9178B5',
  task: '#A09D97',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#C46555',
  high: '#B89540',
  medium: '#5B8DB8',
  low: '#A09D97',
};

const EXECUTOR_OPTIONS: { value: AgentType; label: string }[] = [
  { value: 'claude-code', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
];

const EXECUTION_STATUS_ICONS: Record<string, { icon: string; color: string; animate?: boolean }> = {
  running: { icon: '●', color: '#B89540', animate: true },
  queued: { icon: '◷', color: '#5B8DB8' },
  completed: { icon: '✓', color: '#5A9E78' },
  failed: { icon: '✕', color: '#C46555' },
  retrying: { icon: '↻', color: '#B89540', animate: true },
};

interface IssueCardProps {
  issue: Issue;
  selected: boolean;
  onSelect: () => void;
  batchMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (issueId: string) => void;
}

export function IssueCard({ issue, selected, onSelect, batchMode, isChecked, onToggleCheck }: IssueCardProps) {
  const typeColor = TYPE_COLORS[issue.type] ?? '#A09D97';
  const priorityColor = PRIORITY_COLORS[issue.priority] ?? '#A09D97';
  const [hovered, setHovered] = useState(false);
  // Local executor state to avoid race condition between dropdown change and execute click
  const [localExecutor, setLocalExecutor] = useState<AgentType>(issue.executor ?? 'claude-code');

  const isRunning = useExecutionStore((s) => s.isIssueRunning(issue.id));
  const openCliPanel = useExecutionStore((s) => s.openCliPanel);
  const updateIssue = useIssueStore((s) => s.updateIssue);

  const executionStatus = issue.execution?.status;
  const statusInfo = executionStatus ? EXECUTION_STATUS_ICONS[executionStatus] : null;

  const handleExecute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    sendWsMessage({
      action: 'execute:issue',
      issueId: issue.id,
      executor: localExecutor,
    });
  }, [issue.id, localExecutor]);

  const handleExecutorChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newExecutor = e.target.value as AgentType;
    setLocalExecutor(newExecutor);
    void updateIssue(issue.id, { executor: newExecutor });
  }, [issue.id, updateIssue]);

  const handleCheckToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCheck?.(issue.id);
  }, [issue.id, onToggleCheck]);

  const handleRunningClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    openCliPanel(issue.id);
  }, [issue.id, openCliPanel]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <article role="listitem">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${issue.title}. Type: ${issue.type}. Priority: ${issue.priority}`}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={[
          'group/card relative rounded-[10px] px-[var(--spacing-4)] py-[var(--spacing-3)] space-y-[var(--spacing-2)] cursor-pointer',
          'transition-all duration-[var(--duration-normal)] ease-[var(--ease-spring)]',
          'hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-0.5',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
          'active:scale-[0.98] active:shadow-sm active:duration-[var(--duration-fast)]',
          'bg-bg-card motion-safe:animate-[card-enter_200ms_ease-out_both]',
          selected ? 'shadow-[inset_0_0_0_2px_var(--color-accent-blue)]' : 'shadow-[var(--shadow-sm)]',
        ].join(' ')}
      >
        {/* Row 1: Checkbox (inline) + Type badge + execution status + priority badge */}
        <div className="flex items-center gap-[var(--spacing-1)]">
          {/* Checkbox — inline, no overlap */}
          {(batchMode || hovered) && (
            <div
              onClick={handleCheckToggle}
              className={[
                'shrink-0 w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[9px] transition-all duration-100 cursor-pointer',
                isChecked
                  ? 'bg-accent-blue border-accent-blue text-white scale-100'
                  : 'border-border hover:border-text-secondary',
              ].join(' ')}
              style={isChecked ? { backgroundColor: 'var(--color-accent-blue)', borderColor: 'var(--color-accent-blue)' } : {}}
            >
              {isChecked && '✓'}
            </div>
          )}

          <span
            className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] px-2 py-[var(--spacing-0-5)] rounded-full"
            style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
          >
            {issue.type}
          </span>

          {/* Path badge */}
          {issue.path && (
            <span
              className="text-[10px] font-medium px-1.5 py-[var(--spacing-0-5)] rounded-full"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}
            >
              {issue.path}
            </span>
          )}

          {/* Solution indicator */}
          {issue.solution && (
            <span
              className="text-[10px] font-medium px-1.5 py-[var(--spacing-0-5)] rounded-full"
              style={{ backgroundColor: '#9178B520', color: '#9178B5' }}
            >
              {issue.solution.steps.length} steps
            </span>
          )}

          {/* Execution status indicator */}
          {statusInfo && (
            <span
              className={[
                'text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)]',
                statusInfo.animate ? 'animate-pulse' : '',
              ].join(' ')}
              style={{ color: statusInfo.color }}
              title={`Execution: ${executionStatus}`}
              onClick={isRunning ? handleRunningClick : undefined}
            >
              {statusInfo.icon}
            </span>
          )}

          <span
            className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] px-2 py-[var(--spacing-0-5)] rounded-full ml-auto"
            style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
          >
            {issue.priority}
          </span>
        </div>

        {/* Row 2: Title */}
        <h4 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary leading-snug line-clamp-2">
          {issue.title}
        </h4>

        {/* Row 3: Status + executor + execute button */}
        <div className="flex items-center justify-between">
          {(() => {
            const ds = getDisplayStatus(issue);
            const dsColor = ISSUE_DISPLAY_STATUS_COLORS[ds];
            return (
              <span className="text-[length:10px]" style={{ color: dsColor }}>
                {ds.replace('_', ' ')}
              </span>
            );
          })()}

          <div className="flex items-center gap-[var(--spacing-1)]">
            {/* Executor selector (compact) */}
            <select
              value={localExecutor}
              onChange={handleExecutorChange}
              onClick={(e) => e.stopPropagation()}
              className={[
                'text-[length:10px] bg-transparent border border-border rounded px-1 py-0.5 text-text-secondary cursor-pointer',
                'transition-opacity',
                hovered || selected ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
              aria-label="Select executor"
            >
              {EXECUTOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Execute button */}
            {!isRunning && issue.status !== 'resolved' && issue.status !== 'closed' && (
              <button
                type="button"
                onClick={handleExecute}
                className={[
                  'w-5 h-5 flex items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:text-accent-blue hover:bg-bg-hover transition-all',
                  hovered || selected ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                aria-label="Execute issue"
                title="Execute issue"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </button>
            )}

            {/* Running indicator — click to open CLI panel */}
            {isRunning && (
              <button
                type="button"
                onClick={handleRunningClick}
                className="w-5 h-5 flex items-center justify-center rounded-[var(--radius-sm)] text-[#B89540] hover:bg-bg-hover transition-all"
                aria-label="View execution output"
                title="View execution output"
              >
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
