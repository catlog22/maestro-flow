// ---------------------------------------------------------------------------
// `maestro coordinate` — Graph-based workflow coordinator.
// Subcommands: list, start, next, status, run (default: autonomous run).
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { GraphLoader } from '../coordinator/graph-loader.js';
import { GraphWalker } from '../coordinator/graph-walker.js';
import { IntentRouter } from '../coordinator/intent-router.js';
import { DefaultPromptAssembler } from '../coordinator/prompt-assembler.js';
import { CliExecutor } from '../coordinator/cli-executor.js';
import { DefaultExprEvaluator } from '../coordinator/expr-evaluator.js';
import { DefaultOutputParser } from '../coordinator/output-parser.js';
import type { SpawnFn } from '../coordinator/cli-executor.js';

const execFileAsync = promisify(execFile);

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
      const { stdout, stderr } = await execFileAsync('maestro', [
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
      const success = !output.includes('STATUS: FAILURE');

      return {
        output: output || '--- COORDINATE RESULT ---\nSTATUS: SUCCESS\nSUMMARY: Execution completed\n',
        success,
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

function createWalker(workflowRoot: string) {
  const { chainsRoot, templateDir, sessionDir } = resolvePaths(workflowRoot);
  const loader = new GraphLoader(chainsRoot);
  const evaluator = new DefaultExprEvaluator();
  const parser = new DefaultOutputParser();
  const assembler = new DefaultPromptAssembler(workflowRoot, templateDir);
  const executor = new CliExecutor(createSpawnFn());
  const router = new IntentRouter(loader, chainsRoot);
  const walker = new GraphWalker(
    loader, assembler, executor,
    null, parser, evaluator,
    undefined, sessionDir,
  );
  return { walker, router, loader };
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
    .action(async (intentWords: string[], opts: { chain?: string; tool: string; yes?: boolean }) => {
      const intent = intentWords.join(' ');
      const workflowRoot = resolve(process.cwd());
      const { walker, router } = createWalker(workflowRoot);

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
      const { walker } = createWalker(workflowRoot);

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
    .action((sessionId: string | undefined) => {
      const workflowRoot = resolve(process.cwd());
      const { walker } = createWalker(workflowRoot);

      try {
        const state = walker.getState(sessionId);
        printState(state);
      } catch (err) {
        console.error(`[coordinate] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
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
    .action(async (intentWords: string[], opts: {
      yes?: boolean;
      continue?: string | true;
      chain?: string;
      tool: string;
      dryRun?: boolean;
    }) => {
      const intent = intentWords.join(' ');
      const workflowRoot = resolve(process.cwd());
      const { walker, router } = createWalker(workflowRoot);

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
