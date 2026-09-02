import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nullableSha256Schema = sha256Schema.nullable();
const commandHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const executionSealReceiptFenceSchema = z.object({
  execution_id: nonEmptyString,
  generation: z.number().int().positive(),
  sealed_at: nonEmptyString,
  relative_path: nonEmptyString,
  overall_hash: sha256Schema,
}).strict();

export const chainEffectSchema = z.enum(['insert', 'replace', 'skip', 'decide']);

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
  /** Present when an enum-typed argument received a value outside its choices. */
  invalid: z.string().optional(),
  choices: z.array(z.string()).optional(),
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

export const reuseAssessmentV11Schema = reuseAssessmentSchema
  .omit({ source_fence: true })
  .extend({
    schema_version: z.literal('reuse-assessment/1.1'),
    source_fence: reuseAssessmentSchema.shape.source_fence
      .omit({ schema_version: true })
      .extend({
        schema_version: z.literal('reuse-source-fence/1.1'),
        execution_seal_receipt: executionSealReceiptFenceSchema,
      })
      .strict(),
  })
  .strict();

/** Additive compatibility reader; reuseAssessmentSchema remains the strict 1.0 shape. */
export const reuseAssessmentReadSchema = z.union([reuseAssessmentV11Schema, reuseAssessmentSchema]);

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

export const sourceFenceV11Schema = sourceFenceSchema
  .omit({ session_schema_version: true, run_schema_version: true })
  .extend({
    schema_version: z.literal('source-fence/1.1'),
    session_schema_version: z.enum([
      'session/1.0', 'session/1.1', 'session/1.2', 'session/1.3', 'session/2.0',
    ]),
    run_schema_version: z.enum([
      'command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3', 'command-run/1.4',
    ]),
    execution_seal_receipt: executionSealReceiptFenceSchema,
  })
  .strict();

/** Additive compatibility reader; sourceFenceSchema remains the strict legacy shape. */
export const sourceFenceReadSchema = z.union([sourceFenceV11Schema, sourceFenceSchema]);

export const sessionArchiveReceiptSchema = z.object({
  schema_version: z.literal('session-archive-receipt/1.0'),
  receipt_id: nonEmptyString,
  operation: z.enum(['archive', 'unarchive']),
  session_id: nonEmptyString,
  actor: nonEmptyString,
  reason: nonEmptyString,
  evidence_refs: z.array(nonEmptyString),
  recorded_at: nonEmptyString,
  before: z.object({
    identity_revision: z.number().int().nonnegative(),
    activity_revision: z.number().int().nonnegative(),
    archived_at: z.string().min(1).nullable(),
    archived_by: z.string().min(1).nullable(),
  }).strict(),
  after: z.object({
    identity_revision: z.number().int().nonnegative(),
    activity_revision: z.number().int().nonnegative(),
    archived_at: z.string().min(1).nullable(),
    archived_by: z.string().min(1).nullable(),
  }).strict(),
  previous_receipt_hash: nullableSha256Schema,
  receipt_hash: sha256Schema,
}).strict();

const sealedRunSnapshotSchema = z.object({
  run_id: nonEmptyString,
  schema_version: z.enum([
    'command-run/1.0', 'command-run/1.1', 'command-run/1.2', 'command-run/1.3', 'command-run/1.4',
  ]),
  content_hash: sha256Schema,
}).strict();

const executionSealReceiptBaseSchema = z.object({
  session_id: nonEmptyString,
  execution_id: nonEmptyString,
  generation: z.number().int().positive(),
  sealed_at: nonEmptyString,
  execution_revision: z.number().int().nonnegative(),
  session_identity_revision: z.number().int().nonnegative(),
  session_activity_revision: z.number().int().nonnegative(),
  runs: z.array(sealedRunSnapshotSchema),
  chain_snapshot: z.array(z.unknown()),
  chain_hash: sha256Schema,
  corpus_refs: z.array(z.object({
    kind: nonEmptyString,
    id: nonEmptyString,
    content_hash: sha256Schema,
  }).strict()),
  overall_hash: sha256Schema,
});

export const executionSealReceiptSchema = executionSealReceiptBaseSchema.extend({
  schema_version: z.literal('execution-seal-receipt/1.0'),
  gates: z.object({
    clean: z.boolean(),
    blocking_gate_ids: z.array(nonEmptyString),
    registry_revision: z.number().int().nonnegative(),
    registry_hash: sha256Schema,
  }).strict(),
  artifacts: z.object({
    registry_revision: z.number().int().nonnegative(),
    registry_hash: sha256Schema,
    content_hashes: z.record(z.string(), sha256Schema),
  }).strict(),
  evidence: z.object({
    store_revision: z.number().int().nonnegative(),
    store_hash: sha256Schema,
    record_refs: z.array(nonEmptyString),
  }).strict(),
}).strict();

const sealedArtifactSnapshotSchema = z.object({
  artifact_id: nonEmptyString,
  kind: nonEmptyString,
  role: z.enum(['primary', 'evidence', 'report', 'attachment', 'checkpoint']),
  producer_run_id: nonEmptyString,
  relative_path: nonEmptyString,
  media_type: nonEmptyString,
  schema_version: nonEmptyString,
  content_hash: sha256Schema,
  size: z.number().int().nonnegative(),
  status: z.literal('sealed'),
  derived_from: z.array(z.string()),
  replaces: z.string().nullable(),
}).strict();

const gateSnapshotSchema = z.object({
  gate_id: nonEmptyString,
  record: z.record(z.string(), z.unknown()),
}).strict();

const evidenceSnapshotSchema = z.object({
  record_id: nonEmptyString,
  record: z.record(z.string(), z.unknown()),
}).strict();

