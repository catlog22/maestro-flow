import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { migrateAllSessions, migrateSession } from '../run/migrate.js';
import {
  chainDefinitionSchema,
  createChainSession,
  insertChainStep,
  parseDecompositionInput,
  parsePositionInput,
  replaceChainStep,
  skipChainStep,
  updateSessionMeta,
  type ChainDefinition,
} from '../run/chain-admin.js';
import { resolveSession, resumeSession } from '../run/session-transition.js';

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown): void {
  console.error(`[maestro session] ${(error as Error).message}`);
  process.exitCode = 1;
}

function addCanonicalRecoveryHelp(command: Command, phase: 'resolve' | 'resume'): Command {
  const phaseDetail = phase === 'resolve'
    ? 'Resolve exactly one escalated decision or failed chain step. The Session remains paused.'
    : 'Resume only after every recovery blocker is cleared. Success changes paused to running only.';
  return command.addHelpText('after', `
Canonical paused recovery:
  ${phaseDetail}
  Recovery requires an exact Session ID plus audit, revision, and optional lease-triple guards.
  Neither phase creates a Run or binds a chain step. Run allocation remains an explicit maestro run next.
`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolveStdin) => {
    if (process.stdin.isTTY) {
      resolveStdin('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    const onReadable = (): void => {
      let chunk: unknown;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk as string;
      }
    };
    const onEnd = (): void => {
      process.stdin.off('readable', onReadable);
      process.stdin.off('end', onEnd);
      resolveStdin(data);
    };
    process.stdin.on('readable', onReadable);
    process.stdin.on('end', onEnd);
  });
}

/** Load + validate a chain definition from a file path, or `-` for stdin. */
async function loadChainDefinition(chainFile: string): Promise<ChainDefinition> {
  const raw = chainFile === '-' ? await readStdin() : readFileSync(resolve(chainFile), 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid chain-file JSON: ${(error as Error).message}`);
  }
  return chainDefinitionSchema.parse(parsed);
}

/** Read + JSON-parse a file path (or `-` for stdin). Throws on malformed JSON. */
async function readJson(pathOrStdin: string, label: string): Promise<unknown> {
  const raw = pathOrStdin === '-' ? await readStdin() : readFileSync(resolve(pathOrStdin), 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${(error as Error).message}`);
  }
}

function chainSummary(steps: ChainDefinition['steps']): { total: number; steps: Array<{ command: string; decision: boolean }> } {
  return {
    total: steps.length,
    steps: steps.map(s => ({ command: s.command, decision: Boolean(s.decision_ref) })),
  };
}

function collect(value: string, prior: string[] = []): string[] { return prior.concat(value); }

function transitionOptions(opts: any, target?: any): any {
  return {
    requestId: opts.requestId, actor: opts.actor, reason: opts.reason, evidence: opts.evidence,
    expectedIdentityRevision: opts.expectedIdentityRevision,
    expectedActivityRevision: opts.expectedActivityRevision,
    leaseClaim: { executionOwner: opts.executionOwner, ownerEpoch: opts.ownerEpoch, leaseId: opts.leaseId },
    ...(target ? { target } : {}),
  };
}

function mutationTransitionOptions(opts: any): any {
  return {
    requestId: opts.requestId,
    expectedIdentityRevision: opts.expectedIdentityRevision,
    expectedActivityRevision: opts.expectedActivityRevision,
    leaseClaim: { executionOwner: opts.executionOwner, ownerEpoch: opts.ownerEpoch, leaseId: opts.leaseId },
  };
}

function addMutationOptions(command: Command): Command {
  return command
    .option('--request-id <id>', 'idempotent mutation request ID')
    .option('--expected-identity-revision <n>', 'expected Session identity revision', Number.parseInt)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', Number.parseInt)
    .option('--execution-owner <owner>', 'lease owner')
    .option('--owner-epoch <n>', 'lease epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease ID');
}

