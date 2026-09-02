import { z } from 'zod';
import {
  contractSnapshotSchema,
  creationDecisionSchema,
  creationProvenanceSchema,
  guidanceSnapshotSchema,
  intentIdentitySchema,
  persistedTransitionRecordSchema,
  ralphAuthoritySchema,
  reuseAssessmentReadSchema,
  reuseAssessmentSchema,
  sessionProvenanceSchema,
  topicIdentitySchema,
  transitionPointerSchema,
} from './protocol-schemas.js';

const nonEmptyString = z.string().min(1);
const artifactRoleSchema = z.enum(['primary', 'evidence', 'report', 'attachment', 'checkpoint']);

export const boundaryContractSchema = z.object({
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  constraints: z.array(z.string()),
  definition_of_done: z.string(),
}).strict();

// Chain step retry counter. Default max aligns with the current ralph decision
// ceiling (max_retries: 2 in maestro-ralph.md); count starts at 0.
const chainRetrySchema = z.object({
  count: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
}).strict();

export const pendingRetryTokenSchema = z.object({
  token: nonEmptyString,
  session_id: nonEmptyString,
  parent_run_id: nonEmptyString,
  chain_step_id: nonEmptyString,
  command: nonEmptyString,
  issued_at: nonEmptyString,
  expires_at: nonEmptyString,
}).strict();

export const orchestrationStepStatusSchema = z.enum([
  'pending', 'running', 'completed', 'sealed', 'failed', 'skipped',
]);

const orchestrationStepSchema = z.object({
  step_id: nonEmptyString,
  command: nonEmptyString,
  status: orchestrationStepStatusSchema,
  run_id: z.string().nullable(),
  inserted_by: nonEmptyString,
  decision_ref: z.string().nullable(),
  // session/1.1 chain enrichment (← ralph-meta step_details). All optional so
  // session/1.0 chains parse untouched.
  args: z.string().optional(),
  stage: z.string().nullable().optional(),
  goal_ref: z.string().nullable().optional(),
  retry: chainRetrySchema.optional(),
  pending_retry: pendingRetryTokenSchema.nullable().optional(),
}).strict();

// ── ralph-meta decomposition types, zod-ified locally ────────────────────────
// Migrated from RalphTaskDecompositionItem / GoalChangelogEntry, which lived in
// the now-removed src/ralph/status-schema.ts. Defined locally in run rather than
// imported — the src/ralph/ tree no longer exists to depend on.

const taskDecompositionItemSchema = z.object({
  id: nonEmptyString,
  goal: z.string(),
  boundary: z.string().optional(),
  done_when: z.string().optional(),
  evidence: z.string().optional(),
  lifecycle: z.array(z.string()).optional(),
  status: z.enum(['pending', 'done', 'superseded']),
  completion_confirmed: z.boolean().optional(),
  completed_at: z.string().nullable().optional(),
  superseded_by: z.string().nullable().optional(),
  superseded_at: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
}).strict();

const goalSnapshotSchema = z.object({
  id: nonEmptyString,
  goal: z.string(),
  done_when: z.string().optional(),
}).strict();

const goalChangelogEntrySchema = z.object({
  id: nonEmptyString,
  timestamp: z.string(),
  change_type: z.enum(['modify', 'add', 'remove', 'boundary']),
  reason: z.string(),
  impact_assessment: z.object({
    risk_level: z.enum(['low', 'medium', 'high']),
    invalidated_steps: z.array(z.number().int()),
    new_steps_inserted: z.number().int(),
  }).strict().optional(),
  before: z.object({
    goals: z.array(goalSnapshotSchema),
    boundary_snippet: z.string().optional(),
  }).strict(),
  after: z.object({
    goals: z.array(goalSnapshotSchema),
    boundary_snippet: z.string().optional(),
  }).strict(),
}).strict();

// ── ralph-meta orchestration blocks, promoted into session.json ──────────────

// Exported so the `session meta update` write path can validate a caller-supplied
// position / decomposition block directly (yielding a precise field error) before
// 整块替换 into the session, rather than surfacing a whole-session parse failure.
export const positionSchema = z.object({
  lifecycle: z.string(),
  phase: z.number().int().nullable(),
  phase_is_new: z.boolean(),
  milestone: z.string(),
  planning_mode: z.string().nullable(),
  passed_gates: z.array(z.string()),
  scope_verdict: z.string().nullable(),
}).strict();

export const decompositionSchema = z.object({
  execution_criteria: z.array(z.string()),
  goals: z.array(taskDecompositionItemSchema),
  changelog: z.array(goalChangelogEntrySchema),
}).strict();

const leaseSchema = z.object({
  owner: z.string().nullable(),
  epoch: z.number().int().nonnegative(),
  id: z.string().nullable(),
}).strict();

