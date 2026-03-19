import { useState, useRef, useCallback } from 'react';
import { Paperclip, Image, Zap, Send } from 'lucide-react';
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
// ChatInput -- composer with toolbar buttons matching design-chat-v1a
// ---------------------------------------------------------------------------

const AGENT_TYPES: AgentType[] = ['claude-code', 'codex', 'gemini', 'qwen', 'opencode'];

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/maestro-plan', desc: 'Create detailed phase plan', color: 'var(--color-accent-purple)', bg: 'var(--color-tint-planning)' },
  { name: '/quality-review', desc: 'Tiered code review', color: 'var(--color-accent-green)', bg: 'var(--color-tint-completed)' },
  { name: '/maestro-execute', desc: 'Execute phase with parallelization', color: 'var(--color-accent-orange)', bg: 'var(--color-tint-verifying)' },
  { name: '/quality-debug', desc: 'Parallel hypothesis debugging', color: 'var(--color-accent-blue)', bg: 'var(--color-tint-exploring)' },
];

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { isMultiline } = useAutoExpandTextarea(text, composerRef);
  const storeProcessId = useAgentStore((s) => s.activeProcessId);
  const processes = useAgentStore((s) => s.processes);

  const effectiveProcessId = externalProcessId !== undefined ? externalProcessId : storeProcessId;
  const activeProcess = effectiveProcessId ? processes[effectiveProcessId] ?? null : null;

  // Use process.interactive flag if available, fallback to executor type heuristic
  const isNonInteractive =
    activeProcess != null
      ? activeProcess.interactive === false
      : executor != null && !INTERACTIVE_EXECUTOR_FALLBACK.has(executor);

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
      sendWsMessage({
        action: 'message',
        processId: effectiveProcessId,
        content: trimmed,
      });
    } else if (externalProcessId === undefined) {
      // Only spawn new agents when not in external processId mode
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
  }, [text, effectiveProcessId, activeProcess, agentType, externalProcessId, slashController]);

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

  const showAgentSelector = !effectiveProcessId && externalProcessId === undefined;
  const currentModel = activeProcess?.type ?? agentType;

  return (
    <div
      className="shrink-0 px-6 pb-[14px] pt-2"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
    >
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
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

        {/* Composer */}
        <div
          ref={composerRef}
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
            if (!e.relatedTarget || !(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
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
            {...compositionHandlers}
            disabled={isNonInteractive || (externalProcessId !== undefined && !effectiveProcessId)}
            placeholder={effectiveProcessId ? 'Send a message...' : 'Send a message, / for commands...'}
            rows={isMultiline ? 3 : 1}
            className={`w-full resize-none border-none px-[14px] py-[10px] text-[13px] leading-[1.5] bg-transparent outline-none disabled:opacity-40 disabled:cursor-not-allowed ${isMultiline ? 'min-h-[72px] max-h-[200px]' : 'min-h-[42px] max-h-[42px]'}`}
            style={{ color: 'var(--color-text-primary)' }}
          />
          <div
            className="flex items-center gap-[2px] px-[6px] py-1"
            style={{}}
          >
            {/* File button */}
            <ToolbarButton
              tooltip="File"
              icon={<Paperclip size={15} strokeWidth={1.8} />}
              onClick={() => fileInputRef.current?.click()}
            />
            {/* Image button */}
            <ToolbarButton
              tooltip="Image"
              icon={<Image size={15} strokeWidth={1.8} />}
              onClick={() => imageInputRef.current?.click()}
            />
            {/* Skills button */}
            <ToolbarButton
              tooltip="Skills"
              icon={<Zap size={15} strokeWidth={1.8} />}
              onClick={() => {
                if (slashController.isOpen) {
                  slashController.setDismissed(true);
                } else {
                  setText('/');
                  textareaRef.current?.focus();
                }
              }}
            />

            <div className="w-px h-[18px] mx-1" style={{ backgroundColor: 'var(--color-border-divider)' }} />

            {/* Context usage indicator */}
            <ContextUsageIndicator processId={effectiveProcessId} />

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
              disabled={!text.trim() || isNonInteractive || (externalProcessId !== undefined && !effectiveProcessId)}
              className="shrink-0 w-[34px] h-[30px] rounded-[8px] flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 ml-1 border-none cursor-pointer"
              style={{ backgroundColor: 'var(--color-accent-orange)', color: '#fff' }}
              aria-label="Send message"
            >
              <Send size={15} strokeWidth={2} />
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