export const executionSealReceiptV11Schema = executionSealReceiptBaseSchema.extend({
  schema_version: z.literal('execution-seal-receipt/1.1'),
  execution_hash: sha256Schema,
  gates: z.object({
    clean: z.boolean(),
    blocking_gate_ids: z.array(nonEmptyString),
    registry_revision: z.number().int().nonnegative(),
    registry_hash: sha256Schema,
    snapshots: z.array(gateSnapshotSchema),
    snapshot_hash: sha256Schema,
  }).strict(),
  artifacts: z.object({
    registry_revision: z.number().int().nonnegative(),
    registry_hash: sha256Schema,
    content_hashes: z.record(z.string(), sha256Schema),
    snapshots: z.array(sealedArtifactSnapshotSchema),
    snapshot_hash: sha256Schema,
  }).strict(),
  evidence: z.object({
    store_revision: z.number().int().nonnegative(),
    store_hash: sha256Schema,
    record_refs: z.array(nonEmptyString),
    snapshots: z.array(evidenceSnapshotSchema),
    snapshot_hash: sha256Schema,
  }).strict(),
}).strict();

/** Additive compatibility reader; executionSealReceiptSchema remains the strict 1.0 shape. */
export const executionSealReceiptReadSchema = z.union([
  executionSealReceiptV11Schema,
  executionSealReceiptSchema,
]);

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

export const executionLocatorSchema = z.object({
  session_id: nonEmptyString,
  execution_id: nonEmptyString,
  generation: z.number().int().positive(),
  run_id: z.string().min(1).nullable(),
}).strict();

export const transitionFenceV11Schema = z.object({
  session_identity_revision: z.number().int().nonnegative(),
  session_activity_revision: z.number().int().nonnegative(),
  execution_id: z.string().min(1).nullable(),
  execution_generation: z.number().int().positive().nullable(),
  execution_revision: z.number().int().nonnegative().nullable(),
  execution_status: z.enum(['active', 'paused', 'sealed']).nullable(),
  lease_epoch: z.number().int().nonnegative().nullable(),
  active_run_id: z.string().min(1).nullable(),
  run_hash: nullableSha256Schema,
  artifact_registry_revision: z.number().int().nonnegative().nullable(),
}).strict();

export const completeInputSnapshotSchema = z.object({
  schema_version: z.literal('complete-input-snapshot/1.0'),
  files: z.array(z.object({
    path: nonEmptyString,
    content_hash: nullableSha256Schema,
  }).strict()),
  snapshot_hash: sha256Schema,
}).strict();

export const transitionRequestSchema = z.object({
  schema_version: z.literal('transition-request/1.0'),
  request_id: nonEmptyString,
  operation: z.enum([
    'create', 'next', 'complete', 'resolve', 'resume', 'fork', 'import', 'ralph-retry',
    'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'decide', 'accept-reuse',
    'artifact-republish',
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

export const transitionOperationV11Schema = z.enum([
  'create', 'next', 'complete', 'resolve', 'resume', 'fork', 'import', 'ralph-retry',
  'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'decide', 'accept-reuse',
  'artifact-republish',
  'session-create', 'session-archive', 'session-unarchive',
  'execution-start', 'execution-chain-bootstrap', 'execution-attach', 'execution-pause', 'execution-resolve',
  'execution-resume', 'execution-seal', 'execution-handoff-prepare',
  'execution-handoff-accept', 'execution-handoff-cancel', 'execution-lease-heartbeat',
  'execution-lease-release', 'execution-lease-recover',
]);

const transitionSubjectV11Schema = z.object({
  session_id: nonEmptyString,
  execution_id: z.string().min(1).nullable(),
  generation: z.number().int().positive().nullable(),
  run_id: z.string().min(1).nullable(),
  chain_step_id: z.string().min(1).nullable(),
}).strict();

export const transitionRequestV11Schema = z.object({
  schema_version: z.literal('transition-request/1.1'),
  request_id: nonEmptyString,
  operation: transitionOperationV11Schema,
  subject: transitionSubjectV11Schema,
  normalized_request_hash: sha256Schema,
  requested_at: nonEmptyString,
  preconditions: transitionFenceV11Schema,
  payload: z.record(z.string(), z.unknown()),
}).strict().superRefine((request, ctx) => {
  for (const path of rawLeaseIdPaths(request.payload, ['payload'])) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: 'transition requests must persist lease_id_hash, not raw lease_id',
    });
  }
});

export const transitionOutcomeV11Schema = z.object({
  schema_version: z.literal('transition-outcome/1.1'),
  transition_id: nonEmptyString,
  request_id: nonEmptyString,
  request_hash: sha256Schema,
  operation: transitionOperationV11Schema,
  status: z.enum(['applied', 'rejected']),
  applied_at: nonEmptyString,
  subject: transitionSubjectV11Schema,
  postconditions: transitionFenceV11Schema,
  exit_code: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  error_code: z.string().min(1).nullable(),
  result_hash: sha256Schema,
  result: z.record(z.string(), z.unknown()),
}).strict();

export const persistedTransitionRecordV11Schema = z.object({
  request_id: nonEmptyString,
  type: z.literal('transition'),
  status: z.enum(['applied', 'rejected']),
  payload: transitionRequestV11Schema,
  claimed_by_run_id: z.string().nullable(),
  outcome: transitionOutcomeV11Schema,
}).strict();

export const transitionRequestReadSchema = z.union([transitionRequestV11Schema, transitionRequestSchema]);
export const transitionOutcomeReadSchema = z.union([transitionOutcomeV11Schema, transitionOutcomeSchema]);
export const persistedTransitionRecordReadSchema = z.union([
  persistedTransitionRecordV11Schema,
  persistedTransitionRecordSchema,
]);

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
    orchestration: z.object({
      chain_effects: z.array(chainEffectSchema),
    }).strict().optional(),
  })
  .strict();

export const executionContractV12Schema = executionContractV11Schema
  .omit({ schema_version: true, reuse_assessments: true })
  .extend({
    schema_version: z.literal('execution-contract/1.2'),
    reuse_assessments: z.array(reuseAssessmentReadSchema),
  })
  .strict();

export const executionContractSchema = z.union([
  executionContractV12Schema,
  executionContractV11Schema,
  executionContractV10Schema,
]);

const briefTargetPlatformSchema = z.enum(['claude', 'codex', 'agy', 'agents-standard', 'pi', 'grok']);
const briefRunStatusSchema = z.enum(['created', 'running', 'blocked', 'failed', 'completed', 'sealed']);
const briefSessionStatusSchema = z.enum(['running', 'paused', 'sealed', 'archived', 'failed']);
const briefDecisionPointSchema = z.object({
  point_id: nonEmptyString,
  after_step_id: z.string().nullable(),
  status: z.enum(['pending', 'escalated']),
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().nonnegative(),
  evidence_ref: z.string().nullable(),
}).strict();
const briefNextSchema = z.object({
  suggest_only: z.literal(true),
  command: z.string().nullable(),
  reason: nonEmptyString,
}).strict();

