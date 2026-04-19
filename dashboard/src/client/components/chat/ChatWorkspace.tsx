import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useLayoutContext, useLayoutSelector } from '@/client/components/layout/LayoutContext.js';
import { EditorGroupContainer } from '@/client/components/layout/editor-group/EditorGroupContainer.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { AGENT_LABELS } from '@/shared/constants.js';
import { MessageSquare } from 'lucide-react';

// ---------------------------------------------------------------------------
// ChatWorkspace — connects agent-store sessions to LayoutContext editor tabs
// ---------------------------------------------------------------------------
// Always renders EditorGroupContainer. Syncs agent processes as tabs.
// One-way sync: agent-store → LayoutContext (no reverse to avoid loops).
// ---------------------------------------------------------------------------

/** Get the first leaf node from a tree */
function getFirstLeaf(node: import('@/client/types/layout-types.js').EditorGroupNode): import('@/client/types/layout-types.js').EditorGroupLeaf {
  return node.type === 'leaf' ? node : getFirstLeaf(node.first);
}

export function ChatWorkspace() {
  const { dispatch } = useLayoutContext();
  const editorArea = useLayoutSelector((s) => s.editorArea);
  const processes = useAgentStore((s) => s.processes);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);

  // Stable ref to the default group ID
  const defaultGroupId = getFirstLeaf(editorArea).id;

  // Filter: only show active processes as tabs
  const activeProcessEntries = useMemo(() => {
    const TWO_MIN = 2 * 60 * 1000;
    const now = Date.now();
    return Object.entries(processes).filter(([id, proc]) => {
      if (proc.status === 'running' || proc.status === 'spawning' || proc.status === 'paused') return true;
      if (id === activeProcessId) return true;
      if (proc.status === 'stopped' || proc.status === 'error') {
        const age = now - new Date(proc.startedAt).getTime();
        return age < TWO_MIN;
      }
      return false;
    });
  }, [processes, activeProcessId]);

  // Sync agent processes → LayoutContext tabs (one-way)
  useEffect(() => {
    const activeIds = new Set(activeProcessEntries.map(([id]) => id));
    const leaf = getFirstLeaf(editorArea);
    const existingTabRefs = new Set(leaf.tabs.map((t) => t.ref));

    // Open tabs for active processes
    for (const [procId, proc] of activeProcessEntries) {
      if (!existingTabRefs.has(procId)) {
        const label = AGENT_LABELS[proc.type] ?? proc.type;
        dispatch({
          type: 'OPEN_TAB',
          groupId: defaultGroupId,
          tab: {
            id: `chat-${procId}`,
            type: 'chat',
            title: label,
            ref: procId,
            icon: MessageSquare,
          },
        });
      }
    }

    // Close tabs for removed/dismissed processes
    for (const tab of leaf.tabs) {
      if (tab.type === 'chat' && tab.ref && !activeIds.has(tab.ref)) {
        dispatch({
          type: 'CLOSE_TAB',
          groupId: defaultGroupId,
          tabId: tab.id,
        });
      }
    }
  }, [activeProcessEntries, defaultGroupId, dispatch, editorArea]);

  // Sync activeProcessId → LayoutContext active tab (one-way)
  // Only react to activeProcessId changes, NOT editorArea changes
  // (editorArea changes on every tab click, which would fight user clicks)
  const prevActiveRef = useRef(activeProcessId);
  useEffect(() => {
    if (!activeProcessId || activeProcessId === prevActiveRef.current) {
      prevActiveRef.current = activeProcessId;
      return;
    }
    prevActiveRef.current = activeProcessId;
    const tabId = `chat-${activeProcessId}`;
    const leaf = getFirstLeaf(editorArea);
    const hasTab = leaf.tabs.some((t) => t.id === tabId);
    if (hasTab && leaf.activeTabId !== tabId) {
      dispatch({ type: 'SET_ACTIVE_TAB', groupId: leaf.id, tabId });
    }
  }, [activeProcessId, editorArea, dispatch]);

  // Always render EditorGroupContainer — even with no tabs
  return <EditorGroupContainer />;
}
