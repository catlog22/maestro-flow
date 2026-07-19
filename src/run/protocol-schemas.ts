import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nullableSha256Schema = sha256Schema.nullable();
const commandHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const intentIdentitySchema = z.object({
  schema_version: z.literal('intent-identity/1.0'),
  normalization: z.literal('NFKC+unicode-lower+whitespace-collapse/1'),
  workspace_id: sha256Schema,
  command: nonEmptyString,
  verbatim: z.string(),
  normalized: z.string(),
  normalized_length: z.number().int().nonnegative(),
  normalized_hash: sha256Schema,
  revision: z.literal(1),
  source: z.enum(['persisted', 'derived_legacy']),
  backfill_status: z.enum(['native', 'derived', 'collision', 'unavailable']),
  empty: z.boolean(),
}).strict();

export const topicIdentitySchema = z.object({
  schema_version: z.literal('topic-identity/1.0'),
  normalization: z.literal('NFKC+unicode-lower+whitespace-collapse/1'),
  workspace_id: sha256Schema,
  source: z.enum(['explicit', 'workflow', 'legacy-intent']),
  verbatim: z.string(),
  normalized: nonEmptyString,
  normalized_length: z.number().int().positive(),
  normalized_hash: sha256Schema,
  identity_hash: sha256Schema,
  revision: z.literal(1),
}).strict();

export const argumentRequirementSchema = z.object({
  name: nonEmptyString,
  required: z.boolean(),
  missing: z.boolean(),
  type: z.enum(['boolean', 'enum', 'string', 'number']),
  source: z.enum(['actual-arg', 'contract-default', 'unresolved']),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  question: z.string().min(1).optional(),
}).strict();

export const reuseAssessmentSchema = z.object({
  schema_version: z.literal('reuse-assessment/1.0'),
  decision: z.enum(['REUSE', 'REVIEW', 'CONFLICT', 'REJECT']),
  reason_codes: z.array(nonEmptyString),
  consumer: z.object({
    kind: nonEmptyString,
    alias: z.string().min(1).nullable(),
    schema: z.string().min(1).nullable(),
    role: z.enum(['primary', 'attachment', 'evidence', 'checkpoint']).nullable(),
  }).strict(),
  source_fence: z.object({
    schema_version: z.literal('reuse-source-fence/1.0'),
    workspace_id: sha256Schema,
    session_id: nonEmptyString,
    producer_run_id: nonEmptyString,
    producer_run_hash: nullableSha256Schema,
    producer_status: z.enum(['created', 'running', 'blocked', 'failed', 'completed', 'sealed']),
    artifact_id: nonEmptyString,
    artifact_role: nonEmptyString,
    artifact_status: z.enum(['draft', 'sealed', 'invalid', 'superseded']),
    artifact_hash: nullableSha256Schema,
    observed_artifact_hash: nullableSha256Schema,
    artifact_schema: z.string().min(1).nullable(),
    artifact_registry_revision: z.number().int().nonnegative().nullable(),
    producer_contract_hash: z.string().min(1).nullable(),
  }).strict(),
  assessment_hash: sha256Schema,
}).strict();

export const sessionLocatorSchema = z.object({
  workspace_id: sha256Schema,
  session_id: nonEmptyString,
}).strict();

export const artifactFenceSchema = z.object({
  kind: nonEmptyString,
  relative_path: nonEmptyString,
  content_hash: sha256Schema,
}).strict();

export const sourceFenceSchema = z.object({
  workspace_id: sha256Schema,
  workspace_link_name: z.string().min(1).nullable(),
  session_id: nonEmptyString,
  session_schema_version: z.enum(['session/1.0', 'session/1.1', 'session/1.2', 'session/1.3']),
  session_identity_revision: z.number().int().nonnegative(),
  session_activity_revision: z.number().int().nonnegative(),
  session_hash: sha256Schema,
  run_id: nonEmptyString,
  run_schema_version: z.enum(['command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3']),
  run_hash: sha256Schema,
  artifact_registry_revision: z.number().int().nonnegative(),
  selected_artifacts: z.array(artifactFenceSchema),
}).strict();

