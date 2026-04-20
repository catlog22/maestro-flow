import { useBoardStore } from '@/client/store/board-store.js';
import { StatusBadge } from '@/client/components/common/StatusBadge.js';
import { ProgressBar } from '@/client/components/common/ProgressBar.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { TaskCard, SelectedKanbanItem } from '@/shared/types.js';
import { LINEAR_PRIORITY_LABELS, LINEAR_PRIORITY_COLORS } from '@/shared/linear-types.js';
import { usePhaseTasks } from '@/client/hooks/usePhaseTasks.js';
import { useIssueTasks } from '@/client/hooks/useIssueTasks.js';
import { TaskPlanSection } from '@/client/components/issue/TaskPlanSection.js';

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
  if (selectedItem.type === 'issue') {
    return <IssueDetail issue={selectedItem.issue} />;
  }
  if (selectedItem.type === 'task') {
    return <TaskDetail task={selectedItem.task} />;
  }
  return <PhaseDetail phaseId={selectedItem.phaseId} />;
}

// ---------------------------------------------------------------------------
// PhaseDetail — original phase detail (unchanged logic)
// ---------------------------------------------------------------------------

function PhaseDetail({ phaseId }: { phaseId: number }) {
  const board = useBoardStore((s) => s.board);
  const phase = board?.phases.find((p) => p.phase === phaseId);
  const { tasks, loading } = usePhaseTasks(phaseId);

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

      {/* Success Criteria */}
      {phase.success_criteria.length > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Success Criteria
          </div>
          <div>
            {phase.success_criteria.map((criteria, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
              >
                <span className="text-text-tertiary shrink-0">•</span>
                <span className="flex-1 text-text-secondary">{criteria}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verification */}
      {phase.verification.status !== 'pending' && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Verification
          </div>
          <div className="space-y-[var(--spacing-1)]">
            <div className="flex items-center gap-[var(--spacing-2)] text-[length:var(--font-size-xs)]">
              <span className={`w-2 h-2 rounded-full ${phase.verification.status === 'passed' ? 'bg-[var(--color-status-completed)]' : 'bg-[var(--color-status-executing)]'}`} />
              <span className="text-text-primary capitalize">{phase.verification.status}</span>
            </div>
            {phase.verification.gaps.length > 0 && (
              <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
                {phase.verification.gaps.map((gap, i) => (
                  <div key={i} className="flex items-start gap-[var(--spacing-1)] text-[#C46555]">
                    <span className="shrink-0">⚠</span>
                    <span>{typeof gap === 'string' ? gap : gap.description ?? gap.id ?? JSON.stringify(gap)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tasks checklist */}
      <div>
        <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
          Tasks {phase.plan.task_count > 0 ? `(${phase.execution.tasks_completed}/${phase.plan.task_count})` : ''}
        </div>
        {loading ? (
          <div className="text-[length:var(--font-size-xs)] text-text-tertiary py-[var(--spacing-2)]">
            Loading tasks...
          </div>
        ) : tasks.length === 0 ? (
          phase.plan.task_ids.length > 0 ? (
            <div className="text-[length:var(--font-size-xs)] text-text-secondary">
              {phase.plan.task_ids.map((id) => (
                <div key={id} className="flex items-center gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0">
                  <span className="w-3.5 h-3.5 rounded-[4px] border-[1.5px] border-border shrink-0" />
                  <span className="text-text-primary">{id}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[length:var(--font-size-xs)] text-text-tertiary py-[var(--spacing-2)]">
              No tasks
            </div>
          )
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

      {/* Requirements */}
      {phase.requirements.length > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Requirements
          </div>
          <div>
            {phase.requirements.map((req, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
              >
                <span className="text-text-tertiary shrink-0">•</span>
                <span className="flex-1 text-text-secondary">{req}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spec Reference */}
      {phase.spec_ref && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Spec Reference
          </div>
          <span className="text-[length:var(--font-size-xs)] text-text-secondary font-mono">
            {phase.spec_ref}
          </span>
        </div>
      )}

      {/* Plan Details */}
      {(phase.plan.complexity || phase.plan.waves.length > 0) && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Plan Details
          </div>
          <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
            {phase.plan.complexity && (
              <div>Complexity: <span className="text-text-primary">{phase.plan.complexity}</span></div>
            )}
            {phase.plan.waves.length > 0 && (
              <div>Waves: <span className="text-text-primary">{phase.plan.waves.length}</span> ({phase.plan.waves.map((w, i) => {
                const count = Array.isArray(w) ? w.length : (w as { tasks: string[] }).tasks?.length ?? 0;
                return `W${i + 1}: ${count} tasks`;
              }).join(', ')})</div>
            )}
          </div>
        </div>
      )}

      {/* Execution Details */}
      {phase.execution.method && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Execution
          </div>
          <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
            <div>Method: <span className="text-text-primary">{phase.execution.method}</span></div>
            {phase.execution.commits.length > 0 && (
              <div>
                <span>Commits:</span>
                <div className="mt-[var(--spacing-1)] space-y-[var(--spacing-0-5)]">
                  {phase.execution.commits.map((commit, i) => (
                    <div key={i} className="font-mono text-[length:10px] text-text-tertiary truncate">
                      {typeof commit === 'string' ? commit : `${commit.hash.slice(0, 7)} ${commit.message}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Validation */}
      {phase.validation.status !== 'pending' && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Validation
          </div>
          <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
            <div className="flex items-center gap-[var(--spacing-2)]">
              <span className={`w-2 h-2 rounded-full ${phase.validation.status === 'passed' ? 'bg-[var(--color-status-completed)]' : 'bg-[var(--color-status-executing)]'}`} />
              <span className="text-text-primary capitalize">{phase.validation.status}</span>
            </div>
            {phase.validation.test_coverage !== null && (
              <div>Test Coverage: <span className="text-text-primary">
                {typeof phase.validation.test_coverage === 'number'
                  ? `${phase.validation.test_coverage}%`
                  : `${phase.validation.test_coverage.lines}%`}
              </span></div>
            )}
            {phase.validation.gaps.length > 0 && (
              <div className="space-y-[var(--spacing-1)]">
                {phase.validation.gaps.map((gap, i) => (
                  <div key={i} className="flex items-start gap-[var(--spacing-1)] text-[#C46555]">
                    <span className="shrink-0">⚠</span>
                    <span>{typeof gap === 'string' ? gap : gap.description ?? gap.requirement ?? JSON.stringify(gap)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* UAT */}
      {phase.uat.test_count > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            UAT
          </div>
          <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
            <div className="flex items-center gap-[var(--spacing-2)]">
              <span className="text-text-primary capitalize">{phase.uat.status}</span>
              <span className="text-text-tertiary">({phase.uat.passed}/{phase.uat.test_count} passed)</span>
            </div>
            {phase.uat.gaps.length > 0 && (
              <div className="space-y-[var(--spacing-1)]">
                {phase.uat.gaps.map((gap, i) => (
                  <div key={i} className="flex items-start gap-[var(--spacing-1)] text-[#C46555]">
                    <span className="shrink-0">⚠</span>
                    <span>{typeof gap === 'string' ? gap : gap.description ?? JSON.stringify(gap)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reflection */}
      {phase.reflection.rounds > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Reflection
          </div>
          <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
            <div>Rounds: <span className="text-text-primary">{phase.reflection.rounds}</span></div>
            {phase.reflection.strategy_adjustments.length > 0 && (
              <div>
                {phase.reflection.strategy_adjustments.map((adj, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1)] border-b border-border-divider last:border-b-0"
                  >
                    <span className="text-text-tertiary shrink-0">•</span>
                    <span>{adj}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
// TaskDetail — detail view for a task within a phase
// ---------------------------------------------------------------------------

const TASK_TYPE_COLORS: Record<string, string> = {
  feature: '#5B8DB8',
  fix: '#C46555',
  refactor: '#9178B5',
  test: '#5B8DB8',
  docs: '#A09D97',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  pending: '#A09D97',
  in_progress: '#C99B2D',
  completed: '#5A9E78',
  failed: '#C46555',
};

function TaskDetail({ task }: { task: TaskCard }) {
  const typeColor = TASK_TYPE_COLORS[task.type] ?? '#A09D97';
  const statusColor = TASK_STATUS_COLORS[task.meta.status] ?? '#A09D97';

  return (
    <div className="space-y-[var(--spacing-4)]">
      {/* ID + Title */}
      <div>
        <span className="text-[length:var(--font-size-xs)] font-mono text-text-tertiary">
          {task.id}
        </span>
        <h3 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-1)]">
          {task.title}
        </h3>
      </div>

      {/* Badges: type, priority, status, wave */}
      <div className="flex flex-wrap gap-[var(--spacing-2)]">
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
        >
          {task.type}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `${statusColor}20`, color: statusColor }}
        >
          {task.meta.status.replace('_', ' ')}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
        >
          {task.priority}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
        >
          Wave {task.meta.wave}
        </span>
      </div>

      {/* Description */}
      {task.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <p className="text-[length:var(--font-size-sm)] text-text-secondary leading-[1.6] whitespace-pre-wrap">
            {task.description}
          </p>
        </div>
      )}

      {/* Convergence Criteria */}
      {task.convergence.criteria.length > 0 && (
        <div>
          <SectionLabel>Convergence Criteria</SectionLabel>
          <div>
            {task.convergence.criteria.map((c, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
              >
                <span className="text-text-tertiary shrink-0">•</span>
                <span className="flex-1 text-text-secondary font-mono">{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files */}
      {task.files.length > 0 && (
        <div>
          <SectionLabel>Files ({task.files.length})</SectionLabel>
          <div>
            {task.files.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
              >
                <span className="font-mono text-text-primary shrink-0">{f.path}</span>
                <span className="text-text-tertiary shrink-0">{f.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Implementation Steps */}
      {task.implementation.length > 0 && (
        <div>
          <SectionLabel>Implementation</SectionLabel>
          <div>
            {task.implementation.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-2)] py-[var(--spacing-1-5)] border-b border-border-divider last:border-b-0 text-[length:var(--font-size-xs)]"
              >
                <span className="text-text-tertiary shrink-0 tabular-nums">{i + 1}.</span>
                <span className="flex-1 text-text-secondary">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {task.risks.length > 0 && (
        <div>
          <SectionLabel>Risks</SectionLabel>
          <div>
            {task.risks.map((risk, i) => (
              <div
                key={i}
                className="flex items-start gap-[var(--spacing-1)] py-[var(--spacing-1)] text-[length:var(--font-size-xs)] text-[#C46555]"
              >
                <span className="shrink-0">⚠</span>
                <span>{risk}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {task.depends_on.length > 0 && (
        <div>
          <SectionLabel>Dependencies</SectionLabel>
          <div className="flex flex-wrap gap-[var(--spacing-1)]">
            {task.depends_on.map((dep) => (
              <span key={dep} className="text-[length:var(--font-size-xs)] font-mono text-text-secondary bg-bg-hover px-[var(--spacing-1-5)] py-[1px] rounded">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueDetail — detail view for a local issue
// ---------------------------------------------------------------------------

import type { Issue } from '@/shared/issue-types.js';

const ISSUE_TYPE_COLORS: Record<string, string> = {
  bug: '#C46555',
  feature: '#5B8DB8',
  improvement: '#9178B5',
  task: '#A09D97',
};

const ISSUE_PRIORITY_COLORS: Record<string, string> = {
  urgent: '#C46555',
  high: '#B89540',
  medium: '#5B8DB8',
  low: '#A09D97',
};

const EXEC_STATUS_COLORS: Record<string, string> = {
  idle: '#A09D97',
  queued: '#5B8DB8',
  running: '#B89540',
  completed: '#5A9E78',
  failed: '#C46555',
  retrying: '#B89540',
};

function IssueDetail({ issue }: { issue: Issue }) {
  const { tasks: linkedTasks, loading: tasksLoading } = useIssueTasks(
    issue.task_refs?.length ? issue.id : null,
  );
  const typeColor = ISSUE_TYPE_COLORS[issue.type] ?? '#A09D97';
  const priorityColor = ISSUE_PRIORITY_COLORS[issue.priority] ?? '#A09D97';

  return (
    <div className="space-y-[var(--spacing-4)]">
      {/* ID + Title */}
      <div>
        <span className="text-[length:var(--font-size-xs)] font-mono text-text-tertiary">
          {issue.id}
        </span>
        <h3 className="text-[length:var(--font-size-lg)] font-[var(--font-weight-bold)] text-text-primary mt-[var(--spacing-1)]">
          {issue.title}
        </h3>
      </div>

      {/* Badges: type, priority, status */}
      <div className="flex flex-wrap gap-[var(--spacing-2)]">
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
        >
          {issue.type}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: `${priorityColor}20`, color: priorityColor }}
        >
          {issue.priority}
        </span>
        <span
          className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
          style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
        >
          {issue.status}
        </span>
      </div>

      {/* Executor */}
      {issue.executor && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Executor
          </div>
          <span className="text-[length:var(--font-size-sm)] text-text-primary">
            {issue.executor}
          </span>
        </div>
      )}

      {/* Execution status */}
      {issue.execution && issue.execution.status !== 'idle' && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Execution
          </div>
          <div className="space-y-[var(--spacing-1)]">
            <div className="flex items-center gap-[var(--spacing-2)]">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: EXEC_STATUS_COLORS[issue.execution.status] ?? '#A09D97' }}
              />
              <span className="text-[length:var(--font-size-sm)] text-text-primary">
                {issue.execution.status}
              </span>
              {issue.execution.retryCount > 0 && (
                <span className="text-[length:var(--font-size-xs)] text-text-tertiary">
                  (retry {issue.execution.retryCount})
                </span>
              )}
            </div>
            {issue.execution.startedAt && (
              <div className="text-[length:var(--font-size-xs)] text-text-tertiary">
                Started: {formatRelative(issue.execution.startedAt)}
              </div>
            )}
            {issue.execution.completedAt && (
              <div className="text-[length:var(--font-size-xs)] text-text-tertiary">
                Completed: {formatRelative(issue.execution.completedAt)}
              </div>
            )}
            {issue.execution.lastError && (
              <div className="text-[length:var(--font-size-xs)] text-[#C46555] bg-[#C4655508] rounded px-2 py-1">
                {issue.execution.lastError}
              </div>
            )}
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

      {/* Execution Plan — linked TASK files with expandable detail */}
      {linkedTasks.length > 0 && (
        <div>
          <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
            Execution Plan ({linkedTasks.length} tasks)
          </div>
          <TaskPlanSection tasks={linkedTasks} />
        </div>
      )}
      {tasksLoading && (
        <div className="text-[length:var(--font-size-xs)] text-text-tertiary">Loading tasks…</div>
      )}

      {/* Timestamps */}
      <div>
        <div className="text-[length:10px] font-[var(--font-weight-semibold)] uppercase tracking-[0.06em] text-text-tertiary mb-[var(--spacing-2)]">
          Activity
        </div>
        <div className="text-[length:var(--font-size-xs)] text-text-secondary space-y-[var(--spacing-1)]">
          <div>Created: {formatRelative(issue.created_at)}</div>
          <div>Updated: {formatRelative(issue.updated_at)}</div>
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
