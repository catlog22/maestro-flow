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

import { Command, CommanderError } from 'commander';
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
  execution:  async () => (await import('./commands/execution.js')).registerExecutionCommand,
  capabilities: async () => (await import('./commands/capabilities.js')).registerCapabilitiesCommand,
  plan:       async () => (await import('./commands/plan.js')).registerPlanCommand,
  session:    async () => (await import('./commands/session.js')).registerSessionCommand,
  skills:     async () => (await import('./commands/skills.js')).registerSkillsCommand,
  ext:        async () => (await import('./commands/ext.js')).registerExtCommand,
  tool:       async () => (await import('./commands/tool.js')).registerToolCommand,
  cli:        async () => (await import('./commands/cli.js')).registerCliCommand,
  install:    async () => (await import('./commands/install.js')).registerInstallCommand,
  uninstall:  async () => (await import('./commands/uninstall.js')).registerUninstallCommand,
  plugin:     async () => (await import('./commands/plugin.js')).registerPluginCommand,
  view:       async () => (await import('./commands/view.js')).registerViewCommand,
  stop:       async () => (await import('./commands/stop.js')).registerStopCommand,

  spec:       async () => (await import('./commands/spec.js')).registerSpecCommand,
  issue:      async () => (await import('./commands/issue.js')).registerIssueCommand,
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
  knowledge:  async () => (await import('./commands/knowledge.js')).registerKnowledgeCommand,
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
  'arch-kb':  async () => (await import('./commands/arch-kb.js')).registerArchKbCommand,
  akb:        async () => (await import('./commands/arch-kb.js')).registerArchKbCommand,
  domain:     async () => (await import('./commands/domain.js')).registerDomainCommand,
  workspace:  async () => (await import('./commands/workspace.js')).registerWorkspaceCommand,
  ws:         async () => (await import('./commands/workspace.js')).registerWorkspaceCommand,
  explore:    async () => (await import('./commands/explore.js')).registerExploreCommand,
  moa:        async () => (await import('./commands/moa.js')).registerMoaCommand,
  timeline:   async () => (await import('./commands/timeline.js')).registerTimelineCommand,
  artifact:   async () => (await import('./commands/artifact.js')).registerArtifactCommand,
};

// Determine which command is being invoked from argv (if any)
const argv = process.argv.slice(2);

// `maestro -V` carries no non-flag token, so it would fall through to the
// register-everything branch below and eager-load every command module (254 vs
// 139 for a single command, +2s measured) purely to print a string that is
// already in hand. Nothing here depends on a command module.
if (argv.length === 1 && (argv[0] === '-V' || argv[0] === '--version')) {
  console.log(getPackageVersion());
  process.exit(0);
}

function preDispatchArguments(args: string[]): { routingArgs: string[]; workflowRoot: string } {
  const routingArgs: string[] = [];
  let workflowRoot = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--workflow-root') {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith('-')) {
        workflowRoot = value;
        index += 1;
      }
      continue;
    }
    if (token.startsWith('--workflow-root=')) {
      const value = token.slice('--workflow-root='.length);
      if (value) workflowRoot = value;
      continue;
    }
    routingArgs.push(token);
  }
  return { routingArgs, workflowRoot };
}

const preDispatch = preDispatchArguments(argv);
const requestedCommand = preDispatch.routingArgs.find(a => !a.startsWith('-'));
const requestedCommandIndex = requestedCommand ? preDispatch.routingArgs.indexOf(requestedCommand) : -1;
const requestedSubcommand = requestedCommandIndex >= 0 ? preDispatch.routingArgs[requestedCommandIndex + 1] : undefined;
const requestedWorkflowRoot = preDispatch.workflowRoot;
let v3WriterMode = false;
if (requestedCommand === 'run' || requestedCommand === 'session'
  || requestedCommand === 'execution' || requestedCommand === 'help') {
  const { SessionStore } = await import('./run/store.js');
  v3WriterMode = new SessionStore(requestedWorkflowRoot).sessionSchemaSelection().writer === 'session/3.0';
}
const runMachineSubcommands = new Set([
  'create', 'new', 'next', 'complete', 'brief', 'recall', 'recall-confirm', 'fork', 'import',
  'check', 'decide', 'seal-session', 'accept-reuse',
]);
const planMachineSubcommands = new Set(['publish']);
const sessionMachineSubcommands = new Set(['create', 'resolve', 'resume', 'seal', 'chain', 'meta']);
const v3SessionMachineSubcommands = new Set([
  'open', 'migrate', 'complete', 'archive', 'unarchive', 'status', 'resume-view', 'chain', 'list',
]);
const v3RunMachineSubcommands = new Set([
  'next', 'create', 'complete', 'transition', 'cancel', 'seal', 'brief', 'check', 'decide', 'recall',
]);
const artifactMachineMode = requestedCommand === 'artifact' && argv.includes('--json');
const hasOption = (args: readonly string[], option: string): boolean => args.some(token => (
  token === option || token.startsWith(`${option}=`)
));

