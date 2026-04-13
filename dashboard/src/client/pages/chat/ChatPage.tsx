import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Columns2 from 'lucide-react/dist/esm/icons/columns-2.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch.js';
import Zap from 'lucide-react/dist/esm/icons/zap.js';
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useUIPrefsStore } from '@/client/store/ui-prefs-store.js';
import { useResizableSplit } from '@/client/hooks/useResizableSplit.js';
import { useApprovalKeyboard } from '@/client/hooks/useApprovalKeyboard.js';
import { useWorkspaceTree } from '@/client/hooks/useWorkspaceTree.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { MessageArea } from './MessageArea.js';
import { ChatInput } from './ChatInput.js';
import { ThoughtDisplay } from './ThoughtDisplay.js';
import { HistoryPanel } from './SessionSidebar.js';
import { FileViewer } from './FileViewer.js';
import { TreeBrowser } from '@/client/components/artifacts/TreeBrowser.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentProcess, AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

const STATUS_LABELS: Record<string, string> = {
  spawning: 'Starting…',
  running: 'Running',
  paused: 'Paused',
  stopping: 'Stopping…',
  stopped: 'Stopped',
  error: 'Error',
};

function isAsyncDelegateProcess(process: AgentProcess): boolean {
  return process.id.startsWith('cli-history-');
}

// ---------------------------------------------------------------------------
// WelcomeView
// ---------------------------------------------------------------------------

const COWORK_QUICK_START = [
  {
    title: 'Explore your codebase',
    desc: 'Ask questions, trace code paths, understand architecture',
    icon: Search,
    iconColor: 'var(--color-accent-blue)',
    iconBg: 'var(--color-tint-exploring)',
  },
  {
    title: 'Plan a feature',
    desc: 'Break down requirements into phases and tasks',
    icon: GitBranch,
    iconColor: 'var(--color-accent-purple)',
    iconBg: 'var(--color-tint-planning)',
  },
  {
    title: 'Execute a workflow',
    desc: 'Run parallel tasks with automatic verification',
    icon: Zap,
    iconColor: 'var(--color-accent-orange)',
    iconBg: 'var(--color-tint-verifying)',
  },
  {
    title: 'Review & debug',
    desc: 'Multi-dimensional code review and hypothesis-driven debugging',
    icon: LayoutDashboard,
    iconColor: 'var(--color-accent-green)',
    iconBg: 'var(--color-tint-completed)',
  },
] as const;

