// ---------------------------------------------------------------------------
// `maestro coordinate` — Graph-based workflow coordinator.
// Subcommands: list, start, next, status, run (default: autonomous run).
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { GraphLoader } from '../coordinator/graph-loader.js';
import { GraphWalker } from '../coordinator/graph-walker.js';
import { IntentRouter } from '../coordinator/intent-router.js';
import { DefaultPromptAssembler } from '../coordinator/prompt-assembler.js';
import { CliExecutor } from '../coordinator/cli-executor.js';
import { DefaultExprEvaluator } from '../coordinator/expr-evaluator.js';
import { DefaultOutputParser } from '../coordinator/output-parser.js';
import { DefaultParallelExecutor } from '../coordinator/parallel-executor.js';
import { ParallelCliRunner } from '../agents/parallel-cli-runner.js';
import type { SpawnFn } from '../coordinator/cli-executor.js';
import { DefaultLLMDecider } from '../coordinator/llm-decider.js';
import { CoordinateBrokerAdapter } from '../coordinator/coordinate-broker-adapter.js';
import { createDefaultDelegateBroker, type DelegateBrokerApi } from '../async/delegate-broker.js';
import { HookManager } from '../hooks/hook-manager.js';
import { TelemetryPlugin } from '../hooks/plugins/telemetry-plugin.js';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

// Resolve the maestro CLI entry script (absolute path to the JS file).
// Runs as `node <entryScript> cli ...` via process.execPath, avoiding Windows
// .cmd wrapper lookup issues (ENOENT) and argument mangling from shell: true.
function resolveMaestroEntryScript(): string {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('[coordinate] Cannot determine maestro entry script (process.argv[1] is empty).');
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolvePaths(workflowRoot: string) {
  const home = homedir();
  const globalChainsRoot = join(home, '.maestro', 'chains');
  const localChainsRoot = join(workflowRoot, 'chains');
  const chainsRoot = existsSync(localChainsRoot) ? localChainsRoot : globalChainsRoot;
  const templateDir = join(home, '.maestro', 'templates', 'cli', 'prompts');
  const sessionDir = join(workflowRoot, '.workflow', '.maestro-coordinate');
  return { chainsRoot, templateDir, sessionDir };
}

// Canonical report-file location shared between the `report` subcommand
// (writer) and GraphWalker (reader). Kept in one place so the path contract
// can't drift between producer and consumer.
export function resolveReportPath(sessionDir: string, sessionId: string, nodeId: string): string {
  return join(sessionDir, sessionId, 'reports', `${nodeId}.json`);
}

function createSpawnFn(): SpawnFn {
  return async (config) => {
    const startTime = Date.now();
    const execId = `coord-${Date.now().toString(36)}`;
    const tool = config.type === 'claude-code' ? 'claude' : config.type;
    const mode = config.approvalMode === 'auto' ? 'write' : 'analysis';

    console.error(`[coordinate] Spawning ${tool} agent...`);
    console.error(`[coordinate] Prompt: ${config.prompt.slice(0, 200)}...`);
    console.error(`[coordinate] WorkDir: ${config.workDir}`);

    try {
      const entryScript = resolveMaestroEntryScript();
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        entryScript,
        'cli', '-p', config.prompt,
        '--tool', tool,
        '--mode', mode,
        '--cd', config.workDir,
      ], {
        cwd: config.workDir,
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
        signal: config.signal,
      });

      const output = stdout + (stderr ? '\n' + stderr : '');

      // The process exited cleanly (no thrown exception). Treat this as
      // "the shell ran the command"; the walker derives node success from
      // the report file (preferred) or OutputParser fallback. Do NOT grep
      // stdout for "STATUS: FAILURE" here — that was a hidden second
      // parser that competed with OutputParser and misfired on stderr
      // diagnostics.
      return {
        output,
        success: true,
        execId,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: `--- COORDINATE RESULT ---\nSTATUS: FAILURE\nSUMMARY: ${message}\n`,
        success: false,
        execId,
        durationMs: Date.now() - startTime,
      };
    }
  };
}

// Lazily construct a shared broker instance. Tests can inject their own via
// __setCoordinateBrokerForTests to avoid hitting the real ~/.maestro/data path.
let sharedBroker: DelegateBrokerApi | null = null;
function getCoordinateBroker(): DelegateBrokerApi {
  if (!sharedBroker) sharedBroker = createDefaultDelegateBroker();
  return sharedBroker;
}

