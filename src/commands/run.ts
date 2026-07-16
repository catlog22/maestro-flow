import { resolve } from 'node:path';
import type { Command } from 'commander';
import { briefRun, checkRun, completeRun, createRun, prepareStep, skillContent, sealSession } from '../run/runtime.js';
import { runNextStep } from '../run/next.js';
import type { TargetPlatform } from '../core/skill-converter.js';

const VALID_PLATFORMS: TargetPlatform[] = ['claude', 'codex', 'agy', 'agents-standard', 'pi'];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown): void {
  console.error(`[maestro run] ${(error as Error).message}`);
  process.exitCode = 1;
}

export function registerRunCommand(program: Command): void {
  const run = program
    .command('run')
    .description('Manage canonical Session/Run lifecycle');

  run
    .command('prepare <step>')
    .description('Return prepare file + workflow metadata for pre-task thinking (read-only, stateless)')
    .option('--session <id>', 'attach prior-step context from a Session (read-only)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .action((step: string, opts: { session?: string; workflowRoot: string; platform?: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(prepareStep(resolve(opts.workflowRoot), step, platform, opts.session));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('next')
    .description('Advance a Session chain: create the next pending Run and emit a compact birth packet')
    .option('--session <id>', 'explicit Session ID')
    .option('--json', 'emit structured JSON instead of the human-readable birth packet')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: { session?: string; json?: boolean; workflowRoot: string }) => {
      try {
        const outcome = runNextStep(resolve(opts.workflowRoot), { sessionId: opts.session, json: opts.json });
        const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
        stream.write(outcome.message + '\n');
        if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('create <command> [args...]')
    .description('Create a Run in an existing or new Session')
    .option('--session <id>', 'explicit Session ID')
    .option('--intent <text>', 'intent used when creating a Session')
    .option('--parent-run <id>', 'parent Run ID for retries')
    .option('--arg <value>', 'command argument (repeatable)', collect, [])
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((command: string, positionalArgs: string[], opts: {
      session?: string;
      intent?: string;
      parentRun?: string;
      arg: string[];
      workflowRoot: string;
    }) => {
      try {
        print(createRun({
          projectRoot: resolve(opts.workflowRoot),
          command,
          sessionId: opts.session,
          intent: opts.intent,
          parentRunId: opts.parentRun,
          args: [...opts.arg, ...positionalArgs],
        }));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('check <run-id>')
    .description('Idempotently scan outputs and evaluate Run gates')
    .option('--session <id>', 'explicit Session ID')
    .option('--stage <stage>', 'compatibility hint: entry or exit', 'exit')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string, opts: { session?: string; workflowRoot: string }) => {
      try {
        print(checkRun(resolve(opts.workflowRoot), runId, opts.session));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('complete <run-id>')
    .description('Derive artifacts and handoff, enforce exit gates, and seal a Run')
    .option('--session <id>', 'explicit Session ID')
    .option('--note <text>', 'supplementary concern merged into the handoff (repeatable)', collect, [])
    .option('--artifact <path>', 'run-relative path registered as evidence beyond the outputs scan (repeatable)', collect, [])
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string, opts: { session?: string; note: string[]; artifact: string[]; workflowRoot: string }) => {
      try {
        const result = completeRun(resolve(opts.workflowRoot), runId, opts.session, {
          notes: opts.note,
          extraArtifacts: opts.artifact,
        });
        print(result);
        if (!result.sealed) process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('brief <run-id>')
    .description('Return Resume Packet for a running Run (re-attach workflow + goals + gate status)')
    .option('--session <id>', 'explicit Session ID')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((runId: string, opts: { session?: string; platform?: string; workflowRoot: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(briefRun(resolve(opts.workflowRoot), runId, opts.session, platform));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('skill <step>')
    .description('Load prepare + workflow content for a step (stateless, no Session)')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((step: string, opts: { platform?: string; workflowRoot: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        print(skillContent(resolve(opts.workflowRoot), step, platform));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('seal-session <session-id>')
    .description('Seal a Session after all Runs and Session gates are complete')
    .option('--summary <text>', 'human-readable seal summary', '')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: { summary: string; workflowRoot: string }) => {
      try {
        print(sealSession(resolve(opts.workflowRoot), sessionId, opts.summary));
      } catch (error) {
        reportError(error);
      }
    });
}
