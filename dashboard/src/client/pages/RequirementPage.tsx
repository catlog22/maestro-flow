import { useState, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRequirementStore } from '@/client/store/requirement-store.js';
import type { ExpansionDepth, ChecklistItem } from '@/shared/requirement-types.js';
import ZapIcon from 'lucide-react/dist/esm/icons/zap.js';
import ClockIcon from 'lucide-react/dist/esm/icons/clock.js';
import MessageSquareIcon from 'lucide-react/dist/esm/icons/message-square.js';
import GitBranchIcon from 'lucide-react/dist/esm/icons/git-branch.js';
import PencilIcon from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2Icon from 'lucide-react/dist/esm/icons/trash-2.js';
import PlusCircleIcon from 'lucide-react/dist/esm/icons/plus-circle.js';
import CodeIcon from 'lucide-react/dist/esm/icons/code.js';
import RotateCcwIcon from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import ArrowRightIcon from 'lucide-react/dist/esm/icons/arrow-right.js';

// ---------------------------------------------------------------------------
// RequirementPage — 4:6 split panel
//   Left 40%:  composer + history
//   Right 60%: structured table with dep flow, refine bar, commit footer
// ---------------------------------------------------------------------------

type ExpansionMethod = 'sdk' | 'cli';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPTH_OPTIONS: { value: ExpansionDepth; label: string; desc: string }[] = [
  { value: 'high-level', label: 'High-level', desc: '3-5 epics' },
  { value: 'standard', label: 'Standard', desc: '5-10 tasks' },
  { value: 'atomic', label: 'Atomic', desc: '10-20 steps' },
];

const STATUS_DOT: Record<string, string> = {
  done: 'bg-accent-green',
  failed: 'bg-accent-red',
  reviewing: 'bg-accent-orange',
  expanding: 'bg-accent-blue',
  committing: 'bg-accent-orange',
  draft: 'bg-text-tertiary',
};

const TYPE_STYLE: Record<string, string> = {
  feature: 'bg-[var(--color-tint-exploring)] text-[var(--color-accent-blue)]',
  task: 'bg-[var(--color-tint-planning)] text-[var(--color-accent-purple)]',
  bug: 'bg-[var(--color-tint-blocked)] text-[var(--color-accent-red)]',
  improvement: 'bg-[var(--color-tint-completed)] text-[var(--color-accent-green)]',
};

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-accent-red',
  high: 'bg-accent-orange',
  medium: 'bg-accent-yellow',
  low: 'bg-text-placeholder',
};

const EFFORT_LABEL: Record<string, string> = {
  small: 'S', medium: 'M', large: 'L',
  '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d', '2d': '2d', '1w': '1w',
};

// ---------------------------------------------------------------------------
// Left Panel — Composer
// ---------------------------------------------------------------------------

