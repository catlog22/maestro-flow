import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { cn } from '@/client/lib/utils.js';

// ---------------------------------------------------------------------------
// CreateRoomDialog — modal to create a new meeting room session
// ---------------------------------------------------------------------------

interface CreateRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputCls = cn(
  'w-full px-[var(--spacing-3)] py-[var(--spacing-2)]',
  'rounded-[var(--radius-default)] border border-border',
  'bg-bg-secondary text-text-primary',
  'text-[length:var(--font-size-sm)]',
  'focus:outline-none focus:shadow-[var(--shadow-focus-ring)]',
  'transition-shadow duration-[var(--duration-fast)]',
);

const labelCls = 'block text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary mb-[var(--spacing-1)]';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function CreateRoomDialog({ open, onOpenChange }: CreateRoomDialogProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  const sessionId = toSlug(name) || `room-${Date.now().toString(36)}`;

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    sendWsMessage({ action: 'room:create', sessionId } as never);
    onOpenChange(false);
    navigate(`/meeting-room/${sessionId}`);
  }, [name, sessionId, onOpenChange, navigate]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[440px] max-w-[95vw]',
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
              New Meeting Room
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

          {/* Form */}
          <div className="p-[var(--spacing-6)] space-y-[var(--spacing-4)]">
            <div>
              <label htmlFor="room-name" className={labelCls}>Room Name</label>
              <input
                id="room-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="e.g. Architecture Review"
                className={inputCls}
                autoFocus
              />
              <p className="mt-1 text-[10px] text-text-placeholder font-mono">
                ID: {sessionId}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-[var(--spacing-6)] py-[var(--spacing-4)] border-t border-border">
            <Dialog.Close
              className={cn(
                'px-3 py-1.5 rounded-[var(--radius-default)]',
                'text-[length:var(--font-size-sm)] text-text-secondary',
                'hover:bg-bg-hover transition-colors',
              )}
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!name.trim()}
              className={cn(
                'px-4 py-1.5 rounded-[var(--radius-default)]',
                'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
                'bg-accent-blue text-white',
                'hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-opacity',
              )}
            >
              Create
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
