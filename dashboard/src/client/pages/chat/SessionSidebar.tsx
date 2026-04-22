import { useMemo, useState, useEffect } from 'react';
import X from 'lucide-react/dist/esm/icons/x.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { AgentProcess, AgentType, NormalizedEntry } from '@/shared/agent-types.js';

interface CliHistoryMeta {
  execId: string;
  tool: string;
  model?: string;
  mode: string;
  prompt: string;
  workDir: string;
  startedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  exitCode?: number;
  asyncDelegate?: boolean;
  delegateStatus?: string | null;
  cancelRequestedAt?: string | null;
}

interface CliHistoryQueuedMessage {
  messageId: string;
  createdAt: string;
  delivery: 'interrupt_resume' | 'after_complete';
  message: string;
  status: 'queued' | 'dispatched' | 'dropped';
  dispatchedAt?: string;
  dispatchReason?: string;
}

type HistoryFilter = 'all' | 'async' | 'other';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function isAsyncDelegateMeta(meta: CliHistoryMeta): boolean {
  return meta.asyncDelegate === true;
}

function buildQueuedMessageEntries(
  processId: string,
  messages: CliHistoryQueuedMessage[],
): NormalizedEntry[] {
  const entries: NormalizedEntry[] = [];

  for (const message of messages) {
    if (message.status === 'dispatched') {
      continue;
    }

    entries.push({
      id: `${message.messageId}:user`,
      processId,
      timestamp: message.createdAt,
      type: 'user_message',
      content: message.message,
    });

    if (message.status === 'dropped') {
      entries.push({
        id: `${message.messageId}:error`,
        processId,
        timestamp: message.dispatchedAt ?? message.createdAt,
        type: 'error',
        message: message.dispatchReason
          ? `Follow-up dropped: ${message.dispatchReason}`
          : 'Follow-up dropped',
      });
    }
  }

  return entries;
}

