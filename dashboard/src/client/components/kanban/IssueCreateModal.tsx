import { useState, useRef, useEffect, useCallback } from 'react';
import type { IssueType, IssuePriority } from '@/shared/issue-types.js';
import { useIssueStore } from '@/client/store/issue-store.js';

// ---------------------------------------------------------------------------
// IssueCreateModal — 3 style variants for creating issues
// Style 1: Command palette (dark, minimal, keyboard-first)
// Style 2: Structured form (full fields, traditional dialog)
// Style 3: Focus mode (Notion-style, writing-first)
// ---------------------------------------------------------------------------

export type CreateModalStyle = 1 | 2 | 3;

const TYPE_OPTS: { value: IssueType; label: string; color: string }[] = [
  { value: 'bug', label: 'Bug', color: '#C46555' },
  { value: 'feature', label: 'Feature', color: '#5B8DB8' },
  { value: 'improvement', label: 'Improve', color: '#9178B5' },
  { value: 'task', label: 'Task', color: '#A09D97' },
];

const PRI_OPTS: { value: IssuePriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: '#C46555' },
  { value: 'high', label: 'High', color: '#B89540' },
  { value: 'medium', label: 'Medium', color: '#5B8DB8' },
  { value: 'low', label: 'Low', color: '#A09D97' },
];

interface Props {
  open: boolean;
  columnId: string;
  style: CreateModalStyle;
  onClose: () => void;
  onCreated?: () => void;
}

