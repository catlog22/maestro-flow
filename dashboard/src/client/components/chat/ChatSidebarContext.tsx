import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// ChatSidebarContext — provides sidebar toggle callbacks to child components
// ---------------------------------------------------------------------------

export type SidebarTab = 'chat' | 'files' | 'git' | 'search';

interface ChatSidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  // Backward compat — map to sidebar tab + open state
  fileTreeOpen: boolean;
  setFileTreeOpen: (open: boolean) => void;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
}

export const ChatSidebarContext = createContext<ChatSidebarContextValue>({
  sidebarOpen: true,
  setSidebarOpen: () => {},
  activeTab: 'chat',
  setActiveTab: () => {},
  fileTreeOpen: false,
  setFileTreeOpen: () => {},
  historyOpen: false,
  setHistoryOpen: () => {},
});

export function useChatSidebar() {
  return useContext(ChatSidebarContext);
}