function statusBadge(meta: CliHistoryMeta): { label: string; bg: string; fg: string } | null {
  if (meta.delegateStatus === 'cancelling') {
    return {
      label: 'Cancelling',
      bg: 'var(--color-tint-planning)',
      fg: 'var(--color-accent-orange)',
    };
  }
  if (meta.cancelledAt || meta.delegateStatus === 'cancelled') {
    return {
      label: 'Cancelled',
      bg: 'var(--color-bg-hover)',
      fg: 'var(--color-text-secondary)',
    };
  }
  if (meta.exitCode !== undefined) {
    return {
      label: meta.exitCode === 0 ? 'OK' : `Exit ${meta.exitCode}`,
      bg: meta.exitCode === 0 ? 'var(--color-tint-exploring)' : 'var(--color-tint-blocked)',
      fg: meta.exitCode === 0 ? 'var(--color-accent-green)' : 'var(--color-accent-red)',
    };
  }
  if (meta.delegateStatus) {
    return {
      label: meta.delegateStatus,
      bg: 'var(--color-tint-exploring)',
      fg: 'var(--color-accent-blue)',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// HistoryPanel — right-side sliding panel with rich history cards
// ---------------------------------------------------------------------------

export function HistoryPanel({ open }: { open: boolean }) {
  const [history, setHistory] = useState<CliHistoryMeta[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('async');
  const processes = useAgentStore((s) => s.processes);

  useEffect(() => {
    if (!open) {
      return;
    }
    fetch('/api/cli-history?limit=20')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CliHistoryMeta[]) => setHistory(data))
      .catch(() => {});
  }, [open]);

  // Filter out items already loaded as active processes
  const activeIds = useMemo(() => new Set(Object.keys(processes)), [processes]);
  const visibleHistory = useMemo(() => {
    const base = history.filter((m) => !activeIds.has(m.execId) && !activeIds.has(`cli-history-${m.execId}`));
    switch (filter) {
      case 'async':
        return base.filter(isAsyncDelegateMeta);
      case 'other':
        return base.filter((meta) => !isAsyncDelegateMeta(meta));
      default:
        return base;
    }
  }, [history, activeIds, filter]);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-40 overflow-y-auto flex flex-col"
      style={{
        width: 280,
        backgroundColor: 'var(--color-bg-secondary)',
        borderLeft: '1px solid var(--color-border)',
        boxShadow: open ? '-4px 0 16px rgba(0,0,0,0.06)' : 'none',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        opacity: open ? 1 : 0,
        transition: 'transform 200ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--color-border-divider)' }}
      >
        <Clock size={14} strokeWidth={1.8} style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          History
        </span>
      </div>

      <div className="flex gap-1 px-2 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border-divider)' }}>
        {([
          ['async', 'Async'],
          ['all', 'All'],
          ['other', 'Other CLI'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className="px-2 py-1 rounded-md text-[11px] border-none cursor-pointer transition-colors duration-150"
            style={{
              backgroundColor: filter === value ? 'var(--color-bg-active)' : 'transparent',
              color: filter === value ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {visibleHistory.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
            No history entries
          </div>
        ) : (
          visibleHistory.map((meta) => (
            <HistoryCard
              key={meta.execId}
              meta={meta}
              onRemove={(execId) => setHistory((prev) => prev.filter((m) => m.execId !== execId))}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryCard — rich info card for history items
// ---------------------------------------------------------------------------

function HistoryCard({ meta, onRemove }: { meta: CliHistoryMeta; onRemove: (execId: string) => void }) {
  const { addProcess, setEntries, setActiveProcessId } = useAgentStore.getState();

  const agentType = (meta.tool === 'claude' ? 'claude-code' : meta.tool) as AgentType;
  const dotColor = AGENT_DOT_COLORS[agentType] ?? 'var(--color-text-tertiary)';
  const label = AGENT_LABELS[agentType] ?? meta.tool;

  const handleClick = async () => {
    const processId = `cli-history-${meta.execId}`;

    if (useAgentStore.getState().processes[processId]) {
      setActiveProcessId(processId);
      return;
    }

    const syntheticProcess: AgentProcess = {
      id: processId,
      type: agentType,
      status: meta.delegateStatus === 'cancelling'
        ? 'stopping'
        : meta.delegateStatus === 'queued'
          ? 'spawning'
          : meta.delegateStatus === 'running'
            ? 'running'
            : 'stopped',
      config: {
        type: agentType,
        prompt: meta.prompt,
        workDir: meta.workDir,
      },
      startedAt: meta.startedAt,
      interactive: meta.asyncDelegate === true,
    };
    addProcess(syntheticProcess);
    setActiveProcessId(processId);

    try {
      const [entriesRes, messagesRes] = await Promise.all([
        fetch(`/api/cli-history/${encodeURIComponent(meta.execId)}/entries`),
        meta.asyncDelegate
          ? fetch(`/api/cli-history/${encodeURIComponent(meta.execId)}/messages`)
          : Promise.resolve(null),
      ]);

      const merged: NormalizedEntry[] = [];

      if (entriesRes.ok) {
        const raw = (await entriesRes.json()) as NormalizedEntry[];
        // Post-process history entries:
        // 1. Consolidate consecutive assistant_message fragments into single messages
        // 2. Clear partial flag on assistant messages (session is complete)
        // 3. Merge tool_use running→completed pairs (adapter emits two entries per tool call)
        for (const entry of raw) {
          const fixed = { ...entry, processId } as NormalizedEntry;
          if (fixed.type === 'assistant_message') {
            (fixed as { partial: boolean }).partial = false;
            // Merge consecutive assistant messages (streaming deltas stored as separate entries)
            const prev = merged[merged.length - 1];
            if (prev && prev.type === 'assistant_message') {
              (prev as { content: string }).content += (fixed as { content: string }).content;
              continue;
            }
          }
          if (fixed.type === 'tool_use' && (fixed.status === 'completed' || fixed.status === 'failed')) {
            // Find and merge with the matching 'running' entry — keep input, add result+status
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
      }

      if (messagesRes?.ok) {
        const messages = (await messagesRes.json()) as CliHistoryQueuedMessage[];
        const msgEntries = buildQueuedMessageEntries(processId, messages);
        if (msgEntries.length > 0) {
          merged.push(...msgEntries);
        }
      }

      setEntries(processId, merged);
    } catch {
      // Silent fail
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    const processId = `cli-history-${meta.execId}`;
    useAgentStore.getState().dismissProcess(processId);
    onRemove(meta.execId);
  };

  const exit = statusBadge(meta);
  const exitBadge = exit ? (
    <span
      className="text-[10px] font-medium px-[5px] py-[1px] rounded"
      style={{
        backgroundColor: exit.bg,
        color: exit.fg,
      }}
    >
      {exit.label}
    </span>
  ) : null;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleClick}
        className="w-full text-left px-3 py-[10px] rounded-lg border-none bg-transparent cursor-pointer transition-colors duration-150"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        {/* Top row: dot + label + exit badge */}
        <div className="flex items-center gap-[6px] mb-[4px]">
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {label}
          </span>
          {meta.asyncDelegate && (
            <span
              className="text-[9px] font-semibold px-[4px] py-[1px] rounded"
              style={{
                backgroundColor: 'var(--color-tint-exploring)',
                color: 'var(--color-accent-blue)',
              }}
            >
              ASYNC
            </span>
          )}
          {exitBadge}
        </div>

        {/* Prompt preview */}
        <div className="text-[11px] truncate mb-[4px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {meta.prompt.slice(0, 60)}{meta.prompt.length > 60 ? '...' : ''}
        </div>

        {/* Bottom row: date, time, model/mode */}
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-placeholder)' }}>
          <span>{formatDate(meta.startedAt)}</span>
          <span>{formatTime(meta.startedAt)}</span>
          {meta.model && (
            <>
              <span style={{ color: 'var(--color-border-divider)' }}>·</span>
              <span>{meta.model}</span>
            </>
          )}
        </div>
      </button>

      {/* Dismiss on hover */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer"
        style={{ color: 'var(--color-text-placeholder)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-tint-blocked)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-red)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-text-placeholder)';
        }}
        aria-label="Remove history item"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