export function registerSessionCommand(program: Command): void {
  const session = program
    .command('session')
    .description('Session topic grouping/index, canonical paused recovery, and chain administration');

  const addTransitionOptions = (command: Command): Command => command
    .requiredOption('--session <id>', 'exact Session ID')
    .requiredOption('--request-id <id>', 'idempotent request/transition ID')
    .requiredOption('--actor <name>', 'authorized actor')
    .requiredOption('--reason <text>', 'audit reason')
    .requiredOption('--evidence <ref>', 'evidence reference (repeatable)', collect)
    .requiredOption('--expected-identity-revision <n>', 'expected identity revision', Number.parseInt)
    .requiredOption('--expected-activity-revision <n>', 'expected activity revision', Number.parseInt)
    .option('--execution-owner <owner>', 'lease owner')
    .option('--owner-epoch <n>', 'lease epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease ID')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd());

  addCanonicalRecoveryHelp(
    addTransitionOptions(session.command('resolve').description('Resolve one canonical paused recovery target; Session remains paused')),
    'resolve',
  )
    .option('--decision <id>', 'escalated decision point ID')
    .option('--step <id>', 'failed chain step ID')
    .requiredOption('--disposition <value>', 'decision: proceed|retry; step: retry|skip')
    .action((opts: any) => {
      try {
        if (Boolean(opts.decision) === Boolean(opts.step)) throw new Error('exactly one of --decision or --step is required');
        const target = opts.decision
          ? { kind: 'decision' as const, id: opts.decision, disposition: opts.disposition }
          : { kind: 'step' as const, id: opts.step, disposition: opts.disposition };
        if (target.kind === 'decision' && !['proceed', 'retry'].includes(target.disposition)) throw new Error('decision disposition must be proceed|retry');
        if (target.kind === 'step' && !['retry', 'skip'].includes(target.disposition)) throw new Error('step disposition must be retry|skip');
        print(resolveSession(resolve(opts.workflowRoot), opts.session, transitionOptions(opts, target)));
      } catch (error) { reportError(error); }
    });

  addCanonicalRecoveryHelp(
    addTransitionOptions(session.command('resume').description('Resume a canonical paused Session after every recovery blocker is cleared')),
    'resume',
  )
    .action((opts: any) => {
      try { print(resumeSession(resolve(opts.workflowRoot), opts.session, transitionOptions(opts))); }
      catch (error) { reportError(error); }
    });

  session
    .command('migrate')
    .description('Fold legacy ralph-meta.json into session.json and stamp session/1.3 (idempotent)')
    .option('--session <id>', 'migrate one Session; omit to migrate every Session under .workflow/sessions/')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: { session?: string; workflowRoot: string }) => {
      try {
        const root = resolve(opts.workflowRoot);
        if (opts.session) {
          print(migrateSession(root, opts.session));
          return;
        }
        const results = migrateAllSessions(root);
        print(results);
        if (results.some(entry => entry.error)) process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  session
    .command('create <slug>')
    .description('Create a Session, optionally from a predefined chain definition (--chain-file)')
    .requiredOption('--intent <text>', 'session intent (overrides intent inside --chain-file)')
    .option('--chain-file <path>', 'chain definition JSON file; "-" reads stdin. Omit for an empty-chain session')
    .option('--engine <name>', 'orchestration engine: ralph|coordinator|manual')
    .option('--quality <mode>', 'quality mode: quick|standard|full')
    .option('--auto', 'enable auto mode')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (slug: string, opts: {
      intent: string;
      chainFile?: string;
      engine?: string;
      quality?: string;
      auto?: boolean;
      workflowRoot: string;
    }) => {
      try {
        const root = resolve(opts.workflowRoot);
        if (opts.engine && !['ralph', 'coordinator', 'manual'].includes(opts.engine)) {
          throw new Error(`invalid --engine "${opts.engine}" (ralph|coordinator|manual)`);
        }
        if (opts.quality && !['quick', 'standard', 'full'].includes(opts.quality)) {
          throw new Error(`invalid --quality "${opts.quality}" (quick|standard|full)`);
        }
        const definition = opts.chainFile ? await loadChainDefinition(opts.chainFile) : undefined;
        const result = createChainSession(root, slug, {
          intent: opts.intent,
          engine: opts.engine as 'ralph' | 'coordinator' | 'manual' | undefined,
          qualityMode: opts.quality as 'quick' | 'standard' | 'full' | undefined,
          autoMode: opts.auto,
          definition,
        });
        print({
          session_id: result.sessionId,
          session_dir: result.sessionDir,
          engine: result.session.orchestration.engine,
          chain: chainSummary(definition?.steps ?? []),
          next: `maestro run next --session ${result.sessionId}`,
        });
      } catch (error) {
        reportError(error);
      }
    });

  const chain = session
    .command('chain')
    .description('Edit a Session chain (insert / skip / replace pending steps)');

  addMutationOptions(chain
    .command('insert'))
    .description('Insert a pending step after another step (step_id or index). Cannot insert before the active position')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--after <step_id|index>', 'insert after this step (step_id or numeric index)')
    .requiredOption('--command <cmd>', 'command for the new step')
    .option('--args <text>', 'step args string')
    .option('--stage <name>', 'stage label')
    .option('--goal-ref <id>', 'goal reference id')
    .option('--decision-ref <id>', 'mark as a decision node gating this decision point')
    .option('--inserted-by <actor>', 'who inserted the step (e.g. a decision gate name)', 'manual')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: {
      session: string;
      after: string;
      command: string;
      args?: string;
      stage?: string;
      goalRef?: string;
      decisionRef?: string;
      insertedBy: string;
      workflowRoot: string;
    }) => {
      try {
        const step = insertChainStep(resolve(opts.workflowRoot), opts.session, {
          after: opts.after,
          command: opts.command,
          args: opts.args,
          stage: opts.stage,
          goalRef: opts.goalRef,
          decisionRef: opts.decisionRef,
          insertedBy: opts.insertedBy,
          transition: mutationTransitionOptions(opts),
        });
        print({ session_id: opts.session, inserted: step });
      } catch (error) {
        reportError(error);
      }
    });

  addMutationOptions(chain
    .command('skip'))
    .description('Skip a pending chain step (marks status=skipped; only pending steps)')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--step <step_id>', 'step to skip')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: { session: string; step: string; workflowRoot: string }) => {
      try {
        const step = skipChainStep(resolve(opts.workflowRoot), opts.session, opts.step, mutationTransitionOptions(opts));
        print({ session_id: opts.session, skipped: step });
      } catch (error) {
        reportError(error);
      }
    });

  addMutationOptions(chain
    .command('replace'))
    .description('Replace fields of a pending chain step in place (only pending steps)')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--step <step_id>', 'step to replace')
    .option('--command <cmd>', 'new command (regenerates step_id)')
    .option('--args <text>', 'new args string')
    .option('--stage <name>', 'new stage label')
    .option('--goal-ref <id>', 'new goal reference id')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: {
      session: string;
      step: string;
      command?: string;
      args?: string;
      stage?: string;
      goalRef?: string;
      workflowRoot: string;
    }) => {
      try {
        const step = replaceChainStep(resolve(opts.workflowRoot), opts.session, opts.step, {
          command: opts.command,
          args: opts.args,
          stage: opts.stage,
          goalRef: opts.goalRef,
          transition: mutationTransitionOptions(opts),
        });
        print({ session_id: opts.session, replaced: step });
      } catch (error) {
        reportError(error);
      }
    });

  const meta = session
    .command('meta')
    .description('Update session orchestration meta (position / decomposition)');

  addMutationOptions(meta
    .command('update'))
    .description('Integral-replace orchestration.position and/or decomposition (schema-validated). At least one --*-file required')
    .requiredOption('--session <id>', 'Session ID')
    .option('--position-file <path>', 'position block JSON file; "-" reads stdin')
    .option('--decomposition-file <path>', 'decomposition block JSON file; "-" reads stdin')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (opts: {
      session: string;
      positionFile?: string;
      decompositionFile?: string;
      workflowRoot: string;
    }) => {
      try {
        if (!opts.positionFile && !opts.decompositionFile) {
          throw new Error('at least one of --position-file / --decomposition-file is required');
        }
        // `-` may appear at most once (a single stdin stream can not feed both).
        if (opts.positionFile === '-' && opts.decompositionFile === '-') {
          throw new Error('only one block may read stdin ("-"); pass a file path for the other');
        }
        const update: { position?: ReturnType<typeof parsePositionInput>; decomposition?: ReturnType<typeof parseDecompositionInput> } = {};
        if (opts.positionFile) {
          update.position = parsePositionInput(await readJson(opts.positionFile, 'position-file'));
        }
        if (opts.decompositionFile) {
          update.decomposition = parseDecompositionInput(await readJson(opts.decompositionFile, 'decomposition-file'));
        }
        print(updateSessionMeta(resolve(opts.workflowRoot), opts.session, {
          ...update,
          transition: mutationTransitionOptions(opts),
        }));
      } catch (error) {
        reportError(error);
      }
    });
}
