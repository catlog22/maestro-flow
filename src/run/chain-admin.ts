// ---------------------------------------------------------------------------
// Chain administration — engine-agnostic Session creation from a predefined
// chain definition, plus the three chain-edit verbs (insert / skip / replace).
//
// This is the canonical home for chain building and mutation that the CLI
// (`maestro session create` / `maestro session chain …`) drives. The ralph
// adapter reuses `createChainSession` (dependency direction ralph → run only;
// src/run must never import src/ralph), so `chainStepId` lives here rather than
// in src/ralph/session-adapter.ts.
//
// Retryable edits go through SessionStore.replayOrApplyTransition so authority
// and the idempotency receipt share one StoreTransaction.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { SessionStore } from './store.js';
import { decompositionSchema, positionSchema } from './schemas.js';
import type {
  OrchestrationDecomposition,
  OrchestrationPosition,
  OrchestrationStep,
  SessionState,
} from './schemas.js';
import { validateSessionId } from './ids.js';
import { checkLease } from './lease.js';
import {
  assertTransitionMutationRevisions,
  createTransitionOutcome,
  prepareTransitionMutation,
  transitionMutationReceipt,
  type TransitionMutationOptions,
  type TransitionMutationResult,
} from './transition-receipts.js';
import type { SessionBundle } from './store.js';

// ── Step id convention (canonical) ───────────────────────────────────────────
// Mirrors the historic ralph convention `step-{NNN}-{command}` so migrated and
// freshly built chains keep a single id shape.

export function chainStepId(index: number, command: string): string {
  return `step-${String(index).padStart(3, '0')}-${command}`;
}

// ── Chain definition schema (file / stdin input) ─────────────────────────────
// Kept local to chain-admin: this is the CLI input surface, not a persisted
// session block. Fields align with orchestrationStepSchema / decisionPointSchema
// on the input face; persisted step ids and status are derived here.

const chainDefStepSchema = z.object({
  command: z.string().min(1),
  args: z.string().optional(),
  stage: z.string().nullable().optional(),
  goal_ref: z.string().nullable().optional(),
  retry_max: z.number().int().nonnegative().optional(),
  // A decision node: names the decision point this step gates on. When set the
  // step is a decision node (dispatched by the orchestrator, not run as a Run).
  decision_ref: z.string().nullable().optional(),
}).strict();

const chainDefDecisionPointSchema = z.object({
  point_id: z.string().min(1),
  after_step_id: z.string().nullable().optional(),
  max_retries: z.number().int().nonnegative().optional(),
}).strict();

const chainDefPositionSchema = z.object({
  lifecycle: z.string(),
  phase: z.number().int().nullable().optional(),
  phase_is_new: z.boolean().optional(),
  milestone: z.string().optional(),
  planning_mode: z.string().nullable().optional(),
  passed_gates: z.array(z.string()).optional(),
  scope_verdict: z.string().nullable().optional(),
}).strict();

const chainDefBoundaryContractSchema = z.object({
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  constraints: z.array(z.string()),
  definition_of_done: z.string(),
}).strict();

const chainDefDecompositionSchema = z.object({
  execution_criteria: z.array(z.string()).optional(),
  goals: z.array(z.unknown()).optional(),
  changelog: z.array(z.unknown()).optional(),
}).strict();

const chainDefExecutorSchema = z.object({
  platform: z.string(),
  cli_tool: z.string(),
}).strict();

