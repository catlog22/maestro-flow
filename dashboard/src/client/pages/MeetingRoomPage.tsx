import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Terminal from 'lucide-react/dist/esm/icons/terminal.js';
import Columns from 'lucide-react/dist/esm/icons/columns.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Radio from 'lucide-react/dist/esm/icons/radio.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import AtSign from 'lucide-react/dist/esm/icons/at-sign.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { useBoardStore } from '@/client/store/board-store.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';
import { ChatTimeline } from '@/client/components/meeting-room/ChatTimeline.js';
import { TerminalPanelGrid } from '@/client/components/meeting-room/TerminalPanelGrid.js';
import { AgentStatusBar } from '@/client/components/meeting-room/AgentStatusBar.js';
import { ResizableChatTerminalSplit } from '@/client/components/meeting-room/ResizableChatTerminalSplit.js';
import { AddAgentDialog } from '@/client/components/rooms/AddAgentDialog.js';
import type { LayoutMode } from '@/client/store/meeting-room-store.js';

// ---------------------------------------------------------------------------
// MeetingRoomPage — /meeting-room/:sessionId
// ---------------------------------------------------------------------------

const LAYOUT_TABS: { mode: LayoutMode; icon: typeof MessageSquare; label: string }[] = [
  { mode: 'chat', icon: MessageSquare, label: 'Chat' },
  { mode: 'terminal', icon: Terminal, label: 'Terminal' },
  { mode: 'split', icon: Columns, label: 'Split' },
];

