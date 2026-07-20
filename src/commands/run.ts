import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  acceptRunReuse,
  briefRun,
  checkRun,
  completeRun,
  completeRunWithVerdict,
  createRun,
  prepareStep,
  rebindRunCommand,
  resolveTopicSessionId,
  skillContent,
  sealSession,
  type CompletionVerdict,
} from '../run/runtime.js';
import { runNextStep } from '../run/next.js';
import { resolveRunningRun } from '../run/resolve.js';
import { runDecide, type DecisionConfidence, type DecisionVerdict } from '../run/decide.js';
import { checkLease } from '../run/lease.js';
import { SessionStore } from '../run/store.js';
import { logMutation, readLedger } from '../run/mutation-ledger.js';
import type { TargetPlatform } from '../core/skill-converter.js';
import {
  createRunResponseError,
  createRunResponseSuccess,
  emitRunResponse,
  stableRunResponseErrorCode,
  type RunResponse,
  type RunResponseErrorCode,
} from '../run/response.js';
import { recallRuns } from '../run/recall.js';
import { issueRecallConfirmation } from '../run/recall-confirmation.js';
import { executeRecallAction } from '../run/recall-actions.js';

const VALID_VERDICTS: CompletionVerdict[] = ['done', 'done-with-concerns', 'needs-retry', 'blocked'];

/** Normalise a --verdict token: lowercase, accept DONE_WITH_CONCERNS spellings. */
function parseVerdict(raw: string | undefined): CompletionVerdict | null {
  if (!raw) return 'done';
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  return (VALID_VERDICTS as string[]).includes(normalized) ? (normalized as CompletionVerdict) : null;
}

const VALID_PLATFORMS: TargetPlatform[] = ['claude', 'codex', 'agy', 'agents-standard', 'pi'];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function mutationTransitionOptions(opts: any): any {
  return {
    requestId: opts.requestId,
    expectedIdentityRevision: opts.expectedIdentityRevision,
    expectedActivityRevision: opts.expectedActivityRevision,
    leaseClaim: { executionOwner: opts.executionOwner, ownerEpoch: opts.ownerEpoch, leaseId: opts.leaseId },
  };
}

const ADMIN_COMPATIBILITY_PREFIX = '[DEPRECATED, ADMIN-ONLY]';

function addAdminCompatibilityHelp(command: Command, retainedFor: string): Command {
  return command.addHelpText('after', `
Compatibility boundary:
  ${retainedFor}
  This command is excluded from normal topic resolution, Session selection, sealed-output reuse,
  recall recommendations, and next-action routing.
  It is not a force operation or lifecycle bypass.
`);
}

function reportError(error: unknown): void {
  console.error(`[maestro run] ${(error as Error).message}`);
  process.exitCode = 1;
}

type MachineOperation = RunResponse['operation'];
function machineError(
  operation: MachineOperation,
  error: unknown,
  options: {
    exitCode?: 1 | 2 | 3;
    code?: RunResponseErrorCode;
    details?: Record<string, unknown>;
    requestId?: string | null;
    locator?: RunResponse['locator'];
  } = {},
): void {
  emitRunResponse(createRunResponseError({
    operation,
    exit_code: options.exitCode ?? 1,
    code: options.code ?? stableRunResponseErrorCode(error),
    message: error instanceof Error ? error.message : String(error),
    details: options.details,
    request_id: options.requestId,
    locator: options.locator,
  }));
}
function machineSuccess(
  operation: MachineOperation,
  result: unknown,
  locator: { session_id: string | null; run_id: string | null } | null = null,
  replay?: { status: 'applied' | 'replayed'; transition_id: string },
  requestId?: string | null,
  next?: RunResponse['next'],
): void {
  emitRunResponse(createRunResponseSuccess({ operation, result, locator, replay, request_id: requestId, next }));
}

type RunRecallResult = Awaited<ReturnType<typeof recallRuns>>;