export const chainDefinitionSchema = z.object({
  intent: z.string().min(1).optional(),
  engine: z.enum(['ralph', 'coordinator', 'manual']).optional(),
  quality_mode: z.enum(['quick', 'standard', 'full']).optional(),
  auto_mode: z.boolean().optional(),
  steps: z.array(chainDefStepSchema).min(1),
  decision_points: z.array(chainDefDecisionPointSchema).optional(),
  boundary_contract: chainDefBoundaryContractSchema.optional(),
  position: chainDefPositionSchema.nullable().optional(),
  decomposition: chainDefDecompositionSchema.nullable().optional(),
  executor: chainDefExecutorSchema.nullable().optional(),
}).strict().superRefine((definition, ctx) => {
  const pointIds = new Set<string>();
  for (const point of definition.decision_points ?? []) {
    if (pointIds.has(point.point_id)) {
      ctx.addIssue({ code: 'custom', message: `duplicate decision point: ${point.point_id}`, path: ['decision_points'] });
    }
    pointIds.add(point.point_id);
  }
  definition.steps.forEach((step, index) => {
    if (step.decision_ref && !pointIds.has(step.decision_ref)) {
      ctx.addIssue({ code: 'custom', message: `decision_ref has no matching decision point: ${step.decision_ref}`, path: ['steps', index, 'decision_ref'] });
    }
  });
});

export type ChainDefinition = z.infer<typeof chainDefinitionSchema>;

// Default retry ceiling mirrors the ralph decision node default (max_retries: 2).
const DEFAULT_RETRY_MAX = 2;
// Default decision retry ceiling mirrors A_BUILD_STEPS rule 4 (max_retries: 2).
const DEFAULT_DECISION_MAX_RETRIES = 2;

export interface CreateChainSessionOpts {
  intent?: string;
  engine?: 'ralph' | 'coordinator' | 'manual';
  qualityMode?: 'quick' | 'standard' | 'full';
  autoMode?: boolean;
  boundaryContract?: SessionState['boundary_contract'];
  definition?: ChainDefinition;
}

export interface CreateChainSessionResult {
  sessionId: string;
  sessionDir: string;
  session: SessionState;
}

// ── Chain assembly from a definition ─────────────────────────────────────────

function buildChain(steps: ChainDefinition['steps']): OrchestrationStep[] {
  return steps.map((step, index) => {
    const decisionRef = step.decision_ref ?? null;
    const chainStep: OrchestrationStep = {
      step_id: chainStepId(index, step.command),
      command: step.command,
      status: 'pending',
      run_id: null,
      inserted_by: 'build',
      decision_ref: decisionRef,
    };
    if (step.args !== undefined) chainStep.args = step.args;
    if (step.stage !== undefined) chainStep.stage = step.stage;
    if (step.goal_ref !== undefined) chainStep.goal_ref = step.goal_ref;
    // Execution steps carry a retry counter; decision nodes are gated by their
    // decision point's own retry_count, so they do not.
    if (!decisionRef) {
      chainStep.retry = { count: 0, max: step.retry_max ?? DEFAULT_RETRY_MAX };
    }
    return chainStep;
  });
}

function buildDecisionPoints(
  def: ChainDefinition,
): SessionState['orchestration']['decision_points'] {
  const points = def.decision_points ?? [];
  return points.map(point => ({
    point_id: point.point_id,
    after_step_id: point.after_step_id ?? null,
    status: 'pending',
    retry_count: 0,
    max_retries: point.max_retries ?? DEFAULT_DECISION_MAX_RETRIES,
    evidence_ref: null,
  }));
}

function buildPosition(def: ChainDefinition): SessionState['orchestration']['position'] {
  if (!def.position) return null;
  const p = def.position;
  return {
    lifecycle: p.lifecycle,
    phase: p.phase ?? null,
    phase_is_new: p.phase_is_new ?? false,
    milestone: p.milestone ?? '',
    planning_mode: p.planning_mode ?? null,
    passed_gates: p.passed_gates ?? [],
    scope_verdict: p.scope_verdict ?? null,
  };
}

function buildDecomposition(def: ChainDefinition): OrchestrationDecomposition | null {
  if (!def.decomposition) return null;
  // The container is shaped here; store.update() re-parses the whole draft
  // against sessionStateSchema, so a malformed goals/changelog entry is rejected
  // there rather than silently persisted.
  const d = def.decomposition;
  return {
    execution_criteria: d.execution_criteria ?? [],
    goals: (d.goals ?? []) as OrchestrationDecomposition['goals'],
    changelog: (d.changelog ?? []) as OrchestrationDecomposition['changelog'],
  };
}

function timestampId(): string {
  return new Date().toISOString().replace(/[:.\-TZ]/g, '').slice(0, 14);
}

