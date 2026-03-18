import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMcpStore } from '@/client/store/mcp-store.js';
import type { McpServerEntry } from '@/client/store/mcp-store.js';
import Terminal from 'lucide-react/dist/esm/icons/terminal.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js';
import { McpDetailPanel } from '@/client/components/mcp/McpDetailPanel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract last path segment (folder name) from a full path string. */
function basename(p: string): string {
  const sep = p.includes('/') ? '/' : p.includes('\\') ? '\\' : '/';
  const cleaned = p.endsWith(sep) ? p.slice(0, -1) : p;
  const idx = cleaned.lastIndexOf(sep);
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

// ---------------------------------------------------------------------------
// McpListView -- table view with stats bar, toolbar, and detail panel
// ---------------------------------------------------------------------------

type ScopeFilter = 'all' | 'global' | 'project' | 'enterprise';
type TransportFilter = 'stdio' | 'http';

const SCOPE_CHIPS: { id: ScopeFilter; label: string; color?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'global', label: 'Global', color: 'var(--color-accent-blue, #5B8DB8)' },
  { id: 'project', label: 'Project', color: 'var(--color-status-planning, #9178B5)' },
  { id: 'enterprise', label: 'Enterprise', color: 'var(--color-status-verifying, #C8863A)' },
];

const SCOPE_BADGE: Record<string, { bg: string; text: string }> = {
  global: { bg: 'rgba(91,141,184,0.12)', text: 'var(--color-accent-blue, #5B8DB8)' },
  project: { bg: 'rgba(145,120,181,0.12)', text: 'var(--color-status-planning, #9178B5)' },
  enterprise: { bg: 'rgba(200,134,58,0.12)', text: 'var(--color-status-verifying, #C8863A)' },
  codex: { bg: 'rgba(90,158,120,0.12)', text: 'var(--color-status-completed, #5A9E78)' },
};

