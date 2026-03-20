import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { useBoardStore } from '@/client/store/board-store.js';

// ---------------------------------------------------------------------------
// WorkspaceSwitcher — breadcrumb button + dropdown for workspace hot-switch
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'maestro.recentWorkspaces';
const MAX_RECENT = 5;

function getBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function loadRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentWorkspaces(workspaces: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // ignore storage errors
  }
}

function addToRecentWorkspaces(path: string): void {
  const recents = loadRecentWorkspaces().filter((p) => p !== path);
  recents.unshift(path);
  saveRecentWorkspaces(recents.slice(0, MAX_RECENT));
}

export function WorkspaceSwitcher() {
  const workspace = useBoardStore((s) => s.workspace);
  const setWorkspace = useBoardStore((s) => s.setWorkspace);

  const [isOpen, setIsOpen] = useState(false);
  const [inputPath, setInputPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Refresh recent workspaces when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setRecentWorkspaces(loadRecentWorkspaces());
      setInputPath('');
      setError(null);
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const handleSwitch = useCallback(
    async (path: string) => {
      if (!path.trim()) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path.trim() }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? `Error ${res.status}`);
          return;
        }
        addToRecentWorkspaces(path.trim());
        setWorkspace(path.trim());
        setIsOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setIsLoading(false);
      }
    },
    [setWorkspace],
  );

  // Close dropdown on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setIsOpen(false);
  }, []);

  const workspaceName = workspace ? getBasename(workspace) : '\u2014';

  return (
    <div ref={containerRef} className="relative flex items-center" onKeyDown={handleKeyDown}>
      {/* Breadcrumb button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={[
          'flex items-center gap-[var(--spacing-1)] px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
          'text-[length:var(--font-size-sm)] text-text-secondary',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-notion)]',
          'hover:bg-bg-hover hover:text-text-primary',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
        ].join(' ')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="text-text-placeholder">/</span>
        <span className="max-w-[160px] truncate">{workspaceName}</span>
        <span className="text-[length:9px] text-text-placeholder ml-[2px]">&#9660;</span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Switch workspace"
          className={[
            'absolute top-full left-0 mt-[4px] w-[320px] z-50',
            'bg-bg-secondary border border-border rounded-[var(--radius-md)]',
            'shadow-[var(--shadow-lg,0_8px_24px_rgba(0,0,0,0.18))]',
            'p-[var(--spacing-2)]',
          ].join(' ')}
        >
          {/* Recent workspaces */}
          {recentWorkspaces.length > 0 && (
            <div className="mb-[var(--spacing-2)]">
              <p className="text-[length:var(--font-size-xs)] text-text-placeholder px-[var(--spacing-2)] mb-[var(--spacing-1)]">
                Recent
              </p>
              <ul role="listbox">
                {recentWorkspaces.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={path === workspace}
                      onClick={() => handleSwitch(path)}
                      disabled={isLoading}
                      className={[
                        'w-full text-left flex items-center gap-[var(--spacing-2)]',
                        'px-[var(--spacing-2)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)]',
                        'text-[length:var(--font-size-sm)]',
                        'transition-colors duration-[var(--duration-fast)]',
                        'hover:bg-bg-hover focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
                        path === workspace ? 'text-text-primary' : 'text-text-secondary',
                        isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span className="text-text-placeholder text-[length:var(--font-size-xs)]">&#128193;</span>
                      <span className="truncate flex-1">{path}</span>
                      {path === workspace && (
                        <span className="text-[length:var(--font-size-xs)] text-text-placeholder shrink-0">current</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border mt-[var(--spacing-2)] mb-[var(--spacing-2)]" />
            </div>
          )}

          {/* Manual path input */}
          <div className="px-[var(--spacing-1)] flex flex-col gap-[var(--spacing-2)]">
            <label className="text-[length:var(--font-size-xs)] text-text-placeholder">
              Path
            </label>
            <input
              type="text"
              value={inputPath}
              onChange={(e) => setInputPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSwitch(inputPath);
              }}
              placeholder="/path/to/workspace"
              autoFocus
              className={[
                'w-full px-[var(--spacing-2)] py-[var(--spacing-1)] rounded-[var(--radius-sm)]',
                'bg-bg-tertiary border border-border',
                'text-[length:var(--font-size-sm)] text-text-primary placeholder:text-text-placeholder',
                'focus:outline-none focus:border-accent-blue',
                'transition-colors duration-[var(--duration-fast)]',
              ].join(' ')}
            />

            {/* Error message */}
            {error && (
              <p className="text-[length:var(--font-size-xs)] text-status-blocked px-[var(--spacing-1)]">
                {error}
              </p>
            )}

            {/* Confirm button */}
            <button
              type="button"
              onClick={() => handleSwitch(inputPath)}
              disabled={isLoading || !inputPath.trim()}
              className={[
                'w-full px-[var(--spacing-3)] py-[var(--spacing-1-5)] rounded-[var(--radius-sm)]',
                'text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)]',
                'bg-bg-tertiary border border-border text-text-secondary',
                'transition-colors duration-[var(--duration-fast)]',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
                isLoading || !inputPath.trim()
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-bg-hover hover:text-text-primary cursor-pointer',
              ].join(' ')}
            >
              {isLoading ? 'Switching...' : 'Switch workspace'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
