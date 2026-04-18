import { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { CreateIssueRequest, IssueType, IssuePriority } from '@/shared/issue-types.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { cn } from '@/client/lib/utils.js';

// ---------------------------------------------------------------------------
// CreateIssueDialog -- modal form for creating an issue
// Accepts pre-fill data from entry context menu.
// ---------------------------------------------------------------------------

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: Partial<CreateIssueRequest>;
}

const ISSUE_TYPES: { value: IssueType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'task', label: 'Task' },
];

const ISSUE_PRIORITIES: { value: IssuePriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

// Shared input/select style classes
const inputCls = cn(
  'w-full px-[var(--spacing-3)] py-[var(--spacing-2)]',
  'rounded-[var(--radius-default)] border border-border',
  'bg-bg-secondary text-text-primary',
  'text-[length:var(--font-size-sm)]',
  'focus:outline-none focus:shadow-[var(--shadow-focus-ring)]',
  'transition-shadow duration-[var(--duration-fast)]',
);

const labelCls = 'block text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary mb-[var(--spacing-1)]';

export function CreateIssueDialog({ open, onOpenChange, prefill }: CreateIssueDialogProps) {
  const createIssue = useIssueStore((s) => s.createIssue);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('task');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);

  // Sync prefill data when dialog opens
  useEffect(() => {
    if (open && prefill) {
      setTitle(prefill.title ?? '');
      setDescription(prefill.description ?? '');
      setType(prefill.type ?? 'task');
      setPriority(prefill.priority ?? 'medium');
    }
    if (!open) {
      setTitle('');
      setDescription('');
      setType('task');
      setPriority('medium');
    }
  }, [open, prefill]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const req: CreateIssueRequest = {
      title: title.trim(),
      description,
      type,
      priority,
    };
    if (prefill?.source_entry_id) req.source_entry_id = prefill.source_entry_id;
    if (prefill?.source_process_id) req.source_process_id = prefill.source_process_id;

    await createIssue(req);
    setSubmitting(false);
    onOpenChange(false);
  }, [title, description, type, priority, prefill, createIssue, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[560px] max-w-[95vw] max-h-[85vh]',
            'rounded-[var(--radius-lg)] border border-border bg-bg-primary shadow-lg',
            'flex flex-col overflow-hidden',
            'focus:outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-border shrink-0">
            <Dialog.Title className="text-[length:var(--font-size-lg)] font-[var(--font-weight-semibold)] text-text-primary">
              Create Issue
            </Dialog.Title>
            <Dialog.Close
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)]',
                'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                'transition-colors duration-[var(--duration-fast)]',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
              )}
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Dialog.Close>
          </div>

          {/* Form body */}
          <div className="flex-1 overflow-y-auto p-[var(--spacing-6)] space-y-[var(--spacing-4)]">
            {/* Title */}
            <div>
              <label htmlFor="issue-title" className={labelCls}>Title</label>
              <input
                id="issue-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief summary of the issue"
                className={inputCls}
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="issue-desc" className={labelCls}>Description</label>
              <textarea
                id="issue-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed description..."
                rows={6}
                className={cn(inputCls, 'resize-y min-h-[120px]')}
              />
            </div>

            {/* Type + Priority row */}
            <div className="flex gap-[var(--spacing-4)]">
              <div className="flex-1">
                <label htmlFor="issue-type" className={labelCls}>Type</label>
                <select
                  id="issue-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as IssueType)}
                  className={inputCls}
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="issue-priority" className={labelCls}>Priority</label>
                <select
                  id="issue-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as IssuePriority)}
                  className={inputCls}
                >
                  {ISSUE_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-[var(--spacing-3)] px-[var(--spacing-6)] py-[var(--spacing-4)] border-t border-border shrink-0">
            <Dialog.Close
              className={cn(
                'px-[var(--spacing-4)] py-[var(--spacing-2)]',
                'rounded-[var(--radius-default)]',
                'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
                'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                'transition-colors duration-[var(--duration-fast)]',
              )}
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              disabled={!title.trim() || submitting}
              onClick={handleSubmit}
              className={cn(
                'px-[var(--spacing-4)] py-[var(--spacing-2)]',
                'rounded-[var(--radius-default)]',
                'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
                'bg-[var(--color-accent-blue)] text-white',
                'hover:opacity-90',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-opacity duration-[var(--duration-fast)]',
              )}
            >
              {submitting ? 'Creating...' : 'Create Issue'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
