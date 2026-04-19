import { useState, useMemo } from 'react';
import { useAgentStore } from '@/client/store/agent-store.js';
import type { ThinkingEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ThinkingBlock -- purple tinted bar with animated dots (chat.html reference)
// ---------------------------------------------------------------------------

export function ThinkingBlock({ entry }: { entry: ThinkingEntry }) {
  const [open, setOpen] = useState(false);

  // Check if this thinking block is still streaming (next entry not yet arrived)
  const entries = useAgentStore((s) => s.entries[entry.processId] ?? []);
  const isPartial = useMemo(() => {
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx === -1 || idx === entries.length - 1) return true;
    const nextEntry = entries[idx + 1];
    if (!nextEntry) return true;
    return false;
  }, [entries, entry.id]);

  const durationLabel = useMemo(() => {
    if (isPartial) return 'Thinking...';
    const idx = entries.findIndex((e) => e.id === entry.id);
    const nextEntry = entries[idx + 1];
    if (!nextEntry) return 'Thinking...';
    const start = new Date(entry.timestamp).getTime();
    const end = new Date(nextEntry.timestamp).getTime();
    const seconds = Math.round((end - start) / 1000);
    if (seconds < 1) return 'Thought for <1s';
    return `Thought for ${seconds}s`;
  }, [entries, entry.id, entry.timestamp, isPartial]);

  return (
    <div className="contain-content">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[5px] w-full rounded-[6px] cursor-pointer transition-opacity hover:opacity-80"
        style={{
          padding: '6px 10px',
          backgroundColor: 'var(--color-tint-planning)',
          margin: '3px 0',
          fontSize: '10px',
          color: 'var(--color-accent-purple)',
          fontWeight: 500,
          border: 'none',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        {isPartial && (
          <span className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-purple)', animationDelay: '0ms', opacity: 0.7 }} />
            <span className="w-[3px] h-[3px] rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-purple)', animationDelay: '200ms', opacity: 0.7 }} />
            <span className="w-[3px] h-[3px] rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-purple)', animationDelay: '400ms', opacity: 0.7 }} />
          </span>
        )}
        <span className="truncate">
          {isPartial
            ? (entry.content.slice(0, 60) || 'Thinking...')
            : durationLabel}
        </span>
      </button>
      {open && (
        <div
          className="text-[11px] leading-[1.6] italic mt-[2px] pl-[10px] whitespace-pre-wrap break-words"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {entry.content}
        </div>
      )}
    </div>
  );
}
