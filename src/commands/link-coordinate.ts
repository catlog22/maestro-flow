// ---------------------------------------------------------------------------
// `maestro link-coordinate` — Interactive step-by-step workflow coordinator.
// Wraps LinkWalker with readline-based user interaction at each command node.
// ---------------------------------------------------------------------------

import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { GraphLoader } from '../coordinator/graph-loader.js';
import { IntentRouter } from '../coordinator/intent-router.js';
import { DefaultPromptAssembler } from '../coordinator/prompt-assembler.js';
import { CliExecutor } from '../coordinator/cli-executor.js';
import { DefaultExprEvaluator } from '../coordinator/expr-evaluator.js';
import { DefaultOutputParser } from '../coordinator/output-parser.js';
import { LinkWalker } from '../coordinator/link-walker.js';
import type { SpawnFn } from '../coordinator/cli-executor.js';
import type { LinkStepPreview, LinkAction } from '../coordinator/graph-types.js';

const execFileAsync = promisify(execFile);

function createSpawnFn(tool: string): SpawnFn {
  return async (config) => {
    const startTime = Date.now();
    const execId = `link-${Date.now().toString(36)}`;

    console.log(`\n[link-coordinate] Spawning ${config.type} agent (tool: ${tool})...`);
    console.log(`[link-coordinate] Prompt: ${config.prompt.slice(0, 200)}...`);
    console.log(`[link-coordinate] WorkDir: ${config.workDir}`);

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

function displayPreview(preview: LinkStepPreview): void {
  const w = 60;
  const inner = w - 2;
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

  const box = [
    '',
    `┌${'─'.repeat(inner)}┐`,
    `│ Step ${preview.step_index}/${preview.total_steps}: ${pad(preview.cmd, inner - 12)}│`,
  ];
  if (preview.description) {
    box.push(`│ ${pad(preview.description, inner - 1)}│`);
  }
  box.push(
    `│ Args: ${pad(preview.resolved_args, inner - 7)}│`,
    `│${'─'.repeat(inner)}│`,
    `│ Context: ${pad(preview.context_summary, inner - 10)}│`,
    `│${'─'.repeat(inner)}│`,
  );

  if (preview.upcoming.length > 0) {
    box.push(`│ ${pad('Upcoming:', inner - 1)}│`);
    for (const step of preview.upcoming.slice(0, 4)) {
      const label = step.description
        ? `  → ${step.cmd} — ${step.description}`
        : `  → ${step.cmd} ${step.args_template}`;
      box.push(`│ ${pad(label, inner - 1)}│`);
    }
    if (preview.upcoming.length > 4) {
      const more = `  ... and ${preview.upcoming.length - 4} more`;
      box.push(`│ ${pad(more, inner - 1)}│`);
    }
    box.push(`│${'─'.repeat(inner)}│`);
  }

  box.push(
    `│ ${pad('[E]xecute  [S]kip  [M]odify args', inner - 1)}│`,
    `│ ${pad('[A]dd step  [D]elete step  [Q]uit', inner - 1)}│`,
    `└${'─'.repeat(inner)}┘`,
    '',
  );

  console.log(box.join('\n'));
}

async function promptUser(rl: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve) => {
    rl.question('Action> ', (answer) => resolve(answer.trim().toLowerCase()));
  });
}

