import { create } from 'zustand';
import type { AgentType } from '@/shared/agent-types.js';

// ---------------------------------------------------------------------------
// Settings store — draft editing with dirty detection
// ---------------------------------------------------------------------------

/** Per-agent-type configuration */
export interface AgentSettingsEntry {
  model: string;
  approvalMode: 'suggest' | 'auto';
}

/** General dashboard settings */
export interface GeneralSettings {
  theme: 'system' | 'dark' | 'light';
  language: 'en' | 'zh-CN';
}

/** Linear integration settings */
export interface LinearSettings {
  apiKey: string;
}

/** Full settings config */
export interface SettingsConfig {
  general: GeneralSettings;
  agents: Record<AgentType, AgentSettingsEntry>;
  cliTools: string; // raw JSON string of cli-tools.json
  linear: LinearSettings;
}

/** Section type union */
export type SettingsSectionType = 'general' | 'agents' | 'cli-tools' | 'specs' | 'linear' | 'kanban';

export interface SettingsStore {
  open: boolean;
  activeSection: SettingsSectionType;
  config: SettingsConfig | null;
  draft: SettingsConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;

  setOpen: (open: boolean) => void;
  setActiveSection: (section: SettingsSectionType) => void;
  loadConfig: () => Promise<void>;
  updateDraft: (section: keyof SettingsConfig, value: unknown) => void;
  saveConfig: (section: keyof SettingsConfig) => Promise<void>;
  discardDraft: (section: keyof SettingsConfig) => void;
  isDirty: (section: keyof SettingsConfig) => boolean;
}

const DEFAULT_AGENTS: Record<AgentType, AgentSettingsEntry> = {
  'claude-code': { model: '', approvalMode: 'suggest' },
  codex: { model: '', approvalMode: 'suggest' },
  'codex-server': { model: '', approvalMode: 'suggest' },
  gemini: { model: '', approvalMode: 'suggest' },
  qwen: { model: '', approvalMode: 'suggest' },
  opencode: { model: '', approvalMode: 'suggest' },
  'agent-sdk': { model: '', approvalMode: 'suggest' },
};

const DEFAULT_CONFIG: SettingsConfig = {
  general: { theme: 'system', language: 'en' },
  agents: DEFAULT_AGENTS,
  cliTools: '{}',
  linear: { apiKey: '' },
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
      const data = (await res.json()) as SettingsConfig;
      const config = { ...DEFAULT_CONFIG, ...data };
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
          : `/api/settings/${section}`;
      const body = draft[section];
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
}));