export const continuationActionSchema = z.enum([
  'load_run',
  'execute_run',
  'accept_reuse',
  'repair_run',
  'dispatch_next',
  'evaluate_decision',
  'recover_session',
  'seal_session',
  'offer_recommendations',
  'repair_chain',
  'stop',
]);

export const continuationAuthoritySchema = z.enum([
  'automatic',
  'auto_mode_only',
  'user_required',
]);

export const continuationDirectiveSchema = z.object({
  schema_version: z.literal('run-continuation/1.0'),
  action: continuationActionSchema,
  authority: continuationAuthoritySchema,
  reason_code: nonEmptyString,
  command: z.string().nullable(),
  reason: nonEmptyString,
  preconditions: z.array(z.string()),
  auto_mode: z.boolean(),
  session_id: nonEmptyString,
  run_id: z.string().min(1).nullable(),
  assessment: z.object({
    assessment_hash: sha256Schema,
    artifact_id: nonEmptyString,
    decision: z.enum(['REUSE', 'REVIEW', 'CONFLICT', 'REJECT']),
    reason_codes: z.array(nonEmptyString),
    acceptance_status: z.enum(['not_required', 'pending_review', 'accepted', 'invalidated']),
  }).strict().nullable(),
  recommendations: z.array(z.object({
    command: nonEmptyString,
    reason: z.string(),
    needs: z.array(z.string()),
  }).strict()),
}).strict();
const briefPrevHandoffSchema = z.object({
  run_id: nonEmptyString,
  command: nonEmptyString,
  verdict: z.enum(['ready', 'ready_with_concerns', 'blocked', 'failed']),
  summary: z.string(),
  decisions: z.array(z.string()),
  concerns: z.array(z.string()),
}).strict();
const briefAnchorSchema = z.object({
  intent: z.string().nullable(),
  boundary_contract: z.string().nullable(),
  progress: z.string().nullable(),
  signals: z.string().nullable(),
}).strict();
const briefGuidancePartSchema = z.object({ path: z.string(), content: z.string() }).strict();
/** run-mode.md is loaded via Skill @required_reading, not brief injection. Brief carries only a path + hash for freshness. */
const briefRunModeRefSchema = z.object({ path: z.string(), hash: z.string().nullable() }).strict();
const briefGuidanceDriftKeySchema = z.enum(['command', 'resolved_prompt', 'prepare', 'workflow', 'run_mode']);
const knowledgeSignalTotalsSchema = z.object({
  consumed: z.number().int().nonnegative(),
  cited: z.number().int().nonnegative(),
  validated: z.number().int().nonnegative(),
  contradicted: z.number().int().nonnegative(),
}).strict();
export const knowledgeReconciliationCardSchema = z.object({
  schema_version: z.literal('knowledge-reconciliation-card/1.0'),
  run: z.object({
    unique_inputs: z.number().int().nonnegative(),
    signals: knowledgeSignalTotalsSchema,
    knowledge_ids: z.array(nonEmptyString),
  }).strict(),
  session: z.object({
    unique_inputs: z.number().int().nonnegative(),
    pending_candidates: z.number().int().nonnegative(),
    corroborated_candidates: z.number().int().nonnegative(),
    promoting_candidates: z.number().int().nonnegative(),
    promoted_candidates: z.number().int().nonnegative(),
  }).strict(),
  policy: z.object({
    search_and_injection: z.literal('exposure_only'),
    explicit_load: z.literal('consumed'),
    record: z.literal('explicit_attribution'),
    completion: z.literal('stage_candidates'),
    promotion: z.literal('explicit_review'),
  }).strict(),
  review: z.object({
    command: nonEmptyString,
    promote_template: nonEmptyString,
  }).strict(),
  reconciliation: z.object({
    status: z.enum(['missing', 'fresh', 'stale']),
    duplicates: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    review_required: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
    command: nonEmptyString,
  }).strict().optional(),
}).strict();

/**
 * Canonical Resume Packet. Compatibility aliases intentionally do not live in
 * this schema: invocation, reuse, gates, and outputs each have exactly one home
 * under execution_contract. The top-level upstream map is the deliberate Pi
 * bridge compatibility projection of inputs[].resolved.
 */
export const briefResultV10Schema = z.object({
  schema_version: z.literal('brief-result/1.0'),
  // Human-mode locator and Pi bridge compatibility. Machine mode also carries
  // session_id/run_id in the run-response locator envelope.
  session_id: nonEmptyString,
  run_id: nonEmptyString,
  run_dir: nonEmptyString,
  // Deliberate self-sufficiency overlap with execution_contract.inputs[].resolved.
  upstream: z.record(z.string(), runUpstreamSchema),
  session: z.object({
    session_id: nonEmptyString,
    intent: nonEmptyString,
    status: briefSessionStatusSchema,
    identity_revision: z.number().int().nonnegative(),
    activity_revision: z.number().int().nonnegative(),
    active_run_id: z.string().nullable(),
    open_decisions: z.array(briefDecisionPointSchema),
  }).strict(),
  run: z.object({
    run_id: nonEmptyString,
    run_dir: nonEmptyString,
    chain_step_id: z.string().nullable(),
    resolved_platform: briefTargetPlatformSchema,
    status: briefRunStatusSchema,
  }).strict(),
  guidance: z.object({
    prepare: briefGuidancePartSchema.nullable(),
    workflow: briefGuidancePartSchema.nullable(),
    run_mode: briefRunModeRefSchema.nullable(),
    refs: z.array(z.object({ path: z.string(), when: z.string() }).strict()),
    goal_mode: z.object({ platform: z.string(), instructions: z.string() }).strict().nullable(),
    freshness: z.object({
      status: z.enum(['none', 'changed', 'unavailable']),
      changed: z.array(briefGuidanceDriftKeySchema),
      captured: guidanceSnapshotSchema.nullable(),
      current: guidanceSnapshotSchema,
    }).strict(),
  }).strict(),
  execution_contract: executionContractV11Schema,
  continuity: z.object({
    prev_handoff: briefPrevHandoffSchema.nullable(),
    anchor: briefAnchorSchema,
  }).strict(),
  recovery: z.object({ next: briefNextSchema }).strict(),
}).strict();

