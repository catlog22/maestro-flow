// ---------------------------------------------------------------------------
// `maestro delegate-config` — alias for `maestro config delegate`
//
// Kept for backward compatibility. All logic now lives in config.ts;
// this module just re-routes to `config delegate` TUI/CLI via the
// unified config-ui entry point.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';

type InitialView = 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';

async function launchTui(initialView: InitialView = 'dashboard') {
  const { runDelegateConfigTui } = await import('../tui/config-ui/index.js');
  await runDelegateConfigTui(initialView);
}

async function printShow(json: boolean) {
  const { loadCliToolsConfig, selectToolByRole, getDefaultRoleMappings, DELEGATE_ROLES } = await import('../config/cli-tools-config.js');
  const config = await loadCliToolsConfig(process.cwd());
  const tools = Object.entries(config.tools);
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

export function registerToolsCommand(program: Command): void {
  const cmd = program
    .command('delegate-config')
    .alias('dc')
    .description('Delegate tool configuration (alias for: maestro config delegate)')
    .action(async () => launchTui('dashboard'));

  cmd.command('show').description('Print tools & roles summary (non-interactive)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => printShow(!!opts.json));
  cmd.command('list').description('Tools overview').action(() => launchTui('tools'));
  cmd.command('roles').description('Role mappings').action(() => launchTui('roles'));
  cmd.command('register').description('Register settings file').action(() => launchTui('register'));
  cmd.command('ref').description('Command reference').action(() => launchTui('reference'));
  cmd.command('config').description('Config sources (global/workspace)').action(() => launchTui('sources'));
}