const executorSchema = z.object({
  platform: z.string(),
  cli_tool: z.string(),
}).strict();

export const decisionPointStatusSchema = z.enum(['pending', 'passed', 'escalated']);

const decisionPointSchema = z.object({
  point_id: nonEmptyString,
  after_step_id: z.string().nullable(),
  status: decisionPointStatusSchema,
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().nonnegative(),
  evidence_ref: z.string().nullable(),
}).strict();

export const executionLeaseSchema = z.object({
  schema_version: z.literal('execution-lease/1.0'),
  session_id: nonEmptyString,
  execution_id: nonEmptyString,
  owner_id: nonEmptyString,
  owner_kind: z.enum(['pi', 'claude', 'codex', 'agy', 'manual']),
  epoch: z.number().int().positive(),
  lease_id: nonEmptyString,
  acquired_at: nonEmptyString,
  heartbeat_at: nonEmptyString,
  handoff_to: z.string().min(1).nullable(),
}).strict();

export const executionStateSchema = z.object({
  schema_version: z.literal('execution/1.0'),
  execution_id: nonEmptyString,
  session_id: nonEmptyString,
  generation: z.number().int().positive(),
  status: z.enum(['active', 'paused', 'sealed']),
  revision: z.number().int().nonnegative(),
  active_run_id: z.string().min(1).nullable(),
  chain: z.array(orchestrationStepSchema),
  decision_points: z.array(decisionPointSchema),
  gates_ref: nonEmptyString,
  artifacts_ref: nonEmptyString,
  evidence_ref: nonEmptyString,
  lease: executionLeaseSchema.nullable(),
  started_at: nonEmptyString,
  sealed_at: z.string().min(1).nullable(),
  seal_summary: z.string().nullable(),
  final_outcome: z.enum(['done', 'done_with_concerns', 'failed']).nullable(),
}).strict();

/** Canonical execution/1.0 writer schema. */
export const executionSchema = executionStateSchema;

const legacySessionRequestSchema = z.object({
  request_id: nonEmptyString,
  type: nonEmptyString,
  status: nonEmptyString,
  payload: z.unknown(),
  claimed_by_run_id: z.string().nullable(),
}).strict();

export const sessionStateV1ReadSchema = z.object({
  // Accept legacy generations; the store rewrites mutations to session/1.3. session/1.0 files
  // are read losslessly — new orchestration fields carry optional/nullable defaults.
  schema_version: z.enum(['session/1.0', 'session/1.1']),
  session_id: nonEmptyString,
  intent: nonEmptyString,
  status: z.enum(['running', 'paused', 'sealed', 'archived', 'failed']),
  identity_revision: z.number().int().nonnegative(),
  activity_revision: z.number().int().nonnegative(),
  active_run_id: z.string().nullable(),
  latest_completed_run_id: z.string().nullable(),
  boundary_contract: boundaryContractSchema,
  orchestration: z.object({
    engine: z.enum(['ralph', 'coordinator', 'manual']),
    quality_mode: z.enum(['quick', 'standard', 'full']),
    auto_mode: z.boolean(),
    chain: z.array(orchestrationStepSchema),
    decision_points: z.array(decisionPointSchema),
    // session/1.1 orchestration blocks (← ralph-meta.json). Absent in 1.0 files;
    // default to null so non-ralph sessions carry zero weight.
    position: positionSchema.nullable().optional().default(null),
    decomposition: decompositionSchema.nullable().optional().default(null),
    lease: leaseSchema.nullable().optional().default(null),
    executor: executorSchema.nullable().optional().default(null),
  }).strict(),
  requests: z.array(legacySessionRequestSchema),
  lifecycle: z.object({
    sealed_at: z.string().nullable(),
    seal_summary: z.string().nullable(),
    promoted_spec_ids: z.array(z.string()),
    promoted_knowhow_ids: z.array(z.string()),
    forked_from: z.object({ session_id: nonEmptyString, run_id: nonEmptyString }).strict().nullable(),
  }).strict(),
  refs: z.object({
    gates: z.literal('gates.json'),
    artifacts: z.literal('artifacts.json'),
    evidence: z.literal('evidence.json'),
  }).strict(),
}).strict();

export const sessionStateV12Schema = sessionStateV1ReadSchema
  .omit({ schema_version: true, requests: true })
  .extend({
    schema_version: z.literal('session/1.2'),
    intent_identity: intentIdentitySchema.nullable(),
    provenance: sessionProvenanceSchema,
    requests: z.array(z.union([persistedTransitionRecordSchema, legacySessionRequestSchema])),
    ralph_authority: ralphAuthoritySchema.nullable(),
  })
  .strict();

