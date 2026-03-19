import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Columns2, Plus, X, MessageSquare, ChevronDown } from 'lucide-react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useResizableSplit } from '@/client/hooks/useResizableSplit.js';
import { useApprovalKeyboard } from '@/client/hooks/useApprovalKeyboard.js';
import { MessageArea } from './MessageArea.js';
import { ChatInput } from './ChatInput.js';
import { ThoughtDisplay } from './ThoughtDisplay.js';
import { SessionSidebar } from './SessionSidebar.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentProcess, AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// WelcomeView -- centered landing page shown when no session is active
// ---------------------------------------------------------------------------

function WelcomeView() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center"
      style={{ marginTop: '-5vh' }}
    >
      <div
        className="w-full px-4"
        style={{ maxWidth: 'clamp(360px, calc(100% - 32px), 780px)' }}
      >
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: 'var(--color-tint-exploring)' }}
          >
            <MessageSquare size={24} strokeWidth={1.5} style={{ color: 'var(--color-accent-blue)' }} />
          </div>
          <h1
            className="text-xl font-semibold mb-2 text-center"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Start a new conversation
          </h1>
          <p
            className="text-[13px] text-center"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Select an agent, type a message, and press Enter to begin.
          </p>
        </div>
        <ChatInput />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPage -- tab bar + split-pane chat layout (matches design-chat-v1a)
// ---------------------------------------------------------------------------

export function ChatPage() {
  const processes = useAgentStore((s) => s.processes);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const setActiveProcessId = useAgentStore((s) => s.setActiveProcessId);

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitProcessId, setSplitProcessId] = useState<string | null>(null);
  const { ratio: splitRatio, setRatio: setSplitRatio, handleMouseDown: handleDividerMouseDown, containerRef } = useResizableSplit({ defaultRatio: 50, minRatio: 25, maxRatio: 75 });

  const sortedProcesses = useMemo(() => {
    return Object.values(processes).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }, [processes]);

  // Track when the user explicitly entered new-session mode by clicking "+"
  const isNewSessionModeRef = useRef(false);
  // Use process count (a number) as dep — stable across status updates, only changes on add/remove
  const processCount = Object.keys(processes).length;
  const prevProcessCountRef = useRef(processCount);
  // Keep a ref to sorted processes so the effect can read the current list without it as a dep
  const sortedProcessesRef = useRef(sortedProcesses);
  sortedProcessesRef.current = sortedProcesses;

  // Auto-select first process on initial load or after spawn.
  // Does NOT auto-select when user intentionally clicked "+" (isNewSessionModeRef.current = true).
  useEffect(() => {
    const prevCount = prevProcessCountRef.current;
    prevProcessCountRef.current = processCount;

    if (isNewSessionModeRef.current) {
      // New-session mode: only auto-select when a new process actually spawns
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

  const splitProcess = splitProcessId ? processes[splitProcessId] : null;

  // Show welcome view when no active session
  const showWelcome = !activeProcessId;

  // Keyboard shortcuts for pending approvals on the active process
  useApprovalKeyboard(activeProcessId);

  // Close split if the split process is dismissed
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
    } else {
      // Open split with first non-active process
      const other = sortedProcesses.find((p) => p.id !== activeProcessId);
      if (other) {
        setSplitProcessId(other.id);
        setSplitOpen(true);
        setSplitRatio(50);
      }
    }
  }, [splitOpen, sortedProcesses, activeProcessId, setSplitRatio]);

  return (
    <div className="h-full flex min-w-0 overflow-hidden">
      {/* Session sidebar */}
      <SessionSidebar />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {showWelcome ? (
        /* Centered welcome view */
        <WelcomeView />
      ) : (
        <>
        {/* Floating tab bar */}
        <div className="sticky top-0 z-30 flex justify-center pt-2 pointer-events-none">
          <div
            className="inline-flex items-center gap-[2px] border rounded-[12px] p-[3px] pointer-events-auto"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              borderColor: 'var(--color-border)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            }}
          >
            {sortedProcesses.map((proc) => (
              <TabButton
                key={proc.id}
                process={proc}
                isActive={proc.id === activeProcessId}
                onClick={() => setActiveProcessId(proc.id)}
              />
            ))}
            {sortedProcesses.length > 1 && (
              <>
                <div className="w-px h-4" style={{ backgroundColor: 'var(--color-border-divider)', margin: '0 2px' }} />
                <button
                  type="button"
                  onClick={toggleSplit}
                  className="flex items-center px-2 py-[5px] rounded-[9px] border-none bg-transparent cursor-pointer transition-all duration-150"
                  style={{
                    color: splitOpen ? 'var(--color-accent-blue)' : 'var(--color-text-tertiary)',
                    backgroundColor: splitOpen ? 'var(--color-tint-exploring)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!splitOpen) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
                      (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!splitOpen) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
                    }
                  }}
                  aria-label="Toggle split view"
                >
                  <Columns2 size={14} strokeWidth={1.8} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                isNewSessionModeRef.current = true;
                setActiveProcessId(null);
              }}
              className="w-7 h-7 rounded-[8px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-150"
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
          </div>
        </div>

        {/* Split container */}
        <div ref={containerRef} className="flex-1 flex overflow-hidden">
          {/* Pane 1 (primary) */}
          <div className="flex flex-col min-w-0 overflow-hidden" style={{ flex: splitOpen ? `0 0 ${splitRatio}%` : '1' }}>
            <MessageArea processId={activeProcessId} />
            <ThoughtDisplay processId={activeProcessId} />
            {/* In split mode, bind input to this pane's process; otherwise use store default for spawn capability */}
            {splitOpen ? (
              <ChatInput processId={activeProcessId} executor={processes[activeProcessId!]?.type} />
            ) : (
              <ChatInput />
            )}
          </div>

          {/* Split divider */}
          {splitOpen && (
            <div
              className="w-[5px] shrink-0 cursor-col-resize relative transition-colors duration-150"
              style={{ backgroundColor: 'var(--color-border)' }}
              onMouseDown={handleDividerMouseDown}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-orange)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-border)'; }}
            />
          )}

          {/* Pane 2 (split) */}
          {splitOpen && (
            <div
              className="flex flex-col min-w-0 overflow-hidden border-l"
              style={{ flex: `0 0 ${100 - splitRatio}%`, borderColor: 'var(--color-border)' }}
            >
              <SplitPaneHeader
                processId={splitProcessId}
                processes={sortedProcesses}
                excludeProcessId={activeProcessId}
                onSelectProcess={setSplitProcessId}
                onClose={toggleSplit}
              />
              <MessageArea processId={splitProcessId} />
              <ThoughtDisplay processId={splitProcessId} />
              <ChatInput
                processId={splitProcessId}
                executor={splitProcess?.type}
              />
            </div>
          )}
        </div>
        </>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabButton — session tab in the floating bar
