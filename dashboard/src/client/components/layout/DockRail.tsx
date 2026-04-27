import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import Bot from 'lucide-react/dist/esm/icons/bot.js';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import UsersRound from 'lucide-react/dist/esm/icons/users-round.js';
import Presentation from 'lucide-react/dist/esm/icons/presentation.js';
import PanelLeft from 'lucide-react/dist/esm/icons/panel-left.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import { useBoardStore } from '@/client/store/board-store.js';
import { useAgentStore } from '@/client/store/agent-store.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { STATUS_COLORS, AGENT_DOT_COLORS } from '@/shared/constants.js';
import type { PhaseCard } from '@/shared/types.js';
import type { AgentProcess, AgentType } from '@/shared/agent-types.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// DockRail — 48px icon strip with floating panel (hover to reveal)
// ---------------------------------------------------------------------------

const EMPTY_PHASES: PhaseCard[] = [];

interface DockNavItem {
  labelKey: string;
  tooltipKey: string;
  path: string;
  icon: 'kanban' | 'artifacts' | 'chat' | 'workflow' | 'mcp' | 'specs' | 'teams' | 'requirement' | 'supervisor' | 'collab' | 'rooms';
  shortcut?: string;
}

const NAV_ITEMS: DockNavItem[] = [
  { labelKey: 'nav.kanban', tooltipKey: 'dock.kanban_tooltip', path: '/kanban', icon: 'kanban', shortcut: 'K' },
  { labelKey: 'nav.artifacts', tooltipKey: 'dock.artifacts_tooltip', path: '/artifacts', icon: 'artifacts', shortcut: 'A' },
  { labelKey: 'nav.chat', tooltipKey: 'dock.chat_tooltip', path: '/chat', icon: 'chat', shortcut: 'C' },
  { labelKey: 'nav.workflow', tooltipKey: 'dock.workflow_tooltip', path: '/workflow', icon: 'workflow', shortcut: 'W' },
  { labelKey: 'nav.mcp', tooltipKey: 'dock.mcp_tooltip', path: '/mcp', icon: 'mcp', shortcut: 'M' },
  { labelKey: 'nav.specs', tooltipKey: 'dock.specs_tooltip', path: '/specs', icon: 'specs', shortcut: 'S' },
  { labelKey: 'nav.teams', tooltipKey: 'dock.teams_tooltip', path: '/teams', icon: 'teams', shortcut: 'T' },
  { labelKey: 'nav.collab', tooltipKey: 'dock.collab_tooltip', path: '/collab', icon: 'collab', shortcut: 'L' },
  { labelKey: 'nav.requirement', tooltipKey: 'dock.requirement_tooltip', path: '/requirement', icon: 'requirement', shortcut: 'R' },
  { labelKey: 'nav.supervisor', tooltipKey: 'dock.supervisor_tooltip', path: '/supervisor', icon: 'supervisor', shortcut: 'V' },
  { labelKey: 'nav.rooms', tooltipKey: 'dock.rooms_tooltip', path: '/rooms', icon: 'rooms', shortcut: 'O' },
];

// ---------------------------------------------------------------------------
// DockRail — public component
// ---------------------------------------------------------------------------

export interface DockRailProps {
  isPinned: boolean;
  onTogglePin: () => void;
}