// `--lease-id` is shared by the retired Session lease aliases and the formal
// Execution protocol.  Keep the routing decision in lockstep with
// src/commands/run.ts: an Execution-exclusive option always wins; a shared
// token accompanied by a legacy owner/epoch stays on the legacy command; a
// bare token is an incomplete Execution attempt and is routed there so its
// usage error can be redacted.
const executionExclusiveRunFlags = [
  '--execution', '--generation', '--expected-execution-revision', '--owner-id', '--owner-kind', '--lease-epoch',
];
const legacyExclusiveRunFlags = ['--execution-owner', '--owner-epoch'];
const hasExecutionExclusiveRunFlag = executionExclusiveRunFlags.some(flag => hasOption(argv, flag));
const hasLegacyExclusiveRunFlag = legacyExclusiveRunFlags.some(flag => hasOption(argv, flag));
const hasSharedRunLeaseFlag = hasOption(argv, '--lease-id');
const legacyRunLeaseMode = requestedCommand === 'run'
  && !hasExecutionExclusiveRunFlag
  && hasSharedRunLeaseFlag
  && hasLegacyExclusiveRunFlag;
const executionAwareRunMode = requestedCommand === 'run'
  && !legacyRunLeaseMode
  && (hasExecutionExclusiveRunFlag || hasSharedRunLeaseFlag);
const legacyRunCompatibilityMode = requestedCommand === 'run'
  && !hasExecutionExclusiveRunFlag
  && hasLegacyExclusiveRunFlag;
const v3RunRegistrationMode = v3WriterMode
  && !executionAwareRunMode
  && !legacyRunCompatibilityMode;
const v3MachineMode = argv.includes('--json') && v3WriterMode && (
  (requestedCommand === 'session' && v3SessionMachineSubcommands.has(requestedSubcommand ?? ''))
  || (requestedCommand === 'run' && v3RunRegistrationMode && v3RunMachineSubcommands.has(requestedSubcommand ?? ''))
  || requestedCommand === 'execution'
  || requestedCommand === 'artifact'
);
const executionAwareAliasMode = requestedCommand === 'session' && hasOption(argv, '--execution');
const statuslessSessionMachineMode = requestedCommand === 'session'
  && (requestedSubcommand === 'archive' || requestedSubcommand === 'unarchive');
const executionMachineMode = argv.includes('--json') && (
  requestedCommand === 'execution'
  || requestedCommand === 'capabilities'
  || executionAwareRunMode
  || executionAwareAliasMode
  || statuslessSessionMachineMode
);
const runMachineMode = argv.includes('--json') && !executionMachineMode && (
  (requestedCommand === 'run' && runMachineSubcommands.has(requestedSubcommand ?? ''))
  || (requestedCommand === 'plan' && planMachineSubcommands.has(requestedSubcommand ?? ''))
  || (requestedCommand === 'session' && sessionMachineSubcommands.has(requestedSubcommand ?? ''))
  || (requestedCommand === 'plan' && requestedSubcommand === 'publish')
);

type MachineOperation =
  | 'create' | 'next' | 'complete' | 'brief' | 'recall' | 'resolve' | 'resume' | 'fork' | 'import'
  | 'check' | 'decide' | 'seal-session' | 'chain-insert' | 'chain-replace' | 'chain-skip' | 'meta-update'
  | 'accept-reuse' | 'plan-publish';

function inferMachineOperation(command: 'run' | 'session' | 'plan', args: string[]): MachineOperation {
  const commandIndex = args.indexOf(command);
  const tail = args.slice(commandIndex + 1);
  const primaryIndex = tail.findIndex(token => !token.startsWith('-'));
  const primary = primaryIndex >= 0 ? tail[primaryIndex] : null;
  if (command === 'plan') return 'plan-publish';
  if (command === 'run') {
    if (primary === 'new') return 'create';
    if (primary === 'recall-confirm') return 'recall';
    const operations: MachineOperation[] = [
      'create', 'next', 'complete', 'brief', 'recall', 'fork', 'import', 'check', 'decide', 'seal-session',
      'accept-reuse',
    ];
    return operations.includes(primary as MachineOperation) ? primary as MachineOperation : 'next';
  }
  if (primary === 'resolve' || primary === 'resume') return primary;
  if (primary === 'seal') return 'seal-session';
  if (primary === 'create') return 'create';
  if (primary === 'chain') {
    const mutation = tail.slice(primaryIndex + 1).find(token => !token.startsWith('-'));
    if (mutation === 'insert' || mutation === 'replace' || mutation === 'skip') return `chain-${mutation}`;
  }
  if (primary === 'meta') return 'meta-update';
  return 'resolve';
}

