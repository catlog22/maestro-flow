import { useState, useRef, useCallback } from 'react';
import { useAgentStore } from '@/client/store/agent-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ChatInput -- composer with toolbar buttons matching design-chat-v1a
// ---------------------------------------------------------------------------

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'gemini', 'qwen', 'opencode'];

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  qwen: 'Qwen',
  opencode: 'OpenCode',
};

const AGENT_DOT_COLORS: Record<AgentType, string> = {
  'claude-code': 'var(--color-accent-purple)',
  codex: 'var(--color-accent-green)',
  gemini: 'var(--color-accent-blue)',
  qwen: 'var(--color-accent-orange)',
  opencode: 'var(--color-text-tertiary)',
};

const SLASH_COMMANDS = [
  { name: '/maestro-plan', desc: 'Create detailed phase plan', color: 'var(--color-accent-purple)', bg: 'var(--color-tint-planning)' },
  { name: '/quality-review', desc: 'Tiered code review', color: 'var(--color-accent-green)', bg: 'var(--color-tint-completed)' },
  { name: '/maestro-execute', desc: 'Execute phase with parallelization', color: 'var(--color-accent-orange)', bg: 'var(--color-tint-verifying)' },
  { name: '/quality-debug', desc: 'Parallel hypothesis debugging', color: 'var(--color-accent-blue)', bg: 'var(--color-tint-exploring)' },
];

export function ChatInput() {
  const [text, setText] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [slashOpen, setSlashOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const activeProcess = useAgentStore((s) =>
    s.activeProcessId ? s.processes[s.activeProcessId] ?? null : null,
  );

  const isNonInteractive =
    activeProcess != null &&
    activeProcess.type !== 'claude-code' &&
    activeProcess.status === 'running';

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (activeProcessId && activeProcess) {
      sendWsMessage({
        action: 'message',
        processId: activeProcessId,
        content: trimmed,
      });
    } else {
      sendWsMessage({
        action: 'spawn',
        config: {
          type: agentType,
          prompt: trimmed,
          workDir: '.',
        },
      });
    }

    setText('');
    setSlashOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, activeProcessId, activeProcess, agentType]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    setSlashOpen(val.startsWith('/'));
  }, []);

  const handleSlashSelect = useCallback((cmd: string) => {
    setText(cmd + ' ');
    setSlashOpen(false);
    textareaRef.current?.focus();
  }, []);

  const showAgentSelector = !activeProcessId;
  const currentModel = activeProcess?.type ?? agentType;

  return (
    <div
      className="shrink-0 px-6 pb-[14px] pt-2"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      {isNonInteractive && (
        <div
          className="mb-2 px-3 py-1 rounded-[var(--radius-default)] text-[length:var(--font-size-xs)] text-text-tertiary"
          style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        >
          This agent type does not support follow-up messages while running.
        </div>
      )}
      <div className="max-w-[780px] mx-auto relative">
        {/* Slash command menu */}
        {slashOpen && (
          <div
            className="absolute bottom-full left-0 right-0 mb-[6px] border rounded-[12px] p-[6px] max-h-[240px] overflow-y-auto z-50"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              borderColor: 'var(--color-border)',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.06)',
            }}
          >
            {SLASH_COMMANDS.filter((c) => c.name.startsWith(text) || text === '/').map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => handleSlashSelect(cmd.name)}
                className="flex items-center gap-[10px] w-full px-[10px] py-[7px] rounded-[8px] cursor-pointer transition-colors duration-100 text-left border-none bg-transparent hover:bg-bg-hover"
              >
                <span
                  className="w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0"
                  style={{ backgroundColor: cmd.bg }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cmd.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </span>
                <div>
                  <div className="text-[12px] font-semibold text-text-primary">{cmd.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{cmd.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <div
          className="border rounded-[14px] overflow-hidden transition-[border-color,box-shadow]"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-bg-card)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02)',
            transitionDuration: 'var(--duration-normal)',
          }}
          onFocusCapture={(e) => {
            const wrap = e.currentTarget as HTMLElement;
            wrap.style.borderColor = 'var(--color-accent-orange)';
            wrap.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06), 0 0 0 3px rgba(200, 134, 58, 0.08)';
          }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              const wrap = e.currentTarget as HTMLElement;
              wrap.style.borderColor = 'var(--color-border)';
              wrap.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02)';
            }
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            disabled={isNonInteractive}
            placeholder={activeProcessId ? 'Send a message...' : 'Send a message, / for commands...'}
            rows={1}
            className="w-full min-h-[42px] max-h-[200px] resize-none border-none px-[14px] py-[10px] text-[13px] leading-[1.5] bg-transparent outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: 'var(--color-text-primary)' }}
          />
          <div
            className="flex items-center gap-[2px] px-[6px] py-1"
            style={{}}
          >
            {/* File button */}
            <ToolbarButton
              tooltip="File"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>}
            />
            {/* Image button */}
            <ToolbarButton
              tooltip="Image"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
            />
            {/* Skills button */}
            <ToolbarButton
              tooltip="Skills"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
              onClick={() => setSlashOpen((v) => !v)}
            />

            <div className="w-px h-[18px] mx-1" style={{ backgroundColor: 'var(--color-border-divider)' }} />

            {/* Agent selector */}
            <div
              className="flex items-center gap-[5px] ml-auto px-[10px] py-[3px] rounded-full border cursor-pointer text-[11px] font-medium transition-colors duration-150"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-bg-primary)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ backgroundColor: AGENT_DOT_COLORS[showAgentSelector ? agentType : currentModel] }}
              />
              {showAgentSelector ? (
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value as AgentType)}
                  className="border-none bg-transparent cursor-pointer outline-none appearance-none text-[11px] font-medium"
                  style={{ color: 'inherit' }}
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t} value={t}>{AGENT_LABELS[t]}</option>
                  ))}
                </select>
              ) : (
                <span>{AGENT_LABELS[currentModel] ?? currentModel}</span>
              )}
            </div>

            {/* Send button */}
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim() || isNonInteractive}
              className="shrink-0 w-[34px] h-[30px] rounded-[8px] flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 ml-1 border-none cursor-pointer"
              style={{ backgroundColor: 'var(--color-accent-orange)', color: '#fff' }}
              aria-label="Send message"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className="flex gap-3 mt-[5px] px-[6px] text-[10px]"
          style={{ color: 'var(--color-text-placeholder)' }}
        >
          <span><kbd className="font-mono text-[10px] px-1 border rounded-[3px]" style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-secondary)' }}>Enter</kbd> send</span>
          <span><kbd className="font-mono text-[10px] px-1 border rounded-[3px]" style={{ borderColor: 'var(--color-border-divider)', backgroundColor: 'var(--color-bg-secondary)' }}>/</kbd> skills</span>
          <span className="ml-auto">{AGENT_LABELS[showAgentSelector ? agentType : currentModel]} &middot; opus-4.6</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolbarButton — icon button in the composer toolbar
// ---------------------------------------------------------------------------

function ToolbarButton({
  tooltip,
  icon,
  onClick,
}: {
  tooltip: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-[30px] h-[30px] rounded-[8px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-150"
      style={{ color: 'var(--color-text-tertiary)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
        (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)';
      }}
    >
      {icon}
      <span
        className="absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 px-[7px] py-[2px] rounded-[5px] text-[10px] font-medium text-white whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-[120ms]"
        style={{ backgroundColor: 'var(--color-text-primary)' }}
      >
        {tooltip}
      </span>
    </button>
  );
}
