import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { LinearIssue } from '@/shared/linear-types.js';
import { LINEAR_PRIORITY_LABELS } from '@/shared/linear-types.js';
import { useLinearStore } from '@/client/store/linear-store.js';
import { cn } from '@/client/lib/utils.js';

// ---------------------------------------------------------------------------
// LinearImportDialog — select Linear issues to import as local issues
// ---------------------------------------------------------------------------

interface LinearImportDialogProps {
  issues: LinearIssue[];
  onClose: () => void;
}

export function LinearImportDialog({ issues, onClose }: LinearImportDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const importIssues = useLinearStore((s) => s.importIssues);

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

  async function handleImport() {
    const toImport = issues.filter((i) => selected.has(i.id));
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const res = await importIssues(toImport);
      setResult(res);
    } catch (err) {
      setResult({ imported: 0, errors: [String(err)] });
    } finally {
      setImporting(false);
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
              Import from Linear
            </Dialog.Title>
            <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-text-secondary hover:text-text-primary hover:bg-bg-hover">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </Dialog.Close>
          </div>

          {result ? (
            <div className="p-[var(--spacing-4)] space-y-[var(--spacing-3)]">
              <p className="text-[length:var(--font-size-sm)] text-text-primary">
                Imported {result.imported} issue(s).
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
              {/* Mapping preview */}
              <div className="px-[var(--spacing-4)] py-[var(--spacing-2)] bg-bg-secondary border-b border-border">
                <p className="text-[length:var(--font-size-xs)] text-text-secondary">
                  Linear issues will be mapped: <span className="font-mono">identifier</span> → title prefix, <span className="font-mono">priority</span> → local priority, <span className="font-mono">state.type</span> → local status
                </p>
              </div>

              {/* Issue list */}
              <div className="flex-1 overflow-y-auto">
                {issues.length === 0 ? (
                  <div className="p-[var(--spacing-4)] text-[length:var(--font-size-sm)] text-text-secondary text-center">
                    No Linear issues available
                  </div>
                ) : (
                  <table className="w-full text-[length:var(--font-size-xs)]">
                    <thead>
                      <tr className="border-b border-border text-text-tertiary">
                        <th className="w-8 p-[var(--spacing-2)]">
                          <input type="checkbox" checked={selected.size === issues.length} onChange={toggleAll} />
                        </th>
                        <th className="text-left p-[var(--spacing-2)]">Issue</th>
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
                          <td className="p-[var(--spacing-2)]">
                            <span className="font-mono text-text-tertiary">{issue.identifier}</span>{' '}
                            <span className="text-text-primary">{issue.title}</span>
                          </td>
                          <td className="p-[var(--spacing-2)] text-text-secondary">{issue.state.name}</td>
                          <td className="p-[var(--spacing-2)] text-text-secondary">{LINEAR_PRIORITY_LABELS[issue.priority]}</td>
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
                    onClick={() => void handleImport()}
                    disabled={selected.size === 0 || importing}
                    className="px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)] bg-accent-blue text-white text-[length:var(--font-size-sm)] hover:opacity-90 disabled:opacity-50"
                  >
                    {importing ? 'Importing...' : `Import ${selected.size} issue(s)`}
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
