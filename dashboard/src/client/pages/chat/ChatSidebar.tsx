import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useWorkspaceTree } from '@/client/hooks/useWorkspaceTree.js';
import { useLayoutContext } from '@/client/components/layout/LayoutContext.js';
import { TreeBrowser } from '@/client/components/artifacts/TreeBrowser.js';
import { useChatSidebar, type SidebarTab } from '@/client/components/chat/ChatSidebarContext.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentProcess, NormalizedEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ChatSidebar — multi-view sidebar matching chat.html reference
// ---------------------------------------------------------------------------

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TAB_ICONS: Record<SidebarTab, { title: string; path: string }> = {
  chat: {
    title: 'Conversations',
    path: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  files: {
    title: 'Explorer',
    path: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  },
  git: {
    title: 'Source Control',
    path: '', // custom SVG below
  },
  search: {
    title: 'Search',
    path: '', // custom SVG below
  },
};

function TabIcon({ tab }: { tab: SidebarTab }) {
  if (tab === 'git') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" />
      </svg>
    );
  }
  if (tab === 'search') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={TAB_ICONS[tab].path} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ConversationList — list of agent processes grouped by active/completed
// ---------------------------------------------------------------------------

function ConversationList() {
  const processes = useAgentStore((s) => s.processes);
  const setActiveProcessId = useAgentStore((s) => s.setActiveProcessId);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Select a process: set active + lazy-load entries if empty
  const handleSelect = useCallback(async (processId: string) => {
    setActiveProcessId(processId);

    // Use getState() to read latest entries (avoid stale closure)
    const { entries, addEntry } = useAgentStore.getState();
    const existing = entries[processId];
    if (existing && existing.length > 0) return;

    setLoadingId(processId);
    try {
      // Determine the correct API: cli-history vs live agent
      const isCliHistory = processId.startsWith('cli-history-');
      const execId = isCliHistory ? processId.replace('cli-history-', '') : processId;
      const url = isCliHistory
        ? `/api/cli-history/${encodeURIComponent(execId)}/entries`
        : `/api/agents/${encodeURIComponent(processId)}/entries`;

      const res = await fetch(url);
      if (res.ok) {
        const raw = (await res.json()) as NormalizedEntry[];
        // Post-process: merge consecutive assistant_message fragments, fix processId
        const merged: NormalizedEntry[] = [];
        for (const entry of raw) {
          const fixed = { ...entry, processId } as NormalizedEntry;
          if (fixed.type === 'assistant_message') {
            (fixed as { partial: boolean }).partial = false;
            const prev = merged[merged.length - 1];
            if (prev && prev.type === 'assistant_message') {
              (prev as { content: string }).content += (fixed as { content: string }).content;
              continue;
            }
          }
          // Merge tool_use running→completed pairs
          if (fixed.type === 'tool_use' && (fixed.status === 'completed' || fixed.status === 'failed')) {
            const runIdx = merged.findLastIndex(
              (e) => e.type === 'tool_use' && (e as typeof fixed).status === 'running',
            );
            if (runIdx !== -1) {
              const running = merged[runIdx] as typeof fixed;
              merged[runIdx] = {
                ...running,
                status: fixed.status,
                result: fixed.result ?? running.result,
                input: (running.input && Object.keys(running.input).length > 0) ? running.input : fixed.input,
              } as NormalizedEntry;
              continue;
            }
          }
          merged.push(fixed);
        }
        for (const entry of merged) {
          addEntry(processId, entry);
        }
      }
    } catch { /* silent */ }
    setLoadingId(null);
  }, [setActiveProcessId]);

  const { active, completed } = useMemo(() => {
    const all = Object.values(processes);
    const activeList: AgentProcess[] = [];
    const completedList: AgentProcess[] = [];
    for (const p of all) {
      if (p.status === 'running' || p.status === 'spawning') {
        activeList.push(p);
      } else {
        completedList.push(p);
      }
    }
    // Sort by startedAt descending
    activeList.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    completedList.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return { active: activeList, completed: completedList };
  }, [processes]);

  if (active.length === 0 && completed.length === 0) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        No conversations yet
      </div>
    );
  }

  return (
    <>
      {active.length > 0 && (
        <>
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.04em] px-[6px] pt-[6px] pb-[2px]"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Active ({active.length})
          </div>
          {active.map((p) => (
            <ConversationItem key={p.id} process={p} isActive={p.id === activeProcessId} loading={loadingId === p.id} onSelect={handleSelect} />
          ))}
        </>
      )}
      {completed.length > 0 && (
        <>
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.04em] px-[6px] pt-[8px] pb-[2px]"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Completed ({completed.length})
          </div>
          {completed.map((p) => (
            <ConversationItem key={p.id} process={p} isActive={p.id === activeProcessId} loading={loadingId === p.id} onSelect={handleSelect} />
          ))}
        </>
      )}
    </>
  );
}