export const targetFenceSchema = z.object({
  workspace_id: sha256Schema,
  session_id: nonEmptyString,
  must_not_exist: z.boolean(),
  status: z.enum(['running', 'paused', 'sealed', 'archived', 'failed']).nullable(),
  identity_revision: z.number().int().nonnegative().nullable(),
  activity_revision: z.number().int().nonnegative().nullable(),
  active_run_id: z.string().nullable(),
  artifact_registry_revision: z.number().int().nonnegative().nullable(),
}).strict();

export const sessionProvenanceSchema = z.object({
  source: z.enum(['native', 'fork', 'import', 'legacy-inferred']),
  forked_from: sourceFenceSchema.nullable(),
  imported_from: z.array(sourceFenceSchema),
  created_by: nonEmptyString,
}).strict();

export const creationDecisionSchema = z.object({
  schema_version: z.literal('creation-decision/1.0'),
  decision_id: nonEmptyString,
  request_id: z.string().min(1).nullable(),
  mode: z.enum(['explicit-create', 'chain-next', 'retry', 'resume', 'fork', 'import']),
  authority: z.enum(['explicit-command', 'chain-transition', 'confirmation-token', 'legacy-inferred']),
  decided_at: nonEmptyString,
  session_identity_revision: z.number().int().nonnegative(),
  session_activity_revision: z.number().int().nonnegative(),
  confirmation_token_hash: nullableSha256Schema,
}).strict();

export const creationProvenanceSchema = z.object({
  schema_version: z.literal('creation-provenance/1.0'),
  provenance: z.enum(['native-v2', 'verified-v1', 'legacy-inferred', 'fork', 'import']),
  source_workspace_id: sha256Schema.nullable(),
  source_session_id: z.string().min(1).nullable(),
  source_run_id: z.string().min(1).nullable(),
  imported_artifact_hashes: z.array(sha256Schema),
}).strict();

export const contractSnapshotSchema = z.object({
  schema_version: z.literal('contract-snapshot/1.0'),
  contract_version: z.enum(['command-contract/1.0', 'command-contract/2.0', 'command-contract/2.1']),
  normalized: z.record(z.string(), z.unknown()),
  snapshot_hash: sha256Schema,
  parser_version: z.literal('maestro-command-contract/2'),
  captured_at: nonEmptyString,
  warnings: z.array(z.string()),
}).strict();

export const guidanceSnapshotSchema = z.object({
  schema_version: z.literal('guidance-snapshot/1.0'),
  source_path: z.string(),
  content_hash: sha256Schema,
  resolved_prompt_hash: sha256Schema,
  prepare_hash: nullableSha256Schema,
  workflow_hash: nullableSha256Schema,
  run_mode_hash: nullableSha256Schema,
}).strict();

export const transitionFenceSchema = z.object({
  session_identity_revision: z.number().int().nonnegative(),
  session_activity_revision: z.number().int().nonnegative(),
  active_run_id: z.string().nullable(),
  run_hash: nullableSha256Schema,
  artifact_registry_revision: z.number().int().nonnegative().nullable(),
}).strict();

export const transitionRequestSchema = z.object({
  schema_version: z.literal('transition-request/1.0'),
  request_id: nonEmptyString,
  operation: z.enum([
    'create', 'next', 'complete', 'resolve', 'resume', 'fork', 'import', 'ralph-retry',
    'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'decide', 'accept-reuse',
  ]),
  subject: z.object({
    session_id: nonEmptyString,
    run_id: z.string().min(1).nullable(),
    chain_step_id: z.string().min(1).nullable(),
  }).strict(),
  normalized_request_hash: sha256Schema,
  requested_at: nonEmptyString,
  preconditions: transitionFenceSchema,
  payload: z.record(z.string(), z.unknown()),
}).strict();

