import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';
import type { MaestroConfig, HooksConfig } from '../types/index.js';

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

const DEFAULT_HOOKS: HooksConfig = {
  toggles: {},
  external: [],
  plugins: [],
};

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
    ...(globalHooks?.toggles ?? {}),
    ...(projectHooks?.toggles ?? {}),
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
      merged.toggles[name] = false;
    }
  }

  const enable = process.env.MAESTRO_HOOKS_ENABLE;
  if (enable) {
    for (const name of enable.split(',').map((s) => s.trim()).filter(Boolean)) {
      merged.toggles[name] = true;
    }
  }

  // 5. Return with defaults for any missing fields
  return {
    toggles: merged.toggles ?? DEFAULT_HOOKS.toggles,
    external: merged.external ?? DEFAULT_HOOKS.external,
    plugins: merged.plugins ?? DEFAULT_HOOKS.plugins,
  };
}
