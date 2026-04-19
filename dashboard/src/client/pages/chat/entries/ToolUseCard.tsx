import { useState } from 'react';
import type { ToolUseEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ToolUseCard -- compact inline bar matching chat.html msg-tool pattern
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ToolUseEntry['status'], { color: string; label: string }> = {
  pending:   { color: 'var(--color-text-tertiary)',   label: 'Pending' },
  running:   { color: 'var(--color-accent-yellow)',   label: 'Running' },
  completed: { color: 'var(--color-accent-green)',    label: 'Done' },
  failed:    { color: 'var(--color-accent-red, #D05454)', label: 'Failed' },
};

/** Extract a short display path from tool input */
function getToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const p = input.file_path ?? input.path ?? input.command;
  return typeof p === 'string' ? p : null;
}

/** SVG icons matching chat.html reference tool icons */
function ToolIcon({ name }: { name: string }) {
  const style = { width: 11, height: 11, color: 'var(--color-text-tertiary)', flexShrink: 0 };
  if (name === 'Read' || name === 'Glob' || name === 'Grep') {
    return (
      <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    return (
      <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (name === 'Bash') {
    return (
      <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  // Default wrench icon for other tools
  return (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function ToolUseCard({ entry }: { entry: ToolUseEntry }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_LABELS[entry.status];
  const toolPath = getToolPath(entry.input);
  const displayName = entry.name === 'unknown' ? 'Tool Call' : entry.name;

  return (
    <div className="contain-content">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[5px] w-full rounded-[5px] cursor-pointer transition-opacity hover:opacity-80"
        style={{
          padding: '4px 8px',
          backgroundColor: 'var(--color-bg-secondary)',
          margin: '3px 0',
          fontSize: '10px',
          color: 'var(--color-text-secondary)',
          border: 'none',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <ToolIcon name={displayName} />
        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{displayName}</span>
        {toolPath && (
          <span className="truncate font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {toolPath}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[9px] font-semibold" style={{ color: status.color }}>
          {status.label}
        </span>
      </button>
      {open && (
        <div className="mt-[2px] space-y-[4px]">
          {entry.input && Object.keys(entry.input).length > 0 && (
            <pre
              className="text-[11px] font-mono rounded-[6px] p-[6px_8px] overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words leading-[1.5]"
              style={{
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-divider)',
              }}
            >
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          )}
          {entry.result != null && entry.result.length > 0 && (
            <pre
              className="text-[11px] font-mono rounded-[6px] p-[6px_8px] overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words leading-[1.5]"
              style={{
                background: 'var(--color-bg-primary)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-divider)',
              }}
            >
              {entry.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