export const sessionStateV13Schema = sessionStateV12Schema
  .omit({ schema_version: true })
  .extend({
    schema_version: z.literal('session/1.3'),
    topic_identity: topicIdentitySchema.nullable(),
  })
  .strict();

/**
 * Statusless Session identity/index authority. Execution lifecycle, chain,
 * gates, artifacts, and evidence deliberately live outside this strict shape.
 */
export const sessionStateV20Schema = z.object({
  schema_version: z.literal('session/2.0'),
  session_id: nonEmptyString,
  intent: nonEmptyString,
  topic_identity: topicIdentitySchema.nullable(),
  identity_revision: z.number().int().nonnegative(),
  activity_revision: z.number().int().nonnegative(),
  current_execution_id: z.string().min(1).nullable(),
  latest_execution_id: z.string().min(1).nullable(),
  latest_completed_run_id: z.string().min(1).nullable(),
  archived_at: z.string().min(1).nullable(),
  archived_by: z.string().min(1).nullable(),
}).strict().superRefine((session, ctx) => {
  if ((session.archived_at === null) !== (session.archived_by === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['archived_at'],
      message: 'archived_at and archived_by must both be null or both be present',
    });
  }
});

export const sessionStatusV30Schema = z.enum([
  'open', 'completed', 'archived', 'failed',
]);

/**
 * Read-only status vocabulary for pre-simplification session/3.0 documents.
 * The retired `paused` status no longer exists in the engine; readers that
 * accept it must map it to `open` (see SessionStore.readSessionV30).
 */
const sessionStatusV30ReadSchema = z.enum([
  'open', 'paused', 'completed', 'archived', 'failed',
]);

export const sessionChainStepV30Schema = z.object({
  step_id: nonEmptyString,
  command: nonEmptyString,
  args: z.array(z.string()),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  run_ids: z.array(nonEmptyString),
  goal_ref: z.string().min(1).nullable(),
  // Decision gate declaration: when non-null, the decision identified by this
  // id must be `resolved` before the chain may advance past this step (run
  // next checks the completed predecessor) and before the Session completes.
  // Default null keeps pre-gate session/3.0 files parseable; the write path
  // always assigns it explicitly.
  decision_ref: z.string().min(1).nullable().default(null),
  decision_refs: z.array(nonEmptyString),
  stage: z.string().min(1).nullable().optional(),
}).strict();

export const sessionDecisionRefV30Schema = z.object({
  decision_id: nonEmptyString,
  after_step_id: z.string().min(1).nullable(),
  status: z.enum(['open', 'resolved', 'escalated']),
  evidence_refs: z.array(nonEmptyString),
}).strict();

/** Session/Run minimal-state authority. activity_revision is observational, never a CAS target. */
export const sessionStateV30Schema = z.object({
  schema_version: z.literal('session/3.0'),
  session_id: nonEmptyString,
  objective: nonEmptyString,
  definition_of_done: z.string(),
  status: sessionStatusV30Schema,
  orchestration_revision: z.number().int().nonnegative(),
  activity_revision: z.number().int().nonnegative(),
  chain: z.array(sessionChainStepV30Schema),
  decisions: z.array(sessionDecisionRefV30Schema),
  active_run_ids: z.array(nonEmptyString),
  artifacts_ref: nonEmptyString,
  evidence_ref: nonEmptyString,
  created_at: nonEmptyString,
  updated_at: nonEmptyString,
  completed_at: z.string().min(1).nullable(),
  archived_at: z.string().min(1).nullable(),
}).strict();

/**
 * Read-tolerant session/3.0 variant. Pre-simplification documents may still
 * carry the retired `identity_revision`/`gates_ref` fields and the retired
 * `paused` status. Retired keys are stripped on read (the write path stays
 * strict and never re-emits them); callers map `paused` to `open` (the
 * engine no longer has a paused Session status — see SessionStore.readSessionV30).
 */
export const sessionStateV30ReadSchema = sessionStateV30Schema
  .extend({ status: sessionStatusV30ReadSchema })
  .strip();

export const sessionSchemaWriterSchema = z.enum([
  'session/1.3', 'session/2.0', 'session/3.0',
]);

export const sessionSchemaSelectionSchema = z.object({
  schema_version: z.literal('session-schema-selection/1.0'),
  writer: sessionSchemaWriterSchema,
  features: z.object({
    session_statusless: z.boolean(),
  }).strict(),
}).strict().superRefine((selection, ctx) => {
  const enabled = selection.writer === 'session/2.0';
  if (selection.features.session_statusless !== enabled) {
    ctx.addIssue({
      code: 'custom',
      path: ['features', 'session_statusless'],
      message: 'session_statusless must be enabled exactly when writer is session/2.0',
    });
  }
});