export function McpListView() {
  const allServers = useMcpStore((s) => s.servers);
  const scopeFilter = useMcpStore((s) => s.scopeFilter);
  const search = useMcpStore((s) => s.search);

  const servers = useMemo(() => {
    let result = allServers;
    if (scopeFilter !== 'all') result = result.filter((s) => s.scope === scopeFilter);
    if (search) {
      const lc = search.toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(lc) || (s.command?.toLowerCase().includes(lc) ?? false) || (s.url?.toLowerCase().includes(lc) ?? false),
      );
    }
    return result;
  }, [allServers, scopeFilter, search]);
  const selectedServer = useMcpStore((s) => s.selectedServer);
  const setScopeFilter = useMcpStore((s) => s.setScopeFilter);
  const setSearch = useMcpStore((s) => s.setSearch);
  const setSelectedServer = useMcpStore((s) => s.setSelectedServer);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const removeServer = useMcpStore((s) => s.removeServer);
  const removeGlobalServer = useMcpStore((s) => s.removeGlobalServer);

  // Computed counts
  const activeCount = allServers.filter((s) => s.enabled).length;
  const globalCount = allServers.filter((s) => s.scope === 'global').length;
  const projectCount = allServers.filter((s) => s.scope === 'project').length;
  const enterpriseCount = allServers.filter((s) => s.scope === 'enterprise').length;
  const stdioCount = allServers.filter((s) => s.transport === 'stdio').length;
  const httpCount = allServers.filter((s) => s.transport === 'http').length;

  const scopeCounts: Record<string, number> = {
    all: allServers.length,
    global: globalCount,
    project: projectCount,
    enterprise: enterpriseCount,
  };

  const selectedEntry = selectedServer
    ? allServers.find((s) => s.id === selectedServer) ?? null
    : null;

  function handleToggle(srv: McpServerEntry) {
    void toggleServer(srv.projectPath ?? '', srv.name, !srv.enabled);
  }

  function handleRemove(srv: McpServerEntry) {
    if (srv.scope === 'global') {
      void removeGlobalServer(srv.name);
    } else {
      void removeServer(srv.projectPath ?? '', srv.name);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats strip */}
      <div className="flex items-center gap-5 px-5 py-2 border-b border-border-divider bg-bg-primary shrink-0">
        <StatItem color="var(--color-status-completed, #5A9E78)" value={activeCount} label="Active" />
        <StatItem color="var(--color-accent-blue, #5B8DB8)" value={globalCount} label="Global" />
        <StatItem color="var(--color-status-planning, #9178B5)" value={projectCount} label="Project" />
        <StatItem color="var(--color-status-verifying, #C8863A)" value={enterpriseCount} label="Enterprise" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-[10px] px-5 py-2 border-b border-border-divider shrink-0">
        {/* Search */}
        <div className="flex items-center gap-[6px] px-3 py-[6px] rounded-[var(--radius-lg)] bg-bg-card border border-border w-[260px] focus-within:border-[var(--color-status-planning,#9178B5)] transition-colors">
          <Search size={13} strokeWidth={2} className="text-text-tertiary shrink-0" />
          <input
            type="text"
            placeholder="Search servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-none bg-transparent outline-none text-[12px] text-text-primary w-full placeholder:text-text-tertiary"
          />
        </div>

        {/* Scope filter chips */}
        <div className="flex gap-[6px]">
          {SCOPE_CHIPS.map((chip) => {
            const isActive = scopeFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setScopeFilter(chip.id as 'all' | 'global' | 'project' | 'enterprise')}
                className={[
                  'flex items-center gap-1 px-[10px] py-1 rounded-full border text-[10px] font-semibold whitespace-nowrap transition-all cursor-pointer',
                  isActive
                    ? 'bg-text-primary text-white border-text-primary'
                    : 'bg-bg-card text-text-tertiary border-border hover:border-text-tertiary hover:text-text-secondary',
                ].join(' ')}
              >
                {chip.color && !isActive && (
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: chip.color }} />
                )}
                {chip.label}
                <span className="font-mono text-[9px] opacity-60">{scopeCounts[chip.id]}</span>
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <div className="w-px h-[18px] bg-border-divider" />

        {/* Transport filter chips */}
        <div className="flex gap-[6px]">
          {(['stdio', 'http'] as TransportFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              className="flex items-center gap-1 px-[10px] py-1 rounded-full border border-border bg-bg-card text-[10px] font-semibold text-text-tertiary hover:border-text-tertiary hover:text-text-secondary transition-all cursor-pointer whitespace-nowrap"
            >
              {t.toUpperCase()}
              <span className="font-mono text-[9px] opacity-60">
                {t === 'stdio' ? stdioCount : httpCount}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Add Server button */}
        <button
          type="button"
          className="flex items-center gap-[6px] px-[14px] py-[6px] rounded-[var(--radius-lg)] border-none bg-text-primary text-white text-[11px] font-semibold cursor-pointer transition-all hover:-translate-y-px hover:shadow-md whitespace-nowrap"
        >
          <Plus size={13} strokeWidth={2} />
          Add Server
        </button>
      </div>

      {/* Table + Detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table area */}
        <div className="flex-1 overflow-y-auto min-w-0">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap w-[36px]" />
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap">Name</th>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap">Command / URL</th>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap">Scope</th>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap">CLI</th>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap w-[50px]">On</th>
                <th className="sticky top-0 z-10 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-text-tertiary px-[14px] py-2 bg-bg-secondary border-b border-border whitespace-nowrap w-[140px]" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const showProjectGroups = scopeFilter === 'all' || scopeFilter === 'project';
                if (!showProjectGroups) {
                  // No grouping needed -- render flat
                  return servers.map((srv) => (
                    <ServerRow
                      key={srv.id}
                      server={srv}
                      selected={selectedServer === srv.id}
                      onSelect={() => setSelectedServer(selectedServer === srv.id ? null : srv.id)}
                      onToggle={() => handleToggle(srv)}
                      onRemove={() => handleRemove(srv)}
                    />
                  ));
                }

                // Separate project-scope servers from others
                const projectServers = servers.filter((s) => s.scope === 'project');
                const nonProjectServers = servers.filter((s) => s.scope !== 'project');

                // Group project servers by projectPath
                const groupMap = new Map<string, McpServerEntry[]>();
                for (const srv of projectServers) {
                  const key = srv.projectPath ?? '';
                  const list = groupMap.get(key) ?? [];
                  list.push(srv);
                  groupMap.set(key, list);
                }

                const rows: React.ReactNode[] = [];

                // Non-project rows first
                for (const srv of nonProjectServers) {
                  rows.push(
                    <ServerRow
                      key={srv.id}
                      server={srv}
                      selected={selectedServer === srv.id}
                      onSelect={() => setSelectedServer(selectedServer === srv.id ? null : srv.id)}
                      onToggle={() => handleToggle(srv)}
                      onRemove={() => handleRemove(srv)}
                    />,
                  );
                }

                // Project groups
                for (const [path, svrs] of groupMap) {
                  const folderName = basename(path);
                  rows.push(
                    <ProjectGroupRow
                      key={`group:${path}`}
                      folderName={folderName}
                      fullPath={path}
                      count={svrs.length}
                    />,
                  );
                  for (const srv of svrs) {
                    rows.push(
                      <ServerRow
                        key={srv.id}
                        server={srv}
                        selected={selectedServer === srv.id}
                        onSelect={() => setSelectedServer(selectedServer === srv.id ? null : srv.id)}
                        onToggle={() => handleToggle(srv)}
                        onRemove={() => handleRemove(srv)}
                      />,
                    );
                  }
                }

                if (rows.length === 0) {
                  return (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-text-tertiary text-[length:var(--font-size-sm)]">
                        No servers found
                      </td>
                    </tr>
                  );
                }

                return rows;
              })()}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedEntry && (
            <McpDetailPanel
              server={selectedEntry}
              onClose={() => setSelectedServer(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function StatItem({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-[6px]">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[16px] font-extrabold text-text-primary font-mono">{value}</span>
      <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.04em]">{label}</span>
    </div>
  );
}

function ProjectGroupRow({
  folderName,
  fullPath,
  count,
}: {
  folderName: string;
  fullPath: string;
  count: number;
}) {
  return (
    <tr className="group-header-row">
      <td
        colSpan={7}
        className="px-[14px] py-[6px] bg-[rgba(145,120,181,0.04)] border-b border-border-divider"
      >
        <div className="flex items-center gap-[8px]">
          <FolderOpen
            size={13}
            strokeWidth={1.8}
            style={{ color: 'var(--color-status-planning, #9178B5)', opacity: 0.7 }}
          />
          <span
            className="text-[11px] font-bold text-text-secondary"
            title={fullPath}
          >
            {folderName}
          </span>
          <span className="text-[9px] font-mono text-text-tertiary opacity-60">{count}</span>
        </div>
      </td>
    </tr>
  );
}

function ServerRow({
  server,
  selected,
  onSelect,
  onToggle,
  onRemove,
}: {
  server: McpServerEntry;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const scopeStyle = SCOPE_BADGE[server.scope] ?? SCOPE_BADGE.global;

  const commandText = server.command
    ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`
    : server.url ?? '';

  // Determine if server is missing from one CLI (for copy button)
  const missingClaude = !server.cli.claude && server.cli.codex;
  const missingCodex = server.cli.claude && !server.cli.codex;

  return (
    <tr
      onClick={onSelect}
      className={[
        'cursor-pointer transition-colors group',
        selected ? '[&>td]:bg-[rgba(145,120,181,0.07)]' : 'hover:[&>td]:bg-bg-hover',
      ].join(' ')}
    >
      {/* Type icon */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle">
        <div
          className="w-7 h-7 rounded-[var(--radius-md)] shrink-0 flex items-center justify-center"
          style={{
            background: server.transport === 'stdio' ? 'rgba(91,141,184,0.08)' : 'rgba(145,120,181,0.08)',
            color: server.transport === 'stdio' ? 'var(--color-accent-blue, #5B8DB8)' : 'var(--color-status-planning, #9178B5)',
          }}
        >
          {server.transport === 'stdio' ? (
            <Terminal size={14} strokeWidth={1.8} />
          ) : (
            <Globe size={14} strokeWidth={1.8} />
          )}
        </div>
      </td>

      {/* Name */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle">
        <span className="text-[12px] font-semibold text-text-primary">{server.name}</span>
      </td>

      {/* Command/URL */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle">
        <span className="font-mono text-[11px] text-text-tertiary max-w-[280px] whitespace-nowrap overflow-hidden text-ellipsis block">
          {commandText}
        </span>
      </td>

      {/* Scope */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle whitespace-nowrap">
        <span
          className="text-[9px] font-bold px-[7px] py-[2px] rounded-[4px] uppercase tracking-[0.03em] font-mono"
          style={{ background: scopeStyle.bg, color: scopeStyle.text }}
        >
          {server.scope}
        </span>
      </td>

      {/* CLI badges */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle">
        <div className="flex gap-[3px]">
          <span
            className={[
              'w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none',
              server.cli.claude ? '' : 'opacity-25',
            ].join(' ')}
            style={{ background: 'rgba(200,134,58,0.08)', color: 'var(--color-status-verifying, #C8863A)' }}
          >
            C
          </span>
          <span
            className={[
              'w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none',
              server.cli.codex ? '' : 'opacity-25',
            ].join(' ')}
            style={{ background: 'rgba(90,158,120,0.08)', color: 'var(--color-status-completed, #5A9E78)' }}
          >
            X
          </span>
        </div>
      </td>

      {/* Toggle */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle text-center">
        <label
          className="relative inline-block w-8 h-[18px] cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={onToggle}
            disabled={server.scope === 'enterprise'}
            className="sr-only peer"
          />
          <div
            className={[
              'w-8 h-[18px] rounded-full transition-colors duration-200',
              server.scope === 'enterprise' ? 'opacity-50 cursor-default' : '',
            ].join(' ')}
            style={{ background: server.enabled ? 'var(--color-status-completed, #5A9E78)' : 'var(--color-border, #E8E5DE)' }}
          >
            <div
              className="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200"
              style={{ transform: server.enabled ? 'translateX(14px)' : 'translateX(0)' }}
            />
          </div>
        </label>
      </td>

      {/* Actions */}
      <td className="px-[14px] py-2 border-b border-border-divider align-middle">
        <div
          className="flex gap-1 items-center opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Copy to other CLI button */}
          {(missingCodex || missingClaude) && (
            <button
              type="button"
              className="flex items-center gap-[3px] px-2 py-1 rounded-[5px] border border-border bg-bg-card text-[9px] font-semibold text-text-tertiary hover:border-[var(--color-accent-blue,#5B8DB8)] hover:text-[var(--color-accent-blue,#5B8DB8)] hover:bg-[rgba(91,141,184,0.04)] transition-all whitespace-nowrap"
              title={missingCodex ? 'Copy to Codex' : 'Copy to Claude'}
            >
              {missingCodex ? (
                <>
                  <ChevronRight size={10} strokeWidth={2.5} />
                  <span
                    className="w-[14px] h-[11px] rounded-[2px] flex items-center justify-center text-[7px] font-extrabold font-mono"
                    style={{ background: 'rgba(90,158,120,0.08)', color: 'var(--color-status-completed, #5A9E78)' }}
                  >
                    X
                  </span>
                </>
              ) : (
                <>
                  <ChevronLeft size={10} strokeWidth={2.5} />
                  <span
                    className="w-[14px] h-[11px] rounded-[2px] flex items-center justify-center text-[7px] font-extrabold font-mono"
                    style={{ background: 'rgba(200,134,58,0.08)', color: 'var(--color-status-verifying, #C8863A)' }}
                  >
                    C
                  </span>
                </>
              )}
            </button>
          )}

          {/* Edit */}
          <button
            type="button"
            className="flex items-center gap-1 px-[10px] py-[5px] rounded-[var(--radius-md)] border border-border bg-bg-card text-[10px] font-semibold text-text-secondary hover:border-text-tertiary hover:text-text-primary transition-all"
          >
            <Edit3 size={11} strokeWidth={2} />
          </button>

          {/* Delete */}
          {server.scope !== 'enterprise' && (
            <button
              type="button"
              onClick={onRemove}
              className="flex items-center gap-1 px-[10px] py-[5px] rounded-[var(--radius-md)] border border-border bg-bg-card text-[10px] font-semibold text-status-failed hover:border-status-failed hover:bg-red-50 transition-all"
            >
              <Trash2 size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
