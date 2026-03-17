import { useCallback, useEffect, useRef, useMemo } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { COLLAPSED_COLUMNS, STATUS_COLORS } from '@/shared/constants.js';
import type { PhaseCard as PhaseCardType, PhaseStatus, SelectedKanbanItem } from '@/shared/types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import { KanbanColumn } from '@/client/components/kanban/KanbanColumn.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// KanbanBoard — groups phases into 4 collapsed columns with keyboard nav
// ---------------------------------------------------------------------------

/** Column header colors — use the first status color in each group */
const COLUMN_COLORS: Record<string, string> = {
  backlog: STATUS_COLORS.pending,
  'in-progress': STATUS_COLORS.executing,
  review: STATUS_COLORS.verifying,
  done: STATUS_COLORS.completed,
};

/** Translation keys for column labels */
const COLUMN_LABEL_KEYS: Record<string, string> = {
  backlog: 'columns.backlog',
  'in-progress': 'columns.in_progress',
  review: 'columns.review',
  done: 'columns.done',
};

/** Group phases into columns based on COLLAPSED_COLUMNS mapping */
function groupPhases(phases: PhaseCardType[]): Map<string, PhaseCardType[]> {
  const groups = new Map<string, PhaseCardType[]>();
  for (const col of COLLAPSED_COLUMNS) {
    groups.set(col.id, []);
  }
  for (const phase of phases) {
    const col = COLLAPSED_COLUMNS.find((c) =>
      (c.statuses as readonly PhaseStatus[]).includes(phase.status),
    );
    if (col) {
      groups.get(col.id)!.push(phase);
    }
  }
  return groups;
}

/** Map Linear state.type → kanban column ID */
const LINEAR_STATE_TO_COLUMN: Record<string, string> = {
  backlog: 'backlog',
  unstarted: 'backlog',
  started: 'in-progress',
  completed: 'done',
};

function groupLinearIssues(issues: LinearIssue[]): Map<string, LinearIssue[]> {
  const groups = new Map<string, LinearIssue[]>();
  for (const col of COLLAPSED_COLUMNS) {
    groups.set(col.id, []);
  }
  for (const issue of issues) {
    const colId = LINEAR_STATE_TO_COLUMN[issue.state.type] ?? 'backlog';
    groups.get(colId)?.push(issue);
  }
  return groups;
}

interface KanbanBoardProps {
  onSelectPhase: (id: number) => void;
  linearIssues?: LinearIssue[];
  selectedItem?: SelectedKanbanItem | null;
  onSelectItem?: (item: SelectedKanbanItem) => void;
}

export function KanbanBoard({ onSelectPhase, linearIssues, selectedItem, onSelectItem }: KanbanBoardProps) {
  const { t } = useI18n();
  const board = useBoardStore((s) => s.board);
  const setSelectedPhase = useBoardStore((s) => s.setSelectedPhase);
  const boardRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation: arrow keys between focusable cards, Escape to deselect
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const container = boardRef.current;
      if (!container) return;

      const cards = Array.from(
        container.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]'),
      );
      const focused = document.activeElement as HTMLElement | null;
      const idx = focused ? cards.indexOf(focused) : -1;

      let next = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        next = idx < cards.length - 1 ? idx + 1 : 0;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        next = idx > 0 ? idx - 1 : cards.length - 1;
      } else if (e.key === 'Escape') {
        setSelectedPhase(null);
        return;
      } else if (e.key === 'Home') {
        e.preventDefault();
        next = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        next = cards.length - 1;
      }

      if (next >= 0 && cards[next]) {
        cards[next].focus();
      }
    },
    [setSelectedPhase],
  );

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const groupedLinear = useMemo(
    () => groupLinearIssues(linearIssues ?? []),
    [linearIssues],
  );

  if (!board) return null;

  const grouped = groupPhases(board.phases);

  return (
    <div
      ref={boardRef}
      className="flex gap-[var(--spacing-3)] h-full overflow-x-auto p-[var(--spacing-3)] scroll-smooth"
    >
      {COLLAPSED_COLUMNS.map((col, i) => (
        <KanbanColumn
          key={col.id}
          title={t(COLUMN_LABEL_KEYS[col.id])}
          phases={grouped.get(col.id) ?? []}
          color={COLUMN_COLORS[col.id] ?? STATUS_COLORS.pending}
          animationDelay={i * 50}
          onSelectPhase={onSelectPhase}
          linearIssues={groupedLinear.get(col.id)}
          selectedItem={selectedItem}
          onSelectItem={onSelectItem}
        />
      ))}
    </div>
  );
}