export const projectSessionSchemaConfigSchema = z.object({
  session_schema: sessionSchemaSelectionSchema.optional(),
}).passthrough();

/**
 * Passthrough fallback for unknown future session schema versions.
 * Preserves all fields without validation so older CLI versions can read
 * session.json written by newer versions without crashing.
 *
 * The refinement ensures this fallback ONLY matches truly unknown versions —
 * known versions with invalid data still fail the union (correct behavior).
 */
const KNOWN_SESSION_VERSIONS = new Set([
  'session/1.0', 'session/1.1', 'session/1.2', 'session/1.3', 'session/2.0', 'session/3.0',
]);
const sessionStateUnknownSchema = z.object({
  schema_version: z.string(),
}).passthrough().refine(
  (data) => !KNOWN_SESSION_VERSIONS.has(data.schema_version),
  { message: 'Known session version with invalid data should not match the passthrough fallback' },
);

export type SessionStateInput = z.infer<typeof sessionStateV1ReadSchema>
  | z.infer<typeof sessionStateV12Schema>
  | z.infer<typeof sessionStateV13Schema>
  | z.infer<typeof sessionStateUnknownSchema>;

export function normalizeSessionState(session: SessionStateInput): z.infer<typeof sessionStateV13Schema> {
  if (session.schema_version === 'session/1.3') return session as z.infer<typeof sessionStateV13Schema>;
  if (session.schema_version === 'session/1.2') {
    return sessionStateV13Schema.parse({ ...session, schema_version: 'session/1.3', topic_identity: null });
  }
  if (session.schema_version === 'session/1.0' || session.schema_version === 'session/1.1') {
    return sessionStateV13Schema.parse({
      ...session,
      schema_version: 'session/1.3',
      intent_identity: null,
      topic_identity: null,
      provenance: {
        source: 'legacy-inferred',
        forked_from: null,
        imported_from: [],
        created_by: 'legacy',
      },
      ralph_authority: null,
    });
  }
  // Unknown future version — return as-is with best-effort cast.
  // The write path always produces session/1.3, so this only affects reads.
  return session as unknown as z.infer<typeof sessionStateV13Schema>;
}

/** Strict known-version reader with schema_version as the type discriminator. */
export const knownSessionStateReadSchema = z.discriminatedUnion('schema_version', [
  sessionStateV30ReadSchema,
  sessionStateV20Schema,
  sessionStateV13Schema,
  sessionStateV12Schema,
  sessionStateV1ReadSchema,
]);

/** Typed reader for known generations plus the existing future-version fallback. */
export const sessionStateReadSchema = z.union([
  knownSessionStateReadSchema,
  sessionStateUnknownSchema,
]);
/** Backward-compatible legacy reader. It intentionally rejects session/2.0 and session/3.0. */
export const sessionStateSchema = z.union([
  sessionStateV13Schema,
  sessionStateV12Schema,
  sessionStateV1ReadSchema,
  sessionStateUnknownSchema,
]).transform(session => normalizeSessionState(session));

const gateCheckSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), field: nonEmptyString, equals: z.unknown() }).strict(),
  z.object({
    type: z.literal('artifact'),
    kind: nonEmptyString,
    require_status: z.literal('sealed').optional(),
    alias: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal('file'), path: nonEmptyString, exists: z.boolean() }).strict(),
  z.object({ type: z.literal('schema'), artifact_ref: nonEmptyString, schema_id: nonEmptyString }).strict(),
  z.object({ type: z.literal('command'), argv: z.array(z.string()).min(1), expect_exit: z.number().int() }).strict(),
  z.object({ type: z.literal('decision'), point: nonEmptyString, outcome: nonEmptyString }).strict(),
  z.object({ type: z.literal('manual'), prompt: nonEmptyString }).strict(),
]);

export const gateSchema = z.object({
  key: nonEmptyString,
  title: nonEmptyString,
  scope: z.enum(['session', 'entry', 'phase', 'exit', 'transition', 'knowledge']),
  run_id: z.string().nullable(),
  required: z.boolean(),
  blocking: z.boolean(),
  applicable_modes: z.array(z.enum(['quick', 'standard', 'full'])),
  status: z.enum(['pending', 'running', 'passed', 'failed', 'blocked', 'waived', 'skipped']),
  check: gateCheckSchema,
  evidence_refs: z.array(z.string()),
  waiver: z.object({
    reason: nonEmptyString,
    approved_by: nonEmptyString,
    approved_at: nonEmptyString,
  }).strict().nullable(),
}).strict();

export const gateRegistrySchema = z.object({
  schema_version: z.literal('gates/1.0'),
  revision: z.number().int().nonnegative(),
  gates: z.record(z.string(), gateSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    active_gate_ids: z.array(z.string()),
    blocking_run_id: z.string().nullable(),
  }).strict(),
}).strict();

