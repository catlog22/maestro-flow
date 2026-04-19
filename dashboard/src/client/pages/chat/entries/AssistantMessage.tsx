import { useAgentStore } from '@/client/store/agent-store.js';
import { MarkdownRenderer } from '@/client/components/artifacts/MarkdownRenderer.js';
import { CollapsibleContent } from '@/client/components/CollapsibleContent.js';
import { AGENT_LABELS } from '@/shared/constants.js';
import type { AssistantMessageEntry, AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// AssistantMessage -- left-aligned message with avatar + markdown rendering
// ---------------------------------------------------------------------------

// chat.html style: tinted background + accent text color (not solid bg + white text)
export const AVATAR_CONFIG: Record<AgentType, { label: string; color: string; tint: string; className: string }> = {
  'claude-code': { label: 'C', color: 'var(--color-accent-purple)', tint: 'var(--color-tint-planning)', className: 'claude' },
  codex:         { label: 'Cx', color: 'var(--color-accent-green)', tint: 'var(--color-tint-completed)', className: 'codex' },
  'codex-server': { label: 'Cs', color: 'var(--color-accent-green)', tint: 'var(--color-tint-completed)', className: 'codex' },
  gemini:        { label: 'G', color: 'var(--color-accent-blue)', tint: 'var(--color-tint-exploring)', className: 'gemini' },
  'gemini-a2a':  { label: 'Ga', color: 'var(--color-accent-blue)', tint: 'var(--color-tint-exploring)', className: 'gemini' },
  qwen:          { label: 'Q', color: 'var(--color-accent-orange)', tint: 'var(--color-tint-verifying)', className: 'qwen' },
  opencode:      { label: 'O', color: 'var(--color-text-tertiary)', tint: 'var(--color-bg-secondary)', className: 'opencode' },
  'agent-sdk':   { label: 'S', color: 'var(--color-accent-purple)', tint: 'var(--color-tint-planning)', className: 'claude' },
};

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function AssistantMessage({ entry, isGroupContinuation }: { entry: AssistantMessageEntry; isGroupContinuation?: boolean }) {
  const process = useAgentStore((s) => s.processes[entry.processId]);
  const agentType = process?.type;
  const isActive = process?.status === 'running' || process?.status === 'spawning';
  const cfg = AVATAR_CONFIG[agentType ?? 'claude-code'] ?? AVATAR_CONFIG['claude-code'];

  return (
    <div className="flex gap-[8px]" style={{ paddingTop: isGroupContinuation ? 0 : 10, paddingBottom: 10 }}>
      {/* Agent avatar — hidden for continuation messages in a group */}
      {isGroupContinuation ? (
        <div className="shrink-0 w-6" />
      ) : (
        <div
          className="relative shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center mt-[2px] text-[10px] font-bold"
          style={{ backgroundColor: cfg.tint, color: cfg.color }}
        >
          {cfg.label}
          {isActive && (
            <span
              className="absolute inset-[-3px] rounded-[8px] pointer-events-none"
              style={{
                border: '1.5px solid currentColor',
                color: cfg.color,
                opacity: 0.3,
                animation: 'avatar-pulse 2.5s ease-in-out infinite',
              }}
            />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-1 contain-content">
        {/* Header: agent name + timestamp */}
        {!isGroupContinuation && (
          <div className="flex items-center gap-[5px] mb-[2px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {AGENT_LABELS[agentType ?? 'claude-code'] ?? 'Maestro'}
            </span>
            <span className="text-[9px]" style={{ color: 'var(--color-text-placeholder)' }}>
              {formatMsgTime(entry.timestamp)}
            </span>
          </div>
        )}
        {entry.partial ? (
          <div className="text-text-primary text-[13px] leading-[1.6] whitespace-pre-wrap break-words">
            {entry.content}
            <span
              className="inline-block w-[2px] h-[1em] ml-[2px] align-text-bottom"
              style={{
                backgroundColor: 'var(--color-accent-orange)',
                animation: 'blink-cursor 1s step-end infinite',
              }}
              aria-label="Typing"
            />
          </div>
        ) : (
          <CollapsibleContent maxHeight={300}>
            <MarkdownRenderer content={entry.content} />
          </CollapsibleContent>
        )}
      </div>
    </div>
  );
}
