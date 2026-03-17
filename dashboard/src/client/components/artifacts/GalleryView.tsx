import { useState, useMemo, type CSSProperties } from 'react';
import type { FileNode } from '@/client/hooks/useArtifacts.js';
import { ArtifactCard } from '@/client/components/artifacts/ArtifactCard.js';
import Search from 'lucide-react/dist/esm/icons/search.js';

// ---------------------------------------------------------------------------
// GalleryView -- grid of artifact cards grouped by directory
// ---------------------------------------------------------------------------

interface GalleryViewProps {
  tree: FileNode[];
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}

interface FlatFile {
  name: string;
  path: string;
  group: string;
}

/** Flatten tree into a flat file list with group (parent directory) */
function flattenTree(nodes: FileNode[], parentPath: string = ''): FlatFile[] {
  const files: FlatFile[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push({ name: node.name, path: node.path, group: parentPath || 'root' });
    } else if (node.children) {
      files.push(...flattenTree(node.children, node.name));
    }
  }
  return files;
}

/** Group files by their group key */
function groupBy(files: FlatFile[]): Map<string, FlatFile[]> {
  const groups = new Map<string, FlatFile[]>();
  for (const file of files) {
    const list = groups.get(file.group) || [];
    list.push(file);
    groups.set(file.group, list);
  }
  return groups;
}

const TYPE_FILTERS = ['All', 'json', 'md', 'jsonl'] as const;

/** Infer phase dot color and optional status label from group name */
function getGroupStyle(group: string): { dotColor: string; statusLabel?: string; statusBg?: string; statusColor?: string } {
  // Non-phase groups
  if (group === 'root' || !group.match(/^\d{2}-/)) {
    return { dotColor: 'var(--color-text-tertiary)' };
  }
  // Infer status from common keywords in phase directory names
  const lower = group.toLowerCase();
  if (lower.includes('setup') || lower.includes('complete') || lower.includes('init')) {
    return { dotColor: 'var(--color-status-completed)', statusLabel: 'Done', statusBg: 'var(--color-status-bg-completed)', statusColor: 'var(--color-status-completed)' };
  }
  // Default: show as active/executing phase
  return { dotColor: 'var(--color-accent-yellow)', statusLabel: 'Active', statusBg: 'var(--color-status-bg-executing)', statusColor: 'var(--color-status-executing)' };
}

export function GalleryView({ tree, onSelectFile, selectedPath }: GalleryViewProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  const allFiles = useMemo(() => flattenTree(tree), [tree]);

  const filteredFiles = useMemo(() => {
    let files = allFiles;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      files = files.filter(
        (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
      );
    }

    // Type filter
    if (typeFilter !== 'All') {
      files = files.filter((f) => {
        const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
        if (typeFilter === 'json') return ext === '.json';
        if (typeFilter === 'md') return ext === '.md';
        if (typeFilter === 'jsonl') return ext === '.ndjson' || ext === '.jsonl';
        return true;
      });
    }

    return files;
  }, [allFiles, search, typeFilter]);

  const grouped = useMemo(() => groupBy(filteredFiles), [filteredFiles]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[24px] py-[10px] border-b border-border-divider shrink-0">
        {/* Search */}
        <div className={[
          'flex items-center gap-[var(--spacing-1-5)] px-[var(--spacing-3)] py-[5px] rounded-[var(--radius-md)]',
          'bg-bg-card border border-border w-[200px]',
          'focus-within:border-accent-purple transition-colors duration-[var(--duration-fast)]',
        ].join(' ')}>
          <Search size={13} strokeWidth={2} className="text-text-placeholder shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts..."
            aria-label="Search artifacts"
            className="border-none bg-transparent outline-none text-[12px] text-text-primary placeholder:text-text-placeholder w-full font-[inherit]"
          />
        </div>

        <div className="flex-1" />

        {/* Type filter chips */}
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={[
              'text-[11px] font-[var(--font-weight-medium)] px-[var(--spacing-3)] py-[var(--spacing-1)] rounded-full',
              'border transition-all duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
              typeFilter === t
                ? 'bg-text-primary text-bg-primary border-text-primary'
                : 'bg-bg-card text-text-secondary border-border hover:border-text-tertiary hover:text-text-primary',
            ].join(' ')}
          >
            {t === 'All' ? 'All' : t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Gallery grid */}
      <div className="flex-1 overflow-y-auto px-[24px] py-[var(--spacing-4)]">
        {filteredFiles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
            No artifacts found
          </div>
        ) : (
          Array.from(grouped.entries()).map(([group, files]) => {
            const gs = getGroupStyle(group);
            return (
            <div key={group} className="mb-[24px]">
              {/* Group header */}
              <div className="flex items-center gap-[10px] mb-[10px] pl-[var(--spacing-1)]">
                <span className="w-[10px] h-[10px] rounded-full shrink-0" style={{ background: gs.dotColor }} />
                <span className="text-[13px] font-[var(--font-weight-bold)] text-text-primary">{group === 'root' ? 'Project' : group}</span>
                {gs.statusLabel && (
                  <span
                    className="text-[10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full"
                    style={{ background: gs.statusBg, color: gs.statusColor } as CSSProperties}
                  >
                    {gs.statusLabel}
                  </span>
                )}
                <span className="text-[11px] text-text-tertiary">{files.length} file{files.length !== 1 ? 's' : ''}</span>
                <div className="flex-1 h-px bg-border-divider ml-[var(--spacing-2)]" />
              </div>

              {/* Card grid */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[10px]">
                {files.map((file) => (
                  <ArtifactCard
                    key={file.path}
                    name={file.name}
                    path={file.path}
                    type={file.name.slice(file.name.lastIndexOf('.'))}
                    isSelected={file.path === selectedPath}
                    onClick={() => onSelectFile(file.path)}
                  />
                ))}
              </div>
            </div>
          );})
        )}
      </div>
    </div>
  );
}