export const transitionOutcomeSchema = z.object({
  schema_version: z.literal('transition-outcome/1.0'),
  transition_id: nonEmptyString,
  request_id: nonEmptyString,
  request_hash: sha256Schema,
  operation: transitionRequestSchema.shape.operation,
  status: z.enum(['applied', 'rejected']),
  applied_at: nonEmptyString,
  subject: transitionRequestSchema.shape.subject,
  postconditions: transitionFenceSchema,
  exit_code: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  error_code: z.string().min(1).nullable(),
  result_hash: sha256Schema,
  result: z.record(z.string(), z.unknown()),
}).strict();

export const persistedTransitionRecordSchema = z.object({
  request_id: nonEmptyString,
  type: z.literal('transition'),
  status: z.enum(['applied', 'rejected']),
  payload: transitionRequestSchema,
  claimed_by_run_id: z.string().nullable(),
  outcome: transitionOutcomeSchema,
}).strict();

export const transitionPointerSchema = z.object({
  transition_id: nonEmptyString,
  request_id: nonEmptyString,
  outcome_hash: sha256Schema,
}).strict();

export const commandRebindAuditSchema = z.object({
  schema_version: z.literal('command-rebind/1.1'),
  run_id: nonEmptyString,
  command: nonEmptyString,
  rebind_kind: z.enum(['legacy_contract_backfill', 'compatible_contract_rebind', 'prompt_only_rebind']),
  reason: nonEmptyString,
  old_source_path: z.string(),
  source_path: z.string(),
  old_content_hash: commandHashSchema,
  content_hash: commandHashSchema,
  old_resolved_prompt_hash: commandHashSchema,
  resolved_prompt_hash: commandHashSchema,
  old_contract_hash: commandHashSchema.nullable(),
  contract_hash: commandHashSchema,
  old_snapshot_hash: nullableSha256Schema,
  snapshot_hash: sha256Schema,
  old_contract_snapshot: contractSnapshotSchema.nullable(),
  contract_snapshot: contractSnapshotSchema,
  old_guidance_snapshot: guidanceSnapshotSchema.nullable(),
  guidance_snapshot: guidanceSnapshotSchema.nullable(),
  creation_decision_id: z.string().min(1).nullable(),
  transition: transitionPointerSchema.nullable(),
  rebound_at: nonEmptyString,
}).strict();

export const ralphAuthoritySchema = z.object({
  schema_version: z.literal('ralph-authority/1.0'),
  engine: z.literal('ralph'),
  canonical_complete: z.boolean(),
}).strict();

const runUpstreamSchema = z.object({
  artifact_id: nonEmptyString,
  path: nonEmptyString,
  kind: nonEmptyString,
  status: z.enum(['sealed', 'draft']),
}).strict();

const gateStatusSchema = z.enum(['pending', 'running', 'passed', 'failed', 'blocked', 'waived', 'skipped']);

