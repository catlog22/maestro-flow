// ---------------------------------------------------------------------------
// Install Profile — export/import install configuration as JSON files
//
// Profile format: maestro-install-config/v1
// Storage: ~/.maestro/install-profiles/
// ---------------------------------------------------------------------------

import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { HookLevel } from '../commands/hooks.js';
import { getHooksForLevel } from '../commands/hooks.js';
import type { ExtraMcpTargetId } from '../commands/install-backend.js';
import { MCP_TOOLS } from '../commands/install-backend.js';
import { findManifest, type Manifest } from './manifest.js';
import { COMPONENT_DEFS } from './component-defs.js';
import { paths } from '../config/paths.js';

const PROFILE_DIR = join(homedir(), '.maestro', 'install-profiles');
const SCHEMA_VERSION = 'maestro-install-config/v1';

export interface InstallProfile {
  $schema: string;
  name: string;
  createdAt: string;
  scope: 'global' | 'project';
  components: {
    enabled: boolean;
    selectedIds: string[];
    /** Component catalog visible when the profile was created. */
    knownIds?: string[];
  };
  claude: {
    hooks: {
      enabled: boolean;
      basePreset: HookLevel;
      selectedHooks: string[];
      isCustom: boolean;
    };
    mcp: {
      enabled: boolean;
      tools: string[];
      projectRoot: string;
    };
    statusline: {
      enabled: boolean;
      theme: string;
    };
  };
  codex: {
    hooks: {
      enabled: boolean;
      basePreset: HookLevel;
      selectedHooks: string[];
      isCustom: boolean;
    };
    mcp: {
      enabled: boolean;
      tools: string[];
      projectRoot: string;
    };
  };
  agy: {
    hooks: {
      enabled: boolean;
      basePreset: HookLevel;
      selectedHooks: string[];
      isCustom: boolean;
    };
  };
  genericHooks?: Record<string, HookLevel>;
  extraMcp: {
    enabled: boolean;
    targetIds: ExtraMcpTargetId[];
  };
  backup: {
    claudeMd: boolean;
    all: boolean;
  };
  plugin?: {
    enabled: boolean;
    claude: boolean;
    codex: boolean;
  };
}

function ensureProfileDir(): void {
  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true });
  }
}

export function getProfileDir(): string {
  return PROFILE_DIR;
}

export function exportProfile(profile: InstallProfile, filePath?: string): string {
  ensureProfileDir();
  const safeName = profile.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const target = filePath ? resolve(filePath) : join(PROFILE_DIR, `${safeName}.json`);
  if (filePath) {
    const resolved = resolve(filePath);
    if (!resolved.startsWith(PROFILE_DIR) && !resolved.startsWith(resolve(process.cwd()))) {
      throw new Error('Export path must be within profile directory or current directory');
    }
  }
  writeFileSync(target, JSON.stringify({ ...profile, $schema: SCHEMA_VERSION }, null, 2), 'utf-8');
  return target;
}

const VALID_SCOPES = ['global', 'project'] as const;
const VALID_LEVELS = ['none', 'minimal', 'standard', 'full'] as const;

function validateProfile(raw: Record<string, unknown>): void {
  if (!raw.scope || !VALID_SCOPES.includes(raw.scope as typeof VALID_SCOPES[number])) {
    throw new Error('Invalid profile: scope must be "global" or "project"');
  }
  const checkLevel = (path: string, val: unknown) => {
    if (val && !VALID_LEVELS.includes(val as typeof VALID_LEVELS[number])) {
      throw new Error(`Invalid profile: ${path} must be one of ${VALID_LEVELS.join(', ')}`);
    }
  };
  const claude = raw.claude as Record<string, unknown> | undefined;
  const codex = raw.codex as Record<string, unknown> | undefined;
  const agy = raw.agy as Record<string, unknown> | undefined;
  checkLevel('claude.hooks.basePreset', (claude?.hooks as Record<string, unknown>)?.basePreset);
  checkLevel('codex.hooks.basePreset', (codex?.hooks as Record<string, unknown>)?.basePreset);
  checkLevel('agy.hooks.basePreset', (agy?.hooks as Record<string, unknown>)?.basePreset);

  const checkProjectRoot = (path: string, val: unknown) => {
    if (typeof val === 'string' && val && (val.includes('..') || val.includes('\0'))) {
      throw new Error(`Invalid profile: ${path} must not contain path traversal`);
    }
  };
  checkProjectRoot('claude.mcp.projectRoot', (claude?.mcp as Record<string, unknown>)?.projectRoot);
  checkProjectRoot('codex.mcp.projectRoot', (codex?.mcp as Record<string, unknown>)?.projectRoot);
}