export const briefResultV11Schema = briefResultV10Schema.extend({
  schema_version: z.literal('brief-result/1.1'),
  knowledge_context: knowledgeReconciliationCardSchema,
}).strict();

export const briefResultV12Schema = briefResultV11Schema
  .omit({ schema_version: true, execution_contract: true })
  .extend({
    schema_version: z.literal('brief-result/1.2'),
    execution_contract: executionContractV12Schema,
  })
  .strict();

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

export const runRecallV12Schema = runRecallBaseSchema.extend({
  schema_version: z.literal('run-recall/1.2'),
  topic_identity: topicIdentitySchema,
  reuse_assessments: z.array(reuseAssessmentReadSchema),
}).strict();

export const runRecallSchema = z.union([runRecallV12Schema, runRecallV11Schema, runRecallV10Schema]);

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

export const validatedRecallSourceV11Schema = validatedRecallSourceSchema
  .omit({ session_status: true, fence: true })
  .extend({
    schema_version: z.literal('validated-recall-source/1.1'),
    session_status: z.enum(['sealed', 'archived']).nullable(),
    fence: sourceFenceV11Schema,
  })
  .strict();

/** Strict validatedRecallSourceSchema remains the historical 1.0 reader. */
export const validatedRecallSourceReadSchema = z.union([
  validatedRecallSourceV11Schema,
  validatedRecallSourceSchema,
]);

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

export const recallConfirmationReservationV11Schema = recallConfirmationReservationSchema
  .omit({ source_fence: true })
  .extend({
    schema_version: z.literal('recall-confirmation-reservation/1.1'),
    source_fence: sourceFenceV11Schema.nullable(),
  })
  .strict();

export const recallConfirmationReservationReadSchema = z.union([
  recallConfirmationReservationV11Schema,
  recallConfirmationReservationSchema,
]);

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

export const recallConfirmationRecordV11Schema = recallConfirmationRecordSchema
  .omit({ source_fence: true, reservation: true })
  .extend({
    schema_version: z.literal('recall-confirmation/1.1'),
    source_fence: sourceFenceV11Schema.nullable(),
    reservation: recallConfirmationReservationV11Schema.nullable().optional().default(null),
  })
  .strict();

export const recallConfirmationRecordReadSchema = z.union([
  recallConfirmationRecordV11Schema,
  recallConfirmationRecordSchema,
]);

export const recallConfirmationRegistrySchema = z.object({
  schema_version: z.literal('recall-confirmations/1.0'),
  revision: z.number().int().nonnegative(),
  records: z.record(z.string(), recallConfirmationRecordSchema),
}).strict();

export const recallConfirmationRegistryV11Schema = z.object({
  schema_version: z.literal('recall-confirmations/1.1'),
  revision: z.number().int().nonnegative(),
  records: z.record(z.string(), recallConfirmationRecordReadSchema),
}).strict();

export const recallConfirmationRegistryReadSchema = z.union([
  recallConfirmationRegistryV11Schema,
  recallConfirmationRegistrySchema,
]);

export const requestReceiptV20Schema = z.object({
  schema_version: z.literal('request-receipt/2.0'),
  request_id: nonEmptyString,
  participant_id: nonEmptyString,
  payload_hash: sha256Schema,
  transition_receipt_ref: nonEmptyString,
}).strict();

export const artifactCompatibilityClassificationSchema = z.enum([
  'compatible', 'representation_repairable', 'semantic_republish_required', 'invalid',
]);

const artifactCompatibilitySlotSchema = z.object({
  kind: nonEmptyString,
  schema: nonEmptyString,
  role: z.enum(['primary', 'attachment', 'evidence', 'report', 'checkpoint']),
  alias: nonEmptyString,
}).strict();

export const artifactCompatibilityAssessmentSchema = z.object({
  schema_version: z.literal('artifact-compatibility/1.0'),
  classification: artifactCompatibilityClassificationSchema,
  reason_codes: z.array(nonEmptyString),
  source: z.object({
    session_id: nonEmptyString,
    session_schema_version: z.enum([
      'session/1.0', 'session/1.1', 'session/1.2', 'session/1.3', 'session/2.0', 'session/3.0',
    ]),
    session_revision: z.number().int().nonnegative(),
    artifact_id: nonEmptyString,
    artifact_registry_revision: z.number().int().nonnegative(),
    artifact_path: nonEmptyString,
    artifact_hash: sha256Schema,
    artifact_size: z.number().int().nonnegative(),
    producer_run_id: nonEmptyString,
    producer_run_hash: sha256Schema,
    producer_contract_hash: sha256Schema,
    producer_contract_source: z.enum(['captured_snapshot', 'sealed_raw_registry', 'unavailable']),
    raw_slot: artifactCompatibilitySlotSchema,
    registry_slot: artifactCompatibilitySlotSchema,
    producer_slot: artifactCompatibilitySlotSchema,
  }).strict(),
  consumer: z.object({
    command: nonEmptyString,
    command_contract_hash: sha256Schema,
    slot_index: z.number().int().nonnegative(),
    slot: artifactCompatibilitySlotSchema,
  }).strict(),
  assessment_hash: sha256Schema,
}).strict();

