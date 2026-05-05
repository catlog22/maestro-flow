import { useMemo, useState, useCallback } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';
import { STATUS_COLORS } from '@/shared/constants.js';
import type { PhaseCard, PhaseStatus, SelectedKanbanItem } from '@/shared/types.js';
import { PipelineHeader } from './PipelineHeader.js';
import { PipelineColumn } from './PipelineColumn.js';
import { SummaryBar } from './SummaryBar.js';

// ---------------------------------------------------------------------------
// PipelineBoardView -- 6-column kanban grouped by pipeline status
// ---------------------------------------------------------------------------

interface ColumnDef {
  status: PhaseStatus;
  label: string;
  /** PhaseStatus values that map to this column */
  match: PhaseStatus[];
}

const COLUMNS: ColumnDef[] = [
  { status: 'pending', label: 'Pending', match: ['not_started', 'pending'] },
  { status: 'exploring', label: 'Exploring', match: ['exploring'] },
  { status: 'planning', label: 'Planning', match: ['planning'] },
  { status: 'executing', label: 'Executing', match: ['executing'] },
  { status: 'verifying', label: 'Verifying', match: ['verifying', 'testing'] },
  { status: 'completed', label: 'Complete', match: ['completed'] },
  { status: 'blocked', label: 'Blocked', match: ['blocked'] },
];

function groupPhases(phases: PhaseCard[]): Map<PhaseStatus, PhaseCard[]> {
  const grouped = new Map<PhaseStatus, PhaseCard[]>();
  for (const col of COLUMNS) {
    grouped.set(col.status, []);
  }
  for (const phase of phases) {
    const col = COLUMNS.find((c) => c.match.includes(phase.status));
    if (col) {
      grouped.get(col.status)!.push(phase);
    }
  }
  return grouped;
}

interface PipelineBoardViewProps {
  onSelectTask?: (item: SelectedKanbanItem) => void;
}

export function PipelineBoardView({ onSelectTask }: PipelineBoardViewProps) {
  const phases = useBoardStore((s) => s.board?.phases ?? []);
  const grouped = useMemo(() => groupPhases(phases), [phases]);

  // Column visibility — default show 5 columns, hide last one
  const [hiddenCols, setHiddenCols] = useState<Set<PhaseStatus>>(() => new Set(['completed'] as PhaseStatus[]));
  const toggleCol = useCallback((status: PhaseStatus) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PipelineHeader phases={phases} hiddenCols={hiddenCols} onToggleCol={toggleCol} />
      <div className="flex gap-[var(--spacing-2-5)] flex-1 overflow-x-auto px-[var(--spacing-3)] py-[var(--spacing-3)]">
        {COLUMNS.map((col) =>
          hiddenCols.has(col.status) ? null : (
            <PipelineColumn
              key={col.status}
              status={col.status}
              color={STATUS_COLORS[col.status]}
              label={col.label}
              phases={grouped.get(col.status) ?? []}
              onSelectTask={onSelectTask}
            />
          ),
        )}
        {hiddenCols.size === COLUMNS.length && (
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-[length:var(--font-size-sm)]">
            All columns hidden — click a category tag above to show it.
          </div>
        )}
      </div>
      <SummaryBar />
    </div>
  );
}
