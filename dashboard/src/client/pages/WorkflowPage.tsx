import { useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { ViewSwitcherContext } from '@/client/hooks/useViewSwitcher.js';
import type { ViewSwitcherConfig } from '@/client/hooks/useViewSwitcher.js';
import { useBoardStore } from '@/client/store/board-store.js';
import { PipelineBoardView } from '@/client/components/workflow/PipelineBoardView.js';
import { PhaseTimelineView } from '@/client/components/workflow/PhaseTimelineView.js';
import { CommandCenterView } from '@/client/components/workflow/CommandCenterView.js';
import { WfTableView } from '@/client/components/workflow/WfTableView.js';
import { SetupChecklist } from '@/client/components/workflow/SetupChecklist.js';
import ColumnsIcon from 'lucide-react/dist/esm/icons/columns-3.js';
import ListIcon from 'lucide-react/dist/esm/icons/list.js';
import ActivityIcon from 'lucide-react/dist/esm/icons/activity.js';
import TableIcon from 'lucide-react/dist/esm/icons/table.js';

// ---------------------------------------------------------------------------
// WorkflowPage -- 3-view switcher: Board / Timeline / Center
// ---------------------------------------------------------------------------

type ActiveView = 'board' | 'timeline' | 'center' | 'table';

const VIEW_ORDER: ActiveView[] = ['board', 'timeline', 'center', 'table'];

export function WorkflowPage() {
  const [activeView, setActiveView] = useState<ActiveView>('board');
  const { register, unregister } = useContext(ViewSwitcherContext);
  const phases = useBoardStore((s) => s.board?.phases ?? []);
  const board = useBoardStore((s) => s.board);

  const handleSwitch = useCallback((index: number) => {
    setActiveView(VIEW_ORDER[index]);
  }, []);

  const config: ViewSwitcherConfig = useMemo(() => ({
    items: [
      { label: 'Board', icon: <ColumnsIcon size={14} strokeWidth={2} />, shortcut: '1' },
      { label: 'Timeline', icon: <ListIcon size={14} strokeWidth={2} />, shortcut: '2' },
      { label: 'Center', icon: <ActivityIcon size={14} strokeWidth={2} />, shortcut: '3' },
      { label: 'Table', icon: <TableIcon size={14} strokeWidth={2} />, shortcut: '4' },
    ],
    activeIndex: VIEW_ORDER.indexOf(activeView),
    onSwitch: handleSwitch,
  }), [activeView, handleSwitch]);

  useEffect(() => {
    register(config);
  }, [config, register]);

  useEffect(() => {
    return () => unregister();
  }, [unregister]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden">
        {phases.length === 0 ? (
          <SetupChecklist project={board?.project} />
        ) : (
          <>
            {activeView === 'board' && <PipelineBoardView />}
            {activeView === 'timeline' && <PhaseTimelineView />}
            {activeView === 'center' && <CommandCenterView />}
            {activeView === 'table' && <WfTableView />}
          </>
        )}
      </div>
    </div>
  );
}
