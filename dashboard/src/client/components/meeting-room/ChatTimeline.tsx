import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { EntryRenderer } from '@/client/pages/chat/entries/index.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';
import type { NormalizedEntry } from '@/shared/agent-types.js';
import type { RoomAgent, RoomMailboxMessage } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// ChatTimeline — Merged chronological timeline of room messages + agent entries
// ---------------------------------------------------------------------------

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

type TimelineItem =
  | { kind: 'entry'; entry: NormalizedEntry; role: string; ts: number }
  | { kind: 'message'; message: RoomMailboxMessage; ts: number };

export function ChatTimeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const agents = useMeetingRoomStore((s) => s.agents);
  const messages = useMeetingRoomStore((s) => s.messages);
  const allEntries = useAgentStore((s) => s.entries);

  // Build role -> processId mapping from room agents
  const roleProcessMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      if (agent.processId) {
        map.set(agent.processId, agent.role);
      }
    }
    return map;
  }, [agents]);

  // Merge mailbox messages + agent entries into one timeline
  const mergedItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // Add room mailbox messages
    for (const msg of messages) {
      items.push({ kind: 'message', message: msg, ts: new Date(msg.createdAt).getTime() });
    }

    // Add agent process entries
    for (const [processId, role] of roleProcessMap) {
      const entries = allEntries[processId];
      if (!entries) continue;
      for (const entry of entries) {
        items.push({ kind: 'entry', entry, role, ts: new Date(entry.timestamp).getTime() });
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
      className="flex-1 overflow-y-auto flex flex-col gap-0.5 p-3"
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
                    {!isBroadcast && (
                      <span className="text-[8px] text-text-placeholder">
                        {isUser ? `to @${msg.to}` : `to @${msg.to}`}
                      </span>
                    )}
                    {isBroadcast && (
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

          // Agent process entry
          const { entry, role } = item;
          const badgeColor = getRoleBadgeColor(role, agents);
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 whitespace-nowrap"
                  style={{
                    background: `${badgeColor}18`,
                    color: badgeColor,
                  }}
                >
                  {role}
                </span>
                <div className="flex-1 min-w-0">
                  <EntryRenderer entry={entry} />
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