function readOnlyRecallProjection(result: RunRecallResult): RunRecallResult {
  const readOnlyExclusion = 'CLI_READ_ONLY_NO_MUTATION';
  return {
    ...result,
    exact_candidates: result.exact_candidates.map(candidate => ({
      ...candidate,
      eligible_actions: [],
      exclusions: [...new Set([...candidate.exclusions, readOnlyExclusion])],
      next_if_active: null,
    })),
    historical_candidates: result.historical_candidates.map(candidate => ({
      ...candidate,
      eligible_actions: [],
      exclusions: [...new Set([...candidate.exclusions, readOnlyExclusion])],
    })),
    recommendation: {
      action: null,
      candidate_id: result.recommendation.candidate_id,
      automatic: false,
      reason_codes: [...new Set([...result.recommendation.reason_codes, 'READ_ONLY_LOOKUP'])],
    },
    confirmation: { required: false, issuance_command: '', allowed_actions: [] },
    next: {
      suggest_only: true,
      command: null,
      reason: 'Recall is read-only; normal routing resolves a topic Session and reuses eligible same-Session sealed outputs.',
    },
  };
}

export function registerRunCommand(program: Command): void {
  const run = program
    .command('run')
    .description('Manage Runs inside topic-grouped Sessions; compatibility/admin commands are never routed automatically');

  run
    .command('prepare <step>')
    .description('Return prepare file + workflow metadata for pre-task thinking (read-only, stateless)')
    .option('--session <id>', 'attach prior-step context from a Session (read-only)')
    .option('--topic <text>', 'resolve prior-step context from the unique running topic Session (read-only)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .action((step: string, opts: { session?: string; topic?: string; workflowRoot: string; platform?: string }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        const projectRoot = resolve(opts.workflowRoot);
        const resolvedTopicSession = opts.topic
          ? resolveTopicSessionId(projectRoot, opts.topic, opts.session)
          : null;
        if (opts.session && opts.topic && resolvedTopicSession === null) {
          throw new Error(`Session not found: ${opts.session}`);
        }
        const sessionId = opts.topic ? resolvedTopicSession ?? undefined : opts.session;
        print(prepareStep(projectRoot, step, platform, sessionId));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('next')
    .description('Advance a Session chain: create the next pending Run and emit a compact birth packet')
    .option('--session <id>', 'explicit Session ID')
    .option('--pick <step-id>', 'advance a specific pending execution step instead of the queue head')
    .option('--json', 'emit structured JSON instead of the human-readable birth packet')
    .option('--execution-owner <owner>', 'lease execution owner (checked against session.orchestration.lease)')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: {
      session?: string;
      pick?: string;
      json?: boolean;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      workflowRoot: string;
    }) => {
      try {
        const outcome = runNextStep(resolve(opts.workflowRoot), {
          sessionId: opts.session,
          pick: opts.pick,
          json: opts.json,
          executionOwner: opts.executionOwner,
          ownerEpoch: opts.ownerEpoch,
          leaseId: opts.leaseId,
        });
        if (opts.json) {
          if (outcome.exitCode === 0 && outcome.result) {
            machineSuccess('next', outcome.result, { session_id: outcome.result.session_id, run_id: outcome.result.run_id });
          } else {
            emitRunResponse(createRunResponseError({ operation: 'next', exit_code: outcome.exitCode as 1 | 2 | 3, code: outcome.reasonCode as RunResponseErrorCode, message: outcome.message, details: { reason_code: outcome.reasonCode } }));
          }
        } else {
          const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
          stream.write(outcome.message + '\n');
          if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
        }
      } catch (error) {
        if (opts.json) machineError('next', error); else reportError(error);
      }
    });

  run
    .command('create <command> [args...]')
    .description('Create a Run in an existing or new Session')
    .option('--session <id>', 'explicit Session ID')
    .option('--intent <text>', 'Session metadata only (not passed to the command or Run input.args)')
    .option('--topic <text>', 'command-independent Session topic (Unicode supported)')
    .option('--retry-token <token>', 'opaque single-use token issued by a needs-retry transition')
    .option('--platform <name>', 'target platform persisted for this Run')
    .option('--arg <value>', 'command input stored in Run input.args (repeatable)', collect, [])
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((command: string, positionalArgs: string[], opts: {
      session?: string;
      intent?: string;
      topic?: string;
      retryToken?: string;
      platform?: string;
      arg: string[];
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        const result = createRun({
          projectRoot: resolve(opts.workflowRoot),
          command,
          sessionId: opts.session,
          intent: opts.intent,
          topic: opts.topic,
          retryToken: opts.retryToken,
          platform,
          args: [...opts.arg, ...positionalArgs],
        });
        if (opts.json) machineSuccess('create', result, { session_id: result.session_id, run_id: result.run_id }); else print(result);
      } catch (error) {
        if (opts.json) machineError('create', error); else reportError(error);
      }
    });

  run
    .command('check <run-id>')
    .description('Idempotently scan outputs and evaluate Run gates')
    .option('--session <id>', 'explicit Session ID')
    .option('--stage <stage>', 'compatibility hint: entry or exit', 'exit')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string, opts: { session?: string; json?: boolean; workflowRoot: string }) => {
      try {
        const result = checkRun(resolve(opts.workflowRoot), runId, opts.session);
        if (opts.json) {
          machineSuccess(
            'check',
            result,
            { session_id: result.session_id, run_id: result.run_id },
            undefined,
            null,
            result.next ? { suggest_only: true, command: result.next.command, reason: result.next.reason } : null,
          );
        } else {
          print(result);
        }
      } catch (error) {
        if (opts.json) {
          machineError('check', error, { locator: { session_id: opts.session ?? null, run_id: runId } });
        } else {
          reportError(error);
        }
      }
    });

  run
    .command('rebind <run-id>')
    .description(`${ADMIN_COMPATIBILITY_PREFIX} Audit compatible command binding drift for a legacy Run`)
    .option('--session <id>', 'explicit Session ID')
    .requiredOption('--reason <text>', 'required audited reason for accepting compatible drift')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .addHelpText('after', `
Compatibility boundary:
  Rebind is retained only for audited recovery of legacy Run metadata.
  It is excluded from normal topic resolution, Session selection, sealed-output reuse,
  recall recommendations, and next-action routing.
  Rebind strictly validates gate and produce compatibility before updating the stored command binding.
  --reason is required and recorded in command-rebind.json.
  This is not a force operation or lifecycle bypass; incompatible or unprovable drift is rejected.
`)
    .action((runId: string, opts: { session?: string; reason: string; workflowRoot: string }) => {
      try {
        print(rebindRunCommand(resolve(opts.workflowRoot), runId, opts.reason, opts.session));
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('complete [run-id]')
    .description('Seal a Run and advance its chain step by verdict (免参: resolves the active step)')
    .option('--session <id>', 'explicit Session ID')
    .option('--verdict <verdict>', `chain-advance verdict: ${VALID_VERDICTS.join('|')} (default done)`)
    .option('--summary <text>', 'handoff.summary fallback when the report frontmatter left it empty')
    .option('--reason <text>', 'blocker reason (blocked) merged into handoff concerns')
    .option('--note <text>', 'supplementary concern merged into the handoff (repeatable)', collect, [])
    .option('--decision <text>', 'decision appended to handoff.decisions (repeatable)', collect, [])
    .option('--evidence <path>', 'run-relative evidence path registered as an artifact (repeatable)', collect, [])
    .option('--artifact <path>', 'run-relative path registered as evidence beyond the outputs scan (repeatable)', collect, [])
    .option('--execution-owner <owner>', 'lease execution owner (checked against session.orchestration.lease)')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--request-id <id>', 'idempotent completion request ID')
    .option('--expected-identity-revision <n>', 'expected Session identity revision', Number.parseInt)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', Number.parseInt)
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runIdArg: string | undefined, opts: {
      session?: string;
      verdict?: string;
      summary?: string;
      reason?: string;
      note: string[];
      decision: string[];
      evidence: string[];
      artifact: string[];
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        const projectRoot = resolve(opts.workflowRoot);

        // Backward-compatible fast path: an explicit run-id with no verbs stays on
        // the plain seal path (identical to the pre-M2 behaviour). Any verdict, or
        // 免参 (no run-id), routes through the chain-driving verdict path.
        const verbless = !opts.verdict && (opts.decision?.length ?? 0) === 0
          && (opts.evidence?.length ?? 0) === 0 && !opts.reason
          && !opts.executionOwner && !opts.leaseId && opts.ownerEpoch === undefined;
        if (runIdArg && verbless) {
          const result = completeRun(projectRoot, runIdArg, opts.session, {
            notes: opts.note,
            extraArtifacts: opts.artifact,
            summaryFallback: opts.summary,
            transition: mutationTransitionOptions(opts),
          });
          if (opts.json) {
            if (result.sealed) machineSuccess(
              'complete',
              result,
              { session_id: result.session_id, run_id: result.run_id },
              { status: result.transition.status, transition_id: result.transition.transition_id },
              result.transition.request_id,
            );
            else emitRunResponse(createRunResponseError({ operation: 'complete', exit_code: 1, code: 'RUN_GATES_BLOCKING', message: 'Run gates are blocking completion', details: { result } }));
          } else { print(result); if (!result.sealed) process.exitCode = 1; }
          return;
        }

        const verdict = parseVerdict(opts.verdict);
        if (!verdict) {
          if (opts.json) emitRunResponse(createRunResponseError({ operation: 'complete', exit_code: 2, code: 'INVALID_VERDICT', message: `invalid --verdict "${opts.verdict}"`, details: { valid: VALID_VERDICTS } }));
          else { console.error(`[maestro run] invalid --verdict "${opts.verdict}"; valid: ${VALID_VERDICTS.join(', ')}`); process.exitCode = 2; }
          return;
        }

        // Resolve the target run + session. 免参 uses the active chain step; an
        // explicit run-id needs its session located for the lease + chain drive.
        const store = new SessionStore(projectRoot);
        let sessionId: string;
        let runId: string;
        if (runIdArg) {
          const located = store.findRun(runIdArg, opts.session);
          sessionId = located.sessionId;
          runId = runIdArg;
        } else {
          const resolved = resolveRunningRun(projectRoot, store, opts.session);
          if (resolved.kind === 'error') {
            if (opts.json) machineError('complete', new Error(resolved.message));
            else { console.error(resolved.message); process.exitCode = 1; }
            return;
          }
          sessionId = resolved.sessionId;
          runId = resolved.step.run_id;
        }

        // Lease guard — mirrors the ralph rejection path (exit 1, "lease conflict").
        const lease = store.readBundle(sessionId).session.orchestration.lease;
        const conflict = checkLease(lease, {
          executionOwner: opts.executionOwner,
          ownerEpoch: opts.ownerEpoch,
          leaseId: opts.leaseId,
        });
        if (conflict) {
          if (opts.json) emitRunResponse(createRunResponseError({ operation: 'complete', exit_code: 1, code: 'LEASE_CONFLICT', message: conflict, details: {} }));
          else { console.error(`[maestro run] ${conflict}`); process.exitCode = 1; }
          return;
        }

        const result = completeRunWithVerdict(projectRoot, runId, sessionId, {
          verdict,
          notes: opts.note,
          decisions: opts.decision,
          extraArtifacts: [...opts.artifact, ...opts.evidence],
          summaryFallback: opts.summary,
          reason: opts.reason,
          leaseClaim: {
            executionOwner: opts.executionOwner,
            ownerEpoch: opts.ownerEpoch,
            leaseId: opts.leaseId,
          },
          transition: mutationTransitionOptions(opts),
        });
        if (opts.json) {
          if (result.run_sealed) machineSuccess(
            'complete',
            result,
            { session_id: result.session_id, run_id: result.run_id },
            { status: result.seal.transition.status, transition_id: result.seal.transition.transition_id },
            result.seal.transition.request_id,
          );
          else emitRunResponse(createRunResponseError({ operation: 'complete', exit_code: 1, code: 'RUN_GATES_BLOCKING', message: 'Run gates are blocking completion', details: { result }, next: { suggest_only: true, command: result.next.command, reason: result.next.reason } }));
        } else { print(result); process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`); if (!result.run_sealed) process.exitCode = 1; }
      } catch (error) {
        if (opts.json) machineError('complete', error); else reportError(error);
      }
    });

  run
    .command('brief <run-id>')
    .description('Return Resume Packet for a running Run (re-attach workflow + goals + gate status)')
    .option('--session <id>', 'explicit Session ID')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard)')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((runId: string, opts: { session?: string; platform?: string; workflowRoot: string; json?: boolean }) => {
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        const result = briefRun(resolve(opts.workflowRoot), runId, opts.session, platform);
        if (opts.json) {
          machineSuccess(
            'brief',
            result,
            { session_id: result.session.session_id, run_id: result.run.run_id },
            undefined,
            undefined,
            result.recovery.next,
          );
        } else print(result);
      } catch (error) {
        if (opts.json) machineError('brief', error); else reportError(error);
      }
    });

  run
    .command('accept-reuse <run-id>')
    .description('Explicitly accept one exact REVIEW assessment and bind its artifact to run.input.consumes')
    .requiredOption('--session <id>', 'exact Session ID')
    .requiredOption('--assessment-hash <sha256>', 'exact reuse assessment hash shown by run brief')
    .requiredOption('--request-id <id>', 'idempotent acceptance request ID')
    .requiredOption('--actor <name>', 'operator accepting the REVIEW assessment')
    .requiredOption('--reason <text>', 'auditable acceptance reason')
    .requiredOption('--evidence <ref>', 'evidence reference supporting acceptance', collect, [])
    .requiredOption('--expected-identity-revision <n>', 'expected Session identity revision', Number.parseInt)
    .requiredOption('--expected-activity-revision <n>', 'expected Session activity revision', Number.parseInt)
    .option('--execution-owner <owner>', 'lease execution owner')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string, opts: any) => {
      try {
        const result = acceptRunReuse(
          resolve(opts.workflowRoot),
          runId,
          opts.assessmentHash,
          opts.session,
          { ...mutationTransitionOptions(opts), actor: opts.actor, reason: opts.reason, evidence: opts.evidence },
        );
        if (opts.json) {
          machineSuccess(
            'accept-reuse', result, { session_id: result.session_id, run_id: result.run_id },
            { status: result.transition.status, transition_id: result.transition.transition_id },
            result.transition.request_id,
          );
        } else print(result);
      } catch (error) {
        if (opts.json) {
          machineError('accept-reuse', error, {
            requestId: opts.requestId,
            locator: { session_id: opts.session, run_id: runId },
          });
        } else reportError(error);
      }
    });

  run.command('recall <command> [args...]')
    .description('Read-only Session/topic lookup; historical similarity is evidence only and never routes or mutates')
    .requiredOption('--intent <text>', 'verbatim intent')
    .option('--topic <text>', 'command-independent Session topic; defaults to intent')
    .option('--limit <n>', 'maximum candidates', Number.parseInt, 20)
    .option('--as-of <iso>', 'canonical scoring timestamp')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action(async (command: string, _args: string[], opts: { intent: string; topic?: string; limit: number; asOf?: string; json?: boolean; workflowRoot: string }) => {
      try {
        const result = readOnlyRecallProjection(await recallRuns(resolve(opts.workflowRoot), {
          command,
          intent: opts.intent,
          topic: opts.topic,
          limit: opts.limit,
          asOf: opts.asOf,
        }));
        if (opts.json) machineSuccess('recall', result); else print(result);
      } catch (error) { if (opts.json) machineError('recall', error); else reportError(error); }
    });

  addAdminCompatibilityHelp(
    run.command('recall-confirm <action>')
      .description(`${ADMIN_COMPATIBILITY_PREFIX} Issue a legacy recall-mutation confirmation token`)
      .requiredOption('--target-session <id>', 'new target Session ID')
      .requiredOption('--command <name>', 'target command')
      .requiredOption('--intent <text>', 'target intent')
      .option('--source-session <id>', 'immutable source Session')
      .option('--source-run <id>', 'immutable source Run')
      .option('--source-workspace <name>', 'linked source workspace (import-only)')
      .option('--arg <value>', 'target command arg (repeatable)', collect, [])
      .option('--json', 'emit one run-response/1.0 envelope on stdout')
      .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()),
    'Retained temporarily to reconcile existing recall confirmation records.',
  )
    .action((action: string, opts: any) => {
      try {
        if (!['fork', 'import', 'new'].includes(action)) throw new Error('action must be fork|import|new');
        const typedAction = action as 'fork' | 'import' | 'new';
        const result = issueRecallConfirmation(resolve(opts.workflowRoot), { action: typedAction, target_session_id: opts.targetSession, command: opts.command, intent: opts.intent, source_session_id: opts.sourceSession, source_run_id: opts.sourceRun, source_workspace: opts.sourceWorkspace, args: opts.arg });
        const op = action === 'new' ? 'create' : action as MachineOperation;
        if (opts.json) machineSuccess(op, result); else print(result);
      } catch (error) { if (opts.json) machineError(action === 'new' ? 'create' : ['fork', 'import'].includes(action) ? action as MachineOperation : 'recall', error); else reportError(error); }
    });

  for (const action of ['fork', 'import', 'new'] as const) {
    addAdminCompatibilityHelp(
      run.command(action)
        .description(`${ADMIN_COMPATIBILITY_PREFIX} Execute legacy confirmed ${action} recovery`)
        .requiredOption('--confirmation-token <token>', 'single-use confirmation token')
        .requiredOption('--target-session <id>', 'new target Session ID')
        .requiredOption('--command <name>', 'target command')
        .requiredOption('--intent <text>', 'target intent')
        .option('--source-session <id>', 'immutable source Session')
        .option('--source-run <id>', 'immutable source Run')
        .option('--source-workspace <name>', 'linked source workspace (import-only)')
        .option('--arg <value>', 'target command arg (repeatable)', collect, [])
        .option('--json', 'emit one run-response/1.0 envelope on stdout')
        .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()),
      `Retained temporarily to finish or reconcile an existing ${action} reservation.`,
    )
      .action((opts: any) => {
        try {
          const result = executeRecallAction(resolve(opts.workflowRoot), { action, confirmation_token: opts.confirmationToken, target_session_id: opts.targetSession, command: opts.command, intent: opts.intent, source_session_id: opts.sourceSession, source_run_id: opts.sourceRun, source_workspace: opts.sourceWorkspace, args: opts.arg });
          const op = action === 'new' ? 'create' : action;
          if (opts.json) machineSuccess(op, result, { session_id: result.session_id, run_id: result.run_id }, { status: result.replayed ? 'replayed' : 'applied', transition_id: result.reservation_id }); else print(result);
        } catch (error) { if (opts.json) machineError(action === 'new' ? 'create' : action, error); else reportError(error); }
      });
  }

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
    .command('decide <point-id>')
    .description('Record a decision point verdict and advance the chain (evaluation stays in the prompt layer)')
    .requiredOption('--session <id>', 'Session ID')
    .requiredOption('--verdict <verdict>', 'decision verdict: proceed|fix|escalate')
    .requiredOption('--confidence <level>', 'evaluation confidence: high|medium|low')
    .option('--summary <text>', 'one-line rationale, recorded in decisions.ndjson + evidence_ref fallback')
    .option('--evidence <path>', 'evidence path/reference recorded on decision_point.evidence_ref')
    .option('--request-id <id>', 'idempotent decision request ID')
    .option('--expected-identity-revision <n>', 'expected Session identity revision', Number.parseInt)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', Number.parseInt)
    .option('--execution-owner <owner>', 'lease execution owner')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((pointId: string, opts: {
      session: string;
      verdict: string;
      confidence: string;
      summary?: string;
      evidence?: string;
      requestId?: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      try {
        const verdict = opts.verdict.trim().toLowerCase();
        if (!['proceed', 'fix', 'escalate'].includes(verdict)) {
          if (opts.json) {
            machineError('decide', new Error(`invalid --verdict "${opts.verdict}"; valid: proceed, fix, escalate`), {
              exitCode: 2,
              code: 'INVALID_VERDICT',
              requestId: opts.requestId,
              locator: { session_id: opts.session, run_id: null },
            });
          } else {
            console.error(`[maestro run] invalid --verdict "${opts.verdict}"; valid: proceed, fix, escalate`);
            process.exitCode = 2;
          }
          return;
        }
        const confidence = opts.confidence.trim().toLowerCase();
        if (!['high', 'medium', 'low'].includes(confidence)) {
          if (opts.json) {
            machineError('decide', new Error(`invalid --confidence "${opts.confidence}"; valid: high, medium, low`), {
              exitCode: 2,
              code: 'INVALID_ARGUMENT',
              requestId: opts.requestId,
              locator: { session_id: opts.session, run_id: null },
            });
          } else {
            console.error(`[maestro run] invalid --confidence "${opts.confidence}"; valid: high, medium, low`);
            process.exitCode = 2;
          }
          return;
        }
        const result = runDecide(resolve(opts.workflowRoot), opts.session, pointId, {
          verdict: verdict as DecisionVerdict,
          confidence: confidence as DecisionConfidence,
          summary: opts.summary,
          evidence: opts.evidence,
          transition: mutationTransitionOptions(opts),
        });
        if (opts.json) {
          machineSuccess(
            'decide',
            result,
            { session_id: result.session_id, run_id: null },
            { status: result.transition.status, transition_id: result.transition.transition_id },
            result.transition.request_id,
            { suggest_only: true, command: result.next.command, reason: result.next.reason },
          );
        } else {
          print(result);
          process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`);
          if (result.retry?.exhausted) {
            process.stderr.write(
              `warning: decision point ${pointId} retry ${result.retry.count}/${result.retry.max} exhausted `
              + `— the orchestrator (FSM) decides whether to force escalate\n`,
            );
          }
        }
      } catch (error) {
        if (opts.json) {
          machineError('decide', error, {
            requestId: opts.requestId,
            locator: { session_id: opts.session, run_id: null },
          });
        } else {
          reportError(error);
        }
      }
    });

  run
    .command('seal-session <session-id>')
    .description('Seal a Session after all Runs and Session gates are complete')
    .option('--summary <text>', 'human-readable seal summary', '')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: { summary: string; json?: boolean; workflowRoot: string }) => {
      try {
        const result = sealSession(resolve(opts.workflowRoot), sessionId, opts.summary);
        if (opts.json) machineSuccess('seal-session', result, { session_id: result.session_id, run_id: null });
        else print(result);
      } catch (error) {
        if (opts.json) machineError('seal-session', error, { locator: { session_id: sessionId, run_id: null } });
        else reportError(error);
      }
    });

  run
    .command('log-mutation <target>')
    .description('Record an out-of-run file mutation to the mutations ledger')
    .requiredOption('--actor <name>', 'command or hook that performed the mutation')
    .option('--type <type>', 'mutation type: write|append|delete|patch', 'write')
    .option('--hash <hash>', 'content hash of the written file')
    .option('--run-id <id>', 'associated run ID (if within a run)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((target: string, opts: { actor: string; type: string; hash?: string; runId?: string; workflowRoot: string }) => {
      try {
        if (!['write', 'append', 'delete', 'patch'].includes(opts.type)) {
          throw new Error(`invalid mutation type "${opts.type}" (write|append|delete|patch)`);
        }
        const root = resolve(opts.workflowRoot);
        logMutation(root, opts.actor, resolve(root, target), {
          contentHash: opts.hash,
          mutationType: opts.type as 'write' | 'append' | 'delete' | 'patch',
          runId: opts.runId,
        });
        print({ status: 'ok', target, actor: opts.actor });
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('mutations')
    .description('List recorded out-of-run mutations')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((opts: { workflowRoot: string }) => {
      try {
        const entries = readLedger(resolve(opts.workflowRoot));
        if (entries.length === 0) { console.log('No mutations recorded.'); return; }
        for (const entry of entries) {
          console.log(`${entry.timestamp}  ${entry.actor.padEnd(20)}  ${entry.mutation_type.padEnd(7)}  ${entry.target}`);
        }
      } catch (error) {
        reportError(error);
      }
    });
}