export function DockRail({ isPinned, onTogglePin }: DockRailProps) {
  const { t } = useI18n();
  const phases = useBoardStore((s) => s.board?.phases ?? EMPTY_PHASES);
  const processes = useAgentStore((s) => s.processes);
  const activeProcessId = useAgentStore((s) => s.activeProcessId);
  const selectedPhase = useBoardStore((s) => s.selectedPhase);
  const setSelectedPhase = useBoardStore((s) => s.setSelectedPhase);
  const issues = useIssueStore((s) => s.issues);
  const fetchIssues = useIssueStore((s) => s.fetchIssues);
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch issues for sidebar display
  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  // Issue summary counts
  const issueCounts = useMemo(() => {
    const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0, total: 0 };
    for (const issue of issues) {
      counts.total++;
      if (issue.status in counts) counts[issue.status as keyof typeof counts]++;
    }
    return counts;
  }, [issues]);

  const railRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const processList = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Object.values(processes).filter(
      (p) => new Date(p.startedAt).getTime() > cutoff,
    );
  }, [processes]);

  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const SESSION_COLLAPSE_LIMIT = 5;

  // Open panel on rail hover (if not pinned)
  const handleRailEnter = useCallback(() => {
    if (!isPinned) setIsPanelOpen(true);
  }, [isPinned]);

  // Close panel when leaving rail — unless mouse moved to panel
  const handleRailLeave = useCallback((e: React.MouseEvent) => {
    if (!isPinned && !(e.relatedTarget instanceof Node && panelRef.current?.contains(e.relatedTarget))) {
      setIsPanelOpen(false);
    }
  }, [isPinned]);

  // Close panel when leaving panel — unless mouse moved to rail
  const handlePanelLeave = useCallback((e: React.MouseEvent) => {
    if (!isPinned && !(e.relatedTarget instanceof Node && railRef.current?.contains(e.relatedTarget))) {
      setIsPanelOpen(false);
    }
  }, [isPinned]);

  // Nav button click: navigate only, close panel
  const handleNavClick = useCallback((path: string) => {
    navigate(path);
    setIsPanelOpen(false);
  }, [navigate]);

  return (
    <div className="relative flex">
      {/* Icon rail — always visible */}
      <nav
        ref={railRef}
        role="navigation"
        aria-label={t('nav.views')}
        className="w-[var(--size-rail-width)] bg-bg-secondary border-r border-border flex-shrink-0 flex flex-col items-center pt-2 gap-0.5 z-50"
        onMouseEnter={handleRailEnter}
        onMouseLeave={handleRailLeave}
      >
        {/* View buttons */}
        {NAV_ITEMS.map((item) => (
          <RailButton
            key={item.path}
            item={item}
            isActive={location.pathname.startsWith(item.path)}
            onActivate={() => handleNavClick(item.path)}
            t={t}
          />
        ))}

        {/* Separator */}
        <div className="w-6 h-px bg-border-divider my-1.5" aria-hidden="true" />

        {/* Session dots (agent processes) */}
        <div
          className="flex flex-col items-center gap-1.5 py-1"
          role="list"
          aria-label={t('dock.phases_label')}
        >
          {processList.length > 0
            ? processList.map((proc) => (
                <SessionDot
                  key={proc.id}
                  process={proc}
                  isActive={proc.id === activeProcessId}
                  onSelect={() => { useAgentStore.getState().setActiveProcessId(proc.id); navigate('/chat'); }}
                />
              ))
            : phases.map((phase) => (
                <PhaseDot key={phase.phase} phase={phase} t={t} />
              ))
          }
        </div>

        {/* Sidebar toggle — pushed to bottom */}
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={t('dock.toggle_sidebar')}
          className={[
            'mt-auto mb-2 flex items-center justify-center w-9 h-9 rounded-[6px]',
            'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
            isPinned
              ? 'text-text-primary bg-bg-active'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
          ].join(' ')}
        >
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      </nav>

      {/* Floating panel */}
      <aside
        ref={panelRef}
        aria-label={t('dock.views_label')}
        className={[
          'dock-floating-panel',
          'absolute left-[var(--size-rail-width)] top-0 bottom-0',
          'w-[calc(var(--size-panel-width)-var(--size-rail-width))]',
          'bg-bg-secondary border-r border-border overflow-y-auto z-40',
          'shadow-[4px_0_16px_rgba(0,0,0,0.06)]',
          'transition-[transform,opacity] duration-[200ms] ease-[var(--ease-spring)]',
          isPinned || isPanelOpen
            ? 'translate-x-0 opacity-100 pointer-events-auto'
            : '-translate-x-full opacity-0 pointer-events-none',
        ].join(' ')}
        onMouseLeave={handlePanelLeave}
      >
        {/* Views section */}
        <div className="px-2 py-2.5 border-b border-border-divider">
          <h2 className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[var(--letter-spacing-wide)] px-2 mb-1">
            {t('dock.views_label')}
          </h2>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <PanelNavItem key={item.path} item={item} t={t} />
            ))}
          </nav>
        </div>

        {/* Sessions section (if agents exist, filtered to <24h) */}
        {processList.length > 0 && (
          <div className="px-2 py-2.5 border-b border-border-divider">
            <div className="flex items-center justify-between px-2 mb-1">
              <h2 className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[var(--letter-spacing-wide)]">
                Sessions
                {processList.length > SESSION_COLLAPSE_LIMIT && (
                  <span className="ml-1 font-normal text-text-placeholder">{processList.length}</span>
                )}
              </h2>
              <button
                type="button"
                className="w-[18px] h-[18px] rounded flex items-center justify-center border-none bg-transparent cursor-pointer transition-all duration-100"
                style={{ color: 'var(--color-text-placeholder)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-placeholder)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                aria-label="New session"
              >
                <Plus size={12} strokeWidth={2} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {(sessionsExpanded ? processList : processList.slice(0, SESSION_COLLAPSE_LIMIT)).map((proc) => (
                <SessionItem
                  key={proc.id}
                  process={proc}
                  isActive={proc.id === activeProcessId}
                />
              ))}
            </nav>
            {processList.length > SESSION_COLLAPSE_LIMIT && (
              <button
                type="button"
                onClick={() => setSessionsExpanded((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 mt-0.5 w-full text-[10px] text-text-placeholder hover:text-text-secondary transition-colors"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`transition-transform duration-150 ${sessionsExpanded ? 'rotate-180' : ''}`}
                />
                <span>{sessionsExpanded ? 'Show less' : `${processList.length - SESSION_COLLAPSE_LIMIT} more…`}</span>
              </button>
            )}
          </div>
        )}

        {/* Issues section */}
        {issues.length > 0 && (
          <div className="px-2 py-2.5 border-b border-border-divider">
            <h2 className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[var(--letter-spacing-wide)] px-2 mb-1">
              Issues
            </h2>
            <button
              type="button"
              onClick={() => { navigate('/kanban'); setIsPanelOpen(false); }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-default)] text-left text-[length:var(--font-size-sm)] w-full hover:bg-bg-hover transition-colors"
            >
              <span className="flex-1 text-text-secondary">
                {issueCounts.total} issues
              </span>
              <span className="flex items-center gap-2 text-[10px]">
                {issueCounts.open > 0 && (
                  <span style={{ color: '#5B8DB8' }}>{issueCounts.open} open</span>
                )}
                {issueCounts.in_progress > 0 && (
                  <span style={{ color: '#B89540' }}>{issueCounts.in_progress} active</span>
                )}
                {issueCounts.resolved > 0 && (
                  <span style={{ color: '#5A9E78' }}>{issueCounts.resolved} done</span>
                )}
              </span>
            </button>
          </div>
        )}

        {/* Phases section */}
        <div className="px-2 py-2.5">
          <h2 className="text-[length:var(--font-size-xs)] font-[var(--font-weight-semibold)] text-text-tertiary uppercase tracking-[var(--letter-spacing-wide)] px-2 mb-1">
            {t('dock.phases_label')}
          </h2>
          <nav className="flex flex-col gap-0.5" aria-label="Project phases">
            {phases.map((phase) => (
              <PhaseItem
                key={phase.phase}
                phase={phase}
                selected={selectedPhase === phase.phase}
                onSelect={() => {
                  setSelectedPhase(selectedPhase === phase.phase ? null : phase.phase);
                  setIsPanelOpen(false);
                }}
              />
            ))}
            {phases.length === 0 && (
              <p className="text-[length:var(--font-size-xs)] text-text-secondary italic px-2">
                {t('sidebar.no_phases_loaded')}
              </p>
            )}
          </nav>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RailButton — icon button in the 48px rail (with tooltip)
// ---------------------------------------------------------------------------

function RailButton({
  item,
  isActive,
  onActivate,
  t,
}: {
  item: DockNavItem;
  isActive: boolean;
  onActivate: () => void;
  t: (key: string) => string;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={t(item.tooltipKey)}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'group relative flex items-center justify-center w-9 h-9 rounded-[8px]',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
        isActive
          ? 'bg-bg-active text-text-primary'
          : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary',
      ].join(' ')}
    >
      <NavIcon icon={item.icon} />
      {/* Tooltip */}
      <span className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 bg-text-primary text-[11px] font-medium text-white px-2 py-0.5 rounded-[6px] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-[200]">
        {t(item.tooltipKey)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// NavIcon — lucide-react icons
// ---------------------------------------------------------------------------

const NAV_ICON_MAP = {
  kanban: LayoutGrid,
  artifacts: FileText,
  chat: MessageSquare,
  workflow: Clock,
  mcp: Layers,
  specs: BookOpen,
  teams: Bot,
  requirement: ListChecks,
  supervisor: Activity,
  collab: UsersRound,
  rooms: Presentation,
} as const;

function NavIcon({ icon }: { icon: DockNavItem['icon'] }) {
  const Icon = NAV_ICON_MAP[icon];
  return <Icon size={18} strokeWidth={1.8} />;
}

// ---------------------------------------------------------------------------
// SessionDot — 8px colored dot with ping animation for active sessions
// ---------------------------------------------------------------------------

function SessionDot({
  process,
  isActive,
  onSelect,
}: {
  process: AgentProcess;
  isActive: boolean;
  onSelect: () => void;
}) {
  const color = AGENT_DOT_COLORS[process.type] ?? 'var(--color-text-tertiary)';
  const isRunning = process.status === 'running' || process.status === 'spawning';
  const asyncDelegate = process.id.startsWith('cli-history-');

  return (
    <span
      role="listitem"
      title={`${process.type}${asyncDelegate ? ' — async delegate' : ''} — ${process.status}`}
      onClick={onSelect}
      className={[
        'relative w-2 h-2 rounded-full cursor-pointer transition-transform duration-150 hover:scale-[1.4]',
        isActive ? 'ring-2 ring-offset-2 ring-offset-bg-secondary' : '',
      ].join(' ')}
      style={{
        backgroundColor: isRunning ? color : 'var(--color-text-placeholder)',
        color,
        ...(isActive ? { boxShadow: `0 0 0 2px var(--color-bg-secondary), 0 0 0 3.5px ${color}` } : {}),
      }}
    >
      {isRunning && (
        <span
          className="absolute inset-[-2px] rounded-full animate-[sdot-ping_2s_ease_infinite]"
          style={{ background: color, opacity: 0.4 }}
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PhaseDot — 8px colored dot in the rail (fallback when no sessions)
// ---------------------------------------------------------------------------

function PhaseDot({
  phase,
  t,
}: {
  phase: PhaseCard;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <span
      role="listitem"
      aria-label={t('dock.phase_dot_aria', {
        phase: phase.phase,
        title: phase.title,
        status: phase.status,
      })}
      className="w-[7px] h-[7px] rotate-45 rounded-[1px] cursor-pointer transition-transform duration-150 hover:scale-[1.4]"
      style={{ backgroundColor: STATUS_COLORS[phase.status] }}
    />
  );
}

// ---------------------------------------------------------------------------
// SessionItem — session row in the floating panel
// ---------------------------------------------------------------------------

function SessionItem({
  process,
  isActive,
}: {
  process: AgentProcess;
  isActive: boolean;
}) {
  const color = AGENT_DOT_COLORS[process.type] ?? 'var(--color-text-tertiary)';
  const setActive = useAgentStore((s) => s.setActiveProcessId);
  const removeProcess = useAgentStore((s) => s.removeProcess);
  const navigate = useNavigate();
  const elapsed = getElapsed(process.startedAt);
  const asyncDelegate = process.id.startsWith('cli-history-');

  return (
    <div
      className={[
        'group flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-left text-[12px] w-full',
        'transition-all duration-150 cursor-pointer',
        isActive
          ? 'bg-bg-active'
          : 'hover:bg-bg-hover',
      ].join(' ')}
      onClick={() => { setActive(process.id); navigate('/chat'); }}
    >
      <span
        className="w-[7px] h-[7px] rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 font-medium text-text-primary truncate">
        {process.type}
      </span>
      {asyncDelegate && (
        <span
          className="text-[9px] font-semibold px-[4px] py-[1px] rounded shrink-0"
          style={{
            backgroundColor: 'var(--color-tint-exploring)',
            color: 'var(--color-accent-blue)',
          }}
        >
          ASYNC
        </span>
      )}
      <span className="text-[10px] text-text-placeholder shrink-0">
        {elapsed}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); removeProcess(process.id); }}
        className="w-4 h-4 rounded flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-text-primary hover:bg-bg-active transition-all duration-100"
        aria-label="Close session"
      >
        <X size={10} strokeWidth={2} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PanelNavItem — text nav link in the floating panel
// ---------------------------------------------------------------------------

const BASE_PANEL_NAV = [
  'flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-default)]',
  'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] w-full',
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
].join(' ');

function PanelNavItem({
  item,
  t,
}: {
  item: DockNavItem;
  t: (key: string) => string;
}) {
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `${BASE_PANEL_NAV} ${
          isActive
            ? 'bg-bg-active text-text-primary font-semibold'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }`
      }
    >
      <span className="truncate">{t(item.labelKey)}</span>
      {item.shortcut && (
        <span className="ml-auto text-[10px] text-text-placeholder">{item.shortcut}</span>
      )}
    </NavLink>
  );
}

// ---------------------------------------------------------------------------
// PhaseItem — phase row in the floating panel
// ---------------------------------------------------------------------------

function PhaseItem({
  phase,
  selected,
  onSelect,
}: {
  phase: PhaseCard;
  selected: boolean;
  onSelect: () => void;
}) {
  const dotColor = STATUS_COLORS[phase.status];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={[
        'flex items-center gap-[var(--spacing-2)] px-[var(--spacing-2)] py-[var(--spacing-1-5)] rounded-[var(--radius-default)] text-left text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] w-full',
        'transition-all duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
        'disabled:opacity-[var(--opacity-disabled)] disabled:pointer-events-none',
        selected
          ? 'bg-bg-active text-text-primary border-l-2 border-l-accent-blue'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
      ].join(' ')}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        aria-hidden="true"
        style={{ backgroundColor: dotColor }}
      />
      <span className="truncate">
        {phase.phase}. {phase.title}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getElapsed(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}
