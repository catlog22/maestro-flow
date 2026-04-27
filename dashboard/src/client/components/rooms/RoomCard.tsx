import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import type { RoomSessionSummary } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// Status colors for room sessions
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active: '#3D9B6F',
  paused: '#C99B2D',
  destroyed: '#D05454',
};

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#A09D97';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: `${color}18`, color }}
    >
      {status === 'active' && (
        <span className="relative flex w-1.5 h-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full w-1.5 h-1.5" style={{ backgroundColor: color }} />
        </span>
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RoomCard
// ---------------------------------------------------------------------------

export function RoomCard({
  room,
  onClick,
  onDelete,
}: {
  room: RoomSessionSummary;
  onClick: () => void;
  onDelete?: (sessionId: string) => void;
}) {
  const age = Date.now() - new Date(room.createdAt).getTime();
  const mins = Math.floor(age / 60_000);
  const timeLabel = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="group w-full text-left bg-bg-card border border-border rounded-xl p-3.5 hover:border-accent-blue hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0 bg-[#4A90D9]">
          MR
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary truncate">
            {room.sessionId}
          </div>
        </div>
        <StatusPill status={room.status} />
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(room.sessionId);
            }}
            className="w-6 h-6 rounded-md flex items-center justify-center text-text-placeholder opacity-0 group-hover:opacity-100 hover:!text-status-failed hover:bg-[rgba(196,101,85,0.1)] transition-all shrink-0"
            title="Delete room"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
        <span className="inline-flex items-center gap-1">
          <Users size={11} />
          {room.agentCount} agents
        </span>
        <span className="inline-flex items-center gap-1">
          <ListChecks size={11} />
          {room.taskCount} tasks
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={11} />
          {room.messageCount} msgs
        </span>
        <span className="ml-auto text-text-placeholder">{timeLabel}</span>
        <ChevronRight size={14} className="text-text-placeholder group-hover:text-text-primary transition-colors" />
      </div>
    </div>
  );
}