type V3MachineOperation =
  | 'create' | 'next' | 'complete' | 'brief' | 'check' | 'recall'
  | 'session-open' | 'session-migrate' | 'session-complete' | 'session-archive' | 'session-unarchive'
  | 'session-status' | 'session-resume-view' | 'session-list'
  | 'session-chain-insert' | 'session-chain-skip' | 'session-chain-replace' | 'session-chain-update'
  | 'run-transition' | 'run-cancel' | 'run-seal' | 'run-decide';

function inferV3MachineOperation(command: string | undefined, subcommand: string | undefined): V3MachineOperation | 'artifact-inspect' | 'artifact-republish' {
  if (command === 'artifact') return subcommand === 'republish' ? 'artifact-republish' : 'artifact-inspect';
  if (command === 'execution') return inferExecutionMachineOperation(command, argv) as V3MachineOperation;
  if (command === 'session') {
    if (subcommand === 'chain') {
      const chainIndex = argv.indexOf('chain');
      const action = argv.slice(chainIndex + 1).find(token => !token.startsWith('-'));
      if (action === 'insert' || action === 'skip' || action === 'replace' || action === 'update') {
        return `session-chain-${action}`;
      }
      return 'session-chain-insert';
    }
    if (subcommand === 'migrate') return 'session-migrate';
    if (subcommand === 'complete'
      || subcommand === 'archive' || subcommand === 'unarchive' || subcommand === 'status' || subcommand === 'resume-view'
      || subcommand === 'list') {
      return `session-${subcommand}`;
    }
    return 'session-open';
  }
  if (subcommand === 'next' || subcommand === 'create' || subcommand === 'complete'
    || subcommand === 'brief' || subcommand === 'check' || subcommand === 'recall') {
    return subcommand;
  }
  if (subcommand === 'transition') return 'run-transition';
  if (subcommand === 'decide') return 'run-decide';
  return subcommand === 'seal' ? 'run-seal' : 'run-cancel';
}

function inferExecutionMachineOperation(command: string | undefined, args: string[]): string {
  if (command === 'capabilities') return 'capabilities';
  if (command === 'run') {
    const runIndex = args.indexOf('run');
    const operation = args.slice(runIndex + 1).find(token => !token.startsWith('-'));
    if (operation === 'status') return 'execution-status';
    return operation === 'create' || operation === 'complete' || operation === 'decide' ? operation : 'next';
  }
  if (command === 'session') {
    const sessionIndex = args.indexOf('session');
    const operation = args.slice(sessionIndex + 1).find(token => !token.startsWith('-')) ?? 'status';
    if (operation === 'archive' || operation === 'unarchive') return `session-${operation}`;
    return ['resolve', 'resume', 'seal', 'status'].includes(operation)
      ? `execution-${operation}`
      : 'execution-status';
  }
  const executionIndex = args.indexOf('execution');
  const tail = args.slice(executionIndex + 1);
  const primaryIndex = tail.findIndex(token => !token.startsWith('-'));
  const primary = primaryIndex >= 0 ? tail[primaryIndex] : 'status';
  if (primary === 'handoff' || primary === 'lease' || primary === 'operation') {
    const fallback = primary === 'handoff' ? 'prepare' : 'status';
    const candidate = tail.slice(primaryIndex + 1).find(token => !token.startsWith('-')) ?? fallback;
    const valid = primary === 'handoff'
      ? ['prepare', 'accept', 'cancel']
      : primary === 'lease'
        ? ['status', 'heartbeat', 'release', 'recover']
        : ['claim', 'heartbeat', 'release', 'status'];
    return `execution-${primary}-${valid.includes(candidate) ? candidate : fallback}`;
  }
  return ['start', 'attach', 'status', 'pause', 'resolve', 'resume', 'seal'].includes(primary)
    ? `execution-${primary}`
    : 'execution-status';
}

if (runMachineMode || executionMachineMode || v3MachineMode || artifactMachineMode) {
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
}

