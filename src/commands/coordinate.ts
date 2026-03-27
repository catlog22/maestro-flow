// ---------------------------------------------------------------------------
// `maestro coordinate` — Graph-based autonomous workflow coordinator.
// Wires up the Graph Walker engine with intent routing and CLI execution.
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

function createSpawnFn(tool: string): SpawnFn {
  return async (config) => {
    const startTime = Date.now();
    const execId = `coord-${Date.now().toString(36)}`;

    console.log(`[coordinate] Spawning ${config.type} agent (tool: ${tool})...`);
    console.log(`[coordinate] Prompt: ${config.prompt.slice(0, 200)}...`);
    console.log(`[coordinate] WorkDir: ${config.workDir}`);

    try {
      const { stdout, stderr } = await execFileAsync('maestro', [
        'cli', '-p', config.prompt,
        '--tool', tool,
        '--mode', 'write',
        '--cd', config.workDir,
      ], {
        cwd: config.workDir,
        timeout: 600000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
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

export function registerCoordinateCommand(program: Command): void {
  program
    .command('coordinate [intent...]')
    .alias('coord')
    .description('Graph-based autonomous workflow coordinator')
    .option('-y, --yes', 'Auto mode — skip confirmations')
    .option('-c, --continue [sessionId]', 'Resume session')
    .option('--chain <name>', 'Force specific graph')
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

      // Resolve paths
      const home = homedir();
      const workflowRoot = resolve(process.cwd());
      const globalChainsRoot = join(home, '.maestro', 'chains');
      const localChainsRoot = join(workflowRoot, 'chains');
      const chainsRoot = existsSync(localChainsRoot) ? localChainsRoot : globalChainsRoot;
      const templateDir = join(home, '.maestro', 'templates', 'cli', 'prompts');
      const sessionDir = join(workflowRoot, '.workflow', '.maestro-coordinate');

      // Instantiate components
      const loader = new GraphLoader(chainsRoot);
      const evaluator = new DefaultExprEvaluator();
      const parser = new DefaultOutputParser();
      const assembler = new DefaultPromptAssembler(workflowRoot, templateDir);
      const executor = new CliExecutor(createSpawnFn(opts.tool));
      const router = new IntentRouter(loader, chainsRoot);
      const walker = new GraphWalker(
        loader, assembler, executor,
        null,      // analyzer (not wired yet)
        parser, evaluator,
        undefined, // emitter
        sessionDir,
      );

      try {
        let state;

        if (opts.continue) {
          // Resume existing session
          const sessionId = typeof opts.continue === 'string' ? opts.continue : undefined;
          console.log(`[coordinate] Resuming session${sessionId ? `: ${sessionId}` : ''}...`);
          state = await walker.resume(sessionId);
        } else {
          // Resolve graph and start
          const graphId = router.resolve(intent, opts.chain);
          console.log(`[coordinate] Graph: ${graphId}`);
          console.log(`[coordinate] Intent: ${intent || '(none)'}`);
          if (opts.dryRun) console.log('[coordinate] Dry-run mode');

          state = await walker.start(graphId, intent, {
            tool: opts.tool,
            autoMode: opts.yes ?? false,
            dryRun: opts.dryRun,
            workflowRoot,
          });
        }

        // Print final status
        console.log(`\n[coordinate] Session: ${state.session_id}`);
        console.log(`[coordinate] Status: ${state.status}`);
        console.log(`[coordinate] Nodes visited: ${state.history.length}`);

        if (state.status === 'completed') {
          const summaries = state.history
            .filter(h => h.summary)
            .map(h => `  ${h.node_id}: ${h.summary}`);
          if (summaries.length > 0) {
            console.log('[coordinate] Summary:');
            for (const s of summaries) console.log(s);
          }
        }

        process.exit(state.status === 'completed' ? 0 : 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[coordinate] Error: ${message}`);
        process.exit(1);
      }
    });
}
