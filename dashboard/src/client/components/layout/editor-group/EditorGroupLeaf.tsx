import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { SplitSquareHorizontal, Rows } from 'lucide-react';
import { useLayoutContext, useLayoutSelector } from '@/client/components/layout/LayoutContext.js';
import { useEditorContent } from './EditorContentContext.js';
import { TabBar } from './TabBar.js';
import type { EditorGroupLeaf as EditorGroupLeafType, TabSession } from '@/client/types/layout-types.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { MessageArea } from '@/client/pages/chat/MessageArea.js';
import { ChatInput } from '@/client/pages/chat/ChatInput.js';
import { ThoughtDisplay } from '@/client/pages/chat/ThoughtDisplay.js';
import { FileViewer } from '@/client/pages/chat/FileViewer.js';

// ---------------------------------------------------------------------------
// EditorGroupLeaf -- renders TabBar slot + content area for a leaf node
// ---------------------------------------------------------------------------
// - TabBar renders tabs for open sessions with drag-and-drop support
// - Inactive tab content preserved via CSS display:none (not conditional rendering)
// - Empty leaf renders a welcome view with quick-start cards
// - Split buttons visible in header (hover-reveal)
// ---------------------------------------------------------------------------

interface EditorGroupLeafProps {
  node: EditorGroupLeafType;
}

/** Maximum split depth allowed */
const MAX_SPLIT_DEPTH = 2;

/** Count the depth of a leaf node in the tree by walking from root */
function getNodeDepth(
  root: import('@/client/types/layout-types.js').EditorGroupNode,
  targetId: string,
): number {
  if (root.type === 'leaf') return root.id === targetId ? 0 : -1;
  const firstDepth = getNodeDepth(root.first, targetId);
  if (firstDepth >= 0) return firstDepth + 1;
  const secondDepth = getNodeDepth(root.second, targetId);
  if (secondDepth >= 0) return secondDepth + 1;
  return -1;
}

/** Renders content based on tab type */
function TabContentRenderer({ tab }: { tab: TabSession }) {
  switch (tab.type) {
    case 'chat':
    case 'agent':
      // Empty ref = new conversation (welcome view with input)
      if (!tab.ref) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center h-full">
            <div className="w-full px-4" style={{ maxWidth: 'clamp(360px, calc(100% - 32px), 700px)' }}>
              <div className="flex flex-col items-center mb-6">
                <h2 className="text-[16px] font-semibold mb-[6px]" style={{ color: 'var(--color-text-secondary)' }}>
                  Start a new conversation
                </h2>
                <p className="text-[13px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Select an agent, type a message, and press Enter to begin.
                </p>
              </div>
              <ChatInput />
            </div>
          </div>
        );
      }
      return (
        <div className="flex flex-col h-full">
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <MessageArea processId={tab.ref} />
          </div>
          <ThoughtDisplay processId={tab.ref} />
          <ChatInput processId={tab.ref} />
        </div>
      );
    case 'file':
      return <FileViewer filePath={tab.ref} onClose={() => {}} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-text-tertiary text-[13px]">
          {tab.title}
        </div>
      );
  }
}

