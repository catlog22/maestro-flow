import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InvalidArgumentError, type Command } from 'commander';
import {
  acceptRunReuse,
  briefRun,
  checkRun,
  completeRun,
  completeExecutionRun,
  completeRunWithVerdict,
  createExecutionRun as createExecutionRunCore,
  createRun,
  ensureSessionProjectionOnDisk,
  prepareStep,
  rebindRunCommand,
  resolveTopicSessionId,
  skillContent,
  sealSession,
  type CompletionVerdict,
} from '../run/runtime.js';
import { runNextExecutionStep, runNextStep } from '../run/next.js';
import { resolveActiveRunTarget, resolveRunningRun } from '../run/resolve.js';
import {
  chainDefinitionSchema,
  createChainSession,
  deriveSessionId,
  insertChainStep,
  parseDecompositionInput,
  parsePositionInput,
  replaceChainStep,
  skipChainStep,
  updateSessionMeta,
  type ChainDefinition,
} from '../run/chain-admin.js';
import { runDecide, runDecideExecution, type DecisionConfidence, type DecisionVerdict } from '../run/decide.js';
import { checkLease } from '../run/lease.js';
import { executionStatus, resolveExecution, resumeExecution, sealExecution, startExecution } from '../run/execution.js';
import { sessionStateV20Schema } from '../run/schemas.js';
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
import { resolveCompatibleSession } from '../run/session-resolver.js';
import { summarizeSession } from '../run/session-status.js';
import { resolveSession, resumeSession } from '../run/session-transition.js';
import {
  continuationAfterDecide,
  continuationAfterBrief,
  continuationAfterCheck,
  continuationForNextFailure,
  inspectSessionContinuation,
} from '../run/continuation.js';
import {
  deprecationWarning,
  emitExecutionError,
  emitExecutionSuccess,
  parseNonNegativeInteger,
  parseOwnerKind,
  parsePositiveInteger,
  printExecutionHuman,
  type ExecutionOwnerKind,
} from './execution-cli-shared.js';

const VALID_VERDICTS: CompletionVerdict[] = ['done', 'done-with-concerns', 'needs-retry', 'blocked'];

/** Ready-vocabulary aliases (report frontmatter layer) mapped onto the
 * chain-advance vocabulary, so `--verdict ready|ready_with_concerns|failed`
 * is accepted at the CLI surface and mapped internally. `blocked` exists in
 * both vocabularies and needs no alias. */
const VERDICT_ALIASES: Readonly<Record<string, CompletionVerdict>> = {
  ready: 'done',
  'ready-with-concerns': 'done-with-concerns',
  failed: 'needs-retry',
};
const VERDICT_ALIAS_LABEL = 'aliases: ready|ready_with_concerns|failed';

/** Normalise a --verdict token: lowercase, accept DONE_WITH_CONCERNS spellings
 * and ready-vocabulary aliases. */
function parseVerdict(raw: string | undefined): CompletionVerdict | null {
  if (!raw) return 'done';
  const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
  if ((VALID_VERDICTS as string[]).includes(normalized)) return normalized as CompletionVerdict;
  return VERDICT_ALIASES[normalized] ?? null;
}

