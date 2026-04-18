import { useState, useRef, useEffect } from 'react';
import type { IssueType, IssuePriority, IssueStatus } from '@/shared/issue-types.js';
import { useIssueStore } from '@/client/store/issue-store.js';

// ---------------------------------------------------------------------------
// InlineIssueComposer — Linear-style inline issue creator inside a column
// Press Enter to create, Escape to cancel. Minimal UI: title + type/priority.
// ---------------------------------------------------------------------------

/** Map column ID → default issue status */
const COLUMN_TO_STATUS: Record<string, IssueStatus> = {
  backlog: 'open',
  triage: 'registered',
  'in-progress': 'in_progress',
  review: 'resolved',
  done: 'closed',
  deferred: 'deferred',
};

const TYPES: { value: IssueType; label: string; color: string }[] = [
  { value: 'task', label: 'Task', color: '#A09D97' },
  { value: 'bug', label: 'Bug', color: '#C46555' },
  { value: 'feature', label: 'Feature', color: '#5B8DB8' },
  { value: 'improvement', label: 'Improve', color: '#9178B5' },
];

const PRIORITIES: { value: IssuePriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: '#C46555' },
  { value: 'high', label: 'High', color: '#B89540' },
  { value: 'medium', label: 'Medium', color: '#5B8DB8' },
  { value: 'low', label: 'Low', color: '#A09D97' },
];

interface InlineIssueComposerProps {
  columnId: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function InlineIssueComposer({ columnId, onClose, onCreated }: InlineIssueComposerProps) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<IssueType>('task');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const createIssue = useIssueStore((s) => s.createIssue);

  // Auto-focus on mount
  useEffect(() => {
    // Small delay to ensure DOM is ready
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  async function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    const defaultStatus = COLUMN_TO_STATUS[columnId] ?? 'open';
    await createIssue({
      title: trimmed,
      description: '',
      type,
      priority,
    });
    setSubmitting(false);
    setTitle('');
    onCreated?.();
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      ref={containerRef}
      className="rounded-[10px] border-2 border-dashed border-accent-blue/40 bg-bg-card px-[var(--spacing-3)] py-[var(--spacing-2-5)] space-y-[var(--spacing-2)] motion-safe:animate-[fade-in_100ms_ease-out]"
    >
      {/* Title input */}
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Issue title..."
        disabled={submitting}
        className="w-full bg-transparent text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-primary placeholder:text-text-tertiary outline-none"
      />

      {/* Type + Priority selectors row */}
      <div className="flex items-center gap-[var(--spacing-2)]">
        {/* Type selector — pill buttons */}
        <div className="flex gap-[var(--spacing-0-5)]">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={[
                'text-[length:10px] font-[var(--font-weight-medium)] px-[var(--spacing-1-5)] py-[1px] rounded-full transition-all duration-[var(--duration-fast)]',
                type === t.value
                  ? 'ring-1 ring-current'
                  : 'opacity-50 hover:opacity-80',
              ].join(' ')}
              style={{ backgroundColor: `${t.color}20`, color: t.color }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="w-px h-3 bg-border-divider" />

        {/* Priority selector — pill buttons */}
        <div className="flex gap-[var(--spacing-0-5)]">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPriority(p.value)}
              className={[
                'text-[length:10px] font-[var(--font-weight-medium)] px-[var(--spacing-1-5)] py-[1px] rounded-full transition-all duration-[var(--duration-fast)]',
                priority === p.value
                  ? 'ring-1 ring-current'
                  : 'opacity-50 hover:opacity-80',
              ].join(' ')}
              style={{ backgroundColor: `${p.color}20`, color: p.color }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Hint row */}
      <div className="flex items-center justify-between text-[length:10px] text-text-tertiary">
        <span>
          <kbd className="px-1 py-[1px] rounded bg-bg-hover font-mono text-[9px]">Enter</kbd> create
          {' '}
          <kbd className="px-1 py-[1px] rounded bg-bg-hover font-mono text-[9px]">Esc</kbd> cancel
        </span>
        {submitting && <span>Creating...</span>}
      </div>
    </div>
  );
}