export function importProfile(filePath: string): InstallProfile {
  if (!existsSync(filePath)) {
    throw new Error('Profile file not found');
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (raw.$schema !== SCHEMA_VERSION) {
    throw new Error('Unsupported profile schema version');
  }
  validateProfile(raw);
  return raw as InstallProfile;
}

export interface ProfileSummary {
  name: string;
  filePath: string;
  scope: string;
  createdAt: string;
}

/**
 * Build an InstallProfile directly from a Manifest object.
 * Used by `maestro update` reinstall — avoids the findManifest() lookup
 * since the caller already has the manifest in hand.
 */
export function manifestToProfile(manifest: Manifest): InstallProfile {
  // hooks.claude.level (schema v2) takes precedence, then legacy hookLevel (v1), then default
  const claudeLevel = (manifest.hooks?.claude?.level ?? manifest.hookLevel ?? 'standard') as HookLevel;
  const codexLevel = (manifest.hooks?.codex?.level as HookLevel) || 'none';
  const agyLevel = (manifest.hooks?.agy?.level as HookLevel) || 'none';

  // Bug fix: detect custom hook selections by comparing installed hooks with level preset
  const claudeInstalledHooks = manifest.hooks?.claude?.installed ?? [];
  const claudeLevelHooks = getHooksForLevel(claudeLevel, 'claude');
  const claudeIsCustom = claudeInstalledHooks.length > 0 &&
    JSON.stringify([...claudeInstalledHooks].sort()) !== JSON.stringify([...claudeLevelHooks].sort());

  const codexInstalledHooks = manifest.hooks?.codex?.installed ?? [];
  const codexLevelHooks = getHooksForLevel(codexLevel, 'codex');
  const codexIsCustom = codexInstalledHooks.length > 0 &&
    JSON.stringify([...codexInstalledHooks].sort()) !== JSON.stringify([...codexLevelHooks].sort());

  const agyInstalledHooks = manifest.hooks?.agy?.installed ?? [];
  const agyLevelHooks = getHooksForLevel(agyLevel, 'agy');
  const agyIsCustom = agyInstalledHooks.length > 0 &&
    JSON.stringify([...agyInstalledHooks].sort()) !== JSON.stringify([...agyLevelHooks].sort());

  // Only schema-v1 manifests used hookLevel as a proxy for a legacy full
  // install. Modern manifests have explicit MCP/statusline records and must
  // never infer them from the mere presence of hooks.
  const wasLegacyFullInstall = (!manifest.version || Number.parseInt(manifest.version, 10) < 2)
    && !!manifest.hookLevel;

  return {
    $schema: SCHEMA_VERSION,
    name: `reinstall-${manifest.scope}`,
    createdAt: new Date().toISOString(),
    scope: manifest.scope,
    components: {
      enabled: manifest.selectedComponentIds === undefined || manifest.selectedComponentIds.length > 0,
      selectedIds: manifest.selectedComponentIds !== undefined
        ? manifest.selectedComponentIds
        : COMPONENT_DEFS.filter(d => d.defaultSelected !== false).map(d => d.id),
      knownIds: manifest.knownComponentIds,
    },
    claude: {
      hooks: {
        enabled: !!(manifest.hooks?.claude?.installed?.length),
        basePreset: claudeLevel,
        selectedHooks: manifest.hooks?.claude?.installed ?? getHooksForLevel(claudeLevel, 'claude'),
        isCustom: claudeIsCustom,
      },
      mcp: {
        enabled: manifest.mcp?.claude ? true : wasLegacyFullInstall,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
      statusline: {
        enabled: manifest.statusline ? true : wasLegacyFullInstall,
        theme: manifest.statusline?.theme || 'notion',
      },
    },
    codex: {
      hooks: {
        enabled: !!(manifest.hooks?.codex?.installed?.length),
        basePreset: codexLevel,
        selectedHooks: manifest.hooks?.codex?.installed ?? getHooksForLevel(codexLevel, 'codex'),
        isCustom: codexIsCustom,
      },
      mcp: {
        enabled: manifest.mcp?.codex ? true : wasLegacyFullInstall,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
    },
    agy: {
      hooks: {
        enabled: !!(manifest.hooks?.agy?.installed?.length),
        basePreset: agyLevel,
        selectedHooks: manifest.hooks?.agy?.installed ?? getHooksForLevel(agyLevel, 'agy'),
        isCustom: agyIsCustom,
      },
    },
    genericHooks: Object.fromEntries(
      Object.entries(manifest.hooks?.generic ?? {}).map(([id, record]) => [id, (record.level ?? 'none') as HookLevel]),
    ),
    extraMcp: {
      enabled: !!(manifest.mcp?.extras?.length),
      targetIds: (manifest.mcp?.extras?.map(e => e.targetId) ?? []) as ExtraMcpTargetId[],
    },
    backup: { claudeMd: true, all: false },
    plugin: manifest.plugin
      ? { enabled: !!(manifest.plugin.claude || manifest.plugin.codex), claude: !!manifest.plugin.claude, codex: !!manifest.plugin.codex }
      : undefined,
  };
}

export function exportProfileFromManifest(
  scope: 'global' | 'project',
  filePath?: string,
): string {
  const targetPath = scope === 'global' ? paths.home : process.cwd();
  const manifest = findManifest(scope, targetPath);

  const claudeLevel = (manifest?.hooks?.claude?.level ?? manifest?.hookLevel ?? 'standard') as HookLevel;
  const codexLevel = (manifest?.hooks?.codex?.level as HookLevel) || 'none';
  const agyLevel = (manifest?.hooks?.agy?.level as HookLevel) || 'none';

  // Detect custom hook selections by comparing installed hooks with level preset
  const claudeInstalledHooks = manifest?.hooks?.claude?.installed ?? [];
  const claudeLevelHooks = getHooksForLevel(claudeLevel, 'claude');
  const claudeIsCustom = claudeInstalledHooks.length > 0 &&
    JSON.stringify([...claudeInstalledHooks].sort()) !== JSON.stringify([...claudeLevelHooks].sort());

  const codexInstalledHooks = manifest?.hooks?.codex?.installed ?? [];
  const codexLevelHooks = getHooksForLevel(codexLevel, 'codex');
  const codexIsCustom = codexInstalledHooks.length > 0 &&
    JSON.stringify([...codexInstalledHooks].sort()) !== JSON.stringify([...codexLevelHooks].sort());

  const agyInstalledHooks = manifest?.hooks?.agy?.installed ?? [];
  const agyLevelHooks = getHooksForLevel(agyLevel, 'agy');
  const agyIsCustom = agyInstalledHooks.length > 0 &&
    JSON.stringify([...agyInstalledHooks].sort()) !== JSON.stringify([...agyLevelHooks].sort());

  // Only schema-v1 manifests used hookLevel as a full-install proxy.
  const wasLegacyFullInstall = !!manifest
    && (!manifest.version || Number.parseInt(manifest.version, 10) < 2)
    && !!manifest.hookLevel;

  const profile: InstallProfile = {
    $schema: SCHEMA_VERSION,
    name: 'default',
    createdAt: new Date().toISOString(),
    scope,
    components: {
      enabled: manifest?.selectedComponentIds === undefined || manifest.selectedComponentIds.length > 0,
      selectedIds: manifest?.selectedComponentIds !== undefined
        ? manifest.selectedComponentIds
        : COMPONENT_DEFS.filter(d => d.defaultSelected !== false).map(d => d.id),
      knownIds: manifest?.knownComponentIds,
    },
    claude: {
      hooks: {
        enabled: !!(manifest?.hooks?.claude?.installed?.length),
        basePreset: claudeLevel,
        selectedHooks: manifest?.hooks?.claude?.installed ?? getHooksForLevel(claudeLevel, 'claude'),
        isCustom: claudeIsCustom,
      },
      mcp: {
        enabled: manifest?.mcp?.claude ? true : wasLegacyFullInstall,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
      statusline: {
        enabled: manifest?.statusline ? true : wasLegacyFullInstall,
        theme: manifest?.statusline?.theme || 'notion',
      },
    },
    codex: {
      hooks: {
        enabled: !!(manifest?.hooks?.codex?.installed?.length),
        basePreset: codexLevel,
        selectedHooks: manifest?.hooks?.codex?.installed ?? getHooksForLevel(codexLevel, 'codex'),
        isCustom: codexIsCustom,
      },
      mcp: {
        enabled: manifest?.mcp?.codex ? true : wasLegacyFullInstall,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
    },
    agy: {
      hooks: {
        enabled: !!(manifest?.hooks?.agy?.installed?.length),
        basePreset: agyLevel,
        selectedHooks: manifest?.hooks?.agy?.installed ?? getHooksForLevel(agyLevel, 'agy'),
        isCustom: agyIsCustom,
      },
    },
    genericHooks: Object.fromEntries(
      Object.entries(manifest?.hooks?.generic ?? {}).map(([id, record]) => [id, (record.level ?? 'none') as HookLevel]),
    ),
    extraMcp: {
      enabled: !!(manifest?.mcp?.extras?.length),
      targetIds: (manifest?.mcp?.extras?.map((e) => e.targetId) ?? []) as ExtraMcpTargetId[],
    },
    backup: { claudeMd: true, all: false },
  };

  return exportProfile(profile, filePath);
}

// ---------------------------------------------------------------------------
// Bidirectional conversion: InstallFlowConfig ↔ InstallProfile
// ---------------------------------------------------------------------------

export function configToProfile(
  config: import('../tui/install-ui/types.js').InstallFlowConfig,
  name = 'default',
): InstallProfile {
  return {
    $schema: SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    scope: config.mode,
    components: {
      enabled: config.installComponents,
      selectedIds: config.selectedComponentIds,
      knownIds: COMPONENT_DEFS.map((def) => def.id),
    },
    claude: {
      hooks: {
        enabled: config.installHooks,
        basePreset: config.hookLevel,
        selectedHooks: config.claudeHooksSelection?.selectedHooks ?? getHooksForLevel(config.hookLevel, 'claude'),
        isCustom: config.claudeHooksSelection?.isCustom ?? false,
      },
      mcp: { enabled: config.installMcp, tools: config.mcpTools, projectRoot: config.mcpProjectRoot },
      statusline: { enabled: config.installStatusline, theme: config.statuslineTheme },
    },
    codex: {
      hooks: {
        enabled: config.installCodexHooks,
        basePreset: config.codexHookLevel,
        selectedHooks: config.codexHooksSelection?.selectedHooks ?? getHooksForLevel(config.codexHookLevel, 'codex'),
        isCustom: config.codexHooksSelection?.isCustom ?? false,
      },
      mcp: { enabled: config.installCodexMcp, tools: config.codexMcpTools, projectRoot: config.codexMcpProjectRoot },
    },
    agy: {
      hooks: {
        enabled: config.installAgyHooks,
        basePreset: config.agyHookLevel,
        selectedHooks: config.agyHooksSelection?.selectedHooks ?? getHooksForLevel(config.agyHookLevel, 'agy'),
        isCustom: config.agyHooksSelection?.isCustom ?? false,
      },
    },
    genericHooks: { ...config.genericHookLevels },
    extraMcp: { enabled: config.installExtraMcp, targetIds: config.extraMcpTargetIds },
    backup: { claudeMd: config.backupClaudeMd, all: config.backupAll },
    plugin: (config.installPluginClaude || config.installPluginCodex)
      ? { enabled: true, claude: !!config.installPluginClaude, codex: !!config.installPluginCodex }
      : undefined,
  };
}

export interface ProfileApplyResult {
  mode: 'global' | 'project';
  enabledSteps: Record<string, boolean>;
  selectedComponentIds: string[];
  claudeHooks: { basePreset: HookLevel; selectedHooks: string[]; isCustom: boolean };
  mcpEnabled: boolean;
  mcpTools: string[];
  mcpProjectRoot: string;
  codexHooks: { basePreset: HookLevel; selectedHooks: string[]; isCustom: boolean };
  codexMcpEnabled: boolean;
  codexMcpTools: string[];
  codexMcpProjectRoot: string;
  agyHooks: { basePreset: HookLevel; selectedHooks: string[]; isCustom: boolean };
  genericHookLevels: Record<string, HookLevel>;
  extraMcpTargetIds: ExtraMcpTargetId[];
  installStatusline: boolean;
  statuslineTheme: string;
  backupClaudeMd: boolean;
  backupAll: boolean;
}

export function profileToStateValues(profile: InstallProfile): ProfileApplyResult {
  return {
    mode: profile.scope,
    enabledSteps: {
      components: profile.components.enabled,
      hooks: profile.claude.hooks.enabled,
      mcp: profile.claude.mcp.enabled,
      codexHooks: profile.codex.hooks.enabled,
      codexMcp: profile.codex.mcp.enabled,
      agyHooks: profile.agy.hooks.enabled,
      extraMcp: profile.extraMcp.enabled,
      statusline: profile.claude.statusline.enabled,
      backup: profile.backup.claudeMd || profile.backup.all,
      pluginClaude: profile.plugin?.claude ?? false,
      pluginCodex: profile.plugin?.codex ?? false,
    },
    selectedComponentIds: profile.components.selectedIds,
    claudeHooks: { basePreset: profile.claude.hooks.basePreset, selectedHooks: profile.claude.hooks.selectedHooks, isCustom: profile.claude.hooks.isCustom },
    mcpEnabled: profile.claude.mcp.enabled,
    mcpTools: profile.claude.mcp.tools,
    mcpProjectRoot: profile.claude.mcp.projectRoot,
    codexHooks: { basePreset: profile.codex.hooks.basePreset, selectedHooks: profile.codex.hooks.selectedHooks, isCustom: profile.codex.hooks.isCustom },
    codexMcpEnabled: profile.codex.mcp.enabled,
    codexMcpTools: profile.codex.mcp.tools,
    codexMcpProjectRoot: profile.codex.mcp.projectRoot,
    agyHooks: { basePreset: profile.agy.hooks.basePreset, selectedHooks: profile.agy.hooks.selectedHooks, isCustom: profile.agy.hooks.isCustom },
    genericHookLevels: { ...(profile.genericHooks ?? {}) },
    extraMcpTargetIds: profile.extraMcp.targetIds,
    installStatusline: profile.claude.statusline.enabled,
    statuslineTheme: profile.claude.statusline.theme,
    backupClaudeMd: profile.backup.claudeMd,
    backupAll: profile.backup.all,
  };
}

export function listProfiles(): ProfileSummary[] {
  ensureProfileDir();
  const files = readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    const filePath = join(PROFILE_DIR, f);
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      return {
        name: raw.name ?? f.replace('.json', ''),
        filePath,
        scope: raw.scope ?? 'unknown',
        createdAt: raw.createdAt ?? '',
      };
    } catch {
      return { name: f.replace('.json', ''), filePath, scope: 'unknown', createdAt: '' };
    }
  });
}
