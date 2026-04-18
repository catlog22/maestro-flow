import type { CollabActivityEntry } from '@/shared/collab-types.js';
import { COLLAB_ACTION_COLORS } from '@/shared/collab-types.js';

// ---------------------------------------------------------------------------
// CollabActivityItem — single activity log entry
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CollabActivityItem({ entry }: { entry: CollabActivityEntry }) {
  const borderColor = COLLAB_ACTION_COLORS[entry.action] ?? '#9ca3af';

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded text-[length:var(--font-size-xs)]"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <span className="text-text-tertiary flex-shrink-0 tabular-nums w-12">
        {formatRelativeTime(entry.ts)}
      </span>
      <span className="font-[var(--font-weight-medium)] text-text-primary flex-shrink-0">
        {entry.user}
      </span>
      <span className="text-text-secondary truncate">
        {entry.action}{entry.target ? ` → ${entry.target}` : ''}
      </span>
    </div>
  );
}
