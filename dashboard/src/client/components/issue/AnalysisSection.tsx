import type { IssueAnalysis } from '@/shared/issue-types.js';

// ---------------------------------------------------------------------------
// AnalysisSection — displays structured root cause analysis
// ---------------------------------------------------------------------------

const CONFIDENCE_COLORS: Record<string, { color: string; bg: string }> = {
  high: { color: '#5A9E78', bg: '#5A9E7820' },
  medium: { color: '#B89540', bg: '#B8954020' },
  low: { color: '#C46555', bg: '#C4655520' },
};

function confidenceLabel(value: number): string {
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'medium';
  return 'low';
}

interface Props {
  analysis: IssueAnalysis;
}

export function AnalysisSection({ analysis }: Props) {
  const level = confidenceLabel(analysis.confidence);
  const conf = CONFIDENCE_COLORS[level] ?? CONFIDENCE_COLORS.low;

  return (
    <div className="space-y-3">
      {/* Root Cause */}
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Root Cause
        </div>
        <p
          className="leading-relaxed whitespace-pre-wrap"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {analysis.root_cause}
        </p>
      </div>

      {/* Impact */}
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Impact
        </div>
        <p
          className="leading-relaxed whitespace-pre-wrap"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {analysis.impact}
        </p>
      </div>

      {/* Confidence */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Confidence
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: conf.bg, color: conf.color }}
        >
          {level} ({Math.round(analysis.confidence * 100)}%)
        </span>
      </div>

      {/* Related Files */}
      {analysis.related_files.length > 0 && (
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Related Files
          </div>
          <ul className="space-y-0.5">
            {analysis.related_files.map((file, i) => (
              <li
                key={i}
                className="font-mono text-[11px] truncate"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested Approach */}
      <div>
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-1"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Suggested Approach
        </div>
        <p
          className="leading-relaxed whitespace-pre-wrap"
          style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
        >
          {analysis.suggested_approach}
        </p>
      </div>

      {/* Meta */}
      <div
        className="text-[10px] pt-1"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        Analyzed by {analysis.analyzed_by} at {new Date(analysis.analyzed_at).toLocaleString()}
      </div>
    </div>
  );
}