export const EditorGroupLeaf = memo(function EditorGroupLeaf({ node }: EditorGroupLeafProps) {
  const { state, dispatch } = useLayoutContext();
  const focusedGroupId = useLayoutSelector((s) => s.focusedGroupId);
  const routedContent = useEditorContent();
  const isFocused = focusedGroupId === node.id;
  const isDefaultGroup = node.id === 'editor-group-1';

  // Refs for keyboard shortcut values
  const tabsRef = useRef(node.tabs);
  tabsRef.current = node.tabs;
  const activeTabIdRef = useRef(node.activeTabId);
  activeTabIdRef.current = node.activeTabId;
  const groupIdRef = useRef(node.id);
  groupIdRef.current = node.id;

  const handleTabClick = useCallback((tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', groupId: node.id, tabId });
    // Sync: update activeProcessId when user clicks a chat tab
    const tab = node.tabs.find((t) => t.id === tabId);
    if (tab?.type === 'chat' && tab.ref) {
      useAgentStore.getState().setActiveProcessId(tab.ref);
    }
  }, [dispatch, node.id, node.tabs]);

  const handleTabClose = useCallback((tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', groupId: node.id, tabId });
  }, [dispatch, node.id]);

  const handleSplitHorizontal = useCallback(() => {
    dispatch({ type: 'SPLIT_GROUP', groupId: node.id, direction: 'horizontal' });
  }, [dispatch, node.id]);

  const handleSplitVertical = useCallback(() => {
    dispatch({ type: 'SPLIT_GROUP', groupId: node.id, direction: 'vertical' });
  }, [dispatch, node.id]);

  const handleFocus = useCallback(() => {
    if (!isFocused) {
      dispatch({ type: 'SET_FOCUSED_GROUP', groupId: node.id });
    }
  }, [dispatch, node.id, isFocused]);

  // -- Keyboard shortcuts: Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+W --
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tabs = tabsRef.current;
      const activeTabId = activeTabIdRef.current;
      const gid = groupIdRef.current;

      // Ctrl+Tab: cycle to next tab
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = (idx + 1) % tabs.length;
        dispatch({ type: 'SET_ACTIVE_TAB', groupId: gid, tabId: tabs[nextIdx].id });
        return;
      }

      // Ctrl+Shift+Tab: cycle to previous tab
      if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const prevIdx = (idx - 1 + tabs.length) % tabs.length;
        dispatch({ type: 'SET_ACTIVE_TAB', groupId: gid, tabId: tabs[prevIdx].id });
        return;
      }

      // Ctrl+W: close active tab
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (!activeTabId) return;
        dispatch({ type: 'CLOSE_TAB', groupId: gid, tabId: activeTabId });
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  const canSplit = getNodeDepth(state.editorArea, node.id) < MAX_SPLIT_DEPTH;

  // Auto-close non-default empty groups when last tab is CLOSED (not on initial mount)
  const prevTabCount = useRef(node.tabs.length);
  useEffect(() => {
    const wasNonEmpty = prevTabCount.current > 0;
    prevTabCount.current = node.tabs.length;
    if (node.tabs.length === 0 && wasNonEmpty && !isDefaultGroup) {
      dispatch({ type: 'CLOSE_GROUP', groupId: node.id });
    }
  }, [node.tabs.length, isDefaultGroup, node.id, dispatch]);

  return (
    <div
      className={`flex flex-col h-full overflow-hidden ${
        isFocused ? '' : ''
      }`}
      onMouseDown={handleFocus}
      data-editor-group={node.id}
    >
      {/* Header row: TabBar + split buttons */}
      <div className="flex items-center shrink-0 h-[32px] border-b border-border bg-bg-secondary">
        {/* Tab bar */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <TabBar
            tabs={node.tabs}
            activeTabId={node.activeTabId}
            groupId={node.id}
            isFocused={isFocused}
            onTabSelect={handleTabClick}
            onTabClose={handleTabClose}
          />
        </div>

        {/* Split buttons — only when splittable */}
        {canSplit && (
          <div className="flex items-center gap-[1px] px-1 shrink-0">
            <button
              className="p-1 rounded-[var(--radius-sm)] hover:bg-bg-active text-text-tertiary hover:text-text-secondary transition-colors"
              onClick={handleSplitHorizontal}
              title="Split Right"
              aria-label="Split right"
            >
              <SplitSquareHorizontal size={14} />
            </button>
            <button
              className="p-1 rounded-[var(--radius-sm)] hover:bg-bg-active text-text-tertiary hover:text-text-secondary transition-colors"
              onClick={handleSplitVertical}
              title="Split Down"
              aria-label="Split down"
            >
              <Rows size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        {node.tabs.length === 0 ? (
          isDefaultGroup && routedContent ? (
            /* Render routed content (Outlet) in the default empty leaf */
            <div className="h-full overflow-y-auto">
              {routedContent}
            </div>
          ) : (
            /* Empty pane — click "+" to create a tab */
            <div className="flex items-center justify-center h-full text-[12px]" style={{ color: 'var(--color-text-placeholder)' }}>
              Click + to open a new tab
            </div>
          )
        ) : (
          /* Render all tabs, hide inactive with display:none */
          node.tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: tab.id === node.activeTabId ? 'flex' : 'none' }}
              data-tab-content={tab.id}
            >
              <TabContentRenderer tab={tab} />
            </div>
          ))
        )}
      </div>
    </div>
  );
});