function WelcomeView() {
  const stylePreset = useUIPrefsStore((s) => s.stylePreset);

  if (stylePreset === 'cowork') {
    return (
      <div className="flex-1 flex flex-col" style={{ paddingTop: '12vh' }}>
        <div className="w-full px-6" style={{ maxWidth: 680 }}>
          <h1
            style={{
              fontFamily: 'var(--style-heading-font)',
              fontSize: 'var(--style-heading-size)',
              fontWeight: 'var(--style-heading-weight)',
              letterSpacing: 'var(--style-heading-letter-spacing)',
              color: 'var(--color-text-primary)',
              margin: 0,
            }}
          >
            Let's build something together
          </h1>
          <p
            className="mt-2 mb-6"
            style={{ color: 'var(--color-text-tertiary)', fontSize: 14, margin: '8px 0 24px' }}
          >
            Maestro workflow orchestration.
          </p>
          <ChatInput />
          <div className="mt-8">
            <p
              className="mb-3"
              style={{ color: 'var(--color-text-tertiary)', fontSize: 12, fontWeight: 500 }}
            >
              Get started with Maestro
            </p>
            <div className="flex flex-col gap-[2px]">
              {COWORK_QUICK_START.map((item) => (
                <div
                  key={item.title}
                  className="flex items-center gap-3 px-2 py-[6px] rounded-[8px] cursor-pointer transition-colors duration-150"
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  }}
                >
                  <div
                    className="shrink-0 flex items-center justify-center rounded-[10px]"
                    style={{
                      width: 36,
                      height: 36,
                      backgroundColor: item.iconBg,
                    }}
                  >
                    <item.icon size={18} strokeWidth={1.5} style={{ color: item.iconColor }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center" style={{ marginTop: '-5vh' }}>
      <div className="w-full px-4" style={{ maxWidth: 'clamp(360px, calc(100% - 32px), 780px)' }}>
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: 'var(--color-tint-exploring)' }}
          >
            <MessageSquare size={24} strokeWidth={1.5} style={{ color: 'var(--color-accent-blue)' }} />
          </div>
          <h1 className="text-xl font-semibold mb-2 text-center" style={{ color: 'var(--color-text-primary)' }}>
            Start a new conversation
          </h1>
          <p className="text-[13px] text-center" style={{ color: 'var(--color-text-tertiary)' }}>
            Select an agent, type a message, and press Enter to begin.
          </p>
        </div>
        <ChatInput />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabButton — session tab with dismiss + hover tooltip
// ---------------------------------------------------------------------------

function TabButton({
  process,
  isActive,
  onClick,
  onDismiss,
}: {
  process: AgentProcess;
  isActive: boolean;
  onClick: () => void;
  onDismiss?: () => void;
}) {
  const dotColor = AGENT_DOT_COLORS[process.type] ?? 'var(--color-text-tertiary)';
  const label = AGENT_LABELS[process.type] ?? process.type;
  const asyncDelegate = isAsyncDelegateProcess(process);

  const tooltipText = `${label}${asyncDelegate ? ' · Async Delegate' : ''} · ${STATUS_LABELS[process.status] ?? process.status}\n${process.config.prompt.slice(0, 100)}${process.config.prompt.length > 100 ? '…' : ''}\n${formatTime(process.startedAt)} · ${process.type}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltipText}
      className="group/tab flex items-center gap-[6px] px-3 py-[5px] rounded-[9px] border-none text-[11px] font-medium cursor-pointer transition-all duration-150 shrink-0 relative"
      style={{
        backgroundColor: isActive ? 'var(--color-text-primary)' : 'transparent',
        color: isActive ? '#fff' : 'var(--color-text-tertiary)',
        paddingRight: onDismiss ? '22px' : undefined,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
        }
      }}
    >
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: isActive ? '#fff' : dotColor }} />
      {label}
      {asyncDelegate && (
        <span
          className="px-[4px] py-[1px] rounded text-[9px] font-semibold"
          style={{
            backgroundColor: isActive ? 'rgba(255,255,255,0.16)' : 'var(--color-tint-exploring)',
            color: isActive ? '#fff' : 'var(--color-accent-blue)',
          }}
        >
          ASYNC
        </span>
      )}

      {/* Dismiss X */}
      {onDismiss && (
        <span
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] rounded-sm flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity duration-100"
          style={{ color: isActive ? 'rgba(255,255,255,0.6)' : 'var(--color-text-placeholder)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = isActive ? '#fff' : 'var(--color-accent-red)';
            e.currentTarget.style.backgroundColor = isActive ? 'rgba(255,255,255,0.15)' : 'var(--color-tint-blocked)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = isActive ? 'rgba(255,255,255,0.6)' : 'var(--color-text-placeholder)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <X size={10} strokeWidth={2} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// GlobalTabBar — always-visible, shows session tabs (non-split) or just
//                utility buttons (split mode)
// ---------------------------------------------------------------------------

function GlobalTabBar({
  sortedProcesses,
  activeProcessId,
  splitOpen,
  historyOpen,
  fileTreeOpen,
  onSelectProcess,
  onDismissProcess,
  onNewSession,
  onToggleSplit,
  onToggleHistory,
  onToggleFileTree,
}: {
  sortedProcesses: AgentProcess[];
  activeProcessId: string | null;
  splitOpen: boolean;
  historyOpen: boolean;
  fileTreeOpen: boolean;
  onSelectProcess: (id: string) => void;
  onDismissProcess: (id: string) => void;
  onNewSession: () => void;
  onToggleSplit: () => void;
  onToggleHistory: () => void;
  onToggleFileTree: () => void;
}) {
  return (
    <div className="sticky top-0 z-30 flex justify-center pt-2 pointer-events-none shrink-0">
      <div
        className="inline-flex items-center gap-[2px] border rounded-[12px] p-[3px] pointer-events-auto"
        style={{
          backgroundColor: 'var(--color-bg-card)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
          maxWidth: 'calc(100% - 32px)',
        }}
      >
        {/* Session tabs — only in non-split mode */}
        {!splitOpen && (sortedProcesses.length > 0 || activeProcessId === null) && (
          <div
            className="flex items-center gap-[2px] overflow-x-auto"
            style={{ scrollbarWidth: 'thin', maxWidth: 'min(600px, 60vw)' }}
            onWheel={(e) => {
              // Convert vertical scroll to horizontal scroll for the tab list
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.currentTarget.scrollLeft += e.deltaY;
                e.preventDefault();
              }
            }}
          >
            {sortedProcesses.map((proc) => (
              <TabButton
                key={proc.id}
                process={proc}
                isActive={proc.id === activeProcessId}
                onClick={() => onSelectProcess(proc.id)}
                onDismiss={() => onDismissProcess(proc.id)}
              />
            ))}
            {/* "New" tab — shown when in new-session mode */}
            {activeProcessId === null && (
              <button
                type="button"
                className="flex items-center gap-[6px] px-3 py-[5px] rounded-[9px] border-none text-[11px] font-medium cursor-pointer shrink-0"
                style={{
                  backgroundColor: 'var(--color-text-primary)',
                  color: '#fff',
                }}
              >
                <Plus size={10} strokeWidth={2.5} />
                New
              </button>
            )}
          </div>
        )}

        {/* Split toggle — only when 2+ sessions */}
        {sortedProcesses.length > 1 && (
          <>
            {!splitOpen && sortedProcesses.length > 0 && (
              <div className="w-px h-4 shrink-0" style={{ backgroundColor: 'var(--color-border-divider)', margin: '0 2px' }} />
            )}
            <IconButton
              icon={<Columns2 size={14} strokeWidth={1.8} />}
              isActive={splitOpen}
              onClick={onToggleSplit}
              label="Toggle split view"
            />
          </>
        )}

        {/* New session */}
        <button
          type="button"
          onClick={onNewSession}
          className="w-7 h-7 rounded-[8px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-150 shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
          }}
          aria-label="New session"
        >
          <Plus size={14} strokeWidth={2} />
        </button>

        {/* File tree toggle */}
        <div className="w-px h-4 shrink-0" style={{ backgroundColor: 'var(--color-border-divider)', margin: '0 2px' }} />
        <IconButton
          icon={<FolderTree size={14} strokeWidth={1.8} />}
          isActive={fileTreeOpen}
          onClick={onToggleFileTree}
          label="Toggle file tree"
        />

        {/* History toggle */}
        <IconButton
          icon={<Clock size={14} strokeWidth={1.8} />}
          isActive={historyOpen}
          onClick={onToggleHistory}
          label="Toggle history"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaneTabBar — per-pane floating tab bar (used in split mode)
// ---------------------------------------------------------------------------

function PaneTabBar({
  sortedProcesses,
  currentProcessId,
  onSelectProcess,
  onClose,
}: {
  sortedProcesses: AgentProcess[];
  currentProcessId: string | null;
  onSelectProcess: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex justify-center pt-[6px] pb-[2px] pointer-events-none shrink-0">
      <div
        className="inline-flex items-center gap-[2px] border rounded-[10px] p-[2px] pointer-events-auto"
        style={{
          backgroundColor: 'var(--color-bg-card)',
          borderColor: 'var(--color-border)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          maxWidth: 'calc(100% - 16px)',
        }}
      >
        <div
          className="flex items-center gap-[2px] overflow-x-auto"
          style={{ scrollbarWidth: 'thin', maxWidth: 'min(400px, 100%)' }}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
              e.preventDefault();
            }
          }}
        >
          {sortedProcesses.map((proc) => (
            <TabButton
              key={proc.id}
              process={proc}
              isActive={proc.id === currentProcessId}
              onClick={() => onSelectProcess(proc.id)}
            />
          ))}
        </div>

        {/* Close pane button */}
        {onClose && (
          <>
            <div className="w-px h-3 shrink-0" style={{ backgroundColor: 'var(--color-border-divider)', margin: '0 1px' }} />
            <button
              type="button"
              onClick={onClose}
              className="w-[22px] h-[22px] rounded-[6px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-100 shrink-0"
              style={{ color: 'var(--color-text-placeholder)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-tint-blocked)';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-red)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-text-placeholder)';
              }}
              aria-label="Close pane"
            >
              <X size={10} strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IconButton — small toggle button for the tab bar
// ---------------------------------------------------------------------------

function IconButton({
  icon,
  isActive,
  onClick,
  label,
}: {
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center px-2 py-[5px] rounded-[9px] border-none bg-transparent cursor-pointer transition-all duration-150 shrink-0"
      style={{
        color: isActive ? 'var(--color-accent-blue)' : 'var(--color-text-tertiary)',
        backgroundColor: isActive ? 'var(--color-tint-exploring)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
        }
      }}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChatPage
// ---------------------------------------------------------------------------

export function ChatPage() {
  const processes = useAgentStore((s) => s.processes);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const setActiveProcessId = useAgentStore((s) => s.setActiveProcessId);
  const dismissProcess = useAgentStore((s) => s.dismissProcess);

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitProcessId, setSplitProcessId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [fileViewerPath, setFileViewerPath] = useState<string | null>(null);
  const { ratio: splitRatio, setRatio: setSplitRatio, createDragHandle } = useResizableSplit({ defaultRatio: 50, minRatio: 25, maxRatio: 75, storageKey: 'chat-split-ratio' });
  const workspace = useWorkspaceTree();

  const sortedProcesses = useMemo(() => {
    return Object.values(processes).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [processes]);

  const isNewSessionModeRef = useRef(false);
  const processCount = Object.keys(processes).length;
  const prevProcessCountRef = useRef(processCount);
  const sortedProcessesRef = useRef(sortedProcesses);
  sortedProcessesRef.current = sortedProcesses;

  useEffect(() => {
    const prevCount = prevProcessCountRef.current;
    prevProcessCountRef.current = processCount;

    if (isNewSessionModeRef.current) {
      if (processCount > prevCount) {
        isNewSessionModeRef.current = false;
        const first = sortedProcessesRef.current[0];
        if (first) setActiveProcessId(first.id);
      }
      return;
    }

    if (!activeProcessId && processCount > 0) {
      const first = sortedProcessesRef.current[0];
      if (first) setActiveProcessId(first.id);
    }
  }, [activeProcessId, processCount, setActiveProcessId]);

  // Auto-dismiss stopped/error sessions after 2 minutes (non-active only)
  const autoDismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const AUTO_DISMISS_MS = 2 * 60 * 1000;
    for (const proc of sortedProcesses) {
      const isTerminal = proc.status === 'stopped' || proc.status === 'error';
      const isActive = proc.id === activeProcessId;
      if (isTerminal && !isActive && !autoDismissTimers.current[proc.id]) {
        autoDismissTimers.current[proc.id] = setTimeout(() => {
          delete autoDismissTimers.current[proc.id];
          dismissProcess(proc.id);
        }, AUTO_DISMISS_MS);
      }
      // Cancel timer if process becomes active or resumes running
      if ((!isTerminal || isActive) && autoDismissTimers.current[proc.id]) {
        clearTimeout(autoDismissTimers.current[proc.id]);
        delete autoDismissTimers.current[proc.id];
      }
    }
    // Cleanup timers for processes that no longer exist
    for (const id of Object.keys(autoDismissTimers.current)) {
      if (!processes[id]) {
        clearTimeout(autoDismissTimers.current[id]);
        delete autoDismissTimers.current[id];
      }
    }
  }, [sortedProcesses, activeProcessId, dismissProcess, processes]);

  const splitProcess = splitProcessId ? processes[splitProcessId] : null;
  const showWelcome = !activeProcessId;

  useApprovalKeyboard(activeProcessId);

  useEffect(() => {
    if (splitOpen && splitProcessId && !processes[splitProcessId]) {
      setSplitOpen(false);
      setSplitProcessId(null);
    }
  }, [splitOpen, splitProcessId, processes]);

  const toggleSplit = useCallback(() => {
    if (splitOpen) {
      setSplitOpen(false);
      setSplitProcessId(null);
      setFileViewerPath(null);
    } else {
      const other = sortedProcesses.find((p) => p.id !== activeProcessId);
      if (other) {
        setSplitProcessId(other.id);
        setSplitOpen(true);
        setSplitRatio(50);
      }
    }
  }, [splitOpen, sortedProcesses, activeProcessId, setSplitRatio]);

  const handleDismissProcess = useCallback((processId: string) => {
    const proc = processes[processId];
    if (proc && (proc.status === 'running' || proc.status === 'spawning')) {
      sendWsMessage({ action: 'stop', processId });
    }
    dismissProcess(processId);
  }, [processes, dismissProcess]);

  const handleNewSession = useCallback(() => {
    isNewSessionModeRef.current = true;
    setActiveProcessId(null);
  }, [setActiveProcessId]);

  // File viewer: if already showing a file → refresh in place; otherwise open split
  const handleSelectFile = useCallback((path: string) => {
    if (fileViewerPath !== null) {
      // File viewer already open — refresh content
      setFileViewerPath(path);
    } else {
      // No file viewer — open split with file viewer
      setFileViewerPath(path);
      setSplitOpen(true);
      setSplitProcessId(null);
      setSplitRatio(50);
    }
  }, [fileViewerPath, setSplitRatio]);

  const closeFileViewer = useCallback(() => {
    setFileViewerPath(null);
    setSplitOpen(false);
    setSplitProcessId(null);
  }, []);

  return (
    <div className="h-full flex min-w-0 overflow-hidden relative">
      {/* Collapsible file tree panel */}
      <div
        className="shrink-0 flex flex-col overflow-hidden border-r transition-[width] duration-200 ease-[var(--ease-notion)]"
        style={{
          width: fileTreeOpen ? 260 : 0,
          borderColor: fileTreeOpen ? 'var(--color-border)' : 'transparent',
        }}
      >
        {fileTreeOpen && (
          <TreeBrowser
            tree={workspace.tree}
            selectedPath={fileViewerPath}
            onSelectFile={handleSelectFile}
            loading={workspace.loading}
          />
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {/* Global tab bar — always visible */}
      <GlobalTabBar
        sortedProcesses={sortedProcesses}
        activeProcessId={activeProcessId}
        splitOpen={splitOpen}
        historyOpen={historyOpen}
        fileTreeOpen={fileTreeOpen}
        onSelectProcess={setActiveProcessId}
        onDismissProcess={handleDismissProcess}
        onNewSession={handleNewSession}
        onToggleSplit={toggleSplit}
        onToggleHistory={() => setHistoryOpen(!historyOpen)}
        onToggleFileTree={() => setFileTreeOpen(!fileTreeOpen)}
      />

      {/* File viewer only — no active chat process */}
      {showWelcome && fileViewerPath ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <FileViewer filePath={fileViewerPath} onClose={closeFileViewer} />
        </div>
      ) : showWelcome ? (
        <WelcomeView />
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0 relative">
          {/* Pane 1 — chat */}
          <div className="flex flex-col min-w-0 overflow-hidden" style={{ flex: splitOpen ? `0 0 ${splitRatio}%` : '1' }}>
            {splitOpen && !fileViewerPath && (
              <PaneTabBar
                sortedProcesses={sortedProcesses}
                currentProcessId={activeProcessId}
                onSelectProcess={setActiveProcessId}
              />
            )}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <MessageArea processId={activeProcessId} />
            </div>
            <ThoughtDisplay processId={activeProcessId} />
            {splitOpen && !fileViewerPath ? (
              <ChatInput processId={activeProcessId} executor={processes[activeProcessId!]?.type} />
            ) : (
              <ChatInput />
            )}
          </div>

          {/* Divider drag handle */}
          {splitOpen && (
            <div className="relative shrink-0" style={{ width: 0 }}>
              {createDragHandle({
                className: 'left-[-6px]',
                linePlacement: 'end',
                lineClassName: 'opacity-40 group-hover:opacity-100 group-active:opacity-100',
                lineStyle: { backgroundColor: 'var(--color-accent-orange)' },
              })}
            </div>
          )}

          {/* Pane 2 — file viewer or chat session */}
          {splitOpen && (
            <div
              className="flex flex-col min-w-0 overflow-hidden border-l"
              style={{ flex: `0 0 ${100 - splitRatio}%`, borderColor: 'var(--color-border)' }}
            >
              {fileViewerPath ? (
                <FileViewer filePath={fileViewerPath} onClose={closeFileViewer} />
              ) : (
                <>
                  <PaneTabBar
                    sortedProcesses={sortedProcesses}
                    currentProcessId={splitProcessId}
                    onSelectProcess={setSplitProcessId}
                    onClose={toggleSplit}
                  />
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <MessageArea processId={splitProcessId} />
                  </div>
                  <ThoughtDisplay processId={splitProcessId} />
                  <ChatInput
                    processId={splitProcessId}
                    executor={splitProcess?.type}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      <HistoryPanel open={historyOpen} />
    </div>
  );
}
