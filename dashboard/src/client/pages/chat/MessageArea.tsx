import { useState, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useAutoScroll } from '@/client/hooks/useAutoScroll.js';
import { EntryRenderer } from './entries/index.js';
import { EntryContextMenu } from './entries/EntryContextMenu.js';
import { AVATAR_CONFIG } from './entries/AssistantMessage.js';
import { CreateIssueDialog } from '@/client/components/issues/CreateIssueDialog.js';
import type { NormalizedEntry, AgentType } from '@/shared/agent-types.js';
import type { CreateIssueRequest } from '@/shared/issue-types.js';

// Stable empty array to avoid infinite re-render from Zustand selector
const EMPTY_ENTRIES: NormalizedEntry[] = [];

// ---------------------------------------------------------------------------
// AgentLoadingPlaceholder -- avatar + bouncing dots shown while waiting for response
// ---------------------------------------------------------------------------

function AgentLoadingPlaceholder({ agentType }: { agentType?: AgentType }) {
  const cfg = AVATAR_CONFIG[agentType ?? 'claude-code'] ?? AVATAR_CONFIG['claude-code'];
  return (
    <div className="max-w-[700px] mx-auto px-4">
      <div className="flex gap-[8px]" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div
          className="relative shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center mt-[2px] text-[10px] font-bold"
          style={{ backgroundColor: cfg.tint, color: cfg.color }}
        >
          {cfg.label}
          <span
            className="absolute inset-[-3px] rounded-[8px] pointer-events-none"
            style={{
              border: '1.5px solid currentColor',
              color: cfg.color,
              opacity: 0.3,
              animation: 'avatar-pulse 2.5s ease-in-out infinite',
            }}
          />
        </div>
        <div className="flex items-center gap-[3px] pt-[6px]">
          <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '0ms', opacity: 0.7 }} />
          <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '150ms', opacity: 0.7 }} />
          <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '300ms', opacity: 0.7 }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageArea -- virtualized scrollable message list for a given process
// ---------------------------------------------------------------------------

export function MessageArea({ processId }: { processId: string | null }) {
  const entries = useAgentStore((s) =>
    processId ? (s.entries[processId] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES,
  );
  const process = useAgentStore((s) =>
    processId ? s.processes[processId] : undefined,
  );

  const {
    virtuosoRef,
    handleScroll,
    handleFollowOutput,
    handleAtBottomStateChange,
    showScrollButton,
    scrollToBottom,
  } = useAutoScroll({ entries, itemCount: entries.length });

  // Issue creation state
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issuePrefill, setIssuePrefill] = useState<Partial<CreateIssueRequest> | undefined>();

  const handleCreateIssue = useCallback((prefill: Partial<CreateIssueRequest>) => {
    setIssuePrefill(prefill);
    setIssueDialogOpen(true);
  }, []);

  const processStatus = process?.status;
  const isCliHistory = processId?.startsWith('cli-history-') ?? false;
  // cli-history processes with "running" status are stale — not truly active
  const isActive = !isCliHistory && (processStatus === 'running' || processStatus === 'spawning');

  // Show loading placeholder when agent is active but hasn't started streaming a response
  const showLoadingPlaceholder = useMemo(() => {
    if (!isActive || entries.length === 0) return false;
    const last = entries[entries.length - 1];
    // Already streaming a partial response — AssistantMessage shows its own cursor
    if (last.type === 'assistant_message' && last.partial) return false;
    // After user_message or after a completed assistant_message (agent doing more work)
    return true;
  }, [isActive, entries]);

  if (!processId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[length:var(--font-size-sm)]">
        Select a session or start a new conversation
      </div>
    );
  }

  if (entries.length === 0) {
    if (isActive) {
      const cfg = AVATAR_CONFIG[process?.type ?? 'claude-code'] ?? AVATAR_CONFIG['claude-code'];
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative w-8 h-8 rounded-[8px] flex items-center justify-center text-[12px] font-bold"
              style={{ backgroundColor: cfg.tint, color: cfg.color }}
            >
              {cfg.label}
              <span
                className="absolute inset-[-3px] rounded-[10px] pointer-events-none"
                style={{
                  border: '1.5px solid currentColor',
                  color: cfg.color,
                  opacity: 0.3,
                  animation: 'avatar-pulse 2.5s ease-in-out infinite',
                }}
              />
            </div>
            <div className="flex gap-1">
              <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '0ms', opacity: 0.7 }} />
              <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '150ms', opacity: 0.7 }} />
              <span className="w-[5px] h-[5px] rounded-full animate-bounce" style={{ backgroundColor: cfg.color, animationDelay: '300ms', opacity: 0.7 }} />
            </div>
            <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {processStatus === 'spawning' ? 'Starting agent...' : 'Thinking...'}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[length:var(--font-size-sm)]">
        No messages yet
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <Virtuoso
          ref={virtuosoRef}
          data={entries}
          followOutput={handleFollowOutput}
          atBottomStateChange={handleAtBottomStateChange}
          onScroll={handleScroll}
          atBottomThreshold={60}
          className="h-full"
          style={{ height: '100%' }}
          components={showLoadingPlaceholder ? {
            Footer: () => <AgentLoadingPlaceholder agentType={process?.type} />,
          } : {}}
          itemContent={(index, entry) => {
            // Check if this assistant_message continues a group from the previous assistant_message
            // (skipping non-visual entries like tool_use, error, status_change between them)
            let isGroupContinuation = false;
            if (entry.type === 'assistant_message' && index > 0) {
              for (let i = index - 1; i >= 0; i--) {
                const prev = entries[i];
                if (prev.type === 'assistant_message') { isGroupContinuation = true; break; }
                if (prev.type === 'user_message') break;
                // Skip tool_use, error, status_change, token_usage — they don't break the visual group
              }
            }
            return (
              <div className="max-w-[700px] mx-auto px-4">
                <EntryContextMenu entry={entry} onCreateIssue={handleCreateIssue}>
                  <EntryRenderer entry={entry} isGroupContinuation={isGroupContinuation} />
                </EntryContextMenu>
              </div>
            );
          }}
        />

        {/* Floating scroll-to-bottom button */}
        {showScrollButton && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            style={{
              position: 'absolute',
              bottom: '16px',
              right: '16px',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              transition: 'opacity 150ms ease',
              zIndex: 10,
            }}
            aria-label="Scroll to bottom"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 3v10M4 9l4 4 4-4" />
            </svg>
          </button>
        )}
      </div>

      <CreateIssueDialog
        open={issueDialogOpen}
        onOpenChange={setIssueDialogOpen}
        prefill={issuePrefill}
      />
    </>
  );
}
