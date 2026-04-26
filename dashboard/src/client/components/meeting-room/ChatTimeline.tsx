import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { EntryRenderer } from '@/client/pages/chat/entries/index.js';
import type { NormalizedEntry } from '@/shared/agent-types.js';
import type { RoomAgent } from '@/shared/team-types.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// ChatTimeline — Merged chronological timeline of all agent entries
// ---------------------------------------------------------------------------

/** Role badge color lookup — reuses agent status colors */
function getRoleBadgeColor(role: string, agents: RoomAgent[]): string {
  const agent = agents.find((a) => a.role === role);
  if (!agent) return AGENT_STATUS_COLORS.idle;
  return AGENT_STATUS_COLORS[agent.status] ?? AGENT_STATUS_COLORS.idle;
}

interface TimelineEntry {
  entry: NormalizedEntry;
  role: string;
}

export function ChatTimeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const agents = useMeetingRoomStore((s) => s.agents);
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

  // Merge entries from all agent processes, tagged with role
  const mergedEntries = useMemo(() => {
    const result: TimelineEntry[] = [];
    for (const [processId, role] of roleProcessMap) {
      const entries = allEntries[processId];
      if (!entries) continue;
      for (const entry of entries) {
        result.push({ entry, role });
      }
    }
    // Sort chronologically by timestamp
    result.sort((a, b) => {
      const ta = new Date(a.entry.timestamp).getTime();
      const tb = new Date(b.entry.timestamp).getTime();
      return ta - tb;
    });
    return result;
  }, [allEntries, roleProcessMap]);

  // Auto-scroll to bottom on new entries
  const prevCount = useRef(0);
  useEffect(() => {
    if (mergedEntries.length > prevCount.current) {
      const el = timelineRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevCount.current = mergedEntries.length;
  }, [mergedEntries.length]);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)] italic">
        No agents connected...
      </div>
    );
  }

  if (mergedEntries.length === 0) {
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
        {mergedEntries.map(({ entry, role }) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="flex items-start gap-2">
              {/* Role badge prefix */}
              <span
                className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5 whitespace-nowrap"
                style={{
                  background: `${getRoleBadgeColor(role, agents)}18`,
                  color: getRoleBadgeColor(role, agents),
                }}
              >
                {role}
              </span>
              {/* Entry content */}
              <div className="flex-1 min-w-0">
                <EntryRenderer entry={entry} />
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
