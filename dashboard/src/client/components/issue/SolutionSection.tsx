import type { IssueSolution } from '@/shared/issue-types.js';

// ---------------------------------------------------------------------------
// SolutionSection — displays pre-planned execution steps
// ---------------------------------------------------------------------------

interface Props {
  solution: IssueSolution;
}

export function SolutionSection({ solution }: Props) {
  return (
    <div className="space-y-3">
      {/* Steps table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ fontSize: 'var(--font-size-xs)' }}>
          <thead>
            <tr
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <th className="py-1 pr-2 w-6">#</th>
              <th className="py-1 pr-2">Target</th>
              <th className="py-1 pr-2">Description</th>
              <th className="py-1">Verification</th>
            </tr>
          </thead>
          <tbody>
            {solution.steps.map((step, i) => (
              <tr
                key={i}
                className="border-t"
                style={{ borderColor: 'var(--color-border-divider)' }}
              >
                <td
                  className="py-1.5 pr-2 font-mono"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {i + 1}
                </td>
                <td
                  className="py-1.5 pr-2 font-mono truncate max-w-[120px]"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={step.target}
                >
                  {step.target ?? '-'}
                </td>
                <td
                  className="py-1.5 pr-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {step.description}
                </td>
                <td
                  className="py-1.5"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {step.verification ?? '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context */}
      {solution.context && (
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Context
          </div>
          <p
            className="leading-relaxed whitespace-pre-wrap"
            style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
          >
            {solution.context}
          </p>
        </div>
      )}

      {/* Meta */}
      {solution.planned_by && (
        <div
          className="text-[10px] pt-1"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Planned by {solution.planned_by}
          {solution.planned_at && ` at ${new Date(solution.planned_at).toLocaleString()}`}
        </div>
      )}
    </div>
  );
}
