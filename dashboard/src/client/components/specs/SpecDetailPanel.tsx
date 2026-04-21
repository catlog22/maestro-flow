import { useMemo } from 'react';
import { motion } from 'framer-motion';
import X from 'lucide-react/dist/esm/icons/x.js';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useSpecsStore, type SpecEntry, type SpecType } from '@/client/store/specs-store.js';

// ---------------------------------------------------------------------------
// SpecDetailPanel -- sliding panel showing entry details (380px from right)
// ---------------------------------------------------------------------------

const BADGE_STYLES: Partial<Record<SpecType, { bg: string; text: string }>> = {
  coding: { bg: 'var(--color-tint-exploring)', text: '#5B8DB8' },
  arch: { bg: 'var(--color-tint-planning)', text: '#9178B5' },
  quality: { bg: 'var(--color-tint-completed)', text: '#5A9E78' },
  debug: { bg: 'rgba(196,101,85,0.10)', text: '#B85B4A' },
  test: { bg: 'rgba(90,158,120,0.10)', text: '#3D8B5F' },
  review: { bg: 'rgba(219,176,108,0.12)', text: '#C4A055' },
  learning: { bg: 'var(--color-tint-blocked)', text: '#C46555' },
  // Legacy types (backward compat for existing data)
  bug: { bg: 'var(--color-tint-blocked)', text: '#C46555' },
  pattern: { bg: 'var(--color-tint-exploring)', text: '#5B8DB8' },
  decision: { bg: 'var(--color-tint-planning)', text: '#9178B5' },
  rule: { bg: 'var(--color-tint-completed)', text: '#5A9E78' },
  validation: { bg: 'rgba(91,141,184,0.10)', text: '#4A7DA8' },
  general: { bg: 'var(--color-tint-pending)', text: '#A09D97' },
};
const DEFAULT_BADGE = { bg: 'var(--color-tint-pending)', text: '#A09D97' };

function formatDate(ts: string): string {
  if (!ts) return '--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

interface SpecDetailPanelProps {
  entry: SpecEntry;
  onClose: () => void;
}

export function SpecDetailPanel({ entry, onClose }: SpecDetailPanelProps) {
  const deleteEntry = useSpecsStore((s) => s.deleteEntry);

  const badge = useMemo(() => BADGE_STYLES[entry.type] ?? DEFAULT_BADGE, [entry.type]);
  const fileName = useMemo(
    () => entry.file ? entry.file.split('/').pop() : '',
    [entry.file],
  );

  function handleDelete() {
    void deleteEntry(entry.id);
    onClose();
  }

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 380, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="shrink-0 border-l border-border bg-bg-primary overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-divider shrink-0 min-h-[48px]">
        <span className="text-[12px] font-semibold text-text-primary">Entry Detail</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="w-7 h-7 rounded-[8px] border-none bg-transparent cursor-pointer text-text-tertiary flex items-center justify-center hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ width: 380 }}>
        {/* Type badge */}
        <span
          className="inline-flex items-center gap-[5px] text-[10px] font-bold px-[10px] py-[3px] rounded-[6px] mb-3 uppercase tracking-[0.04em]"
          style={{ background: badge.bg, color: badge.text }}
        >
          {entry.type}
        </span>

        {/* Title / Content heading */}
        <div className="text-[16px] font-bold text-text-primary leading-[1.5] mb-4">
          {entry.title || entry.content}
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <MetaItem label="ID" value={entry.id} mono />
          <MetaItem label="Added" value={formatDate(entry.timestamp)} mono />
          <MetaItem label="File" value={fileName || '--'} mono />
          <MetaItem label="Type" value={entry.type} />
        </div>

        {/* Description / full content */}
        {entry.content && entry.title && entry.content !== entry.title && (
          <div className="mb-4">
            <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-text-quaternary mb-[6px]">
              Description
            </div>
            <div className="text-[13px] text-text-secondary leading-[1.6] whitespace-pre-wrap">
              {entry.content}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-3 border-t border-border-divider">
          <button
            type="button"
            className="flex-1 py-2 rounded-[8px] border border-text-primary bg-text-primary text-[12px] font-semibold text-white cursor-pointer font-sans flex items-center justify-center gap-[6px] hover:bg-[#1A1816] transition-all"
          >
            <Edit3 size={13} strokeWidth={2} />
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex-1 py-2 rounded-[8px] border border-border bg-bg-card text-[12px] font-semibold text-text-secondary cursor-pointer font-sans flex items-center justify-center gap-[6px] hover:border-[#C46555] hover:text-[#C46555] hover:bg-[rgba(196,101,85,0.08)] transition-all"
          >
            <Trash2 size={13} strokeWidth={2} />
            Delete
          </button>
        </div>
      </div>
    </motion.aside>
  );
}

// ---------------------------------------------------------------------------
// MetaItem -- small info cell in the 2x2 grid
// ---------------------------------------------------------------------------

function MetaItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-3 py-2 bg-bg-secondary rounded-[8px]">
      <div className="text-[9px] font-semibold uppercase tracking-[0.04em] text-text-quaternary mb-[2px]">
        {label}
      </div>
      <div
        className={[
          'text-[13px] font-semibold text-text-primary',
          mono ? 'font-mono text-[12px]' : '',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}
