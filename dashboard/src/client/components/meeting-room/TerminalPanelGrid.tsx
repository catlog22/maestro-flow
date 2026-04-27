import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js';
import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.js';
import Columns from 'lucide-react/dist/esm/icons/columns.js';
import Rows from 'lucide-react/dist/esm/icons/rows.js';
import Grid from 'lucide-react/dist/esm/icons/grid.js';
import Square from 'lucide-react/dist/esm/icons/square.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useMeetingRoomStore } from '@/client/store/meeting-room-store.js';
import { EntryRenderer } from '@/client/pages/chat/entries/index.js';
import { AGENT_STATUS_COLORS } from '@/shared/team-types.js';
import type { TerminalLayoutMode } from '@/client/store/meeting-room-store.js';
import type { NormalizedEntry } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// TerminalPanelGrid — CSS grid with 4 layout modes
// ---------------------------------------------------------------------------

const LAYOUT_OPTIONS: { mode: TerminalLayoutMode; icon: typeof Square; label: string }[] = [
  { mode: 'single', icon: Square, label: 'Single' },
  { mode: 'split-h', icon: Columns, label: 'Split Horizontal' },
  { mode: 'split-v', icon: Rows, label: 'Split Vertical' },
  { mode: 'grid-2x2', icon: Grid, label: 'Grid 2x2' },
];

function getGridStyle(mode: TerminalLayoutMode, paneCount: number): React.CSSProperties {
  // Clamp the effective pane count to what the layout can show
  const effective = Math.min(paneCount, mode === 'single' ? 1 : mode === 'grid-2x2' ? 4 : 2);

  switch (mode) {
    case 'single':
      return { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    case 'split-h':
      return {
        display: 'grid',
        gridTemplateColumns: effective > 1 ? '1fr 1fr' : '1fr',
        gridTemplateRows: '1fr',
      };
    case 'split-v':
      return {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gridTemplateRows: effective > 1 ? '1fr 1fr' : '1fr',
      };
    case 'grid-2x2':
      return {
        display: 'grid',
        gridTemplateColumns: effective > 1 ? '1fr 1fr' : '1fr',
        gridTemplateRows: effective > 2 ? '1fr 1fr' : '1fr',
      };
    default:
      return { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
  }
}

const EMPTY_ENTRIES: NormalizedEntry[] = [];

/** Single agent terminal pane */
function TerminalPane({ role, processId }: { role: string; processId?: string }) {
  const entries = useAgentStore((s) => (processId ? s.entries[processId] ?? EMPTY_ENTRIES : EMPTY_ENTRIES));
  const isStreaming = useAgentStore((s) => (processId ? s.processStreaming[processId] ?? false : false));
  const agents = useMeetingRoomStore((s) => s.agents);
  const expandedTerminals = useMeetingRoomStore((s) => s.expandedTerminals);
  const expandTerminal = useMeetingRoomStore((s) => s.expandTerminal);
  const collapseTerminal = useMeetingRoomStore((s) => s.collapseTerminal);
  const scrollRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.role === role);
  const statusColor = AGENT_STATUS_COLORS[agent?.status ?? 'offline'];
  const isExpanded = expandedTerminals.includes(role);

  // Auto-scroll to bottom on new entries or streaming updates
  const prevLen = useRef(0);
  useEffect(() => {
    if (entries.length > prevLen.current || isStreaming) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevLen.current = entries.length;
  }, [entries.length, entries, isStreaming]);

  return (
    <div
      className="flex flex-col h-full rounded-lg border border-border-divider bg-bg-primary overflow-hidden"
      style={isExpanded ? { gridColumn: '1 / -1', gridRow: '1 / -1' } : undefined}
    >
      {/* Pane header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-divider bg-bg-secondary shrink-0">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-[11px] font-semibold text-text-primary">{role}</span>
        <span className="text-[9px] text-text-tertiary">
          {agent?.status ?? 'offline'}
        </span>
        <div className="flex-1" />
        {isStreaming && (
          <span className="text-[9px] text-accent-muted animate-pulse">streaming</span>
        )}
        <button
          type="button"
          onClick={() => isExpanded ? collapseTerminal(role) : expandTerminal(role)}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
      </div>

      {/* Entries */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5 min-h-0">
        {!processId && (
          <div className="flex items-center justify-center h-full text-text-tertiary text-[10px] italic">
            Connecting...
          </div>
        )}
        {processId && entries.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-tertiary text-[10px] italic">
            Waiting for output...
          </div>
        )}
        {entries.map((entry: NormalizedEntry) => (
          <div key={entry.id} className="text-[11px]">
            <EntryRenderer entry={entry} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TerminalPanelGrid() {
  const agents = useMeetingRoomStore((s) => s.agents);
  const terminalLayoutMode = useMeetingRoomStore((s) => s.terminalLayoutMode);
  const setTerminalLayoutMode = useMeetingRoomStore((s) => s.setTerminalLayoutMode);
  const expandedTerminals = useMeetingRoomStore((s) => s.expandedTerminals);

  // Determine which agents to show based on layout mode
  const visibleAgents = useMemo(() => {
    // If an agent is expanded, only show that one
    if (expandedTerminals.length > 0) {
      return agents.filter((a) => expandedTerminals.includes(a.role));
    }
    const maxPanes = terminalLayoutMode === 'single' ? 1
      : terminalLayoutMode === 'grid-2x2' ? 4
      : 2;
    return agents.slice(0, maxPanes);
  }, [agents, terminalLayoutMode, expandedTerminals]);

  const gridStyle = getGridStyle(terminalLayoutMode, visibleAgents.length);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)] italic">
        No agents in room
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Layout mode toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-divider bg-bg-secondary shrink-0">
        <span className="text-[10px] text-text-tertiary mr-1">Layout:</span>
        {LAYOUT_OPTIONS.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => setTerminalLayoutMode(mode)}
            className={[
              'w-6 h-6 flex items-center justify-center rounded transition-colors',
              terminalLayoutMode === mode
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover',
            ].join(' ')}
            title={label}
          >
            <Icon size={12} />
          </button>
        ))}
        <span className="text-[9px] text-text-placeholder ml-auto">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 p-2 gap-2" style={gridStyle}>
        <AnimatePresence mode="popLayout">
          {visibleAgents.map((agent) => (
            <motion.div
              key={agent.role}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="min-h-0 overflow-hidden h-full"
            >
              <TerminalPane role={agent.role} processId={agent.processId} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