/** Test-only: inject a broker instance for `maestro coordinate watch`. */
export function __setCoordinateBrokerForTests(broker: DelegateBrokerApi | null): void {
  sharedBroker = broker;
}

async function createWalker(
  workflowRoot: string,
  opts?: { parallel?: boolean; backend?: string; broker?: DelegateBrokerApi },
) {
  const { chainsRoot, templateDir, sessionDir } = resolvePaths(workflowRoot);
  const loader = new GraphLoader(chainsRoot);
  const evaluator = new DefaultExprEvaluator();
  const parser = new DefaultOutputParser();
  const assembler = new DefaultPromptAssembler(workflowRoot, templateDir);
  const spawnFn = createSpawnFn();
  const executor = new CliExecutor(spawnFn);
  const router = new IntentRouter(loader, chainsRoot);

  // Detect terminal backend when --backend terminal is set
  let terminalBackend: import('../agents/terminal-backend.js').TerminalBackend | undefined;
  if (opts?.backend === 'terminal') {
    const { detectBackend } = await import('../agents/terminal-backend.js');
    terminalBackend = detectBackend() ?? undefined;
    if (!terminalBackend) {
      console.error('[coordinate] Warning: no terminal multiplexer detected (need TMUX or WEZTERM_PANE env), falling back to direct');
    }
  }

  // Inject parallel executor when --parallel flag is set
  const parallelExecutor = opts?.parallel
    ? new DefaultParallelExecutor(new ParallelCliRunner(spawnFn, terminalBackend))
    : undefined;

  // Wire channel telemetry through the delegate broker so `maestro
  // coordinate watch` (and future MCP tools) can stream events without
  // polling walker-state.json.
  const broker = opts?.broker ?? getCoordinateBroker();
  const emitter = new CoordinateBrokerAdapter(broker);

  // Optional LLM decider for dynamic decision-node routing. Uses the same
  // SpawnFn as command execution so the same CLI tool configuration applies.
  const llmDecider = new DefaultLLMDecider(spawnFn, { workDir: workflowRoot });

  const hookManager = new HookManager();
  hookManager.applyPlugin(new TelemetryPlugin());

  const walker = new GraphWalker(
    loader, assembler, executor,
    null, parser, evaluator,
    emitter, sessionDir,
    parallelExecutor,
    llmDecider,
    hookManager.getRegistry(),
  );
  return { walker, router, loader, broker };
}

