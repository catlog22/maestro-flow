import { useState } from 'react';
import { useUIPrefsStore } from '@/client/store/ui-prefs-store.js';
import type { CreateModalStyle, DetailModalStyle } from '@/client/store/ui-prefs-store.js';
import { SettingsCard } from '../SettingsComponents.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// KanbanSection — issue create/detail modal style preference with live preview
// ---------------------------------------------------------------------------

// ── Thumbnail: Create Style 1 (Command palette) ───────────────────────────

function CreateThumb1() {
  return (
    <div className="w-full h-full rounded-[6px] overflow-hidden flex flex-col" style={{ backgroundColor: '#1D1B18', borderTop: '2px solid #C8863A' }}>
      <div className="px-2.5 py-2 flex-1">
        <div className="h-[7px] rounded w-[72%] mb-2" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
        <div className="flex gap-1 mt-2 flex-wrap">
          {['#C46555','#5B8DB8','#9178B5','#A09D97'].map((c) => (
            <div key={c} className="h-[5px] rounded-full" style={{ width: 22, backgroundColor: `${c}55` }} />
          ))}
        </div>
      </div>
      <div className="px-2.5 py-1.5 border-t flex items-center gap-1" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
        <div className="h-[4px] rounded w-6" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
        <div className="h-[4px] rounded w-6 ml-1" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
      </div>
    </div>
  );
}

// ── Thumbnail: Create Style 2 (Form dialog) ────────────────────────────────

function CreateThumb2() {
  return (
    <div
      className="w-full h-full rounded-[6px] overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b" style={{ borderColor: 'var(--color-border-divider)' }}>
        <div className="h-[5px] rounded w-14" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.7 }} />
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--color-bg-hover)' }} />
      </div>
      {/* Fields */}
      <div className="px-2 py-1.5 flex-1 space-y-1.5">
        <div className="h-[3px] rounded w-6" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
        <div className="h-[6px] rounded border w-full" style={{ borderColor: 'var(--color-border)' }} />
        <div className="h-[3px] rounded w-8" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
        <div className="h-[12px] rounded border w-full" style={{ borderColor: 'var(--color-border)' }} />
        <div className="flex gap-1">
          {['#C46555','#5B8DB8','#9178B5','#A09D97'].map((c) => (
            <div key={c} className="h-[5px] rounded" style={{ width: 16, backgroundColor: `${c}25` }} />
          ))}
        </div>
      </div>
      {/* Footer */}
      <div className="flex justify-end gap-1 px-2 py-1.5 border-t" style={{ borderColor: 'var(--color-border-divider)' }}>
        <div className="h-[6px] rounded w-8" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
        <div className="h-[6px] rounded w-10" style={{ backgroundColor: '#C8863A' }} />
      </div>
    </div>
  );
}

// ── Thumbnail: Create Style 3 (Focus mode) ────────────────────────────────

function CreateThumb3() {
  return (
    <div className="w-full h-full rounded-[6px] overflow-hidden flex flex-col items-center justify-center px-3" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <div className="w-full">
        <div className="h-[3px] rounded w-10 mb-2" style={{ backgroundColor: 'var(--color-text-tertiary)', opacity: 0.5 }} />
        <div className="h-[10px] rounded w-[85%] mb-1.5" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
        <div className="h-[4px] rounded w-full mb-1" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.3 }} />
        <div className="h-[4px] rounded w-[70%] mb-3" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.3 }} />
        <div className="flex gap-1 items-center pt-1.5 border-t" style={{ borderColor: 'var(--color-border-divider)' }}>
          {['#C46555','#5B8DB8','#9178B5'].map((c) => (
            <div key={c} className="h-[4px] rounded-full" style={{ width: 18, backgroundColor: `${c}45` }} />
          ))}
          <div className="ml-auto h-[5px] rounded w-8" style={{ backgroundColor: '#C8863A', opacity: 0.7 }} />
        </div>
      </div>
    </div>
  );
}

// ── Thumbnail: Detail Style 1 (Slide panel) ────────────────────────────────

