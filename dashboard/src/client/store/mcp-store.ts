import { create } from 'zustand';
import { MCP_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerEntry {
  id: string;
  name: string;
  scope: 'global' | 'project' | 'enterprise' | 'codex';
  projectPath?: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cli: { claude: boolean; codex: boolean };
  raw: Record<string, unknown>;
}

export interface ProjectGroup {
  projectPath: string | null;
  servers: McpServerEntry[];
}

export interface McpTemplate {
  id: number;
  name: string;
  description?: string;
  serverConfig: { command: string; args?: string[]; env?: Record<string, string> };
  tags?: string[];
  category?: string;
  createdAt: number;
  updatedAt: number;
}

type ScopeFilter = 'all' | 'global' | 'project' | 'enterprise' | 'codex';
type McpView = 'list' | 'cards' | 'templates';

export interface McpStore {
  servers: McpServerEntry[];
  templates: McpTemplate[];
  categories: string[];
  loading: boolean;
  error: string | null;
  activeView: McpView;
  scopeFilter: ScopeFilter;
  search: string;
  selectedServer: string | null;
  templateSearch: string;
  templateCategory: string | null;

  setActiveView: (view: McpView) => void;
  setScopeFilter: (filter: ScopeFilter) => void;
  setSearch: (q: string) => void;
  setSelectedServer: (id: string | null) => void;
  setTemplateSearch: (q: string) => void;
  setTemplateCategory: (cat: string | null) => void;

  fetchConfig: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  toggleServer: (projectPath: string, serverName: string, enable: boolean) => Promise<void>;
  removeServer: (projectPath: string, serverName: string) => Promise<void>;
  addGlobalServer: (name: string, config: unknown) => Promise<void>;
  removeGlobalServer: (name: string) => Promise<void>;
  installTemplate: (templateName: string, projectPath?: string, scope?: string) => Promise<void>;

  // Derived getters
  filteredServers: () => McpServerEntry[];
  filteredTemplates: () => McpTemplate[];
  projectGroups: () => ProjectGroup[];
  selectedEntry: () => McpServerEntry | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeServerId(
  scope: McpServerEntry['scope'],
  name: string,
  projectPath?: string,
): string {
  if (scope === 'project' && projectPath) {
    return `project:${name}@${projectPath}`;
  }
  return `${scope}:${name}`;
}

function normalizeServers(data: Record<string, unknown>): McpServerEntry[] {
  const servers: McpServerEntry[] = [];
  const globalServers = (data.globalServers ?? {}) as Record<string, Record<string, unknown>>;
  const projects = (data.projects ?? {}) as Record<string, Record<string, unknown>>;
  const enterpriseServers = (data.enterpriseServers ?? {}) as Record<string, Record<string, unknown>>;
  const codex = data.codex as { servers?: Record<string, Record<string, unknown>> } | undefined;

  // Global
  for (const [name, cfg] of Object.entries(globalServers)) {
    servers.push(makeEntry(name, cfg, 'global'));
  }

  // Project -- each project gets its own isolated entries (no dedup against global)
  for (const [projPath, projCfg] of Object.entries(projects)) {
    const mcpServers = (projCfg.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
    const disabled = (projCfg.disabledMcpServers ?? []) as string[];
    for (const [name, cfg] of Object.entries(mcpServers)) {
      servers.push({
        ...makeEntry(name, cfg, 'project', projPath),
        enabled: !disabled.includes(name),
      });
    }
  }

  // Enterprise
  for (const [name, cfg] of Object.entries(enterpriseServers)) {
    servers.push({ ...makeEntry(name, cfg, 'enterprise'), enabled: true });
  }

  // Codex
  if (codex?.servers) {
    for (const [name, cfg] of Object.entries(codex.servers)) {
      const existing = servers.find((s) => s.name === name && s.scope === 'global');
      if (existing) {
        existing.cli.codex = true;
      } else {
        servers.push({ ...makeEntry(name, cfg, 'codex'), cli: { claude: false, codex: true } });
      }
    }
  }

  return servers;
}

function makeEntry(
  name: string,
  cfg: Record<string, unknown>,
  scope: McpServerEntry['scope'],
  projectPath?: string,
): McpServerEntry {
  const hasUrl = typeof cfg.url === 'string';
  const id = makeServerId(scope, name, projectPath);
  return {
    id,
    name,
    scope,
    projectPath,
    enabled: cfg.enabled !== false,
    transport: hasUrl ? 'http' : 'stdio',
    command: typeof cfg.command === 'string' ? cfg.command : undefined,
    args: Array.isArray(cfg.args) ? cfg.args as string[] : undefined,
    url: hasUrl ? cfg.url as string : undefined,
    env: (typeof cfg.env === 'object' && cfg.env !== null) ? cfg.env as Record<string, string> : undefined,
    cli: { claude: scope !== 'codex', codex: scope === 'codex' },
    raw: cfg,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  templates: [],
  categories: [],
  loading: false,
  error: null,
  activeView: 'list',
  scopeFilter: 'all',
  search: '',
  selectedServer: null,
  templateSearch: '',
  templateCategory: null,

  setActiveView: (view) => set({ activeView: view }),
  setScopeFilter: (filter) => set({ scopeFilter: filter }),
  setSearch: (q) => set({ search: q }),
  setSelectedServer: (id) => set({ selectedServer: id }),
  setTemplateSearch: (q) => set({ templateSearch: q }),
  setTemplateCategory: (cat) => set({ templateCategory: cat }),

  fetchConfig: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(MCP_API_ENDPOINTS.CONFIG);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      set({ servers: normalizeServers(data), loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  fetchTemplates: async () => {
    try {
      const [tplRes, catRes] = await Promise.all([
        fetch(MCP_API_ENDPOINTS.TEMPLATES),
        fetch(MCP_API_ENDPOINTS.TEMPLATES_CATEGORIES),
      ]);
      if (!tplRes.ok || !catRes.ok) return;
      const tplData = (await tplRes.json()) as { templates: McpTemplate[] };
      const catData = (await catRes.json()) as { categories: string[] };
      set({ templates: tplData.templates ?? [], categories: catData.categories ?? [] });
    } catch {
      // Non-critical
    }
  },

  toggleServer: async (projectPath, serverName, enable) => {
    // Optimistic
    set((s) => ({
      servers: s.servers.map((srv) =>
        srv.name === serverName ? { ...srv, enabled: enable } : srv,
      ),
    }));
    try {
      await fetch(MCP_API_ENDPOINTS.TOGGLE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, serverName, enable }),
      });
    } catch {
      void get().fetchConfig();
    }
  },

  removeServer: async (projectPath, serverName) => {
    const prev = get().servers;
    set((s) => ({ servers: s.servers.filter((srv) => srv.name !== serverName) }));
    try {
      const res = await fetch(MCP_API_ENDPOINTS.REMOVE_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, serverName }),
      });
      if (!res.ok) set({ servers: prev });
    } catch {
      set({ servers: prev });
    }
  },

  addGlobalServer: async (name, config) => {
    try {
      await fetch(MCP_API_ENDPOINTS.ADD_GLOBAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: name, serverConfig: config }),
      });
      void get().fetchConfig();
    } catch {
      // ignore
    }
  },

  removeGlobalServer: async (name) => {
    const prev = get().servers;
    set((s) => ({ servers: s.servers.filter((srv) => srv.name !== name) }));
    try {
      const res = await fetch(MCP_API_ENDPOINTS.REMOVE_GLOBAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: name }),
      });
      if (!res.ok) set({ servers: prev });
    } catch {
      set({ servers: prev });
    }
  },

  installTemplate: async (templateName, projectPath, scope) => {
    try {
      await fetch(MCP_API_ENDPOINTS.TEMPLATES_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateName, projectPath, scope }),
      });
      void get().fetchConfig();
    } catch {
      // ignore
    }
  },

  filteredServers: () => {
    const { servers, scopeFilter, search } = get();
    let result = servers;
    if (scopeFilter !== 'all') result = result.filter((s) => s.scope === scopeFilter);
    if (search) {
      const lc = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(lc) ||
          (s.command?.toLowerCase().includes(lc) ?? false) ||
          (s.url?.toLowerCase().includes(lc) ?? false),
      );
    }
    return result;
  },

  filteredTemplates: () => {
    const { templates, templateSearch, templateCategory } = get();
    let result = templates;
    if (templateCategory) result = result.filter((t) => t.category === templateCategory);
    if (templateSearch) {
      const lc = templateSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(lc) ||
          (t.description?.toLowerCase().includes(lc) ?? false),
      );
    }
    return result;
  },

  projectGroups: () => {
    const { servers } = get();
    const map = new Map<string | null, McpServerEntry[]>();
    for (const srv of servers) {
      const key = srv.projectPath ?? null;
      const list = map.get(key) ?? [];
      list.push(srv);
      map.set(key, list);
    }
    const groups: ProjectGroup[] = [];
    for (const [projectPath, svrs] of map) {
      groups.push({ projectPath, servers: svrs });
    }
    return groups;
  },

  selectedEntry: () => {
    const { servers, selectedServer } = get();
    if (!selectedServer) return null;
    return servers.find((s) => s.id === selectedServer) ?? null;
  },
}));