export const artifactRepublishReceiptSchema = z.object({
  schema_version: z.literal('artifact-republish/1.0'),
  receipt_id: nonEmptyString,
  request_id: nonEmptyString,
  session_id: nonEmptyString,
  assessment_hash: sha256Schema,
  source_artifact_id: nonEmptyString,
  source_artifact_hash: sha256Schema,
  artifact_id: nonEmptyString,
  artifact_hash: sha256Schema,
  artifact_path: nonEmptyString,
  derived_from: z.array(nonEmptyString).length(1),
  consumer: z.object({
    command: nonEmptyString,
    command_contract_hash: sha256Schema,
    slot_index: z.number().int().nonnegative(),
    slot: artifactCompatibilitySlotSchema,
  }).strict(),
  transformed_metadata: z.object({
    role: z.object({ from: artifactCompatibilitySlotSchema.shape.role, to: artifactCompatibilitySlotSchema.shape.role }).strict(),
    alias: z.object({ from: nonEmptyString, to: nonEmptyString }).strict(),
  }).strict(),
  compatibility_run_id: nonEmptyString,
  compatibility_step_id: nonEmptyString,
  artifact_registry_revision_before: z.number().int().nonnegative(),
  artifact_registry_revision_after: z.number().int().positive(),
  session_revision_before: z.number().int().nonnegative(),
  session_revision_after: z.number().int().positive(),
  actor_id: nonEmptyString,
  participant_id: nonEmptyString,
  reason: nonEmptyString,
  evidence_refs: z.array(nonEmptyString).min(1),
  recorded_at: nonEmptyString,
  receipt_hash: sha256Schema,
}).strict().superRefine((receipt, ctx) => {
  if (receipt.artifact_registry_revision_after !== receipt.artifact_registry_revision_before + 1) {
    ctx.addIssue({ code: 'custom', path: ['artifact_registry_revision_after'], message: 'registry revision must advance exactly once' });
  }
  if (receipt.session_revision_after !== receipt.session_revision_before + 1) {
    ctx.addIssue({ code: 'custom', path: ['session_revision_after'], message: 'session revision must advance exactly once' });
  }
  if (receipt.derived_from[0] !== receipt.source_artifact_id) {
    ctx.addIssue({ code: 'custom', path: ['derived_from'], message: 'derived_from must contain only source_artifact_id' });
  }
});

export const transitionTargetTypeV20Schema = z.enum([
  'session-identity', 'orchestration', 'run', 'artifact', 'evidence',
]);

export const transitionReceiptV20Schema = z.object({
  schema_version: z.literal('transition-receipt/2.0'),
  transition_id: nonEmptyString,
  request_id: nonEmptyString,
  session_id: nonEmptyString,
  activity_revision: z.number().int().positive(),
  target_type: transitionTargetTypeV20Schema,
  target_id: nonEmptyString,
  revision_before: z.number().int().nonnegative(),
  revision_after: z.number().int().positive(),
  actor_id: nonEmptyString,
  participant_id: nonEmptyString,
  reason: nonEmptyString,
  evidence_refs: z.array(nonEmptyString),
  recorded_at: nonEmptyString,
  result: z.unknown(),
}).strict().superRefine((receipt, ctx) => {
  if (receipt.revision_after !== receipt.revision_before + 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['revision_after'],
      message: 'revision_after must advance revision_before exactly once',
    });
  }
});

const resumeMapRunStatusSchema = z.enum([
  'pending', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'sealed',
]);

/** Strict, bounded resume projection. Execution/lease/operation fields are intentionally absent. */
export const resumeMapV1Schema = z.object({
  sessionId: nonEmptyString,
  sessionStatus: z.enum(['open', 'completed', 'archived', 'failed']),
  orchestrationRevision: z.number().int().nonnegative(),
  activityRevision: z.number().int().nonnegative(),
  activeRuns: z.array(z.object({
    runId: nonEmptyString,
    stepId: nonEmptyString,
    status: resumeMapRunStatusSchema,
    revision: z.number().int().nonnegative(),
  }).strict()),
  blockingGates: z.array(nonEmptyString),
  openDecisions: z.array(nonEmptyString),
  pendingPublications: z.array(z.object({
    publicationId: nonEmptyString,
    resourceUri: z.string().min(1).optional(),
  }).strict()),
  nextActions: z.array(z.object({
    action: nonEmptyString,
    targetId: nonEmptyString,
    expectedRevision: z.number().int().nonnegative(),
  }).strict()),
  fingerprint: sha256Schema,
}).strict();

export const runErrorCodeSchema = z.enum([
  'COMMANDER_USAGE', 'SESSION_NOT_FOUND', 'SESSION_AMBIGUOUS', 'SESSION_NOT_RUNNING',
  'RESUME_REQUIRED', 'LEASE_CONFLICT', 'RUNNING_STEP', 'DECISION_REQUIRED', 'CHAIN_COMPLETE',
  'PICK_NOT_FOUND', 'PICK_NOT_PENDING', 'PICK_DECISION_NODE', 'COMMAND_CONTENT_MISSING',
  'ARGUMENT_REQUIRED',
  'RUN_NOT_FOUND', 'RUN_GATES_BLOCKING', 'RUN_IMMUTABLE', 'INVALID_VERDICT',
  'PLATFORM_INVALID', 'PLATFORM_CONFLICT', 'CONTRACT_DRIFT', 'CHAIN_PROPOSAL_INVALID', 'REQUEST_CONFLICT',
  'REPLAY_STATE_DIVERGED', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REPLAYED', 'TOKEN_RESERVED',
  'FENCE_CONFLICT', 'RESERVATION_INVALID', 'INVALID_TRANSITION_RECEIPT',
  'SESSION_SEAL_BLOCKED', 'SESSION_SCHEMA_UNSUPPORTED', 'INVALID_ARGUMENT', 'INTERNAL_ERROR',
]);

export const runErrorCodeV11Schema = z.enum([
  ...runErrorCodeSchema.options,
  'SESSION_ARCHIVED', 'SESSION_ARCHIVE_BLOCKED',
  'EXECUTION_NOT_FOUND', 'EXECUTION_ALREADY_ACTIVE', 'EXECUTION_PAUSED',
  'EXECUTION_PAUSE_BLOCKED', 'EXECUTION_SEAL_BLOCKED', 'EXECUTION_SEALED',
  'EXECUTION_REVISION_CONFLICT', 'LEASE_BUSY', 'LEASE_FENCE_CONFLICT',
  'LEASE_HANDOFF_IN_PROGRESS', 'LEASE_HANDOFF_TOKEN_INVALID',
  'LEASE_STALE_RECOVERY_REQUIRED', 'LEASE_RELEASE_BLOCKED', 'CAPABILITY_REQUIRED',
]);

