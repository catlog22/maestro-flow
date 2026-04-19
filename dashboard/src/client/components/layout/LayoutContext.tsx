import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { LayoutState, LayoutAction, EditorGroupLeaf, WorkspaceMode } from '@/client/types/layout-types.js';

// ---------------------------------------------------------------------------
// LayoutContext — VS Code-style layout state with localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'maestro-layout-state';
const PERSIST_DEBOUNCE_MS = 500;
const CURRENT_VERSION = 5;

// ---- Defaults ----

function createDefaultLeaf(id: string): EditorGroupLeaf {
  return { type: 'leaf', id, tabs: [], activeTabId: null };
}

function createInitialState(): LayoutState {
  return {
    version: CURRENT_VERSION,
    primarySidebar: {
      visible: true,
      width: 260,
      activePanelId: 'explorer',
    },
    secondarySidebar: {
      visible: false,
      width: 300,
      activePanelId: null,
    },
    activityBar: {
      activePanelId: 'explorer',
    },
    editorArea: createDefaultLeaf('editor-group-1'),
    panel: {
      visible: false,
      height: 200,
      activeTabId: null,
      isMaximized: false,
    },
    focusedGroupId: 'editor-group-1',
    workspaceMode: 'conversation',
  };
}

// ---- Migration Pipeline ----

function migrateLayoutState(prev: Record<string, unknown>): LayoutState {
  const version = (prev.version as number) ?? 0;
  let state = prev;

  // v0/v1 -> v2: add secondarySidebar
  if (version < 2) {
    state = {
      ...state,
      secondarySidebar: (state.secondarySidebar as object) ?? {
        visible: false,
        width: 300,
        activePanelId: null,
      },
      version: 2,
    };
  }

  // v2 -> v3: add focusedGroupId
  if ((state.version as number) < 3) {
    state = {
      ...state,
      focusedGroupId: (state.focusedGroupId as string) ?? 'editor-group-1',
      version: 3,
    };
  }

  // v3 -> v4: ensure all required fields present (forward-compatible)
  if ((state.version as number) < 4) {
    const base = createInitialState();
    state = {
      ...base,
      ...state,
      version: 4,
      // Ensure nested objects have all required fields
      primarySidebar: { ...base.primarySidebar, ...(state.primarySidebar as object) },
      secondarySidebar: { ...base.secondarySidebar, ...(state.secondarySidebar as object) },
      activityBar: { ...base.activityBar, ...(state.activityBar as object) },
      panel: { ...base.panel, ...(state.panel as object) },
    };
  }

  // v4 -> v5: add workspaceMode
  if ((state.version as number) < 5) {
    state = {
      ...state,
      workspaceMode: (state.workspaceMode as WorkspaceMode) ?? 'conversation',
      version: 5,
    };
  }

  return state as unknown as LayoutState;
}

// ---- Reducer ----

function findLeafById(
  node: LayoutState['editorArea'],
  id: string,
): EditorGroupLeaf | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  return findLeafById(node.first, id) ?? findLeafById(node.second, id);
}

let nextGroupId = 2;
function getNextGroupId(): string {
  return `editor-group-${nextGroupId++}`;
}