function DetailThumb1() {
  return (
    <div className="w-full h-full rounded-[6px] overflow-hidden flex relative" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      {/* Main dim */}
      <div className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.12)' }} />
      {/* Panel */}
      <div className="w-[45%] h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg-card)', borderLeft: '1px solid var(--color-border)' }}>
        <div className="px-2 py-1.5 border-b flex items-center gap-1" style={{ borderColor: 'var(--color-border-divider)' }}>
          <div className="h-[3px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <div className="h-[4px] rounded-full w-7 ml-1" style={{ backgroundColor: '#5B8DB825' }} />
        </div>
        <div className="px-2 py-1.5 space-y-1.5 flex-1">
          <div className="h-[6px] rounded w-[85%]" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.6 }} />
          <div className="h-[3px] rounded w-8 mt-1" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <div className="h-[4px] rounded w-12" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
          <div className="h-[3px] rounded w-8" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <div className="h-[4px] rounded w-16" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
        </div>
      </div>
    </div>
  );
}

// ── Thumbnail: Detail Style 2 (Modal overlay) ─────────────────────────────

function DetailThumb2() {
  return (
    <div className="w-full h-full rounded-[6px] overflow-hidden flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div
        className="w-[88%] h-[78%] rounded-[5px] overflow-hidden flex"
        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
      >
        {/* Left content */}
        <div className="flex-1 px-2 py-1.5 border-r" style={{ borderColor: 'var(--color-border-divider)' }}>
          <div className="flex gap-1 mb-1.5">
            {['#C46555','#5B8DB8'].map((c) => (
              <div key={c} className="h-[4px] rounded-full w-8" style={{ backgroundColor: `${c}30` }} />
            ))}
          </div>
          <div className="h-[7px] rounded w-[90%] mb-1" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.6 }} />
          <div className="h-[3px] rounded w-full mb-1" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.35 }} />
          <div className="h-[3px] rounded w-[80%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.35 }} />
        </div>
        {/* Right sidebar */}
        <div className="w-[36%] px-1.5 py-1.5 space-y-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="h-[3px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          {[['#C46555',18],['#5B8DB8',14],['#A09D97',20]].map(([c,w], i) => (
            <div key={i} className="h-[4px] rounded-full" style={{ width: w, backgroundColor: `${c}35` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Thumbnail: Detail Style 3 (Full page) ─────────────────────────────────

function DetailThumb3() {
  return (
    <div className="w-full h-full rounded-[6px] overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Breadcrumb bar */}
      <div className="flex items-center justify-between px-2 py-1 border-b shrink-0" style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-card)' }}>
        <div className="flex items-center gap-1">
          <div className="h-[3px] rounded w-6" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <span className="text-[6px]" style={{ color: 'var(--color-text-tertiary)' }}>›</span>
          <div className="h-[3px] rounded w-8" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.5 }} />
        </div>
        <div className="flex gap-1">
          <div className="h-[4px] rounded-full w-8" style={{ backgroundColor: '#C4655525' }} />
          <div className="h-[4px] rounded-full w-6" style={{ backgroundColor: '#5B8DB825' }} />
        </div>
      </div>
      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 px-3 py-2 space-y-1.5">
          <div className="h-[3px] rounded w-16" style={{ backgroundColor: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <div className="h-[8px] rounded w-[80%]" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
          <div className="h-[3px] rounded w-full" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.28 }} />
          <div className="h-[3px] rounded w-[75%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.28 }} />
        </div>
        <div className="w-[30%] px-1.5 py-2 border-l space-y-1.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {[12, 16, 10, 14].map((w, i) => (
            <div key={i} className="h-[3px] rounded" style={{ width: w, backgroundColor: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── StyleCard: selectable card with thumbnail ────────────────────────────

function StyleCard<T extends number>({
  value,
  current,
  label,
  description,
  accentColor,
  children,
  onSelect,
}: {
  value: T;
  current: T;
  label: string;
  description: string;
  accentColor: string;
  children: React.ReactNode;
  onSelect: (v: T) => void;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className="flex-1 min-w-0 rounded-[10px] overflow-hidden border-2 transition-all duration-200 text-left focus-visible:outline-none"
      style={{
        borderColor: selected ? accentColor : 'var(--color-border)',
        backgroundColor: selected ? `${accentColor}06` : 'var(--color-bg-card)',
        boxShadow: selected ? `0 0 0 3px ${accentColor}20` : 'var(--shadow-sm)',
        transform: selected ? 'translateY(-1px)' : 'none',
      }}
    >
      {/* Thumbnail area */}
      <div
        className="h-[100px] p-2"
        style={{ backgroundColor: selected ? `${accentColor}08` : 'var(--color-bg-secondary)' }}
      >
        {children}
      </div>

      {/* Label + description */}
      <div className="px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-border-divider)' }}>
        <div className="flex items-center gap-1.5 mb-0.5">
          {selected && (
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
          )}
          <span
            className="text-[11px] font-semibold"
            style={{ color: selected ? accentColor : 'var(--color-text-primary)' }}
          >
            {label}
          </span>
        </div>
        <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>
          {description}
        </p>
      </div>
    </button>
  );
}

// ── Live Preview Area ────────────────────────────────────────────────────

// Mini kanban board background
function MiniBoard() {
  const cols = [
    { color: '#A09D97', cards: [72, 60, 85] },
    { color: '#B89540', cards: [90, 65] },
    { color: '#5A9E78', cards: [55] },
  ];
  return (
    <div className="absolute inset-0 flex gap-2 p-3" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      {cols.map((col, ci) => (
        <div key={ci} className="flex-1 rounded-[8px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
          {/* Column header */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b" style={{ borderColor: 'var(--color-border-divider)' }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
            <div className="h-[5px] rounded w-12" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.4 }} />
          </div>
          {/* Cards */}
          <div className="p-1.5 space-y-1.5">
            {col.cards.map((w, i) => (
              <div
                key={i}
                className="rounded-[5px] p-1.5"
                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex gap-1 mb-1">
                  <div className="h-[4px] rounded-full w-10" style={{ backgroundColor: `${col.color}35` }} />
                  <div className="h-[4px] rounded-full w-7 ml-auto" style={{ backgroundColor: 'rgba(160,157,151,0.25)' }} />
                </div>
                <div className="h-[4px] rounded" style={{ width: `${w}%`, backgroundColor: 'var(--color-text-secondary)', opacity: 0.3 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Mock create modals for live preview (slightly larger than thumbnails)
function LiveCreatePreview({ style, animKey }: { style: CreateModalStyle; animKey: string }) {
  if (style === 1) {
    return (
      <div className="absolute inset-0 flex items-start justify-center pt-[14%]" style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}>
        <div
          key={animKey}
          className="w-[70%] rounded-[10px] overflow-hidden motion-safe:animate-[modal-enter_240ms_ease-out_both]"
          style={{ backgroundColor: '#1D1B18', borderTop: '2px solid #C8863A', boxShadow: '0 16px 50px rgba(0,0,0,0.5)' }}
        >
          <div className="px-4 py-3">
            <div className="h-[8px] rounded w-[60%]" style={{ backgroundColor: 'rgba(255,255,255,0.22)' }} />
          </div>
          <div className="px-4 pb-3 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <div className="flex gap-1.5">
              {['#C46555','#5B8DB8','#9178B5','#A09D97'].map((c) => (
                <div key={c} className="h-[6px] rounded-full w-8" style={{ backgroundColor: `${c}45` }} />
              ))}
            </div>
          </div>
          <div className="px-4 py-2 border-t flex items-center" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <div className="h-[4px] rounded w-24" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }} />
          </div>
        </div>
      </div>
    );
  }

  if (style === 2) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.38)' }}>
        <div
          key={animKey}
          className="w-[72%] rounded-[12px] overflow-hidden motion-safe:animate-[modal-enter_240ms_ease-out_both]"
          style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border-divider)' }}>
            <div className="h-[7px] rounded w-16" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.65 }} />
            <div className="w-4 h-4 rounded" style={{ backgroundColor: 'var(--color-bg-hover)' }} />
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="h-[4px] rounded w-8" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            <div className="h-[8px] rounded border w-full" style={{ borderColor: 'var(--color-border)' }} />
            <div className="h-[4px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            <div className="h-[16px] rounded border w-full" style={{ borderColor: 'var(--color-border)' }} />
            <div className="flex gap-1.5">
              {['#C46555','#5B8DB8','#9178B5','#A09D97'].map((c) => (
                <div key={c} className="h-[7px] rounded w-12" style={{ backgroundColor: `${c}22` }} />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 px-4 py-2.5 border-t" style={{ borderColor: 'var(--color-border-divider)' }}>
            <div className="h-[8px] rounded w-10" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
            <div className="h-[8px] rounded w-16" style={{ backgroundColor: '#C8863A' }} />
          </div>
        </div>
      </div>
    );
  }

  // Style 3 — Focus
  return (
    <div
      key={animKey}
      className="absolute inset-0 flex items-center justify-center motion-safe:animate-[modal-enter_240ms_ease-out_both]"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      <div className="w-[80%]">
        <div className="h-[4px] rounded w-20 mb-3" style={{ backgroundColor: 'var(--color-text-tertiary)', opacity: 0.5 }} />
        <div className="h-[14px] rounded w-[70%] mb-3" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
        <div className="space-y-1.5 mb-6">
          <div className="h-[5px] rounded w-full" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
          <div className="h-[5px] rounded w-[85%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
        </div>
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border-divider)' }}>
          {['#C46555','#5B8DB8','#9178B5'].map((c) => (
            <div key={c} className="h-[6px] rounded-full w-10" style={{ backgroundColor: `${c}35` }} />
          ))}
          <div className="ml-auto h-[8px] rounded w-12" style={{ backgroundColor: '#C8863A' }} />
        </div>
      </div>
    </div>
  );
}

// Mock detail views for live preview
function LiveDetailPreview({ style, animKey }: { style: DetailModalStyle; animKey: string }) {
  if (style === 1) {
    return (
      <>
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }} />
        <div
          key={animKey}
          className="absolute top-0 right-0 bottom-0 w-[42%] flex flex-col motion-safe:animate-[slide-in-right_240ms_ease-out_both]"
          style={{ backgroundColor: 'var(--color-bg-card)', borderLeft: '1px solid var(--color-border)', boxShadow: '0 0 30px rgba(0,0,0,0.15)' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--color-border-divider)' }}>
            <div className="h-[4px] rounded w-16" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            <div className="flex gap-1">
              <div className="h-[5px] rounded-full w-8" style={{ backgroundColor: '#C4655530' }} />
              <div className="h-[5px] rounded-full w-8" style={{ backgroundColor: '#5B8DB830' }} />
            </div>
          </div>
          <div className="px-3 py-3 space-y-2.5 flex-1">
            <div className="h-[8px] rounded w-[85%]" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
            <div className="h-[4px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            <div className="h-[6px] rounded w-16" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
            <div className="h-[4px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            <div className="space-y-1">
              <div className="h-[4px] rounded w-full" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
              <div className="h-[4px] rounded w-[80%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (style === 2) {
    return (
      <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <div
          key={animKey}
          className="w-[88%] h-[78%] rounded-[10px] overflow-hidden flex motion-safe:animate-[modal-enter_240ms_ease-out_both]"
          style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}
        >
          <div className="flex-1 flex flex-col border-r" style={{ borderColor: 'var(--color-border-divider)' }}>
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border-divider)' }}>
              <div className="h-[4px] rounded w-14" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            </div>
            <div className="flex-1 px-3 py-3 space-y-2">
              <div className="flex gap-1">
                {['#C46555','#5B8DB8'].map((c) => (
                  <div key={c} className="h-[5px] rounded-full w-10" style={{ backgroundColor: `${c}30` }} />
                ))}
              </div>
              <div className="h-[9px] rounded w-[80%]" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
              <div className="space-y-1">
                <div className="h-[4px] rounded w-full" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
                <div className="h-[4px] rounded w-[75%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.25 }} />
              </div>
            </div>
          </div>
          <div className="w-[36%] px-2.5 py-3 space-y-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-[4px] rounded w-14" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
            {[['#C46555',20],['#5B8DB8',16],['#A09D97',22]].map(([c,w], i) => (
              <div key={i} className="h-[6px] rounded-full" style={{ width: w, backgroundColor: `${c}35` }} />
            ))}
            <div className="pt-2 border-t space-y-1.5" style={{ borderColor: 'var(--color-border-divider)' }}>
              <div className="h-[4px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
              <div className="h-[4px] rounded w-12" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.35 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Style 3 — Full page
  return (
    <div
      key={animKey}
      className="absolute inset-0 flex flex-col motion-safe:animate-[slide-up_240ms_ease-out_both]"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      {/* Breadcrumb */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-card)' }}>
        <div className="flex items-center gap-1.5">
          <div className="h-[4px] rounded w-8" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <span className="text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>›</span>
          <div className="h-[4px] rounded w-10" style={{ backgroundColor: 'var(--color-text-tertiary)' }} />
          <span className="text-[8px]" style={{ color: 'var(--color-text-tertiary)' }}>›</span>
          <div className="h-[4px] rounded w-16" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.5 }} />
        </div>
        <div className="flex gap-1.5">
          <div className="h-[5px] rounded-full w-9" style={{ backgroundColor: '#C4655525' }} />
          <div className="h-[5px] rounded-full w-8" style={{ backgroundColor: '#5B8DB825' }} />
          <div className="h-[6px] rounded w-10" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
        </div>
      </div>
      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 px-6 py-4 space-y-2">
          <div className="h-[4px] rounded w-16" style={{ backgroundColor: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <div className="h-[11px] rounded w-[65%]" style={{ backgroundColor: 'var(--color-text-primary)', opacity: 0.55 }} />
          <div className="space-y-1.5 pt-1">
            <div className="h-[4px] rounded w-full" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.22 }} />
            <div className="h-[4px] rounded w-[80%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.22 }} />
            <div className="h-[4px] rounded w-[60%]" style={{ backgroundColor: 'var(--color-text-secondary)', opacity: 0.22 }} />
          </div>
        </div>
        <div className="w-[28%] border-l px-2.5 py-4 space-y-2.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {[['#C46555',22],['#5B8DB8',18],['#A09D97',24]].map(([c,w], i) => (
            <div key={i}>
              <div className="h-[3px] rounded w-8 mb-1" style={{ backgroundColor: 'var(--color-text-tertiary)', opacity: 0.6 }} />
              <div className="h-[5px] rounded-full" style={{ width: w, backgroundColor: `${c}35` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Live Preview container ────────────────────────────────────────────────

type PreviewTarget = 'create' | 'detail';

function LivePreviewZone({
  target,
  createStyle,
  detailStyle,
  animKey,
  labels,
  captions,
  createBtnLabel,
  detailBtnLabel,
}: {
  target: PreviewTarget;
  createStyle: CreateModalStyle;
  detailStyle: DetailModalStyle;
  animKey: string;
  labels: Record<PreviewTarget, Record<number, string>>;
  captions: Record<PreviewTarget, Record<number, string>>;
  createBtnLabel: string;
  detailBtnLabel: string;
}) {
  const style = target === 'create' ? createStyle : detailStyle;
  const accentColor = target === 'create' ? 'var(--color-accent-orange)' : 'var(--color-accent-blue)';

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1" style={{ backgroundColor: 'var(--color-border-divider)' }} />
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
            Live Preview — {labels[target][style]}
          </span>
        </div>
        <div className="h-px flex-1" style={{ backgroundColor: 'var(--color-border-divider)' }} />
      </div>

      {/* Preview viewport */}
      <div
        className="relative rounded-[10px] overflow-hidden border"
        style={{ height: 220, borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}
      >
        {/* Background: mini kanban board */}
        <MiniBoard />

        {/* Modal overlay — keyed so it re-animates on style change */}
        {target === 'create'
          ? <LiveCreatePreview style={createStyle} animKey={animKey} />
          : <LiveDetailPreview style={detailStyle} animKey={animKey} />
        }
      </div>

      {/* Caption */}
      <p className="mt-2 text-[10px] text-center" style={{ color: 'var(--color-text-tertiary)' }}>
        {captions[target][style]}
      </p>
    </div>
  );
}

// ── Main KanbanSection ─────────────────────────────────────────────────────

export function KanbanSection() {
  const { t } = useI18n();
  const createStyle = useUIPrefsStore((s) => s.createModalStyle);
  const detailStyle = useUIPrefsStore((s) => s.detailModalStyle);
  const setCreateStyle = useUIPrefsStore((s) => s.setCreateModalStyle);
  const setDetailStyle = useUIPrefsStore((s) => s.setDetailModalStyle);

  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>('create');
  const [animKey, setAnimKey] = useState('initial');

  function handleCreateStyle(s: CreateModalStyle) {
    setCreateStyle(s);
    setPreviewTarget('create');
    setAnimKey(`create-${s}-${Date.now()}`);
  }

  function handleDetailStyle(s: DetailModalStyle) {
    setDetailStyle(s);
    setPreviewTarget('detail');
    setAnimKey(`detail-${s}-${Date.now()}`);
  }

  const CREATE_STYLES: {
    value: CreateModalStyle;
    label: string;
    description: string;
    thumb: React.ReactNode;
  }[] = [
    { value: 1, label: t('settings.kanban.create_command'), description: t('settings.kanban.create_command_desc'), thumb: <CreateThumb1 /> },
    { value: 2, label: t('settings.kanban.create_form'), description: t('settings.kanban.create_form_desc'), thumb: <CreateThumb2 /> },
    { value: 3, label: t('settings.kanban.create_focus'), description: t('settings.kanban.create_focus_desc'), thumb: <CreateThumb3 /> },
  ];

  const DETAIL_STYLES: {
    value: DetailModalStyle;
    label: string;
    description: string;
    thumb: React.ReactNode;
  }[] = [
    { value: 1, label: t('settings.kanban.detail_panel'), description: t('settings.kanban.detail_panel_desc'), thumb: <DetailThumb1 /> },
    { value: 2, label: t('settings.kanban.detail_overlay'), description: t('settings.kanban.detail_overlay_desc'), thumb: <DetailThumb2 /> },
    { value: 3, label: t('settings.kanban.detail_page'), description: t('settings.kanban.detail_page_desc'), thumb: <DetailThumb3 /> },
  ];

  return (
    <div className="flex flex-col gap-[var(--spacing-5)]">

      {/* Create modal style */}
      <SettingsCard
        title={t('settings.kanban.create_card')}
        description={t('settings.kanban.create_desc')}
      >
        <div className="flex gap-3 mt-1">
          {CREATE_STYLES.map((s) => (
            <StyleCard
              key={s.value}
              value={s.value}
              current={createStyle}
              label={s.label}
              description={s.description}
              accentColor="var(--color-accent-orange)"
              onSelect={handleCreateStyle}
            >
              {s.thumb}
            </StyleCard>
          ))}
        </div>
      </SettingsCard>

      {/* Detail view style */}
      <SettingsCard
        title={t('settings.kanban.detail_card')}
        description={t('settings.kanban.detail_desc')}
      >
        <div className="flex gap-3 mt-1">
          {DETAIL_STYLES.map((s) => (
            <StyleCard
              key={s.value}
              value={s.value}
              current={detailStyle}
              label={s.label}
              description={s.description}
              accentColor="var(--color-accent-blue)"
              onSelect={handleDetailStyle}
            >
              {s.thumb}
            </StyleCard>
          ))}
        </div>
      </SettingsCard>

      {/* Live preview */}
      <SettingsCard title={t('settings.kanban.preview_card')} description={t('settings.kanban.preview_desc')}>
        {/* Target toggle */}
        <div className="flex gap-1 mb-4">
          {(['create', 'detail'] as PreviewTarget[]).map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => { setPreviewTarget(target); setAnimKey(`${target}-${createStyle}-${detailStyle}-${Date.now()}`); }}
              className="px-3 py-1 rounded-[var(--radius-sm)] text-[11px] font-medium transition-all"
              style={{
                backgroundColor: previewTarget === target ? 'var(--color-bg-active)' : 'transparent',
                color: previewTarget === target ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              }}
            >
              {target === 'create' ? t('settings.kanban.preview_create') : t('settings.kanban.preview_detail')}
            </button>
          ))}
        </div>

        <LivePreviewZone
          target={previewTarget}
          createStyle={createStyle}
          detailStyle={detailStyle}
          animKey={animKey}
          labels={{
            create: { 1: t('settings.kanban.create_command'), 2: t('settings.kanban.create_form'), 3: t('settings.kanban.create_focus') },
            detail: { 1: t('settings.kanban.detail_panel'), 2: t('settings.kanban.detail_overlay'), 3: t('settings.kanban.detail_page') },
          }}
          captions={{
            create: { 1: t('settings.kanban.create_caption_1'), 2: t('settings.kanban.create_caption_2'), 3: t('settings.kanban.create_caption_3') },
            detail: { 1: t('settings.kanban.detail_caption_1'), 2: t('settings.kanban.detail_caption_2'), 3: t('settings.kanban.detail_caption_3') },
          }}
          createBtnLabel={t('settings.kanban.preview_create')}
          detailBtnLabel={t('settings.kanban.preview_detail')}
        />
      </SettingsCard>

    </div>
  );
}
