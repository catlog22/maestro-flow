import { useState, useCallback } from 'react';
import type { AgentType } from '@/shared/agent-types.js';
import { useExecutionStore } from '@/client/store/execution-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';

// ---------------------------------------------------------------------------
// ExecutionToolbar — floating toolbar for batch execution
// ---------------------------------------------------------------------------

const EXECUTOR_OPTIONS: { value: AgentType; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'pi', label: 'Pi' },
  { value: 'grok', label: 'Grok' },
];

export function ExecutionToolbar() {
  const selectedIds = useExecutionStore((s) => s.selectedIssueIds);
  const clearSelection = useExecutionStore((s) => s.clearSelection);
  const [executor, setExecutor] = useState<AgentType>('claude-code');

  const count = selectedIds.size;

  const handleExecute = useCallback(() => {
    if (count === 0) return;
    sendWsMessage({
      action: 'execute:batch',
      issueIds: Array.from(selectedIds),
      executor,
    });
    clearSelection();
  }, [selectedIds, executor, count, clearSelection]);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2)] rounded-full bg-bg-card border border-border shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-sm">
      {/* Count badge */}
      <span className="text-[length:var(--font-size-sm)] font-[var(--font-weight-semibold)] text-text-primary">
        {count} selected
      </span>

      {/* Separator */}
      <div className="w-px h-5 bg-border-divider" />

      {/* Executor selector */}
      <select
        value={executor}
        onChange={(e) => setExecutor(e.target.value as AgentType)}
        className="px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)] cursor-pointer"
      >
        {EXECUTOR_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Execute button */}
      <button
        type="button"
        onClick={handleExecute}
        className="flex items-center gap-[var(--spacing-1)] px-[var(--spacing-3)] py-[var(--spacing-1)] rounded-full bg-accent-blue text-white text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] hover:opacity-90 transition-opacity"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        Execute
      </button>

      {/* Clear button */}
      <button
        type="button"
        onClick={clearSelection}
        className="w-6 h-6 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        aria-label="Clear selection"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
