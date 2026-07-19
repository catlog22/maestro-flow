import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { paths } from './paths.js';
import type { MaestroConfig, HooksConfig, SpecInjectionConfig, SpecAnalyticsConfig, WorkspaceConfig, WorkspaceLink } from '../types/index.js';

const DEFAULT_CONFIG: MaestroConfig = {
  version: '0.1.0',
  extensions: [],
  mcp: {
    port: 3600,
    host: 'localhost',
    enabledTools: ['all'],
  },
  workflows: {
    templatesDir: 'templates',
    workflowsDir: 'workflows',
  },
  hooks: {
    toggles: { telemetry: true, workflowGuard: false, promptGuard: false },
    external: [],
    plugins: [],
  },
};

export function loadConfig(): MaestroConfig {
  if (!existsSync(paths.config)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(paths.config, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: MaestroConfig): void {
  paths.ensure(paths.home);
  writeFileSync(paths.config, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Spec Injection Config — project-level (.workflow/config.json)
// ---------------------------------------------------------------------------

export function loadSpecInjectionConfig(projectPath: string): SpecInjectionConfig {
  const configPath = join(projectPath, '.workflow', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return (raw.specInjection as SpecInjectionConfig) ?? {};
  } catch {
    return {};
  }
}

export function saveSpecInjectionConfig(projectPath: string, config: SpecInjectionConfig): void {
  const configPath = join(projectPath, '.workflow', 'config.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // Start fresh
  }
  existing['specInjection'] = config;
  writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Spec Analytics Config — nested under specInjection.analytics
// ---------------------------------------------------------------------------

export function loadAnalyticsConfig(projectPath: string): SpecAnalyticsConfig {
  const injConfig = loadSpecInjectionConfig(projectPath);
  return injConfig.analytics ?? { enabled: true };
}

export function saveAnalyticsConfig(projectPath: string, config: SpecAnalyticsConfig): void {
  const injConfig = loadSpecInjectionConfig(projectPath);
  injConfig.analytics = config;
  saveSpecInjectionConfig(projectPath, injConfig);
}

// ---------------------------------------------------------------------------
// Workspace Config — project-level (.workflow/config.json)
// ---------------------------------------------------------------------------

export interface ResolvedWorkspaceLink extends WorkspaceLink {
  resolvedPath: string;
  workflowRoot: string;
  valid: boolean;
}

export function loadWorkspaceConfig(projectPath: string): WorkspaceConfig {
  const configPath = join(projectPath, '.workflow', 'config.json');
  if (!existsSync(configPath)) return { linked: [] };
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const ws = raw.workspaces as WorkspaceConfig | undefined;
    return ws && Array.isArray(ws.linked) ? ws : { linked: [] };
  } catch {
    return { linked: [] };
  }
}

export function saveWorkspaceConfig(projectPath: string, config: WorkspaceConfig): void {
  const configPath = join(projectPath, '.workflow', 'config.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // Start fresh
  }
  existing['workspaces'] = config;
  paths.ensure(join(projectPath, '.workflow'));
  writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export function resolveWorkspaceLinks(projectPath: string, config: WorkspaceConfig): ResolvedWorkspaceLink[] {
  return config.linked.map(link => {
    const resolvedPath = resolve(projectPath, link.path);
    const workflowRoot = join(resolvedPath, '.workflow');
    const valid = existsSync(workflowRoot);
    return { ...link, resolvedPath, workflowRoot, valid };
  });
}

// ---------------------------------------------------------------------------
// Hooks Config
// ---------------------------------------------------------------------------

const DEFAULT_HOOKS: HooksConfig = {
  toggles: {},
  external: [],
  plugins: [],
};

/** Convert user-facing hook names to the canonical config key used by runners. */
export function normalizeHookToggleKey(name: string): string {
  return name.trim().replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Normalize persisted aliases while giving an explicitly canonical key
 * precedence when both forms are present.
 */
export function normalizeHookToggles(
  toggles: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const normalized: Record<string, boolean> = {};
  const entries = Object.entries(toggles ?? {});
  for (const [name, enabled] of entries) {
    normalized[normalizeHookToggleKey(name)] = enabled;
  }
  for (const [name, enabled] of entries) {
    if (name === normalizeHookToggleKey(name)) normalized[name] = enabled;
  }
  return normalized;
}

function readHooksFromFile(filePath: string): Partial<HooksConfig> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return raw.hooks as Partial<HooksConfig> | undefined;
  } catch {
    return undefined;
  }
}

export function loadHooksConfig(): HooksConfig {
  // 1. Read global config hooks
  const globalHooks = readHooksFromFile(paths.config);

  // 2. Read project config hooks
  const projectConfigPath = join(process.cwd(), '.maestro', 'config.json');
  const projectHooks = readHooksFromFile(projectConfigPath);

  // 3. Merge: project overrides global; arrays concatenated
  const toggles = {
    ...normalizeHookToggles(globalHooks?.toggles),
    ...normalizeHookToggles(projectHooks?.toggles),
  };
  const external = [
    ...(globalHooks?.external ?? []),
    ...(projectHooks?.external ?? []),
  ];
  const plugins = [
    ...(globalHooks?.plugins ?? []),
    ...(projectHooks?.plugins ?? []),
  ];

  const merged: HooksConfig = { toggles, external, plugins };

  // 4. Apply env var overrides
  const disable = process.env.MAESTRO_HOOKS_DISABLE;
  if (disable) {
    for (const name of disable.split(',').map((s) => s.trim()).filter(Boolean)) {
      merged.toggles[normalizeHookToggleKey(name)] = false;
    }
  }

  const enable = process.env.MAESTRO_HOOKS_ENABLE;
  if (enable) {
    for (const name of enable.split(',').map((s) => s.trim()).filter(Boolean)) {
      merged.toggles[normalizeHookToggleKey(name)] = true;
    }
  }

  // 5. Return with defaults for any missing fields
  return {
    toggles: merged.toggles ?? DEFAULT_HOOKS.toggles,
    external: merged.external ?? DEFAULT_HOOKS.external,
    plugins: merged.plugins ?? DEFAULT_HOOKS.plugins,
  };
}
