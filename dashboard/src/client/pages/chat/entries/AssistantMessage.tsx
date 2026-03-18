import { useAgentStore } from '@/client/store/agent-store.js';
import { MarkdownRenderer } from '@/client/components/artifacts/MarkdownRenderer.js';
import { CollapsibleContent } from '@/client/components/CollapsibleContent.js';
import type { AssistantMessageEntry, AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// AssistantMessage -- left-aligned message with avatar + markdown rendering
// ---------------------------------------------------------------------------

const AVATAR_CONFIG: Record<AgentType, { label: string; color: string; className: string }> = {
  'claude-code': { label: 'C', color: 'var(--color-accent-purple)', className: 'claude' },
  codex:         { label: 'Cx', color: 'var(--color-accent-green)', className: 'codex' },
  'codex-server': { label: 'Cs', color: 'var(--color-accent-green)', className: 'codex' },
  gemini:        { label: 'G', color: 'var(--color-accent-blue)', className: 'gemini' },
  qwen:          { label: 'Q', color: 'var(--color-accent-orange)', className: 'qwen' },
  opencode:      { label: 'O', color: 'var(--color-text-tertiary)', className: 'opencode' },
  'agent-sdk':   { label: 'S', color: 'var(--color-accent-purple)', className: 'claude' },
};

export function AssistantMessage({ entry }: { entry: AssistantMessageEntry }) {
  const process = useAgentStore((s) => s.processes[entry.processId]);
  const agentType = process?.type;
  const isActive = process?.status === 'running' || process?.status === 'spawning';
  const cfg = AVATAR_CONFIG[agentType ?? 'claude-code'] ?? AVATAR_CONFIG['claude-code'];

  return (
    <div className="flex gap-[10px] py-[10px]">
      {/* Agent avatar — text label with optional active pulse */}
      <div
        className="relative shrink-0 w-7 h-7 rounded-[8px] flex items-center justify-center mt-[2px] text-[11px] font-bold text-white"
        style={{ backgroundColor: cfg.color }}
      >
        {cfg.label}
        {isActive && (
          <span
            className="absolute inset-[-3px] rounded-[10px] pointer-events-none"
            style={{
              border: '1.5px solid currentColor',
              color: cfg.color,
              opacity: 0.3,
              animation: 'avatar-pulse 2.5s ease-in-out infinite',
            }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2 contain-content">
        {entry.partial ? (
          <div className="text-text-primary text-[13px] leading-[1.75] whitespace-pre-wrap break-words">
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
