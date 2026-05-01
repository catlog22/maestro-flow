// ---------------------------------------------------------------------------
// Skill config — per-skill parameter defaults with dual-scope (global/project)
//
// Follows the same pattern as cli-tools-config.ts:
//   Global:    ~/.maestro/skill-config.json
//   Workspace: {project}/.maestro/skill-config.json
//   Merge:     workspace overrides global (per-skill, params deep-merged)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { paths } from './paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillDefaults {
  /** Parameter name → default value */
  params: Record<string, string | boolean | number>;
  /** Last updated timestamp (ISO 8601) */
  updated?: string;
}

export interface SkillConfigFile {
  version: string;
  /** key = skill name (e.g. "maestro-execute") */
  skills: Record<string, SkillDefaults>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SkillConfigFile = {
  version: '1.0.0',
  skills: {},
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function readConfigFile(filePath: string): SkillConfigFile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as SkillConfigFile;
  } catch {
    return null;
  }
}

/**
 * Load skill config with workspace overrides.
 *
 * Priority: {workDir}/.maestro/skill-config.json > ~/.maestro/skill-config.json
 *
 * Merge: per-skill params are deep-merged (workspace overrides same-name params).
 */
export function loadSkillConfig(workDir?: string): SkillConfigFile {
  const global = readConfigFile(paths.skillConfig) ?? { ...DEFAULT_CONFIG };

  if (!workDir) return global;

  const workspacePath = join(workDir, '.maestro', 'skill-config.json');
  const workspace = readConfigFile(workspacePath);
  if (!workspace) return global;

  // Deep merge: per-skill, params-level merge
  const merged: SkillConfigFile = {
    version: workspace.version ?? global.version,
    skills: { ...global.skills },
  };

  for (const [skill, defaults] of Object.entries(workspace.skills)) {
    const existing = merged.skills[skill];
    if (existing) {
      merged.skills[skill] = {
        params: { ...existing.params, ...defaults.params },
        updated: defaults.updated ?? existing.updated,
      };
    } else {
      merged.skills[skill] = defaults;
    }
  }

  return merged;
}

/**
 * Synchronous loader for hook context (hooks must be synchronous).
 * Same merge logic as loadSkillConfig.
 */
export function loadSkillConfigSync(workDir?: string): SkillConfigFile {
  return loadSkillConfig(workDir);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Save skill config to the specified scope.
 * Reads existing config, deep-merges the update, and writes back.
 */
export function saveSkillConfig(
  update: Partial<SkillConfigFile>,
  scope: 'global' | 'workspace',
  workDir?: string,
): void {
  const configPath = scope === 'global'
    ? paths.skillConfig
    : join(workDir ?? process.cwd(), '.maestro', 'skill-config.json');

  // Read existing
  const existing = readConfigFile(configPath) ?? { ...DEFAULT_CONFIG };

  // Merge skills
  const mergedSkills = { ...existing.skills };
  if (update.skills) {
    for (const [skill, defaults] of Object.entries(update.skills)) {
      const prev = mergedSkills[skill];
      if (prev) {
        mergedSkills[skill] = {
          params: { ...prev.params, ...defaults.params },
          updated: defaults.updated ?? new Date().toISOString(),
        };
      } else {
        mergedSkills[skill] = {
          ...defaults,
          updated: defaults.updated ?? new Date().toISOString(),
        };
      }
    }
  }

  const merged: SkillConfigFile = {
    version: update.version ?? existing.version ?? '1.0.0',
    skills: mergedSkills,
  };

  // Ensure directory and write
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/**
 * Set a single parameter default for a skill.
 */
export function setSkillParam(
  skill: string,
  param: string,
  value: string | boolean | number,
  scope: 'global' | 'workspace',
  workDir?: string,
): void {
  saveSkillConfig({
    skills: {
      [skill]: {
        params: { [param]: value },
        updated: new Date().toISOString(),
      },
    },
  }, scope, workDir);
}

/**
 * Remove a single parameter default for a skill.
 */
export function unsetSkillParam(
  skill: string,
  param: string,
  scope: 'global' | 'workspace',
  workDir?: string,
): void {
  const configPath = scope === 'global'
    ? paths.skillConfig
    : join(workDir ?? process.cwd(), '.maestro', 'skill-config.json');

  const config = readConfigFile(configPath);
  if (!config?.skills[skill]) return;

  delete config.skills[skill].params[param];
  config.skills[skill].updated = new Date().toISOString();

  // Clean up empty skill entries
  if (Object.keys(config.skills[skill].params).length === 0) {
    delete config.skills[skill];
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Reset all defaults for a skill (or all skills).
 */
export function resetSkillConfig(
  skill: string | undefined,
  scope: 'global' | 'workspace',
  workDir?: string,
): void {
  const configPath = scope === 'global'
    ? paths.skillConfig
    : join(workDir ?? process.cwd(), '.maestro', 'skill-config.json');

  const config = readConfigFile(configPath);
  if (!config) return;

  if (skill) {
    delete config.skills[skill];
  } else {
    config.skills = {};
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Get defaults for a specific skill from the merged config.
 * Returns null if no defaults configured.
 */
export function getSkillDefaults(
  skill: string,
  workDir?: string,
): SkillDefaults | null {
  const config = loadSkillConfig(workDir);
  return config.skills[skill] ?? null;
}

/**
 * Load global and workspace configs separately (un-merged) for introspection.
 */
export function loadSkillConfigSources(workDir?: string): {
  globalPath: string;
  global: SkillConfigFile | null;
  workspacePath: string | null;
  workspace: SkillConfigFile | null;
} {
  const gp = paths.skillConfig;
  const g = readConfigFile(gp);

  let wp: string | null = null;
  let w: SkillConfigFile | null = null;
  if (workDir) {
    wp = join(workDir, '.maestro', 'skill-config.json');
    w = readConfigFile(wp);
  }

  return { globalPath: gp, global: g, workspacePath: wp, workspace: w };
}
