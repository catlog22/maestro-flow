import { AnimatePresence, motion } from 'framer-motion';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { sendWsMessage } from '@/client/hooks/useWebSocket.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';
import type { RoomAgentStatus } from '@/shared/team-types.js';

// ---------------------------------------------------------------------------
// AgentStatusBar — Bottom bar showing agent status badges
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<RoomAgentStatus, string> = {
  idle: 'Idle',
  active: 'Active',
  busy: 'Busy',
  error: 'Error',
  offline: 'Offline',
};

function StatusBadge({ role, status, onRemove }: { role: string; status: RoomAgentStatus; onRemove?: () => void }) {
  const color = AGENT_STATUS_COLORS[status];

  return (
    <div className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-secondary">
      {/* Status dot */}
      <div
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      {/* Role name */}
      <span className="text-[10px] font-semibold text-text-primary">{role}</span>
      {/* Status label */}
      <AnimatePresence mode="wait">
        <motion.span
          key={status}
          className="text-[8px] font-semibold px-1 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: `${color}18`, color }}
          initial={{ opacity: 0, y: 4, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.9 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {STATUS_LABELS[status]}
        </motion.span>
      </AnimatePresence>
      {/* Remove button — shown on hover */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="hidden group-hover:flex w-3.5 h-3.5 items-center justify-center rounded-full text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
          title={`Remove ${role}`}
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
}

export function AgentStatusBar() {
  const agents = useMeetingRoomStore((s) => s.agents);
  const sessionId = useMeetingRoomStore((s) => s.sessionId);
  const sessionStatus = useMeetingRoomStore((s) => s.sessionStatus);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border-divider bg-bg-secondary shrink-0">
      {/* Session status indicator */}
      <div className="flex items-center gap-1.5 mr-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor:
              sessionStatus === 'active' ? '#5A9E78'
              : sessionStatus === 'paused' ? '#B89540'
              : '#C46555',
          }}
        />
        <span className="text-[9px] text-text-tertiary font-medium uppercase tracking-wider">
          {sessionStatus ?? 'unknown'}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-border-divider" />

      {/* Agent badges */}
      <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
        <AnimatePresence>
          {agents.map((agent) => (
            <motion.div
              key={agent.role}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              <StatusBadge
                role={agent.role}
                status={agent.status}
                onRemove={sessionId ? () => {
                  sendWsMessage({ action: 'room:remove_agent', sessionId, role: agent.role });
                  if (agent.processId) {
                    sendWsMessage({ action: 'stop', processId: agent.processId });
                  }
                } : undefined}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {agents.length === 0 && (
          <span className="text-[10px] text-text-placeholder italic">
            No agents connected
          </span>
        )}
      </div>

      {/* Agent count */}
      <span className="text-[9px] text-text-tertiary shrink-0">
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