async function promptInput(rl: ReturnType<typeof createInterface>, msg: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${msg}: `, (answer) => resolve(answer.trim()));
  });
}

async function resolveAction(
  rl: ReturnType<typeof createInterface>,
  preview: LinkStepPreview,
): Promise<LinkAction> {
  while (true) {
    const input = await promptUser(rl);

    switch (input[0]) {
      case 'e': return { type: 'execute' };
      case 's': return { type: 'skip' };
      case 'q': return { type: 'quit' };

      case 'm': {
        const args = await promptInput(rl, 'New args');
        return { type: 'modify', args };
      }

      case 'a': {
        const cmd = await promptInput(rl, 'Command name (e.g. maestro-plan)');
        const args = await promptInput(rl, 'Args (optional)');
        return { type: 'add', after_node: preview.node_id, cmd, args: args || undefined };
      }

      case 'd': {
        if (preview.upcoming.length === 0) {
          console.log('No upcoming steps to delete.');
          continue;
        }
        console.log('Upcoming steps:');
        for (let i = 0; i < preview.upcoming.length; i++) {
          console.log(`  ${i + 1}. ${preview.upcoming[i].node_id} (${preview.upcoming[i].cmd})`);
        }
        const idx = await promptInput(rl, 'Step number to delete');
        const n = parseInt(idx, 10) - 1;
        if (n >= 0 && n < preview.upcoming.length) {
          return { type: 'remove', node_id: preview.upcoming[n].node_id };
        }
        console.log('Invalid selection.');
        continue;
      }

      default:
        console.log('Unknown action. Use E/S/M/A/D/Q.');
    }
  }
}

export function registerLinkCoordinateCommand(program: Command): void {
  program
    .command('link-coordinate [intent...]')
    .alias('lc')
    .description('Interactive step-by-step workflow coordinator')
    .option('-c, --continue [sessionId]', 'Resume session')
    .option('--chain <name>', 'Force specific graph')
    .option('--tool <tool>', 'Agent tool to use', 'claude')
    .option('--list', 'List available command chains')
    .action(async (intentWords: string[], opts: {
      continue?: string | true;
      chain?: string;
      tool: string;
      list?: boolean;
    }) => {
      const intent = intentWords.join(' ');
      const home = homedir();
      const workflowRoot = resolve(process.cwd());
      const globalChainsRoot = join(home, '.maestro', 'chains');
      const localChainsRoot = join(workflowRoot, 'chains');
      const chainsRoot = existsSync(localChainsRoot) ? localChainsRoot : globalChainsRoot;
      const templateDir = join(home, '.maestro', 'templates', 'cli', 'prompts');
      const sessionDir = join(workflowRoot, '.workflow', '.maestro-coordinate');

      const loader = new GraphLoader(chainsRoot);
      const evaluator = new DefaultExprEvaluator();
      const parser = new DefaultOutputParser();
      const assembler = new DefaultPromptAssembler(workflowRoot, templateDir);
      const executor = new CliExecutor(createSpawnFn(opts.tool));
      const router = new IntentRouter(loader, chainsRoot);

      const walker = new LinkWalker(
        loader, assembler, executor,
        parser, evaluator, undefined, sessionDir,
      );

      if (opts.list) {
        const graphs = loader.listAll();
        console.log('\nAvailable command chains:\n');
        console.log('  ID'.padEnd(28) + 'Name'.padEnd(22) + 'Cmds'.padEnd(6) + 'Description');
        console.log('  ' + '─'.repeat(80));
        for (const graphId of graphs) {
          try {
            const g = await loader.load(graphId);
            const cmdCount = Object.values(g.nodes).filter(n => n.type === 'command').length;
            const desc = g.description ?? '';
            console.log(
              '  ' + graphId.padEnd(26) + (g.name ?? '').padEnd(22) +
              String(cmdCount).padEnd(6) + desc.slice(0, 50),
            );
          } catch { /* skip invalid */ }
        }
        console.log('');
        process.exit(0);
      }

      if (!process.stdin.isTTY) {
        console.error('[link-coordinate] Error: Interactive mode requires a TTY. Use --list for non-interactive usage.');
        process.exit(1);
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        let preview: LinkStepPreview | null;

        if (opts.continue) {
          const sessionId = typeof opts.continue === 'string' ? opts.continue : undefined;
          console.log(`[link-coordinate] Resuming session${sessionId ? `: ${sessionId}` : ''}...`);
          preview = await walker.resume(sessionDir, sessionId);
        } else {
          const graphId = router.resolve(intent, opts.chain);
          console.log(`[link-coordinate] Graph: ${graphId}`);
          console.log(`[link-coordinate] Intent: ${intent || '(none)'}`);
          preview = await walker.start(graphId, intent, { tool: opts.tool, workflowRoot });
        }

        // Interactive loop
        while (preview) {
          displayPreview(preview);
          const action = await resolveAction(rl, preview);
          preview = await walker.executeStep(action);
        }

        // Completion summary
        const state = walker.getState();
        if (state) {
          console.log(`\n[link-coordinate] Session: ${state.session_id}`);
          console.log(`[link-coordinate] Status: ${state.status}`);

          const executed = state.history.filter(h => h.node_type === 'command' && h.outcome === 'success').length;
          const skipped = state.history.filter(h => h.outcome === 'skipped').length;
          const added = state.chain_modifications.filter(m => m.action === 'add').length;
          const removed = state.chain_modifications.filter(m => m.action === 'remove').length;

          console.log(`[link-coordinate] Executed: ${executed} | Skipped: ${skipped} | Added: ${added} | Removed: ${removed}`);
        }

        rl.close();
        process.exit(state?.status === 'completed' ? 0 : 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[link-coordinate] Error: ${message}`);
        rl.close();
        process.exit(1);
      }
    });
}