export const artifactSchema = z.object({
  kind: nonEmptyString,
  role: artifactRoleSchema,
  producer_run_id: nonEmptyString,
  relative_path: nonEmptyString,
  media_type: nonEmptyString,
  schema_version: nonEmptyString,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  status: z.enum(['draft', 'sealed', 'invalid', 'superseded']),
  derived_from: z.array(z.string()),
  replaces: z.string().nullable(),
}).strict();

export const artifactRegistrySchema = z.object({
  schema_version: z.literal('artifacts/1.0'),
  revision: z.number().int().nonnegative(),
  artifacts: z.record(z.string(), artifactSchema),
  aliases: z.record(z.string(), z.string()),
}).strict();

export const evidenceRecordSchema = z.object({
  run_id: nonEmptyString,
  command: nonEmptyString,
  kind: nonEmptyString,
  point: nonEmptyString,
  claim: z.string(),
  outcome: z.string(),
  rationale: z.string().max(2000),
  status: z.enum(['proposed', 'accepted', 'rejected', 'superseded']),
  artifact_refs: z.array(z.string()),
  gate_refs: z.array(z.string()),
  source_refs: z.array(z.string()),
}).strict();

export const evidenceStoreSchema = z.object({
  schema_version: z.literal('evidence/1.0'),
  revision: z.number().int().nonnegative(),
  records: z.record(z.string(), evidenceRecordSchema),
}).strict();

export const handoffSchema = z.object({
  schema_version: z.literal('command-handoff/1.0'),
  producer_run_id: nonEmptyString,
  command: nonEmptyString,
  verdict: z.enum(['ready', 'ready_with_concerns', 'blocked', 'failed']),
  summary: z.string(),
  constraints: z.array(z.object({
    id: nonEmptyString,
    status: z.enum(['locked', 'open', 'deferred']),
    text: z.string(),
  }).strict()),
  decisions: z.array(z.object({
    id: nonEmptyString,
    status: z.enum(['proposed', 'accepted', 'rejected']),
    text: z.string(),
  }).strict()),
  concerns: z.array(z.string()),
  artifact_refs: z.array(z.string()),
  next: z.array(z.object({
    command: nonEmptyString,
    reason: z.string(),
    needs: z.array(z.string()),
  }).strict()),
  details: z.record(z.string(), z.unknown()),
}).strict();

export const targetPlatformSchema = z.enum(['claude', 'codex', 'agy', 'agents-standard', 'pi', 'grok']);

export const goalBindingSchema = z.object({
  provider: nonEmptyString,
  external_id: z.string().nullable(),
  step_goal_ref: z.string().nullable(),
  observed_status: z.enum(['active', 'complete', 'blocked', 'unknown']),
  observed_at: nonEmptyString,
}).strict();

export const dispatchExpectationSchema = z.object({
  run_id: nonEmptyString,
  chain_step_id: nonEmptyString,
  team_task_id: nonEmptyString,
  revision: z.number().int().nonnegative(),
  dispatched_at: nonEmptyString,
}).strict();

export const runCheckpointSchema = z.object({
  run_id: nonEmptyString,
  chain_step_id: nonEmptyString,
  team_task_id: nonEmptyString,
  revision: z.number().int().nonnegative(),
  artifact_id: z.string().nullable(),
  verdict: z.enum(['pass', 'warn', 'block', 'unknown']),
  authoritative: z.boolean(),
  updated_at: nonEmptyString,
}).strict();

export const retryFenceSchema = z.object({
  token: nonEmptyString,
  chain_step_id: nonEmptyString,
  issued_at: nonEmptyString,
  expires_at: nonEmptyString,
  consumed_at: z.string().nullable(),
}).strict();

