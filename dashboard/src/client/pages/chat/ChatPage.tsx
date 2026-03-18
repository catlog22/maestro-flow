import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Columns2, Plus, X } from 'lucide-react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useResizableSplit } from '@/client/hooks/useResizableSplit.js';
import { useApprovalKeyboard } from '@/client/hooks/useApprovalKeyboard.js';
import { MessageArea } from './MessageArea.js';
import { ChatInput } from './ChatInput.js';
import { ThoughtDisplay } from './ThoughtDisplay.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentProcess, AgentType } from '@/shared/agent-types.js';

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
      if (processCount > prevCount && !activeProcessId) {
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

  const activeProcess = activeProcessId ? processes[activeProcessId] : null;
  const splitProcess = splitProcessId ? processes[splitProcessId] : null;

  // Keyboard shortcuts for pending approvals on the active process
  useApprovalKeyboard(activeProcessId);

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
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
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
          <ChatInput />
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
        {splitOpen && splitProcess && (
          <div
            className="flex flex-col min-w-0 overflow-hidden border-l"
            style={{ flex: `0 0 ${100 - splitRatio}%`, borderColor: 'var(--color-border)' }}
          >
            <SplitPaneLabel process={splitProcess} onClose={toggleSplit} />
            <MessageArea processId={splitProcessId} />
          </div>
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
// SplitPaneLabel — header for the second split pane
// ---------------------------------------------------------------------------

function SplitPaneLabel({ process, onClose }: { process: AgentProcess; onClose: () => void }) {
  const dotColor = AGENT_DOT_COLORS[process.type] ?? 'var(--color-text-tertiary)';

  return (
    <div
      className="flex items-center gap-[6px] px-4 py-[6px] text-[11px] font-semibold shrink-0 border-b"
      style={{
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg-primary)',
        borderColor: 'var(--color-border-divider)',
      }}
    >
      <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: dotColor }} />
      {AGENT_LABELS[process.type] ?? process.type}
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
