import { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { ROOM_LEADER_SYSTEM_PROMPT } from '@/shared/room-leader-prompt.js';
import { cn } from '@/client/lib/utils.js';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// AddAgentDialog — spawn an agent and add it to the active meeting room
// ---------------------------------------------------------------------------

interface AddAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AGENT_TYPES: { value: AgentType; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'opencode', label: 'OpenCode' },
];

const inputCls = cn(
  'w-full px-[var(--spacing-3)] py-[var(--spacing-2)]',
  'rounded-[var(--radius-default)] border border-border',
  'bg-bg-secondary text-text-primary',
  'text-[length:var(--font-size-sm)]',
  'focus:outline-none focus:shadow-[var(--shadow-focus-ring)]',
  'transition-shadow duration-[var(--duration-fast)]',
);

const labelCls = 'block text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-text-secondary mb-[var(--spacing-1)]';

export function AddAgentDialog({ open, onOpenChange }: AddAgentDialogProps) {
  const sessionId = useMeetingRoomStore((s) => s.sessionId);

  const [role, setRole] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('gemini');
  const [model, setModel] = useState('');
  const [isLeader, setIsLeader] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setRole('');
      setAgentType('gemini');
      setModel('');
      setIsLeader(false);
      setPrompt('');
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    if (!sessionId || !prompt.trim()) return;
    const effectiveRole = isLeader ? 'leader' : role.trim();
    if (!effectiveRole) return;

    setSubmitting(true);

    // Build the full prompt — prepend leader system prompt if leader
    const fullPrompt = isLeader
      ? `${ROOM_LEADER_SYSTEM_PROMPT}\n\n---\n\nUser Task:\n${prompt.trim()}`
      : prompt.trim();

    // Spawn the agent with room metadata for server-side auto-linking + MCP injection
    sendWsMessage({
      action: 'spawn',
      config: {
        type: agentType,
        prompt: fullPrompt,
        workDir: '.',
        model: model.trim() || undefined,
        interactive: agentType === 'claude-code' ? true : undefined,
        approvalMode: isLeader ? 'auto' : undefined,
        metadata: {
          roomSessionId: sessionId,
          roomRole: effectiveRole,
        },
      },
    } as never);

    onOpenChange(false);
  }, [sessionId, role, agentType, model, isLeader, prompt, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[520px] max-w-[95vw] max-h-[85vh]',
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
              Add Agent
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
          <div className="flex-1 overflow-y-auto p-[var(--spacing-6)] space-y-[var(--spacing-4)]">
            {/* Leader toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isLeader}
                onChange={(e) => setIsLeader(e.target.checked)}
                className="w-4 h-4 rounded border-border accent-accent-blue"
              />
              <span className="text-[length:var(--font-size-sm)] font-medium text-text-primary">
                Leader Agent
              </span>
              <span className="text-[10px] text-text-placeholder">
                (coordinates the team via MCP tools)
              </span>
            </label>

            {/* Role + Type row */}
            <div className="flex gap-[var(--spacing-4)]">
              <div className="flex-1">
                <label htmlFor="agent-role" className={labelCls}>Role</label>
                {isLeader ? (
                  <input
                    id="agent-role"
                    type="text"
                    value="leader"
                    disabled
                    className={cn(inputCls, 'opacity-50 cursor-not-allowed')}
                  />
                ) : (
                  <input
                    id="agent-role"
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. researcher, coder"
                    className={inputCls}
                    autoFocus
                  />
                )}
              </div>
              <div className="flex-1">
                <label htmlFor="agent-type" className={labelCls}>Agent Type</label>
                <select
                  id="agent-type"
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value as AgentType)}
                  className={inputCls}
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Model (optional) */}
            <div>
              <label htmlFor="agent-model" className={labelCls}>
                Model <span className="text-text-placeholder">(optional)</span>
              </label>
              <input
                id="agent-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default model for selected type"
                className={inputCls}
              />
            </div>

            {/* Prompt */}
            <div>
              <label htmlFor="agent-prompt" className={labelCls}>
                {isLeader ? 'Task for the team' : 'Initial Prompt'}
              </label>
              <textarea
                id="agent-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={isLeader ? 'Describe the goal for the team to accomplish...' : 'What should this agent do?'}
                rows={5}
                className={cn(inputCls, 'resize-y min-h-[100px]')}
              />
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
              disabled={submitting || !prompt.trim() || (!isLeader && !role.trim())}
              className={cn(
                'px-4 py-1.5 rounded-[var(--radius-default)]',
                'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
                'bg-accent-blue text-white',
                'hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed',
                'transition-opacity',
              )}
            >
              {submitting ? 'Spawning...' : 'Add Agent'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
