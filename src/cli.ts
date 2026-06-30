// Suppress Node.js experimental feature warnings (e.g. SQLite)
const _origEmit = process.emit;
// @ts-expect-error — override emit to filter ExperimentalWarning
process.emit = function (event: string, ...args: unknown[]) {
  if (event === 'warning' && (args[0] as { name?: string })?.name === 'ExperimentalWarning') {
    return false;
  }
  // @ts-expect-error — spread to original emit
  return _origEmit.call(process, event, ...args);
};

import { Command } from 'commander';
import { getPackageVersion } from './utils/get-version.js';

const program = new Command();

program
  .name('maestro')
  .description('Workflow orchestration CLI with MCP support and extensible architecture')
  .version(getPackageVersion());

// ---------------------------------------------------------------------------
// Lazy command registration
//
// Each command module is loaded only when its command is actually invoked.
// The lazy() helper registers a stub command that, on first access, replaces
// itself with the real registration and re-parses argv.
// ---------------------------------------------------------------------------

const commandLoaders: Record<string, () => Promise<(p: Command) => void>> = {
  serve:      async () => (await import('./commands/serve.js')).registerServeCommand,
  run:        async () => (await import('./commands/run.js')).registerRunCommand,
  ext:        async () => (await import('./commands/ext.js')).registerExtCommand,
  tool:       async () => (await import('./commands/tool.js')).registerToolCommand,
  cli:        async () => (await import('./commands/cli.js')).registerCliCommand,
  install:    async () => (await import('./commands/install.js')).registerInstallCommand,
  uninstall:  async () => (await import('./commands/uninstall.js')).registerUninstallCommand,
  plugin:     async () => (await import('./commands/plugin.js')).registerPluginCommand,
  view:       async () => (await import('./commands/view.js')).registerViewCommand,
  stop:       async () => (await import('./commands/stop.js')).registerStopCommand,

  spec:       async () => (await import('./commands/spec.js')).registerSpecCommand,
  wiki:       async () => (await import('./commands/wiki.js')).registerWikiCommand,
  hooks:      async () => (await import('./commands/hooks.js')).registerHooksCommand,
  coordinate: async () => (await import('./commands/coordinate.js')).registerCoordinateCommand,
  ralph:      async () => (await import('./commands/ralph.js')).registerRalphCommand,
  brain:      async () => (await import('./commands/brain.js')).registerBrainCommand,
  launcher:   async () => (await import('./commands/launcher.js')).registerLauncherCommand,
  delegate:   async () => (await import('./commands/delegate.js')).registerDelegateCommand,
  'agent-msg': async () => (await import('./commands/msg.js')).registerMsgCommand,
  msg:        async () => (await import('./commands/msg.js')).registerMsgCommand,
  overlay:    async () => (await import('./commands/overlay.js')).registerOverlayCommand,
  collab:     async () => (await import('./commands/collab.js')).registerCollabCommand,
  team:       async () => (await import('./commands/collab.js')).registerCollabCommand,
  update:     async () => (await import('./commands/update.js')).registerUpdateCommand,
  'brainstorm-visualize': async () => (await import('./commands/brainstorm-visualize.js')).registerBrainstormVisualizeCommand,
  bv:         async () => (await import('./commands/brainstorm-visualize.js')).registerBrainstormVisualizeCommand,
  knowhow:    async () => (await import('./commands/knowhow.js')).registerKnowhowCommand,
  kh:         async () => (await import('./commands/knowhow.js')).registerKnowhowCommand,
  'delegate-config': async () => (await import('./commands/tools.js')).registerToolsCommand,
  dc:                async () => (await import('./commands/tools.js')).registerToolsCommand,
  config:  async () => (await import('./commands/config.js')).registerConfigCommand,
  cfg:     async () => (await import('./commands/config.js')).registerConfigCommand,
  impeccable: async () => (await import('./commands/impeccable.js')).registerImpeccableCommand,
  'command-help': async () => (await import('./commands/command-help.js')).registerCommandHelpCommand,
  ch: async () => (await import('./commands/command-help.js')).registerCommandHelpCommand,
  kg:         async () => (await import('./graph/kg/surface/cli.js')).registerKgCommands,
  load:       async () => (await import('./commands/load.js')).registerLoadCommand,
  search:     async () => (await import('./commands/search.js')).registerSearchCommand,
  'search-daemon': async () => (await import('./commands/search.js')).registerSearchCommand,
  'search-start-daemon': async () => (await import('./commands/search.js')).registerSearchCommand,
  embedding:  async () => (await import('./commands/search.js')).registerSearchCommand,
  domain:     async () => (await import('./commands/domain.js')).registerDomainCommand,
  workspace:  async () => (await import('./commands/workspace.js')).registerWorkspaceCommand,
  ws:         async () => (await import('./commands/workspace.js')).registerWorkspaceCommand,
  explore:    async () => (await import('./commands/explore.js')).registerExploreCommand,
  timeline:   async () => (await import('./commands/timeline.js')).registerTimelineCommand,
};

// Determine which command is being invoked from argv (if any)
const argv = process.argv.slice(2);
const requestedCommand = argv.find(a => !a.startsWith('-'));

if (requestedCommand && requestedCommand in commandLoaders) {
  // Load only the requested command module
  const register = await commandLoaders[requestedCommand]();
  register(program);
} else if (requestedCommand && !(requestedCommand in commandLoaders)) {
  // Bare intent or unknown command — guide to correct skill invocation
  console.error(`[maestro] Unknown command: "${requestedCommand}"`);
  console.error();
  console.error('  The maestro CLI does not accept bare intent text.');
  console.error('  Use the platform-specific skill invocation instead:');
  console.error();
  console.error('    Claude Code:  /maestro "your intent"');
  console.error('    Codex:        $maestro "your intent"');
  console.error();
  console.error('  Or use a CLI subcommand directly:');
  console.error('    maestro ralph next|complete|skills|check|session');
  console.error('    maestro brain init|derive|decide|status');
  console.error('    maestro delegate "prompt" --to <tool>');
  console.error('    maestro explore "prompt"');
  console.error();
  process.exit(1);
} else {
  // No command (e.g., --help, --version) — register all.
  // Multiple keys may point to the same register function (e.g. a command and
  // its alias share one module); deduplicate so we register each module once.
  const seen = new Set<(p: Command) => void>();
  for (const loader of Object.values(commandLoaders)) {
    const register = await loader();
    if (seen.has(register)) continue;
    seen.add(register);
    register(program);
  }
}

await program.parseAsync();
