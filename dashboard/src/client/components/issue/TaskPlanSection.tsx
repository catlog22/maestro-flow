import { useState } from 'react';
import type { TaskCard } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// TaskPlanSection — displays linked TASK files with expandable detail
// Replaces SolutionSection for issues that have task_refs
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending: '#A09D97',
  in_progress: '#B89540',
  completed: '#5A9E78',
  failed: '#C46555',
};

interface Props {
  tasks: TaskCard[];
}

export function TaskPlanSection({ tasks }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {tasks.map((task) => {
        const isOpen = expanded.has(task.id);
        const statusColor = STATUS_COLORS[task.meta.status] ?? '#A09D97';

        return (
          <div key={task.id}>
            {/* Summary row — clickable to expand */}
            <button
              type="button"
              onClick={() => toggle(task.id)}
              className="w-full flex items-center gap-2 py-1.5 px-1 rounded text-left transition-colors hover:bg-[var(--color-bg-hover)]"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: statusColor }}
              />
              <span
                className="shrink-0 font-mono"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
              >
                {task.id}
              </span>
              <span
                className="truncate flex-1"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
              >
                {task.title}
              </span>
              {task.meta.wave > 0 && (
                <span
                  className="shrink-0"
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
                >
                  W{task.meta.wave}
                </span>
              )}
              <span
                className="shrink-0"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
              >
                {isOpen ? '▾' : '▸'}
              </span>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div
                className="ml-5 pl-3 py-2 space-y-2"
                style={{ borderLeft: '2px solid var(--color-border-divider)' }}
              >
                {/* Description */}
                {task.description && (
                  <p
                    className="whitespace-pre-wrap leading-relaxed"
                    style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                  >
                    {task.description}
                  </p>
                )}

                {/* Convergence criteria */}
                {task.convergence.criteria.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Convergence
                    </div>
                    <ul className="space-y-0.5">
                      {task.convergence.criteria.map((c, i) => (
                        <li
                          key={i}
                          className="font-mono"
                          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                        >
                          • {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Files */}
                {task.files.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Files
                    </div>
                    <ul className="space-y-0.5">
                      {task.files.map((f, i) => (
                        <li
                          key={i}
                          className="font-mono truncate"
                          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                          title={f.path}
                        >
                          {f.action ? `${f.action} ` : ''}{f.path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Implementation steps */}
                {task.implementation.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Implementation
                    </div>
                    <ol className="space-y-0.5 list-decimal list-inside">
                      {task.implementation.map((step, i) => (
                        <li
                          key={i}
                          style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                        >
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Risks */}
                {task.risks.length > 0 && (
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Risks
                    </div>
                    <ul className="space-y-0.5">
                      {task.risks.map((r, i) => (
                        <li
                          key={i}
                          style={{ fontSize: 'var(--font-size-xs)', color: '#C46555' }}
                        >
                          ⚠ {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Dependencies */}
                {task.depends_on.length > 0 && (
                  <div
                    className="font-mono"
                    style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}
                  >
                    Depends on: {task.depends_on.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