const commandRunBaseSchema = z.object({
  session_id: nonEmptyString,
  run_id: nonEmptyString,
  sequence: z.number().int().positive(),
  parent_run_id: z.string().nullable(),
  command: z.object({
    name: nonEmptyString,
    version: nonEmptyString,
    source_path: z.string(),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    resolved_prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
    contract_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
  status: z.enum(['created', 'running', 'blocked', 'failed', 'completed', 'sealed']),
  input: z.object({
    args: z.array(z.string()),
    consumes: z.array(z.string()),
    context_identity_revision: z.number().int().nonnegative(),
  }).strict(),
  gate_ids: z.array(z.string()),
  output: z.object({
    produces: z.array(z.string()),
    primary_artifact_id: z.string().nullable(),
    verdict: z.enum(['ready', 'ready_with_concerns', 'blocked', 'failed']).nullable(),
  }).strict(),
  handoff: handoffSchema.nullable(),
  started_at: nonEmptyString,
  completed_at: z.string().nullable(),
  sealed_at: z.string().nullable(),
}).strict();

export const commandRunV1Schema = commandRunBaseSchema.extend({
  schema_version: z.literal('command-run/1.0'),
}).strict();

export const commandRunV11Schema = commandRunBaseSchema.extend({
  schema_version: z.literal('command-run/1.1'),
  chain_step_id: z.string().nullable(),
  resolved_platform: targetPlatformSchema,
  goal_binding: goalBindingSchema.nullable(),
  checkpoint_expectation: dispatchExpectationSchema.nullable(),
  checkpoint: runCheckpointSchema.nullable(),
  retry_fence: retryFenceSchema.nullable(),
}).strict();

export const commandRunV12Schema = commandRunBaseSchema.extend({
  schema_version: z.literal('command-run/1.2'),
  chain_step_id: z.string().nullable(),
  resolved_platform: targetPlatformSchema,
  goal_binding: goalBindingSchema.nullable(),
  checkpoint_expectation: dispatchExpectationSchema.nullable(),
  checkpoint: runCheckpointSchema.nullable(),
  retry_fence: retryFenceSchema.nullable(),
  contract_snapshot: contractSnapshotSchema.nullable(),
  guidance_snapshot: guidanceSnapshotSchema.nullable(),
  creation_decision: creationDecisionSchema.nullable(),
  creation_provenance: creationProvenanceSchema,
  transition: transitionPointerSchema.nullable(),
}).strict();

export const commandRunV13Schema = commandRunV12Schema
  .omit({ schema_version: true, input: true })
  .extend({
    schema_version: z.literal('command-run/1.3'),
    input: commandRunBaseSchema.shape.input.extend({
      reuse_assessments: z.array(reuseAssessmentSchema),
    }).strict(),
  })
  .strict();

export const commandRunV14Schema = commandRunV13Schema
  .omit({ schema_version: true, input: true })
  .extend({
    schema_version: z.literal('command-run/1.4'),
    input: commandRunBaseSchema.shape.input.extend({
      reuse_assessments: z.array(reuseAssessmentReadSchema),
    }).strict(),
    execution_id: nonEmptyString,
    generation: z.number().int().positive(),
  })
  .strict();

export const runStatusV30Schema = z.enum([
  'pending', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'sealed',
]);

export const runV30Schema = z.object({
  schema_version: z.literal('run/3.0'),
  run_id: nonEmptyString,
  session_id: nonEmptyString,
  step_id: nonEmptyString,
  parent_run_id: z.string().min(1).nullable(),
  retry_of_run_id: z.string().min(1).nullable(),
  attempt: z.number().int().positive(),
  command: nonEmptyString,
  args: z.array(z.string()),
  goal: z.string().min(1).nullable(),
  status: runStatusV30Schema,
  revision: z.number().int().nonnegative(),
  actor_id: nonEmptyString,
  input_refs: z.array(nonEmptyString),
  output_refs: z.array(nonEmptyString),
  primary_artifact_id: z.string().min(1).nullable(),
  verdict: z.enum(['done', 'done_with_concerns', 'needs_retry', 'blocked']).nullable(),
  summary: z.string().nullable(),
  legacy_execution_generation: z.number().int().positive().nullable().optional(),
  created_at: nonEmptyString,
  started_at: z.string().min(1).nullable(),
  ended_at: z.string().min(1).nullable(),
  sealed_at: z.string().min(1).nullable(),
}).strict();

/**
 * Read-tolerant run/3.0 variant. Pre-simplification documents may still carry
 * the retired `participant_id`/`gate_refs` fields; they are stripped on read
 * so the write path stays strict and never re-emits them.
 */
export const runV30ReadSchema = runV30Schema.strip();

/**
 * Passthrough fallback for unknown future command-run/run schema versions.
 * The refinement ensures this fallback ONLY matches truly unknown versions.
 */
const KNOWN_RUN_VERSIONS = new Set([
  'command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3', 'command-run/1.4', 'run/3.0',
]);
const commandRunUnknownSchema = z.object({
  schema_version: z.string(),
}).passthrough().refine(
  (data) => !KNOWN_RUN_VERSIONS.has(data.schema_version),
  { message: 'Known run version with invalid data should not match the passthrough fallback' },
);

export const commandRunReadSchema = z.union([
  commandRunV14Schema,
  commandRunV13Schema,
  commandRunV12Schema,
  commandRunV11Schema,
  commandRunV1Schema,
  commandRunUnknownSchema,
]);

/** Canonical Run reader for legacy command-run documents, v3, and unknown future versions. */
export const runReadSchema = z.union([
  runV30ReadSchema,
  commandRunV14Schema,
  commandRunV13Schema,
  commandRunV12Schema,
  commandRunV11Schema,
  commandRunV1Schema,
  commandRunUnknownSchema,
]);
export type CommandRunInput = z.infer<typeof commandRunReadSchema>;
export type RunRead = z.infer<typeof runReadSchema>;
export type CommandRun = z.infer<typeof commandRunV13Schema>;
export type CommandRunV14 = z.infer<typeof commandRunV14Schema>;
export type RunV30 = z.infer<typeof runV30Schema>;

export function normalizeCommandRun(
  run: CommandRunInput,
  fallbackPlatform: z.infer<typeof targetPlatformSchema> = 'claude',
): CommandRun {
  if (run.schema_version === 'command-run/1.4') {
    const { execution_id: _executionId, generation: _generation, ...compatibilityRun } = run;
    return { ...compatibilityRun, schema_version: 'command-run/1.3' } as CommandRun;
  }
  if (run.schema_version === 'command-run/1.3') return run as CommandRun;
  if (run.schema_version === 'command-run/1.2') {
    return commandRunV13Schema.parse({
      ...run,
      schema_version: 'command-run/1.3',
      input: { ...(run as z.infer<typeof commandRunV12Schema>).input, reuse_assessments: [] },
    });
  }
  if (run.schema_version === 'command-run/1.0' || run.schema_version === 'command-run/1.1') {
    const v11 = run.schema_version === 'command-run/1.1' ? run : commandRunV11Schema.parse({
      ...run,
      schema_version: 'command-run/1.1',
      chain_step_id: null,
      resolved_platform: fallbackPlatform,
      goal_binding: null,
      checkpoint_expectation: null,
      checkpoint: null,
      retry_fence: null,
    });
    const v12 = commandRunV12Schema.parse({
      ...v11,
      schema_version: 'command-run/1.2',
      contract_snapshot: null,
      guidance_snapshot: null,
      creation_decision: null,
      creation_provenance: {
        schema_version: 'creation-provenance/1.0',
        provenance: run.schema_version === 'command-run/1.1' ? 'verified-v1' : 'legacy-inferred',
        source_workspace_id: null,
        source_session_id: null,
        source_run_id: null,
        imported_artifact_hashes: [],
      },
      transition: null,
    });
    return commandRunV13Schema.parse({
      ...v12,
      schema_version: 'command-run/1.3',
      input: { ...v12.input, reuse_assessments: [] },
    });
  }
  // Unknown future version — return as-is with best-effort cast.
  return run as unknown as CommandRun;
}

/**
 * Promote either compatibility or execution-bound input to command-run/1.4.
 * Callers reading a legacy Run must supply its resolved Execution binding;
 * no synthetic execution identity is inferred at the schema boundary.
 */
export function normalizeCommandRunV14(
  run: CommandRunInput,
  binding?: { execution_id: string; generation: number },
  fallbackPlatform: z.infer<typeof targetPlatformSchema> = 'claude',
): CommandRunV14 {
  if (run.schema_version === 'command-run/1.4') return commandRunV14Schema.parse(run);
  if (!binding) {
    throw new Error('execution binding is required to normalize a legacy command Run to command-run/1.4');
  }
  const compatibilityRun = normalizeCommandRun(run, fallbackPlatform);
  return commandRunV14Schema.parse({
    ...compatibilityRun,
    schema_version: 'command-run/1.4',
    execution_id: binding.execution_id,
    generation: binding.generation,
  });
}

/** Backward-compatible read schema. New legacy-path writes must use commandRunV13Schema. */
export const commandRunSchema = commandRunReadSchema.transform(run => normalizeCommandRun(run));

export const artifactMetaSchema = z.object({
  kind: nonEmptyString,
  schema: nonEmptyString,
  role: artifactRoleSchema.optional(),
  alias: z.string().min(1).optional(),
}).strict();

// report.md frontmatter contract — the LLM's half-structured exit.
// `id` is CLI-derived: the schema accepts items with or without an explicit
// id (and even legacy plain-string shorthand) and stamps deterministic
// C-{n} / D-{n} ids on parse, so a Run check never rejects a report whose
// author followed the documented {text, status} / {command, reason, needs}
// examples.
const reportConstraintItemSchema = z
  .union([
    z.string(),
    z.object({
      id: nonEmptyString.optional(),
      text: z.string(),
      status: z.enum(['locked', 'open', 'deferred']),
    }).strict(),
    z.object({ locked: z.string() }).strict(),
    z.object({ open: z.string() }).strict(),
    z.object({ deferred: z.string() }).strict(),
  ])
  .transform((item) => {
    if (typeof item === 'string') return { text: item, status: 'open' as const };
    if ('text' in item) return item;
    const entry = Object.entries(item)[0] as [keyof typeof item, string];
    return { text: entry[1], status: entry[0] };
  });

const reportDecisionItemSchema = z
  .union([
    z.string(),
    z.object({
      id: nonEmptyString.optional(),
      text: z.string(),
      status: z.enum(['proposed', 'accepted', 'rejected']),
    }).strict(),
    z.object({ proposed: z.string() }).strict(),
    z.object({ accepted: z.string() }).strict(),
    z.object({ rejected: z.string() }).strict(),
  ])
  .transform((item) => {
    if (typeof item === 'string') return { text: item, status: 'proposed' as const };
    if ('text' in item) return item;
    const entry = Object.entries(item)[0] as [keyof typeof item, string];
    return { text: entry[1], status: entry[0] };
  });

const reportNextItemSchema = z.union([
  z.string(),
  z.object({
    command: nonEmptyString,
    reason: z.string().default(''),
    needs: z.array(z.string()).default([]),
  }).strict(),
]);

/** Frontmatter verdict accepts the chain-advance tokens too and maps them onto
 * the report-layer ready vocabulary (mirroring the CLI alias table), so an
 * agent that mirrors `session done --verdict` and writes `verdict: done` in
 * report.md never hard-fails the frontmatter. Ready tokens stay exact/case
 * sensitive, as before. */
const reportVerdictSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const token = value.trim().toLowerCase().replace(/_/g, '-');
    if (token === 'done') return 'ready';
    if (token === 'done-with-concerns') return 'ready_with_concerns';
    if (token === 'needs-retry') return 'failed';
    return value;
  },
  z.enum(['ready', 'ready_with_concerns', 'blocked', 'failed']).default('ready'),
);

