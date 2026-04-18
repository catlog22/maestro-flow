import { useCallback, useEffect, useRef, useMemo } from 'react';
import { COLLAPSED_COLUMNS, STATUS_COLORS } from '@/shared/constants.js';
import type { SelectedKanbanItem } from '@/shared/types.js';
import type { LinearIssue } from '@/shared/linear-types.js';
import type { Issue, IssueStatus } from '@/shared/issue-types.js';
import { KanbanColumn } from '@/client/components/kanban/KanbanColumn.js';
import { useI18n } from '@/client/i18n/index.js';

// ---------------------------------------------------------------------------
// KanbanBoard — issue-only kanban with 4 columns
// ---------------------------------------------------------------------------

/** Column header colors — use the first status color in each group */
const COLUMN_COLORS: Record<string, string> = {
  backlog: STATUS_COLORS.pending,
  triage: '#C8863A',
  'in-progress': STATUS_COLORS.executing,
  review: STATUS_COLORS.verifying,
  done: STATUS_COLORS.completed,
  deferred: '#8B8685',
};

/** Translation keys for column labels */
const COLUMN_LABEL_KEYS: Record<string, string> = {
  backlog: 'columns.backlog',
  triage: 'columns.triage',
  'in-progress': 'columns.in_progress',
  review: 'columns.review',
  done: 'columns.done',
  deferred: 'columns.deferred',
};

/** Map Linear state.type → kanban column ID */
const LINEAR_STATE_TO_COLUMN: Record<string, string> = {
  backlog: 'backlog',
  unstarted: 'backlog',
  started: 'in-progress',
  completed: 'done',
};

/** Map local issue status → kanban column ID */
const ISSUE_STATUS_TO_COLUMN: Record<IssueStatus, string> = {
  open: 'backlog',
  registered: 'triage',
  in_progress: 'in-progress',
  resolved: 'review',
  closed: 'done',
  deferred: 'deferred',
};

function groupLocalIssues(issues: Issue[]): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>();
  for (const col of COLLAPSED_COLUMNS) {
    groups.set(col.id, []);
  }
  for (const issue of issues) {
    const colId = ISSUE_STATUS_TO_COLUMN[issue.status] ?? 'backlog';
    groups.get(colId)?.push(issue);
  }
  return groups;
}

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
  linearIssues?: LinearIssue[];
  localIssues?: Issue[];
  selectedItem?: SelectedKanbanItem | null;
  onSelectItem?: (item: SelectedKanbanItem) => void;
  composingColumnId?: string | null;
  onStartCompose?: (columnId: string) => void;
  onStopCompose?: () => void;
  onIssueCreated?: () => void;
  showDone?: boolean;
  batchMode?: boolean;
  selectedIssueIds?: Set<string>;
  onToggleIssueCheck?: (issueId: string) => void;
}

export function KanbanBoard({ linearIssues, localIssues, selectedItem, onSelectItem, composingColumnId, onStartCompose, onStopCompose, onIssueCreated, showDone = true, batchMode, selectedIssueIds, onToggleIssueCheck }: KanbanBoardProps) {
  const { t } = useI18n();
  const boardRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation: arrow keys between focusable cards
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
    [],
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

  const groupedLocal = useMemo(
    () => groupLocalIssues(localIssues ?? []),
    [localIssues],
  );

  return (
    <div
      ref={boardRef}
      className="flex gap-[var(--spacing-3)] h-full overflow-x-auto p-[var(--spacing-3)] scroll-smooth"
    >
      {COLLAPSED_COLUMNS
        .filter((col) => showDone || col.id !== 'done')
        .map((col, i) => (
        <KanbanColumn
          key={col.id}
          columnId={col.id}
          title={t(COLUMN_LABEL_KEYS[col.id])}
          phases={[]}
          color={COLUMN_COLORS[col.id] ?? STATUS_COLORS.pending}
          animationDelay={i * 50}
          onSelectPhase={() => {}}
          linearIssues={groupedLinear.get(col.id)}
          localIssues={groupedLocal.get(col.id)}
          selectedItem={selectedItem}
          onSelectItem={onSelectItem}
          composingColumnId={composingColumnId}
          onStartCompose={onStartCompose}
          onStopCompose={onStopCompose}
          onIssueCreated={onIssueCreated}
          batchMode={batchMode}
          selectedIssueIds={selectedIssueIds}
          onToggleIssueCheck={onToggleIssueCheck}
        />
      ))}
    </div>
  );
}