function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'SET_SIDEBAR_VISIBLE': {
      const key = action.side === 'primary' ? 'primarySidebar' : 'secondarySidebar';
      return { ...state, [key]: { ...state[key], visible: action.visible } };
    }

    case 'SET_SIDEBAR_WIDTH': {
      const key = action.side === 'primary' ? 'primarySidebar' : 'secondarySidebar';
      return { ...state, [key]: { ...state[key], width: action.width } };
    }

    case 'SET_ACTIVE_PANEL': {
      const key = action.side === 'primary' ? 'primarySidebar' : 'secondarySidebar';
      return { ...state, [key]: { ...state[key], activePanelId: action.panelId } };
    }

    case 'SET_FOCUSED_GROUP':
      return { ...state, focusedGroupId: action.groupId };

    case 'SET_PANEL_VISIBLE':
      return { ...state, panel: { ...state.panel, visible: action.visible } };

    case 'SET_PANEL_HEIGHT':
      return { ...state, panel: { ...state.panel, height: action.height } };

    case 'SET_PANEL_ACTIVE_TAB':
      return { ...state, panel: { ...state.panel, activeTabId: action.tabId } };

    case 'SET_PANEL_MAXIMIZED':
      return { ...state, panel: { ...state.panel, isMaximized: action.maximized } };

    case 'OPEN_TAB': {
      const leaf = findLeafById(state.editorArea, action.groupId);
      if (!leaf) return state;
      const existing = leaf.tabs.find((t) => t.id === action.tab.id);
      if (existing) {
        // Tab already exists, just activate it
        return {
          ...state,
          focusedGroupId: action.groupId,
          editorArea: updateLeaf(state.editorArea, action.groupId, {
            activeTabId: action.tab.id,
          }),
        };
      }
      return {
        ...state,
        focusedGroupId: action.groupId,
        editorArea: updateLeaf(state.editorArea, action.groupId, {
          tabs: [...leaf.tabs, action.tab],
          activeTabId: action.tab.id,
        }),
      };
    }

    case 'CLOSE_TAB': {
      const leaf = findLeafById(state.editorArea, action.groupId);
      if (!leaf) return state;
      const newTabs = leaf.tabs.filter((t) => t.id !== action.tabId);
      if (newTabs.length === leaf.tabs.length) return state;
      const newActiveTabId =
        leaf.activeTabId === action.tabId
          ? (newTabs[newTabs.length - 1]?.id ?? null)
          : leaf.activeTabId;
      return {
        ...state,
        editorArea: updateLeaf(state.editorArea, action.groupId, {
          tabs: newTabs,
          activeTabId: newActiveTabId,
        }),
      };
    }

    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        focusedGroupId: action.groupId,
        editorArea: updateLeaf(state.editorArea, action.groupId, {
          activeTabId: action.tabId,
        }),
      };

    case 'SET_WORKSPACE_MODE': {
      let newState = { ...state, workspaceMode: action.mode };
      // Apply mode presets
      switch (action.mode) {
        case 'conversation':
          newState = {
            ...newState,
            panel: { ...newState.panel, visible: false },
          };
          break;
        case 'files':
          newState = {
            ...newState,
            panel: { ...newState.panel, visible: false },
          };
          break;
        case 'fusion':
          newState = {
            ...newState,
            panel: { ...newState.panel, visible: true },
          };
          break;
      }
      return newState;
    }

    case 'SPLIT_GROUP': {
      const newGroupId = getNextGroupId();
      // Move the active tab from the source group to the new pane
      const sourceLeaf = findLeafById(state.editorArea, action.groupId);
      let newLeaf: EditorGroupLeaf;
      let editorAreaBeforeSplit = state.editorArea;
      if (sourceLeaf && sourceLeaf.activeTabId) {
        const activeTab = sourceLeaf.tabs.find(t => t.id === sourceLeaf.activeTabId);
        if (activeTab) {
          // Create new leaf with the active tab
          newLeaf = { type: 'leaf', id: newGroupId, tabs: [activeTab], activeTabId: activeTab.id };
          // Remove the tab from the source group
          const remainingTabs = sourceLeaf.tabs.filter(t => t.id !== sourceLeaf.activeTabId);
          const newActiveId = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
          editorAreaBeforeSplit = updateLeaf(state.editorArea, action.groupId, {
            tabs: remainingTabs,
            activeTabId: newActiveId,
          });
        } else {
          newLeaf = createDefaultLeaf(newGroupId);
        }
      } else {
        newLeaf = createDefaultLeaf(newGroupId);
      }
      const updated = splitNode(editorAreaBeforeSplit, action.groupId, action.direction, newLeaf);
      if (!updated) return state;
      return {
        ...state,
        editorArea: updated,
        focusedGroupId: newGroupId,
      };
    }

    case 'CLOSE_GROUP': {
      const updated = removeNode(state.editorArea, action.groupId);
      if (!updated) return state;
      return {
        ...state,
        editorArea: updated,
        focusedGroupId: getFirstLeaf(updated).id,
      };
    }

    case 'RESIZE_GROUP': {
      const updated = updateBranch(state.editorArea, action.branchId, {
        ratio: action.ratio,
      });
      if (!updated) return state;
      return { ...state, editorArea: updated };
    }

    case 'MOVE_PANEL': {
      // Panel mobility handled in panel-registry (mutable side field).
      // After moving, clear the activePanelId on the losing side if it was the moved panel.
      const oppositeSide = action.toSide === 'primary' ? 'secondary' : 'primary';
      const oppositeKey = oppositeSide === 'primary' ? 'primarySidebar' : 'secondarySidebar';
      const stateUpdate: Partial<LayoutState> = {};
      const oppositeSidebar = state[oppositeKey];
      if (oppositeSidebar.activePanelId === action.panelId) {
        stateUpdate[oppositeKey] = { ...oppositeSidebar, activePanelId: null };
      }
      return { ...state, ...stateUpdate };
    }

    case 'RESTORE_STATE':
      return { ...action.state, version: CURRENT_VERSION };

    default:
      return state;
  }
}

