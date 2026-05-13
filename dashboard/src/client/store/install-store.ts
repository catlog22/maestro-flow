import { create } from 'zustand';
import { INSTALL_API_ENDPOINTS } from '@/shared/constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentInfo {
  id: string;
  label: string;
  sourceDir: string;
  targetDir: string;
  fileCount: number;
  available: boolean;
}

export interface DisabledItem {
  name: string;
  relativePath: string;
  type: 'skill' | 'command' | 'agent';
}

export interface ManifestInfo {
  id: string;
  scope: 'global' | 'project';
  targetPath: string;
  installedAt: string;
  version: string;
}

export interface AddonInfo {
  id: string;
  name: string;
  description: string;
  repo: string;
  homepage?: string;
  tags?: string[];
  /** Per-harness install status: { claude: true, codex: false } */
  harnesses: Record<string, boolean>;
  /** True if any harness is installed */
  installed: boolean;
}

export interface DetectionResult {
  sourceDir: string;
  components: ComponentInfo[];
  existingManifest: ManifestInfo | null;
  disabledItems: DisabledItem[];
}

export interface InstallResult {
  success: boolean;
  filesInstalled: number;
  dirsCreated: number;
  manifestPath: string;
  disabledItemsRestored: number;
  mcpRegistered: boolean;
  components: string[];
  error?: string;
  migrationWarnings?: string[];
}

export type WizardStep = 'mode' | 'configure' | 'review' | 'progress';

const MCP_TOOLS = [
  'write_file',
  'edit_file',
  'read_file',
  'read_many_files',
  'team_msg',
] as const;

export { MCP_TOOLS };

export interface InstallStore {
  open: boolean;
  step: WizardStep;
  mode: 'global' | 'project';
  projectPath: string;
  detection: DetectionResult | null;
  selectedComponents: Set<string>;
  backup: boolean;
  mcpEnabled: boolean;
  enabledTools: Set<string>;
  detecting: boolean;
  installing: boolean;
  result: InstallResult | null;
  error: string | null;
  manifests: ManifestInfo[];
  addons: AddonInfo[];
  addonInstalling: string | null;

  setOpen: (open: boolean) => void;
  setStep: (step: WizardStep) => void;
  setMode: (mode: 'global' | 'project') => void;
  setProjectPath: (path: string) => void;
  toggleComponent: (id: string) => void;
  selectAllComponents: () => void;
  setBackup: (backup: boolean) => void;
  setMcpEnabled: (enabled: boolean) => void;
  toggleTool: (tool: string) => void;
  detect: () => Promise<void>;
  install: () => Promise<void>;
  fetchManifests: () => Promise<void>;
  fetchAddons: () => Promise<void>;
  installAddon: (addonId: string, harnesses?: string[]) => Promise<void>;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useInstallStore = create<InstallStore>((set, get) => ({
  open: false,
  step: 'mode',
  mode: 'global',
  projectPath: '',
  detection: null,
  selectedComponents: new Set<string>(),
  backup: true,
  mcpEnabled: true,
  enabledTools: new Set(MCP_TOOLS),
  detecting: false,
  installing: false,
  result: null,
  error: null,
  manifests: [],
  addons: [],
  addonInstalling: null,

  setOpen: (open) => {
    if (open) {
      set({ open, step: 'mode', result: null, error: null, detection: null });
    } else {
      set({ open });
    }
  },

  setStep: (step) => set({ step }),
  setMode: (mode) => set({ mode }),
  setProjectPath: (path) => set({ projectPath: path }),

  toggleComponent: (id) =>
    set((s) => {
      const next = new Set(s.selectedComponents);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedComponents: next };
    }),

  selectAllComponents: () =>
    set((s) => {
      if (!s.detection) return {};
      const all = s.detection.components.filter((c) => c.available).map((c) => c.id);
      if (s.selectedComponents.has('mcp')) all.push('mcp');
      return { selectedComponents: new Set(all) };
    }),

  setBackup: (backup) => set({ backup }),
  setMcpEnabled: (enabled) => set({ mcpEnabled: enabled }),

  toggleTool: (tool) =>
    set((s) => {
      const next = new Set(s.enabledTools);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return { enabledTools: next };
    }),

  detect: async () => {
    const { mode, projectPath } = get();
    set({ detecting: true, error: null });
    try {
      const res = await fetch(INSTALL_API_ENDPOINTS.DETECT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, projectPath: mode === 'project' ? projectPath : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const detection = data as DetectionResult;
      const available = detection.components.filter((c) => c.available).map((c) => c.id);
      // Include 'mcp' by default
      available.push('mcp');
      set({
        detecting: false,
        detection,
        selectedComponents: new Set(available),
        step: 'configure',
      });
      // Also fetch available addons
      get().fetchAddons();
    } catch (err) {
      set({ detecting: false, error: String(err) });
    }
  },

  install: async () => {
    const { mode, projectPath, selectedComponents, backup, mcpEnabled, enabledTools } = get();
    set({ installing: true, error: null, step: 'progress' });
    try {
      const res = await fetch(INSTALL_API_ENDPOINTS.EXECUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          projectPath: mode === 'project' ? projectPath : undefined,
          components: Array.from(selectedComponents),
          backup,
          mcpConfig: mcpEnabled && selectedComponents.has('mcp')
            ? { enabled: true, enabledTools: Array.from(enabledTools) }
            : undefined,
        }),
      });
      const result = (await res.json()) as InstallResult;
      set({ installing: false, result });
    } catch (err) {
      set({
        installing: false,
        result: {
          success: false,
          filesInstalled: 0,
          dirsCreated: 0,
          manifestPath: '',
          disabledItemsRestored: 0,
          mcpRegistered: false,
          components: [],
          error: String(err),
        },
      });
    }
  },

  fetchManifests: async () => {
    try {
      const res = await fetch(INSTALL_API_ENDPOINTS.MANIFESTS);
      if (!res.ok) return;
      const data = (await res.json()) as { manifests: ManifestInfo[] };
      set({ manifests: data.manifests ?? [] });
    } catch {
      // non-critical
    }
  },

  fetchAddons: async () => {
    const { mode, projectPath } = get();
    try {
      const params = new URLSearchParams({ mode });
      if (mode === 'project' && projectPath) params.set('projectPath', projectPath);
      const res = await fetch(`${INSTALL_API_ENDPOINTS.ADDONS}?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as { addons: AddonInfo[] };
      set({ addons: data.addons ?? [] });
    } catch {
      // non-critical
    }
  },

  installAddon: async (addonId: string, harnesses?: string[]) => {
    const { mode, projectPath } = get();
    set({ addonInstalling: addonId });
    try {
      const res = await fetch(INSTALL_API_ENDPOINTS.ADDON_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addonId,
          mode,
          projectPath: mode === 'project' ? projectPath : undefined,
          harnesses,
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (data.success) {
        // Refresh addons list to update installed status
        await get().fetchAddons();
      }
      set({ addonInstalling: null });
    } catch {
      set({ addonInstalling: null });
    }
  },

  reset: () =>
    set({
      step: 'mode',
      mode: 'global',
      projectPath: '',
      detection: null,
      selectedComponents: new Set<string>(),
      backup: true,
      mcpEnabled: true,
      enabledTools: new Set(MCP_TOOLS),
      detecting: false,
      installing: false,
      result: null,
      error: null,
      addons: [],
      addonInstalling: null,
    }),
}));