export const reportFrontmatterSchema = z.object({
  verdict: reportVerdictSchema,
  summary: z.string().default(''),
  constraints: z.array(reportConstraintItemSchema).default([]),
  decisions: z.array(reportDecisionItemSchema).default([]),
  concerns: z.array(z.string()).default([]),
  next: z.array(reportNextItemSchema).default([]),
  details: z.record(z.string(), z.unknown()).default({}),
}).passthrough().transform((fm) => ({
  ...fm,
  constraints: fm.constraints.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `C-${String(index + 1).padStart(3, '0')}`, text: item, status: 'open' as const };
    }
    return { ...item, id: item.id ?? `C-${String(index + 1).padStart(3, '0')}` };
  }),
  decisions: fm.decisions.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `D-${String(index + 1).padStart(3, '0')}`, text: item, status: 'proposed' as const };
    }
    return { ...item, id: item.id ?? `D-${String(index + 1).padStart(3, '0')}` };
  }),
  next: fm.next.map((item) => {
    if (typeof item === 'string') return { command: item, reason: '', needs: [] as string[] };
    return item;
  }),
}));

export type SessionState = z.infer<typeof sessionStateV13Schema>;
export type SessionIdentityV20 = z.infer<typeof sessionStateV20Schema>;
export type SessionStateV30 = z.infer<typeof sessionStateV30Schema>;
export type SessionStateRead = z.infer<typeof sessionStateReadSchema>;
export type SessionSchemaWriter = z.infer<typeof sessionSchemaWriterSchema>;
export type SessionSchemaSelection = z.infer<typeof sessionSchemaSelectionSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type ExecutionState = Execution;
export type ExecutionLease = z.infer<typeof executionLeaseSchema>;
export type OrchestrationStep = z.infer<typeof orchestrationStepSchema>;
export type PendingRetryToken = z.infer<typeof pendingRetryTokenSchema>;
export type OrchestrationPosition = z.infer<typeof positionSchema>;
export type OrchestrationDecomposition = z.infer<typeof decompositionSchema>;
export type OrchestrationLease = z.infer<typeof leaseSchema>;
export type OrchestrationExecutor = z.infer<typeof executorSchema>;
export type TaskDecompositionItem = z.infer<typeof taskDecompositionItemSchema>;
export type GoalChangelogEntry = z.infer<typeof goalChangelogEntrySchema>;
export type Gate = z.infer<typeof gateSchema>;
export type GateRegistry = z.infer<typeof gateRegistrySchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactRegistry = z.infer<typeof artifactRegistrySchema>;
export type EvidenceStore = z.infer<typeof evidenceStoreSchema>;
export type Handoff = z.infer<typeof handoffSchema>;
export type GoalBinding = z.infer<typeof goalBindingSchema>;
export type DispatchExpectation = z.infer<typeof dispatchExpectationSchema>;
export type RunCheckpoint = z.infer<typeof runCheckpointSchema>;
export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;
export type ReportFrontmatter = z.infer<typeof reportFrontmatterSchema>;
