import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { paths } from '../config/paths.js';
import { loadConfig, saveConfig, loadHooksConfig } from '../config/index.js';
import { evaluateWorkflowGuard } from '../hooks/guards/workflow-guard.js';
import { evaluatePromptGuard } from '../hooks/guards/prompt-guard.js';
import { evaluateContext } from '../hooks/context-monitor.js';
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

interface ClaudeSettings {
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
 * - `minimal`:  Statusline + context-monitor (safe monitoring)
 * - `standard`: + delegate-monitor, team-monitor, telemetry (full monitoring)
 * - `full`:     + workflow-guard (PreToolUse), prompt-guard (UserPromptSubmit)
 */
export type HookLevel = 'none' | 'minimal' | 'standard' | 'full';

export const HOOK_LEVELS: readonly HookLevel[] = ['none', 'minimal', 'standard', 'full'];

export const HOOK_LEVEL_DESCRIPTIONS: Record<HookLevel, string> = {
  none: 'No hooks',
  minimal: 'Statusline + context-monitor + spec-injector',
  standard: '+ delegate-monitor + team/telemetry/coordinator(Stop) + session-context + skill-context',
  full: '+ workflow-guard (PreToolUse)',
};

const HOOK_DEFS: Record<string, HookDef> = {
  'context-monitor': { event: 'PostToolUse', level: 'minimal' },
  'spec-injector': { event: 'PreToolUse', matcher: 'Agent', level: 'minimal', requiresWorkspace: true },
  'delegate-monitor': { event: 'PostToolUse', matcher: 'Bash|Agent', level: 'standard' },
  'team-monitor': { event: 'Stop', level: 'standard' },
  'telemetry': { event: 'Stop', level: 'standard' },
  'session-context': { event: 'Notification', level: 'standard' },
  'skill-context': { event: 'UserPromptSubmit', level: 'standard', requiresWorkspace: true },
  'coordinator-tracker': { event: 'Stop', level: 'standard', requiresWorkspace: true },
  'workflow-guard': { event: 'PreToolUse', matcher: 'Bash|Write|Edit', level: 'full', requiresWorkspace: true },
};

/** Numeric ordering for level comparison */
const LEVEL_ORDER: Record<HookLevel, number> = { none: 0, minimal: 1, standard: 2, full: 3 };

function hookIncludedInLevel(hookLevel: HookLevel, targetLevel: HookLevel): boolean {
  return LEVEL_ORDER[hookLevel] <= LEVEL_ORDER[targetLevel];
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function getClaudeSettingsPath(): string {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(claudeDir, 'settings.json');
}

function loadClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

function getMaestroBinDir(): string {
  return resolve(new URL('../../bin', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
}

const HOOK_MARKER = 'maestro';

function removeMaestroHooks(settings: ClaudeSettings): void {
  if (!settings.hooks) return;
  for (const eventKey of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop'] as const) {
    const groups = settings.hooks[eventKey] as HookGroup[] | undefined;
    if (!groups) continue;
    for (const group of groups) {
      group.hooks = group.hooks.filter((h) => !h.command.includes(HOOK_MARKER));
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
 * Install hooks at the given level into Claude Code settings.json.
 * @param level  Hook level to install
 * @param opts   `project` to use project-scoped settings, otherwise global
 */
export function installHooksByLevel(
  level: HookLevel,
  opts: { project?: boolean; settingsPath?: string } = {},
): InstallHooksResult {
  if (level === 'none') {
    return { settingsPath: '', installedHooks: [], level };
  }

  const settingsPath = opts.settingsPath
    ?? (opts.project
      ? join(process.cwd(), '.claude', 'settings.json')
      : getClaudeSettingsPath());

  const settings = loadClaudeSettings(settingsPath);

  // --- Statusline (always with any hook level) ---
  settings.statusLine = { type: 'command', command: 'maestro-statusline' };

  // --- Remove existing maestro hooks to avoid duplicates ---
  removeMaestroHooks(settings);

  // --- Register hooks matching the requested level ---
  if (!settings.hooks) settings.hooks = {};

  const installedHooks: string[] = [];
  for (const [name, def] of Object.entries(HOOK_DEFS)) {
    if (!hookIncludedInLevel(def.level, level)) continue;

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
// Stdin reader for hook runners
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let input = '';
    const timeout = setTimeout(() => resolve(input), 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(input);
    });
  });
}

// ---------------------------------------------------------------------------
// Hook runners — each reads stdin, calls pure evaluator, writes stdout
// ---------------------------------------------------------------------------

type HookRunner = () => Promise<void>;

const HOOK_RUNNERS: Record<string, HookRunner> = {
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
          hookEventName: 'UserPromptSubmit',
          additionalContext: result.warning,
        },
      }));
    }
  },

  'context-monitor': async () => {
    const raw = await readStdin();
    const data = JSON.parse(raw);
    const result = evaluateContext(data);
    if (result) {
      process.stdout.write(JSON.stringify(result));
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
    const toolInput = data.tool_input ?? {};
    const agentType: string = toolInput.subagent_type ?? '';
    if (!agentType) return;

    const cwd = resolveWorkspace(data) ?? data.cwd ?? process.cwd();
    const sessionId: string = data.session_id ?? '';

    const result = evaluateSpecInjection(agentType, cwd, sessionId);
    if (result.inject && result.content) {
      const originalPrompt: string = toolInput.prompt ?? '';
      const augmentedPrompt = `${result.content}\n\n---\n\n${originalPrompt}`;

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
      const def = HOOK_DEFS[name];
      if (def?.requiresWorkspace) {
        const cwd = process.cwd();
        if (!resolveWorkspace({ cwd })) {
          process.exit(0);
        }
      }

      try {
        await runner();
      } catch {
        // Silent fail — never block tool execution
      }
      process.exit(0);
    });

  // --- maestro hooks install ---
  hooks
    .command('install')
    .description('Install maestro hooks into Claude Code settings')
    .option('--global', 'Install to global ~/.claude/settings.json (default)')
    .option('--project', 'Install to project .claude/settings.json')
    .option('--level <level>', 'Hook level: minimal, standard, full (default: full)', 'full')
    .action((opts: { global?: boolean; project?: boolean; level?: string }) => {
      const level = (opts.level ?? 'full') as HookLevel;
      if (!HOOK_LEVELS.includes(level) || level === 'none') {
        console.error(`Invalid level: ${opts.level}. Use: minimal, standard, full`);
        process.exitCode = 1;
        return;
      }

      const result = installHooksByLevel(level, { project: opts.project });
      console.log(`Maestro hooks installed (level: ${level}):`);
      console.log(`  Statusline: installed`);
      for (const name of result.installedHooks) {
        const def = HOOK_DEFS[name];
        const matcher = def.matcher ? ` [${def.matcher}]` : '';
        console.log(`  ${name}: ${def.event}${matcher}`);
      }
      console.log(`  Settings: ${result.settingsPath}`);
    });

  // --- maestro hooks uninstall ---
  hooks
    .command('uninstall')
    .description('Remove maestro hooks from Claude Code settings')
    .option('--global', 'Uninstall from global ~/.claude/settings.json (default)')
    .option('--project', 'Uninstall from project .claude/settings.json')
    .action((opts) => {
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
    });

  // --- maestro hooks status ---
  hooks
    .command('status')
    .description('Show current hook installation status')
    .action(() => {
      const globalPath = getClaudeSettingsPath();
      const projectPath = join(process.cwd(), '.claude', 'settings.json');

      for (const [label, p] of [['Global', globalPath], ['Project', projectPath]] as const) {
        if (!existsSync(p)) {
          console.log(`${label}: no settings file`);
          continue;
        }
        const s = loadClaudeSettings(p);
        const hasStatusline = s.statusLine?.command?.includes(HOOK_MARKER) || false;

        console.log(`${label} (${p}):`);
        console.log(`  Statusline:        ${hasStatusline ? 'installed' : 'not installed'}`);
        for (const name of Object.keys(HOOK_DEFS)) {
          const installed = findHookInSettings(s, name);
          console.log(`  ${name}: ${installed ? 'installed' : 'not installed'}`);
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

  // --- maestro hooks list ---
  hooks
    .command('list')
    .description('List all hooks with toggle status')
    .action(() => {
      const config = loadHooksConfig();

      console.log('Claude Code hooks (subprocess):');
      for (const [name, def] of Object.entries(HOOK_DEFS)) {
        const toggleKey = name === 'workflow-guard' ? 'workflowGuard'
          : name === 'prompt-guard' ? 'promptGuard'
          : name === 'context-monitor' ? 'contextMonitor'
          : name === 'delegate-monitor' ? 'delegateMonitor'
          : name === 'team-monitor' ? 'teamMonitor'
          : name === 'spec-injector' ? 'specInjector'
          : name === 'session-context' ? 'sessionContext'
          : name === 'skill-context' ? 'skillContext'
          : name === 'coordinator-tracker' ? 'coordinatorTracker'
          : name;
        const enabled = config.toggles[toggleKey] !== false;
        const matcher = def.matcher ? ` [${def.matcher}]` : '';
        const wf = def.requiresWorkspace ? ' (workspace)' : '';
        console.log(`  ${name}: ${def.event}${matcher} — ${enabled ? 'enabled' : 'disabled'} (level: ${def.level})${wf}`);
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
