import { memo, useCallback, type DragEvent } from 'react';
import { X } from 'lucide-react';
import type { TabSession } from '@/client/types/layout-types.js';
import type { AgentProcessStatus } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// Tab -- individual tab with type icon, status subtitle, drag support
// ---------------------------------------------------------------------------

/** Status dot color mapping */
const STATUS_DOT_COLORS: Record<string, string> = {
  spawning: 'var(--color-accent-blue)',
  running: 'var(--color-accent-green, #4caf50)',
  paused: 'var(--color-accent-yellow)',
  stopping: 'var(--color-accent-orange)',
  stopped: 'var(--color-text-tertiary)',
  error: 'var(--color-accent-red, #e53935)',
};

/** Status subtitle labels */
const STATUS_SUBTITLES: Partial<Record<AgentProcessStatus, string>> = {
  spawning: 'starting',
  running: 'running',
  paused: 'paused',
  stopping: 'stopping',
  error: 'error',
};

export interface TabProps {
  tab: TabSession;
  isActive: boolean;
  isFocused: boolean;
  /** Process status for the dot indicator */
  processStatus?: AgentProcessStatus;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (tabId: string, event: DragEvent<HTMLElement>) => void;
  groupId: string;
}

export const Tab = memo(function Tab({
  tab,
  isActive,
  isFocused,
  processStatus,
  onSelect,
  onClose,
  onDragStart,
  groupId,
}: TabProps) {
  const handleClick = useCallback(() => {
    onSelect(tab.id);
  }, [onSelect, tab.id]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.id);
    },
    [onClose, tab.id],
  );

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLElement>) => {
      onDragStart(tab.id, e);
    },
    [onDragStart, tab.id],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    // Allow drop on tabs for reorder
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Status dot color
  const dotColor = processStatus ? (STATUS_DOT_COLORS[processStatus] ?? 'var(--color-text-tertiary)') : undefined;

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      className={`
        group relative flex items-center gap-[var(--spacing-1)] h-[32px]
        min-w-[120px] max-w-[240px] px-[var(--spacing-2)] cursor-pointer
        select-none whitespace-nowrap transition-colors duration-100
        text-[length:var(--font-size-xs)]
        ${isActive
          ? 'bg-bg-primary text-text-primary border-b-[2px] border-b-accent-blue'
          : 'text-text-tertiary hover:bg-bg-hover border-b-[2px] border-b-transparent'
        }
        ${isFocused && isActive ? '' : ''}
      `}
      style={{ flexShrink: 1 }}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      draggable
      data-tab-id={tab.id}
      data-group-id={groupId}
      title={tab.title}
    >
      {/* Type icon — chat (green) */}
      <svg
        className="shrink-0"
        width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        stroke={dotColor ?? 'var(--color-accent-green)'}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {/* Tab title with ellipsis truncation */}
      <span className="truncate flex-1 min-w-0">{tab.title}</span>

      {/* Status subtitle */}
      {processStatus && STATUS_SUBTITLES[processStatus] && (
        <span
          className="text-[9px] font-normal shrink-0"
          style={{ color: isActive ? 'var(--color-text-tertiary)' : 'var(--color-text-placeholder)' }}
        >
          &middot; {STATUS_SUBTITLES[processStatus]}
        </span>
      )}

      {/* Close button -- visible on hover and active */}
      <button
        className={`
          p-[2px] rounded-[var(--radius-sm)] hover:bg-bg-active transition-opacity shrink-0
          ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        `}
        onClick={handleClose}
        aria-label={`Close ${tab.title}`}
        tabIndex={-1}
      >
        <X size={12} className="text-text-tertiary" />
      </button>
    </div>
  );
});