function Composer() {
  const [text, setText] = useState('');
  const [depth, setDepth] = useState<ExpansionDepth>('standard');
  const [method, setMethod] = useState<ExpansionMethod>('sdk');
  const { expand, isLoading } = useRequirementStore(
    useShallow((s) => ({ expand: s.expand, isLoading: s.isLoading })),
  );

  const handleExpand = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    expand(trimmed, depth, method);
  }, [text, depth, method, expand, isLoading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleExpand();
      }
    },
    [handleExpand],
  );

  return (
    <div className="px-[var(--spacing-5)] pt-[var(--spacing-6)] shrink-0">
      <h1
        className="text-[length:var(--font-size-xl)] font-bold text-text-primary mb-[var(--spacing-1)]"
        style={{
          fontFamily: 'var(--style-heading-font)',
          letterSpacing: 'var(--style-heading-letter-spacing)',
        }}
      >
        Expand requirements
      </h1>
      <p className="text-[length:var(--font-size-xs)] text-text-tertiary mb-[var(--spacing-4)]">
        Natural language to structured decomposition
      </p>

      {/* Composer card */}
      <div className="bg-bg-card border border-border rounded-[var(--style-composer-radius)] shadow-sm transition-all duration-[var(--duration-normal)] focus-within:border-[var(--color-accent-orange)] focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.03),0_0_0_3px_rgba(200,134,58,0.08)]">
        <textarea
          className="w-full border-none bg-transparent resize-none outline-none text-text-primary leading-relaxed font-sans"
          style={{
            fontSize: 'var(--style-composer-textarea-size)',
            padding: 'var(--style-composer-padding)',
            paddingBottom: 'var(--spacing-2)',
          }}
          placeholder="Describe a feature, user story, or requirement..."
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center px-[var(--spacing-3)] pb-[var(--spacing-2)] gap-[var(--spacing-1)]">
          {/* Depth selector */}
          <div className="flex gap-[1px] bg-bg-secondary rounded-[var(--radius-default)] p-[2px]">
            {DEPTH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`text-[length:var(--font-size-xs)] font-medium px-[var(--spacing-2-5)] py-[3px] rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)] ${
                  depth === opt.value
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
                onClick={() => setDepth(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Method toggle */}
          <div className="flex gap-[1px] bg-bg-secondary rounded-[var(--radius-default)] p-[2px] ml-[var(--spacing-1)]">
            {(['sdk', 'cli'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`text-[length:var(--font-size-xs)] font-medium px-[var(--spacing-2)] py-[3px] rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)] ${
                  method === m
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
                onClick={() => setMethod(m)}
              >
                {m === 'sdk' ? 'SDK' : 'CLI'}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Expand button */}
          <button
            type="button"
            className="flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-xs)] font-semibold px-[var(--spacing-4)] py-[5px] rounded-[var(--radius-default)] bg-text-primary text-text-inverse hover:opacity-85 transition-opacity duration-[var(--duration-fast)] disabled:opacity-[var(--opacity-disabled)]"
            disabled={!text.trim() || isLoading}
            onClick={handleExpand}
          >
            <ZapIcon size={13} strokeWidth={2} />
            {isLoading ? 'Expanding...' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Keyboard hints */}
      <div className="flex gap-[var(--spacing-2-5)] px-[var(--spacing-1)] mt-[var(--spacing-1-5)] text-[length:10px] text-text-placeholder">
        <span>
          <kbd className="font-mono text-[10px] px-[5px] py-[1px] border border-border-divider rounded-[3px] bg-bg-secondary">
            Ctrl+Enter
          </kbd>{' '}
          expand
        </span>
        <span>
          <kbd className="font-mono text-[10px] px-[5px] py-[1px] border border-border-divider rounded-[3px] bg-bg-secondary">
            Tab
          </kbd>{' '}
          depth
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left Panel — History List
// ---------------------------------------------------------------------------

