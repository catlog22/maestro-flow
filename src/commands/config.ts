// ---------------------------------------------------------------------------
// `maestro config` — skill parameter defaults management (TUI + CLI)
//
// Subcommands:
//   maestro config            → dashboard (TUI)
//   maestro config show       → print all skill configs (non-interactive)
//   maestro config set        → set a param default
//   maestro config unset      → remove a param default
//   maestro config reset      → clear all defaults for a skill
//   maestro config list       → list all configurable skills
//   maestro config edit       → TUI editor for a specific skill
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

type InitialView = 'dashboard' | 'skills' | 'editor' | 'sources';

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

async function launchTui(initialView: InitialView = 'dashboard', editSkill?: string) {
  const { render } = await import('ink');
  const React = await import('react');
  const { SkillConfigDashboard } = await import('./config-ui/SkillConfigDashboard.js');

  const { waitUntilExit } = render(
    React.createElement(SkillConfigDashboard, {
      workDir: process.cwd(),
      initialView,
      editSkill,
    }),
  );
  await waitUntilExit();
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

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .alias('cfg')
    .description('Manage skill parameter defaults (TUI + CLI)')
    .action(async () => launchTui('dashboard'));

  cmd.command('show')
    .description('Print skill config(s)')
    .argument('[skill]', 'Specific skill name')
    .option('--json', 'Output as JSON')
    .action(async (skill: string | undefined, opts: { json?: boolean }) => {
      await printShow(skill, opts.json);
    });

  cmd.command('set')
    .description('Set a parameter default (e.g. maestro config set maestro-execute auto-commit true)')
    .argument('<skill>', 'Skill name (e.g. maestro-execute)')
    .argument('<param>', 'Parameter name without -- prefix (e.g. auto-commit, y, method)')
    .argument('<value>', 'Default value')
    .option('-g, --global', 'Save to global config', false)
    .action(async (skill: string, param: string, value: string, opts: { global?: boolean }) => {
      const { setSkillParam } = await import('../config/skill-config.js');
      const scope = opts.global ? 'global' : 'workspace';
      const workDir = opts.global ? undefined : process.cwd();

      // Normalize: add -- prefix for long params, - for single char
      const paramName = param.startsWith('-') ? param : (param.length === 1 ? `-${param}` : `--${param}`);
      setSkillParam(skill, paramName, parseValue(value), scope, workDir);
      console.log(`✓ ${skill}: ${paramName} = ${value} (${scope})`);

      // Check if skill-context hook is installed
      if (checkSkillContextHook() === 'not-installed') {
        printHookWarning();
      }
    });

  cmd.command('unset')
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

  cmd.command('reset')
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

  cmd.command('list')
    .description('List all configurable skills and their parameters')
    .action(async () => { await printList(); });

  cmd.command('edit')
    .description('Open TUI editor for a specific skill')
    .argument('<skill>', 'Skill name')
    .action(async (skill: string) => launchTui('editor', skill));
}
