import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useWorkspaceTree } from '@/client/hooks/useWorkspaceTree.js';
import { useGitStatus } from '@/client/hooks/useGitStatus.js';
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

/** Collect all leaf nodes from the editor tree */
function collectLeaves(node: import('@/client/types/layout-types.js').EditorGroupNode): import('@/client/types/layout-types.js').EditorGroupLeaf[] {
  if (node.type === 'leaf') return [node];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

function ConversationList() {
  const processes = useAgentStore((s) => s.processes);
  const setActiveProcessId = useAgentStore((s) => s.setActiveProcessId);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { state: layoutState, dispatch: layoutDispatch } = useLayoutContext();

  // Select a process: set active + lazy-load entries if empty
  const handleSelect = useCallback(async (processId: string) => {
    setActiveProcessId(processId);

    // Directly activate the tab in LayoutContext (don't rely solely on ChatWorkspace sync)
    const tabId = `chat-${processId}`;
    const leaves = collectLeaves(layoutState.editorArea);
    for (const leaf of leaves) {
      if (leaf.tabs.some((t) => t.id === tabId)) {
        if (leaf.activeTabId !== tabId) {
          layoutDispatch({ type: 'SET_ACTIVE_TAB', groupId: leaf.id, tabId });
        }
        break;
      }
    }

    // Use getState() to read latest entries (avoid stale closure)
    const { entries, setEntries } = useAgentStore.getState();
    const existing = entries[processId];
    // Skip fetch only if we already have content entries (user/assistant messages)
    if (existing && existing.some((e) => e.type === 'user_message' || e.type === 'assistant_message')) return;

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
        // Deduplicate token_usage: keep only the last one (cumulative totals)
        const tokenUsageIndices: number[] = [];
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].type === 'token_usage') tokenUsageIndices.push(i);
        }
        if (tokenUsageIndices.length > 1) {
          // Remove all but the last token_usage
          for (let i = tokenUsageIndices.length - 2; i >= 0; i--) {
            merged.splice(tokenUsageIndices[i], 1);
          }
        }

        // Synthesize user_message from process config if none exists
        const hasUserMessage = merged.some((e) => e.type === 'user_message');
        if (!hasUserMessage) {
          const proc = useAgentStore.getState().processes[processId];
          const prompt = proc?.config?.prompt;
          if (prompt) {
            const userEntry: NormalizedEntry = {
              id: `synth-user-${processId}`,
              processId,
              timestamp: proc.startedAt,
              type: 'user_message',
              content: prompt,
            } as NormalizedEntry;
            merged.unshift(userEntry);
          }
        }
        setEntries(processId, merged);
      }
    } catch { /* silent */ }
    setLoadingId(null);
  }, [setActiveProcessId, layoutState.editorArea, layoutDispatch]);

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
          <SearchView searchQuery={searchQuery} onSelectFile={handleSelectFile} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchView — file content search
// ---------------------------------------------------------------------------

interface SearchResult {
  file: string;
  line: number;
  text: string;
}

