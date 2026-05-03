// ---------------------------------------------------------------------------
// `maestro config` — unified configuration hub (TUI + CLI)
//
// Structure:
//   maestro config                → unified TUI hub (tab: Skills / Delegate)
//   maestro config skills         → skills TUI dashboard
//   maestro config skills show    → print skill configs (non-interactive)
//   maestro config skills set     → set a param default
//   maestro config skills unset   → remove a param default
//   maestro config skills reset   → clear all defaults for a skill
//   maestro config skills list    → list all configurable skills
//   maestro config skills edit    → TUI editor for a specific skill
//   maestro config delegate       → delegate tools TUI dashboard
//   maestro config delegate show  → print tools & roles summary
//   maestro config delegate list  → tools overview (TUI)
//   maestro config delegate roles → role mappings (TUI)
//   maestro config delegate register → register settings file (TUI)
//   maestro config delegate ref   → command reference (TUI)
//   maestro config delegate config → config sources (TUI)
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Check if the skill-context hook is installed in Claude Code settings.
 * Direct file read — no dependency on hooks module to stay ESM-clean.
 */
export function checkSkillContextHook(): 'installed' | 'not-installed' {
  try {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    if (!existsSync(settingsPath)) return 'not-installed';
    const raw = readFileSync(settingsPath, 'utf8');
    return raw.includes('skill-context') ? 'installed' : 'not-installed';
  } catch {
    return 'not-installed';
  }
}

function printHookWarning(): void {
  console.log('\n⚠  skill-context hook is not installed. Parameter injection will not work.');
  console.log('   Run: maestro hooks install --level standard');
  console.log('   Or:  maestro install hooks\n');
}

