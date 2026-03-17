import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { LinearTeam } from '@/shared/linear-types.js';
import type { Issue } from '@/shared/issue-types.js';
import { useLinearStore } from '@/client/store/linear-store.js';
import { useIssueStore } from '@/client/store/issue-store.js';
import { cn } from '@/client/lib/utils.js';

// ---------------------------------------------------------------------------
// LinearExportDialog — select local issues to export to Linear
// ---------------------------------------------------------------------------

interface LinearExportDialogProps {
  teams: LinearTeam[];
  selectedTeamId: string | null;
  onClose: () => void;
}

export function LinearExportDialog({ teams, selectedTeamId, onClose }: LinearExportDialogProps) {
  const [teamId, setTeamId] = useState(selectedTeamId ?? teams[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ exported: number; errors: string[] } | null>(null);

  const issues = useIssueStore((s) => s.issues);
  const fetchIssues = useIssueStore((s) => s.fetchIssues);
  const exportIssues = useLinearStore((s) => s.exportIssues);
  const refreshLinear = useLinearStore((s) => s.refresh);

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  function toggleAll() {
    if (selected.size === issues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((i) => i.id)));
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function handleExport() {
    const toExport = issues.filter((i) => selected.has(i.id));
    if (toExport.length === 0 || !teamId) return;
    setExporting(true);
    try {
      const res = await exportIssues(toExport, teamId);
      setResult(res);
      // Refresh Linear board after export
      await refreshLinear();
    } catch (err) {
      setResult({ exported: 0, errors: [String(err)] });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[600px] max-w-[95vw] max-h-[80vh]',
            'rounded-[var(--radius-lg)] border border-border bg-bg-primary shadow-lg',
            'flex flex-col overflow-hidden focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between px-[var(--spacing-4)] py-[var(--spacing-3)] border-b border-border">
            <Dialog.Title className="text-[length:var(--font-size-base)] font-[var(--font-weight-semibold)] text-text-primary">
              Export to Linear
            </Dialog.Title>
            <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary hover:bg-bg-hover">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </Dialog.Close>
          </div>

          {result ? (
            <div className="p-[var(--spacing-4)] space-y-[var(--spacing-3)]">
              <p className="text-[length:var(--font-size-sm)] text-text-primary">
                Exported {result.exported} issue(s) to Linear.
              </p>
              {result.errors.length > 0 && (
                <div className="text-[length:var(--font-size-xs)] text-status-blocked">
                  {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)] bg-accent-blue text-white text-[length:var(--font-size-sm)] hover:opacity-90"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Team selector + mapping info */}
              <div className="px-[var(--spacing-4)] py-[var(--spacing-2)] bg-bg-secondary border-b border-border space-y-[var(--spacing-2)]">
                <div className="flex items-center gap-[var(--spacing-2)]">
                  <label className="text-[length:var(--font-size-xs)] text-text-secondary shrink-0">Target team:</label>
                  <select
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-border bg-bg-primary text-text-primary text-[length:var(--font-size-xs)]"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.key} — {t.name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[length:var(--font-size-xs)] text-text-secondary">
                  Local issues will be created in Linear: <span className="font-mono">title</span> → title, <span className="font-mono">priority</span> → Linear priority, <span className="font-mono">description</span> → description
                </p>
              </div>

              {/* Issue list */}
              <div className="flex-1 overflow-y-auto">
                {issues.length === 0 ? (
                  <div className="p-[var(--spacing-4)] text-[length:var(--font-size-sm)] text-text-secondary text-center">
                    No local issues available
                  </div>
                ) : (
                  <table className="w-full text-[length:var(--font-size-xs)]">
                    <thead>
                      <tr className="border-b border-border text-text-tertiary">
                        <th className="w-8 p-[var(--spacing-2)]">
                          <input type="checkbox" checked={selected.size === issues.length && issues.length > 0} onChange={toggleAll} />
                        </th>
                        <th className="text-left p-[var(--spacing-2)]">Title</th>
                        <th className="text-left p-[var(--spacing-2)]">Status</th>
                        <th className="text-left p-[var(--spacing-2)]">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => (
                        <tr
                          key={issue.id}
                          className="border-b border-border-divider hover:bg-bg-hover cursor-pointer"
                          onClick={() => toggle(issue.id)}
                        >
                          <td className="p-[var(--spacing-2)]">
                            <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggle(issue.id)} />
                          </td>
                          <td className="p-[var(--spacing-2)] text-text-primary">{issue.title}</td>
                          <td className="p-[var(--spacing-2)] text-text-secondary">{issue.status}</td>
                          <td className="p-[var(--spacing-2)] text-text-secondary">{issue.priority}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-[var(--spacing-4)] py-[var(--spacing-3)] border-t border-border">
                <span className="text-[length:var(--font-size-xs)] text-text-secondary">
                  {selected.size} of {issues.length} selected
                </span>
                <div className="flex gap-[var(--spacing-2)]">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)] border border-border text-text-secondary text-[length:var(--font-size-sm)] hover:bg-bg-hover"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExport()}
                    disabled={selected.size === 0 || !teamId || exporting}
                    className="px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)] bg-accent-blue text-white text-[length:var(--font-size-sm)] hover:opacity-90 disabled:opacity-50"
                  >
                    {exporting ? 'Exporting...' : `Export ${selected.size} issue(s)`}
                  </button>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
