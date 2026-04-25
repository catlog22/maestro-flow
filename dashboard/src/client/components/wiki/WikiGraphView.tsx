import { useEffect, useMemo } from 'react';
import { useWikiStore, type WikiNodeType } from '@/client/store/wiki-store.js';

const TYPE_COLORS: Record<WikiNodeType, string> = {
  project: '#3b82f6',
  roadmap: '#8b5cf6',
  spec: '#16a34a',
  issue: '#dc2626',
  lesson: '#ca8a04',
  memory: '#0891b2',
  note: '#9ca3af',
};

/**
 * WikiGraphView — link relationship overview.
 * Shows entries as a sorted table with in/out degree counts,
 * plus broken link warnings.
 */
export function WikiGraphView() {
  const fetchGraph = useWikiStore((s) => s.fetchGraph);
  const graph = useWikiStore((s) => s.graph);
  const byId = useWikiStore((s) => s.byId);
  const setSelected = useWikiStore((s) => s.setSelected);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  // Compute degree stats per node
  const stats = useMemo(() => {
    if (!graph) return [];
    const degreeMap = new Map<string, { out: number; in: number }>();

    for (const [src, targets] of Object.entries(graph.forwardLinks)) {
      if (!degreeMap.has(src)) degreeMap.set(src, { out: 0, in: 0 });
      degreeMap.get(src)!.out = targets.length;
      for (const t of targets) {
        if (!degreeMap.has(t)) degreeMap.set(t, { out: 0, in: 0 });
        degreeMap.get(t)!.in += 1;
      }
    }

    return Array.from(degreeMap.entries())
      .map(([id, deg]) => ({
        id,
        title: byId[id]?.title ?? id,
        type: byId[id]?.type as WikiNodeType | undefined,
        outDegree: deg.out,
        inDegree: deg.in,
        total: deg.out + deg.in,
      }))
      .sort((a, b) => b.total - a.total);
  }, [graph, byId]);

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
        Loading graph data…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border text-[length:var(--font-size-xs)] text-text-secondary">
        <span>{stats.length} connected nodes</span>
        <span>·</span>
        <span>{Object.values(graph.forwardLinks).reduce((sum, arr) => sum + arr.length, 0)} links</span>
        {graph.brokenLinks.length > 0 && (
          <>
            <span>·</span>
            <span className="text-accent-red">{graph.brokenLinks.length} broken</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Link table */}
        <table className="w-full text-[length:var(--font-size-sm)]">
          <thead className="sticky top-0 bg-bg-primary z-10">
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-text-tertiary">
              <th className="text-left px-4 py-2 font-medium">Entry</th>
              <th className="text-left px-3 py-2 font-medium w-16">Type</th>
              <th className="text-center px-3 py-2 font-medium w-16">Out</th>
              <th className="text-center px-3 py-2 font-medium w-16">In</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((node) => (
              <tr
                key={node.id}
                className="border-b border-border hover:bg-bg-secondary transition-colors cursor-pointer"
                onClick={() => setSelected(node.id)}
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {node.type && (
                      <span
                        className="inline-block w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ backgroundColor: TYPE_COLORS[node.type] ?? '#9ca3af' }}
                      />
                    )}
                    <span className="text-text-primary truncate">{node.title}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-text-tertiary text-[length:var(--font-size-xs)]">
                  {node.type ?? '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {node.outDegree > 0 ? (
                    <span className="text-accent-blue font-medium">{node.outDegree}</span>
                  ) : (
                    <span className="text-text-quaternary">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {node.inDegree > 0 ? (
                    <span className="text-accent-green font-medium">{node.inDegree}</span>
                  ) : (
                    <span className="text-text-quaternary">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Broken links section */}
        {graph.brokenLinks.length > 0 && (
          <div className="p-4 border-t border-border">
            <h3 className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium mb-2">
              Broken Links ({graph.brokenLinks.length})
            </h3>
            <ul className="flex flex-col gap-1 text-[length:var(--font-size-xs)]">
              {graph.brokenLinks.map((bl, i) => (
                <li key={`${bl.sourceId}-${i}`} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(bl.sourceId)}
                    className="text-accent-blue hover:underline truncate"
                  >
                    {byId[bl.sourceId]?.title ?? bl.sourceId}
                  </button>
                  <span className="text-text-quaternary">→</span>
                  <span className="text-text-tertiary line-through">{bl.target}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
