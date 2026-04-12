import type { CollabActivityEntry } from '@/shared/collab-types.js';
import { COLLAB_ACTION_COLORS } from '@/shared/collab-types.js';

// ---------------------------------------------------------------------------
// TimelineEventNode — individual event on the horizontal timeline
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function TimelineEventNode({ event }: { event: CollabActivityEntry }) {
  const color = COLLAB_ACTION_COLORS[event.action] ?? '#9ca3af';

  return (
    <div className="flex flex-col items-center min-w-[80px] flex-shrink-0">
      {/* Dot */}
      <div
        className="w-3 h-3 rounded-full border-2 border-bg-secondary flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      {/* Content */}
      <div className="flex flex-col items-center gap-0.5 mt-1 text-center">
        <span className="text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-text-primary truncate max-w-[76px]">
          {event.user}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {formatTime(event.ts)}
        </span>
        <span className="text-[10px] text-text-secondary truncate max-w-[76px]">
          {event.action}
        </span>
      </div>
    </div>
  );
}