function printState(state: { session_id: string; status: string; graph_id: string; current_node: string; history: Array<{ node_id: string; node_type: string; outcome?: string; summary?: string }> }) {
  console.log(JSON.stringify({
    session_id: state.session_id,
    status: state.status,
    graph_id: state.graph_id,
    current_node: state.current_node,
    steps_completed: state.history.filter(h => h.node_type === 'command' && h.outcome === 'success').length,
    steps_failed: state.history.filter(h => h.node_type === 'command' && h.outcome === 'failure').length,
    last_step: state.history.filter(h => h.node_type === 'command').pop() ?? null,
    history: state.history.filter(h => h.node_type === 'command').map(h => ({
      node_id: h.node_id, outcome: h.outcome, summary: h.summary,
    })),
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCoordinateCommand(program: Command): void {
  const coord = program
    .command('coordinate')
    .alias('coord')
    .description('Graph-based workflow coordinator');

  // -------------------------------------------------------------------------
  // maestro coordinate list
  // -------------------------------------------------------------------------
  coord
    .command('list')
    .description('List all available chain graphs')
    .action(async () => {
      const workflowRoot = resolve(process.cwd());
      const { chainsRoot } = resolvePaths(workflowRoot);
      const loader = new GraphLoader(chainsRoot);
      const graphs = loader.listAll();

      console.log('\n  ID'.padEnd(30) + 'Name'.padEnd(22) + 'Cmds'.padEnd(6) + 'Description');
      console.log('  ' + '─'.repeat(80));
      for (const graphId of graphs) {
        try {
          const g = await loader.load(graphId);
          const cmdCount = Object.values(g.nodes).filter(n => n.type === 'command').length;
          const desc = g.description ?? '';
          console.log(
            '  ' + graphId.padEnd(28) + (g.name ?? '').padEnd(22) +
            String(cmdCount).padEnd(6) + desc.slice(0, 50),
          );
        } catch { /* skip invalid */ }
      }
      console.log('');
    });

  // -------------------------------------------------------------------------
  // maestro coordinate start — execute first step, then pause (step mode)
  // -------------------------------------------------------------------------
  coord
    .command('start [intent...]')
    .description('Start a new session in step mode — executes first command, then pauses')
    .option('--chain <name>', 'Force specific chain graph')
    .option('--tool <tool>', 'Agent tool to use', 'claude')
    .option('-y, --yes', 'Auto mode — inject auto-confirm flags')
    .option('--parallel', 'Enable parallel execution for fork/join nodes')
    .option('--backend <type>', 'Adapter backend: direct (default) or terminal (tmux/wezterm)')
    .action(async (intentWords: string[], opts: { chain?: string; tool: string; yes?: boolean; parallel?: boolean; backend?: string }) => {
      const intent = intentWords.join(' ');
      const workflowRoot = resolve(process.cwd());
      const { walker, router } = await createWalker(workflowRoot, { parallel: opts.parallel, backend: opts.backend });

      try {
        const graphId = router.resolve(intent, opts.chain);
        console.error(`[coordinate] Graph: ${graphId}`);

        const state = await walker.start(graphId, intent, {
          tool: opts.tool,
          autoMode: opts.yes ?? false,
          stepMode: true,
          workflowRoot,
          inputs: { description: intent },
        });

        printState(state);
        process.exit(state.status === 'completed' || state.status === 'step_paused' ? 0 : 1);
      } catch (err) {
        console.error(`[coordinate] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------------
  // maestro coordinate next — continue step-paused session by one step
  // -------------------------------------------------------------------------
  coord
    .command('next [sessionId]')
    .description('Execute next step of a paused session')
    .action(async (sessionId: string | undefined) => {
      const workflowRoot = resolve(process.cwd());
      const { walker } = await createWalker(workflowRoot);

      try {
        const state = await walker.next(sessionId);
        printState(state);
        process.exit(state.status === 'completed' || state.status === 'step_paused' ? 0 : 1);
      } catch (err) {
        console.error(`[coordinate] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------------
  // maestro coordinate status — show current session state
  // -------------------------------------------------------------------------
  coord
    .command('status [sessionId]')
    .description('Show current session state')
    .action(async (sessionId: string | undefined) => {
      const workflowRoot = resolve(process.cwd());
      const { walker } = await createWalker(workflowRoot);

      try {
        const state = walker.getState(sessionId);
        printState(state);
      } catch (err) {
        console.error(`[coordinate] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // -------------------------------------------------------------------------
  // maestro coordinate watch — stream walker events from the broker
  //
  // Reads events previously published by the CoordinateBrokerAdapter for a
  // given session. With --follow, long-polls until the walker reaches a
  // terminal status; without, dumps all existing events and exits.
  //
  // This is a thin view over the broker — no caching, no reassembly. Same
  // transport as `delegate_tail` at the MCP layer.
  // -------------------------------------------------------------------------
  coord
    .command('watch <sessionId>')
    .description('Stream walker events for a session (optionally follow until terminal)')
    .option('-f, --follow', 'Long-poll until walker reaches terminal state')
    .option('--since <cursor>', 'Start after event id (default 0)', '0')
    .option('--format <fmt>', 'Output format: json | text', 'json')
    .option('--workflow-root <dir>', 'Workflow root (defaults to current directory)')
    .option('--interval <ms>', 'Follow poll interval in ms (default 500)', '500')
    .action(async (sessionId: string, opts: {
      follow?: boolean;
      since: string;
      format: string;
      workflowRoot?: string;
      interval: string;
    }) => {
      if (opts.format !== 'json' && opts.format !== 'text') {
        console.error(`[coordinate watch] --format must be json or text (got "${opts.format}")`);
        process.exit(2);
      }
      const workflowRoot = resolve(opts.workflowRoot ?? process.cwd());

      // Watch is a pure observer — no walker, no executor, no LLM decider.
      // It only needs the broker (to tail events) and the sessionDir
      // (to read walker-state.json when detecting terminal status in follow
      // mode). This keeps startup cheap and the coupling minimal.
      const { sessionDir } = resolvePaths(workflowRoot);
      const broker = getCoordinateBroker();
      const stateFilePath = join(sessionDir, sessionId, 'walker-state.json');

      // Register a unique consumer session with the broker. Using a random
      // suffix so multiple concurrent watchers don't share the same cursor.
      const consumerId = `watch-${sessionId}-${randomBytes(2).toString('hex')}`;
      try {
        broker.registerSession({ sessionId: consumerId });
      } catch (err) {
        console.error(`[coordinate watch] Failed to register broker session: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      let cursor = Number.parseInt(opts.since, 10);
      if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
      const intervalMs = Math.max(50, Number.parseInt(opts.interval, 10) || 500);

      const writeEvent = (ev: { eventId: number; type: string; createdAt: string; payload: unknown }) => {
        if (opts.format === 'json') {
          console.log(JSON.stringify({
            eventId: ev.eventId,
            type: ev.type,
            createdAt: ev.createdAt,
            payload: ev.payload,
          }));
        } else {
          console.log(`[${ev.createdAt}] #${ev.eventId} ${ev.type}`);
        }
      };

      // Terminal statuses for follow-mode exit. `step_paused` and
      // `waiting_gate` are NOT terminal — watch must keep polling so
      // subsequent `next` calls can append events.
      const isTerminal = (status: string) =>
        status === 'completed' || status === 'failed' || status === 'paused';

      const readWalkerStatus = (): string | null => {
        try {
          const raw = readFileSync(stateFilePath, 'utf-8');
          const parsed = JSON.parse(raw) as { status?: string };
          return typeof parsed.status === 'string' ? parsed.status : null;
        } catch {
          return null;
        }
      };

      // Drain all existing events once.
      const drain = () => {
        const events = broker.pollEvents({
          sessionId: consumerId,
          jobId: sessionId,
          afterEventId: cursor,
          limit: 200,
        });
        for (const ev of events) {
          writeEvent(ev);
          if (ev.eventId > cursor) cursor = ev.eventId;
        }
        return events.length;
      };

      try {
        drain();

        if (opts.follow) {
          // Follow mode: poll until walker state is terminal AND no more
          // events remain to drain. Include a hard guard (60 min) so a
          // forgotten watcher can't spin forever.
          const startedAt = Date.now();
          const HARD_LIMIT_MS = 60 * 60 * 1000;
          for (;;) {
            await new Promise(r => setTimeout(r, intervalMs));
            const drained = drain();
            const status = readWalkerStatus();
            const terminal = status !== null && isTerminal(status);
            if (terminal && drained === 0) break;
            if (Date.now() - startedAt > HARD_LIMIT_MS) {
              console.error('[coordinate watch] Hard time limit reached (60 min), exiting follow loop');
              break;
            }
          }
        }
      } catch (err) {
        console.error(`[coordinate watch] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      process.exit(0);
    });

  // -------------------------------------------------------------------------
  // maestro coordinate report — agent-invoked status writer
  //
  // Spawned agents call this to record their node result as a JSON file at
  // <workflowRoot>/.workflow/.maestro-coordinate/<session>/reports/<node>.json.
  // GraphWalker reads that file preferentially over stdout parsing, so this
  // command is the authoritative result channel for a coordinate node.
  // -------------------------------------------------------------------------
  const STATUS_CHOICES = ['SUCCESS', 'FAILURE'] as const;
  const VERIFICATION_CHOICES = ['passed', 'failed', 'pending'] as const;
  const REVIEW_CHOICES = ['PASS', 'WARN', 'BLOCK'] as const;
  const UAT_CHOICES = ['passed', 'failed', 'pending'] as const;

  coord
    .command('report')
    .description('Write node status as a structured result file (called by spawned agents)')
    .requiredOption('--session <id>', 'Coordinate session id')
    .requiredOption('--node <id>', 'Graph node id being reported')
    .requiredOption('--status <status>', `Node outcome (${STATUS_CHOICES.join('|')})`)
    .option('--verification <state>', `Verification status (${VERIFICATION_CHOICES.join('|')})`)
    .option('--review <verdict>', `Review verdict (${REVIEW_CHOICES.join('|')})`)
    .option('--uat <state>', `UAT status (${UAT_CHOICES.join('|')})`)
    .option('--phase <value>', 'Phase identifier (number or label)')
    .option(
      '--artifact <path>',
      'Artifact path (repeatable)',
      (value: string, prior: string[]) => prior.concat(value),
      [] as string[],
    )
    .option('--summary <text>', 'One-line summary of what was accomplished')
    .option('--workflow-root <dir>', 'Workflow root (defaults to current directory)')
    .action((opts: {
      session: string;
      node: string;
      status: string;
      verification?: string;
      review?: string;
      uat?: string;
      phase?: string;
      artifact: string[];
      summary?: string;
      workflowRoot?: string;
    }) => {
      // Enum validation — commander's .choices() helper is awkward with
      // requiredOption, so we validate inline with clear error messages.
      const status = opts.status.toUpperCase();
      if (!(STATUS_CHOICES as readonly string[]).includes(status)) {
        console.error(`[coordinate report] --status must be one of: ${STATUS_CHOICES.join(', ')} (got "${opts.status}")`);
        process.exit(2);
      }
      if (opts.verification !== undefined && !(VERIFICATION_CHOICES as readonly string[]).includes(opts.verification)) {
        console.error(`[coordinate report] --verification must be one of: ${VERIFICATION_CHOICES.join(', ')} (got "${opts.verification}")`);
        process.exit(2);
      }
      if (opts.review !== undefined && !(REVIEW_CHOICES as readonly string[]).includes(opts.review)) {
        console.error(`[coordinate report] --review must be one of: ${REVIEW_CHOICES.join(', ')} (got "${opts.review}")`);
        process.exit(2);
      }
      if (opts.uat !== undefined && !(UAT_CHOICES as readonly string[]).includes(opts.uat)) {
        console.error(`[coordinate report] --uat must be one of: ${UAT_CHOICES.join(', ')} (got "${opts.uat}")`);
        process.exit(2);
      }

      const workflowRoot = resolve(opts.workflowRoot ?? process.cwd());
      const { sessionDir } = resolvePaths(workflowRoot);
      const reportPath = resolveReportPath(sessionDir, opts.session, opts.node);

      // Structured payload matches ParsedResult.structured so the walker can
      // drop it directly into ctx.result with no field rename.
      const payload = {
        status,
        phase: opts.phase ?? null,
        verification_status: opts.verification ?? null,
        review_verdict: opts.review ?? null,
        uat_status: opts.uat ?? null,
        artifacts: opts.artifact,
        summary: opts.summary ?? '',
        reported_at: new Date().toISOString(),
      };

      // Atomic write: stage to .tmp, then rename. Prevents a crashed writer
      // from leaving a half-written file that the walker would then parse.
      try {
        mkdirSync(dirname(reportPath), { recursive: true });
        const tmpPath = `${reportPath}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
        renameSync(tmpPath, reportPath);
      } catch (err) {
        console.error(`[coordinate report] Failed to write report: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      console.error(`[coordinate report] Wrote ${reportPath}`);
      // Exit 0 even when --status FAILURE: the *report itself* succeeded.
      // Conflating the two would make it impossible for an agent to report
      // failure without triggering its own shell error handling.
      process.exit(0);
    });

  // -------------------------------------------------------------------------
  // maestro coordinate run — autonomous full run (default behavior)
  // -------------------------------------------------------------------------
  coord
    .command('run [intent...]', { isDefault: true })
    .description('Autonomous full run — walk entire graph to completion')
    .option('-y, --yes', 'Auto mode — skip confirmations')
    .option('-c, --continue [sessionId]', 'Resume session')
    .option('--chain <name>', 'Force specific chain graph')
    .option('--tool <tool>', 'Agent tool to use', 'claude')
    .option('--dry-run', 'Show graph traversal plan without executing')
    .option('--parallel', 'Enable parallel execution for fork/join nodes')
    .option('--backend <type>', 'Adapter backend: direct (default) or terminal (tmux/wezterm)')
    .action(async (intentWords: string[], opts: {
      yes?: boolean;
      continue?: string | true;
      chain?: string;
      tool: string;
      dryRun?: boolean;
      parallel?: boolean;
      backend?: string;
    }) => {
      const intent = intentWords.join(' ');
      const workflowRoot = resolve(process.cwd());
      const { walker, router } = await createWalker(workflowRoot, { parallel: opts.parallel, backend: opts.backend });

      try {
        let state;

        if (opts.continue) {
          const sessionId = typeof opts.continue === 'string' ? opts.continue : undefined;
          console.error(`[coordinate] Resuming session${sessionId ? `: ${sessionId}` : ''}...`);
          state = await walker.resume(sessionId);
        } else {
          const graphId = router.resolve(intent, opts.chain);
          console.error(`[coordinate] Graph: ${graphId}`);
          console.error(`[coordinate] Intent: ${intent || '(none)'}`);
          if (opts.dryRun) console.error('[coordinate] Dry-run mode');

          state = await walker.start(graphId, intent, {
            tool: opts.tool,
            autoMode: opts.yes ?? false,
            dryRun: opts.dryRun,
            workflowRoot,
            inputs: { description: intent },
          });
        }

        printState(state);
        process.exit(state.status === 'completed' ? 0 : 1);
      } catch (err) {
        console.error(`[coordinate] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
