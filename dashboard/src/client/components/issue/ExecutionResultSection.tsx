import type { IssueExecution } from '@/shared/execution-types.js';

// ---------------------------------------------------------------------------
// ExecutionResultSection — displays execution result summary
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  idle: '#A09D97',
  queued: '#5B8DB8',
  running: '#B89540',
  completed: '#5A9E78',
  failed: '#C46555',
  retrying: '#B89540',
};

interface Props {
  execution: IssueExecution;
}

export function ExecutionResultSection({ execution }: Props) {
  const statusColor = STATUS_COLORS[execution.status] ?? '#A09D97';
  const result = execution.result;

  return (
    <div className="space-y-2">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
        <span
          className="text-[11px] font-medium capitalize"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {execution.status}
        </span>
      </div>

      {result && (
        <>
          {/* Summary */}
          {result.summary && (
            <p
              className="leading-relaxed whitespace-pre-wrap"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}
            >
              {result.summary}
            </p>
          )}

          {/* Details row */}
          <div className="flex flex-wrap gap-3" style={{ fontSize: 'var(--font-size-xs)' }}>
            {result.commitHash && (
              <div style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Commit: </span>
                <span className="font-mono">{result.commitHash.slice(0, 8)}</span>
              </div>
            )}
            {result.prUrl && (
              <div>
                <span style={{ color: 'var(--color-text-tertiary)' }}>PR: </span>
                <a
                  href={result.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: 'var(--color-accent-blue)' }}
                >
                  {result.prUrl.replace(/^https?:\/\/[^/]+/, '')}
                </a>
              </div>
            )}
            {result.filesChanged != null && (
              <div style={{ color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Files: </span>
                {result.filesChanged}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
