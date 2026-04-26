import { useRef, useCallback, type ReactNode } from 'react';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';

// ---------------------------------------------------------------------------
// ResizableChatTerminalSplit — Resizable split pane via pointer capture
//
// Uses CSS custom properties for split ratio, with pointer capture for
// smooth drag tracking. Min pane size: 200px.
// ---------------------------------------------------------------------------

const MIN_PANE_PX = 200;

interface ResizableChatTerminalSplitProps {
  chatPanel: ReactNode;
  terminalPanel: ReactNode;
}

export function ResizableChatTerminalSplit({ chatPanel, terminalPanel }: ResizableChatTerminalSplitProps) {
  const splitRatio = useMeetingRoomStore((s) => s.splitRatio);
  const setSplitRatio = useMeetingRoomStore((s) => s.setSplitRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (totalWidth === 0) return;

      const offsetX = e.clientX - rect.left;

      // Enforce minimum pane sizes
      const minRatio = (MIN_PANE_PX / totalWidth) * 100;
      const maxRatio = 100 - minRatio;
      const rawRatio = (offsetX / totalWidth) * 100;
      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, rawRatio));

      setSplitRatio(Math.round(clampedRatio));
    },
    [setSplitRatio],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 overflow-hidden"
      style={
        {
          '--split-ratio': `${splitRatio}%`,
        } as React.CSSProperties
      }
    >
      {/* Chat panel */}
      <div
        className="overflow-hidden flex flex-col"
        style={{ width: 'var(--split-ratio)', minWidth: `${MIN_PANE_PX}px` }}
      >
        {chatPanel}
      </div>

      {/* Drag handle */}
      <div
        className="shrink-0 w-1 cursor-col-resize flex items-center justify-center group hover:bg-accent-muted/20 transition-colors"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={splitRatio}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
      >
        <div className="w-0.5 h-8 rounded-full bg-border-divider group-hover:bg-accent-muted transition-colors" />
      </div>

      {/* Terminal panel */}
      <div
        className="overflow-hidden flex flex-col flex-1"
        style={{ minWidth: `${MIN_PANE_PX}px` }}
      >
        {terminalPanel}
      </div>
    </div>
  );
}