const executionContractV10Schema = z.object({
  schema_version: z.literal('execution-contract/1.0'),
  command: nonEmptyString,
  invocation: z.object({ args: z.array(z.string()) }).strict(),
  guidance: z.object({
    prepare_path: z.string().nullable(),
    workflow_path: z.string().nullable(),
    run_mode_path: z.string().nullable(),
  }).strict(),
  inputs: z.array(z.object({
    kind: nonEmptyString,
    alias: z.string().min(1).nullable(),
    required: z.boolean(),
    require_status: z.literal('sealed').nullable(),
    schema: z.string().min(1).nullable(),
    resolved: runUpstreamSchema.nullable(),
  }).strict()),
  outputs: z.object({
    declared: z.array(z.object({
      kind: nonEmptyString,
      alias: z.string().min(1).nullable(),
      role: z.enum(['primary', 'attachment', 'evidence', 'checkpoint']),
      required: z.boolean(),
      primary: z.boolean(),
      path: z.string().nullable(),
      schema: z.string().min(1).nullable(),
    }).strict()),
    actual: z.array(z.object({
      artifact_id: nonEmptyString,
      kind: nonEmptyString,
      role: nonEmptyString,
      path: nonEmptyString,
      status: nonEmptyString,
    }).strict()),
  }).strict(),
  gates: z.object({
    registry_revision: z.number().int().nonnegative(),
    items: z.array(z.object({
      gate_id: nonEmptyString,
      title: nonEmptyString,
      scope: z.enum(['session', 'entry', 'phase', 'exit', 'transition', 'knowledge']),
      status: gateStatusSchema,
      required: z.boolean(),
      blocking: z.boolean(),
    }).strict()),
  }).strict(),
  contract: z.object({
    version: z.enum(['command-contract/1.0', 'command-contract/2.0', 'command-contract/2.1']),
    snapshot_hash: nullableSha256Schema,
    warnings: z.array(z.string()),
    drift: z.enum(['none', 'prompt-only', 'blocking-contract']),
  }).strict(),
  freshness: z.object({
    captured_at: nonEmptyString,
    run_context_identity_revision: z.number().int().nonnegative(),
    session_identity_revision: z.number().int().nonnegative(),
    session_activity_revision: z.number().int().nonnegative(),
    identity_current: z.boolean(),
    command_contract_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  }).strict(),
}).strict();

export const executionContractV11Schema = executionContractV10Schema
  .omit({ schema_version: true })
  .extend({
    schema_version: z.literal('execution-contract/1.1'),
    argument_requirements: z.array(argumentRequirementSchema),
    reuse_assessments: z.array(reuseAssessmentSchema),
  })
  .strict();

export const executionContractSchema = z.union([executionContractV11Schema, executionContractV10Schema]);

const recallExactCandidateSchema = z.object({
  candidate_id: nonEmptyString,
  session_id: nonEmptyString,
  status: z.enum(['running', 'paused']),
  active_run_id: z.string().nullable(),
  identity_revision: z.number().int().nonnegative(),
  activity_revision: z.number().int().nonnegative(),
  eligible_actions: z.array(z.literal('resume')),
  exclusions: z.array(z.string()),
  next_if_active: z.string().nullable(),
}).strict();

const recallHistoricalCandidateSchema = z.object({
  candidate_id: nonEmptyString,
  session_id: nonEmptyString,
  run_id: nonEmptyString,
  workspace_scope: z.enum(['local', 'linked']),
  source_status: z.enum(['sealed', 'archived']),
  score_bp: z.number().int().min(0).max(10_000),
  band: z.enum(['strong_suggestion', 'weak_suggestion', 'hidden_by_default']),
  advisory_embedding_bp: z.number().int().min(0).max(10_000).nullable(),
  eligible_actions: z.array(z.enum(['fork', 'import'])),
  exclusions: z.array(z.string()),
  feature_snapshot: z.record(z.string(), z.number().int().min(0).max(10_000)),
  source_fence: sourceFenceSchema,
  tied: z.boolean(),
}).strict();

const runRecallBaseSchema = z.object({
  request: z.object({
    request_id: nonEmptyString,
    request_hash: sha256Schema,
    command: nonEmptyString,
    intent: z.string(),
    workspace: sha256Schema,
    as_of: nonEmptyString,
    interactive: z.boolean(),
  }).strict(),
  intent_identity: intentIdentitySchema,
  exact_candidates: z.array(recallExactCandidateSchema),
  historical_candidates: z.array(recallHistoricalCandidateSchema),
  recommendation: z.object({
    action: z.enum(['resume', 'fork', 'import', 'new']).nullable(),
    candidate_id: z.string().nullable(),
    automatic: z.literal(false),
    reason_codes: z.array(z.string()),
  }).strict(),
  confirmation: z.object({
    required: z.boolean(),
    issuance_command: z.string(),
    allowed_actions: z.array(z.enum(['resume', 'fork', 'import', 'new'])),
  }).strict(),
  next: z.object({
    suggest_only: z.literal(true),
    command: z.string().nullable(),
    reason: z.string(),
  }).strict(),
}).strict();

