import { useState, useCallback } from 'react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useApprovalKeyboard } from '@/client/hooks/useApprovalKeyboard.js';
import { ChatWorkspace } from '@/client/components/chat/ChatWorkspace.js';
import { ChatSidebarContext, type SidebarTab } from '@/client/components/chat/ChatSidebarContext.js';
import { ChatSidebar } from './ChatSidebar.js';

// ---------------------------------------------------------------------------
// ChatPage — VS Code-style layout with multi-view sidebar + workspace
// ---------------------------------------------------------------------------

export function ChatPage() {
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');

  useApprovalKeyboard(activeProcessId);

  // Backward-compat helpers for EditorGroupLeaf toggle buttons
  const fileTreeOpen = sidebarOpen && activeTab === 'files';
  const setFileTreeOpen = useCallback((open: boolean) => {
    if (open) { setSidebarOpen(true); setActiveTab('files'); }
    else if (activeTab === 'files') setSidebarOpen(false);
  }, [activeTab]);

  const historyOpen = sidebarOpen && activeTab === 'chat';
  const setHistoryOpen = useCallback((open: boolean) => {
    if (open) { setSidebarOpen(true); setActiveTab('chat'); }
    else if (activeTab === 'chat') setSidebarOpen(false);
  }, [activeTab]);

  return (
    <ChatSidebarContext value={{ sidebarOpen, setSidebarOpen, activeTab, setActiveTab, fileTreeOpen, setFileTreeOpen, historyOpen, setHistoryOpen }}>
      <div className="h-full flex min-w-0 overflow-hidden relative">
        {/* Multi-view sidebar (conversations, files, git, search) */}
        <ChatSidebar />

        {/* Main workspace area — EditorGroupContainer with tabs + splits */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <ChatWorkspace />
        </div>
      </div>
    </ChatSidebarContext>
  );
}
