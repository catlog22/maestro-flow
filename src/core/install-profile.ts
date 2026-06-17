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
import { findManifest } from './manifest.js';
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
  extraMcp: {
    enabled: boolean;
    targetIds: ExtraMcpTargetId[];
  };
  codeGraph: {
    enabled: boolean;
  };
  backup: {
    claudeMd: boolean;
    all: boolean;
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

export function exportProfileFromManifest(
  scope: 'global' | 'project',
  filePath?: string,
): string {
  const targetPath = scope === 'global' ? paths.home : process.cwd();
  const manifest = findManifest(scope, targetPath);

  const claudeLevel = (manifest?.hooks?.claude?.level as HookLevel) || 'standard';
  const codexLevel = (manifest?.hooks?.codex?.level as HookLevel) || 'none';
  const agyLevel = (manifest?.hooks?.agy?.level as HookLevel) || 'none';

  const profile: InstallProfile = {
    $schema: SCHEMA_VERSION,
    name: 'default',
    createdAt: new Date().toISOString(),
    scope,
    components: {
      enabled: !!(manifest?.selectedComponentIds?.length),
      selectedIds: manifest?.selectedComponentIds ?? [],
    },
    claude: {
      hooks: {
        enabled: !!(manifest?.hooks?.claude?.installed?.length),
        basePreset: claudeLevel,
        selectedHooks: manifest?.hooks?.claude?.installed ?? getHooksForLevel(claudeLevel, 'claude'),
        isCustom: false,
      },
      mcp: {
        enabled: !!manifest?.mcp?.claude,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
      statusline: {
        enabled: !!manifest?.statusline,
        theme: manifest?.statusline?.theme || 'notion',
      },
    },
    codex: {
      hooks: {
        enabled: !!(manifest?.hooks?.codex?.installed?.length),
        basePreset: codexLevel,
        selectedHooks: manifest?.hooks?.codex?.installed ?? getHooksForLevel(codexLevel, 'codex'),
        isCustom: false,
      },
      mcp: {
        enabled: !!manifest?.mcp?.codex,
        tools: [...MCP_TOOLS],
        projectRoot: '',
      },
    },
    agy: {
      hooks: {
        enabled: !!(manifest?.hooks?.agy?.installed?.length),
        basePreset: agyLevel,
        selectedHooks: manifest?.hooks?.agy?.installed ?? getHooksForLevel(agyLevel, 'agy'),
        isCustom: false,
      },
    },
    extraMcp: {
      enabled: !!(manifest?.mcp?.extras?.length),
      targetIds: (manifest?.mcp?.extras?.map((e) => e.targetId) ?? []) as ExtraMcpTargetId[],
    },
    codeGraph: { enabled: true },
    backup: { claudeMd: true, all: false },
  };

  return exportProfile(profile, filePath);
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