// ---------------------------------------------------------------------------

function TabButton({
  process,
  isActive,
  onClick,
}: {
  process: AgentProcess;
  isActive: boolean;
  onClick: () => void;
}) {
  const dotColor = AGENT_DOT_COLORS[process.type] ?? 'var(--color-text-tertiary)';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-[6px] px-3 py-[5px] rounded-[9px] border-none text-[11px] font-medium cursor-pointer transition-all duration-150"
      style={{
        backgroundColor: isActive ? 'var(--color-text-primary)' : 'transparent',
        color: isActive ? '#fff' : 'var(--color-text-tertiary)',
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
      <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
      {AGENT_LABELS[process.type] ?? process.type}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SplitPaneHeader — header for the split pane with session selector
// ---------------------------------------------------------------------------

function SplitPaneHeader({
  processId,
  processes,
  excludeProcessId,
  onSelectProcess,
  onClose,
}: {
  processId: string | null;
  processes: AgentProcess[];
  excludeProcessId: string | null;
  onSelectProcess: (id: string) => void;
  onClose: () => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const current = processId ? processes.find((p) => p.id === processId) : null;
  const dotColor = current ? (AGENT_DOT_COLORS[current.type] ?? 'var(--color-text-tertiary)') : 'var(--color-text-tertiary)';
  const label = current ? (AGENT_LABELS[current.type] ?? current.type) : 'Select session';
  const available = processes.filter((p) => p.id !== excludeProcessId);

  return (
    <div
      className="flex items-center gap-[6px] px-4 py-[6px] text-[11px] font-semibold shrink-0 border-b relative"
      style={{
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg-primary)',
        borderColor: 'var(--color-border-divider)',
      }}
    >
      {/* Session selector trigger */}
      <button
        type="button"
        onClick={() => setSelectorOpen(!selectorOpen)}
        className="flex items-center gap-[6px] border-none bg-transparent cursor-pointer text-[11px] font-semibold px-0"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: dotColor }} />
        {label}
        <ChevronDown size={10} strokeWidth={2} style={{ opacity: 0.5 }} />
      </button>

      {/* Session selector dropdown */}
      {selectorOpen && (
        <div
          className="absolute left-2 top-full mt-1 border rounded-[8px] p-1 z-50 min-w-[160px]"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          }}
        >
          {available.map((proc) => {
            const d = AGENT_DOT_COLORS[proc.type] ?? 'var(--color-text-tertiary)';
            const isSelected = proc.id === processId;
            return (
              <button
                key={proc.id}
                type="button"
                onClick={() => {
                  onSelectProcess(proc.id);
                  setSelectorOpen(false);
                }}
                className="flex items-center gap-[6px] w-full px-2 py-[5px] rounded-[6px] border-none cursor-pointer text-[11px] font-medium text-left transition-colors duration-100"
                style={{
                  backgroundColor: isSelected ? 'var(--color-bg-active)' : 'transparent',
                  color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }}
              >
                <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: d }} />
                {AGENT_LABELS[proc.type] ?? proc.type}
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  {proc.config.prompt.slice(0, 30)}{proc.config.prompt.length > 30 ? '...' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="ml-auto w-[18px] h-[18px] rounded flex items-center justify-center border-none bg-transparent cursor-pointer transition-all duration-100"
        style={{ color: 'var(--color-text-placeholder)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-tint-blocked)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-red)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-placeholder)';
        }}
        aria-label="Close split pane"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