export function MeetingRoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setSessionId = useMeetingRoomStore((s) => s.setSessionId);
  const layoutMode = useMeetingRoomStore((s) => s.layoutMode);
  const setLayoutMode = useMeetingRoomStore((s) => s.setLayoutMode);
  const inputTarget = useMeetingRoomStore((s) => s.inputTarget);
  const setInputTarget = useMeetingRoomStore((s) => s.setInputTarget);
  const sendMessage = useMeetingRoomStore((s) => s.sendMessage);
  const agents = useMeetingRoomStore((s) => s.agents);
  const sessionStatus = useMeetingRoomStore((s) => s.sessionStatus);
  const reset = useMeetingRoomStore((s) => s.reset);
  const connected = useBoardStore((s) => s.connected);

  // Filtered agents for @mention popup
  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionFilter.toLowerCase();
    return agents.filter((a) => a.role.toLowerCase().startsWith(q));
  }, [agents, mentionOpen, mentionFilter]);

  // Set sessionId immediately (doesn't need WS)
  useEffect(() => {
    if (sessionId) setSessionId(sessionId);
    return () => { reset(); };
  }, [sessionId, setSessionId, reset]);

  // Subscribe + snapshot only after WS is connected
  useEffect(() => {
    if (!sessionId || !connected) return;

    setRoomNotFound(false);
    sendWsMessage({ action: 'room:subscribe', sessionId });
    sendWsMessage({ action: 'room:snapshot', sessionId });

    // If sessionStatus is still null after 2s, room likely doesn't exist
    const timer = setTimeout(() => {
      const status = useMeetingRoomStore.getState().sessionStatus;
      if (!status) setRoomNotFound(true);
    }, 2000);

    return () => {
      clearTimeout(timer);
      sendWsMessage({ action: 'room:unsubscribe', sessionId });
    };
  }, [sessionId, connected]);

  // Insert @mention into input
  const insertMention = useCallback((role: string) => {
    // Find the last @ in input and replace from there
    const lastAt = input.lastIndexOf('@');
    if (lastAt >= 0) {
      setInput(input.slice(0, lastAt) + `@${role} `);
    } else {
      setInput(input + `@${role} `);
    }
    setMentionOpen(false);
    setMentionFilter('');
    setMentionIndex(0);
    textareaRef.current?.focus();
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setInput('');
    setMentionOpen(false);
  }, [input, sendMessage]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Detect @mention trigger
    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = val.slice(lastAt + 1);
      // Only trigger if @ is at start or preceded by whitespace, and no space in the partial
      const beforeAt = lastAt === 0 ? '' : val[lastAt - 1];
      if ((lastAt === 0 || beforeAt === ' ' || beforeAt === '\n') && !/\s/.test(afterAt)) {
        setMentionOpen(true);
        setMentionFilter(afterAt);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
    setMentionFilter('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention popup navigation
      if (mentionOpen && mentionCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          insertMention(mentionCandidates[mentionIndex].role);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionOpen(false);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionOpen, mentionCandidates, mentionIndex, insertMention],
  );

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
        No session ID provided
      </div>
    );
  }

  if (roomNotFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <span className="text-text-tertiary text-[length:var(--font-size-sm)]">
          Room &quot;{sessionId}&quot; not found
        </span>
        <button
          type="button"
          onClick={() => navigate('/rooms')}
          className="px-3 py-1.5 text-[length:var(--font-size-sm)] bg-bg-accent text-text-on-accent rounded hover:opacity-90 transition-opacity"
        >
          Back to Rooms
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-divider bg-bg-secondary shrink-0">
        <button
          type="button"
          onClick={() => navigate('/rooms')}
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Back to rooms"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[length:var(--font-size-sm)] font-semibold text-text-primary">
          Meeting Room
        </span>
        <span className="text-[11px] text-text-tertiary font-mono">
          {sessionId}
        </span>
        <div className="flex-1" />

        {/* Add Agent */}
        <button
          type="button"
          onClick={() => setAddAgentOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Add agent to room"
        >
          <UserPlus size={12} />
          <span>Add Agent</span>
        </button>

        {/* Layout mode tabs */}
        <div className="flex items-center gap-0.5 bg-bg-primary rounded-lg p-0.5">
          {LAYOUT_TABS.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayoutMode(mode)}
              className={[
                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors',
                layoutMode === mode
                  ? 'bg-bg-hover text-text-primary font-medium'
                  : 'text-text-tertiary hover:text-text-primary',
              ].join(' ')}
              title={label}
            >
              <Icon size={12} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {layoutMode === 'chat' && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ChatTimeline />
          </div>
        )}
        {layoutMode === 'terminal' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <TerminalPanelGrid />
          </div>
        )}
        {layoutMode === 'split' && (
          <ResizableChatTerminalSplit
            chatPanel={<ChatTimeline />}
            terminalPanel={<TerminalPanelGrid />}
          />
        )}
      </div>

      {/* Input bar */}
      <div className="flex items-end gap-2 px-4 py-2 border-t border-border-divider bg-bg-secondary shrink-0">
        {/* Input target selector */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setInputTarget({ mode: 'broadcast' })}
            className={[
              'flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] transition-colors',
              inputTarget.mode === 'broadcast'
                ? 'bg-bg-hover text-text-primary font-medium'
                : 'text-text-tertiary hover:text-text-primary',
            ].join(' ')}
            title="Broadcast to all agents"
          >
            <Radio size={11} />
            <span>All</span>
          </button>
          {agents.map((agent) => (
            <button
              key={agent.role}
              type="button"
              onClick={() => setInputTarget({ mode: 'direct', role: agent.role })}
              className={[
                'flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] transition-colors',
                inputTarget.mode === 'direct' && inputTarget.role === agent.role
                  ? 'bg-bg-hover text-text-primary font-medium'
                  : 'text-text-tertiary hover:text-text-primary',
              ].join(' ')}
              title={`Send to ${agent.role}`}
            >
              <User size={11} />
              <span>{agent.role}</span>
            </button>
          ))}
        </div>

        {/* Input with @mention popup */}
        <div className="flex-1 relative">
          {/* @mention popup */}
          {mentionOpen && mentionCandidates.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-48 bg-bg-primary border border-border-divider rounded-lg shadow-lg overflow-hidden z-50">
              <div className="px-2 py-1 text-[9px] text-text-placeholder border-b border-border-divider">
                <AtSign size={9} className="inline mr-1" />
                Mention agent
              </div>
              {mentionCandidates.map((agent, i) => {
                const color = AGENT_STATUS_COLORS[agent.status] ?? AGENT_STATUS_COLORS.idle;
                return (
                  <button
                    key={agent.role}
                    type="button"
                    onClick={() => insertMention(agent.role)}
                    className={[
                      'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors',
                      i === mentionIndex
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover',
                    ].join(' ')}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-medium">{agent.role}</span>
                    <span className="text-[9px] text-text-placeholder ml-auto">{agent.status}</span>
                  </button>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              inputTarget.mode === 'broadcast'
                ? 'Broadcast to all agents... (type @ to mention)'
                : `Message ${inputTarget.role}...`
            }
            rows={1}
            className="w-full resize-none rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-[12px] text-text-primary placeholder:text-text-placeholder focus:outline-none focus:border-accent-muted transition-colors"
          />
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim()}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
          title="Send"
        >
          <Send size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Agent status bar */}
      <AgentStatusBar />

      <AddAgentDialog open={addAgentOpen} onOpenChange={setAddAgentOpen} />
    </div>
  );
}