export const runErrorCodeV12Schema = z.enum([
  ...runErrorCodeSchema.options,
  'SESSION_ARCHIVED', 'SESSION_ARCHIVE_BLOCKED',
  'RUN_REVISION_CONFLICT', 'ORCHESTRATION_REVISION_CONFLICT', 'STORE_BUSY',
  'PARTICIPANT_REQUIRED', 'INVALID_STATE_TRANSITION',
]);

export const runOperationSchema = z.enum([
  'create', 'next', 'complete', 'brief', 'recall', 'resolve', 'resume', 'fork', 'import',
  'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'accept-reuse',
  'plan-publish',
]);

export const runOperationV11Schema = z.enum([
  ...runOperationSchema.options,
  'capabilities', 'session-create', 'session-archive', 'session-unarchive',
  'execution-start', 'execution-attach', 'execution-status', 'execution-pause',
  'execution-resolve', 'execution-resume', 'execution-seal', 'execution-handoff-prepare',
  'execution-handoff-accept', 'execution-handoff-cancel', 'execution-lease-status',
  'execution-lease-heartbeat', 'execution-lease-release', 'execution-lease-recover',
]);

export const runOperationV12Schema = z.enum([
  ...runOperationSchema.options,
  'capabilities',
  'session-open', 'session-migrate', 'session-complete', 'session-archive', 'session-unarchive',
  'session-status', 'session-list', 'session-resume-view', 'session-chain-insert', 'session-chain-skip',
  'session-chain-replace', 'session-chain-update',
  'run-cancel', 'run-seal', 'run-transition', 'run-decide',
  ...runOperationV11Schema.options.filter(operation => operation.startsWith('execution-')),
  'execution-operation-claim', 'execution-operation-heartbeat',
  'execution-operation-release', 'execution-operation-status',
  'artifact-inspect', 'artifact-republish',
]);

const responseCommonSchema = z.object({
  schema_version: z.literal('run-response/1.0'),
  operation: runOperationSchema,
  request_id: z.string().min(1).nullable(),
  locator: z.object({ session_id: z.string().nullable(), run_id: z.string().nullable() }).strict().nullable(),
  next: briefNextSchema.nullable(),
  continuation: continuationDirectiveSchema.nullable().optional().default(null),
  replay: z.object({ status: z.enum(['applied', 'replayed']), transition_id: nonEmptyString }).strict().nullable(),
});

const nonBriefRunOperationSchema = z.enum([
  'create', 'next', 'complete', 'recall', 'resolve', 'resume', 'fork', 'import',
  'check', 'decide', 'seal-session', 'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'accept-reuse',
  'plan-publish',
]);

export const runResponseSuccessSchema = z.union([
  responseCommonSchema.extend({
    operation: z.literal('brief'),
    ok: z.literal(true),
    exit_code: z.literal(0),
    result: z.union([briefResultV10Schema, briefResultV11Schema, briefResultV12Schema]),
    error: z.null(),
  }).strict(),
  responseCommonSchema.extend({
    operation: nonBriefRunOperationSchema,
    ok: z.literal(true),
    exit_code: z.literal(0),
    result: z.unknown(),
    error: z.null(),
  }).strict(),
]);

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

/** Strict legacy envelope. It deliberately has no disposition, fence, or warnings fields. */
export const runResponseV10Schema = z.union([runResponseSuccessSchema, runResponseErrorSchema]);

export const responseLocatorV11Schema = z.object({
  session_id: z.string().min(1).nullable(),
  execution_id: z.string().min(1).nullable(),
  generation: z.number().int().positive().nullable(),
  run_id: z.string().min(1).nullable(),
}).strict();

export const responseFenceV11Schema = z.object({
  session_identity_revision: z.number().int().nonnegative().nullable(),
  session_activity_revision: z.number().int().nonnegative().nullable(),
  execution_revision: z.number().int().nonnegative().nullable(),
  lease_epoch: z.number().int().nonnegative().nullable(),
}).strict();

export const runResponseDispositionSchema = z.enum([
  'success', 'domain_error', 'control_flow', 'usage_error',
]);

export const responseWarningV11Schema = z.object({
  code: nonEmptyString,
  message: nonEmptyString,
  replacement_command: z.string().min(1).nullable(),
}).strict();

export const continuationDirectiveV11Schema = continuationDirectiveSchema
  .omit({ schema_version: true })
  .extend({
    schema_version: z.literal('run-continuation/1.1'),
    execution_id: z.string().min(1).nullable(),
    generation: z.number().int().positive().nullable(),
  })
  .strict();

const responseCommonV11Schema = z.object({
  schema_version: z.literal('run-response/1.1'),
  operation: runOperationV11Schema,
  request_id: z.string().min(1).nullable(),
  locator: responseLocatorV11Schema.nullable(),
  fence: responseFenceV11Schema.nullable(),
  next: briefNextSchema.nullable(),
  continuation: continuationDirectiveV11Schema.nullable(),
  replay: z.object({ status: z.enum(['applied', 'replayed']), transition_id: nonEmptyString }).strict().nullable(),
  warnings: z.array(responseWarningV11Schema),
});

export const runResponseSuccessV11Schema = responseCommonV11Schema.extend({
  ok: z.literal(true),
  exit_code: z.literal(0),
  disposition: z.literal('success'),
  result: z.unknown(),
  error: z.null(),
}).strict();

const runResponseErrorDetailV11Schema = z.object({
  code: runErrorCodeV11Schema,
  message: nonEmptyString,
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()),
  recovery_command: z.string().min(1).nullable(),
}).strict();

export const runResponseErrorV11Schema = z.union([
  responseCommonV11Schema.extend({
    ok: z.literal(false),
    exit_code: z.literal(1),
    disposition: z.literal('domain_error'),
    result: z.null(),
    error: runResponseErrorDetailV11Schema,
  }).strict(),
  responseCommonV11Schema.extend({
    ok: z.literal(false),
    exit_code: z.union([z.literal(2), z.literal(3)]),
    disposition: z.literal('control_flow'),
    result: z.null(),
    error: runResponseErrorDetailV11Schema,
  }).strict(),
  responseCommonV11Schema.extend({
    ok: z.literal(false),
    exit_code: z.literal(2),
    disposition: z.literal('usage_error'),
    result: z.null(),
    error: runResponseErrorDetailV11Schema,
  }).strict(),
]);