// ---- Tree helpers ----

type EditorGroupNode = import('@/client/types/layout-types.js').EditorGroupNode;
type EditorGroupBranch = import('@/client/types/layout-types.js').EditorGroupBranch;

function updateLeaf(
  node: EditorGroupNode,
  leafId: string,
  patch: Partial<EditorGroupLeaf>,
): EditorGroupNode {
  if (node.type === 'leaf') {
    return node.id === leafId ? { ...node, ...patch } : node;
  }
  return {
    ...node,
    first: updateLeaf(node.first, leafId, patch),
    second: updateLeaf(node.second, leafId, patch),
  };
}

function updateBranch(
  node: EditorGroupNode,
  branchId: string,
  patch: Partial<EditorGroupBranch>,
): EditorGroupNode | null {
  if (node.type === 'leaf') return null;
  if (node.id === branchId) return { ...node, ...patch };
  const first = updateBranch(node.first, branchId, patch);
  if (first) return { ...node, first };
  const second = updateBranch(node.second, branchId, patch);
  if (second) return { ...node, second };
  return null;
}

function splitNode(
  node: EditorGroupNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: EditorGroupLeaf,
): EditorGroupNode | null {
  if (node.type === 'leaf') {
    if (node.id !== targetId) return null;
    return {
      type: 'branch',
      id: `branch-${targetId}`,
      direction,
      ratio: 0.5,
      first: node,
      second: newLeaf,
    };
  }
  const first = splitNode(node.first, targetId, direction, newLeaf);
  if (first) return { ...node, first };
  const second = splitNode(node.second, targetId, direction, newLeaf);
  if (second) return { ...node, second };
  return null;
}

function removeNode(
  node: EditorGroupNode,
  targetId: string,
): EditorGroupNode | null {
  if (node.type === 'leaf') return null; // cannot remove root leaf
  // If one child matches, replace this branch with the other child
  if (node.first.type === 'leaf' && node.first.id === targetId) return node.second;
  if (node.second.type === 'leaf' && node.second.id === targetId) return node.first;
  // Recurse
  const first = removeNode(node.first, targetId);
  if (first) return { ...node, first };
  const second = removeNode(node.second, targetId);
  if (second) return { ...node, second };
  return null;
}

function getFirstLeaf(node: EditorGroupNode): EditorGroupLeaf {
  return node.type === 'leaf' ? node : getFirstLeaf(node.first);
}

// ---- Context ----

interface LayoutContextValue {
  state: LayoutState;
  dispatch: Dispatch<LayoutAction>;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

// ---- Provider ----

function loadPersistedState(): LayoutState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return migrateLayoutState(parsed);
  } catch {
    return null;
  }
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    layoutReducer,
    null,
    () => loadPersistedState() ?? createInitialState(),
  );

  // Persist to localStorage with 500ms debounce
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
      } catch {
        // localStorage full or unavailable — silently skip
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state]);

  return (
    <LayoutContext value={{ state, dispatch }}>
      {children}
    </LayoutContext>
  );
}

// ---- Hook ----

export function useLayoutContext(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error('useLayoutContext must be used within a LayoutProvider');
  }
  return ctx;
}

// ---- Selector hook (prevents unnecessary re-renders) ----

export function useLayoutSelector<T>(selector: (state: LayoutState) => T): T {
  const { state } = useLayoutContext();
  return selector(state);
}

// ---- Convenience action hooks ----

export function useSidebarActions(side: 'primary' | 'secondary') {
  const { state, dispatch } = useLayoutContext();
  const sidebarState = state[side === 'primary' ? 'primarySidebar' : 'secondarySidebar'];

  const toggleVisible = useCallback(() => {
    dispatch({ type: 'SET_SIDEBAR_VISIBLE', side, visible: !sidebarState.visible });
  }, [dispatch, side, sidebarState.visible]);

  const setWidth = useCallback(
    (width: number) => dispatch({ type: 'SET_SIDEBAR_WIDTH', side, width }),
    [dispatch, side],
  );

  const setActivePanel = useCallback(
    (panelId: string | null) => dispatch({ type: 'SET_ACTIVE_PANEL', side, panelId }),
    [dispatch, side],
  );

  const movePanelToSide = useCallback(
    (panelId: string, toSide: 'primary' | 'secondary') =>
      dispatch({ type: 'MOVE_PANEL', panelId, toSide }),
    [dispatch],
  );

  return { ...sidebarState, toggleVisible, setWidth, setActivePanel, movePanelToSide };
}

export { LayoutContext };
