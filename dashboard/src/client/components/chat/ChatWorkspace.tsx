import { useEffect, useMemo, useRef } from 'react';
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

/** Collect all leaf nodes from the tree */
function collectLeaves(node: import('@/client/types/layout-types.js').EditorGroupNode): import('@/client/types/layout-types.js').EditorGroupLeaf[] {
  if (node.type === 'leaf') return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

export function ChatWorkspace() {
  const { dispatch } = useLayoutContext();
  const editorArea = useLayoutSelector((s) => s.editorArea);
  const focusedGroupId = useLayoutSelector((s) => s.focusedGroupId);
  const processes = useAgentStore((s) => s.processes);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);

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

  // Track process IDs we've already seen so we don't re-open user-closed tabs
  const knownProcessIds = useRef<Set<string>>(new Set());

  // Sync agent processes → LayoutContext tabs (one-way)
  useEffect(() => {
    const leaves = collectLeaves(editorArea);
    const activeIds = new Set(activeProcessEntries.map(([id]) => id));

    // Collect all existing tab refs across ALL leaves
    const existingTabRefs = new Set<string>();
    for (const leaf of leaves) {
      for (const tab of leaf.tabs) {
        if (tab.ref) existingTabRefs.add(tab.ref);
      }
    }

    // Open tabs only for NEW processes (not previously seen)
    const targetGroupId = focusedGroupId || getFirstLeaf(editorArea).id;
    for (const [procId, proc] of activeProcessEntries) {
      if (!existingTabRefs.has(procId)) {
        // If we've seen this process before but its tab is gone, the user closed it — skip
        if (knownProcessIds.current.has(procId)) continue;

        const label = AGENT_LABELS[proc.type] ?? proc.type;

        // If focused group has a welcome tab (chat with no ref), close it first
        const targetLeaf = leaves.find((l) => l.id === targetGroupId);
        if (targetLeaf) {
          const welcomeTab = targetLeaf.tabs.find((t) => t.type === 'chat' && !t.ref);
          if (welcomeTab) {
            dispatch({ type: 'CLOSE_TAB', groupId: targetGroupId, tabId: welcomeTab.id });
          }
        }

        dispatch({
          type: 'OPEN_TAB',
          groupId: targetGroupId,
          tab: {
            id: `chat-${procId}`,
            type: 'chat',
            title: label,
            ref: procId,
            icon: MessageSquare,
          },
        });
      }
      // Mark as known whether or not we opened a tab
      knownProcessIds.current.add(procId);
    }

    // Close tabs for removed/dismissed processes (across all leaves)
    for (const leaf of leaves) {
      for (const tab of leaf.tabs) {
        if (tab.type === 'chat' && tab.ref && !activeIds.has(tab.ref)) {
          dispatch({ type: 'CLOSE_TAB', groupId: leaf.id, tabId: tab.id });
          // Remove from known so if process becomes active again, it gets a tab
          knownProcessIds.current.delete(tab.ref);
        }
      }
    }
  }, [activeProcessEntries, focusedGroupId, dispatch, editorArea]);

  // Sync activeProcessId → LayoutContext active tab (one-way)
  // Only react to activeProcessId changes, NOT editorArea changes
  const prevActiveRef = useRef(activeProcessId);
  useEffect(() => {
    if (!activeProcessId || activeProcessId === prevActiveRef.current) {
      prevActiveRef.current = activeProcessId;
      return;
    }
    prevActiveRef.current = activeProcessId;
    const tabId = `chat-${activeProcessId}`;
    // Search all leaves for the tab
    const leaves = collectLeaves(editorArea);
    for (const leaf of leaves) {
      if (leaf.tabs.some((t) => t.id === tabId)) {
        if (leaf.activeTabId !== tabId) {
          dispatch({ type: 'SET_ACTIVE_TAB', groupId: leaf.id, tabId });
        }
        break;
      }
    }
  }, [activeProcessId, editorArea, dispatch]);

  // Always render EditorGroupContainer — even with no tabs
  return <EditorGroupContainer />;
}
