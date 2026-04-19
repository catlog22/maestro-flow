import { useState, useRef, useCallback } from 'react';
import Zap from 'lucide-react/dist/esm/icons/zap.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { useCompositionInput } from '@/client/hooks/useCompositionInput.js';
import { useSlashCommandController } from '@/client/hooks/useSlashCommandController.js';
import { useAutoExpandTextarea } from '@/client/hooks/useAutoExpandTextarea.js';
import { ContextUsageIndicator } from './ContextUsageIndicator.js';
import { AGENT_DOT_COLORS, AGENT_LABELS } from '@/shared/constants.js';
import type { SlashCommand } from '@/client/hooks/useSlashCommandController.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// ChatInput -- composer with chip + icon agent selector (chat.html reference)
// ---------------------------------------------------------------------------

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'gemini', 'qwen', 'opencode', 'agent-sdk'];

/** Short labels for agent icon buttons */
const AGENT_SHORT: Record<AgentType, string> = {
  'claude-code': 'C',
  codex: 'Cx',
  'codex-server': 'Cs',
  gemini: 'G',
  'gemini-a2a': 'Ga',
  qwen: 'Q',
  opencode: 'O',
  'agent-sdk': 'S',
};

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/maestro-plan', desc: 'Create detailed phase plan', color: 'var(--color-accent-purple)', bg: 'var(--color-tint-planning)' },
  { name: '/quality-review', desc: 'Tiered code review', color: 'var(--color-accent-green)', bg: 'var(--color-tint-completed)' },
  { name: '/maestro-execute', desc: 'Execute phase with parallelization', color: 'var(--color-accent-orange)', bg: 'var(--color-tint-verifying)' },
  { name: '/quality-debug', desc: 'Parallel hypothesis debugging', color: 'var(--color-accent-blue)', bg: 'var(--color-tint-exploring)' },
];

type DelegateMessageDelivery = 'inject' | 'after_complete';

interface ChatInputProps {
  processId?: string | null;
  /** Executor type — fallback for interactivity when process not yet resolved */
  executor?: AgentType;
}

/** Fallback: executor types that support interactive messaging (used when process.interactive is unknown) */
const INTERACTIVE_EXECUTOR_FALLBACK = new Set<AgentType>(['claude-code']);