async function printShow(skillName?: string, json?: boolean) {
  const { loadSkillConfig } = await import('../config/skill-config.js');
  const config = loadSkillConfig(process.cwd());
  const skills = skillName
    ? (config.skills[skillName] ? { [skillName]: config.skills[skillName] } : {})
    : config.skills;

  if (json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  const entries = Object.entries(skills);
  if (entries.length === 0) {
    console.log(skillName ? `No config for "${skillName}"` : 'No skill configs set.');
    return;
  }

  for (const [name, defaults] of entries) {
    console.log(`\n${name}:`);
    for (const [param, value] of Object.entries(defaults.params)) {
      console.log(`  ${param.padEnd(20)} ${value}`);
    }
    if (defaults.updated) {
      console.log(`  ${'updated'.padEnd(20)} ${defaults.updated}`);
    }
  }

  // Check hook status when configs exist
  if (entries.length > 0 && checkSkillContextHook() === 'not-installed') {
    printHookWarning();
  }
}

async function printList() {
  const { loadAllCommandDefs, getConfigurableParams } = await import('../config/argument-hint-parser.js');
  const { loadSkillConfig } = await import('../config/skill-config.js');

  const defs = loadAllCommandDefs(process.cwd());
  const config = loadSkillConfig(process.cwd());

  const sorted = [...defs.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`\n${'Skill'.padEnd(30)} ${'Params'.padEnd(8)} ${'Configured'.padEnd(12)} Hint`);
  console.log('─'.repeat(90));

  for (const [name, def] of sorted) {
    const configurable = getConfigurableParams(def.params);
    const configured = config.skills[name];
    const cfgCount = configured ? Object.keys(configured.params).length : 0;
    const hint = def.argumentHint.length > 40
      ? def.argumentHint.slice(0, 37) + '...'
      : def.argumentHint;

    const cfgLabel = cfgCount > 0 ? `${cfgCount} set` : '—';
    console.log(
      `${name.padEnd(30)} ${String(configurable.length).padEnd(8)} ${cfgLabel.padEnd(12)} ${hint}`,
    );
  }

  console.log(`\nTotal: ${sorted.length} skills`);
}

function parseValue(raw: string): string | boolean | number {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  return raw;
}

async function printDelegateShow(json: boolean) {
  const { loadCliToolsConfig, selectToolByRole, getDefaultRoleMappings, DELEGATE_ROLES } = await import('../config/cli-tools-config.js');
  const config = await loadCliToolsConfig(process.cwd());
  const tools = Object.entries(config.tools);
  const roles = getDefaultRoleMappings();
  const userRoles = config.roles ?? {};

  if (json) {
    const out = {
      tools: Object.fromEntries(tools.map(([name, e]) => [name, {
        enabled: e.enabled, model: e.primaryModel, tags: e.tags,
        ...(e.settingsFile ? { settings: e.settingsFile } : {}),
        ...(e.baseTool ? { baseTool: e.baseTool } : {}),
      }])),
      roles: Object.fromEntries(DELEGATE_ROLES.map(r => {
        const resolved = selectToolByRole(r, config);
        const src = userRoles[r] ? 'user' : 'default';
        return [r, { tool: resolved?.name ?? '(none)', source: src }];
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Text output
  console.log('Tools:');
  if (tools.length === 0) {
    console.log('  (none configured)');
  } else {
    for (const [name, entry] of tools) {
      const icon = entry.enabled ? '✓' : '✗';
      const tags = entry.tags?.length ? `[${entry.tags.join(', ')}]` : '';
      const settings = entry.settingsFile ? ` settings=${entry.settingsFile}` : '';
      const base = entry.baseTool ? ` (→${entry.baseTool})` : '';
      console.log(`  ${icon} ${name.padEnd(14)} ${(entry.primaryModel || '—').padEnd(26)} ${tags}${settings}${base}`);
    }
  }

  console.log('\nRoles:');
  for (const role of DELEGATE_ROLES) {
    const resolved = selectToolByRole(role, config);
    const src = userRoles[role] ? '*' : ' ';
    console.log(`  ${src}${role.padEnd(14)} → ${resolved?.name ?? '(none)'}`);
  }
}

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .alias('cfg')
    .description('Unified configuration hub (Skills, Delegate, Hooks, Overlay, Specs, Install)')
    .action(async () => {
      const { runConfigHub } = await import('../tui/config-ui/index.js');
      await runConfigHub();
    });

  // ---------------------------------------------------------------------------
  // maestro config skills — skill parameter defaults
  // ---------------------------------------------------------------------------

  const skills = cmd
    .command('skills')
    .alias('sk')
    .description('Skill parameter defaults (TUI)')
    .action(async () => {
      const { runConfigTui } = await import('../tui/config-ui/index.js');
      await runConfigTui('dashboard');
    });

  skills.command('show')
    .description('Print skill config(s)')
    .argument('[skill]', 'Specific skill name')
    .option('--json', 'Output as JSON')
    .action(async (skill: string | undefined, opts: { json?: boolean }) => {
      await printShow(skill, opts.json);
    });

  skills.command('set')
    .description('Set a parameter default (e.g. maestro config skills set maestro-execute auto-commit true)')
    .argument('<skill>', 'Skill name (e.g. maestro-execute)')
    .argument('<param>', 'Parameter name without -- prefix (e.g. auto-commit, y, method)')
    .argument('<value>', 'Default value')
    .option('-g, --global', 'Save to global config', false)
    .action(async (skill: string, param: string, value: string, opts: { global?: boolean }) => {
      const { setSkillParam } = await import('../config/skill-config.js');
      const scope = opts.global ? 'global' : 'workspace';
      const workDir = opts.global ? undefined : process.cwd();

      const paramName = param.startsWith('-') ? param : (param.length === 1 ? `-${param}` : `--${param}`);
      setSkillParam(skill, paramName, parseValue(value), scope, workDir);
      console.log(`✓ ${skill}: ${paramName} = ${value} (${scope})`);

      if (checkSkillContextHook() === 'not-installed') {
        printHookWarning();
      }
    });

  skills.command('unset')
    .description('Remove a parameter default')
    .argument('<skill>', 'Skill name')
    .argument('<param>', 'Parameter name without -- prefix')
    .option('-g, --global', 'Remove from global config', false)
    .action(async (skill: string, param: string, opts: { global?: boolean }) => {
      const { unsetSkillParam } = await import('../config/skill-config.js');
      const scope = opts.global ? 'global' : 'workspace';
      const workDir = opts.global ? undefined : process.cwd();

      const paramName = param.startsWith('-') ? param : (param.length === 1 ? `-${param}` : `--${param}`);
      unsetSkillParam(skill, paramName, scope, workDir);
      console.log(`✓ Removed ${skill}: ${paramName} (${scope})`);
    });

  skills.command('reset')
    .description('Clear all defaults for a skill (or all skills)')
    .argument('[skill]', 'Skill name (omit for all)')
    .option('-g, --global', 'Reset global config', false)
    .action(async (skill: string | undefined, opts: { global?: boolean }) => {
      const { resetSkillConfig } = await import('../config/skill-config.js');
      const scope = opts.global ? 'global' : 'workspace';
      const workDir = opts.global ? undefined : process.cwd();

      resetSkillConfig(skill, scope, workDir);
      console.log(`✓ Reset ${skill ?? 'all skills'} (${scope})`);
    });

  skills.command('list')
    .description('List all configurable skills and their parameters')
    .action(async () => { await printList(); });

  skills.command('edit')
    .description('Open TUI editor for a specific skill')
    .argument('<skill>', 'Skill name')
    .action(async (skill: string) => {
      const { runConfigTui } = await import('../tui/config-ui/index.js');
      await runConfigTui('editor', skill);
    });

  // ---------------------------------------------------------------------------
  // maestro config delegate — delegate tool & role configuration
  // ---------------------------------------------------------------------------

  const delegate = cmd
    .command('delegate')
    .alias('dl')
    .description('Delegate tool configuration (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('dashboard');
    });

  delegate.command('show')
    .description('Print tools & roles summary (non-interactive)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => printDelegateShow(!!opts.json));

  delegate.command('list')
    .description('Tools overview (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('tools');
    });

  delegate.command('roles')
    .description('Role mappings (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('roles');
    });

  delegate.command('register')
    .description('Register settings file (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('register');
    });

  delegate.command('ref')
    .description('Command reference (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('reference');
    });

  delegate.command('config')
    .description('Config sources (global/workspace) (TUI)')
    .action(async () => {
      const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
      await runDelegateConfigTui('sources');
    });

  // ---------------------------------------------------------------------------
  // maestro config hooks — hook status panel
  // ---------------------------------------------------------------------------

  cmd.command('hooks')
    .description('Hook installation status (TUI)')
    .action(async () => {
      const { runHooksTui } = await import('../tui/config-ui/index.js');
      await runHooksTui();
    });

  // ---------------------------------------------------------------------------
  // maestro config overlay — overlay management panel
  // ---------------------------------------------------------------------------

  cmd.command('overlay')
    .description('Overlay management (TUI)')
    .action(async () => {
      const { runOverlayTui } = await import('../tui/config-ui/index.js');
      await runOverlayTui();
    });

  // ---------------------------------------------------------------------------
  // maestro config specs — spec system panel
  // ---------------------------------------------------------------------------

  cmd.command('specs')
    .description('Spec system status (TUI)')
    .action(async () => {
      const { runSpecsTui } = await import('../tui/config-ui/index.js');
      await runSpecsTui();
    });

  // ---------------------------------------------------------------------------
  // maestro config install — install/uninstall panel
  // ---------------------------------------------------------------------------

  cmd.command('install')
    .description('Install / uninstall panel (TUI)')
    .action(async () => {
      const { runInstallTui } = await import('../tui/config-ui/index.js');
      await runInstallTui();
    });
}