const VALID_PLATFORMS: TargetPlatform[] = ['claude', 'codex', 'agy', 'agents-standard', 'pi', 'grok'];

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function readJsonInput(pathOrStdin: string, label: string): unknown {
  const raw = readFileSync(pathOrStdin === '-' ? 0 : resolve(pathOrStdin), 'utf8');
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${(error as Error).message}`);
  }
}
function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function slugifySessionTopic(text: string, fallback = 'session'): string {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function chainDefinitionFromCommands(intent: string, commands: string[]): ChainDefinition {
  const steps = commands.map(command => command.trim()).filter(Boolean);
  if (steps.length === 0) throw new Error('--chain requires at least one command');
  return {
    intent,
    steps: steps.map(command => ({ command })),
  };
}

function summarizeChain(definition: ChainDefinition): { total: number; steps: Array<{ command: string }> } {
  return {
    total: definition.steps.length,
    steps: definition.steps.map(step => ({ command: step.command })),
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

interface ExecutionRunMutationOptions {
  session?: string;
  execution?: string;
  generation?: number;
  requestId?: string;
  expectedExecutionRevision?: number;
  ownerId?: string;
  ownerKind?: ExecutionOwnerKind;
  leaseEpoch?: number;
  leaseId?: string;
}

function isExecutionRunAttempt(opts: ExecutionRunMutationOptions): boolean {
  return [opts.execution, opts.generation, opts.expectedExecutionRevision, opts.ownerId, opts.ownerKind, opts.leaseEpoch, opts.leaseId]
    .some(value => value !== undefined);
}

function executionRunAuthority(opts: ExecutionRunMutationOptions): {
  sessionId: string;
  executionId: string;
  generation: number;
  requestId: string;
  expectedExecutionRevision: number;
  executionLease: { ownerId: string; ownerKind: ExecutionOwnerKind; epoch: number; leaseId: string };
} | null {
  const executionOnly = isExecutionRunAttempt(opts);
  if (!opts.execution) {
    if (executionOnly) throw new InvalidArgumentError('--execution is required when any Execution locator or fence option is supplied');
    return null;
  }
  const missing = [
    ['--session', opts.session],
    ['--generation', opts.generation],
    ['--request-id', opts.requestId],
    ['--expected-execution-revision', opts.expectedExecutionRevision],
    ['--owner-id', opts.ownerId],
    ['--owner-kind', opts.ownerKind],
    ['--lease-epoch', opts.leaseEpoch],
    ['--lease-id', opts.leaseId],
  ].filter(([, value]) => value === undefined || value === '');
  if (missing.length > 0) {
    throw new InvalidArgumentError(`execution-aware mutation requires ${missing.map(([flag]) => flag).join(', ')}`);
  }
  return {
    sessionId: opts.session!,
    executionId: opts.execution,
    generation: opts.generation!,
    requestId: opts.requestId!,
    expectedExecutionRevision: opts.expectedExecutionRevision!,
    executionLease: {
      ownerId: opts.ownerId!,
      ownerKind: opts.ownerKind!,
      epoch: opts.leaseEpoch!,
      leaseId: opts.leaseId!,
    },
  };
}

function addExecutionRunOptions(command: Command): Command {
  return command
    .option('--execution <id>', 'exact Execution ID; switches --json to run-response/1.1')
    .option('--generation <n>', 'exact Execution generation', parsePositiveInteger)
    .option('--expected-execution-revision <n>', 'expected Execution revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'Execution lease owner ID')
    .option('--owner-kind <kind>', 'Execution lease owner kind', parseOwnerKind)
    .option('--lease-epoch <n>', 'Execution lease epoch', parsePositiveInteger);
}

function executionTransitionReplay(
  projectRoot: string,
  sessionId: string,
  executionId: string,
  requestId: string,
  wasPresent: boolean,
): { replayed: boolean; transition_id: string } | null {
  const record = new SessionStore(projectRoot).readExecutionTransition(sessionId, executionId, requestId);
  return record ? { replayed: wasPresent, transition_id: record.outcome.transition_id } : null;
}

function createExecutionRun(
  options: Parameters<typeof createExecutionRunCore>[0],
): ReturnType<typeof createExecutionRunCore> {
  const store = new SessionStore(options.projectRoot);
  const existing = store.readExecutionTransition(options.sessionId!, options.executionId, options.requestId);
  try {
    return createExecutionRunCore(options);
  } catch (error) {
    if (existing?.payload.operation === 'create'
      && error instanceof Error
      && /outcome no longer matches current authority revisions/i.test(error.message)) {
      return structuredClone(existing.outcome.result.value) as ReturnType<typeof createExecutionRunCore>;
    }
    throw error;
  }
}

function resolveSealAliasReplay(
  store: SessionStore,
  sessionId: string,
  requestId: string | undefined,
): string | undefined {
  if (!requestId) return undefined;
  const matches = store.listExecutions(sessionId).filter(execution => (
    store.readExecutionTransition(sessionId, execution.execution_id, requestId)?.payload.operation === 'execution-seal'
  ));
  if (matches.length > 1) {
    throw new Error(`request_id ${requestId} is ambiguous across Execution generations`);
  }
  return matches[0]?.execution_id;
}

function executionRunError(
  operation: 'create' | 'next' | 'complete' | 'decide',
  error: unknown,
  projectRoot: string,
  opts: ExecutionRunMutationOptions,
): void {
  emitExecutionError({
    operation,
    error,
    projectRoot,
    sessionId: opts.session,
    executionId: opts.execution,
    requestId: opts.requestId,
    ...(error instanceof InvalidArgumentError
      ? { exitCode: 2 as const, disposition: 'usage_error' as const, code: 'COMMANDER_USAGE' as const }
      : {}),
  });
}

interface RunAliasExecutionContext {
  protocol: boolean;
  sessionId?: string;
  execution?: ReturnType<SessionStore['readExecution']>;
}

function resolveRunAliasExecution(
  projectRoot: string,
  requestedSessionId?: string,
  requestedExecutionId?: string,
): RunAliasExecutionContext {
  const store = new SessionStore(projectRoot);
  const inspect = (sessionId: string): RunAliasExecutionContext => {
    const record = store.readSessionRecord(sessionId);
    const executions = store.listExecutions(sessionId);
    if (requestedExecutionId) {
      return { protocol: true, sessionId, execution: store.readExecution(sessionId, requestedExecutionId) };
    }
    const current = store.readOpenExecution(sessionId);
    if (record.schema_version === 'session/2.0') {
      const identity = sessionStateV20Schema.parse(record);
      if (identity.current_execution_id !== (current?.execution_id ?? null)) {
        throw new Error(
          `Session ${sessionId} current Execution pointer is inconsistent: ${identity.current_execution_id ?? 'null'}`,
        );
      }
      return { protocol: true, sessionId, execution: current ?? undefined };
    }
    return executions.length > 0
      ? { protocol: true, sessionId, execution: current ?? undefined }
      : { protocol: false, sessionId };
  };

  if (requestedExecutionId && !requestedSessionId) {
    throw new InvalidArgumentError('--session is required with --execution');
  }
  if (requestedSessionId) {
    if (!store.sessionExists(requestedSessionId)) throw new Error(`Session not found: ${requestedSessionId}`);
    return inspect(requestedSessionId);
  }

  const current = store.listSessionsReadOnly().candidates.flatMap(candidate => {
    const context = inspect(candidate.sessionId);
    return context.execution ? [context] : [];
  });
  if (current.length > 1) {
    throw new Error(`current Execution is ambiguous across Sessions: ${current.map(item => item.sessionId).join(', ')}`);
  }
  if (current.length === 1) return current[0];
  const resolved = resolveCompatibleSession(projectRoot);
  return resolved ? inspect(resolved.sessionId) : { protocol: false };
}

function runAliasUsesExecutionProtocol(projectRoot: string, sessionId?: string): boolean {
  try {
    const store = new SessionStore(projectRoot);
    const ids = sessionId
      ? [sessionId]
      : store.listSessionsReadOnly().candidates.map(candidate => candidate.sessionId);
    return ids.some(id => store.sessionExists(id)
      && (store.readSessionRecord(id).schema_version === 'session/2.0' || store.listExecutions(id).length > 0));
  } catch {
    return false;
  }
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

/** Deprecation notice for human-facing aliases migrating to `maestro session`. */
function sessionMigrationNotice(verb: string, sessionVerb?: string, machineMode = false): void {
  if (machineMode) return;
  const target = sessionVerb ?? verb;
  console.error(`[maestro run] deprecated: "maestro run ${verb}" is now "maestro session ${target}". This alias stays for backward compatibility.`);
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
  continuation?: RunResponse['continuation'],
): void {
  emitRunResponse(createRunResponseSuccess({
    operation, result, locator, replay, request_id: requestId, next, continuation,
  }));
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
    .command('start [intent...]')
    .description('Deprecated convenience alias for Execution start plus run create/next')
    .option('--cmd <command>', 'single-run command to create')
    .option('--chain <commands...>', 'simple command chain, e.g. --chain learn odyssey-planex odyssey-review')
    .option('--chain-file <path>', 'advanced chain definition JSON; "-" reads stdin')
    .option('--id <slug>', 'explicit Session ID/slug when creating a chain Session')
    .option('--session <id>', 'explicit Session ID for a single Run')
    .option('--execution <id>', 'exact Execution ID; otherwise resolve the unique current Execution')
    .option('--generation <n>', 'exact Execution generation', parsePositiveInteger)
    .option('--topic <text>', 'command-independent Session topic; defaults to intent')
    .option('--arg <value>', 'command input stored in Run input.args (repeatable)', collect, [])
    .option('--platform <name>', 'target platform persisted for this Run')
    .option('--no-dispatch', 'create the chain Session but do not run the first step')
    .option('--request-id <id>', 'idempotent Execution transition request ID')
    .option('--expected-execution-revision <n>', 'expected current Execution revision', parseNonNegativeInteger)
    .option('--expected-identity-revision <n>', 'expected Session identity revision', parseNonNegativeInteger)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'Execution lease owner ID')
    .option('--owner-kind <kind>', 'Execution lease owner kind', parseOwnerKind)
    .option('--lease-epoch <n>', 'current Execution lease epoch', parsePositiveInteger)
    .option('--lease-id <token>', 'private Execution lease token')
    .option('--expected-lease-epoch <n>', 'latest observed lease epoch when starting an Execution', parseNonNegativeInteger)
    .option('--actor <name>', 'authorized actor')
    .option('--reason <text>', 'audit reason')
    .option('--evidence <ref>', 'evidence reference (repeatable)', collect)
    .option('--claim-output <path>', 'write a human-mode acquisition claim to a private file')
    .option('--json', 'emit run-response/1.1 for Execution authority')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((intentParts: string[], opts: {
      cmd?: string;
      chain?: string[];
      chainFile?: string;
      id?: string;
      session?: string;
      execution?: string;
      generation?: number;
      topic?: string;
      arg: string[];
      platform?: string;
      dispatch: boolean;
      requestId?: string;
      expectedExecutionRevision?: number;
      expectedIdentityRevision?: number;
      expectedActivityRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      leaseId?: string;
      expectedLeaseEpoch?: number;
      actor?: string;
      reason?: string;
      evidence?: string[];
      claimOutput?: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      const projectRoot = resolve(opts.workflowRoot);
      let context: RunAliasExecutionContext | undefined;
      try {
        const fileDefinition = opts.chainFile
          ? chainDefinitionSchema.parse(readJsonInput(opts.chainFile, 'chain-file'))
          : undefined;
        if (fileDefinition && (opts.chain?.length ?? 0) > 0) throw new Error('use either --chain or --chain-file, not both');
        const intent = intentParts.join(' ').trim() || fileDefinition?.intent || opts.topic || opts.cmd || opts.chain?.join(' -> ') || '';
        if (!intent) throw new Error('run start requires an intent, --cmd, --chain, or --chain-file');
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }

        const storeBeforeResolution = new SessionStore(projectRoot);
        if (opts.session && !storeBeforeResolution.sessionExists(opts.session)) {
          throw new Error(
            `Session not found: ${opts.session}. `
            + '--session references an existing Session; to create a new Session with an explicit ID, use --id <slug>',
          );
        }
        const createStatuslessIdentity = storeBeforeResolution.sessionSchemaSelection().writer === 'session/2.0'
          && !opts.session && storeBeforeResolution.listSessionsReadOnly().candidates.length === 0;
        if (createStatuslessIdentity) {
          if (fileDefinition || (opts.chain?.length ?? 0) > 1) {
            throw new InvalidArgumentError(
              'fresh statusless run start supports --cmd or one --chain command; multi-step chain initialization requires a canonical Execution chain operation',
            );
          }
          const missing = [
            ['--request-id', opts.requestId],
            ['--expected-identity-revision', opts.expectedIdentityRevision],
            ['--expected-activity-revision', opts.expectedActivityRevision],
            ['--expected-lease-epoch', opts.expectedLeaseEpoch],
            ['--owner-id', opts.ownerId],
            ['--owner-kind', opts.ownerKind],
            ['--actor', opts.actor],
            ['--reason', opts.reason],
            ['--evidence', opts.evidence?.length ? opts.evidence : undefined],
          ].filter(([, value]) => value === undefined || value === '');
          if (missing.length > 0) {
            throw new InvalidArgumentError(`Execution start requires ${missing.map(([flag]) => flag).join(', ')}`);
          }
          const sessionId = deriveSessionId(opts.id ?? slugifySessionTopic(intent));
          storeBeforeResolution.createSession(sessionId, intent, { ifExists: 'error' });
          opts.session = sessionId;
        }
        context = resolveRunAliasExecution(projectRoot, opts.session, opts.execution);

        if (context.protocol) {
          if (!context.sessionId) throw new Error('Execution Session could not be resolved');
          const startAliasReplay = Boolean(
            context.execution && opts.requestId
            && new SessionStore(projectRoot).readExecutionTransition(
              context.sessionId, context.execution.execution_id, opts.requestId,
            )?.payload.operation === 'execution-start',
          );
          if (context.execution && !startAliasReplay && ((opts.chain?.length ?? 0) > 0 || fileDefinition)) {
            throw new InvalidArgumentError('run start cannot replace the chain of an existing statusless/current Execution; use run next');
          }
          if (!context.execution && (fileDefinition || (opts.chain?.length ?? 0) > 1)) {
            throw new InvalidArgumentError(
              'fresh statusless run start supports --cmd or one --chain command; multi-step chain initialization requires a canonical Execution chain operation',
            );
          }

          if (!context.execution || startAliasReplay) {
            const missing = [
              ['--request-id', opts.requestId],
              ['--expected-identity-revision', opts.expectedIdentityRevision],
              ['--expected-activity-revision', opts.expectedActivityRevision],
              ['--expected-lease-epoch', opts.expectedLeaseEpoch],
              ['--owner-id', opts.ownerId],
              ['--owner-kind', opts.ownerKind],
              ['--actor', opts.actor],
              ['--reason', opts.reason],
              ['--evidence', opts.evidence?.length ? opts.evidence : undefined],
            ].filter(([, value]) => value === undefined || value === '');
            if (missing.length > 0) {
              throw new InvalidArgumentError(`Execution start requires ${missing.map(([flag]) => flag).join(', ')}`);
            }
            const started = startExecution(projectRoot, context.sessionId, {
              requestId: opts.requestId!, ownerId: opts.ownerId!, ownerKind: opts.ownerKind!,
              expectedIdentityRevision: opts.expectedIdentityRevision,
              expectedActivityRevision: opts.expectedActivityRevision,
              expectedLeaseEpoch: opts.expectedLeaseEpoch,
              actor: opts.actor, reason: opts.reason, evidence: opts.evidence,
            });
            let dispatched: unknown = null;
            const command = opts.cmd ?? (opts.chain?.length === 1 ? opts.chain[0] : undefined);
            if (command) {
              dispatched = createExecutionRun({
                projectRoot, command, sessionId: context.sessionId, intent, topic: opts.topic,
                platform, args: opts.arg, executionId: started.execution.execution_id,
                generation: started.execution.generation, expectedExecutionRevision: 1,
                executionLease: {
                  ownerId: started.lease_claim.owner_id, ownerKind: started.lease_claim.owner_kind,
                  epoch: started.lease_claim.epoch, leaseId: started.lease_claim.lease_id,
                },
                requestId: `${opts.requestId}-create`,
              });
            } else if (opts.dispatch) {
              const next = runNextExecutionStep(projectRoot, {
                sessionId: context.sessionId, executionId: started.execution.execution_id,
                generation: started.execution.generation, expectedExecutionRevision: 1,
                executionLease: {
                  ownerId: started.lease_claim.owner_id, ownerKind: started.lease_claim.owner_kind,
                  epoch: started.lease_claim.epoch, leaseId: started.lease_claim.lease_id,
                },
                requestId: `${opts.requestId}-next`, json: opts.json,
                args: opts.arg.length > 0 ? opts.arg : undefined,
              });
              if (next.exitCode !== 0) throw new Error(next.message);
              dispatched = next.result;
            }
            const result = { ...started, dispatched };
            const execution = new SessionStore(projectRoot).readExecution(
              context.sessionId, started.execution.execution_id,
            );
            const warning = deprecationWarning('maestro run start', 'maestro execution start');
            if (opts.json) {
              emitExecutionSuccess({
                operation: 'execution-start', result, projectRoot, execution,
                requestId: opts.requestId,
                replay: { replayed: started.replayed, transition_id: started.transition_id },
                warnings: [warning],
              });
            } else {
              console.error(`[maestro run] deprecated: ${warning.message}`);
              printExecutionHuman(result, opts.claimOutput, 'lease_claim', projectRoot);
            }
            return;
          }

          const authority = executionRunAuthority({
            ...opts,
            session: context.sessionId,
            execution: context.execution.execution_id,
            generation: context.execution.generation,
          });
          if (!authority) throw new Error('Execution authority could not be resolved');
          const store = new SessionStore(projectRoot);
          const wasPresent = Boolean(store.readExecutionTransition(
            authority.sessionId, authority.executionId, authority.requestId,
          ));
          const warning = deprecationWarning(
            'maestro run start', opts.cmd ? 'maestro run create' : 'maestro run next',
          );
          if (opts.cmd) {
            const result = createExecutionRun({
              projectRoot, command: opts.cmd, sessionId: authority.sessionId, intent,
              topic: opts.topic, platform, args: opts.arg,
              executionId: authority.executionId, generation: authority.generation,
              expectedExecutionRevision: authority.expectedExecutionRevision,
              executionLease: authority.executionLease, requestId: authority.requestId,
            });
            const execution = store.readExecution(authority.sessionId, authority.executionId);
            if (opts.json) {
              emitExecutionSuccess({
                operation: 'create', result, projectRoot, execution, requestId: authority.requestId,
                replay: executionTransitionReplay(
                  projectRoot, authority.sessionId, authority.executionId, authority.requestId, wasPresent,
                ),
                warnings: [warning],
              });
            } else {
              console.error(`[maestro run] deprecated: ${warning.message}`);
              print(result);
            }
            return;
          }

          const outcome = runNextExecutionStep(projectRoot, {
            sessionId: authority.sessionId, executionId: authority.executionId,
            generation: authority.generation, expectedExecutionRevision: authority.expectedExecutionRevision,
            executionLease: authority.executionLease, requestId: authority.requestId,
            json: opts.json, args: opts.arg.length > 0 ? opts.arg : undefined,
          });
          if (opts.json && outcome.exitCode === 0 && outcome.result) {
            emitExecutionSuccess({
              operation: 'next', result: outcome.result, projectRoot,
              execution: store.readExecution(authority.sessionId, authority.executionId),
              requestId: authority.requestId,
              replay: executionTransitionReplay(
                projectRoot, authority.sessionId, authority.executionId, authority.requestId, wasPresent,
              ),
              warnings: [warning],
            });
          } else if (opts.json) {
            emitExecutionError({
              operation: 'next', error: new Error(outcome.message), projectRoot,
              sessionId: authority.sessionId, executionId: authority.executionId,
              requestId: authority.requestId, exitCode: outcome.exitCode as 1 | 2 | 3,
              disposition: outcome.exitCode === 1 ? 'domain_error' : 'control_flow',
              code: outcome.reasonCode as never, warnings: [warning],
            });
          } else {
            console.error(`[maestro run] deprecated: ${warning.message}`);
            const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
            stream.write(`${outcome.message}\n`);
            if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
          }
          return;
        }

        sessionMigrationNotice('start', 'start', opts.json);
        if ((opts.chain?.length ?? 0) > 0 || fileDefinition) {
          if (opts.cmd) throw new Error('use --cmd, --chain, or --chain-file; only one may be provided');
          if (opts.session) throw new Error('--session is for single Run start; use run edit to add steps to an existing Session');
          const definition = fileDefinition ?? chainDefinitionFromCommands(intent, opts.chain ?? []);
          const fallbackSlug = slugifySessionTopic(definition.steps.map(step => step.command).join('-'));
          const sessionSlug = opts.id ?? slugifySessionTopic(intent, fallbackSlug);
          const created = createChainSession(projectRoot, sessionSlug, {
            intent, topic: opts.topic, definition, engine: definition.engine,
            qualityMode: definition.quality_mode, autoMode: definition.auto_mode,
            boundaryContract: definition.boundary_contract,
            executor: platform ? { platform, cli_tool: platform } : undefined,
          });
          const result: Record<string, unknown> = {
            session_id: created.sessionId, session_dir: created.sessionDir,
            chain: summarizeChain(definition), next: `maestro session next --session ${created.sessionId}`,
          };
          if (opts.dispatch) {
            const next = runNextStep(projectRoot, { sessionId: created.sessionId, args: opts.arg.length > 0 ? opts.arg : undefined });
            result.dispatched = next.result;
            result.message = next.message;
            if (next.exitCode !== 0) process.exitCode = next.exitCode;
          } else {
            const projectionWarning = ensureSessionProjectionOnDisk(projectRoot, created.sessionId);
            if (projectionWarning) result.warning = projectionWarning;
          }
          print(result);
          return;
        }
        if (!opts.cmd) throw new Error('single-run start requires --cmd <command> or --chain <commands...>');
        const result = createRun({
          projectRoot, command: opts.cmd, sessionId: opts.session, intent,
          topic: opts.topic, platform, args: opts.arg,
        });
        if (result.session_created && opts.session) {
          console.error(
            `Warning: Session "${opts.session}" did not exist; created it for this Run. `
            + 'If you meant an existing Session, use its exact ID (see "maestro session list").',
          );
        }
        if (opts.json) machineSuccess('create', result, { session_id: result.session_id, run_id: result.run_id });
        else print(result);
      } catch (error) {
        const executionProtocol = context?.protocol ?? runAliasUsesExecutionProtocol(projectRoot, opts.session);
        if (opts.json && executionProtocol) {
          const operation = context?.execution ? (opts.cmd ? 'create' : 'next') : 'execution-start';
          emitExecutionError({
            operation, error, projectRoot,
            sessionId: context?.sessionId ?? opts.session,
            executionId: context?.execution?.execution_id ?? opts.execution,
            requestId: opts.requestId,
            ...(error instanceof InvalidArgumentError
              ? { exitCode: 2 as const, disposition: 'usage_error' as const, code: 'COMMANDER_USAGE' as const }
              : {}),
            warnings: [deprecationWarning(
              'maestro run start', context?.execution
                ? (opts.cmd ? 'maestro run create' : 'maestro run next')
                : 'maestro execution start',
            )],
          });
        } else if (opts.json) {
          machineError('create', error, { locator: { session_id: opts.session ?? null, run_id: null } });
        } else {
          reportError(error);
        }
      }
    });

  run
    .command('status [session-id]')
    .description('Show canonical status; --execution is a deprecated bridge to Execution status')
    .option('--execution <id>', 'exact Execution ID')
    .option('--stale-after-ms <n>', 'lease staleness threshold in milliseconds', parsePositiveInteger)
    .option('--json', 'emit run-response/1.1 only with --execution')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string | undefined, opts: { execution?: string; staleAfterMs?: number; json?: boolean; workflowRoot: string }) => {
      if (!opts.execution) sessionMigrationNotice('status');
      const projectRoot = resolve(opts.workflowRoot);
      try {
        if (opts.execution) {
          if (!sessionId) throw new Error('[session-id] is required with --execution');
          const result = executionStatus(projectRoot, sessionId, opts.execution, { staleAfterMs: opts.staleAfterMs });
          const warning = deprecationWarning('maestro run status --execution', 'maestro execution status');
          if (opts.json) {
            emitExecutionSuccess({
              operation: 'execution-status', result, projectRoot, execution: result.execution,
              warnings: [warning],
            });
          } else {
            console.error(`[maestro run] deprecated: ${warning.message}`);
            print(result);
          }
          return;
        }
        if (opts.json) throw new Error('--json on run status requires --execution');
        const resolved = resolveCompatibleSession(projectRoot, sessionId);
        if (!resolved) throw new Error(sessionId ? `session not found: ${sessionId}` : 'no compatible Session found');
        print(summarizeSession(projectRoot, resolved));
      } catch (error) {
        if (opts.json && opts.execution) {
          emitExecutionError({
            operation: 'execution-status', error, projectRoot, sessionId, executionId: opts.execution,
            warnings: [deprecationWarning('maestro run status --execution', 'maestro execution status')],
          });
        } else reportError(error);
      }
    });

  run
    .command('recover')
    .description('Resolve one paused blocker or resume a cleared Session')
    .requiredOption('--session <id>', 'exact Session ID')
    .requiredOption('--request-id <id>', 'idempotent transition ID')
    .requiredOption('--actor <name>', 'authorized actor')
    .requiredOption('--reason <text>', 'audit reason')
    .requiredOption('--evidence <ref>', 'evidence reference (repeatable)', collect)
    .requiredOption('--expected-identity-revision <n>', 'expected identity revision', Number.parseInt)
    .requiredOption('--expected-activity-revision <n>', 'expected activity revision', Number.parseInt)
    .option('--decision <id>', 'resolve an escalated decision point')
    .option('--step <id>', 'resolve a failed chain step')
    .option('--disposition <value>', 'decision: proceed|retry; step: retry|skip')
    .option('--resume', 'resume after every blocker has been resolved')
    .option('--execution <id>', 'exact Execution ID; otherwise resolve the unique current Execution')
    .option('--expected-execution-revision <n>', 'expected Execution revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'new Execution lease owner ID')
    .option('--owner-kind <kind>', 'new Execution lease owner kind', parseOwnerKind)
    .option('--expected-lease-epoch <n>', 'latest observed Execution lease epoch', parseNonNegativeInteger)
    .option('--claim-output <path>', 'write the private acquisition claim to a mode-0600 file')
    .option('--execution-owner <owner>', 'legacy Session lease owner')
    .option('--owner-epoch <n>', 'legacy Session lease epoch', Number.parseInt)
    .option('--lease-id <id>', 'legacy Session lease ID')
    .option('--json', 'emit run-response/1.1 for Execution authority')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((opts: any) => {
      const projectRoot = resolve(opts.workflowRoot);
      let context: RunAliasExecutionContext | undefined;
      try {
        context = resolveRunAliasExecution(projectRoot, opts.session, opts.execution);
        if (context.protocol) {
          if (!context.sessionId || !context.execution) {
            throw new Error(`current Execution not found for Session ${context.sessionId ?? opts.session}`);
          }
          if (opts.expectedExecutionRevision === undefined) {
            throw new InvalidArgumentError('--expected-execution-revision is required for Execution recovery');
          }
          if (opts.resume) {
            if (opts.decision || opts.step || opts.disposition) {
              throw new InvalidArgumentError('--resume cannot be combined with --decision, --step, or --disposition');
            }
            if (opts.expectedActivityRevision === undefined || opts.expectedLeaseEpoch === undefined
              || !opts.ownerId || !opts.ownerKind) {
              throw new InvalidArgumentError(
                'Execution resume requires --expected-activity-revision, --expected-lease-epoch, '
                + '--owner-id, and --owner-kind',
              );
            }
            const result = resumeExecution(projectRoot, {
              sessionId: context.sessionId,
              executionId: context.execution.execution_id,
              requestId: opts.requestId,
              expectedExecutionRevision: opts.expectedExecutionRevision,
              expectedActivityRevision: opts.expectedActivityRevision,
              expectedLeaseEpoch: opts.expectedLeaseEpoch,
              ownerId: opts.ownerId,
              ownerKind: opts.ownerKind,
              actor: opts.actor,
              reason: opts.reason,
              evidence: opts.evidence,
            });
            const warning = deprecationWarning('maestro run recover --resume', 'maestro execution resume');
            if (opts.json) {
              emitExecutionSuccess({
                operation: 'execution-resume', result, projectRoot, execution: result.execution,
                requestId: opts.requestId,
                replay: { replayed: result.replayed, transition_id: result.transition_id },
                warnings: [warning],
              });
            } else {
              console.error(`[maestro run] deprecated: ${warning.message}`);
              printExecutionHuman(result, opts.claimOutput);
            }
            return;
          }

          if (Boolean(opts.decision) === Boolean(opts.step)) {
            throw new InvalidArgumentError('exactly one of --decision or --step is required unless --resume is used');
          }
          if (!opts.disposition) throw new InvalidArgumentError('--disposition is required when resolving a blocker');
          const target = opts.decision
            ? { kind: 'decision' as const, id: opts.decision, disposition: opts.disposition }
            : { kind: 'step' as const, id: opts.step, disposition: opts.disposition };
          if (target.kind === 'decision' && !['proceed', 'retry'].includes(target.disposition)) {
            throw new InvalidArgumentError('decision disposition must be proceed|retry');
          }
          if (target.kind === 'step' && !['retry', 'skip'].includes(target.disposition)) {
            throw new InvalidArgumentError('step disposition must be retry|skip');
          }
          const result = resolveExecution(projectRoot, {
            sessionId: context.sessionId,
            executionId: context.execution.execution_id,
            requestId: opts.requestId,
            expectedExecutionRevision: opts.expectedExecutionRevision,
            actor: opts.actor,
            reason: opts.reason,
            evidence: opts.evidence,
            target,
          });
          const warning = deprecationWarning('maestro run recover', 'maestro execution resolve');
          if (opts.json) {
            emitExecutionSuccess({
              operation: 'execution-resolve', result, projectRoot, execution: result.execution,
              requestId: opts.requestId,
              replay: { replayed: result.replayed, transition_id: result.transition_id },
              warnings: [warning],
            });
          } else {
            console.error(`[maestro run] deprecated: ${warning.message}`);
            print(result);
          }
          return;
        }

        sessionMigrationNotice('recover');
        const common = {
          requestId: opts.requestId,
          actor: opts.actor,
          reason: opts.reason,
          evidence: opts.evidence,
          expectedIdentityRevision: opts.expectedIdentityRevision,
          expectedActivityRevision: opts.expectedActivityRevision,
          leaseClaim: {
            executionOwner: opts.executionOwner,
            ownerEpoch: opts.ownerEpoch,
            leaseId: opts.leaseId,
          },
        };
        if (opts.resume) {
          if (opts.decision || opts.step || opts.disposition) {
            throw new Error('--resume cannot be combined with --decision, --step, or --disposition');
          }
          const result = resumeSession(projectRoot, opts.session, common);
          if (opts.json) machineSuccess('resume', result, { session_id: result.session_id, run_id: null });
          else print(result);
          return;
        }
        if (Boolean(opts.decision) === Boolean(opts.step)) {
          throw new Error('exactly one of --decision or --step is required unless --resume is used');
        }
        if (!opts.disposition) throw new Error('--disposition is required when resolving a blocker');
        const target = opts.decision
          ? { kind: 'decision' as const, id: opts.decision, disposition: opts.disposition }
          : { kind: 'step' as const, id: opts.step, disposition: opts.disposition };
        if (target.kind === 'decision' && !['proceed', 'retry'].includes(target.disposition)) {
          throw new Error('decision disposition must be proceed|retry');
        }
        if (target.kind === 'step' && !['retry', 'skip'].includes(target.disposition)) {
          throw new Error('step disposition must be retry|skip');
        }
        const result = resolveSession(projectRoot, opts.session, { ...common, target });
        if (opts.json) machineSuccess('resolve', result, { session_id: result.session_id, run_id: null });
        else print(result);
      } catch (error) {
        const executionProtocol = context?.protocol ?? runAliasUsesExecutionProtocol(projectRoot, opts.session);
        if (opts.json && executionProtocol) {
          const resume = Boolean(opts.resume);
          emitExecutionError({
            operation: resume ? 'execution-resume' : 'execution-resolve', error, projectRoot,
            sessionId: context?.sessionId ?? opts.session,
            executionId: context?.execution?.execution_id ?? opts.execution,
            requestId: opts.requestId,
            ...(error instanceof InvalidArgumentError
              ? { exitCode: 2 as const, disposition: 'usage_error' as const, code: 'COMMANDER_USAGE' as const }
              : {}),
            warnings: [deprecationWarning(
              resume ? 'maestro run recover --resume' : 'maestro run recover',
              resume ? 'maestro execution resume' : 'maestro execution resolve',
            )],
          });
        } else if (opts.json) {
          machineError(opts.resume ? 'resume' : 'resolve', error, {
            requestId: opts.requestId,
            locator: { session_id: opts.session, run_id: null },
          });
        } else {
          reportError(error);
        }
      }
    });

  run
    .command('done [run-id]')
    .description('Check and complete the current Run (friendly alias for run complete --verdict)')
    .option('--session <id>', 'explicit Session ID')
    .option('--skip-artifact-metadata-validation', 'downgrade artifact kind/schema/role/alias contract mismatches to warnings')
    .option('--verdict <verdict>', `completion verdict: ${VALID_VERDICTS.join('|')} (default done; ${VERDICT_ALIAS_LABEL})`)
    .option('--summary <text>', 'handoff.summary fallback when the report frontmatter left it empty')
    .option('--reason <text>', 'blocker reason (blocked) merged into handoff concerns')
    .option('--note <text>', 'supplementary concern merged into the handoff (repeatable)', collect, [])
    .option('--decision <text>', 'decision appended to handoff.decisions (repeatable)', collect, [])
    .option('--evidence <path>', 'run-relative evidence path registered as an artifact (repeatable)', collect, [])
    .option('--artifact <path>', 'run-relative path registered as evidence beyond the outputs scan (repeatable)', collect, [])
    .option('--chain-proposal <path>', 'run-relative chain-proposal artifact applied atomically with completion')
    .option('--apply-proposal', 'apply the single validated chain-proposal discovered in this Run')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runIdArg: string | undefined, opts: {
      session?: string;
      skipArtifactMetadataValidation?: boolean;
      verdict?: string;
      summary?: string;
      reason?: string;
      note: string[];
      decision: string[];
      evidence: string[];
      artifact: string[];
      chainProposal?: string;
      applyProposal?: boolean;
      workflowRoot: string;
    }) => {
      sessionMigrationNotice('done');
      try {
        const projectRoot = resolve(opts.workflowRoot);
        const verdict = parseVerdict(opts.verdict);
        if (!verdict) throw new Error(`invalid --verdict "${opts.verdict}"; valid: ${VALID_VERDICTS.join(', ')} (${VERDICT_ALIAS_LABEL})`);
        const store = new SessionStore(projectRoot);
        let sessionId: string;
        let runId: string;
        if (runIdArg) {
          const located = store.findRun(runIdArg, opts.session);
          sessionId = located.sessionId;
          runId = runIdArg;
        } else {
          const resolved = resolveRunningRun(projectRoot, store, opts.session, 'run done');
          if (resolved.kind === 'ok') {
            sessionId = resolved.sessionId;
            runId = resolved.step.run_id;
          } else {
            const active = resolveActiveRunTarget(store, opts.session);
            if (!active) throw new Error(resolved.message);
            sessionId = active.sessionId;
            runId = active.runId;
          }
        }
        const result = completeRunWithVerdict(projectRoot, runId, sessionId, {
          verdict,
          notes: opts.note,
          decisions: opts.decision,
          extraArtifacts: [...opts.artifact, ...opts.evidence],
          summaryFallback: opts.summary,
          reason: opts.reason,
          chainProposal: opts.chainProposal,
          applyChainProposal: opts.applyProposal,
          skipArtifactMetadataValidation: opts.skipArtifactMetadataValidation,
        });
        print(result);
        process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`);
        if (!result.run_sealed) process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('edit [commands...]')
    .description('Edit future chain steps; adding commands inserts pending steps, never raw Runs')
    .option('--session <id>', 'explicit Session ID')
    .option('--after <selector>', 'insert after current|latest|start|step-id|index', 'current')
    .option('--replace <step-id>', 'replace a pending step with the first command')
    .option('--remove <step-id>', 'remove a pending step by marking it skipped')
    .option('--args <text>', 'step args string (only with one command)')
    .option('--stage <name>', 'stage label')
    .option('--goal-ref <id>', 'goal reference id')
    .option('--position-file <path>', 'replace orchestration.position from JSON; "-" reads stdin')
    .option('--decomposition-file <path>', 'replace orchestration.decomposition from JSON; "-" reads stdin')
    .option('--inserted-by <actor>', 'who inserted the step', 'manual')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((commands: string[], opts: {
      session?: string;
      after: string;
      replace?: string;
      remove?: string;
      args?: string;
      stage?: string;
      goalRef?: string;
      positionFile?: string;
      decompositionFile?: string;
      insertedBy: string;
      workflowRoot: string;
    }) => {
      sessionMigrationNotice('edit', 'chain edit');
      try {
        const projectRoot = resolve(opts.workflowRoot);
        const store = new SessionStore(projectRoot);
        const selectedCommands = commands.map(command => command.trim()).filter(Boolean);
        if (opts.replace && opts.remove) throw new Error('use either --replace or --remove, not both');
        if (opts.positionFile === '-' && opts.decompositionFile === '-') {
          throw new Error('only one metadata input may read from stdin');
        }
        const resolveSessionId = (): string => {
          if (opts.session) {
            if (!store.sessionExists(opts.session)) throw new Error(`session not found: ${opts.session}`);
            return opts.session;
          }
          const resolved = resolveRunningRun(projectRoot, store, undefined, 'run edit');
          if (resolved.kind === 'ok') return resolved.sessionId;
          throw new Error(`${resolved.message}; pass --session <id>`);
        };
        const sessionId = resolveSessionId();
        if (opts.positionFile || opts.decompositionFile) {
          if (selectedCommands.length > 0 || opts.replace || opts.remove) {
            throw new Error('metadata replacement cannot be combined with chain edits');
          }
          const update: {
            position?: ReturnType<typeof parsePositionInput>;
            decomposition?: ReturnType<typeof parseDecompositionInput>;
          } = {};
          if (opts.positionFile) update.position = parsePositionInput(readJsonInput(opts.positionFile, 'position-file'));
          if (opts.decompositionFile) {
            update.decomposition = parseDecompositionInput(readJsonInput(opts.decompositionFile, 'decomposition-file'));
          }
          print(updateSessionMeta(projectRoot, sessionId, update));
          return;
        }
        if (opts.remove) {
          if (selectedCommands.length > 0) throw new Error('--remove does not accept commands');
          const skipped = skipChainStep(projectRoot, sessionId, opts.remove);
          print({ session_id: sessionId, removed: skipped, note: 'removed means skipped; sealed history is preserved' });
          return;
        }
        if (opts.replace) {
          if (selectedCommands.length !== 1) throw new Error('--replace requires exactly one replacement command');
          const replaced = replaceChainStep(projectRoot, sessionId, opts.replace, {
            command: selectedCommands[0],
            args: opts.args,
            stage: opts.stage,
            goalRef: opts.goalRef,
          });
          print({ session_id: sessionId, replaced });
          return;
        }
        if (selectedCommands.length === 0) {
          throw new Error('run edit requires commands, --replace, --remove, --position-file, or --decomposition-file');
        }
        if (opts.args && selectedCommands.length !== 1) throw new Error('--args can only be used when inserting one command');
        const resolveAfter = (): string => {
          const selector = opts.after.trim().toLowerCase();
          if (['start', 'head', 'beginning', 'none'].includes(selector)) return 'start';
          const session = store.readBundle(sessionId).session;
          if (selector === 'current') {
            const running = session.orchestration.chain.find(step => step.status === 'running' && step.run_id);
            if (running) return running.step_id;
            if (session.orchestration.chain.length === 0) return 'start';
            throw new Error(`session ${sessionId} has no running chain step; use --after latest, --after start, or a step id`);
          }
          if (selector === 'latest') {
            for (let i = session.orchestration.chain.length - 1; i >= 0; i--) {
              const step = session.orchestration.chain[i];
              if (step.status !== 'pending') return step.step_id;
            }
            return session.orchestration.chain.at(-1)?.step_id ?? 'start';
          }
          return opts.after;
        };
        let after = resolveAfter();
        const inserted = [];
        for (const command of selectedCommands) {
          const step = insertChainStep(projectRoot, sessionId, {
            after,
            command,
            args: opts.args,
            stage: opts.stage,
            goalRef: opts.goalRef,
            insertedBy: opts.insertedBy,
          });
          inserted.push(step);
          after = step.step_id;
        }
        print({ session_id: sessionId, inserted, next: `maestro session next --session ${sessionId}` });
      } catch (error) {
        reportError(error);
      }
    });

  run
    .command('prepare <step>')
    .description('Return prepare file + workflow metadata for pre-task thinking (read-only, stateless)')
    .option('--session <id>', 'attach prior-step context from a Session (read-only)')
    .option('--topic <text>', 'resolve prior-step context from the unique running topic Session (read-only)')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard|pi)')
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

  addExecutionRunOptions(run
    .command('next')
    .description('Advance a Session chain: create the next pending Run and emit a compact birth packet')
    .option('--session <id>', 'explicit Session ID')
    .option('--pick <step-id>', 'advance a specific pending execution step instead of the queue head')
    .option('--json', 'emit structured JSON instead of the human-readable birth packet')
    .option('--execution-owner <owner>', 'legacy Session lease execution owner')
    .option('--owner-epoch <epoch>', 'legacy Session lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--request-id <id>', 'idempotent Execution transition request ID')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()))
    .action((opts: {
      session?: string;
      pick?: string;
      json?: boolean;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      execution?: string;
      generation?: number;
      requestId?: string;
      expectedExecutionRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      workflowRoot: string;
    }) => {
      const projectRoot = resolve(opts.workflowRoot);
      sessionMigrationNotice('next', undefined, opts.json);
      try {
        const authority = executionRunAuthority(opts);
        const wasPresent = authority
          ? Boolean(new SessionStore(projectRoot).readExecutionTransition(
              authority.sessionId, authority.executionId, authority.requestId,
            ))
          : false;
        const outcome = authority
          ? runNextExecutionStep(projectRoot, {
              sessionId: authority.sessionId,
              executionId: authority.executionId,
              generation: authority.generation,
              expectedExecutionRevision: authority.expectedExecutionRevision,
              executionLease: authority.executionLease,
              requestId: authority.requestId,
              pick: opts.pick,
              json: opts.json,
            })
          : runNextStep(projectRoot, {
              sessionId: opts.session,
              pick: opts.pick,
              json: opts.json,
              executionOwner: opts.executionOwner,
              ownerEpoch: opts.ownerEpoch,
              leaseId: opts.leaseId,
            });
        if (authority && opts.json) {
          if (outcome.exitCode === 0 && outcome.result) {
            const execution = new SessionStore(projectRoot).readExecution(authority.sessionId, authority.executionId);
            emitExecutionSuccess({
              operation: 'next', result: outcome.result, projectRoot, execution,
              requestId: authority.requestId,
              replay: executionTransitionReplay(
                projectRoot, authority.sessionId, authority.executionId, authority.requestId, wasPresent,
              ),
            });
          } else {
            emitExecutionError({
              operation: 'next', error: new Error(outcome.message), projectRoot,
              sessionId: authority.sessionId, executionId: authority.executionId,
              requestId: authority.requestId,
              exitCode: outcome.exitCode as 1 | 2 | 3,
              disposition: outcome.exitCode === 1 ? 'domain_error' : 'control_flow',
              code: outcome.reasonCode as never,
              details: { reason_code: outcome.reasonCode },
            });
          }
        } else if (opts.json) {
          if (outcome.exitCode === 0 && outcome.result) {
            machineSuccess(
              'next',
              outcome.result,
              { session_id: outcome.result.session_id, run_id: outcome.result.run_id },
              undefined,
              undefined,
              undefined,
              inspectSessionContinuation(projectRoot, outcome.result.session_id, { runId: outcome.result.run_id }),
            );
          } else {
            emitRunResponse(createRunResponseError({
              operation: 'next',
              exit_code: outcome.exitCode as 1 | 2 | 3,
              code: outcome.reasonCode as RunResponseErrorCode,
              message: outcome.message,
              details: { reason_code: outcome.reasonCode },
              continuation: continuationForNextFailure(
                projectRoot,
                opts.session,
                outcome.reasonCode,
                outcome.message,
              ),
            }));
          }
        } else {
          const stream = outcome.exitCode === 0 ? process.stdout : process.stderr;
          stream.write(outcome.message + '\n');
          if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
        }
      } catch (error) {
        if (opts.json && isExecutionRunAttempt(opts)) executionRunError('next', error, projectRoot, opts);
        else if (opts.json) machineError('next', error);
        else reportError(error);
      }
    });

  addExecutionRunOptions(run
    .command('create <command> [args...]')
    .description('Create a Run in an existing or new Session')
    .option('--session <id>', 'explicit Session ID')
    .option('--intent <text>', 'Session metadata only (not passed to the command or Run input.args)')
    .option('--topic <text>', 'command-independent Session topic (Unicode supported)')
    .option('--retry-token <token>', 'opaque single-use token issued by a needs-retry transition')
    .option('--platform <name>', 'target platform persisted for this Run')
    .option('--arg <value>', 'command input stored in Run input.args (repeatable)', collect, [])
    .option('--lease-id <id>', 'private Execution lease token')
    .option('--request-id <id>', 'idempotent Execution transition request ID')
    .option('--json', 'emit run-response/1.0, or 1.1 with --execution')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()))
    .action((command: string, positionalArgs: string[], opts: {
      session?: string;
      intent?: string;
      topic?: string;
      retryToken?: string;
      platform?: string;
      arg: string[];
      json?: boolean;
      execution?: string;
      generation?: number;
      requestId?: string;
      expectedExecutionRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      leaseId?: string;
      workflowRoot: string;
    }) => {
      const projectRoot = resolve(opts.workflowRoot);
      const implicitExecutionTarget = !opts.execution && runAliasUsesExecutionProtocol(projectRoot, opts.session);
      try {
        if (implicitExecutionTarget) {
          throw new InvalidArgumentError(
            'run create in an Execution-capable Session requires --session, --execution, --generation, '
            + '--request-id, --expected-execution-revision, and the full Execution lease tuple',
          );
        }
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        const authority = executionRunAuthority(opts);
        const wasPresent = authority
          ? Boolean(new SessionStore(projectRoot).readExecutionTransition(
              authority.sessionId, authority.executionId, authority.requestId,
            ))
          : false;
        const result = authority
          ? createExecutionRun({
              projectRoot,
              command,
              sessionId: authority.sessionId,
              intent: opts.intent,
              topic: opts.topic,
              retryToken: opts.retryToken,
              platform,
              args: [...opts.arg, ...positionalArgs],
              executionId: authority.executionId,
              generation: authority.generation,
              expectedExecutionRevision: authority.expectedExecutionRevision,
              executionLease: authority.executionLease,
              requestId: authority.requestId,
            })
          : createRun({
              projectRoot,
              command,
              sessionId: opts.session,
              intent: opts.intent,
              topic: opts.topic,
              retryToken: opts.retryToken,
              platform,
              args: [...opts.arg, ...positionalArgs],
            });
        if (!opts.json && result.session_created && opts.session) {
          console.error(
            `Warning: Session "${opts.session}" did not exist; created it for this Run. `
            + `If you meant an existing Session, use its exact ID (see "maestro session list").`,
          );
        }
        if (opts.json && authority) {
          const execution = new SessionStore(projectRoot).readExecution(authority.sessionId, authority.executionId);
          emitExecutionSuccess({
            operation: 'create', result, projectRoot, execution,
            requestId: authority.requestId,
            replay: executionTransitionReplay(
              projectRoot, authority.sessionId, authority.executionId, authority.requestId, wasPresent,
            ),
          });
        } else if (opts.json) {
          machineSuccess('create', result, { session_id: result.session_id, run_id: result.run_id });
        } else {
          print(result);
        }
      } catch (error) {
        if (opts.json && (isExecutionRunAttempt(opts) || implicitExecutionTarget)) {
          executionRunError('create', error, projectRoot, opts);
        } else if (opts.json) machineError('create', error);
        else reportError(error);
      }
    });

  run
    .command('check [run-id]')
    .description('Scan outputs, evaluate Run gates, and refresh the knowledge reconciliation receipt')
    .option('--session <id>', 'explicit Session ID')
    .option('--skip-artifact-metadata-validation', 'downgrade artifact kind/schema/role/alias contract mismatches to warnings')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((runId: string | undefined, opts: {
      session?: string;
      skipArtifactMetadataValidation?: boolean;
      json?: boolean;
      workflowRoot: string;
    }) => {
      const projectRoot = resolve(opts.workflowRoot);
      try {
        const store = new SessionStore(projectRoot);
        let sessionId: string | undefined;
        if (!runId) {
          const resolved = resolveRunningRun(projectRoot, store, opts.session, 'run check');
          if (resolved.kind === 'ok') {
            sessionId = resolved.sessionId;
            runId = resolved.step.run_id;
          } else {
            const active = resolveActiveRunTarget(store, opts.session);
            if (!active) throw new Error(resolved.message);
            sessionId = active.sessionId;
            runId = active.runId;
          }
        }
        const result = checkRun(projectRoot, runId, sessionId ?? opts.session, {
          skipArtifactMetadataValidation: opts.skipArtifactMetadataValidation,
        });
        if (opts.json) {
          const next = result.next
            ? { suggest_only: true as const, command: result.next.command, reason: result.next.reason }
            : null;
          machineSuccess(
            'check',
            result,
            { session_id: result.session_id, run_id: result.run_id },
            undefined,
            null,
            next,
            result.next
              ? continuationAfterCheck(
                  projectRoot,
                  result.session_id,
                  result.run_id,
                  result.gates.blocking.length === 0 && result.errors.length === 0,
                  result.next,
                )
              : inspectSessionContinuation(projectRoot, result.session_id, { runId: result.run_id }),
          );
        } else {
          print(result);
        }
      } catch (error) {
        if (opts.json) {
          machineError('check', error, { locator: { session_id: opts.session ?? null, run_id: runId ?? null } });
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

  addExecutionRunOptions(run
    .command('complete [run-id]')
    .description('Seal a Run and advance its chain step by verdict (免参: resolves the active step)')
    .option('--session <id>', 'explicit Session ID')
    .option('--skip-artifact-metadata-validation', 'downgrade artifact kind/schema/role/alias contract mismatches to warnings')
    .option('--verdict <verdict>', `chain-advance verdict: ${VALID_VERDICTS.join('|')} (default done; ${VERDICT_ALIAS_LABEL})`)
    .option('--summary <text>', 'handoff.summary fallback when the report frontmatter left it empty')
    .option('--reason <text>', 'blocker reason (blocked) merged into handoff concerns')
    .option('--note <text>', 'supplementary concern merged into the handoff (repeatable)', collect, [])
    .option('--decision <text>', 'decision appended to handoff.decisions (repeatable)', collect, [])
    .option('--evidence <path>', 'run-relative evidence path registered as an artifact (repeatable)', collect, [])
    .option('--artifact <path>', 'run-relative path registered as evidence beyond the outputs scan (repeatable)', collect, [])
    .option('--chain-proposal <path>', 'run-relative chain-proposal artifact applied atomically with completion')
    .option('--apply-proposal', 'apply the single validated chain-proposal discovered in this Run')
    .option('--execution-owner <owner>', 'lease execution owner (checked against session.orchestration.lease)')
    .option('--owner-epoch <epoch>', 'lease owner epoch', Number.parseInt)
    .option('--lease-id <id>', 'lease identifier for concurrency safety')
    .option('--request-id <id>', 'idempotent completion request ID')
    .option('--expected-identity-revision <n>', 'expected Session identity revision', Number.parseInt)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', Number.parseInt)
    .option('--json', 'emit run-response/1.0, or 1.1 with --execution')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()))
    .action((runIdArg: string | undefined, opts: {
      session?: string;
      skipArtifactMetadataValidation?: boolean;
      verdict?: string;
      summary?: string;
      reason?: string;
      note: string[];
      decision: string[];
      evidence: string[];
      artifact: string[];
      chainProposal?: string;
      applyProposal?: boolean;
      executionOwner?: string;
      ownerEpoch?: number;
      leaseId?: string;
      execution?: string;
      generation?: number;
      requestId?: string;
      expectedExecutionRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      json?: boolean;
      workflowRoot: string;
    }) => {
      sessionMigrationNotice('complete', 'done', opts.json);
      try {
        const projectRoot = resolve(opts.workflowRoot);
        const executionAuthority = executionRunAuthority(opts);
        if (executionAuthority) {
          const verdict = parseVerdict(opts.verdict);
          if (!verdict) {
            const error = new Error(`invalid --verdict "${opts.verdict}"`);
            if (opts.json) {
              emitExecutionError({
                operation: 'complete', error, projectRoot,
                sessionId: executionAuthority.sessionId, executionId: executionAuthority.executionId,
                requestId: executionAuthority.requestId, exitCode: 2,
                disposition: 'control_flow', code: 'INVALID_VERDICT',
                details: { valid: VALID_VERDICTS },
              });
            } else {
              reportError(error);
            }
            return;
          }
          const store = new SessionStore(projectRoot);
          const executionBefore = store.readExecution(executionAuthority.sessionId, executionAuthority.executionId);
          if (executionBefore.generation !== executionAuthority.generation) {
            throw new Error('Execution generation changed');
          }
          const runId = runIdArg ?? executionBefore.active_run_id;
          if (!runId) throw new InvalidArgumentError('execution-aware complete requires [run-id] or an active Execution Run');
          const result = completeExecutionRun(projectRoot, runId, {
            sessionId: executionAuthority.sessionId,
            executionId: executionAuthority.executionId,
            generation: executionAuthority.generation,
            expectedExecutionRevision: executionAuthority.expectedExecutionRevision,
            executionLease: executionAuthority.executionLease,
            requestId: executionAuthority.requestId,
            chainVerdict: verdict,
            notes: opts.note,
            decisions: opts.decision,
            extraArtifacts: [...opts.artifact, ...opts.evidence],
            summaryFallback: opts.summary,
            chainProposal: opts.chainProposal,
            applyChainProposal: opts.applyProposal,
            skipArtifactMetadataValidation: opts.skipArtifactMetadataValidation,
          });
          if (opts.json) {
            const executionAfter = store.readExecution(executionAuthority.sessionId, executionAuthority.executionId);
            if (result.sealed) {
              emitExecutionSuccess({
                operation: 'complete', result, projectRoot, execution: executionAfter,
                requestId: executionAuthority.requestId,
                replay: {
                  replayed: result.transition.status === 'replayed',
                  transition_id: result.transition.transition_id,
                },
              });
            } else {
              emitExecutionError({
                operation: 'complete', error: new Error('Run gates are blocking completion'), projectRoot,
                sessionId: executionAuthority.sessionId, executionId: executionAuthority.executionId,
                requestId: executionAuthority.requestId, code: 'RUN_GATES_BLOCKING',
                details: { result },
              });
            }
          } else {
            print(result);
            if (!result.sealed) process.exitCode = 1;
          }
          return;
        }

        // Backward-compatible fast path: an explicit run-id with no verbs stays on
        // the plain seal path (identical to the pre-M2 behaviour). Any verdict, or
        // 免参 (no run-id), routes through the chain-driving verdict path.
        const verbless = opts.verdict === undefined && (opts.decision?.length ?? 0) === 0
          && (opts.evidence?.length ?? 0) === 0 && !opts.reason
          && !opts.chainProposal
          && !opts.applyProposal
          && !opts.executionOwner && !opts.leaseId && opts.ownerEpoch === undefined;
        if (runIdArg && verbless) {
          const result = completeRun(projectRoot, runIdArg, opts.session, {
            notes: opts.note,
            extraArtifacts: opts.artifact,
            summaryFallback: opts.summary,
            skipArtifactMetadataValidation: opts.skipArtifactMetadataValidation,
            transition: mutationTransitionOptions(opts),
          });
          if (opts.json) {
            if (result.sealed) machineSuccess(
              'complete',
              result,
              { session_id: result.session_id, run_id: result.run_id },
              { status: result.transition.status, transition_id: result.transition.transition_id },
              result.transition.request_id,
              result.next_action
                ? {
                    suggest_only: true,
                    command: result.next_action.command,
                    reason: result.next_action.reason,
                  }
                : undefined,
              inspectSessionContinuation(projectRoot, result.session_id, { runId: result.run_id }),
            );
            else emitRunResponse(createRunResponseError({
              operation: 'complete',
              exit_code: 1,
              code: 'RUN_GATES_BLOCKING',
              message: 'Run gates are blocking completion',
              details: { result },
              continuation: inspectSessionContinuation(projectRoot, result.session_id, { runId: result.run_id }),
            }));
          } else { print(result); if (!result.sealed) process.exitCode = 1; }
          return;
        }

        const verdict = parseVerdict(opts.verdict);
        if (!verdict) {
          if (opts.json) emitRunResponse(createRunResponseError({ operation: 'complete', exit_code: 2, code: 'INVALID_VERDICT', message: `invalid --verdict "${opts.verdict}"`, details: { valid: VALID_VERDICTS } }));
          else { console.error(`[maestro run] invalid --verdict "${opts.verdict}"; valid: ${VALID_VERDICTS.join(', ')} (${VERDICT_ALIAS_LABEL})`); process.exitCode = 2; }
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
          const resolved = resolveRunningRun(projectRoot, store, opts.session, 'run complete');
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
          chainProposal: opts.chainProposal,
          applyChainProposal: opts.applyProposal,
          skipArtifactMetadataValidation: opts.skipArtifactMetadataValidation,
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
            {
              suggest_only: true,
              command: result.next.command,
              reason: result.next.reason,
            },
            inspectSessionContinuation(projectRoot, result.session_id),
          );
          else emitRunResponse(createRunResponseError({
            operation: 'complete',
            exit_code: 1,
            code: 'RUN_GATES_BLOCKING',
            message: 'Run gates are blocking completion',
            details: { result },
            next: { suggest_only: true, command: result.next.command, reason: result.next.reason },
            continuation: inspectSessionContinuation(projectRoot, result.session_id, { runId: result.run_id }),
          }));
        } else { print(result); process.stderr.write(`next: ${result.next.command}\n      ${result.next.reason}\n`); if (!result.run_sealed) process.exitCode = 1; }
      } catch (error) {
        if (opts.json && isExecutionRunAttempt(opts)) executionRunError('complete', error, resolve(opts.workflowRoot), opts);
        else if (opts.json) machineError('complete', error);
        else reportError(error);
      }
    });

  run
    .command('brief <run-id>')
    .description('Return Resume Packet for a running Run (re-attach workflow + goals + gate status)')
    .option('--session <id>', 'explicit Session ID')
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard|pi)')
    .option('--json', 'emit one run-response/1.0 envelope on stdout')
    .option('--workflow-root <path>', 'project root', process.cwd())
    .action((runId: string, opts: { session?: string; platform?: string; workflowRoot: string; json?: boolean }) => {
      const projectRoot = resolve(opts.workflowRoot);
      try {
        const platform = opts.platform as TargetPlatform | undefined;
        if (platform && !VALID_PLATFORMS.includes(platform)) {
          throw new Error(`unknown platform "${platform}", valid: ${VALID_PLATFORMS.join(', ')}`);
        }
        const result = briefRun(projectRoot, runId, opts.session, platform);
        if (opts.json) {
          machineSuccess(
            'brief',
            result,
            { session_id: result.session.session_id, run_id: result.run.run_id },
            undefined,
            undefined,
            result.recovery.next,
            continuationAfterBrief(
              projectRoot,
              result.session.session_id,
              result.run.run_id,
              result.recovery.next,
            ),
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
            undefined,
            inspectSessionContinuation(resolve(opts.workflowRoot), result.session_id, { runId: result.run_id }),
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
    .option('--platform <name>', 'target platform for tool substitution (claude|codex|agy|agents-standard|pi)')
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

  addExecutionRunOptions(run
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
    .option('--json', 'emit run-response/1.0, or 1.1 with --execution')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd()))
    .action((pointId: string, opts: {
      session: string;
      verdict: string;
      confidence: string;
      summary?: string;
      evidence?: string;
      requestId?: string;
      execution?: string;
      generation?: number;
      expectedExecutionRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      leaseId?: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      sessionMigrationNotice('decide', undefined, opts.json);
      try {
        const verdict = opts.verdict.trim().toLowerCase();
        if (!['proceed', 'fix', 'escalate'].includes(verdict)) {
          if (opts.json && opts.execution) {
            emitExecutionError({
              operation: 'decide', error: new Error(`invalid --verdict "${opts.verdict}"; valid: proceed, fix, escalate`),
              projectRoot: resolve(opts.workflowRoot), sessionId: opts.session, executionId: opts.execution,
              requestId: opts.requestId, exitCode: 2, disposition: 'control_flow', code: 'INVALID_VERDICT',
            });
          } else if (opts.json) {
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
          if (opts.json && opts.execution) {
            emitExecutionError({
              operation: 'decide', error: new Error(`invalid --confidence "${opts.confidence}"; valid: high, medium, low`),
              projectRoot: resolve(opts.workflowRoot), sessionId: opts.session, executionId: opts.execution,
              requestId: opts.requestId, exitCode: 2, disposition: 'control_flow', code: 'INVALID_ARGUMENT',
            });
          } else if (opts.json) {
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
        const projectRoot = resolve(opts.workflowRoot);
        const authority = executionRunAuthority(opts);
        if (authority) {
          const execution = new SessionStore(projectRoot).readExecution(authority.sessionId, authority.executionId);
          if (execution.generation !== authority.generation) throw new Error('Execution generation changed');
        }
        const result = authority
          ? runDecideExecution(projectRoot, authority.sessionId, authority.executionId, pointId, {
              verdict: verdict as DecisionVerdict,
              confidence: confidence as DecisionConfidence,
              summary: opts.summary,
              evidence: opts.evidence,
              requestId: authority.requestId,
              expectedExecutionRevision: authority.expectedExecutionRevision,
              executionLease: authority.executionLease,
            })
          : runDecide(projectRoot, opts.session, pointId, {
              verdict: verdict as DecisionVerdict,
              confidence: confidence as DecisionConfidence,
              summary: opts.summary,
              evidence: opts.evidence,
              transition: mutationTransitionOptions(opts),
            });
        if (opts.json && authority) {
          const execution = new SessionStore(projectRoot).readExecution(authority.sessionId, authority.executionId);
          emitExecutionSuccess({
            operation: 'decide', result, projectRoot, execution,
            requestId: authority.requestId,
            replay: {
              replayed: result.transition.status === 'replayed',
              transition_id: result.transition.transition_id,
            },
          });
        } else if (opts.json) {
          machineSuccess(
            'decide',
            result,
            { session_id: result.session_id, run_id: null },
            { status: result.transition.status, transition_id: result.transition.transition_id },
            result.transition.request_id,
            { suggest_only: true, command: result.next.command, reason: result.next.reason },
            continuationAfterDecide(
              projectRoot,
              result.session_id,
              result.point_id,
              result.verdict,
              result.retry,
            ),
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
        if (opts.json && isExecutionRunAttempt(opts)) {
          executionRunError('decide', error, resolve(opts.workflowRoot), opts);
        } else if (opts.json) {
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
    .description('Deprecated alias for fenced Execution seal, with legacy Session seal fallback')
    .option('--summary <text>', 'human-readable seal summary', '')
    .option('--request-id <id>', 'idempotent Execution seal request ID')
    .option('--expected-execution-revision <n>', 'expected Execution revision', parseNonNegativeInteger)
    .option('--expected-activity-revision <n>', 'expected Session activity revision', parseNonNegativeInteger)
    .option('--owner-id <id>', 'Execution lease owner ID')
    .option('--owner-kind <kind>', 'Execution lease owner kind', parseOwnerKind)
    .option('--lease-epoch <n>', 'Execution lease epoch', parsePositiveInteger)
    .option('--lease-id <token>', 'private Execution lease token')
    .option('--actor <name>', 'authorized actor')
    .option('--reason <text>', 'audit reason')
    .option('--evidence <ref>', 'evidence reference (repeatable)', collect)
    .option('--outcome <value>', 'done|done_with_concerns|failed', 'done')
    .option('--json', 'emit run-response/1.1 for Execution seal, otherwise legacy run-response/1.0')
    .option('--workflow-root <path>', 'project root containing .workflow', process.cwd())
    .action((sessionId: string, opts: {
      summary: string;
      requestId?: string;
      expectedExecutionRevision?: number;
      expectedActivityRevision?: number;
      ownerId?: string;
      ownerKind?: ExecutionOwnerKind;
      leaseEpoch?: number;
      leaseId?: string;
      actor?: string;
      reason?: string;
      evidence?: string[];
      outcome: string;
      json?: boolean;
      workflowRoot: string;
    }) => {
      const root = resolve(opts.workflowRoot);
      const store = new SessionStore(root);
      let executionId: string | undefined;
      let executionProtocol = false;
      const warning = deprecationWarning('maestro run seal-session', 'maestro execution seal');
      try {
        const sessionRecord = store.readSessionRecord(sessionId);
        const replayExecutionId = resolveSealAliasReplay(store, sessionId, opts.requestId);
        if (sessionRecord.schema_version === 'session/2.0') {
          executionProtocol = true;
          const identity = sessionStateV20Schema.parse(sessionRecord);
          executionId = identity.current_execution_id ?? replayExecutionId;
          if (!executionId) {
            throw new Error(`Execution not found for Session ${sessionId}`);
          }
          if (identity.current_execution_id) {
            const current = store.readOpenExecution(sessionId);
            if (!current || current.execution_id !== executionId) {
              throw new Error(
                `Session ${sessionId} current Execution pointer is inconsistent: ${executionId}`,
              );
            }
          }
        } else {
          const current = store.readOpenExecution(sessionId);
          executionId = current?.execution_id ?? replayExecutionId;
          const executions = store.listExecutions(sessionId);
          executionProtocol = Boolean(executionId) || executions.length > 0;
          if (executionProtocol && !executionId) {
            throw new Error(`Execution not found for Session ${sessionId}`);
          }
        }

        if (executionProtocol) {
          if (!executionId) throw new Error(`Execution not found for Session ${sessionId}`);
          if (!opts.requestId || opts.expectedExecutionRevision === undefined
            || opts.expectedActivityRevision === undefined || !opts.ownerId || !opts.ownerKind
            || opts.leaseEpoch === undefined || !opts.leaseId || !opts.actor || !opts.reason
            || !opts.evidence?.length) {
            throw new InvalidArgumentError(
              '--request-id, --expected-execution-revision, --expected-activity-revision, '
              + 'the full lease tuple, --actor, --reason, and at least one --evidence are required',
            );
          }
          if (!['done', 'done_with_concerns', 'failed'].includes(opts.outcome)) {
            throw new InvalidArgumentError('outcome must be done|done_with_concerns|failed');
          }
          const result = sealExecution(root, {
            sessionId,
            executionId,
            requestId: opts.requestId,
            expectedExecutionRevision: opts.expectedExecutionRevision,
            expectedActivityRevision: opts.expectedActivityRevision,
            lease: {
              ownerId: opts.ownerId,
              ownerKind: opts.ownerKind,
              epoch: opts.leaseEpoch,
              leaseId: opts.leaseId,
            },
            summary: opts.summary,
            outcome: opts.outcome as 'done' | 'done_with_concerns' | 'failed',
            actor: opts.actor,
            reason: opts.reason,
            evidence: opts.evidence,
          });
          if (opts.json) {
            emitExecutionSuccess({
              operation: 'execution-seal', result, projectRoot: root, execution: result.execution,
              requestId: opts.requestId,
              replay: { replayed: result.replayed, transition_id: result.transition_id },
              warnings: [warning],
            });
          } else {
            console.error(`[maestro run] deprecated: ${warning.message}`);
            print(result);
          }
          return;
        }

        sessionMigrationNotice('seal-session', 'seal', opts.json);
        const result = sealSession(root, sessionId, opts.summary);
        if (opts.json) machineSuccess('seal-session', result, { session_id: result.session_id, run_id: null });
        else print(result);
      } catch (error) {
        if (opts.json && executionProtocol) {
          emitExecutionError({
            operation: 'execution-seal', error, projectRoot: root, sessionId, executionId,
            requestId: opts.requestId,
            ...(error instanceof InvalidArgumentError
              ? { exitCode: 2 as const, disposition: 'usage_error' as const, code: 'COMMANDER_USAGE' as const }
              : error instanceof Error && /different execution-seal inputs/i.test(error.message)
                ? { code: 'REQUEST_CONFLICT' as const }
                : {}),
            warnings: [warning],
          });
        } else if (opts.json) {
          machineError('seal-session', error, { locator: { session_id: sessionId, run_id: null } });
        } else {
          reportError(error);
        }
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
