import { create } from 'zustand';
import type { AgentType } from '@/shared/agent-types.js';
import type { CommanderConfig, CommanderSafetyConfig } from '@/shared/commander-types.js';
import { DEFAULT_COMMANDER_CONFIG } from '@/shared/commander-types.js';
import type { WorkspacePolicy } from '@/shared/execution-types.js';

// ---------------------------------------------------------------------------
// Settings store — draft editing with dirty detection
// ---------------------------------------------------------------------------

/** Per-agent-type configuration */
export interface AgentSettingsEntry {
  model: string;
  approvalMode: 'suggest' | 'auto';
  baseUrl?: string;
  apiKey?: string;
  settingsFile?: string;
  envFile?: string;
}

/** General dashboard settings */
export interface GeneralSettings {
  theme: 'system' | 'dark' | 'light';
  language: 'en' | 'zh-CN';
  /** Navigation paths hidden from dock rail and sidebar */
  hiddenNavItems?: string[];
}

/** Linear integration settings */
export interface LinearSettings {
  apiKey: string;
}

/** Chinese response status */
export interface ChineseResponseStatus {
  claudeEnabled: boolean;
  codexEnabled: boolean;
  codexNeedsMigration: boolean;
  guidelinesExists: boolean;
}

/** Full settings config */
export interface SettingsConfig {
  general: GeneralSettings;
  agents: Record<AgentType, AgentSettingsEntry>;
  cliTools: string; // raw JSON string of cli-tools.json
  linear: LinearSettings;
  searchTool: string; // MCP semantic search tool name
  commander: CommanderConfig;
}

/** Section type union */
export type SettingsSectionType = 'general' | 'agents' | 'cli-tools' | 'specs' | 'linear' | 'kanban' | 'commander';

export interface SettingsStore {
  open: boolean;
  activeSection: SettingsSectionType;
  config: SettingsConfig | null;
  draft: SettingsConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  chineseResponse: ChineseResponseStatus | null;

  setOpen: (open: boolean) => void;
  setActiveSection: (section: SettingsSectionType) => void;
  loadConfig: () => Promise<void>;
  updateDraft: (section: keyof SettingsConfig, value: unknown) => void;
  saveConfig: (section: keyof SettingsConfig) => Promise<void>;
  discardDraft: (section: keyof SettingsConfig) => void;
  isDirty: (section: keyof SettingsConfig) => boolean;
  loadChineseResponse: () => Promise<void>;
  toggleChineseResponse: (enabled: boolean, target: 'claude' | 'codex') => Promise<void>;
}

const DEFAULT_AGENTS: Record<AgentType, AgentSettingsEntry> = {
  'claude-code': { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  codex: { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  'codex-server': { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  gemini: { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  'gemini-a2a': { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  qwen: { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  opencode: { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  agy: { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  'agent-sdk': { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
  'api-explore': { model: '', approvalMode: 'suggest', baseUrl: '', apiKey: '', settingsFile: '', envFile: '' },
};

const DEFAULT_CONFIG: SettingsConfig = {
  general: { theme: 'system', language: 'en', hiddenNavItems: ['/maestro-coordinate', '/requirement', '/rooms'] },
  agents: DEFAULT_AGENTS,
  cliTools: '{}',
  linear: { apiKey: '' },
  searchTool: 'mcp__ace-tool__search_context',
  commander: DEFAULT_COMMANDER_CONFIG,
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  open: false,
  activeSection: 'general',
  config: null,
  draft: null,
  loading: false,
  saving: false,
  error: null,
  chineseResponse: null,

  setOpen: (open) => {
    set({ open });
    if (open && !get().config) {
      void get().loadConfig();
    }
  },

  setActiveSection: (section) => set({ activeSection: section }),

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
      const data = (await res.json()) as Partial<SettingsConfig>;
      const mergedAgents = Object.fromEntries(
        Object.entries(DEFAULT_AGENTS).map(([key, defaults]) => [
          key,
          { ...defaults, ...((data.agents as Record<string, AgentSettingsEntry>)?.[key] || {}) },
        ]),
      ) as Record<AgentType, AgentSettingsEntry>;
      const searchTool = typeof data.searchTool === 'string' ? data.searchTool : DEFAULT_CONFIG.searchTool;
      // Deep merge commander (safety & workspace sub-objects)
      const rawCommander = data.commander as Partial<CommanderConfig> | undefined;
      const commander: CommanderConfig = {
        ...DEFAULT_COMMANDER_CONFIG,
        ...rawCommander,
        safety: { ...DEFAULT_COMMANDER_CONFIG.safety, ...rawCommander?.safety } as CommanderSafetyConfig,
        workspace: { ...DEFAULT_COMMANDER_CONFIG.workspace, ...rawCommander?.workspace } as WorkspacePolicy,
      };
      const general: GeneralSettings = { ...DEFAULT_CONFIG.general, ...(data.general as Partial<GeneralSettings>) };
      const config: SettingsConfig = { ...DEFAULT_CONFIG, ...data, general, agents: mergedAgents, searchTool, commander };
      set({ config, draft: deepClone(config), loading: false });
    } catch (err) {
      const config = deepClone(DEFAULT_CONFIG);
      set({ config, draft: deepClone(config), loading: false, error: String(err) });
    }
  },

  updateDraft: (section, value) => {
    const { draft } = get();
    if (!draft) return;
    set({
      draft: { ...draft, [section]: value },
    });
  },

  saveConfig: async (section) => {
    const { draft } = get();
    if (!draft) return;
    set({ saving: true, error: null });
    try {
      const endpoint =
        section === 'cliTools'
          ? '/api/settings/cli-tools'
          : section === 'searchTool'
            ? '/api/settings/search-tool'
            : `/api/settings/${section}`;
      const body = section === 'searchTool' ? { name: draft[section] } : draft[section];
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof body === 'string' ? { content: body } : body),
      });
      if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
      // Update config to match draft for this section
      const { config } = get();
      if (config) {
        const updated = { ...config, [section]: deepClone(draft[section]) };
        set({ config: updated, saving: false });
      } else {
        set({ saving: false });
      }
    } catch (err) {
      set({ saving: false, error: String(err) });
    }
  },

  discardDraft: (section) => {
    const { config, draft } = get();
    if (!config || !draft) return;
    set({ draft: { ...draft, [section]: deepClone(config[section]) } });
  },

  isDirty: (section) => {
    const { config, draft } = get();
    if (!config || !draft) return false;
    return JSON.stringify(config[section]) !== JSON.stringify(draft[section]);
  },

  loadChineseResponse: async () => {
    try {
      const res = await fetch('/api/language/chinese-response');
      if (!res.ok) return;
      const data = (await res.json()) as ChineseResponseStatus;
      set({ chineseResponse: data });
    } catch {
      // Silently fail
    }
  },

  toggleChineseResponse: async (enabled, target) => {
    try {
      const res = await fetch('/api/language/chinese-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, target }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      // Reload status after toggle
      await get().loadChineseResponse();
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