async function requestedRegistration(name: string): Promise<(p: Command) => void> {
  if (v3RunRegistrationMode && name === 'run') return (await import('./commands/run-v3.js')).registerRunV3Command;
  if (v3WriterMode && name === 'session') return (await import('./commands/session-v3.js')).registerSessionV3Command;
  if (v3WriterMode && name === 'execution') {
    return (await import('./commands/execution-v3-retired.js')).registerExecutionV3RetiredCommand;
  }
  return commandLoaders[name]();
}

const jsonHelpMode = requestedCommand === 'help' && argv.includes('--json');
const requestedCommandAvailable = requestedCommand !== undefined
  && requestedCommand in commandLoaders;

if (jsonHelpMode) {
  const { registerHelpJsonCommand } = await import('./commands/help-json.js');
  registerHelpJsonCommand(program);
} else if (requestedCommand === 'help') {
  // Do not shadow Commander's implicit `help [command]` command. Register the
  // requested target (or the full tree for bare/unknown help) and let Commander
  // render its normal help output.
  const helpTargetAvailable = requestedSubcommand !== undefined
    && requestedSubcommand in commandLoaders;
  if (helpTargetAvailable) {
    const register = await requestedRegistration(requestedSubcommand);
    register(program);
  } else {
    const seen = new Set<(p: Command) => void>();
    for (const [name, loader] of Object.entries(commandLoaders)) {
      const register = await loader();
      if (seen.has(register)) continue;
      seen.add(register);
      register(program);
    }
  }
} else if (requestedCommandAvailable) {
  // session/3.0 workspaces use the formal minimal command surface. Other
  // writers retain the existing v2/Execution command modules unchanged.
  const register = await requestedRegistration(requestedCommand);
  register(program);
} else if (requestedCommand) {
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
  console.error('    maestro run start|status|next|brief|check|done');
  console.error('    maestro delegate "prompt" --to <tool>');
  console.error('    maestro explore "prompt"');
  console.error();
  process.exit(1);
} else {
  // No command (e.g., --help, --version) — register all.
  // Multiple keys may point to the same register function (e.g. a command and
  // its alias share one module); deduplicate so we register each module once.
  const seen = new Set<(p: Command) => void>();
  for (const [name, loader] of Object.entries(commandLoaders)) {
    const register = await loader();
    if (seen.has(register)) continue;
    seen.add(register);
    register(program);
  }
}

try {
  await program.parseAsync();
} catch (error) {
  if (!(error instanceof CommanderError) || (!runMachineMode && !executionMachineMode && !v3MachineMode && !artifactMachineMode)) throw error;
  const { sanitizeCommanderError } = await import('./commands/execution-cli-shared.js');
  const commanderError = sanitizeCommanderError(error, argv);
  if (v3MachineMode || artifactMachineMode) {
    const { createRunResponseError, emitRunResponse } = await import('./run/response.js');
    emitRunResponse(createRunResponseError({
      schema_version: 'run-response/1.2',
      operation: inferV3MachineOperation(requestedCommand, requestedSubcommand),
      exit_code: 2,
      disposition: 'usage_error',
      code: 'COMMANDER_USAGE',
      message: commanderError.message,
      details: commanderError.details,
    }));
  } else if (executionMachineMode) {
    const { emitExecutionError } = await import('./commands/execution-cli-shared.js');
    const executionIndex = argv.indexOf('--execution');
    const sessionIndex = argv.indexOf('--session');
    const requestIndex = argv.indexOf('--request-id');
    emitExecutionError({
      operation: inferExecutionMachineOperation(requestedCommand, argv) as never,
      error: new Error(commanderError.message),
      projectRoot: process.cwd(),
      sessionId: sessionIndex >= 0 ? argv[sessionIndex + 1] : undefined,
      executionId: executionIndex >= 0 ? argv[executionIndex + 1] : undefined,
      requestId: requestIndex >= 0 ? argv[requestIndex + 1] : undefined,
      exitCode: 2,
      disposition: 'usage_error',
      code: 'COMMANDER_USAGE',
      details: commanderError.details,
    });
  } else {
    const operation = inferMachineOperation(requestedCommand as 'run' | 'session' | 'plan', argv);
    const { createRunResponseError, emitRunResponse } = await import('./run/response.js');
    emitRunResponse(createRunResponseError({
      operation,
      exit_code: 2,
      code: 'COMMANDER_USAGE',
      message: commanderError.message,
      details: commanderError.details,
    }));
  }
}
