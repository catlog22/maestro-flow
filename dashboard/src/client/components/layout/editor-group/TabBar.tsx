import { memo, useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Tab } from './Tab.js';
import { useLayoutContext, useLayoutSelector } from '@/client/components/layout/LayoutContext.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import type { TabSession, EditorGroupNode, EditorGroupLeaf } from '@/client/types/layout-types.js';

// ---------------------------------------------------------------------------
// TabBar -- 35px horizontal tab strip within each EditorGroupLeaf
// ---------------------------------------------------------------------------
// - Renders tabs for open sessions in the group
// - HTML5 Drag and Drop: reorder within group, move between groups
// - Horizontal scroll for overflow with gradient fade at edges
// - Tab visual states: default, hover, active, dragging, drop-target
// - DragData format: { type: 'maestro-tab-drag', tabId, sourceGroupId, processId }
// ---------------------------------------------------------------------------

/** MIME type for tab drag data */
const TAB_DRAG_MIME = 'application/json';
const TAB_DRAG_TYPE = 'maestro-tab-drag';

export interface TabDragData {
  type: typeof TAB_DRAG_TYPE;
  tabId: string;
  sourceGroupId: string;
  processId?: string;
}

export interface TabBarProps {
  tabs: TabSession[];
  activeTabId: string | null;
  groupId: string;
  isFocused: boolean;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
}

/** Collect all leaf nodes from the editor tree */
function collectLeaves(node: EditorGroupNode): EditorGroupLeaf[] {
  if (node.type === 'leaf') return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

export const TabBar = memo(function TabBar({
  tabs,
  activeTabId,
  groupId,
  isFocused,
  onTabSelect,
  onTabClose,
}: TabBarProps) {
  const { state, dispatch } = useLayoutContext();
  const processes = useAgentStore((s) => s.processes);
  const scrollRef = useRef<HTMLDivElement>(null);

  // -- Drag initiation --
  const handleDragStart = useCallback(
    (tabId: string, event: DragEvent<HTMLElement>) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      const dragData: TabDragData = {
        type: TAB_DRAG_TYPE,
        tabId,
        sourceGroupId: groupId,
        processId: tab.ref,
      };

      event.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify(dragData));
      event.dataTransfer.effectAllowed = 'move';
    },
    [tabs, groupId],
  );

  // -- Drop handling (reorder + cross-group move) --
  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
      if (!raw) return;

      let dragData: TabDragData;
      try {
        dragData = JSON.parse(raw);
      } catch {
        return;
      }

      if (dragData.type !== TAB_DRAG_TYPE) return;

      // Find the tab in the source group
      const sourceLeaf = collectLeaves(state.editorArea).find(
        (l) => l.id === dragData.sourceGroupId,
      );
      if (!sourceLeaf) return;

      const tab = sourceLeaf.tabs.find((t) => t.id === dragData.tabId);
      if (!tab) return;

      if (dragData.sourceGroupId === groupId) {
        // Reorder within same group -- just activate (full reorder is a future enhancement)
        dispatch({ type: 'SET_ACTIVE_TAB', groupId, tabId: dragData.tabId });
      } else {
        // Move between groups: close in source, open in target
        dispatch({ type: 'CLOSE_TAB', groupId: dragData.sourceGroupId, tabId: dragData.tabId });
        dispatch({ type: 'OPEN_TAB', groupId, tab });
      }
    },
    [state.editorArea, groupId, dispatch],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div
      className="flex items-center h-[var(--size-tabbar-height)] min-h-[var(--size-tabbar-height)] bg-bg-secondary"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      data-tab-bar={groupId}
    >
      {/* Scrollable tab container */}
      <div
        ref={scrollRef}
        className="flex items-end h-full overflow-x-auto scrollbar-none flex-1 min-w-0"
        role="tablist"
        aria-label="Open sessions"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          // Get process status for the dot indicator
          const process = tab.ref ? processes[tab.ref] : undefined;
          const processStatus = process?.status;

          return (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={isActive}
              isFocused={isFocused}
              processStatus={processStatus}
              onSelect={onTabSelect}
              onClose={onTabClose}
              onDragStart={handleDragStart}
              groupId={groupId}
            />
          );
        })}
      </div>
      {/* Add tab button — outside scrollable area so dropdown isn't clipped */}
      <NewTabButton groupId={groupId} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// NewTabButton — "+" button with type picker dropdown (chat/code/terminal)
// ---------------------------------------------------------------------------

const TAB_TYPE_OPTIONS = [
  {
    type: 'chat' as const,
    label: 'Chat',
    color: 'var(--color-accent-green)',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  {
    type: 'file' as const,
    label: 'Code',
    color: 'var(--color-accent-blue)',
    icon: '', // custom SVG
  },
  {
    type: 'agent' as const,
    label: 'Terminal',
    color: 'var(--color-accent-orange)',
    icon: '', // custom SVG
  },
];

let newTabCounter = 0;

function NewTabButton({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const { dispatch } = useLayoutContext();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const handleCreate = useCallback((opt: typeof TAB_TYPE_OPTIONS[number]) => {
    newTabCounter++;
    const tab: TabSession = {
      id: `new-${opt.type}-${newTabCounter}`,
      type: opt.type,
      title: opt.label,
      ref: '',
    };
    dispatch({ type: 'OPEN_TAB', groupId, tab });
    setOpen(false);
  }, [dispatch, groupId]);

  // Calculate dropdown position from button rect
  useEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left });
    }
  }, [open]);

  return (
    <div className="self-center ml-[2px] shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-[22px] h-[22px] rounded-[4px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-100"
        style={{ color: 'var(--color-text-placeholder)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
        onMouseLeave={(e) => { if (!open) { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-placeholder)'; } }}
        title="New tab"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              minWidth: 120,
              overflow: 'hidden',
            }}
          >
            {TAB_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => handleCreate(opt)}
                className="flex items-center gap-[6px] w-full px-[10px] py-[6px] border-none bg-transparent cursor-pointer text-left transition-colors duration-100 text-[11px]"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'inherit' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <NewTabTypeIcon type={opt.type} color={opt.color} />
                <span className="font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function NewTabTypeIcon({ type, color }: { type: string; color: string }) {
  if (type === 'chat') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (type === 'file') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  // terminal
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
