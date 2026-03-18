import { useMemo } from 'react';
import { motion } from 'framer-motion';
import Terminal from 'lucide-react/dist/esm/icons/terminal.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js';
import { useMcpStore } from '@/client/store/mcp-store.js';
import type { McpServerEntry } from '@/client/store/mcp-store.js';

// ---------------------------------------------------------------------------
// McpCardsView -- servers grouped by scope in a card grid
// ---------------------------------------------------------------------------

interface ScopeGroup {
  scope: string;
  label: string;
  color: string;
  servers: McpServerEntry[];
  /** When scope='project', sub-groups by workspace path. */
  projectSubGroups?: ProjectSubGroup[];
}

interface ProjectSubGroup {
  projectPath: string;
  folderName: string;
  servers: McpServerEntry[];
}

/** Extract last path segment (folder name) from a full path string. */
function basename(p: string): string {
  const sep = p.includes('/') ? '/' : p.includes('\\') ? '\\' : '/';
  const cleaned = p.endsWith(sep) ? p.slice(0, -1) : p;
  const idx = cleaned.lastIndexOf(sep);
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

const SCOPE_META: Record<string, { label: string; color: string }> = {
  global: { label: 'Global Servers', color: 'var(--color-accent-blue, #5B8DB8)' },
  project: { label: 'Project Servers', color: 'var(--color-status-planning, #9178B5)' },
  enterprise: { label: 'Enterprise Managed', color: 'var(--color-status-verifying, #C8863A)' },
  codex: { label: 'Codex Servers', color: 'var(--color-status-completed, #5A9E78)' },
};

const SCOPE_BADGE: Record<string, { bg: string; text: string }> = {
  global: { bg: 'rgba(91,141,184,0.12)', text: 'var(--color-accent-blue, #5B8DB8)' },
  project: { bg: 'rgba(145,120,181,0.12)', text: 'var(--color-status-planning, #9178B5)' },
  enterprise: { bg: 'rgba(200,134,58,0.12)', text: 'var(--color-status-verifying, #C8863A)' },
  codex: { bg: 'rgba(90,158,120,0.12)', text: 'var(--color-status-completed, #5A9E78)' },
};

const TRANSPORT_BADGE: Record<string, { bg: string; text: string }> = {
  stdio: { bg: 'rgba(91,141,184,0.08)', text: 'var(--color-accent-blue, #5B8DB8)' },
  http: { bg: 'rgba(145,120,181,0.08)', text: 'var(--color-status-planning, #9178B5)' },
};

export function McpCardsView() {
  const allServers = useMcpStore((s) => s.servers);
  const scopeFilter = useMcpStore((s) => s.scopeFilter);
  const search = useMcpStore((s) => s.search);
  const selectedServer = useMcpStore((s) => s.selectedServer);
  const setSelectedServer = useMcpStore((s) => s.setSelectedServer);
  const toggleServer = useMcpStore((s) => s.toggleServer);

  const filteredServers = useMemo(() => {
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

  // Group by scope (project scope gets sub-grouped by workspace)
  const groups = useMemo<ScopeGroup[]>(() => {
    const map = new Map<string, McpServerEntry[]>();
    for (const srv of filteredServers) {
      const list = map.get(srv.scope) ?? [];
      list.push(srv);
      map.set(srv.scope, list);
    }
    const result: ScopeGroup[] = [];
    for (const scope of ['global', 'project', 'enterprise', 'codex']) {
      const list = map.get(scope);
      if (list && list.length > 0) {
        const meta = SCOPE_META[scope] ?? { label: scope, color: 'var(--color-text-tertiary)' };
        const group: ScopeGroup = { scope, label: meta.label, color: meta.color, servers: list };

        // Sub-group project-scope servers by workspace path
        if (scope === 'project') {
          const subMap = new Map<string, McpServerEntry[]>();
          for (const srv of list) {
            const key = srv.projectPath ?? '__unknown__';
            const sub = subMap.get(key) ?? [];
            sub.push(srv);
            subMap.set(key, sub);
          }
          group.projectSubGroups = [];
          for (const [projectPath, svrs] of subMap) {
            group.projectSubGroups.push({
              projectPath,
              folderName: basename(projectPath),
              servers: svrs,
            });
          }
        }

        result.push(group);
      }
    }
    return result;
  }, [filteredServers]);

  function handleToggle(srv: McpServerEntry) {
    void toggleServer(srv.projectPath ?? '', srv.name, !srv.enabled);
  }

  if (filteredServers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-[length:var(--font-size-sm)]">
        No servers found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {groups.map((group, gi) => (
        <motion.div
          key={group.scope}
          className="mb-5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: gi * 0.06 }}
        >
          {/* Scope header */}
          <div className="flex items-center gap-2 mb-[10px] pb-[6px] border-b border-border-divider">
            <span className="w-2 h-2 rounded-full" style={{ background: group.color }} />
            <span className="text-[12px] font-bold text-text-primary">{group.label}</span>
            <span className="text-[10px] text-text-tertiary font-mono">
              {group.servers.length} server{group.servers.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Card grid -- project scope uses sub-groups, others render directly */}
          {group.projectSubGroups ? (
            <div className="flex flex-col gap-[14px]">
              {group.projectSubGroups.map((sub) => (
                <div key={sub.projectPath}>
                  {/* Sub-group header */}
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <FolderOpen
                      size={13}
                      strokeWidth={1.8}
                      style={{ color: 'var(--color-status-planning, #9178B5)', opacity: 0.7 }}
                    />
                    <span
                      className="text-[11px] font-bold text-text-secondary"
                      title={sub.projectPath}
                    >
                      {sub.folderName}
                    </span>
                    <span className="text-[9px] font-mono text-text-tertiary opacity-60">
                      {sub.servers.length}
                    </span>
                  </div>
                  {/* Sub-group card grid */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[10px]">
                    {sub.servers.map((srv, si) => (
                      <ServerCard
                        key={srv.id}
                        server={srv}
                        selected={selectedServer === srv.id}
                        isEnterprise={false}
                        delay={si * 0.04}
                        onSelect={() => setSelectedServer(selectedServer === srv.id ? null : srv.id)}
                        onToggle={() => handleToggle(srv)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[10px]">
              {group.servers.map((srv, si) => (
                <ServerCard
                  key={srv.id}
                  server={srv}
                  selected={selectedServer === srv.id}
                  isEnterprise={group.scope === 'enterprise'}
                  delay={si * 0.04}
                  onSelect={() => setSelectedServer(selectedServer === srv.id ? null : srv.id)}
                  onToggle={() => handleToggle(srv)}
                />
              ))}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server card
// ---------------------------------------------------------------------------

function ServerCard({
  server,
  selected,
  isEnterprise,
  delay,
  onSelect,
  onToggle,
}: {
  server: McpServerEntry;
  selected: boolean;
  isEnterprise: boolean;
  delay: number;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const scopeStyle = SCOPE_BADGE[server.scope] ?? SCOPE_BADGE.global;
  const transportStyle = TRANSPORT_BADGE[server.transport] ?? TRANSPORT_BADGE.stdio;

  const commandText = server.command
    ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`
    : server.url ?? '';

  const envKeys = server.env ? Object.keys(server.env) : [];

  const missingClaude = !server.cli.claude && server.cli.codex;
  const missingCodex = server.cli.claude && !server.cli.codex;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      onClick={onSelect}
      className={[
        'bg-bg-card border rounded-[10px] p-[14px] cursor-pointer transition-all duration-200 flex flex-col gap-2',
        selected
          ? 'border-[var(--color-status-planning,#9178B5)] shadow-[0_0_0_2px_rgba(145,120,181,0.2)]'
          : 'border-border hover:border-text-tertiary hover:shadow-md hover:-translate-y-[2px]',
      ].join(' ')}
      style={isEnterprise ? {
        borderColor: 'rgba(200,134,58,0.3)',
        background: 'rgba(200,134,58,0.04)',
      } : undefined}
    >
      {/* Top: icon + info + toggle */}
      <div className="flex items-center gap-[10px]">
        <div
          className="w-9 h-9 rounded-[var(--radius-lg)] shrink-0 flex items-center justify-center"
          style={{
            background: server.transport === 'stdio' ? 'rgba(91,141,184,0.08)' : 'rgba(145,120,181,0.08)',
            color: server.transport === 'stdio' ? 'var(--color-accent-blue, #5B8DB8)' : 'var(--color-status-planning, #9178B5)',
          }}
        >
          {server.transport === 'stdio' ? (
            <Terminal size={18} strokeWidth={1.8} />
          ) : (
            <Globe size={18} strokeWidth={1.8} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-text-primary truncate">{server.name}</div>
          <div className="flex gap-[5px] mt-[3px]">
            <span
              className="text-[9px] font-bold px-[7px] py-[2px] rounded-[4px] uppercase tracking-[0.03em] font-mono"
              style={{ background: scopeStyle.bg, color: scopeStyle.text }}
            >
              {server.scope}
            </span>
            <span
              className="text-[9px] font-semibold px-[7px] py-[2px] rounded-[4px] uppercase"
              style={{ background: transportStyle.bg, color: transportStyle.text }}
            >
              {server.transport}
            </span>
          </div>
        </div>
        <label
          className="relative inline-block w-8 h-[18px] shrink-0 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={onToggle}
            disabled={isEnterprise}
            className="sr-only"
          />
          <div
            className={[
              'w-8 h-[18px] rounded-full transition-colors duration-200 relative',
              isEnterprise ? 'opacity-50 cursor-default' : '',
            ].join(' ')}
            style={{ background: server.enabled ? 'var(--color-status-completed, #5A9E78)' : 'var(--color-border, #E8E5DE)' }}
          >
            <div
              className="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200"
              style={{ transform: server.enabled ? 'translateX(14px)' : 'translateX(0)' }}
            />
          </div>
        </label>
      </div>

      {/* Command line */}
      {commandText && (
        <div
          className="font-mono text-[10px] text-text-secondary bg-bg-secondary rounded-[var(--radius-md)] px-[10px] py-[6px] whitespace-nowrap overflow-hidden text-ellipsis"
          style={isEnterprise ? { background: 'rgba(200,134,58,0.08)' } : undefined}
        >
          {isEnterprise ? 'managed (read-only)' : commandText}
        </div>
      )}

      {/* Footer: env tags + CLI badges / actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
          {envKeys.map((key) => (
            <span
              key={key}
              className="text-[9px] font-mono px-[6px] py-[2px] rounded-[4px]"
              style={{ background: 'rgba(91,141,184,0.08)', color: 'var(--color-accent-blue, #5B8DB8)' }}
            >
              {key}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px] shrink-0 items-center">
          {/* Copy to other CLI */}
          {(missingCodex || missingClaude) && (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-[3px] px-[7px] py-[3px] rounded-[4px] border border-border bg-bg-card text-[8px] font-bold text-text-tertiary font-mono transition-all hover:border-[var(--color-accent-blue,#5B8DB8)] hover:text-[var(--color-accent-blue,#5B8DB8)] hover:bg-[rgba(91,141,184,0.04)]"
              title={missingCodex ? 'Copy to Codex' : 'Copy to Claude'}
            >
              {missingCodex ? (
                <>
                  <ChevronRight size={9} strokeWidth={2.5} />X
                </>
              ) : (
                <>
                  <ChevronLeft size={9} strokeWidth={2.5} />C
                </>
              )}
            </button>
          )}

          {/* CLI badges (when both present) */}
          {server.cli.claude && server.cli.codex && (
            <div className="flex gap-[3px]">
              <span
                className="w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none"
                style={{ background: 'rgba(200,134,58,0.08)', color: 'var(--color-status-verifying, #C8863A)' }}
              >
                C
              </span>
              <span
                className="w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none"
                style={{ background: 'rgba(90,158,120,0.08)', color: 'var(--color-status-completed, #5A9E78)' }}
              >
                X
              </span>
            </div>
          )}

          {/* Single CLI badge when only one present and no missing (e.g., enterprise) */}
          {!missingCodex && !missingClaude && !(server.cli.claude && server.cli.codex) && (
            <div className="flex gap-[3px]">
              <span
                className={[
                  'w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none',
                  !server.cli.claude ? 'opacity-25' : '',
                ].join(' ')}
                style={{ background: 'rgba(200,134,58,0.08)', color: 'var(--color-status-verifying, #C8863A)' }}
              >
                C
              </span>
              <span
                className={[
                  'w-5 h-4 rounded-[3px] flex items-center justify-center text-[8px] font-extrabold font-mono leading-none',
                  !server.cli.codex ? 'opacity-25' : '',
                ].join(' ')}
                style={{ background: 'rgba(90,158,120,0.08)', color: 'var(--color-status-completed, #5A9E78)' }}
              >
                X
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
