// ---------------------------------------------------------------------------
// Commander configuration — 5-layer merge, profiles, env overrides
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

import type { CommanderConfig } from '../../shared/commander-types.js';
import { DEFAULT_COMMANDER_CONFIG } from '../../shared/commander-types.js';

// ---------------------------------------------------------------------------
// Environment profiles — preset overrides for different environments
// ---------------------------------------------------------------------------

export const PROFILES: Record<string, Partial<CommanderConfig>> = {
  development: {
    pollIntervalMs: 15_000,
    autoApproveThreshold: 'medium',
    decisionModel: 'haiku',
    maxConcurrentWorkers: 2,
    safety: {
      eventDebounceMs: 3_000,
      circuitBreakerThreshold: 5,
      maxTicksPerHour: 240,
      maxTokensPerHour: 1_000_000,
      protectedPaths: ['.env', '.env.*'],
    },
  },

  staging: {
    pollIntervalMs: 30_000,
    autoApproveThreshold: 'low',
    decisionModel: 'sonnet',
    maxConcurrentWorkers: 3,
    safety: {
      eventDebounceMs: 5_000,
      circuitBreakerThreshold: 3,
      maxTicksPerHour: 120,
      maxTokensPerHour: 500_000,
      protectedPaths: ['.env', '.env.*', '*.key', '*.pem'],
    },
  },

  production: {
    pollIntervalMs: 60_000,
    autoApproveThreshold: 'low',
    decisionModel: 'opus',
    maxConcurrentWorkers: 2,
    workspace: { enabled: true, useWorktree: true, autoCleanup: true, strict: true },
    safety: {
      eventDebounceMs: 10_000,
      circuitBreakerThreshold: 2,
      maxTicksPerHour: 60,
      maxTokensPerHour: 200_000,
      protectedPaths: [
        '.env', '.env.*', '*.key', '*.pem', 'credentials.*',
        'migrations/**', 'docker-compose.*', 'Dockerfile*',
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Environment variable overrides
// ---------------------------------------------------------------------------

function applyCommanderEnvOverrides(config: CommanderConfig): CommanderConfig {
  const env = process.env;

  if (env.COMMANDER_POLL_INTERVAL) {
    const v = parseInt(env.COMMANDER_POLL_INTERVAL, 10);
    if (!isNaN(v)) config.pollIntervalMs = v;
  }
  if (env.COMMANDER_MAX_WORKERS) {
    const v = parseInt(env.COMMANDER_MAX_WORKERS, 10);
    if (!isNaN(v)) config.maxConcurrentWorkers = v;
  }
  if (env.COMMANDER_MODEL) {
    config.decisionModel = env.COMMANDER_MODEL as CommanderConfig['decisionModel'];
  }
  if (env.COMMANDER_PROFILE) {
    config.profile = env.COMMANDER_PROFILE as CommanderConfig['profile'];
  }
  if (env.COMMANDER_AUTO_APPROVE) {
    config.autoApproveThreshold = env.COMMANDER_AUTO_APPROVE as CommanderConfig['autoApproveThreshold'];
  }

  return config;
}

// ---------------------------------------------------------------------------
// Profile application
// ---------------------------------------------------------------------------

/**
 * Apply a profile's preset values, but only for fields that are still at
 * their default value (i.e. not explicitly overridden by project/env layers).
 */
export function applyProfile(
  config: CommanderConfig,
  profile?: CommanderConfig['profile'],
): CommanderConfig {
  const targetProfile = profile ?? config.profile;
  if (targetProfile === 'custom' || !PROFILES[targetProfile]) return config;

  const preset = PROFILES[targetProfile];
  for (const [key, val] of Object.entries(preset)) {
    const k = key as keyof CommanderConfig;
    if (config[k] === DEFAULT_COMMANDER_CONFIG[k]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config as any)[key] = val;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Config resolution — merge multiple override layers
// ---------------------------------------------------------------------------

/**
 * Resolve a final CommanderConfig from multiple override layers.
 * Merge order (lowest to highest priority):
 *   defaults -> profile preset -> project -> env -> runtime
 */
export function resolveConfig(
  projectOverride?: Partial<CommanderConfig>,
  envOverride?: Partial<CommanderConfig>,
  runtimeOverride?: Partial<CommanderConfig>,
): CommanderConfig {
  let config: CommanderConfig = { ...DEFAULT_COMMANDER_CONFIG };

  // Determine the active profile from highest priority source
  const profile = runtimeOverride?.profile
    ?? envOverride?.profile
    ?? projectOverride?.profile
    ?? config.profile;

  if (profile !== 'custom' && PROFILES[profile]) {
    config = { ...config, ...PROFILES[profile] };
  }

  // Layer overrides (shallow merge, matching ExecutionScheduler pattern)
  if (projectOverride) Object.assign(config, projectOverride);
  if (envOverride) Object.assign(config, envOverride);
  if (runtimeOverride) Object.assign(config, runtimeOverride);

  return config;
}

// ---------------------------------------------------------------------------
// Full config loader — reads from disk + env
// ---------------------------------------------------------------------------

/**
 * Load Commander configuration with 5-layer merge:
 *   1. DEFAULT_COMMANDER_CONFIG (built-in)
 *   2. ~/.maestro/commander.json (user global)
 *   3. .workflow/config.json -> commander section (project)
 *   4. COMMANDER_* environment variables
 *   5. Runtime overrides (applied later via updateConfig)
 */
export async function loadCommanderConfig(
  workflowRoot: string,
): Promise<CommanderConfig> {
  // Layer 1: Built-in defaults
  let config: CommanderConfig = { ...DEFAULT_COMMANDER_CONFIG };

  // Layer 2: User global config (~/.maestro/commander.json)
  const userConfigPath = resolve(homedir(), '.maestro', 'commander.json');
  try {
    const raw = await readFile(userConfigPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<CommanderConfig>;
    Object.assign(config, userConfig);
  } catch {
    // Missing or unreadable — skip
  }

  // Layer 3: Project config (.workflow/config.json -> commander section)
  const projectConfigPath = resolve(workflowRoot, 'config.json');
  try {
    const raw = await readFile(projectConfigPath, 'utf-8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const section = json['commander'] as Partial<CommanderConfig> | undefined;
    if (section) Object.assign(config, section);
  } catch {
    // Missing or unreadable — skip
  }

  // Layer 4: Environment variables
  config = applyCommanderEnvOverrides(config);

  // Layer 5: Apply profile preset (fills defaults not overridden above)
  config = applyProfile(config);

  return config;
}