/**
 * Derive a session id from a slug, aligning with the ralph convention
 * `ralph-{YYYYMMDD-HHmmss}`: the slug replaces the fixed prefix. A slug that
 * already looks like a full session id (contains a 14-digit timestamp tail) is
 * used verbatim so callers can pin an explicit id.
 */
export function deriveSessionId(slug: string): string {
  const trimmed = slug.trim();
  validateSessionId(trimmed);
  if (/\d{8}-\d{6}$/.test(trimmed) || /\d{14}$/.test(trimmed)) return trimmed;
  const ts = timestampId();
  const stamp = `${ts.slice(0, 8)}-${ts.slice(8, 14)}`;
  return `${trimmed}-${stamp}`;
}

/**
 * Create a Session from an optional predefined chain definition. Engine may be
 * ralph / coordinator / manual. When no definition is supplied an empty-chain
 * session is created (intent only). The session id is derived from `slug` unless
 * an explicit id is passed.
 */
export function createChainSession(
  projectRoot: string,
  slug: string,
  opts: CreateChainSessionOpts = {},
): CreateChainSessionResult {
  // Public callers are not necessarily the CLI, so do not rely on Commander
  // having parsed the chain-file already. Validate before allocating a Session
  // to avoid leaving an empty shell for an invalid definition.
  const def = opts.definition ? chainDefinitionSchema.parse(opts.definition) : undefined;
  const intent = opts.intent ?? def?.intent;
  if (!intent) {
    throw new Error('intent is required (pass opts.intent or definition.intent)');
  }

  const sessionId = deriveSessionId(slug);
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, intent, { ifExists: 'error' });

  const engine = opts.engine ?? def?.engine ?? 'manual';
  const qualityMode = opts.qualityMode ?? def?.quality_mode ?? 'standard';
  const autoMode = opts.autoMode ?? def?.auto_mode ?? false;

  store.update(sessionId, (draft) => {
    const o = draft.session.orchestration;
    o.engine = engine;
    o.quality_mode = qualityMode;
    o.auto_mode = autoMode;
    const boundaryContract = opts.boundaryContract ?? def?.boundary_contract;
    if (boundaryContract) {
      draft.session.boundary_contract = boundaryContract;
    }
    if (def) {
      o.chain = buildChain(def.steps);
      o.decision_points = buildDecisionPoints(def);
      o.position = buildPosition(def);
      o.decomposition = buildDecomposition(def);
      if (def.executor) o.executor = { platform: def.executor.platform, cli_tool: def.executor.cli_tool };
    }
    return null;
  });

  const session = store.readBundle(sessionId).session;
  return { sessionId, sessionDir: store.sessionDir(sessionId), session };
}

// ── Chain edit verbs ─────────────────────────────────────────────────────────

/**
 * The lowest chain index a new step may occupy. A step may only be inserted
 * after every completed / running / sealed / skipped step — i.e. into the still
 * -pending tail. This is one past the last non-pending step.
 */
function activeBoundary(chain: OrchestrationStep[]): number {
  let boundary = 0;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].status !== 'pending') boundary = i + 1;
  }
  return boundary;
}

/** Resolve an `after` selector (step_id or numeric index) to a chain index. */
function resolveAfterIndex(chain: OrchestrationStep[], after: string): number {
  const asIndex = Number(after);
  if (Number.isInteger(asIndex) && String(asIndex) === after.trim()) {
    if (asIndex < 0 || asIndex >= chain.length) {
      throw new Error(`after index ${asIndex} out of range (chain has ${chain.length} steps)`);
    }
    return asIndex;
  }
  const idx = chain.findIndex(step => step.step_id === after);
  if (idx === -1) throw new Error(`after step not found: ${after}`);
  return idx;
}