export function ChatInput({ processId: externalProcessId, executor }: ChatInputProps = {}) {
  const [text, setText] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('claude-code');
  const [delegateDelivery, setDelegateDelivery] = useState<DelegateMessageDelivery>('inject');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { isMultiline } = useAutoExpandTextarea(text, composerRef);
  const storeProcessId = useAgentStore((s) => s.activeProcessId);
  const processes = useAgentStore((s) => s.processes);

  const effectiveProcessId = externalProcessId !== undefined ? externalProcessId : storeProcessId;
  const activeProcess = effectiveProcessId ? processes[effectiveProcessId] ?? null : null;
  const isAsyncDelegateSession = Boolean(
    effectiveProcessId
    && effectiveProcessId.startsWith('cli-history-')
    && activeProcess?.interactive === true,
  );

  // Use process.interactive flag if available, fallback to executor type heuristic
  const isNonInteractive =
    activeProcess != null
      ? activeProcess.interactive === false
      : executor != null && !INTERACTIVE_EXECUTOR_FALLBACK.has(executor);
  // Disabled when: a specific processId was provided but process is non-interactive,
  // OR processId is a non-null string that doesn't resolve. null = new conversation (always enabled).
  const isDisabled = (externalProcessId !== undefined && externalProcessId !== null && !effectiveProcessId)
    || (!isAsyncDelegateSession && isNonInteractive);

  // -- IME-safe composition input --
  const { compositionHandlers, createKeyDownHandler } = useCompositionInput();

  // -- Slash command controller --
  const handleSlashSelect = useCallback((cmd: string) => {
    setText(cmd + ' ');
    textareaRef.current?.focus();
  }, []);

  const slashController = useSlashCommandController({
    input: text,
    commands: SLASH_COMMANDS,
    onSelect: handleSlashSelect,
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (effectiveProcessId && activeProcess) {
      if (isAsyncDelegateSession) {
        sendWsMessage({
          action: 'delegate:message',
          processId: effectiveProcessId,
          content: trimmed,
          delivery: delegateDelivery,
        });
      } else {
        sendWsMessage({
          action: 'message',
          processId: effectiveProcessId,
          content: trimmed,
        });
      }
    } else if (externalProcessId === undefined || externalProcessId === null) {
      // Spawn new agent when no processId or explicitly null (new conversation)
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
    slashController.setDismissed(true);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [
    text,
    effectiveProcessId,
    activeProcess,
    agentType,
    externalProcessId,
    slashController,
    isAsyncDelegateSession,
    delegateDelivery,
  ]);

  // Compose keydown: slash controller intercepts first, then Enter-to-send
  const handleKeyDown = createKeyDownHandler(handleSend, slashController.onKeyDown);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setText((prev) => prev + (prev ? ' ' : '') + `@${file.name}`);
      textareaRef.current?.focus();
    }
    e.target.value = '';
  }, []);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setText((prev) => prev + (prev ? ' ' : '') + `@${file.name}`);
      textareaRef.current?.focus();
    }
    e.target.value = '';
  }, []);

  const showAgentSelector = !effectiveProcessId && (externalProcessId === undefined || externalProcessId === null);
  const currentModel = activeProcess?.type ?? agentType;

  return (
    <div
      className="shrink-0 px-4 pb-[10px] pt-1"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
      <div className="max-w-[700px] mx-auto relative">
        {/* Slash command menu */}
        {slashController.isOpen && (
          <div
            className="absolute bottom-full left-0 right-0 mb-[6px] border rounded-[12px] p-[6px] max-h-[240px] overflow-y-auto z-50"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              borderColor: 'var(--color-border)',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.06)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {slashController.filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => slashController.onSelectByIndex(idx)}
                onMouseEnter={() => slashController.setActiveIndex(idx)}
                className="flex items-center gap-[10px] w-full px-[10px] py-[7px] rounded-[8px] cursor-pointer transition-colors duration-100 text-left border-none"
                style={{
                  backgroundColor: idx === slashController.activeIndex
                    ? 'var(--color-bg-hover)'
                    : 'transparent',
                }}
              >
                <span
                  className="w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0"
                  style={{ backgroundColor: cmd.bg }}
                >
                  <Zap size={14} strokeWidth={1.8} stroke={cmd.color} />
                </span>
                <div>
                  <div className="text-[12px] font-semibold text-text-primary">{cmd.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{cmd.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Agent bar: chip + icon buttons (matching chat.html reference) */}
        {showAgentSelector && (
          <div className="flex items-center justify-center gap-[3px] py-[4px]">
            <div
              className="flex items-center gap-[4px] px-[10px] py-[3px] rounded-full border text-[10px] font-semibold cursor-pointer transition-all duration-100"
              style={{
                borderColor: 'var(--color-accent-orange)',
                backgroundColor: 'var(--color-tint-verifying)',
                color: 'var(--color-text-primary)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
              Maestro
            </div>
            <div className="flex gap-[1px] ml-[2px]">
              {AGENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAgentType(t)}
                  title={AGENT_LABELS[t]}
                  className="w-6 h-6 rounded-[4px] border-none flex items-center justify-center cursor-pointer text-[9px] font-bold transition-all duration-100"
                  style={{
                    backgroundColor: agentType === t ? 'var(--color-bg-active)' : 'transparent',
                    color: agentType === t ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  }}
                  onMouseEnter={(e) => {
                    if (agentType !== t) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (agentType !== t) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  }}
                >
                  <span
                    className="w-[14px] h-[14px] rounded-[3px] flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ backgroundColor: AGENT_DOT_COLORS[t] }}
                  >
                    {AGENT_SHORT[t]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Composer */}
        <div
          ref={composerRef}
          className="border transition-[border-color,box-shadow]"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-bg-card)',
            borderRadius: '10px',
            transitionDuration: 'var(--duration-normal)',
          }}
          onFocusCapture={(e) => {
            const wrap = e.currentTarget as HTMLElement;
            wrap.style.borderColor = 'var(--color-accent-blue)';
            wrap.style.boxShadow = '0 0 0 3px rgba(74,144,217,0.08)';
          }}
          onBlurCapture={(e) => {
            if (!e.relatedTarget || !(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
              const wrap = e.currentTarget as HTMLElement;
              wrap.style.borderColor = 'var(--color-border)';
              wrap.style.boxShadow = 'none';
            }
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            {...compositionHandlers}
            disabled={isDisabled}
            placeholder={
              isAsyncDelegateSession
                ? 'Queue a follow-up for this async delegate...'
                : effectiveProcessId
                  ? 'Send a message...'
                  : 'Send a message, / for commands...'
            }
            rows={isMultiline ? 3 : 1}
            className={`w-full resize-none border-none leading-[1.5] bg-transparent outline-none disabled:opacity-40 disabled:cursor-not-allowed ${isMultiline ? 'min-h-[72px] max-h-[140px]' : 'min-h-[36px] max-h-[36px]'}`}
            style={{ color: 'var(--color-text-primary)', fontSize: '13px', padding: '8px 12px', fontFamily: 'inherit' }}
          />
          <div
            className="flex items-center gap-[4px] px-[5px] py-[3px]"
            style={{ borderTop: '1px solid var(--color-border-divider)' }}
          >
            {/* Add button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-[26px] h-[26px] rounded-[5px] border-none bg-transparent flex items-center justify-center cursor-pointer transition-all duration-100"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
            >
              <Plus size={13} strokeWidth={2} />
            </button>

            {/* Skills button */}
            <button
              type="button"
              onClick={() => {
                if (slashController.isOpen) {
                  slashController.setDismissed(true);
                } else {
                  setText('/');
                  textareaRef.current?.focus();
                }
              }}
              className="px-[7px] py-[2px] rounded-[4px] border-none bg-transparent text-[10px] font-medium cursor-pointer transition-all duration-100"
              style={{ color: 'var(--color-text-tertiary)', fontFamily: 'inherit' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
            >
              Skills
            </button>

            {/* Context usage indicator */}
            <ContextUsageIndicator processId={effectiveProcessId} />

            {isAsyncDelegateSession && (
              <div
                className="flex items-center gap-[5px] px-[10px] py-[3px] text-[11px] font-medium"
                style={{
                  border: 'var(--style-btn-secondary-border)',
                  backgroundColor: 'var(--style-btn-secondary-bg)',
                  borderRadius: 'var(--style-btn-secondary-radius)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span style={{ color: 'var(--color-text-tertiary)' }}>Delivery</span>
                <select
                  value={delegateDelivery}
                  onChange={(e) => setDelegateDelivery(e.target.value as DelegateMessageDelivery)}
                  className="border-none bg-transparent cursor-pointer outline-none appearance-none text-[11px] font-medium"
                  style={{ color: 'inherit' }}
                >
                  <option value="inject">Inject</option>
                  <option value="after_complete">After Complete</option>
                </select>
              </div>
            )}

            {/* Current model indicator (when process is active) */}
            {!showAgentSelector && (
              <div
                className="flex items-center gap-[5px] ml-auto px-[7px] py-[2px] text-[10px] font-medium"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <span
                  className="w-[6px] h-[6px] rounded-full shrink-0"
                  style={{ backgroundColor: AGENT_DOT_COLORS[currentModel] }}
                />
                {AGENT_LABELS[currentModel] ?? currentModel}
              </div>
            )}

            <div className="flex-1" />

            {/* Send button */}
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim() || isDisabled}
              className="shrink-0 w-[28px] h-[28px] rounded-[7px] flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed border-none cursor-pointer"
              style={{ backgroundColor: 'var(--color-accent-orange)', color: '#fff', transition: 'all 150ms cubic-bezier(0.34,1.56,0.64,1)' }}
              onMouseEnter={(e) => { if (!isDisabled) (e.currentTarget as HTMLElement).style.transform = 'scale(1.06)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
              aria-label="Send message"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

