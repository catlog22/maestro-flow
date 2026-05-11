import { useState, useCallback } from 'react';
import type { MaestroSessionListItem } from '@/shared/maestro-session-types.js';
import type { SessionDetail } from '@/client/store/maestro-coordinate-store.js';
import { SOURCE_COLORS, formatTimestamp } from './constants.js';
import { MetaField } from './SessionDetailPanel.js';
import { StepsTimeline } from './StepsTimeline.js';
import { SessionContextCard } from './SessionContextCard.js';

// ---------------------------------------------------------------------------
// SessionDetailPanel — right panel showing selected session details
// ---------------------------------------------------------------------------

export function SessionDetailContent({
  session,
  detail,
}: {
  session: MaestroSessionListItem;
  detail: SessionDetail;
}) {
  const sourceColor = SOURCE_COLORS[session.source] ?? '#A09D97';

  return (
    <div className="p-5 overflow-y-auto h-full">
      {/* ---- Header card ---- */}
      <div className="bg-bg-card border border-border-divider rounded-[10px] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-[10px] border-b border-border-divider">
          <div className="flex items-center gap-2">
            <div
              className="w-[10px] h-[10px] rounded-full"
              style={{ background: sourceColor }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {session.source}
            </span>
          </div>
          <StatusPill status={session.status} />
        </div>
        <div className="p-4">
          {/* Intent */}
          <div className="text-[14px] font-semibold text-text-primary leading-snug mb-3">
            {session.intent}
          </div>

          {/* Resume command */}
          <ResumeCommand source={session.source} sessionId={session.sessionId} intent={session.intent} status={session.status} />

          {/* Meta grid */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
            {session.chainName && (
              <MetaField label="Chain" value={session.chainName} />
            )}
            {session.lifecyclePosition && (
              <MetaField label="Lifecycle" value={session.lifecyclePosition} />
            )}
            {session.phase != null && (
              <MetaField label="Phase" value={String(session.phase)} />
            )}
            {session.milestone && (
              <MetaField label="Milestone" value={session.milestone} />
            )}
            <MetaField
              label="Progress"
              value={`${session.currentStep}/${session.totalSteps}`}
            />
            <MetaField label="Updated" value={formatTimestamp(session.updatedAt)} />
          </div>
        </div>
      </div>

      {/* ---- Steps Timeline card ---- */}
      <div className="bg-bg-card border border-border-divider rounded-[10px] overflow-hidden mt-4">
        <div className="flex items-center justify-between px-4 py-[10px] border-b border-border-divider">
          <span className="text-[length:var(--font-size-sm)] font-semibold text-text-primary">
            Steps
          </span>
          {detail.source === 'coordinate' && (
            <span className="text-[10px] text-text-tertiary">
              Node: <span className="font-mono">{detail.data.current_node}</span>
            </span>
          )}
        </div>
        <div className="p-4">
          <StepsTimeline detail={detail} />
        </div>
      </div>

      {/* ---- Context card (ralph only) ---- */}
      {detail.source === 'ralph' && (
        <div className="bg-bg-card border border-border-divider rounded-[10px] overflow-hidden mt-4">
          <div className="px-4 py-[10px] border-b border-border-divider">
            <span className="text-[length:var(--font-size-sm)] font-semibold text-text-primary">
              Context
            </span>
          </div>
          <div className="p-4">
            <SessionContextCard detail={detail} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusPill — inline pill using color18 pattern
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: string }) {
  const STATUS_COLORS: Record<string, string> = {
    running: '#4A90D9',
    in_progress: '#4A90D9',
    completed: '#5A9E78',
    failed: '#C46555',
    pending: '#A09D97',
    idle: '#A09D97',
    verifying: '#D4832E',
    paused: '#A09D97',
  };
  const color = STATUS_COLORS[status] ?? '#A09D97';

  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${color}18`, color }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ResumeCommand — copyable CLI command to resume/continue a session
// ---------------------------------------------------------------------------

function getResumeCommand(
  source: string,
  sessionId: string,
  intent: string,
  status: string,
): string | null {
  // Completed/failed sessions can be resumed
  if (source === 'ralph') {
    return status === 'completed' || status === 'failed'
      ? `/maestro-ralph continue`
      : `/maestro-ralph continue`;
  }
  if (source === 'maestro') {
    // Maestro sessions are re-invoked with the original intent
    return `/maestro "${intent}"`;
  }
  if (source === 'coordinate') {
    return `/maestro-execute`;
  }
  return null;
}

function ResumeCommand({
  source,
  sessionId,
  intent,
  status,
}: {
  source: string;
  sessionId: string;
  intent: string;
  status: string;
}) {
  const cmd = getResumeCommand(source, sessionId, intent, status);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!cmd) return;
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [cmd]);

  if (!cmd) return null;

  return (
    <div className="flex items-center gap-2 mb-3">
      <code className="flex-1 px-3 py-1.5 text-[11px] font-mono text-text-secondary bg-bg-secondary rounded-[var(--radius-md)] border border-border-divider select-all truncate">
        {cmd}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className={[
          'shrink-0 px-2 py-1 text-[10px] font-semibold rounded-[var(--radius-md)]',
          'border border-border-divider transition-colors duration-150',
          copied
            ? 'bg-[rgba(90,158,120,0.12)] text-[#5A9E78] border-[#5A9E78]'
            : 'bg-bg-card text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
        ].join(' ')}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
