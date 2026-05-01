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
  view:       async () => (await import('./commands/view.js')).registerViewCommand,
  stop:       async () => (await import('./commands/stop.js')).registerStopCommand,
  spec:       async () => (await import('./commands/spec.js')).registerSpecCommand,
  wiki:       async () => (await import('./commands/wiki.js')).registerWikiCommand,
  hooks:      async () => (await import('./commands/hooks.js')).registerHooksCommand,
  coordinate: async () => (await import('./commands/coordinate.js')).registerCoordinateCommand,
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
};

// Determine which command is being invoked from argv (if any)
const argv = process.argv.slice(2);
const requestedCommand = argv.find(a => !a.startsWith('-'));

if (requestedCommand && requestedCommand in commandLoaders) {
  // Load only the requested command module
  const register = await commandLoaders[requestedCommand]();
  register(program);
} else {
  // No command or unknown command (e.g., --help, --version) — register all.
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
