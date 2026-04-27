import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';
import type { NormalizedEntry } from '@/shared/agent-types.js';
import type { RoomAgent, RoomMailboxMessage } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// ChatTimeline — Conversation view: mailbox messages + agent final replies
//   Left panel shows only the "conversation" layer:
//     - Room mailbox messages (user ↔ agent direct/broadcast)
//     - Agent assistant_message entries (final LLM output)
//   All other entry types (stderr, status, token_usage, tool_use, etc.)
//   are shown only in the right-side TerminalPanelGrid.
// ---------------------------------------------------------------------------

/** Entry types shown in the chat conversation view */
const CHAT_ENTRY_TYPES = new Set(['user_message', 'assistant_message']);

/** Role badge color lookup */
function getRoleBadgeColor(role: string, agents: RoomAgent[]): string {
  const agent = agents.find((a) => a.role === role);
  if (!agent) return AGENT_STATUS_COLORS.idle;
  return AGENT_STATUS_COLORS[agent.status] ?? AGENT_STATUS_COLORS.idle;
}

/** Render @mentions as highlighted spans */
function renderContentWithMentions(content: string, agents: RoomAgent[]): React.ReactNode {
  const roles = agents.map((a) => a.role);
  if (roles.length === 0) return content;

  const pattern = new RegExp(`(@(?:${roles.join('|')}))\\b`, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const mentionedRole = match[1].slice(1); // remove @
    const color = getRoleBadgeColor(mentionedRole, agents);
    parts.push(
      <span
        key={match.index}
        className="font-semibold px-0.5 rounded"
        style={{ color, backgroundColor: `${color}18` }}
      >
        {match[1]}
      </span>,
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  return parts.length > 0 ? parts : content;
}

/** Extract text content from an assistant_message entry */
function getEntryContent(entry: NormalizedEntry): string {
  if (entry.type === 'assistant_message' || entry.type === 'user_message') {
    return (entry as { content: string }).content ?? '';
  }
  return '';
}

type TimelineItem =
  | { kind: 'reply'; entry: NormalizedEntry; role: string; processId: string; ts: number }
  | { kind: 'message'; message: RoomMailboxMessage; ts: number };

export function ChatTimeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const agents = useMeetingRoomStore((s) => s.agents);
  const messages = useMeetingRoomStore((s) => s.messages);
  const allEntries = useAgentStore((s) => s.entries);

  // Build processId -> role mapping from room agents
  const roleProcessMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      if (agent.processId) {
        map.set(agent.processId, agent.role);
      }
    }
    return map;
  }, [agents]);

  // Merge mailbox messages + agent assistant_message entries into conversation view
  const mergedItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // Mailbox messages
    for (const msg of messages) {
      items.push({ kind: 'message', message: msg, ts: new Date(msg.createdAt).getTime() });
    }

    // Only assistant_message entries from agent processes
    for (const [processId, role] of roleProcessMap) {
      const entries = allEntries[processId];
      if (!entries) continue;
      for (const entry of entries) {
        if (!CHAT_ENTRY_TYPES.has(entry.type)) continue;
        items.push({ kind: 'reply', entry, role, processId, ts: new Date(entry.timestamp).getTime() });
      }
    }

    items.sort((a, b) => a.ts - b.ts);
    return items;
  }, [messages, allEntries, roleProcessMap]);

  // Auto-scroll to bottom on new items
  const prevCount = useRef(0);
  useEffect(() => {
    if (mergedItems.length > prevCount.current) {
      const el = timelineRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevCount.current = mergedItems.length;
  }, [mergedItems.length]);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)] italic">
        No agents connected...
      </div>
    );
  }

  if (mergedItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)] italic">
        Waiting for activity...
      </div>
    );
  }

  return (
    <div
      ref={timelineRef}
      className="flex-1 overflow-y-auto flex flex-col gap-1 p-3"
    >
      <AnimatePresence initial={false}>
        {mergedItems.map((item) => {
          if (item.kind === 'message') {
            const msg = item.message;
            const isBroadcast = msg.to === '*' || msg.to === 'all';
            const fromColor = getRoleBadgeColor(msg.from, agents);
            const isUser = msg.from === 'user';
            return (
              <motion.div
                key={`msg-${msg.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="mt-1"
              >
                <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                  {/* From badge */}
                  <span
                    className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 whitespace-nowrap"
                    style={{
                      background: isUser ? 'var(--color-accent-muted)' : `${fromColor}18`,
                      color: isUser ? 'var(--color-text-on-accent, #fff)' : fromColor,
                    }}
                  >
                    {msg.from}
                  </span>
                  {/* Message bubble */}
                  <div
                    className={`flex flex-col gap-0.5 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    {/* Routing indicator */}
                    {!isBroadcast ? (
                      <span className="text-[8px] text-text-placeholder">
                        to @{msg.to}
                      </span>
                    ) : (
                      <span className="text-[8px] text-text-placeholder">
                        broadcast
                      </span>
                    )}
                    <div
                      className={[
                        'text-[12px] px-2.5 py-1.5 rounded-lg leading-relaxed',
                        isUser
                          ? 'bg-accent-muted/15 text-text-primary'
                          : 'bg-bg-secondary text-text-primary',
                      ].join(' ')}
                    >
                      {renderContentWithMentions(msg.content, agents)}
                    </div>
                    <span className="text-[8px] text-text-placeholder">
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          }

          // Agent entry (user_message or assistant_message)
          const { entry, role, processId } = item;
          const badgeColor = getRoleBadgeColor(role, agents);
          const content = getEntryContent(entry);
          const isUserEntry = entry.type === 'user_message';
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="mt-1"
            >
              <div className={`flex items-start gap-2 ${isUserEntry ? 'flex-row-reverse' : ''}`}>
                <span
                  className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 whitespace-nowrap"
                  style={{
                    background: isUserEntry ? 'var(--color-accent-muted)' : `${badgeColor}18`,
                    color: isUserEntry ? 'var(--color-text-on-accent, #fff)' : badgeColor,
                  }}
                >
                  {isUserEntry ? 'You' : role}
                </span>
                <div className={`flex flex-col gap-0.5 max-w-[75%] ${isUserEntry ? 'items-end' : 'items-start'}`}>
                  {!isUserEntry && (
                    <span className="text-[8px] text-text-placeholder font-mono">
                      {processId.slice(0, 8)}
                    </span>
                  )}
                  <div className={[
                    'text-[12px] px-2.5 py-1.5 rounded-lg leading-relaxed whitespace-pre-wrap',
                    isUserEntry
                      ? 'bg-accent-muted/15 text-text-primary'
                      : 'bg-bg-secondary text-text-primary',
                  ].join(' ')}>
                    {content}
                  </div>
                  <span className="text-[8px] text-text-placeholder">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
