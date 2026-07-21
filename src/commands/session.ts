import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { migrateAllSessions, migrateSession } from '../run/migrate.js';
import { SessionStore } from '../run/store.js';
import { sealSession } from '../run/runtime.js';
import type { SessionState } from '../run/schemas.js';
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
import {
  createRunResponseError,
  createRunResponseSuccess,
  emitRunResponse,
  stableRunResponseErrorCode,
  type RunResponse,
} from '../run/response.js';
import type { TransitionMutationReceipt } from '../run/transition-receipts.js';

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function reportError(error: unknown): void {
  console.error(`[maestro session] ${(error as Error).message}`);
  process.exitCode = 1;
}

type SessionMachineOperation = Extract<
  RunResponse['operation'],
  'resolve' | 'resume' | 'chain-insert' | 'chain-replace' | 'chain-skip' | 'meta-update'
>;

function machineSuccess(
  operation: SessionMachineOperation,
  result: unknown,
  sessionId: string,
  receipt?: TransitionMutationReceipt,
  next?: RunResponse['next'],
): void {
  emitRunResponse(createRunResponseSuccess({
    operation,
    result,
    request_id: receipt?.request_id ?? null,
    locator: { session_id: sessionId, run_id: null },
    next,
    replay: receipt
      ? { status: receipt.status, transition_id: receipt.transition_id }
      : null,
  }));
}

