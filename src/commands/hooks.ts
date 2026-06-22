import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../config/paths.js';
import { loadConfig, saveConfig, loadHooksConfig, loadSpecInjectionConfig } from '../config/index.js';
import { evaluateWorkflowGuard, evaluatePathGuard, loadPathGuardConfig } from '../hooks/guards/workflow-guard.js';
import { evaluatePreflightGuard, loadPreflightConfig } from '../hooks/guards/preflight-guard.js';
import { evaluatePromptGuard } from '../hooks/guards/prompt-guard.js';
import { evaluateSpecValidator } from '../hooks/guards/spec-validator.js';
import { evaluateKeywordInjection } from '../hooks/keyword-spec-injector.js';
import { evaluateDelegateNotifications } from '../hooks/delegate-monitor.js';
import { runTeamMonitor } from '../hooks/team-monitor.js';
import { evaluateSpecInjection } from '../hooks/spec-injector.js';
import { evaluateSessionContext } from '../hooks/session-context.js';
import { evaluateSkillContext } from '../hooks/skill-context.js';
import { resolveWorkspace } from '../hooks/workspace.js';
import {
  readMaestroSession,
  readLatestSession,
  readCoordBridge,
  writeCoordBridge,
  type CoordBridgeData,
} from '../hooks/coordinator-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HookGroup {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookGroup[];
    PostToolUse?: HookGroup[];
    UserPromptSubmit?: HookGroup[];
    Notification?: HookGroup[];
    [key: string]: unknown;
  };
  statusLine?: { type: string; command: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Hook definitions — single source of truth
// ---------------------------------------------------------------------------

interface HookDef {
  event: 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Notification' | 'Stop';
  matcher?: string;
  /** Minimum level required to install this hook */
  level: HookLevel;
  /** If true, hook exits silently when no Maestro workspace is found */
  requiresWorkspace?: boolean;
}

/**
 * Hook installation levels (cumulative):
 * - `none`:     No hooks installed
 * - `minimal`:  Statusline + spec-injector (safe monitoring)
 * - `standard`: + delegate-monitor, team-monitor, telemetry (full monitoring)
 * - `full`:     + workflow-guard (PreToolUse), prompt-guard (UserPromptSubmit)
 */
export type HookLevel = 'none' | 'minimal' | 'standard' | 'full';

export const HOOK_LEVELS: readonly HookLevel[] = ['none', 'minimal', 'standard', 'full'];

export const HOOK_LEVEL_DESCRIPTIONS: Record<HookLevel, string> = {
  none: 'No hooks',
  minimal: 'Statusline + spec-injector',
  standard: '+ delegate-monitor + team/telemetry/coordinator(Stop) + session-context + skill-context + kg-sync + kg-auto-init + kg-context-injector + kg-unified-injector (opt-in)',
  full: '+ workflow-guard (PreToolUse) + prompt-guard (UserPromptSubmit)',
};

export const HOOK_DEFS: Record<string, HookDef> = {
  'spec-injector': { event: 'PreToolUse', matcher: 'Agent', level: 'minimal', requiresWorkspace: true },
  'delegate-monitor': { event: 'PostToolUse', matcher: 'Bash|Agent', level: 'standard' },
  'team-monitor': { event: 'Stop', level: 'standard' },
  'telemetry': { event: 'Stop', level: 'standard' },
  'session-context': { event: 'Notification', level: 'standard' },
  'skill-context': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'coordinator-tracker': { event: 'Stop', level: 'standard', requiresWorkspace: true },
  'preflight-guard': { event: 'PreToolUse', matcher: 'Bash|Write|Edit|Agent', level: 'standard', requiresWorkspace: true },
  'spec-validator': { event: 'PreToolUse', matcher: 'Write|Edit', level: 'standard', requiresWorkspace: true },
  'keyword-spec-injector': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-sync': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-auto-init': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-context-injector': { event: 'PreToolUse', matcher: 'Agent', level: 'standard', requiresWorkspace: true },
  'kg-unified-injector': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-unified-injector-agent': { event: 'PreToolUse', matcher: 'Agent', level: 'standard', requiresWorkspace: true },
  'workflow-guard': { event: 'PreToolUse', matcher: 'Bash|Write|Edit', level: 'full', requiresWorkspace: true },
  'prompt-guard': { event: 'UserPromptSubmit', level: 'full', requiresWorkspace: false },
};

// ---------------------------------------------------------------------------
// Codex hook definitions — maps Maestro hooks to Codex lifecycle events
// ---------------------------------------------------------------------------

interface CodexHookDef {
  event: 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop';
  matcher?: string;          // regex pattern (Codex uses regex matchers)
  level: HookLevel;
  requiresWorkspace?: boolean;
  statusMessage?: string;
  timeout?: number;
}

export const CODEX_HOOK_DEFS: Record<string, CodexHookDef> = {
  'session-context':       { event: 'SessionStart', matcher: 'startup|resume', level: 'minimal', requiresWorkspace: true, statusMessage: 'Loading workflow context' },
  'spec-injector':         { event: 'SessionStart', matcher: 'startup', level: 'standard', requiresWorkspace: true, statusMessage: 'Loading project specs' },
  'skill-context':         { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'keyword-spec-injector': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-sync':               { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-auto-init':          { event: 'SessionStart', matcher: 'startup', level: 'standard', requiresWorkspace: true, statusMessage: 'Initializing knowledge graph' },
  'kg-context-injector':   { event: 'PreToolUse', matcher: 'Agent', level: 'standard', requiresWorkspace: true },
  'delegate-monitor':      { event: 'PostToolUse', matcher: 'Bash', level: 'standard' },
  'coordinator-tracker':   { event: 'Stop', level: 'standard', requiresWorkspace: true },
  'team-monitor':          { event: 'Stop', level: 'standard' },
  'telemetry':             { event: 'Stop', level: 'standard' },
  'preflight-guard':       { event: 'PreToolUse', matcher: 'Bash', level: 'standard', requiresWorkspace: true, statusMessage: 'Running preflight checks' },
  'spec-validator':        { event: 'PreToolUse', matcher: 'Write|Edit', level: 'standard', requiresWorkspace: true, statusMessage: 'Validating against specs' },
  'kg-unified-injector':   { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'kg-unified-injector-agent': { event: 'PreToolUse', matcher: 'Agent', level: 'standard', requiresWorkspace: true },
  'workflow-guard':        { event: 'PreToolUse', matcher: 'Bash', level: 'full', requiresWorkspace: true, statusMessage: 'Checking command safety' },
  'prompt-guard':          { event: 'UserPromptSubmit', level: 'full', requiresWorkspace: false },
};

export const CODEX_HOOK_LEVEL_DESCRIPTIONS: Record<HookLevel, string> = {
  none: 'No hooks',
  minimal: 'Session context (SessionStart)',
  standard: '+ spec/keyword-injector + skill-context + kg-sync + kg-auto-init(SessionStart) + kg-context-injector + delegate-monitor + coordinator/team/telemetry(Stop) + preflight/spec guards + kg-unified-injector (opt-in)',
  full: '+ workflow-guard (PreToolUse, Bash only) + prompt-guard (UserPromptSubmit)',
};

/** Numeric ordering for level comparison */
const LEVEL_ORDER: Record<HookLevel, number> = { none: 0, minimal: 1, standard: 2, full: 3 };

function hookIncludedInLevel(hookLevel: HookLevel, targetLevel: HookLevel): boolean {
  return LEVEL_ORDER[hookLevel] <= LEVEL_ORDER[targetLevel];
}

/** Return hook names included at a given level for a specific tool (claude/codex/agy). */
export function getHooksForLevel(
  level: HookLevel,
  tool: 'claude' | 'codex' | 'agy' = 'claude',
): string[] {
  if (level === 'none') return [];
  const defs = tool === 'codex' ? CODEX_HOOK_DEFS
    : tool === 'agy' ? AGY_HOOK_DEFS
    : HOOK_DEFS;
  return Object.entries(defs)
    .filter(([, def]) => hookIncludedInLevel(def.level, level))
    .map(([name]) => name);
}

/** Return all hook names for a specific tool. */
export function getAllHookNames(tool: 'claude' | 'codex' | 'agy' = 'claude'): string[] {
  const defs = tool === 'codex' ? CODEX_HOOK_DEFS
    : tool === 'agy' ? AGY_HOOK_DEFS
    : HOOK_DEFS;
  return Object.keys(defs);
}

/** Get the hook event and level info for display. */
export function getHookInfo(
  hookName: string,
  tool: 'claude' | 'codex' | 'agy' = 'claude',
): { event: string; level: HookLevel; matcher?: string } | null {
  const defs = tool === 'codex' ? CODEX_HOOK_DEFS
    : tool === 'agy' ? AGY_HOOK_DEFS
    : HOOK_DEFS;
  const def = defs[hookName];
  if (!def) return null;
  return { event: def.event, level: def.level, matcher: def.matcher };
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export function getClaudeSettingsPath(): string {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(claudeDir, 'settings.json');
}

export function loadClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

function getMaestroBinDir(): string {
  // From dist/src/commands/ → 3 levels up to package root, then into bin/
  return resolve(new URL('../../../bin', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
}

const HOOK_MARKER = 'maestro';

/**
 * Remove maestro hooks from Claude settings.
 *
 * @param settings  Parsed settings.json object (mutated in place)
 * @param hookNames Optional whitelist of hook names to remove. When omitted,
 *                  every command containing the "maestro" substring is stripped
 *                  (legacy uninstall behavior).
 */
export function removeMaestroHooks(settings: ClaudeSettings, hookNames?: string[]): void {
  if (!settings.hooks) return;
  const targets = hookNames && hookNames.length > 0
    ? new Set(hookNames.map((n) => `hooks run ${n}`))
    : null;

  for (const eventKey of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop'] as const) {
    const groups = settings.hooks[eventKey] as HookGroup[] | undefined;
    if (!groups) continue;
    for (const group of groups) {
      group.hooks = group.hooks.filter((h) => {
        if (targets) return ![...targets].some((needle) => h.command.includes(needle));
        return !h.command.includes(HOOK_MARKER);
      });
    }
    settings.hooks[eventKey] = groups.filter((g) => g.hooks.length > 0) as never;
    if ((settings.hooks[eventKey] as HookGroup[]).length === 0) {
      delete settings.hooks[eventKey];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}

/**
 * Remove the maestro-installed statusline from Claude settings.
 * Returns true if a statusline was removed.
 */
export function removeClaudeStatusline(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = loadClaudeSettings(settingsPath);
    if (!settings.statusLine?.command?.includes(HOOK_MARKER)) return false;
    delete settings.statusLine;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall hooks recorded under a HookRecord from a Claude settings file.
 * Removes only the hooks listed in `installed` — does NOT strip statusline.
 * Returns the number of hook entries removed.
 */
export function uninstallClaudeHooks(settingsPath: string, installed: string[]): number {
  if (!existsSync(settingsPath) || installed.length === 0) return 0;
  try {
    const settings = loadClaudeSettings(settingsPath);
    const before = countHookEntries(settings.hooks as Record<string, HookGroup[]> | undefined);
    removeMaestroHooks(settings, installed);
    const after = countHookEntries(settings.hooks as Record<string, HookGroup[]> | undefined);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return Math.max(0, before - after);
  } catch {
    return 0;
  }
}

function countHookEntries(hooks: Record<string, HookGroup[]> | undefined): number {
  if (!hooks) return 0;
  let count = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) count += g.hooks.length;
  }
  return count;
}

function findHookInSettings(settings: ClaudeSettings, hookName: string): boolean {
  if (!settings.hooks) return false;
  for (const eventKey of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop'] as const) {
    const groups = settings.hooks[eventKey] as HookGroup[] | undefined;
    if (!groups) continue;
    if (groups.some((g) => g.hooks.some((h) => h.command.includes(`hooks run ${hookName}`) || h.command.includes(`hook-runner.js") ${hookName}`) || h.command.includes(`hook-runner.js" ${hookName}`)))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reusable install function — used by both `hooks install` and `maestro install`
// ---------------------------------------------------------------------------

export interface InstallHooksResult {
  settingsPath: string;
  installedHooks: string[];
  level: HookLevel;
}

/**
 * Detect whether a statusline is already configured in Claude Code settings.
 * Returns the current command string if found, or null.
 */
export function detectStatusline(opts: { project?: boolean } = {}): string | null {
  const settingsPath = opts.project
    ? join(process.cwd(), '.claude', 'settings.json')
    : getClaudeSettingsPath();
  const settings = loadClaudeSettings(settingsPath);
  return settings.statusLine?.command ?? null;
}

/**
 * Install the statusline into Claude Code settings.json
 * and persist theme preference to maestro config.
 */
export function installStatusline(opts: {
  project?: boolean;
  settingsPath?: string;
  theme?: string;
} = {}): string {
  const settingsPath = opts.settingsPath
    ?? (opts.project
      ? join(process.cwd(), '.claude', 'settings.json')
      : getClaudeSettingsPath());
  const settings = loadClaudeSettings(settingsPath);
  settings.statusLine = { type: 'command', command: 'maestro-statusline' };
  paths.ensure(join(settingsPath, '..'));
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // Persist theme preference
  if (opts.theme) {
    try {
      const config = loadConfig();
      config.statusline = { ...config.statusline, theme: opts.theme };
      saveConfig(config);
    } catch { /* best-effort */ }
  }

  return settingsPath;
}

/**
 * Install hooks at the given level into Claude Code settings.json.
 * @param level  Hook level to install
 * @param opts   `project` to use project-scoped settings, otherwise global
 */
export function installHooksByLevel(
  level: HookLevel,
  opts: { project?: boolean; settingsPath?: string; skipStatusline?: boolean; selectedHooks?: string[] } = {},
): InstallHooksResult {
  if (level === 'none' && !opts.selectedHooks?.length) {
    return { settingsPath: '', installedHooks: [], level };
  }

  const settingsPath = opts.settingsPath
    ?? (opts.project
      ? join(process.cwd(), '.claude', 'settings.json')
      : getClaudeSettingsPath());

  const settings = loadClaudeSettings(settingsPath);

  // Note: statusline is NEVER auto-installed by hooks. It is opt-in only,
  // controlled by the dedicated `installStatusline` flag in the install flow.
  // The `skipStatusline` option is kept for API back-compat but ignored.

  // --- Remove existing maestro hooks to avoid duplicates ---
  removeMaestroHooks(settings);

  // --- Register hooks matching the requested level (or custom list) ---
  if (!settings.hooks) settings.hooks = {};

  const customSet = opts.selectedHooks ? new Set(opts.selectedHooks) : null;
  const installedHooks: string[] = [];
  for (const [name, def] of Object.entries(HOOK_DEFS)) {
    if (customSet ? !customSet.has(name) : !hookIncludedInLevel(def.level, level)) continue;

    const eventKey = def.event;
    if (!settings.hooks[eventKey]) settings.hooks[eventKey] = [] as never;
    const groups = settings.hooks[eventKey] as HookGroup[];
    const group: HookGroup = {
      hooks: [{ type: 'command', command: `maestro hooks run ${name}` }],
    };
    if (def.matcher) group.matcher = def.matcher;
    groups.push(group);
    installedHooks.push(name);
  }

  // Ensure parent directory exists
  paths.ensure(join(settingsPath, '..'));
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return { settingsPath, installedHooks, level };
}

// ---------------------------------------------------------------------------
// Codex hooks helpers
// ---------------------------------------------------------------------------

interface CodexHookGroup {
  matcher?: string;
  hooks: Array<{ type: string; command: string; statusMessage?: string; timeout?: number }>;
}

interface CodexHooksFile {
  hooks?: {
    SessionStart?: CodexHookGroup[];
    PreToolUse?: CodexHookGroup[];
    PostToolUse?: CodexHookGroup[];
    UserPromptSubmit?: CodexHookGroup[];
    Stop?: CodexHookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function getCodexHooksPath(opts: { project?: boolean } = {}): string {
  return opts.project
    ? join(process.cwd(), '.codex', 'hooks.json')
    : join(homedir(), '.codex', 'hooks.json');
}

export function loadCodexHooks(hooksPath: string): CodexHooksFile {
  if (!existsSync(hooksPath)) return {};
  try { return JSON.parse(readFileSync(hooksPath, 'utf8')); }
  catch { return {}; }
}

export function removeCodexMaestroHooks(hooksFile: CodexHooksFile, hookNames?: string[]): void {
  if (!hooksFile.hooks) return;
  const targets = hookNames && hookNames.length > 0
    ? new Set(hookNames.map((n) => `hooks run ${n}`))
    : null;

  const events = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'] as const;
  for (const eventKey of events) {
    const groups = hooksFile.hooks[eventKey] as CodexHookGroup[] | undefined;
    if (!groups) continue;
    for (const group of groups) {
      group.hooks = group.hooks.filter((h) => {
        if (targets) return ![...targets].some((needle) => h.command.includes(needle));
        return !h.command.includes(HOOK_MARKER);
      });
    }
    hooksFile.hooks[eventKey] = groups.filter((g) => g.hooks.length > 0) as never;
    if ((hooksFile.hooks[eventKey] as CodexHookGroup[]).length === 0) {
      delete hooksFile.hooks[eventKey];
    }
  }
  if (Object.keys(hooksFile.hooks).length === 0) {
    delete hooksFile.hooks;
  }
}

/**
 * Uninstall codex hooks recorded under a HookRecord. Returns number of entries removed.
 */
export function uninstallCodexHooks(hooksPath: string, installed: string[]): number {
  if (!existsSync(hooksPath) || installed.length === 0) return 0;
  try {
    const hooksFile = loadCodexHooks(hooksPath);
    const before = countCodexHookEntries(hooksFile);
    removeCodexMaestroHooks(hooksFile, installed);
    const after = countCodexHookEntries(hooksFile);
    writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));
    return Math.max(0, before - after);
  } catch {
    return 0;
  }
}

function countCodexHookEntries(hooksFile: CodexHooksFile): number {
  if (!hooksFile.hooks) return 0;
  let count = 0;
  for (const groups of Object.values(hooksFile.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups as CodexHookGroup[]) count += g.hooks.length;
  }
  return count;
}

/**
 * Check whether `codex_hooks = true` is set in config.toml.
 * Returns true if the flag is found; prints a hint otherwise.
 */
export function checkCodexHooksFeatureFlag(opts: { project?: boolean } = {}): boolean {
  const configPath = opts.project
    ? join(process.cwd(), '.codex', 'config.toml')
    : join(homedir(), '.codex', 'config.toml');
  if (!existsSync(configPath)) return false;
  const content = readFileSync(configPath, 'utf8');
  return /codex_hooks\s*=\s*true/i.test(content);
}

/**
 * Install hooks at the given level into Codex hooks.json.
 */
export function installCodexHooksByLevel(
  level: HookLevel,
  opts: { project?: boolean; hooksPath?: string; selectedHooks?: string[] } = {},
): InstallHooksResult {
  if (level === 'none' && !opts.selectedHooks?.length) {
    return { settingsPath: '', installedHooks: [], level };
  }

  const hooksPath = opts.hooksPath ?? getCodexHooksPath({ project: opts.project });
  const hooksFile = loadCodexHooks(hooksPath);

  // Remove existing maestro hooks to avoid duplicates
  removeCodexMaestroHooks(hooksFile);

  // Register hooks matching the requested level (or custom list)
  if (!hooksFile.hooks) hooksFile.hooks = {};

  const customSet = opts.selectedHooks ? new Set(opts.selectedHooks) : null;
  const installedHooks: string[] = [];
  for (const [name, def] of Object.entries(CODEX_HOOK_DEFS)) {
    if (customSet ? !customSet.has(name) : !hookIncludedInLevel(def.level, level)) continue;

    const eventKey = def.event;
    if (!hooksFile.hooks[eventKey]) hooksFile.hooks[eventKey] = [] as never;
    const groups = hooksFile.hooks[eventKey] as CodexHookGroup[];

    const hookEntry: { type: string; command: string; statusMessage?: string; timeout?: number } = {
      type: 'command',
      command: `maestro hooks run ${name}`,
    };
    if (def.statusMessage) hookEntry.statusMessage = def.statusMessage;
    if (def.timeout) hookEntry.timeout = def.timeout;

    const group: CodexHookGroup = { hooks: [hookEntry] };
    if (def.matcher) group.matcher = def.matcher;
    groups.push(group);
    installedHooks.push(name);
  }

  // Ensure parent directory exists
  paths.ensure(join(hooksPath, '..'));
  writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));

  return { settingsPath: hooksPath, installedHooks, level };
}

// ---------------------------------------------------------------------------
// Antigravity (agy) hooks
//
// File schema (per https://antigravity.google/docs/hooks):
//   Top-level is Record<hookName, HookConfig> — a map of NAMED hooks.
//   Each named hook can have `enabled: false` to disable without removing.
//
// Events:
//   PreToolUse  / PostToolUse  — use {matcher, hooks: [...]} grouping; matcher
//                                is a regex on agy tool names.
//   PreInvocation / PostInvocation / Stop — flat [handler, ...] array
//                                (no matcher wrapping; matcher field ignored).
//
// Locations:
//   global    → ~/.gemini/config/hooks.json
//   workspace → <project>/.agents/hooks.json
//
// Maestro identification: every maestro-installed hook is registered under a
// top-level name with the `maestro-` prefix, so removal is a key-prefix sweep.
// ---------------------------------------------------------------------------

/** Antigravity hook event names. */
type AgyEvent = 'PreToolUse' | 'PostToolUse' | 'PreInvocation' | 'PostInvocation' | 'Stop';

interface AgyHookDef {
  event: AgyEvent;
  matcher?: string;              // only meaningful for PreToolUse/PostToolUse
  level: HookLevel;
  requiresWorkspace?: boolean;
  timeout?: number;
}

/**
 * Maestro → Antigravity event mapping.
 *
 * Agy has no SessionStart / UserPromptSubmit. The closest analog is
 * PreInvocation (fires before every model call). The runners that previously
 * targeted UserPromptSubmit / SessionStart are remapped to PreInvocation and
 * rely on workspace-state checks to be cheap on repeated firings.
 *
 * Tool matchers use agy tool names (not Claude's): run_command, write_to_file,
 * replace_file_content, multi_replace_file_content, invoke_subagent, etc.
 */
export const AGY_HOOK_DEFS: Record<string, AgyHookDef> = {
  // Minimal — safe monitoring
  'spec-injector':         { event: 'PreToolUse', matcher: 'invoke_subagent', level: 'minimal', requiresWorkspace: true },

  // Standard — context injection + delegate / team / coordinator monitoring
  'session-context':       { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'skill-context':         { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'keyword-spec-injector': { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'kg-sync':               { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'kg-auto-init':          { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'kg-context-injector':   { event: 'PreToolUse', matcher: 'invoke_subagent', level: 'standard', requiresWorkspace: true },
  'delegate-monitor':      { event: 'PostToolUse', matcher: 'run_command|invoke_subagent', level: 'standard' },
  'team-monitor':          { event: 'Stop', level: 'standard' },
  'telemetry':             { event: 'Stop', level: 'standard' },
  'coordinator-tracker':   { event: 'Stop', level: 'standard', requiresWorkspace: true },

  'kg-unified-injector':   { event: 'PreInvocation', level: 'standard', requiresWorkspace: true },
  'kg-unified-injector-agent': { event: 'PreToolUse', matcher: 'invoke_subagent', level: 'standard', requiresWorkspace: true },

  // Full — guards
  'preflight-guard':       { event: 'PreToolUse', matcher: 'run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent', level: 'standard', requiresWorkspace: true },
  'spec-validator':        { event: 'PreToolUse', matcher: 'write_to_file|replace_file_content|multi_replace_file_content', level: 'standard', requiresWorkspace: true },
  'workflow-guard':        { event: 'PreToolUse', matcher: 'run_command|write_to_file|replace_file_content|multi_replace_file_content', level: 'full', requiresWorkspace: true },
  'prompt-guard':          { event: 'PreInvocation', level: 'full', requiresWorkspace: false },
};

export const AGY_HOOK_LEVEL_DESCRIPTIONS: Record<HookLevel, string> = {
  none: 'No hooks',
  minimal: 'spec-injector (PreToolUse on invoke_subagent)',
  standard: '+ session/skill/keyword context (PreInvocation) + delegate-monitor (PostToolUse) + team/telemetry/coordinator (Stop) + preflight/spec guards + kg-unified-injector (opt-in)',
  full: '+ workflow-guard (PreToolUse on shell/file writes) + prompt-guard (PreInvocation)',
};

// File-schema types matching Antigravity's published shape.
interface AgyHookHandler {
  type?: string;          // defaults to "command"
  command: string;
  timeout?: number;
}

interface AgyToolEventEntry {
  matcher?: string;       // regex on tool name
  hooks: AgyHookHandler[];
}

interface AgyHookConfig {
  enabled?: boolean;
  PreToolUse?: AgyToolEventEntry[];
  PostToolUse?: AgyToolEventEntry[];
  PreInvocation?: AgyHookHandler[];
  PostInvocation?: AgyHookHandler[];
  Stop?: AgyHookHandler[];
}

/** Whole hooks.json file: a flat map of hookName → HookConfig. */
type AgyHooksFile = Record<string, AgyHookConfig>;

const AGY_HOOK_NAME_PREFIX = 'maestro-';

/**
 * Resolve the path where Antigravity hooks are configured.
 *   global    → ~/.gemini/config/hooks.json
 *   workspace → <project>/.agents/hooks.json
 *
 * `projectPath` should be the absolute path of the target project; falls back
 * to process.cwd() when omitted (matches the existing Codex pattern).
 */
export function getAgyHooksPath(opts: { project?: boolean; projectPath?: string } = {}): string {
  return opts.project
    ? join(opts.projectPath ?? process.cwd(), '.agents', 'hooks.json')
    : join(homedir(), '.gemini', 'config', 'hooks.json');
}

export function loadAgyHooks(hooksPath: string): AgyHooksFile {
  if (!existsSync(hooksPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as AgyHooksFile : {};
  } catch {
    return {};
  }
}

/** Strip all maestro-prefixed top-level entries (preserves user-defined hooks). */
export function removeAgyMaestroHooks(hooksFile: AgyHooksFile, hookNames?: string[]): void {
  const exact = hookNames && hookNames.length > 0
    ? new Set(hookNames.map((n) => `${AGY_HOOK_NAME_PREFIX}${n}`))
    : null;
  for (const key of Object.keys(hooksFile)) {
    if (exact) {
      if (exact.has(key)) delete hooksFile[key];
    } else if (key.startsWith(AGY_HOOK_NAME_PREFIX)) {
      delete hooksFile[key];
    }
  }
}

/**
 * Uninstall agy hooks recorded under a HookRecord. Returns number of entries removed.
 */
export function uninstallAgyHooks(hooksPath: string, installed: string[]): number {
  if (!existsSync(hooksPath) || installed.length === 0) return 0;
  try {
    const hooksFile = loadAgyHooks(hooksPath);
    const before = Object.keys(hooksFile).filter((k) => k.startsWith(AGY_HOOK_NAME_PREFIX)).length;
    removeAgyMaestroHooks(hooksFile, installed);
    const after = Object.keys(hooksFile).filter((k) => k.startsWith(AGY_HOOK_NAME_PREFIX)).length;
    writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));
    return Math.max(0, before - after);
  } catch {
    return 0;
  }
}

/** Determines which event-key shape applies. */
function isFlatEvent(event: AgyEvent): boolean {
  return event === 'PreInvocation' || event === 'PostInvocation' || event === 'Stop';
}

/**
 * Install hooks at the given level into Antigravity's hooks.json.
 */
export function installAgyHooksByLevel(
  level: HookLevel,
  opts: { project?: boolean; projectPath?: string; hooksPath?: string; selectedHooks?: string[] } = {},
): InstallHooksResult {
  if (level === 'none' && !opts.selectedHooks?.length) {
    return { settingsPath: '', installedHooks: [], level };
  }

  const hooksPath = opts.hooksPath ?? getAgyHooksPath({ project: opts.project, projectPath: opts.projectPath });
  const hooksFile = loadAgyHooks(hooksPath);
  removeAgyMaestroHooks(hooksFile);

  const customSet = opts.selectedHooks ? new Set(opts.selectedHooks) : null;
  const installedHooks: string[] = [];
  for (const [name, def] of Object.entries(AGY_HOOK_DEFS)) {
    if (customSet ? !customSet.has(name) : !hookIncludedInLevel(def.level, level)) continue;

    const hookName = `${AGY_HOOK_NAME_PREFIX}${name}`;
    const handler: AgyHookHandler = { type: 'command', command: `maestro hooks run ${name}` };
    if (def.timeout) handler.timeout = def.timeout;

    const config: AgyHookConfig = {};
    if (isFlatEvent(def.event)) {
      (config[def.event] as AgyHookHandler[]) = [handler];
    } else {
      const entry: AgyToolEventEntry = { hooks: [handler] };
      if (def.matcher) entry.matcher = def.matcher;
      (config[def.event] as AgyToolEventEntry[]) = [entry];
    }
    hooksFile[hookName] = config;
    installedHooks.push(name);
  }

  // Only write if there are entries — avoid creating an empty {} file.
  paths.ensure(join(hooksPath, '..'));
  if (Object.keys(hooksFile).length > 0) {
    writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));
  }

  return { settingsPath: hooksPath, installedHooks, level };
}

// ---------------------------------------------------------------------------
// Stdin reader for hook runners (cached — safe to call multiple times)
// ---------------------------------------------------------------------------

let _stdinCache: string | null = null;

function readStdin(): Promise<string> {
  if (_stdinCache !== null) return Promise.resolve(_stdinCache);
  return new Promise<string>((resolve) => {
    let input = '';
    const timeout = setTimeout(() => resolve(input), 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(input);
    });
  }).then(raw => { _stdinCache = raw; return raw; });
}

/**
 * Extract key fields from hook stdin for analytics logging.
 * Keeps only short, diagnostic-relevant fields — never full prompts.
 */
function extractHookInputData(raw: string): Record<string, unknown> {
  try {
    if (!raw) return {};
    const data = JSON.parse(raw);
    const result: Record<string, unknown> = {};
    if (data.tool_name) result.tool_name = data.tool_name;
    if (data.session_id) result.session_id = data.session_id;
    if (data.hook_event_name) result.hook_event_name = data.hook_event_name;
    // tool_input key fields (abbreviated)
    const ti = data.tool_input;
    if (ti && typeof ti === 'object') {
      if (ti.file_path) result.file_path = ti.file_path;
      if (ti.subagent_type) result.subagent_type = ti.subagent_type;
      if (typeof ti.command === 'string') result.command = ti.command.slice(0, 120);
    } else if (typeof ti === 'string') {
      result.command = ti.slice(0, 120);
    }
    // UserPromptSubmit: first 120 chars
    const prompt = data.user_prompt ?? data.prompt;
    if (typeof prompt === 'string') result.prompt_snippet = prompt.slice(0, 120);
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Hook runners — each reads stdin, calls pure evaluator, writes stdout
// ---------------------------------------------------------------------------

type HookRunner = () => Promise<void>;

const HOOK_RUNNERS: Record<string, HookRunner> = {
  'preflight-guard': async () => {
    const config = loadHooksConfig();
    if (config.toggles['preflightGuard'] === false) return;

    const cwd = process.env.MAESTRO_PROJECT_ROOT || process.cwd();
    const pfConfig = loadPreflightConfig(cwd);
    const result = evaluatePreflightGuard(cwd, pfConfig);

    if (result.conflictCount > 0) {
      if (result.blocked) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: result.warnings.join('\n'),
        }));
        process.exit(2);
      } else {
        // Advisory mode: emit warnings as additional context
        process.stdout.write(JSON.stringify({
          decision: 'allow',
          additionalContext: `[PreflightGuard] ${result.warnings.join(' | ')}`,
        }));
      }
    }
  },

  'spec-validator': async () => {
    const config = loadHooksConfig();
    if (config.toggles['specValidator'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const toolInput = data.tool_input ?? {};
    const filePath: string = toolInput.file_path ?? '';

    // Only validate .workflow/specs/ files
    if (!filePath.replace(/\\/g, '/').includes('.workflow/specs/')) return;

    // For Write: full content. For Edit: we can only validate the file_path presence.
    const content: string = toolInput.content ?? '';
    if (!content) return; // Edit tool — skip (can't validate partial edits)

    const result = evaluateSpecValidator(filePath, content);
    if (!result.valid) {
      const errorSummary = result.errors.map(e => `L${e.line}: ${e.message}`).join('\n');
      if (result.mode === 'block') {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `[SpecValidator] Format errors:\n${errorSummary}`,
        }));
        process.exit(2);
      } else {
        process.stdout.write(JSON.stringify({
          decision: 'allow',
          additionalContext: `[SpecValidator] Format warnings:\n${errorSummary}`,
        }));
      }
    }
  },

  'keyword-spec-injector': async () => {
    const config = loadHooksConfig();
    if (config.toggles['keywordSpecInjector'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const prompt: string = data.user_prompt ?? data.prompt ?? '';
    const sessionId: string = data.session_id ?? '';
    const cwd: string = data.cwd ?? process.cwd();

    if (!prompt || !sessionId) return;

    // Resolve workspace
    const { resolveWorkspace } = await import('../hooks/workspace.js');
    const workspace = resolveWorkspace({ cwd });
    if (!workspace) return;

    const result = await evaluateKeywordInjection(prompt, workspace, sessionId);
    if (result.inject && result.content) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: data.hook_event_name || 'UserPromptSubmit',
          additionalContext: result.content,
        },
      }));
    }
  },

  'kg-sync': async () => {
    const config = loadHooksConfig();
    if (config.toggles['kgSync'] === false) return;

    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    const sessionId: string = data.session_id ?? '';
    if (!sessionId) return;

    const cwd: string = data.cwd ?? process.cwd();

    const { evaluateKgSync } = await import('../hooks/kg-sync-hook.js');
    await evaluateKgSync(cwd, sessionId);
  },

  'kg-auto-init': async () => {
    const config = loadHooksConfig();
    if (config.toggles['kgAutoInit'] === false) return;

    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    const sessionId: string = data.session_id ?? '';
    if (!sessionId) return;

    const cwd: string = data.cwd ?? process.cwd();

    const { evaluateKgAutoInit } = await import('../hooks/kg-auto-init.js');
    await evaluateKgAutoInit(cwd, sessionId);
  },

  'kg-context-injector': async () => {
    const config = loadHooksConfig();
    if (config.toggles['kgContextInjector'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const toolInput = data.tool_input ?? {};
    const agentType: string = toolInput.subagent_type ?? '';
    if (!agentType) return;

    const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();
    const originalPrompt: string = toolInput.prompt ?? '';

    const { evaluateKgContextInjection } = await import('../hooks/kg-context-injector.js');
    const result = await evaluateKgContextInjection(agentType, originalPrompt, cwd);
    if (result.inject && result.content) {
      const augmentedPrompt = `${result.content}\n\n${originalPrompt}`;

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            ...toolInput,
            prompt: augmentedPrompt,
          },
        },
      }));
    }
  },

  'kg-unified-injector': async () => {
    const config = loadHooksConfig();
    if (config.toggles['kgUnifiedInjector'] !== true) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const prompt: string = data.user_prompt ?? data.prompt ?? '';
    const sessionId: string = data.session_id ?? '';
    if (!prompt || !sessionId) return;

    const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();

    const { evaluateUnifiedInjection } = await import('../graph/kg/surface/hook-injector.js');
    const result = await evaluateUnifiedInjection(prompt, null, cwd, sessionId);
    if (result.inject && result.content) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: data.hook_event_name || 'UserPromptSubmit',
          additionalContext: result.content,
        },
      }));
    }
  },

  'kg-unified-injector-agent': async () => {
    const config = loadHooksConfig();
    if (config.toggles['kgUnifiedInjector'] !== true) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const toolInput = data.tool_input ?? {};
    const agentType: string = toolInput.subagent_type ?? '';
    if (!agentType) return;

    const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();
    const sessionId: string = data.session_id ?? '';
    const originalPrompt: string = toolInput.prompt ?? '';

    const { evaluateUnifiedInjection } = await import('../graph/kg/surface/hook-injector.js');
    const result = await evaluateUnifiedInjection(originalPrompt, agentType, cwd, sessionId);
    if (result.inject && result.content) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            ...toolInput,
            prompt: `${result.content}\n\n${originalPrompt}`,
          },
        },
      }));
    }
  },

  'workflow-guard': async () => {
    const config = loadHooksConfig();
    if (config.toggles['workflowGuard'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const toolName: string = data.tool_name ?? '';
    const toolInput: string = typeof data.tool_input === 'string'
      ? data.tool_input
      : typeof data.tool_input?.command === 'string'
        ? data.tool_input.command
        : JSON.stringify(data.tool_input ?? '');

    const result = evaluateWorkflowGuard(toolName, toolInput);
    if (result.blocked) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: result.reason,
      }));
      process.exit(2);
    }

    // PathGuard: check Write/Edit file paths against directory boundaries
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath: string = data.tool_input?.file_path ?? data.tool_input?.path ?? '';
      if (filePath) {
        const workspace = resolveWorkspace(data);
        if (workspace) {
          const guardConfig = loadPathGuardConfig(workspace);
          const pathResult = evaluatePathGuard(toolName, filePath, workspace, guardConfig);
          if (pathResult.blocked) {
            process.stdout.write(JSON.stringify({
              decision: 'block',
              reason: pathResult.reason,
            }));
            process.exit(2);
          }
        }
      }
    }
  },

  'prompt-guard': async () => {
    const config = loadHooksConfig();
    if (config.toggles['promptGuard'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const prompt: string = data.user_prompt ?? data.prompt ?? '';
    if (!prompt) return;

    const result = evaluatePromptGuard(prompt);
    if (result.flagged) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: data.hook_event_name || 'UserPromptSubmit',
          additionalContext: result.warning,
        },
      }));
    }
  },

  'delegate-monitor': async () => {
    const raw = await readStdin();
    const data = JSON.parse(raw);
    const result = evaluateDelegateNotifications(data);
    if (result) {
      process.stdout.write(JSON.stringify(result));
    }
  },

  'spec-injector': async () => {
    const config = loadHooksConfig();
    if (config.toggles['specInjector'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const hookEventName: string = data.hook_event_name ?? '';
    const isSessionStart = hookEventName === 'SessionStart';

    // Codex SessionStart: inject specs as additionalContext (no agentType available)
    if (isSessionStart) {
      const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();
      const sessionId: string = data.session_id ?? '';
      const specConfig = loadSpecInjectionConfig(cwd);
      const result = evaluateSpecInjection('general', cwd, sessionId, specConfig);
      if (result.inject && result.content) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: result.content,
          },
        }));
      }
      return;
    }

    // Claude Code PreToolUse:Agent — rewrite agent prompt
    const toolInput = data.tool_input ?? {};
    const agentType: string = toolInput.subagent_type ?? '';
    if (!agentType) return;

    const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();
    const sessionId: string = data.session_id ?? '';

    const specConfig = loadSpecInjectionConfig(cwd);
    const result = evaluateSpecInjection(agentType, cwd, sessionId, specConfig);
    if (result.inject && result.content) {
      const originalPrompt: string = toolInput.prompt ?? '';
      // result.content is already a self-delimiting <maestro-context> block;
      // prepend with a single blank-line gap, no extra --- separator.
      const augmentedPrompt = `${result.content}\n\n${originalPrompt}`;

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            ...toolInput,
            prompt: augmentedPrompt,
          },
        },
      }));
    }
  },

  'session-context': async () => {
    const config = loadHooksConfig();
    if (config.toggles['sessionContext'] === false) return;

    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    const result = evaluateSessionContext(data);
    if (result) {
      process.stdout.write(JSON.stringify(result));
    }
  },

  'skill-context': async () => {
    const config = loadHooksConfig();
    if (config.toggles['skillContext'] === false) return;

    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    const prompt: string = data.user_prompt ?? data.prompt ?? '';
    if (!prompt) return;

    const cwd = data.cwd ?? process.cwd();
    const sessionId: string = data.session_id ?? '';
    const result = evaluateSkillContext({ user_prompt: prompt, cwd, session_id: sessionId });
    if (result) {
      process.stdout.write(JSON.stringify(result));
    }
  },

  'team-monitor': async () => {
    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    // Stop event has no tool_name; use 'turn_complete' as the action
    if (!data.tool_name) data.tool_name = 'turn_complete';
    runTeamMonitor(data);
  },

  'telemetry': async () => {
    const config = loadHooksConfig();
    if (config.toggles['telemetry'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const sessionId: string = data.session_id ?? '';
    if (!sessionId) return;

    const { tmpdir } = await import('node:os');
    const telemetryPath = join(tmpdir(), `maestro-telemetry-${sessionId}.jsonl`);
    const entry = JSON.stringify({
      event: 'turn_complete',
      timestamp: Date.now(),
    });
    const { appendFileSync } = await import('node:fs');
    appendFileSync(telemetryPath, entry + '\n');
  },

  'coordinator-tracker': async () => {
    const config = loadHooksConfig();
    if (config.toggles['coordinatorTracker'] === false) return;

    const raw = await readStdin();
    const data = JSON.parse(raw);
    const sessionId: string = data.session_id ?? '';
    if (!sessionId) return;

    const workspace = resolveWorkspace(data);
    if (!workspace) return;

    // Read status.json (/maestro & /maestro-coordinate)
    let bridgeData: CoordBridgeData | null = readMaestroSession(workspace);

    // Fallback: pick most recently updated session
    if (!bridgeData) {
      const existing = readCoordBridge(sessionId);
      bridgeData = readLatestSession(workspace, existing);
    }

    if (!bridgeData) return;
    bridgeData.session_id = sessionId;
    writeCoordBridge(sessionId, bridgeData);
  },
};

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerHooksCommand(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('Manage Claude Code hooks and run hook evaluators');

  // --- maestro hooks run <name> ---
  hooks
    .command('run <name>')
    .description('Run a hook evaluator (reads stdin JSON, writes stdout)')
    .action(async (name: string) => {
      const runner = HOOK_RUNNERS[name];
      if (!runner) {
        console.error(`Unknown hook: ${name}. Available: ${Object.keys(HOOK_RUNNERS).join(', ')}`);
        process.exit(1);
      }

      // Workspace gate — hooks with requiresWorkspace exit silently
      // when no Maestro workspace (.workflow/ + valid state.json) is found.
      // This avoids stdin parsing + evaluator overhead for non-workflow projects.
      const def = HOOK_DEFS[name] ?? CODEX_HOOK_DEFS[name] ?? AGY_HOOK_DEFS[name];
      const cwd = process.cwd();
      if (def?.requiresWorkspace) {
        if (!resolveWorkspace({ cwd })) {
          process.exit(0);
        }
      }

      // Pre-read stdin so runners get cached data and we can log input params
      const stdinRaw = await readStdin();
      const inputData = extractHookInputData(stdinRaw);

      // Track subprocess hook invocation
      const startMs = Date.now();
      let outcome = 'success';
      try {
        await runner();
      } catch {
        outcome = 'error';
        // Silent fail — never block tool execution
      }
      const durationMs = Date.now() - startMs;

      // Log hook call — only for spec-analytics-relevant hooks (whitelist)
      const SPEC_ANALYTICS_HOOKS = new Set(['spec-injector', 'keyword-spec-injector', 'kg-context-injector']);
      if (SPEC_ANALYTICS_HOOKS.has(name)) {
        try {
          const workspace = resolveWorkspace({ cwd });
          if (workspace) {
            const { logHookInvocation } = await import('../hooks/spec-analytics.js');
            logHookInvocation(workspace, {
              hookName: name,
              pluginName: 'subprocess',
              outcome,
              durationMs,
              data: { event: def?.event, ...inputData },
            });
          }
        } catch { /* swallow */ }
      }

      process.exit(0);
    });

  // --- maestro hooks install ---
  hooks
    .command('install')
    .description('Install maestro hooks into Claude Code or Codex settings')
    .option('--global', 'Install to global settings (default)')
    .option('--project', 'Install to project settings')
    .option('--level <level>', 'Hook level: minimal, standard, full (default: full)', 'full')
    .option('--target <target>', 'Target: claude (default) or codex', 'claude')
    .action((opts: { global?: boolean; project?: boolean; level?: string; target?: string }) => {
      const level = (opts.level ?? 'full') as HookLevel;
      if (!HOOK_LEVELS.includes(level) || level === 'none') {
        console.error(`Invalid level: ${opts.level}. Use: minimal, standard, full`);
        process.exitCode = 1;
        return;
      }

      if (opts.target === 'codex') {
        // Windows warning
        if (process.platform === 'win32') {
          console.log('Warning: Codex hooks are not yet supported on Windows.');
        }
        // Feature flag hint
        if (!checkCodexHooksFeatureFlag({ project: opts.project })) {
          console.log('Hint: Add codex_hooks = true to [features] in ~/.codex/config.toml to enable hooks.');
        }
        const result = installCodexHooksByLevel(level, { project: opts.project });
        console.log(`Maestro hooks installed for Codex (level: ${level}):`);
        for (const name of result.installedHooks) {
          const def = CODEX_HOOK_DEFS[name];
          const matcher = def.matcher ? ` [${def.matcher}]` : '';
          console.log(`  ${name}: ${def.event}${matcher}`);
        }
        console.log(`  Config: ${result.settingsPath}`);
      } else {
        const result = installHooksByLevel(level, { project: opts.project });
        console.log(`Maestro hooks installed (level: ${level}):`);
        for (const name of result.installedHooks) {
          const def = HOOK_DEFS[name];
          const matcher = def.matcher ? ` [${def.matcher}]` : '';
          console.log(`  ${name}: ${def.event}${matcher}`);
        }
        console.log(`  Settings: ${result.settingsPath}`);
      }
    });

  // --- maestro hooks uninstall ---
  hooks
    .command('uninstall')
    .description('Remove maestro hooks from Claude Code or Codex settings')
    .option('--global', 'Uninstall from global settings (default)')
    .option('--project', 'Uninstall from project settings')
    .option('--target <target>', 'Target: claude (default) or codex', 'claude')
    .action((opts: { global?: boolean; project?: boolean; target?: string }) => {
      if (opts.target === 'codex') {
        const hooksPath = getCodexHooksPath({ project: opts.project });
        if (!existsSync(hooksPath)) {
          console.log('No Codex hooks.json found — nothing to uninstall.');
          return;
        }
        const hooksFile = loadCodexHooks(hooksPath);
        removeCodexMaestroHooks(hooksFile);
        writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2));
        console.log(`Maestro hooks removed from ${hooksPath}`);
      } else {
        const settingsPath = opts.project
          ? join(process.cwd(), '.claude', 'settings.json')
          : getClaudeSettingsPath();

        if (!existsSync(settingsPath)) {
          console.log('No settings file found — nothing to uninstall.');
          return;
        }

        const settings = loadClaudeSettings(settingsPath);
        if (settings.statusLine?.command?.includes(HOOK_MARKER)) {
          delete settings.statusLine;
        }
        removeMaestroHooks(settings);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`Maestro hooks removed from ${settingsPath}`);
      }
    });

  // --- maestro hooks status ---
  hooks
    .command('status')
    .description('Show current hook installation status')
    .action(() => {
      // Claude Code hooks
      const globalPath = getClaudeSettingsPath();
      const projectPath = join(process.cwd(), '.claude', 'settings.json');

      console.log('Claude Code:');
      for (const [label, p] of [['  Global', globalPath], ['  Project', projectPath]] as const) {
        if (!existsSync(p)) {
          console.log(`${label}: no settings file`);
          continue;
        }
        const s = loadClaudeSettings(p);
        const hasStatusline = s.statusLine?.command?.includes(HOOK_MARKER) || false;

        console.log(`${label} (${p}):`);
        console.log(`    Statusline:        ${hasStatusline ? 'installed' : 'not installed'}`);
        for (const name of Object.keys(HOOK_DEFS)) {
          const installed = findHookInSettings(s, name);
          console.log(`    ${name}: ${installed ? 'installed' : 'not installed'}`);
        }
      }

      // Codex hooks
      const codexGlobalPath = getCodexHooksPath();
      const codexProjectPath = getCodexHooksPath({ project: true });

      console.log('\nCodex:');
      for (const [label, p] of [['  Global', codexGlobalPath], ['  Project', codexProjectPath]] as const) {
        if (!existsSync(p)) {
          console.log(`${label}: no hooks.json`);
          continue;
        }
        const hf = loadCodexHooks(p);
        console.log(`${label} (${p}):`);
        for (const name of Object.keys(CODEX_HOOK_DEFS)) {
          const def = CODEX_HOOK_DEFS[name];
          const groups = (hf.hooks?.[def.event] as CodexHookGroup[] | undefined) ?? [];
          const installed = groups.some((g) => g.hooks.some((h) => h.command.includes(`hooks run ${name}`)));
          console.log(`    ${name}: ${installed ? 'installed' : 'not installed'}`);
        }
      }
    });

  // --- maestro hooks config ---
  hooks
    .command('config')
    .description('Show current hook configuration (merged global + project)')
    .action(() => {
      const config = loadHooksConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  // --- maestro hooks toggle ---
  hooks
    .command('toggle <name> <state>')
    .description('Toggle a workflow hook on or off')
    .action((name: string, state: string) => {
      if (state !== 'on' && state !== 'off') {
        console.error('State must be "on" or "off".');
        process.exitCode = 1;
        return;
      }
      const config = loadConfig();
      if (!config.hooks) {
        config.hooks = { toggles: {}, external: [], plugins: [] };
      }
      config.hooks.toggles[name] = state === 'on';
      saveConfig(config);
      console.log(`Hook "${name}" toggled ${state}.`);
    });

  // --- maestro hooks analytics ---
  hooks
    .command('analytics')
    .alias('stats')
    .description('View hook invocation analytics and statistics')
    .option('--json', 'Output as JSON')
    .option('--recent <n>', 'Show last N hook events')
    .option('--hook <name>', 'Filter by hook name')
    .option('--clear', 'Archive current log and start fresh')
    .action(async (opts: { json?: boolean; recent?: string; hook?: string; clear?: boolean }) => {
      const { readAnalytics, readRecentAnalytics, getLogFileSize, clearAnalyticsLog } = await import('../hooks/spec-analytics.js');
      const cwd = process.cwd();
      const workspace = resolveWorkspace({ cwd }) ?? cwd;

      if (opts.clear) {
        const archived = clearAnalyticsLog(workspace);
        console.log(archived ? `\u2713 \u65E5\u5FD7\u5DF2\u5F52\u6863\u5230: ${archived}` : '\u65E0\u65E5\u5FD7\u6587\u4EF6\u53EF\u5F52\u6863\u3002');
        return;
      }

      // Read and filter hook entries
      const filterHookEntries = (entries: import('../hooks/spec-analytics.js').AnalyticsLogEntry[]) => {
        let hooks = entries.filter(e => e.type === 'hook') as Array<{ type: 'hook' } & import('../hooks/spec-analytics.js').HookInvocationLogEntry>;
        if (opts.hook) {
          hooks = hooks.filter(e => e.hookName === opts.hook);
        }
        return hooks;
      };

      if (opts.recent) {
        const n = parseInt(opts.recent, 10) || 30;
        const all = readRecentAnalytics(workspace, n * 5); // over-read then filter
        const hooks = filterHookEntries(all).slice(-n);

        if (hooks.length === 0) {
          console.log('\u6682\u65E0 Hook \u4E8B\u4EF6\u8BB0\u5F55\u3002');
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(hooks, null, 2));
          return;
        }

        console.log(`\nHook \u8FD1\u671F\u4E8B\u4EF6\uFF08\u6700\u8FD1 ${hooks.length} \u6761\uFF09\uFF1A\n`);
        for (const e of hooks) {
          const ts = e.timestamp.slice(11, 19);
          const dur = e.durationMs != null ? `${e.durationMs}ms` : '';
          const outcomeColor = e.outcome === 'error' ? '\x1b[31m' : '\x1b[32m';
          const plugin = e.pluginName === 'subprocess' ? '\u5B50\u8FDB\u7A0B' : '\u534F\u8C03\u5668';
          const nodeStr = e.nodeId ? ` \u8282\u70B9:${e.nodeId}` : '';
          const dataStr = e.data ? ` ${JSON.stringify(e.data)}` : '';
          console.log(`  ${ts}  ${outcomeColor}${(e.outcome ?? 'ok').padEnd(7)}\x1b[0m [${plugin}] ${e.hookName.padEnd(24)} ${dur.padStart(6)}${nodeStr}${dataStr}`);
        }
        return;
      }

      // Default: summary
      const all = readAnalytics(workspace);
      const hooks = filterHookEntries(all);

      if (hooks.length === 0) {
        console.log('\u6682\u65E0 Hook \u4E8B\u4EF6\u8BB0\u5F55\u3002Hook \u8C03\u7528\u4F1A\u81EA\u52A8\u8BB0\u5F55\u3002');
        return;
      }

      // Compute hook-specific stats
      const byName: Record<string, { total: number; errors: number; totalMs: number; durCount: number }> = {};
      const byPlugin: Record<string, number> = {};
      let totalDurMs = 0;
      let durCount = 0;

      for (const e of hooks) {
        const n = e.hookName;
        if (!byName[n]) byName[n] = { total: 0, errors: 0, totalMs: 0, durCount: 0 };
        byName[n].total++;
        if (e.outcome === 'error') byName[n].errors++;
        if (e.durationMs != null) {
          byName[n].totalMs += e.durationMs;
          byName[n].durCount++;
          totalDurMs += e.durationMs;
          durCount++;
        }
        const p = e.pluginName ?? '(unknown)';
        byPlugin[p] = (byPlugin[p] ?? 0) + 1;
      }

      if (opts.json) {
        const stats = {
          totalInvocations: hooks.length,
          avgDurationMs: durCount > 0 ? totalDurMs / durCount : 0,
          byHook: Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, {
            total: v.total,
            errors: v.errors,
            errorRate: v.total > 0 ? (v.errors / v.total * 100) : 0,
            avgDurationMs: v.durCount > 0 ? v.totalMs / v.durCount : 0,
          }])),
          byPlugin,
          timeRange: {
            earliest: hooks[0]?.timestamp ?? '',
            latest: hooks[hooks.length - 1]?.timestamp ?? '',
          },
        };
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      // Formatted output
      const fileSize = getLogFileSize(workspace);
      const earliest = hooks[0]?.timestamp?.slice(0, 10) ?? '\u2014';
      const latest = hooks[hooks.length - 1]?.timestamp?.slice(0, 10) ?? '\u2014';

      console.log('\nHook \u5206\u6790\u62A5\u544A');
      console.log('============\n');
      console.log(`  \u603B\u8C03\u7528\u6B21\u6570:      ${hooks.length}`);
      if (durCount > 0) console.log(`  \u5E73\u5747\u8017\u65F6:        ${(totalDurMs / durCount).toFixed(1)}ms`);

      // By type (subprocess vs coordinator)
      console.log('\n  \u6309\u7C7B\u578B:');
      for (const [p, count] of Object.entries(byPlugin).sort((a, b) => b[1] - a[1])) {
        const label = p === 'subprocess' ? '\u5B50\u8FDB\u7A0B (Claude Code / Codex)' : p === 'specAnalytics' ? '\u534F\u8C03\u5668 (\u8FDB\u7A0B\u5185)' : p;
        console.log(`    ${label.padEnd(36)} ${count}`);
      }

      // By hook name
      const sorted = Object.entries(byName).sort((a, b) => b[1].total - a[1].total);
      console.log('\n  \u6309 Hook:');
      console.log(`    ${'Hook'.padEnd(28)} ${'\u603B\u6570'.padStart(6)} ${'\u9519\u8BEF'.padStart(6)} ${'\u9519\u8BEF\u7387'.padStart(7)} ${'\u5E73\u5747ms'.padStart(8)}`);
      console.log(`    ${'─'.repeat(28)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(8)}`);
      for (const [name, s] of sorted) {
        const errRate = s.total > 0 ? (s.errors / s.total * 100).toFixed(1) : '0.0';
        const avgMs = s.durCount > 0 ? (s.totalMs / s.durCount).toFixed(1) : '\u2014';
        const errColor = s.errors > 0 ? '\x1b[31m' : '';
        const reset = s.errors > 0 ? '\x1b[0m' : '';
        console.log(`    ${name.padEnd(28)} ${String(s.total).padStart(6)} ${errColor}${String(s.errors).padStart(6)}${reset} ${(errRate + '%').padStart(7)} ${String(avgMs).padStart(8)}`);
      }

      console.log(`\n  \u65E5\u5FD7: ${(fileSize / 1024).toFixed(1)} KB | ${earliest} ~ ${latest}`);
      if (opts.hook) console.log(`  \u8FC7\u6EE4: --hook ${opts.hook}`);
    });

  // --- maestro hooks list ---
  hooks
    .command('list')
    .description('List all hooks with toggle status')
    .action(() => {
      const config = loadHooksConfig();

      console.log('Claude Code hooks (subprocess):');
      for (const [name, def] of Object.entries(HOOK_DEFS)) {
        const toggleKey = name === 'workflow-guard' ? 'workflowGuard'
          : name === 'preflight-guard' ? 'preflightGuard'
          : name === 'prompt-guard' ? 'promptGuard'
          : name === 'delegate-monitor' ? 'delegateMonitor'
          : name === 'team-monitor' ? 'teamMonitor'
          : name === 'spec-injector' ? 'specInjector'
          : name === 'session-context' ? 'sessionContext'
          : name === 'skill-context' ? 'skillContext'
          : name === 'coordinator-tracker' ? 'coordinatorTracker'
          : name === 'spec-validator' ? 'specValidator'
          : name === 'keyword-spec-injector' ? 'keywordSpecInjector'
          : name === 'kg-sync' ? 'kgSync'
          : name === 'kg-auto-init' ? 'kgAutoInit'
          : name === 'kg-context-injector' ? 'kgContextInjector'
          : name === 'kg-unified-injector' ? 'kgUnifiedInjector'
          : name === 'kg-unified-injector-agent' ? 'kgUnifiedInjector'
          : name;
        const enabled = config.toggles[toggleKey] !== false;
        const matcher = def.matcher ? ` [${def.matcher}]` : '';
        const wf = def.requiresWorkspace ? ' (workspace)' : '';
        console.log(`  ${name}: ${def.event}${matcher} — ${enabled ? 'enabled' : 'disabled'} (level: ${def.level})${wf}`);
      }

      console.log('\nCodex hooks (subprocess):');
      for (const [name, def] of Object.entries(CODEX_HOOK_DEFS)) {
        const matcher = def.matcher ? ` [${def.matcher}]` : '';
        const wf = def.requiresWorkspace ? ' (workspace)' : '';
        console.log(`  ${name}: ${def.event}${matcher} (level: ${def.level})${wf}`);
      }

      console.log('\nCoordinator hooks (in-process):');
      const INTERNAL_HOOKS = [
        'beforeRun', 'afterRun', 'beforeNode', 'afterNode',
        'beforeCommand', 'afterCommand', 'onError', 'transformPrompt', 'onDecision',
      ];
      for (const name of INTERNAL_HOOKS) {
        const enabled = config.toggles[name] !== false;
        console.log(`  ${name}: ${enabled ? 'enabled' : 'disabled'}`);
      }
    });
}
