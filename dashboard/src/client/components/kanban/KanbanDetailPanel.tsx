import { useState, useEffect } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { StatusBadge } from '@/client/components/common/StatusBadge.js';
import { ProgressBar } from '@/client/components/common/ProgressBar.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { TaskCard, SelectedKanbanItem } from '@/shared/types.js';
import { LINEAR_PRIORITY_LABELS, LINEAR_PRIORITY_COLORS } from '@/shared/linear-types.js';

// ---------------------------------------------------------------------------
// KanbanDetailPanel — phase or linear issue detail for the right-side panel
// ---------------------------------------------------------------------------

interface KanbanDetailPanelProps {
  selectedItem: SelectedKanbanItem;
}

export function KanbanDetailPanel({ selectedItem }: KanbanDetailPanelProps) {
  if (selectedItem.type === 'linearIssue') {
    return <LinearIssueDetail issue={selectedItem.issue} />;
  }
  return <PhaseDetail phaseId={selectedItem.phaseId} />;
}

// ---------------------------------------------------------------------------
// PhaseDetail — original phase detail (unchanged logic)
// ---------------------------------------------------------------------------

function PhaseDetail({ phaseId }: { phaseId: number }) {
  const board = useBoardStore((s) => s.board);
  const phase = board?.phases.find((p) => p.phase === phaseId);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTasks([]);

    fetch(`/api/phases/${phaseId}/tasks`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TaskCard[]) => {
        if (!cancelled) {
          setTasks(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [phaseId]);

  if (!phase) {
    return (
      <div className="text-[length:var(--font-size-sm)] text-text-secondary">
        Phase not found
      </div>
    );
  }

  const { tasks_completed, tasks_total, current_wave } = phase.execution;
  const color = STATUS_COLORS[phase.status];

  return (
    <div className="space-y-[var(--spacing-4)]">
      {/* Title */}
      <h3 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-bold)] text-text-primary">
        {phase.title}
      </h3>

      {/* Meta tags */}
      <div className="flex flex-wrap gap-[var(--spacing-2)]">
        <StatusBadge status={phase.status} />
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
        >
          P-{String(phase.phase).padStart(2, '0')}
        </span>
        {phase.status === 'executing' && current_wave > 0 && (
          <span
            className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
            style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
          >
            Wave {current_wave}
          </span>
        )}
      </div>

      {/* Goal */}
      <div>
        <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
          Goal
        </div>
        <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6]">
          {phase.goal}
        </p>
      </div>

      {/* Progress */}
      {tasks_total > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Progress
          </div>
          <ProgressBar completed={tasks_completed} total={tasks_total} color={color} />
        </div>
      )}

      {/* Tasks checklist */}
      <div>
        <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
          Tasks
        </div>
        {loading ? (
          <div className="text-[length:var(--font-size-xs)] text-text-tertiary py-[var(--spacing-2)]">
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-[length:var(--font-size-xs)] text-text-tertiary py-[var(--spacing-2)]">
            No tasks
          </div>
        ) : (
          <div>
            {tasks.map((task) => {
              const isDone = task.meta.status === 'completed';
              const statusColor = isDone
                ? 'var(--color-status-completed)'
                : task.meta.status === 'in_progress'
                  ? 'var(--color-status-executing)'
                  : 'var(--color-text-tertiary)';
              const statusLabel = isDone
                ? 'Done'
                : task.meta.status === 'in_progress'
                  ? 'Running'
                  : task.meta.status === 'failed'
                    ? 'Failed'
                    : 'Queued';

              return (
                <div
                  key={task.id}
                  className="flex items-center gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
                >
                  <span
                    className={[
                      'w-3.5 h-3.5 rounded-[4px] border-[1.5px] shrink-0',
                      isDone
                        ? 'bg-[var(--color-status-completed)] border-[var(--color-status-completed)]'
                        : 'border-border',
                    ].join(' ')}
                  />
                  <span className="flex-1 text-text-primary">{task.title}</span>
                  <span
                    className="text-[length:10px] font-[var(--font-weight-medium)] shrink-0"
                    style={{ color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Activity log */}
      <div>
        <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
          Activity
        </div>
        <div className="text-[length:var(--font-size-xs)] text-text-secondary">
          {phase.execution.started_at && (
            <div className="flex gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider">
              <span className="font-mono text-[length:10px] text-text-tertiary whitespace-nowrap min-w-[48px]">
                {formatRelative(phase.execution.started_at)}
              </span>
              <span className="flex-1">Phase execution started</span>
            </div>
          )}
          {current_wave > 0 && (
            <div className="flex gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider">
              <span className="font-mono text-[length:10px] text-text-tertiary whitespace-nowrap min-w-[48px]">
                {formatRelative(phase.updated_at)}
              </span>
              <span className="flex-1">Wave {current_wave} active ({tasks_total - tasks_completed} remaining)</span>
            </div>
          )}
          {phase.execution.completed_at && (
            <div className="flex gap-[var(--spacing-2)] py-[var(--spacing-1-5)]">
              <span className="font-mono text-[length:10px] text-text-tertiary whitespace-nowrap min-w-[48px]">
                {formatRelative(phase.execution.completed_at)}
              </span>
              <span className="flex-1">Phase completed</span>
            </div>
          )}
          {!phase.execution.started_at && !phase.execution.completed_at && (
            <div className="py-[var(--spacing-1-5)] text-text-tertiary italic">
              No activity yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LinearIssueDetail — detail view for a Linear issue
// ---------------------------------------------------------------------------

import type { LinearIssue } from '@/shared/linear-types.js';

function LinearIssueDetail({ issue }: { issue: LinearIssue }) {
  const priorityColor = LINEAR_PRIORITY_COLORS[issue.priority];

  return (
    <div className="space-y-[var(--spacing-4)]">
      {/* Identifier + Title */}
      <div>
        <span className="text-[length:var(--font-size-xs)] font-mono text-text-tertiary">
          {issue.identifier}
        </span>
        <h3 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-1)]">
          {issue.title}
        </h3>
      </div>

      {/* Status + Priority badges */}
      <div className="flex flex-wrap gap-[var(--spacing-2)]">
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `#${issue.state.color}20`, color: `#${issue.state.color}` }}
        >
          {issue.state.name}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
        >
          {LINEAR_PRIORITY_LABELS[issue.priority]}
        </span>
      </div>

      {/* Assignee */}
      {issue.assignee && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Assignee
          </div>
          <div className="flex items-center gap-[var(--spacing-2)]">
            <span className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-secondary">
              {issue.assignee.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="text-[length:var(--font-size-sm)] text-text-primary">
              {issue.assignee.displayName}
            </span>
          </div>
        </div>
      )}

      {/* Labels */}
      {issue.labels.length > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Labels
          </div>
          <div className="flex flex-wrap gap-[var(--spacing-1)]">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="text-[length:var(--font-size-xs)] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `#${label.color}20`, color: `#${label.color}` }}
              >
                {label.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {issue.description && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Description
          </div>
          <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6] whitespace-pre-wrap">
            {issue.description}
          </p>
        </div>
      )}

      {/* Open in Linear link */}
      <div>
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-accent-blue hover:underline"
        >
          Open in Linear
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
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
