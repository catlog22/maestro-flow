// ---------------------------------------------------------------------------
// `maestro delegate-config` — interactive TUI + CLI for delegate tool config
//
// Subcommands:
//   maestro delegate-config            → dashboard (TUI)
//   maestro delegate-config show       → print tools & roles summary (non-interactive)
//   maestro delegate-config list       → tools overview (TUI)
//   maestro delegate-config roles      → role mappings (TUI)
//   maestro delegate-config register   → register settings file (TUI)
//   maestro delegate-config ref        → command reference (TUI)
//   maestro delegate-config config     → global/workspace config sources (TUI)
// ---------------------------------------------------------------------------

import type { Command } from 'commander';

type InitialView = 'dashboard' | 'tools' | 'roles' | 'register' | 'reference' | 'sources';

async function launchTui(initialView: InitialView = 'dashboard') {
  const { render } = await import('ink');
  const React = await import('react');
  const { ToolsDashboard } = await import('./tools-ui/ToolsDashboard.js');

  const { waitUntilExit } = render(
    React.createElement(ToolsDashboard, { workDir: process.cwd(), initialView }),
  );
  await waitUntilExit();
}

async function printShow(json: boolean) {
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

export function registerToolsCommand(program: Command): void {
  const cmd = program
    .command('delegate-config')
    .alias('dc')
    .description('Interactive TUI for delegate tool configuration and role mappings')
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