// Shared chip row used across styles
function Chips({
  type,
  setType,
  priority,
  setPriority,
  dark,
}: {
  type: IssueType;
  setType: (v: IssueType) => void;
  priority: IssuePriority;
  setPriority: (v: IssuePriority) => void;
  dark?: boolean;
}) {
  const dim = dark ? '20' : '18';
  const active = dark ? '35' : '28';
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {TYPE_OPTS.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => setType(t.value)}
          className="text-[10px] font-medium px-2 py-[2px] rounded-full transition-all duration-100"
          style={{
            background: `${t.color}${type === t.value ? active : dim}`,
            color: t.color,
            outline: type === t.value ? `1.5px solid ${t.color}70` : 'none',
          }}
        >
          {t.label}
        </button>
      ))}
      <div className="w-px h-3" style={{ backgroundColor: dark ? 'rgba(255,255,255,0.12)' : 'var(--color-border-divider)' }} />
      {PRI_OPTS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => setPriority(p.value)}
          className="text-[10px] font-medium px-2 py-[2px] rounded-full transition-all duration-100"
          style={{
            background: `${p.color}${priority === p.value ? active : dim}`,
            color: p.color,
            outline: priority === p.value ? `1.5px solid ${p.color}70` : 'none',
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function IssueCreateModal({ open, columnId, style, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>('task');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const createIssue = useIssueStore((s) => s.createIssue);

  // Reset + auto-focus on open
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setType('task');
      setPriority('medium');
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [open]);

  // Global Escape to close
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const submit = useCallback(async () => {
    const t = title.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    await createIssue({ title: t, description: description.trim(), type, priority });
    setSubmitting(false);
    onCreated?.();
    onClose();
  }, [title, description, type, priority, submitting, createIssue, onCreated, onClose]);

  function onCmdEnter(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
  }

  if (!open) return null;

  // ── Style 1: Command palette ────────────────────────────────────────────
  if (style === 1) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[13vh]"
        style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(3px)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-[540px] mx-4 rounded-[14px] overflow-hidden motion-safe:animate-[modal-enter_150ms_ease-out_both]"
          style={{
            backgroundColor: '#1D1B18',
            boxShadow: '0 28px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07)',
            borderTop: '2.5px solid var(--color-accent-orange)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Title input */}
          <div className="px-5 pt-5 pb-3">
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
                onCmdEnter(e);
              }}
              placeholder="What needs to be done?"
              className="w-full bg-transparent text-[length:var(--font-size-base)] font-medium outline-none"
              style={{ color: 'rgba(255,255,255,0.88)', caretColor: 'var(--color-accent-orange)' }}
            />
          </div>

          {/* Chips */}
          <div className="px-5 pb-4 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <Chips type={type} setType={setType} priority={priority} setPriority={setPriority} dark />
          </div>

          {/* Hint */}
          <div
            className="flex items-center justify-between px-5 py-2.5 border-t text-[10px]"
            style={{ borderColor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)' }}
          >
            <span>
              <kbd className="px-1 py-0.5 rounded font-mono text-[9px]" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>↵</kbd>
              {' '}create · {' '}
              <kbd className="px-1 py-0.5 rounded font-mono text-[9px]" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>Esc</kbd>
              {' '}cancel
            </span>
            <span className="opacity-60">{columnId}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Style 2: Structured form dialog ─────────────────────────────────────
  if (style === 2) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.44)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-[540px] rounded-[var(--radius-xl)] border overflow-hidden motion-safe:animate-[modal-enter_160ms_ease-out_both]"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3.5 border-b"
            style={{ borderColor: 'var(--color-border-divider)' }}
          >
            <div className="flex items-center gap-2">
              <h2 className="text-[length:var(--font-size-sm)] font-semibold text-text-primary">New Issue</h2>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full capitalize"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}
              >
                {columnId.replace('-', ' ')}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Title <span style={{ color: 'var(--color-accent-red)' }}>*</span>
              </label>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={onCmdEnter}
                placeholder="Issue title..."
                className="w-full px-3 py-2 rounded-[var(--radius-default)] border text-[length:var(--font-size-sm)] text-text-primary placeholder:text-text-placeholder bg-transparent outline-none transition-colors"
                style={{ borderColor: 'var(--color-border)' }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--color-accent-blue)'; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--color-border)'; }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Description
              </label>
              <textarea
                ref={descRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={onCmdEnter}
                placeholder="Optional description..."
                rows={3}
                className="w-full px-3 py-2 rounded-[var(--radius-default)] border text-[length:var(--font-size-sm)] text-text-primary placeholder:text-text-placeholder bg-transparent outline-none resize-none transition-colors"
                style={{ borderColor: 'var(--color-border)' }}
                onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--color-accent-blue)'; }}
                onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--color-border)'; }}
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Type</label>
              <div className="flex gap-2 flex-wrap">
                {TYPE_OPTS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className="text-[11px] font-medium px-3 py-1 rounded-[var(--radius-default)] transition-all"
                    style={{
                      background: type === t.value ? `${t.color}25` : 'var(--color-bg-secondary)',
                      color: type === t.value ? t.color : 'var(--color-text-secondary)',
                      outline: type === t.value ? `1.5px solid ${t.color}55` : 'none',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Priority</label>
              <div className="flex gap-2 flex-wrap">
                {PRI_OPTS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className="text-[11px] font-medium px-3 py-1 rounded-[var(--radius-default)] transition-all"
                    style={{
                      background: priority === p.value ? `${p.color}25` : 'var(--color-bg-secondary)',
                      color: priority === p.value ? p.color : 'var(--color-text-secondary)',
                      outline: priority === p.value ? `1.5px solid ${p.color}55` : 'none',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-5 py-3.5 border-t"
            style={{ borderColor: 'var(--color-border-divider)' }}
          >
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              <kbd className="px-1 py-0.5 rounded font-mono text-[9px]" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>⌘↵</kbd>
              {' '}to create
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] border transition-colors hover:bg-bg-hover"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!title.trim() || submitting}
                className="px-4 py-1.5 rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] text-white font-medium transition-all disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-accent-orange)' }}
              >
                {submitting ? 'Creating…' : 'Create Issue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Style 3: Focus / writing-first ──────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
      onClick={onClose}
    >
      {/* Top-right actions */}
      <div className="absolute top-5 right-6 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!title.trim() || submitting}
          className="px-4 py-1.5 rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] text-white font-medium transition-all disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-accent-orange)' }}
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div
        className="w-full max-w-[720px] px-8 motion-safe:animate-[modal-enter_180ms_ease-out_both]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Type indicator */}
        <div className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
          New Issue · {columnId.replace('-', ' ')}
        </div>

        {/* Large title */}
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); descRef.current?.focus(); }
            onCmdEnter(e);
          }}
          placeholder="Untitled issue"
          className="w-full bg-transparent outline-none mb-5 leading-tight"
          style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            caretColor: 'var(--color-accent-orange)',
          }}
        />

        {/* Description */}
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onCmdEnter}
          placeholder="Add a description… (optional)"
          rows={7}
          className="w-full bg-transparent outline-none resize-none leading-relaxed mb-8"
          style={{
            fontSize: 'var(--font-size-base)',
            color: 'var(--color-text-secondary)',
            caretColor: 'var(--color-accent-orange)',
          }}
        />

        {/* Bottom bar: chips + hint */}
        <div
          className="flex items-center gap-4 pt-4 border-t flex-wrap"
          style={{ borderColor: 'var(--color-border-divider)' }}
        >
          <Chips type={type} setType={setType} priority={priority} setPriority={setPriority} />
          <div className="ml-auto text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            <kbd className="px-1 py-0.5 rounded font-mono text-[9px]" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>⌘↵</kbd>
            {' '}to create
          </div>
        </div>
      </div>
    </div>
  );
}
