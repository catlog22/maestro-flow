import { useState, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useAutoScroll } from '@/client/hooks/useAutoScroll.js';
import { EntryRenderer } from './entries/index.js';
import { EntryContextMenu } from './entries/EntryContextMenu.js';
import { CreateIssueDialog } from '@/client/components/issues/CreateIssueDialog.js';
import type { NormalizedEntry } from '@/shared/agent-types.js';
import type { CreateIssueRequest } from '@/shared/issue-types.js';

// Stable empty array to avoid infinite re-render from Zustand selector
const EMPTY_ENTRIES: NormalizedEntry[] = [];

// ---------------------------------------------------------------------------
// MessageArea -- virtualized scrollable message list for a given process
// ---------------------------------------------------------------------------

export function MessageArea({ processId }: { processId: string | null }) {
  const entries = useAgentStore((s) =>
    processId ? (s.entries[processId] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES,
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

  if (!processId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-[length:var(--font-size-sm)]">
        Select a session or start a new conversation
      </div>
    );
  }

  const processStatus = useAgentStore((s) =>
    processId ? s.processes[processId]?.status : undefined,
  );

  if (entries.length === 0) {
    const isActive = processStatus === 'running' || processStatus === 'spawning';

    if (isActive) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-orange)', animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-orange)', animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--color-accent-orange)', animationDelay: '300ms' }} />
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
              <div className="max-w-[780px] mx-auto px-6">
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