function SearchView({ searchQuery, onSelectFile }: { searchQuery: string; onSelectFile: (path: string) => void }) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchQuery.length < 2) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspace/search?q=${encodeURIComponent(searchQuery)}&limit=30`);
        if (res.ok) {
          const data = await res.json() as { results: SearchResult[]; total: number };
          setResults(data.results);
          setTotal(data.total);
          setCollapsedFiles(new Set());
        }
      } catch { /* silent */ }
      setLoading(false);
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // Group results by file
  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const list = map.get(r.file);
      if (list) list.push(r);
      else map.set(r.file, [r]);
    }
    return map;
  }, [results]);

  const toggleFile = useCallback((file: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }, []);

  if (searchQuery.length < 2) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Type to search across files
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Searching...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        No results
      </div>
    );
  }

  return (
    <div>
      <div className="text-[9px] px-[6px] py-[2px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {total} result{total !== 1 ? 's' : ''} in {grouped.size} file{grouped.size !== 1 ? 's' : ''}
      </div>
      {[...grouped.entries()].map(([file, matches]) => (
        <div key={file}>
          {/* File header */}
          <button
            type="button"
            onClick={() => toggleFile(file)}
            className="flex items-center gap-[4px] w-full border-none bg-transparent cursor-pointer text-left"
            style={{ padding: '4px 6px', fontFamily: 'inherit' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--color-text-tertiary)" style={{ transform: collapsedFiles.has(file) ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 100ms' }}>
              <path d="M2 1l4 3-4 3z" />
            </svg>
            <FileIcon />
            <span className="flex-1 min-w-0 text-[11px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
              {file}
            </span>
            <span className="text-[9px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
              {matches.length}
            </span>
          </button>
          {/* Match rows */}
          {!collapsedFiles.has(file) && matches.map((m) => (
            <button
              key={`${file}:${m.line}`}
              type="button"
              onClick={() => onSelectFile(file)}
              className="flex items-center gap-[6px] w-full border-none bg-transparent cursor-pointer text-left transition-colors duration-75"
              style={{ padding: '3px 7px 3px 22px', color: 'var(--color-text-primary)', fontFamily: 'inherit' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <span className="text-[10px] shrink-0 font-mono" style={{ color: 'var(--color-text-tertiary)', minWidth: 28, textAlign: 'right' }}>
                {m.line}
              </span>
              <span className="text-[11px] truncate min-w-0">{m.text.trim()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitView — full git source control sidebar
// ---------------------------------------------------------------------------

const STATUS_BADGE_STYLES: Record<string, { bg: string; color: string }> = {
  M: { bg: 'rgba(201,155,45,0.15)', color: 'var(--color-accent-yellow)' },
  A: { bg: 'rgba(61,155,111,0.15)', color: 'var(--color-accent-green)' },
  D: { bg: 'rgba(208,84,84,0.15)', color: 'var(--color-accent-red)' },
  R: { bg: 'rgba(130,130,200,0.15)', color: 'var(--color-accent-blue)' },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_STYLES[status] ?? STATUS_BADGE_STYLES.M;
  return (
    <span
      className="text-[9px] font-semibold px-[5px] rounded-[3px] shrink-0"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
      {status}
    </span>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ opacity: 0.6 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function GitFileRow({ path, status, onClick }: { path: string; status: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-[6px] px-[7px] py-[3px] rounded-[4px] cursor-pointer w-full border-none bg-transparent text-left transition-colors duration-75"
      style={{ color: 'var(--color-text-primary)', fontFamily: 'inherit' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
    >
      <FileIcon />
      <span className="flex-1 min-w-0 text-[11px] truncate">{path}</span>
      <StatusBadge status={status} />
    </button>
  );
}

function GitView() {
  const git = useGitStatus();
  const { state: layoutState, dispatch: layoutDispatch } = useLayoutContext();
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [commitsOpen, setCommitsOpen] = useState(true);

  const openFile = useCallback((filePath: string) => {
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

  if (git.loading && !git.branch) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading git status...
      </div>
    );
  }

  if (git.error && !git.branch) {
    return (
      <div className="px-[10px] py-[20px] text-center text-[11px]" style={{ color: 'var(--color-accent-red)' }}>
        {git.error}
      </div>
    );
  }

  const stagedCount = git.staged.length;
  const changesCount = git.unstaged.length + git.untracked.length;

  return (
    <div>
      {/* Branch bar */}
      <div className="flex items-center gap-[5px] px-[7px] py-[4px] text-[11px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="flex-1 min-w-0 truncate">{git.branch || 'unknown'}</span>
        <button
          type="button"
          onClick={git.refresh}
          title="Refresh"
          className="flex items-center justify-center border-none bg-transparent cursor-pointer rounded-[3px] transition-colors duration-75"
          style={{ width: 18, height: 18, color: 'var(--color-text-tertiary)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* Staged Changes */}
      {stagedCount > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setStagedOpen((v) => !v)}
            className="flex items-center gap-[4px] w-full border-none bg-transparent cursor-pointer text-left"
            style={{ padding: '4px 6px', fontFamily: 'inherit' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--color-text-tertiary)" style={{ transform: stagedOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 100ms' }}>
              <path d="M2 1l4 3-4 3z" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Staged Changes ({stagedCount})
            </span>
          </button>
          {stagedOpen && git.staged.map((f) => (
            <GitFileRow key={`staged-${f.path}`} path={f.path} status={f.status} onClick={() => openFile(f.path)} />
          ))}
        </div>
      )}

      {/* Changes (unstaged + untracked) */}
      {changesCount > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setChangesOpen((v) => !v)}
            className="flex items-center gap-[4px] w-full border-none bg-transparent cursor-pointer text-left"
            style={{ padding: '4px 6px', fontFamily: 'inherit' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--color-text-tertiary)" style={{ transform: changesOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 100ms' }}>
              <path d="M2 1l4 3-4 3z" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Changes ({changesCount})
            </span>
          </button>
          {changesOpen && (
            <>
              {git.unstaged.map((f) => (
                <GitFileRow key={`unstaged-${f.path}`} path={f.path} status={f.status} onClick={() => openFile(f.path)} />
              ))}
              {git.untracked.map((f) => (
                <GitFileRow key={`untracked-${f}`} path={f} status="A" onClick={() => openFile(f)} />
              ))}
            </>
          )}
        </div>
      )}

      {/* No changes message */}
      {stagedCount === 0 && changesCount === 0 && (
        <div className="px-[7px] py-[10px] text-center text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          No changes detected
        </div>
      )}

      {/* Recent Commits */}
      {git.commits.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setCommitsOpen((v) => !v)}
            className="flex items-center gap-[4px] w-full border-none bg-transparent cursor-pointer text-left"
            style={{ padding: '4px 6px', marginTop: 4, fontFamily: 'inherit' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="var(--color-text-tertiary)" style={{ transform: commitsOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 100ms' }}>
              <path d="M2 1l4 3-4 3z" />
            </svg>
            <span className="text-[9px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Recent Commits
            </span>
          </button>
          {commitsOpen && git.commits.map((commit) => (
            <div
              key={commit.hash}
              className="flex items-center gap-[6px] px-[7px] py-[3px] text-[10px]"
              style={{ color: 'var(--color-text-primary)', opacity: 0.7 }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                <circle cx="6" cy="6" r="3" fill="var(--color-text-tertiary)" />
              </svg>
              <span className="truncate min-w-0">
                <span className="font-mono" style={{ color: 'var(--color-accent-blue)', marginRight: 4 }}>{commit.shortHash}</span>
                {commit.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