export const runRecallV10Schema = runRecallBaseSchema.extend({
  schema_version: z.literal('run-recall/1.0'),
}).strict();

export const runRecallV11Schema = runRecallBaseSchema.extend({
  schema_version: z.literal('run-recall/1.1'),
  topic_identity: topicIdentitySchema,
  reuse_assessments: z.array(reuseAssessmentSchema),
}).strict();

export const runRecallSchema = z.union([runRecallV11Schema, runRecallV10Schema]);

export const recallConfirmationTargetIdentitySchema = z.object({
  workspace_id: sha256Schema,
  session_id: nonEmptyString,
  intent_identity: intentIdentitySchema,
}).strict();

export const recallConfirmationFinalTargetSchema = recallConfirmationTargetIdentitySchema.extend({
  run_id: z.string().min(1).nullable(),
}).strict();

export const validatedRecallSourceSchema = z.object({
  schema_version: z.literal('validated-recall-source/1.0'),
  scope: z.enum(['local', 'linked']),
  workspace_link_name: z.string().min(1).nullable(),
  source_project_root: nonEmptyString,
  source_workflow_root: nonEmptyString,
  workspace_id: sha256Schema,
  session_id: nonEmptyString,
  run_id: nonEmptyString,
  session_status: z.enum(['sealed', 'archived']),
  run_status: z.literal('sealed'),
  session_intent_identity: intentIdentitySchema.nullable(),
  fence: sourceFenceSchema,
}).strict();