const acquisitionOperations = new Set([
  'execution-start', 'execution-attach', 'execution-resume',
  'execution-handoff-accept', 'execution-lease-recover',
]);

function rawLeaseIdPaths(value: unknown, path: string[] = []): string[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => rawLeaseIdPaths(item, [...path, String(index)]));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (
    key === 'lease_id'
      ? [[...path, key]]
      : rawLeaseIdPaths(item, [...path, key])
  ));
}

export const runResponseV11Schema = z.union([
  runResponseSuccessV11Schema,
  runResponseErrorV11Schema,
]).superRefine((response, ctx) => {
  for (const path of rawLeaseIdPaths(response)) {
    const authorizedClaim = response.ok
      && acquisitionOperations.has(response.operation)
      && path.join('.') === 'result.lease_claim.lease_id';
    if (!authorizedClaim) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'raw lease_id is only allowed in result.lease_claim for an acquisition operation',
      });
    }
  }
});

export const responseLocatorV12Schema = z.object({
  session_id: z.string().min(1).nullable(),
  run_id: z.string().min(1).nullable(),
}).strict();

export const responseRevisionV12Schema = z.object({
  target_type: transitionTargetTypeV20Schema,
  target_id: nonEmptyString,
  revision: z.number().int().nonnegative(),
}).strict();

const responseCommonV12Schema = z.object({
  schema_version: z.literal('run-response/1.2'),
  operation: runOperationV12Schema,
  request_id: z.string().min(1).nullable(),
  locator: responseLocatorV12Schema.nullable(),
  revision: responseRevisionV12Schema.nullable(),
  replay: z.object({
    status: z.enum(['applied', 'replayed']),
    transition_id: nonEmptyString,
  }).strict().nullable(),
  warnings: z.array(responseWarningV11Schema),
});

export const runResponseSuccessV12Schema = responseCommonV12Schema.extend({
  ok: z.literal(true),
  exit_code: z.literal(0),
  disposition: z.literal('success'),
  result: z.unknown(),
  error: z.null(),
}).strict();

const revisionConflictCodeV12Schema = z.enum([
  'RUN_REVISION_CONFLICT', 'ORCHESTRATION_REVISION_CONFLICT',
]);

const runResponseErrorDetailV12BaseSchema = z.object({
  code: runErrorCodeV12Schema,
  message: nonEmptyString,
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()),
  target_type: transitionTargetTypeV20Schema.nullable(),
  target_id: z.string().min(1).nullable(),
  expected_revision: z.number().int().nonnegative().nullable(),
  current_revision: z.number().int().nonnegative().nullable(),
  changed_by: z.string().min(1).nullable(),
  next_actions: z.array(nonEmptyString),
}).strict();