function HistoryList() {
  const { history, currentRequirement, loadHistory } = useRequirementStore(
    useShallow((s) => ({
      history: s.history,
      currentRequirement: s.currentRequirement,
      loadHistory: s.loadHistory,
    })),
  );

  if (history.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-[var(--spacing-5)]">
        <p className="text-[length:var(--font-size-xs)] text-text-placeholder text-center">
          No expansion history yet
        </p>
      </div>
    );
  }

  // Group by date
  const today = new Date();
  const groups: { label: string; items: typeof history }[] = [];
  const todayItems: typeof history = [];
  const olderItems: typeof history = [];

  for (const item of history) {
    const d = new Date(item.createdAt);
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();
    if (isToday) todayItems.push(item);
    else olderItems.push(item);
  }
  if (todayItems.length) groups.push({ label: 'Today', items: todayItems });
  if (olderItems.length) groups.push({ label: 'Earlier', items: olderItems });

  return (
    <div className="flex-1 overflow-y-auto px-[var(--spacing-5)] mt-[var(--spacing-5)]">
      <div className="flex items-center gap-[var(--spacing-1-5)] text-[length:10px] font-semibold text-text-tertiary uppercase tracking-[0.06em] mb-[var(--spacing-2)]">
        <ClockIcon size={12} strokeWidth={2} />
        History
      </div>

      <div className="flex flex-col gap-[2px]">
        {groups.map((group) => (
          <div key={group.label}>
            {groups.length > 1 && (
              <div className="text-[length:10px] text-text-placeholder px-[var(--spacing-2-5)] py-[var(--spacing-1)] mt-[var(--spacing-1)]">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = currentRequirement?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full text-left flex items-center gap-[var(--spacing-3)] px-[var(--spacing-2-5)] py-[var(--spacing-2)] rounded-[var(--radius-md)] transition-all duration-[var(--duration-normal)] ${
                    isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'
                  }`}
                  onClick={() => loadHistory(item.id)}
                >
                  <span className={`inline-block w-[8px] h-[8px] rounded-full shrink-0 ${STATUS_DOT[item.status] ?? 'bg-text-tertiary'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[length:var(--font-size-xs)] font-semibold truncate ${isActive ? 'text-text-primary' : 'text-text-primary'}`}>
                      {item.title || item.userInput.substring(0, 50)}
                    </div>
                    <div className="flex items-center gap-[var(--spacing-2)] mt-[2px]">
                      {item.status === 'done' && (
                        <span className="text-[9px] font-semibold px-[6px] py-[1px] rounded-full bg-[var(--color-tint-completed)] text-[var(--color-accent-green)]">
                          done
                        </span>
                      )}
                      {item.status === 'failed' && (
                        <span className="text-[9px] font-semibold px-[6px] py-[1px] rounded-full bg-[var(--color-tint-blocked)] text-[var(--color-accent-red)]">
                          failed
                        </span>
                      )}
                      {item.items.length > 0 && (
                        <span className="text-[9px] font-semibold px-[6px] py-[1px] rounded-full bg-[var(--color-tint-exploring)] text-[var(--color-accent-blue)]">
                          {item.items.length} items
                        </span>
                      )}
                      <span className="text-[9px] font-semibold px-[6px] py-[1px] rounded-full bg-[var(--color-tint-planning)] text-[var(--color-accent-purple)]">
                        {item.depth}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-text-placeholder shrink-0">
                    {formatTimeAgo(item.createdAt)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ---------------------------------------------------------------------------
// Right Panel — Result View (router for states)
// ---------------------------------------------------------------------------

function ResultPanel() {
  const { currentRequirement, isLoading, error, progressMessage } =
    useRequirementStore(
      useShallow((s) => ({
        currentRequirement: s.currentRequirement,
        isLoading: s.isLoading,
        error: s.error,
        progressMessage: s.progressMessage,
      })),
    );

  const status = currentRequirement?.status;

  // Empty state
  if (!currentRequirement) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-[var(--spacing-4)] text-text-placeholder">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <div className="text-center">
          <p className="text-[length:var(--font-size-sm)] font-medium text-text-secondary">
            No expansion yet
          </p>
          <p className="text-[length:var(--font-size-xs)] text-text-tertiary mt-[var(--spacing-1)]">
            Enter a requirement and click Expand to generate a structured checklist
          </p>
        </div>
      </div>
    );
  }

  // Expanding / committing spinner
  if (status === 'expanding' || status === 'committing') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-[var(--spacing-5)]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-bg-tertiary" />
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
            style={{
              borderTopColor:
                status === 'expanding'
                  ? 'var(--color-accent-blue)'
                  : 'var(--color-accent-orange)',
            }}
          />
        </div>
        <div className="text-center">
          <p className="text-[length:var(--font-size-sm)] font-medium text-text-primary">
            {status === 'expanding' ? 'Expanding requirement' : 'Committing'}
          </p>
          <p className="text-[length:var(--font-size-xs)] text-text-tertiary mt-[var(--spacing-1)]">
            {progressMessage || (status === 'expanding' ? 'Analyzing and structuring...' : 'Creating issues...')}
          </p>
        </div>
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-[var(--spacing-4)]">
        <div className="w-12 h-12 rounded-full bg-[var(--color-tint-blocked)] flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-red)" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </div>
        <div className="text-center max-w-sm">
          <p className="text-[length:var(--font-size-sm)] font-medium text-text-primary">
            Expansion Failed
          </p>
          {(error ?? currentRequirement.error) && (
            <p className="text-[length:var(--font-size-xs)] text-accent-red mt-[var(--spacing-2)] leading-relaxed">
              {error ?? currentRequirement.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // reviewing / done — show structured table
  return <StructuredView />;
}

// ---------------------------------------------------------------------------
// Right Panel — Structured Table View
// ---------------------------------------------------------------------------

function StructuredView() {
  const [feedback, setFeedback] = useState('');
  const {
    currentRequirement,
    refine,
    commit,
    updateItem,
    isLoading,
    committedResult,
    resetRequirement,
  } = useRequirementStore(
    useShallow((s) => ({
      currentRequirement: s.currentRequirement,
      refine: s.refine,
      commit: s.commit,
      updateItem: s.updateItem,
      isLoading: s.isLoading,
      committedResult: s.committedResult,
      resetRequirement: s.resetRequirement,
    })),
  );

  const handleRefine = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    refine(trimmed);
    setFeedback('');
  }, [feedback, refine]);

  if (!currentRequirement) return null;
  const isDone = currentRequirement.status === 'done';
  const items = currentRequirement.items;

  // Build dependency map for the flow visualization
  const depFlow = buildDepFlow(items);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-[var(--spacing-5)] py-[var(--spacing-4)] border-b border-border-divider shrink-0">
        <div className="flex items-start gap-[var(--spacing-3)]">
          <div className="flex-1 min-w-0">
            <h2 className="text-[length:var(--font-size-md)] font-bold text-text-primary truncate">
              {currentRequirement.title || 'Expanded Requirement'}
            </h2>
            {currentRequirement.summary && (
              <p className="text-[length:var(--font-size-xs)] text-text-secondary leading-relaxed mt-[var(--spacing-1)] line-clamp-2">
                {currentRequirement.summary}
              </p>
            )}
            <div className="flex gap-[var(--spacing-2)] mt-[var(--spacing-2)]">
              <span className="text-[10px] font-semibold px-[var(--spacing-2-5)] py-[2px] rounded-full bg-[var(--color-tint-exploring)] text-[var(--color-accent-blue)]">
                {items.length} items
              </span>
              <span className="text-[10px] font-semibold px-[var(--spacing-2-5)] py-[2px] rounded-full bg-[var(--color-tint-planning)] text-[var(--color-accent-purple)]">
                {items.filter((i) => i.dependencies.length > 0).length} deps
              </span>
              <span className="text-[10px] font-semibold px-[var(--spacing-2-5)] py-[2px] rounded-full bg-[var(--color-tint-verifying)] text-[var(--color-accent-orange)]">
                {currentRequirement.depth}
              </span>
              {isDone && (
                <span className="text-[10px] font-semibold px-[var(--spacing-2-5)] py-[2px] rounded-full bg-[var(--color-tint-completed)] text-[var(--color-accent-green)]">
                  {committedResult
                    ? `committed · ${committedResult.mode}`
                    : 'done'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dependency flow */}
      {depFlow.length > 1 && (
        <div className="px-[var(--spacing-5)] py-[var(--spacing-3)] border-b border-border-divider bg-bg-secondary shrink-0">
          <div className="flex items-center gap-[var(--spacing-1-5)] text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.04em] mb-[var(--spacing-2)]">
            <GitBranchIcon size={12} strokeWidth={2} />
            Dependency Flow
          </div>
          <div className="flex items-center gap-[var(--spacing-1)] overflow-x-auto pb-[var(--spacing-1)]">
            {depFlow.map((node, i) => (
              <span key={i} className="flex items-center gap-[var(--spacing-1)] shrink-0">
                {i > 0 && (
                  <ArrowRightIcon size={10} className="text-text-placeholder" />
                )}
                <span
                  className={`text-[10px] font-semibold px-[var(--spacing-2-5)] py-[3px] rounded-[var(--radius-sm)] whitespace-nowrap ${
                    DEP_COLORS[i % DEP_COLORS.length]
                  }`}
                >
                  {i + 1}. {node}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[28px]">
                #
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1]">
                Item
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[68px]">
                Type
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[88px]">
                Priority
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[52px]">
                Effort
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[76px]">
                Deps
              </th>
              <th className="text-[10px] font-semibold uppercase tracking-[0.04em] text-text-tertiary text-left px-[var(--spacing-3-5)] py-[var(--spacing-2-5)] border-b border-border-divider bg-bg-primary sticky top-0 z-[1] w-[56px]" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                index={index}
                items={items}
                disabled={isDone}
                onUpdate={(updates) => updateItem(item.id, updates)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Refine bar */}
      {!isDone && (
        <div className="flex gap-[var(--spacing-2)] px-[var(--spacing-5)] py-[var(--spacing-3)] border-t border-border-divider bg-bg-primary shrink-0">
          <textarea
            className="flex-1 border border-border rounded-[var(--radius-md)] px-[var(--spacing-3-5)] py-[var(--spacing-2)] text-[length:var(--font-size-sm)] text-text-primary bg-bg-card outline-none resize-none placeholder:text-text-placeholder focus:border-[var(--color-accent-purple)] transition-colors duration-[var(--duration-normal)]"
            rows={1}
            placeholder="Provide feedback to refine this expansion..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleRefine();
              }
            }}
          />
          <button
            type="button"
            className="flex items-center gap-[var(--spacing-1-5)] shrink-0 px-[var(--spacing-4)] py-[var(--spacing-2)] rounded-[var(--radius-md)] border border-border text-text-secondary text-[length:var(--font-size-xs)] font-semibold hover:text-text-primary hover:bg-bg-hover transition-all duration-[var(--duration-normal)] disabled:opacity-[var(--opacity-disabled)]"
            disabled={!feedback.trim() || isLoading}
            onClick={handleRefine}
          >
            <MessageSquareIcon size={14} strokeWidth={1.8} />
            Refine
          </button>
        </div>
      )}

      {/* Footer — commit actions */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-5)] py-[var(--spacing-3)] border-t border-border bg-bg-primary shrink-0">
        {!isDone ? (
          <>
            <button
              type="button"
              className="flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-4)] py-[var(--spacing-2)] rounded-[var(--radius-md)] bg-accent-green text-text-inverse text-[length:var(--font-size-xs)] font-semibold hover:opacity-85 transition-opacity duration-[var(--duration-fast)] disabled:opacity-[var(--opacity-disabled)]"
              disabled={isLoading}
              onClick={() => commit('issues')}
            >
              <PlusCircleIcon size={14} strokeWidth={1.8} />
              Commit as Issues
            </button>
            <button
              type="button"
              className="flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-4)] py-[var(--spacing-2)] rounded-[var(--radius-md)] border border-border text-text-secondary text-[length:var(--font-size-xs)] font-semibold hover:text-text-primary hover:bg-bg-hover transition-all duration-[var(--duration-normal)] disabled:opacity-[var(--opacity-disabled)]"
              disabled={isLoading}
              onClick={() => commit('coordinate')}
            >
              <CodeIcon size={14} strokeWidth={1.8} />
              Coordinate
            </button>
          </>
        ) : (
          <button
            type="button"
            className="flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-4)] py-[var(--spacing-2)] rounded-[var(--radius-md)] border border-border text-text-secondary text-[length:var(--font-size-xs)] font-semibold hover:text-text-primary hover:bg-bg-hover transition-all duration-[var(--duration-normal)]"
            onClick={resetRequirement}
          >
            <RotateCcwIcon size={14} strokeWidth={1.8} />
            New Requirement
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-text-tertiary">
          {items.length} items &middot; {currentRequirement.depth}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table row — single checklist item
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  index,
  items,
  disabled,
  onUpdate,
}: {
  item: ChecklistItem;
  index: number;
  items: ChecklistItem[];
  disabled?: boolean;
  onUpdate: (updates: Partial<ChecklistItem>) => void;
}) {
  // Resolve dependency labels (#N)
  const depLabels = item.dependencies
    .map((depId) => {
      const depIndex = items.findIndex((i) => i.id === depId);
      return depIndex >= 0 ? `#${depIndex + 1}` : null;
    })
    .filter(Boolean);

  return (
    <tr className="transition-colors duration-[var(--duration-normal)] hover:bg-bg-hover">
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top text-[length:var(--font-size-xs)] font-semibold text-text-placeholder text-center">
        {index + 1}
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        <div className="text-[length:var(--font-size-sm)] font-semibold text-text-primary leading-tight">
          {item.title}
        </div>
        <div className="text-[length:var(--font-size-xs)] text-text-tertiary mt-[2px] leading-snug">
          {item.description}
        </div>
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        <span
          className={`inline-flex text-[9px] font-semibold px-[7px] py-[2px] rounded-full uppercase tracking-[0.03em] ${
            TYPE_STYLE[item.type] ?? TYPE_STYLE.task
          }`}
        >
          {item.type}
        </span>
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        <div className="flex items-center gap-[var(--spacing-1)]">
          <span
            className={`inline-block w-[6px] h-[6px] rounded-full ${
              PRIORITY_DOT[item.priority] ?? PRIORITY_DOT.medium
            }`}
          />
          <span className="text-[length:var(--font-size-xs)] text-text-secondary capitalize">
            {item.priority}
          </span>
        </div>
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        <span className="text-[10px] font-semibold px-[var(--spacing-2)] py-[2px] rounded-[var(--radius-sm)] bg-bg-secondary text-text-secondary">
          {EFFORT_LABEL[item.estimated_effort] ?? item.estimated_effort ?? '—'}
        </span>
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        {depLabels.length > 0 ? (
          <div className="flex flex-wrap gap-[3px]">
            {depLabels.map((label) => (
              <span
                key={label}
                className="text-[9px] font-semibold px-[6px] py-[1px] rounded-[var(--radius-sm)] bg-[var(--color-tint-planning)] text-[var(--color-accent-purple)] cursor-pointer hover:bg-[var(--color-accent-purple)] hover:text-white transition-colors duration-[var(--duration-fast)]"
              >
                {label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-text-placeholder">&mdash;</span>
        )}
      </td>
      <td className="px-[var(--spacing-3-5)] py-[var(--spacing-3)] border-b border-border-divider align-top">
        {!disabled && (
          <div className="flex gap-[2px]">
            <button
              type="button"
              className="w-[26px] h-[26px] rounded-[var(--radius-default)] flex items-center justify-center text-text-placeholder hover:bg-bg-hover hover:text-text-primary transition-all duration-[var(--duration-normal)]"
              title="Edit"
            >
              <PencilIcon size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="w-[26px] h-[26px] rounded-[var(--radius-default)] flex items-center justify-center text-text-placeholder hover:bg-bg-hover hover:text-text-primary transition-all duration-[var(--duration-normal)]"
              title="Remove"
            >
              <Trash2Icon size={14} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Dependency flow helpers
// ---------------------------------------------------------------------------

const DEP_COLORS = [
  'bg-[var(--color-tint-exploring)] text-[var(--color-accent-blue)]',
  'bg-[var(--color-tint-planning)] text-[var(--color-accent-purple)]',
  'bg-[var(--color-tint-verifying)] text-[var(--color-accent-orange)]',
  'bg-[var(--color-tint-completed)] text-[var(--color-accent-green)]',
];

/** Build a linear dep flow from items (topological-ish order) */
function buildDepFlow(items: ChecklistItem[]): string[] {
  if (items.length === 0) return [];

  // Simple: use items in order, shorten titles
  return items.map((item) => {
    const words = item.title.split(/\s+/);
    return words.length > 3 ? words.slice(0, 3).join(' ') : item.title;
  });
}

// ---------------------------------------------------------------------------
// Main page — 4:6 split layout
// ---------------------------------------------------------------------------

export function RequirementPage() {
  const fetchHistory = useRequirementStore((s) => s.fetchHistory);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="h-full flex">
      {/* Left column — 40%: composer + history */}
      <div className="w-[40%] shrink-0 border-r border-border flex flex-col overflow-hidden bg-bg-primary">
        <Composer />
        <HistoryList />
      </div>

      {/* Right column — 60%: structured result */}
      <div className="w-[60%] flex flex-col overflow-hidden bg-bg-primary">
        <ResultPanel />
      </div>
    </div>
  );
}