export const recallReservationMarkerSchema = z.object({
  schema_version: z.literal('recall-reservation-marker/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  workspace_id: sha256Schema,
  session_id: nonEmptyString,
  intent_identity_hash: sha256Schema,
  created_at: nonEmptyString,
}).strict();

export const recallReservationObservationSchema = z.object({
  schema_version: z.literal('recall-reservation-observation/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  observed_at: nonEmptyString,
  marker: z.object({
    state: z.enum(['missing', 'matching', 'mismatched']),
    reservation_id: z.string().min(1).nullable(),
  }).strict(),
  target: z.object({
    state: z.enum(['absent', 'partial', 'complete', 'corrupt']),
    authority_hash: nullableSha256Schema,
    intent_identity: intentIdentitySchema.nullable(),
    run_id: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export const recallConfirmationReservationSchema = z.object({
  schema_version: z.literal('recall-confirmation-reservation/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  action: z.enum(['resume', 'fork', 'import', 'new']),
  request_hash: sha256Schema,
  source_fence: sourceFenceSchema.nullable(),
  target_fence: targetFenceSchema,
  proposed_target: recallConfirmationTargetIdentitySchema,
  phase: z.enum(['reserved', 'target-claimed', 'resume-finalize', 'rollback-partial', 'conflict'])
    .optional().default('reserved'),
  reserved_at: nonEmptyString,
  expires_at: nonEmptyString,
  reconcile_expires_at: z.string().nullable().optional().default(null),
}).strict();

export const staleRecallReservationSchema = z.object({
  schema_version: z.literal('stale-recall-reservation/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  action: z.enum(['resume', 'fork', 'import', 'new']),
  request_hash: sha256Schema,
  phase: recallConfirmationReservationSchema.shape.phase,
  proposed_target: recallConfirmationTargetIdentitySchema,
  marker: recallReservationMarkerSchema,
  marker_relative_path: z.literal('.recall-reservation.json'),
  reserved_at: nonEmptyString,
  expires_at: nonEmptyString,
}).strict();

export const recallReservationReconciliationSchema = z.object({
  schema_version: z.literal('recall-reservation-reconciliation/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  decision: z.enum(['resume_finalize', 'rollback_partial', 'conflict']),
  reason: nonEmptyString,
  stale: staleRecallReservationSchema,
  observed: recallReservationObservationSchema,
  reconcile_expires_at: z.string().nullable(),
}).strict();

export const recallConfirmationOutcomeSchema = z.object({
  schema_version: z.literal('recall-confirmation-outcome/1.0'),
  reservation_id: z.string().regex(/^rsv_[A-Za-z0-9_-]{16,}$/),
  action: z.enum(['resume', 'fork', 'import', 'new']),
  request_hash: sha256Schema,
  target: recallConfirmationFinalTargetSchema,
  target_hash: sha256Schema,
  outcome_hash: sha256Schema,
  outcome: z.record(z.string(), z.unknown()),
  finalized_at: nonEmptyString,
}).strict();

export const recallConfirmationRecordSchema = z.object({
  schema_version: z.literal('recall-confirmation/1.0'),
  token_hash: sha256Schema,
  action: z.enum(['resume', 'fork', 'import', 'new']),
  candidate_id: z.string().min(1).nullable(),
  request_hash: sha256Schema,
  issued_at: nonEmptyString,
  expires_at: nonEmptyString,
  consumed_at: z.string().nullable(),
  source_fence: sourceFenceSchema.nullable(),
  target_fence: targetFenceSchema,
  target_session_id: nonEmptyString,
  result_session_id: z.string().min(1).nullable(),
  result_run_id: z.string().min(1).nullable(),
  reservation: recallConfirmationReservationSchema.nullable().optional().default(null),
  outcome: recallConfirmationOutcomeSchema.nullable().optional().default(null),
}).strict();

export const recallConfirmationRegistrySchema = z.object({
  schema_version: z.literal('recall-confirmations/1.0'),
  revision: z.number().int().nonnegative(),
  records: z.record(z.string(), recallConfirmationRecordSchema),
}).strict();

export const runErrorCodeSchema = z.enum([
  'COMMANDER_USAGE', 'SESSION_NOT_FOUND', 'SESSION_AMBIGUOUS', 'SESSION_NOT_RUNNING',
  'RESUME_REQUIRED', 'LEASE_CONFLICT', 'RUNNING_STEP', 'DECISION_REQUIRED', 'CHAIN_COMPLETE',
  'PICK_NOT_FOUND', 'PICK_NOT_PENDING', 'PICK_DECISION_NODE', 'COMMAND_CONTENT_MISSING',
  'ARGUMENT_REQUIRED',
  'RUN_NOT_FOUND', 'RUN_GATES_BLOCKING', 'RUN_IMMUTABLE', 'INVALID_VERDICT',
  'PLATFORM_INVALID', 'PLATFORM_CONFLICT', 'CONTRACT_DRIFT', 'REQUEST_CONFLICT',
  'REPLAY_STATE_DIVERGED', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REPLAYED', 'TOKEN_RESERVED',
  'FENCE_CONFLICT', 'RESERVATION_INVALID', 'INVALID_TRANSITION_RECEIPT',
  'SESSION_SEAL_BLOCKED', 'INVALID_ARGUMENT', 'INTERNAL_ERROR',
]);

export const runOperationSchema = z.enum([
  'create', 'next', 'complete', 'brief', 'recall', 'resolve', 'resume', 'fork', 'import',
  'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update',
]);
const responseCommonSchema = z.object({
  schema_version: z.literal('run-response/1.0'),
  operation: runOperationSchema,
  request_id: z.string().min(1).nullable(),
  locator: z.object({ session_id: z.string().nullable(), run_id: z.string().nullable() }).strict().nullable(),
  next: z.object({ suggest_only: z.literal(true), command: z.string().nullable(), reason: z.string() }).strict().nullable(),
  replay: z.object({ status: z.enum(['applied', 'replayed']), transition_id: nonEmptyString }).strict().nullable(),
});

export const runResponseSuccessSchema = responseCommonSchema.extend({
  ok: z.literal(true),
  exit_code: z.literal(0),
  result: z.unknown(),
  error: z.null(),
}).strict();

export const runResponseErrorSchema = responseCommonSchema.extend({
  ok: z.literal(false),
  exit_code: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  result: z.null(),
  error: z.object({
    code: runErrorCodeSchema,
    message: nonEmptyString,
    details: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

export const runResponseSchema = z.discriminatedUnion('ok', [runResponseSuccessSchema, runResponseErrorSchema]);

export const sessionTransitionSchema = z.object({
  schema_version: z.literal('session-transition/1.0'),
  operation: z.enum(['resolve', 'resume']),
  session_id: nonEmptyString,
  transition_id: nonEmptyString,
  request_id: nonEmptyString,
  before: transitionFenceSchema,
  after: transitionFenceSchema,
  replayed: z.boolean(),
  next: z.object({ suggest_only: z.literal(true), command: z.string().nullable(), reason: z.string() }).strict(),
}).strict();

export const importManifestSchema = z.object({
  schema_version: z.literal('import-manifest/1.0'),
  source: z.object({
    workspace_id: sha256Schema,
    session_id: nonEmptyString,
    run_id: nonEmptyString,
  }).strict(),
  target: z.object({
    workspace_id: sha256Schema,
    session_id: nonEmptyString,
    run_id: nonEmptyString,
  }).strict(),
  artifacts: z.array(z.object({
    source_kind: nonEmptyString,
    source_path: nonEmptyString,
    source_hash: sha256Schema,
    target_artifact_id: nonEmptyString,
    target_path: nonEmptyString,
  }).strict()),
  created_at: nonEmptyString,
}).strict();

export type IntentIdentity = z.infer<typeof intentIdentitySchema>;
export type TopicIdentityProtocol = z.infer<typeof topicIdentitySchema>;
export type ArgumentRequirement = z.infer<typeof argumentRequirementSchema>;
export type ReuseAssessmentProtocol = z.infer<typeof reuseAssessmentSchema>;
export type SessionProvenance = z.infer<typeof sessionProvenanceSchema>;
export type CreationDecision = z.infer<typeof creationDecisionSchema>;
export type CreationProvenance = z.infer<typeof creationProvenanceSchema>;
export type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;
export type GuidanceSnapshot = z.infer<typeof guidanceSnapshotSchema>;
export type CommandRebindAudit = z.infer<typeof commandRebindAuditSchema>;
export type TransitionFence = z.infer<typeof transitionFenceSchema>;
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;
export type TransitionOutcome = z.infer<typeof transitionOutcomeSchema>;
export type PersistedTransitionRecord = z.infer<typeof persistedTransitionRecordSchema>;
export type TransitionPointer = z.infer<typeof transitionPointerSchema>;
export type ExecutionContract = z.infer<typeof executionContractV11Schema>;
export type RunRecall = z.infer<typeof runRecallV11Schema>;
export type RecallConfirmationTargetIdentity = z.infer<typeof recallConfirmationTargetIdentitySchema>;
export type RecallConfirmationFinalTarget = z.infer<typeof recallConfirmationFinalTargetSchema>;
export type ValidatedRecallSource = z.infer<typeof validatedRecallSourceSchema>;
export type RecallReservationMarker = z.infer<typeof recallReservationMarkerSchema>;
export type RecallReservationObservation = z.infer<typeof recallReservationObservationSchema>;
export type RecallConfirmationReservation = z.infer<typeof recallConfirmationReservationSchema>;
export type StaleRecallReservation = z.infer<typeof staleRecallReservationSchema>;
export type RecallReservationReconciliation = z.infer<typeof recallReservationReconciliationSchema>;
export type RecallConfirmationOutcome = z.infer<typeof recallConfirmationOutcomeSchema>;
export type RecallConfirmationRecord = z.infer<typeof recallConfirmationRecordSchema>;
export type RecallConfirmationRegistry = z.infer<typeof recallConfirmationRegistrySchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type RunResponseErrorCode = z.infer<typeof runErrorCodeSchema>;
export type SessionTransition = z.infer<typeof sessionTransitionSchema>;
export type ImportManifest = z.infer<typeof importManifestSchema>;