function machineError(
  operation: SessionMachineOperation,
  error: unknown,
  opts: { session?: string; requestId?: string },
): void {
  emitRunResponse(createRunResponseError({
    operation,
    exit_code: 1,
    code: stableRunResponseErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
    request_id: opts.requestId ?? null,
    locator: { session_id: opts.session ?? null, run_id: null },
  }));
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

function persistedChainSummary(session: { orchestration: { chain: Array<{ command: string; decision_ref: string | null }> } }): { total: number; steps: Array<{ command: string; decision: boolean }> } {
  return {
    total: session.orchestration.chain.length,
    steps: session.orchestration.chain.map(step => ({ command: step.command, decision: Boolean(step.decision_ref) })),
  };
}

function collect(value: string, prior: string[] = []): string[] { return prior.concat(value); }

function slugifySessionTopic(text: string, fallback = 'session'): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function simpleChainDefinition(intent: string, commands: string[] | undefined): ChainDefinition | undefined {
  const steps = (commands ?? []).map(command => command.trim()).filter(Boolean);
  if (steps.length === 0) return undefined;
  return chainDefinitionSchema.parse({
    intent,
    steps: steps.map(command => ({ command })),
  });
}

const SESSION_STATUS_VALUES: Array<SessionState['status']> = ['running', 'paused', 'sealed', 'archived', 'failed'];

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
    .option('--lease-id <id>', 'lease ID')
    .option('--json', 'emit one run-response/1.0 envelope on stdout');
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
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
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
        const result = resolveSession(resolve(opts.workflowRoot), opts.session, transitionOptions(opts, target));
        if (opts.json) {
          machineSuccess(
            'resolve',
            result,
            result.session_id,
            {
              request_id: result.request_id,
              transition_id: result.transition_id,
              status: result.replayed ? 'replayed' : 'applied',
            },
            result.next,
          );
        } else {
          print(result);
        }
      } catch (error) { if (opts.json) machineError('resolve', error, opts); else reportError(error); }
    });

  addCanonicalRecoveryHelp(
    addTransitionOptions(session.command('resume').description('Resume a canonical paused Session after every recovery blocker is cleared')),
    'resume',
  )
    .action((opts: any) => {
      try {
        const result = resumeSession(resolve(opts.workflowRoot), opts.session, transitionOptions(opts));
        if (opts.json) {
          machineSuccess(
            'resume',
            result,
            result.session_id,
            {
              request_id: result.request_id,
              transition_id: result.transition_id,
              status: result.replayed ? 'replayed' : 'applied',
            },
            result.next,
          );
        } else {
          print(result);
        }
      } catch (error) { if (opts.json) machineError('resume', error, opts); else reportError(error); }
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
    .command('list')
    .description('List Sessions with compact chain/run status')
    .option('--status <status>', 'filter by status: running|paused|sealed|archived|failed')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: { status?: string; workflowRoot: string }) => {
      try {
        if (opts.status && !SESSION_STATUS_VALUES.includes(opts.status as SessionState['status'])) {
          throw new Error(`invalid --status "${opts.status}"`);
        }
        const status = opts.status as SessionState['status'] | undefined;
        const store = new SessionStore(resolve(opts.workflowRoot));
        const result = store.listSessions(status ? { statuses: [status] } : {});
        print(result.candidates.map(candidate => ({
          session_id: candidate.sessionId,
          status: candidate.session.status,
          engine: candidate.session.orchestration.engine,
          active_run_id: candidate.session.active_run_id,
          latest_completed_run_id: candidate.session.latest_completed_run_id,
          chain_total: candidate.session.orchestration.chain.length,
          pending_steps: candidate.session.orchestration.chain.filter(step => step.status === 'pending').length,
          intent: candidate.session.intent,
        })));
      } catch (error) {
        reportError(error);
      }
    });

  session
    .command('show <session-id>')
    .description('Show one Session state')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: { workflowRoot: string }) => {
      try {
        const store = new SessionStore(resolve(opts.workflowRoot));
        print(store.readBundle(sessionId).session);
      } catch (error) {
        reportError(error);
      }
    });

  session
    .command('seal <session-id>')
    .description('Seal a Session after all Runs and gates are complete')
    .option('--summary <text>', 'human-readable seal summary', '')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: { summary: string; workflowRoot: string }) => {
      try {
        print(sealSession(resolve(opts.workflowRoot), sessionId, opts.summary));
      } catch (error) {
        reportError(error);
      }
    });

  session
    .command('create <topic>')
    .description('Create a Session; use --chain <cmd...> for a simple command chain, --chain-file for advanced JSON')
    .option('--intent <text>', 'session intent; defaults to <topic>')
    .option('--id <slug>', 'explicit Session ID/slug; defaults to slugified <topic>')
    .option('--chain <commands...>', 'simple chain command names, e.g. --chain learn odyssey-planex odyssey-review')
    .option('--chain-file <path>', 'advanced chain definition JSON file; "-" reads stdin')
    .option('--engine <name>', 'orchestration engine: ralph|coordinator|manual')
    .option('--quality <mode>', 'quality mode: quick|standard|full')
    .option('--auto', 'enable auto mode')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (topic: string, opts: {
      intent?: string;
      id?: string;
      chain?: string[];
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
        if (opts.chainFile && (opts.chain?.length ?? 0) > 0) {
          throw new Error('use either --chain or --chain-file, not both');
        }
        const intent = opts.intent ?? topic;
        const fallbackSlug = opts.chain?.length ? opts.chain.join('-') : 'session';
        const slug = opts.id ?? (opts.intent ? topic : slugifySessionTopic(topic, slugifySessionTopic(fallbackSlug)));
        const definition = opts.chainFile
          ? await loadChainDefinition(opts.chainFile)
          : simpleChainDefinition(intent, opts.chain);
        const result = createChainSession(root, slug, {
          intent,
          engine: opts.engine as 'ralph' | 'coordinator' | 'manual' | undefined,
          qualityMode: opts.quality as 'quick' | 'standard' | 'full' | undefined,
          autoMode: opts.auto,
          definition,
        });
        print({
          session_id: result.sessionId,
          session_dir: result.sessionDir,
          engine: result.session.orchestration.engine,
          chain: definition ? chainSummary(definition.steps) : persistedChainSummary(result.session),
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
      json?: boolean;
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
        const result = { session_id: opts.session, inserted: step };
        if (opts.json) machineSuccess('chain-insert', result, opts.session, step.transition);
        else print(result);
      } catch (error) {
        if (opts.json) machineError('chain-insert', error, opts); else reportError(error);
      }
    });

  addMutationOptions(chain
    .command('skip'))
    .description('Skip a pending chain step (marks status=skipped; only pending steps)')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--step <step_id>', 'step to skip')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: { session: string; step: string; requestId?: string; json?: boolean; workflowRoot: string }) => {
      try {
        const step = skipChainStep(resolve(opts.workflowRoot), opts.session, opts.step, mutationTransitionOptions(opts));
        const result = { session_id: opts.session, skipped: step };
        if (opts.json) machineSuccess('chain-skip', result, opts.session, step.transition);
        else print(result);
      } catch (error) {
        if (opts.json) machineError('chain-skip', error, opts); else reportError(error);
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
      requestId?: string;
      json?: boolean;
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
        const result = { session_id: opts.session, replaced: step };
        if (opts.json) machineSuccess('chain-replace', result, opts.session, step.transition);
        else print(result);
      } catch (error) {
        if (opts.json) machineError('chain-replace', error, opts); else reportError(error);
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
      requestId?: string;
      json?: boolean;
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
        const result = updateSessionMeta(resolve(opts.workflowRoot), opts.session, {
          ...update,
          transition: mutationTransitionOptions(opts),
        });
        if (opts.json) machineSuccess('meta-update', result, opts.session, result.transition);
        else print(result);
      } catch (error) {
        if (opts.json) machineError('meta-update', error, opts); else reportError(error);
      }
    });
}
