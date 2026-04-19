import { useState } from 'react';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import type { ErrorEntry as ErrorEntryType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ErrorDisplay -- collapsible error bar with brief summary + expandable detail
// ---------------------------------------------------------------------------

/** Extract a short summary from the error message (first line or first 80 chars) */
function getSummary(msg: string): { summary: string; hasMore: boolean } {
  const firstLine = msg.split('\n')[0];
  const short = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
  const hasMore = msg.includes('\n') || firstLine.length > 100;
  return { summary: short, hasMore };
}

export function ErrorDisplay({ entry }: { entry: ErrorEntryType }) {
  const [open, setOpen] = useState(false);
  const { summary, hasMore } = getSummary(entry.message);

  return (
    <div className="contain-content">
      <button
        type="button"
        onClick={() => hasMore && setOpen((v) => !v)}
        className="flex items-center gap-[5px] w-full rounded-[5px] transition-opacity hover:opacity-80"
        style={{
          padding: '4px 8px',
          backgroundColor: 'rgba(208, 84, 84, 0.06)',
          margin: '3px 0',
          fontSize: '10px',
          color: 'var(--color-accent-red, #D05454)',
          border: 'none',
          textAlign: 'left',
          fontFamily: 'inherit',
          cursor: hasMore ? 'pointer' : 'default',
        }}
      >
        {hasMore && (
          <ChevronRight
            size={10}
            className="shrink-0 transition-transform duration-150"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          />
        )}
        <AlertCircle size={11} className="shrink-0" strokeWidth={1.8} />
        <span className="truncate flex-1 min-w-0" style={{ color: 'var(--color-accent-red, #D05454)' }}>
          {summary}
        </span>
        {entry.code && (
          <code
            className="ml-auto shrink-0 font-mono text-[9px] px-[4px] py-[1px] rounded-[3px]"
            style={{ backgroundColor: 'rgba(208, 84, 84, 0.08)', color: 'var(--color-accent-red, #D05454)' }}
          >
            {entry.code}
          </code>
        )}
      </button>
      {open && hasMore && (
        <pre
          className="text-[11px] font-mono rounded-[6px] p-[6px_8px] overflow-x-auto max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words leading-[1.5] mt-[2px]"
          style={{
            background: 'rgba(208, 84, 84, 0.04)',
            color: 'var(--color-accent-red, #D05454)',
            border: '1px solid rgba(208, 84, 84, 0.12)',
          }}
        >
          {entry.message}
        </pre>
      )}
    </div>
  );
}