function ConversationItem({
  process,
  isActive,
  loading,
  onSelect,
}: {
  process: AgentProcess;
  isActive: boolean;
  loading?: boolean;
  onSelect: (id: string) => void;
}) {
  const isRunning = process.status === 'running' || process.status === 'spawning';
  const dotColor = isRunning
    ? 'var(--color-accent-green)'
    : process.status === 'error'
      ? 'var(--color-accent-red, #D05454)'
      : 'var(--color-text-placeholder)';
  const agentLabel = AGENT_LABELS[process.type] ?? process.type;
  const title = process.config?.prompt?.slice(0, 40) || agentLabel;

  return (
    <button
      type="button"
      onClick={() => onSelect(process.id)}
      className="flex items-center gap-[7px] w-full rounded-[5px] border-none cursor-pointer transition-all duration-100 text-left"
      style={{
        padding: '5px 7px',
        backgroundColor: isActive ? 'var(--color-bg-active)' : 'transparent',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
      }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </div>
        <div className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {formatTimeAgo(process.startedAt)} &middot; {agentLabel.toLowerCase()}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChatSidebar — main component
// ---------------------------------------------------------------------------

/** Get first leaf from editor tree */
function getFirstLeaf(node: import('@/client/types/layout-types.js').EditorGroupNode): import('@/client/types/layout-types.js').EditorGroupLeaf {
  return node.type === 'leaf' ? node : getFirstLeaf(node.first);
}

export function ChatSidebar() {
  const { sidebarOpen, activeTab, setActiveTab } = useChatSidebar();
  const [searchQuery, setSearchQuery] = useState('');
  const workspace = useWorkspaceTree();
  const { state: layoutState, dispatch: layoutDispatch } = useLayoutContext();

  // Open file as a tab in the editor
  const handleSelectFile = useCallback((filePath: string) => {
    const leaf = getFirstLeaf(layoutState.editorArea);
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    layoutDispatch({
      type: 'OPEN_TAB',
      groupId: leaf.id,
      tab: {
        id: `file-${filePath}`,
        type: 'file',
        title: fileName,
        ref: filePath,
      },
    });
  }, [layoutState.editorArea, layoutDispatch]);

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden transition-[width] duration-200"
      style={{
        width: sidebarOpen ? 230 : 0,
        backgroundColor: 'var(--color-bg-secondary)',
        borderRight: sidebarOpen ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {/* Tab header */}
      <div
        className="flex items-center shrink-0"
        style={{
          height: 32,
          padding: '0 4px',
          borderBottom: '1px solid var(--color-border-divider)',
        }}
      >
        {(['chat', 'files', 'git', 'search'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            title={TAB_ICONS[tab].title}
            className="flex items-center justify-center border-none bg-transparent cursor-pointer transition-all duration-100"
            style={{
              width: 30,
              height: 32,
              color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              borderBottom: activeTab === tab ? '2px solid var(--color-text-primary)' : '2px solid transparent',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
            }}
          >
            <TabIcon tab={tab} />
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="px-[8px] py-[4px]">
        <div className="relative">
          <svg
            className="absolute left-[7px] top-1/2 -translate-y-1/2 pointer-events-none"
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-placeholder)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full py-[4px] pl-[26px] pr-[7px] text-[11px] rounded-[5px] border outline-none transition-[border-color] duration-100"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-bg-card)',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent-blue)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; }}
          />
        </div>
      </div>

      {/* View body */}
      <div className="flex-1 overflow-y-auto px-[6px] pb-[8px]">
        {activeTab === 'chat' && <ConversationList />}
        {activeTab === 'files' && (
          <TreeBrowser
            tree={workspace.tree}
            selectedPath={null}
            onSelectFile={handleSelectFile}
            loading={workspace.loading}
          />
        )}
        {activeTab === 'git' && (
          <GitView />
        )}
        {activeTab === 'search' && (
          <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Type to search across files
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitView — basic git status display
// ---------------------------------------------------------------------------

function GitView() {
  const [branch, setBranch] = useState('');

  useEffect(() => {
    fetch('/api/board')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.project?.branch) setBranch(data.project.branch);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <div
        className="flex items-center gap-[5px] text-[11px] font-medium px-[7px] py-[4px]"
        style={{ color: 'var(--color-text-primary)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        {branch || 'master'}
      </div>
      <div className="px-[7px] py-[10px] text-center text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Git status available in terminal
      </div>
    </div>
  );
}
