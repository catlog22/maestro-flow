import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const artifactRoleSchema = z.enum(['primary', 'evidence', 'report', 'attachment']);

export const boundaryContractSchema = z.object({
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  constraints: z.array(z.string()),
  definition_of_done: z.string(),
}).strict();

const orchestrationStepSchema = z.object({
  step_id: nonEmptyString,
  command: nonEmptyString,
  status: nonEmptyString,
  run_id: z.string().nullable(),
  inserted_by: nonEmptyString,
  decision_ref: z.string().nullable(),
}).strict();

const decisionPointSchema = z.object({
  point_id: nonEmptyString,
  after_step_id: z.string().nullable(),
  status: nonEmptyString,
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().nonnegative(),
  evidence_ref: z.string().nullable(),
}).strict();

export const sessionStateSchema = z.object({
  schema_version: z.literal('session/1.0'),
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
  }).strict(),
  requests: z.array(z.object({
    request_id: nonEmptyString,
    type: nonEmptyString,
    status: nonEmptyString,
    payload: z.unknown(),
    claimed_by_run_id: z.string().nullable(),
  }).strict()),
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

export const commandRunSchema = z.object({
  schema_version: z.literal('command-run/1.0'),
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

export const artifactMetaSchema = z.object({
  kind: nonEmptyString,
  schema: nonEmptyString,
  role: artifactRoleSchema.optional(),
  alias: z.string().min(1).optional(),
}).strict();

export const reportFrontmatterSchema = z.object({
  verdict: z.enum(['ready', 'ready_with_concerns', 'blocked', 'failed']).default('ready'),
  summary: z.string().default(''),
  constraints: z.array(z.object({
    id: nonEmptyString,
    text: z.string(),
    status: z.enum(['locked', 'open', 'deferred']),
  }).strict()).default([]),
  decisions: z.array(z.object({
    id: nonEmptyString,
    text: z.string(),
    status: z.enum(['proposed', 'accepted', 'rejected']),
  }).strict()).default([]),
  concerns: z.array(z.string()).default([]),
  next: z.array(z.object({
    command: nonEmptyString,
    reason: z.string().default(''),
    needs: z.array(z.string()).default([]),
  }).strict()).default([]),
  details: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type SessionState = z.infer<typeof sessionStateSchema>;
export type Gate = z.infer<typeof gateSchema>;
export type GateRegistry = z.infer<typeof gateRegistrySchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ArtifactRegistry = z.infer<typeof artifactRegistrySchema>;
export type EvidenceStore = z.infer<typeof evidenceStoreSchema>;
export type Handoff = z.infer<typeof handoffSchema>;
export type CommandRun = z.infer<typeof commandRunSchema>;
export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;
export type ReportFrontmatter = z.infer<typeof reportFrontmatterSchema>;