export const runResponseErrorDetailV12Schema = runResponseErrorDetailV12BaseSchema.superRefine((error, ctx) => {
  if (!revisionConflictCodeV12Schema.safeParse(error.code).success) return;
  for (const field of [
    'target_type', 'target_id', 'expected_revision', 'current_revision', 'changed_by',
  ] as const) {
    if (error[field] === null) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required for revision conflicts` });
    }
  }
  if (error.next_actions.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['next_actions'],
      message: 'next_actions is required for revision conflicts',
    });
  }
});

export const runResponseErrorV12Schema = z.union([
  responseCommonV12Schema.extend({
    ok: z.literal(false),
    exit_code: z.literal(1),
    disposition: z.literal('domain_error'),
    result: z.null(),
    error: runResponseErrorDetailV12Schema,
  }).strict(),
  responseCommonV12Schema.extend({
    ok: z.literal(false),
    exit_code: z.union([z.literal(2), z.literal(3)]),
    disposition: z.literal('control_flow'),
    result: z.null(),
    error: runResponseErrorDetailV12Schema,
  }).strict(),
  responseCommonV12Schema.extend({
    ok: z.literal(false),
    exit_code: z.literal(2),
    disposition: z.literal('usage_error'),
    result: z.null(),
    error: runResponseErrorDetailV12Schema,
  }).strict(),
]);

export const runResponseV12Schema = z.union([
  runResponseSuccessV12Schema,
  runResponseErrorV12Schema,
]);

/** Compatibility reader for all strict envelope generations. */
export const runResponseSchema = z.union([
  runResponseV12Schema,
  runResponseV11Schema,
  runResponseV10Schema,
]);

export const maestroCapabilitiesSchema = z.object({
  schema_version: z.literal('maestro-capabilities/1.0'),
  cli_version: nonEmptyString,
  session_schema_writes: z.array(z.enum(['session/1.3', 'session/2.0', 'session/3.0'])),
  execution_schema_writes: z.array(z.literal('execution/1.0')).max(1),
  run_response_writes: z.array(z.enum(['run-response/1.0', 'run-response/1.1', 'run-response/1.2'])),
  features: z.object({
    execution_generation: z.boolean(),
    core_execution_lease: z.boolean(),
    execution_handoff: z.boolean(),
    session_statusless: z.boolean(),
    legacy_session_aliases: z.boolean(),
  }).catchall(z.boolean()),
}).strict();

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
export type ReuseAssessmentProtocolV10 = z.infer<typeof reuseAssessmentSchema>;
export type ReuseAssessmentProtocolV11 = z.infer<typeof reuseAssessmentV11Schema>;
export type ReuseAssessmentProtocol = z.infer<typeof reuseAssessmentReadSchema>;
export type SourceFence = z.infer<typeof sourceFenceSchema>;
export type SourceFenceV11 = z.infer<typeof sourceFenceV11Schema>;
export type SourceFenceRead = z.infer<typeof sourceFenceReadSchema>;
export type SessionArchiveReceipt = z.infer<typeof sessionArchiveReceiptSchema>;
export type ExecutionSealReceiptV10 = z.infer<typeof executionSealReceiptSchema>;
export type ExecutionSealReceiptV11 = z.infer<typeof executionSealReceiptV11Schema>;
export type ExecutionSealReceipt = z.infer<typeof executionSealReceiptReadSchema>;
export type ArtifactCompatibilityAssessment = z.infer<typeof artifactCompatibilityAssessmentSchema>;
export type ArtifactCompatibilityClassification = z.infer<typeof artifactCompatibilityClassificationSchema>;
export type ArtifactRepublishReceipt = z.infer<typeof artifactRepublishReceiptSchema>;
export type RequestReceiptV20 = z.infer<typeof requestReceiptV20Schema>;
export type TransitionReceiptV20 = z.infer<typeof transitionReceiptV20Schema>;
export type ResumeMapV1 = z.infer<typeof resumeMapV1Schema>;
export type SessionProvenance = z.infer<typeof sessionProvenanceSchema>;
export type CreationDecision = z.infer<typeof creationDecisionSchema>;
export type CreationProvenance = z.infer<typeof creationProvenanceSchema>;
export type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;
export type GuidanceSnapshot = z.infer<typeof guidanceSnapshotSchema>;
export type CommandRebindAudit = z.infer<typeof commandRebindAuditSchema>;
export type TransitionFence = z.infer<typeof transitionFenceSchema>;
export type TransitionFenceV11 = z.infer<typeof transitionFenceV11Schema>;
export type ExecutionLocator = z.infer<typeof executionLocatorSchema>;
export type CompleteInputSnapshot = z.infer<typeof completeInputSnapshotSchema>;
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;
export type TransitionRequestV11 = z.infer<typeof transitionRequestV11Schema>;
export type TransitionRequestRead = z.infer<typeof transitionRequestReadSchema>;
export type TransitionOutcome = z.infer<typeof transitionOutcomeSchema>;
export type TransitionOutcomeV11 = z.infer<typeof transitionOutcomeV11Schema>;
export type TransitionOutcomeRead = z.infer<typeof transitionOutcomeReadSchema>;
export type PersistedTransitionRecord = z.infer<typeof persistedTransitionRecordSchema>;
export type PersistedTransitionRecordV11 = z.infer<typeof persistedTransitionRecordV11Schema>;
export type PersistedTransitionRecordRead = z.infer<typeof persistedTransitionRecordReadSchema>;
export type TransitionPointer = z.infer<typeof transitionPointerSchema>;
export type ExecutionContract = z.infer<typeof executionContractV11Schema> | z.infer<typeof executionContractV12Schema>;
export type BriefResult = z.infer<typeof briefResultV11Schema> | z.infer<typeof briefResultV12Schema>;
export type RunRecall = z.infer<typeof runRecallSchema>;
export type RecallConfirmationTargetIdentity = z.infer<typeof recallConfirmationTargetIdentitySchema>;
export type RecallConfirmationFinalTarget = z.infer<typeof recallConfirmationFinalTargetSchema>;
export type ValidatedRecallSourceV10 = z.infer<typeof validatedRecallSourceSchema>;
export type ValidatedRecallSourceV11 = z.infer<typeof validatedRecallSourceV11Schema>;
export type ValidatedRecallSource = z.infer<typeof validatedRecallSourceReadSchema>;
export type RecallReservationMarker = z.infer<typeof recallReservationMarkerSchema>;
export type RecallReservationObservation = z.infer<typeof recallReservationObservationSchema>;
export type RecallConfirmationReservationV10 = z.infer<typeof recallConfirmationReservationSchema>;
export type RecallConfirmationReservationV11 = z.infer<typeof recallConfirmationReservationV11Schema>;
export type RecallConfirmationReservation = z.infer<typeof recallConfirmationReservationReadSchema>;
export type StaleRecallReservation = z.infer<typeof staleRecallReservationSchema>;
export type RecallReservationReconciliation = z.infer<typeof recallReservationReconciliationSchema>;
export type RecallConfirmationOutcome = z.infer<typeof recallConfirmationOutcomeSchema>;
export type RecallConfirmationRecordV10 = z.infer<typeof recallConfirmationRecordSchema>;
export type RecallConfirmationRecordV11 = z.infer<typeof recallConfirmationRecordV11Schema>;
export type RecallConfirmationRecord = z.infer<typeof recallConfirmationRecordReadSchema>;
export type RecallConfirmationRegistryV10 = z.infer<typeof recallConfirmationRegistrySchema>;
export type RecallConfirmationRegistryV11 = z.infer<typeof recallConfirmationRegistryV11Schema>;
export type RecallConfirmationRegistry = z.infer<typeof recallConfirmationRegistryReadSchema>;
export type RunResponse = z.infer<typeof runResponseV10Schema>;
export type RunResponseRead = z.infer<typeof runResponseSchema>;
export type RunResponseV10 = z.infer<typeof runResponseV10Schema>;
export type RunResponseV11 = z.infer<typeof runResponseV11Schema>;
export type RunResponseV12 = z.infer<typeof runResponseV12Schema>;
export type RunResponseErrorCode = z.infer<typeof runErrorCodeSchema>;
export type RunResponseErrorCodeV11 = z.infer<typeof runErrorCodeV11Schema>;
export type RunResponseErrorCodeV12 = z.infer<typeof runErrorCodeV12Schema>;
export type RunOperationV11 = z.infer<typeof runOperationV11Schema>;
export type RunOperationV12 = z.infer<typeof runOperationV12Schema>;
export type RunResponseDisposition = z.infer<typeof runResponseDispositionSchema>;
export type ResponseLocatorV11 = z.infer<typeof responseLocatorV11Schema>;
export type ResponseFenceV11 = z.infer<typeof responseFenceV11Schema>;
export type ResponseWarningV11 = z.infer<typeof responseWarningV11Schema>;
export type ContinuationDirectiveV11 = z.infer<typeof continuationDirectiveV11Schema>;
export type MaestroCapabilities = z.infer<typeof maestroCapabilitiesSchema>;
export type ContinuationAction = z.infer<typeof continuationActionSchema>;
export type ContinuationAuthority = z.infer<typeof continuationAuthoritySchema>;
export type ContinuationDirective = z.infer<typeof continuationDirectiveSchema>;
export type SessionTransition = z.infer<typeof sessionTransitionSchema>;
export type ImportManifest = z.infer<typeof importManifestSchema>;