function uniqueStepId(
  chain: OrchestrationStep[],
  index: number,
  command: string,
  exclude?: OrchestrationStep,
): string {
  const base = chainStepId(index, command);
  if (!chain.some(step => step !== exclude && step.step_id === base)) return base;
  let suffix = 2;
  while (chain.some(step => step !== exclude && step.step_id === `${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export interface InsertChainStepOpts {
  after: string;
  command: string;
  args?: string;
  stage?: string | null;
  goalRef?: string | null;
  insertedBy: string;
  decisionRef?: string | null;
  transition?: Partial<TransitionMutationOptions>;
}

type ChainMutation =
  | { operation: 'insert'; options: InsertChainStepOpts }
  | { operation: 'skip'; stepId: string }
  | { operation: 'replace'; stepId: string; options: ReplaceChainStepOpts };

function assertMutationGuards(bundle: SessionBundle, options: TransitionMutationOptions): void {
  if (bundle.session.status === 'sealed' || bundle.session.status === 'archived') {
    throw new Error(`Session ${bundle.session.session_id} is ${bundle.session.status} and immutable`);
  }
  assertTransitionMutationRevisions(bundle.session, options);
  const leaseConflict = checkLease(bundle.session.orchestration.lease, options.leaseClaim ?? {});
  if (leaseConflict) throw new Error(leaseConflict);
}

/** Apply exactly one chain edit to an in-memory authority draft. */
export function applyChainMutation(bundle: SessionBundle, mutation: ChainMutation): OrchestrationStep {
  const chain = bundle.session.orchestration.chain;
  if (mutation.operation === 'insert') {
    const opts = mutation.options;
    const afterIdx = resolveAfterIndex(chain, opts.after);
    const insertPos = afterIdx + 1;
    const boundary = activeBoundary(chain);
    if (insertPos < boundary) {
      throw new Error(
        `cannot insert before the active position: insert slot ${insertPos} < active boundary ${boundary} `
        + `(a completed/running/sealed/skipped step occupies index ${boundary - 1})`,
      );
    }
    const decisionRef = opts.decisionRef ?? null;
    const step: OrchestrationStep = {
      step_id: uniqueStepId(chain, insertPos, opts.command), command: opts.command, status: 'pending',
      run_id: null, inserted_by: opts.insertedBy, decision_ref: decisionRef,
    };
    if (opts.args !== undefined) step.args = opts.args;
    if (opts.stage !== undefined) step.stage = opts.stage;
    if (opts.goalRef !== undefined) step.goal_ref = opts.goalRef;
    if (!decisionRef) step.retry = { count: 0, max: DEFAULT_RETRY_MAX };
    if (decisionRef && !bundle.session.orchestration.decision_points.some(point => point.point_id === decisionRef)) {
      bundle.session.orchestration.decision_points.push({
        point_id: decisionRef, after_step_id: chain[afterIdx]?.step_id ?? null, status: 'pending',
        retry_count: 0, max_retries: DEFAULT_DECISION_MAX_RETRIES, evidence_ref: null,
      });
    }
    chain.splice(insertPos, 0, step);
    bundle.session.activity_revision++;
    return step;
  }

  const index = chain.findIndex(step => step.step_id === mutation.stepId);
  if (index === -1) throw new Error(`chain step not found: ${mutation.stepId}`);
  const step = chain[index];
  if (step.status !== 'pending') {
    throw new Error(`only pending steps can be ${mutation.operation === 'skip' ? 'skipped' : 'replaced'}; ${mutation.stepId} is ${step.status}`);
  }
  if (mutation.operation === 'skip') {
    step.status = 'skipped';
    step.run_id = null;
  } else {
    const opts = mutation.options;
    if (opts.command !== undefined) {
      step.command = opts.command;
      step.step_id = uniqueStepId(chain, index, opts.command, step);
    }
    if (opts.args !== undefined) step.args = opts.args;
    if (opts.stage !== undefined) step.stage = opts.stage;
    if (opts.goalRef !== undefined) step.goal_ref = opts.goalRef;
  }
  bundle.session.activity_revision++;
  return step;
}

function runChainMutation(
  projectRoot: string,
  sessionId: string,
  operation: 'chain-insert' | 'chain-replace' | 'chain-skip',
  payload: Record<string, unknown>,
  mutation: ChainMutation,
  transition?: Partial<TransitionMutationOptions>,
): TransitionMutationResult<OrchestrationStep> {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) throw new Error(`session not found: ${sessionId}`);
  const prepared = prepareTransitionMutation({
    session: store.readBundle(sessionId).session,
    currentFence: store.readSessionFence(sessionId),
    operation,
    subject: { session_id: sessionId, run_id: null, chain_step_id: null },
    payload,
    options: transition,
  });
  const evaluated = store.replayOrApplyTransition(sessionId, prepared.request, draft => {
    assertMutationGuards(draft, prepared.options);
    const value = structuredClone(applyChainMutation(draft, mutation));
    return createTransitionOutcome({
      request_id: prepared.request.request_id,
      request_hash: prepared.request.normalized_request_hash,
      operation,
      status: 'applied',
      applied_at: new Date().toISOString(),
      subject: prepared.request.subject,
      postconditions: {
        session_identity_revision: draft.session.identity_revision,
        session_activity_revision: draft.session.activity_revision,
        active_run_id: draft.session.active_run_id,
        run_hash: null,
        artifact_registry_revision: draft.artifacts.revision,
      },
      exit_code: 0,
      error_code: null,
      result: { value },
    });
  });
  const value = structuredClone(evaluated.outcome.result.value) as OrchestrationStep;
  return Object.assign(value, {
    transition: transitionMutationReceipt(prepared.request, evaluated.outcome, evaluated.replayed),
  });
}

/**
 * Insert a new pending step after the `after` step (step_id or index). The
 * insertion slot must be inside the still-pending tail: inserting before any
 * completed / running / sealed / skipped step is rejected. Inserting after the
 * active step (the fix-loop case) is allowed.
 */
export function insertChainStep(
  projectRoot: string,
  sessionId: string,
  opts: InsertChainStepOpts,
): TransitionMutationResult<OrchestrationStep> {
  return runChainMutation(projectRoot, sessionId, 'chain-insert', {
    after: opts.after, command: opts.command, args: opts.args ?? null, stage: opts.stage ?? null,
    goal_ref: opts.goalRef ?? null, inserted_by: opts.insertedBy, decision_ref: opts.decisionRef ?? null,
  }, { operation: 'insert', options: opts }, opts.transition);
}

/**
 * Skip a pending chain step. Only `pending` steps may be skipped — completed /
 * running / sealed / already-skipped steps are rejected. `skipped` is a free
 * status string (the step status field is not a closed enum), and chain.ts's
 * nextPendingIndex selects only `status === 'pending'`, so a skipped step is
 * naturally excluded from step driving.
 */
export function skipChainStep(
  projectRoot: string,
  sessionId: string,
  stepId: string,
  transition?: Partial<TransitionMutationOptions>,
): TransitionMutationResult<OrchestrationStep> {
  return runChainMutation(projectRoot, sessionId, 'chain-skip', { step_id: stepId }, {
    operation: 'skip', stepId,
  }, transition);
}

export interface ReplaceChainStepOpts {
  command?: string;
  args?: string;
  stage?: string | null;
  goalRef?: string | null;
  transition?: Partial<TransitionMutationOptions>;
}

/**
 * Replace fields of a pending chain step in place. Only `pending` steps may be
 * replaced. When `command` changes the step_id is regenerated at the step's
 * current index to keep the `step-{NNN}-{command}` convention consistent.
 */
export function replaceChainStep(
  projectRoot: string,
  sessionId: string,
  stepId: string,
  opts: ReplaceChainStepOpts,
): TransitionMutationResult<OrchestrationStep> {
  return runChainMutation(projectRoot, sessionId, 'chain-replace', {
    step_id: stepId,
    command: opts.command ?? null,
    has_command: opts.command !== undefined,
    args: opts.args ?? null,
    has_args: opts.args !== undefined,
    stage: opts.stage ?? null,
    has_stage: opts.stage !== undefined,
    goal_ref: opts.goalRef ?? null,
    has_goal_ref: opts.goalRef !== undefined,
  }, { operation: 'replace', stepId, options: opts }, opts.transition);
}

// ── Orchestration meta update (position / decomposition整块替换) ───────────────

export interface MetaUpdateOpts {
  /** Parsed JSON validated against positionSchema; null clears the block. */
  position?: OrchestrationPosition | null;
  /** Parsed JSON validated against decompositionSchema; null clears the block. */
  decomposition?: OrchestrationDecomposition | null;
  transition?: Partial<TransitionMutationOptions>;
}

export interface MetaUpdateResult {
  session_id: string;
  updated: Array<'position' | 'decomposition'>;
  position: OrchestrationPosition | null;
  decomposition: OrchestrationDecomposition | null;
  transition: ReturnType<typeof transitionMutationReceipt>;
}

/** Apply an integral meta replacement to an in-memory authority draft. */
export function applyMetaMutation(bundle: SessionBundle, opts: MetaUpdateOpts): Omit<MetaUpdateResult, 'transition'> {
  const orchestration = bundle.session.orchestration;
  const updated: Array<'position' | 'decomposition'> = [];
  if (opts.position !== undefined) {
    orchestration.position = opts.position;
    updated.push('position');
  }
  if (opts.decomposition !== undefined) {
    orchestration.decomposition = opts.decomposition;
    updated.push('decomposition');
  }
  bundle.session.activity_revision++;
  return {
    session_id: bundle.session.session_id,
    updated,
    position: orchestration.position ?? null,
    decomposition: orchestration.decomposition ?? null,
  };
}

/**
 * Parse + validate a caller-supplied position block against positionSchema. The
 * error is surfaced verbatim to the CLI so a malformed block reports the exact
 * offending field rather than a whole-session parse failure.
 */
export function parsePositionInput(raw: unknown): OrchestrationPosition {
  return positionSchema.parse(raw);
}

/** Parse + validate a caller-supplied decomposition block against decompositionSchema. */
export function parseDecompositionInput(raw: unknown): OrchestrationDecomposition {
  return decompositionSchema.parse(raw);
}

/**
 * Integral-replace orchestration.position and/or orchestration.decomposition.
 * The single write入口 for goal-audit / task_decomposition status flips /
 * goal_changelog appends — the prompt layer rebuilds the whole block and submits
 * it here rather than editing session.json directly. At least one block must be
 * provided (enforced by the caller). Blocks are validated by the caller via
 * parsePositionInput / parseDecompositionInput before this replaces them; the
 * transition transaction re-parse is the final guard.
 */
export function updateSessionMeta(
  projectRoot: string,
  sessionId: string,
  opts: MetaUpdateOpts,
): MetaUpdateResult {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const prepared = prepareTransitionMutation({
    session: store.readBundle(sessionId).session,
    currentFence: store.readSessionFence(sessionId),
    operation: 'meta-update',
    subject: { session_id: sessionId, run_id: null, chain_step_id: null },
    payload: {
      position: opts.position ?? null,
      has_position: opts.position !== undefined,
      decomposition: opts.decomposition ?? null,
      has_decomposition: opts.decomposition !== undefined,
    },
    options: opts.transition,
  });
  const evaluated = store.replayOrApplyTransition(sessionId, prepared.request, draft => {
    assertMutationGuards(draft, prepared.options);
    const value = applyMetaMutation(draft, opts);
    return createTransitionOutcome({
      request_id: prepared.request.request_id,
      request_hash: prepared.request.normalized_request_hash,
      operation: 'meta-update', status: 'applied', applied_at: new Date().toISOString(),
      subject: prepared.request.subject,
      postconditions: {
        session_identity_revision: draft.session.identity_revision,
        session_activity_revision: draft.session.activity_revision,
        active_run_id: draft.session.active_run_id,
        run_hash: null,
        artifact_registry_revision: draft.artifacts.revision,
      },
      exit_code: 0, error_code: null, result: { value },
    });
  });
  return {
    ...(structuredClone(evaluated.outcome.result.value) as Omit<MetaUpdateResult, 'transition'>),
    transition: transitionMutationReceipt(prepared.request, evaluated.outcome, evaluated.replayed),
  };
}
