import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { artifactRepublishReceiptSchema, guidanceSnapshotSchema, type GuidanceSnapshot, type TransitionReceiptV20 } from '../protocol-schemas.js';
import {
  applyAutomaticKnowledgeSuppression,
  currentKnowledgeCorpusFingerprint,
  isKnowledgeReconciliationFresh,
  knowledgeReconciliationSchema,
  readKnowledgeReconciliation,
  reconcileRunKnowledgeSync,
  reconciliationPath,
  reconciliationSummary,
  type KnowledgeReconciliation,
} from '../../knowledge/reconcile.js';
import {
  addCandidate,
  readRunKnowledgeDelta,
  reportKnowledgeCandidateDrafts,
  runKnowledgeDeltaPath,
  runKnowledgeDeltaSchema,
  type RunKnowledgeDelta,
} from '../knowledge.js';
import {
  artifactRegistrySchema,
  type ArtifactRegistry,
  type RunV30,
  type SessionStateV30,
} from '../schemas.js';
import {
  artifactRepublishReceiptHash,
  createArtifactRepublishReceipt,
  exactArtifactRepublishReceipt,
  prepareArtifactRepublish,
  type PrepareArtifactRepublishOptions,
} from '../artifact-compatibility.js';
import { SessionStore, type SessionV30StoreTransaction } from '../store.js';
import { assertSafePathSegment } from '../ids.js';
import {
  defaultArtifactAlias,
  scanOutputs,
  validateStrictArtifactContract,
  type DiscoveredArtifact,
} from '../artifacts.js';
import { hashCommandContract, resolveCommandSource, resolveStepContent } from '../contract.js';
import { readReportFrontmatter, type ReportFrontmatter } from '../report.js';
import { createRevisionConflictError, V3StructuredError } from './errors.js';
import {
  v3BriefCommand,
  v3CheckNext,
  v3CompleteNext,
  v3DecideNext,
  v3RunNext,
  v3SessionCompleteNext,
  v3TaskContractSchema,
  type V3NextContract,
  type V3TaskContract,
} from './continuation-v3.js';
import {
  canonicalPayloadHash,
  createRequestReceipt,
  createTransitionReceipt,
  replayRequestReceipt,
  transitionReceiptRef,
} from './receipts.js';
import { assertSessionCanComplete, assertSessionOperationAllowed, assertSessionRunTransitionAllowed, transitionSession, type SessionCompletionSnapshot } from './session-machine.js';
import { transitionRun, buildRetryMetadata, type RunStatus, type RunTransitionEvidence } from './run-machine.js';

export interface V3MutationIdentity {
  sessionId: string;
  requestId: string;
  actorId: string;
  reason: string;
  evidenceRefs?: readonly string[];
  recordedAt?: string;
}

export interface V3MutationResult {
  status: 'applied' | 'replayed';
  transition: TransitionReceiptV20;
}

export interface MutateRunV3Input extends V3MutationIdentity {
  runId: string;
  expectedRunRevision: number;
  expectedOrchestrationRevision?: number;
  toStatus: RunStatus;
  summary?: string | null;
  verdict?: RunV30['verdict'];
  transitionEvidence?: RunTransitionEvidence;
}

export interface CreateRunV3Input extends V3MutationIdentity {
  expectedOrchestrationRevision: number;
  run: RunV30;
}

export interface CreateRunningRunV3Input extends CreateRunV3Input {
  requestOperation?: 'run-create' | 'run-next';
}

export interface CompleteRunAndAdvanceInput extends V3MutationIdentity {
  runId: string;
  expectedRunRevision: number;
  expectedOrchestrationRevision: number;
  summary?: string | null;
  verdict: Extract<NonNullable<RunV30['verdict']>, 'done' | 'done_with_concerns'>;
  /**
   * Optional preflight receipt derived by the CLI. Completion revalidates it
   * under the v3 store lock and regenerates it there when it is stale.
   * Deliberately NOT part of the canonical payload: replay returns the original
   * receipt before any derived knowledge work runs.
   */
  knowledgeReconciliation?: KnowledgeReconciliation | null;
}

export interface RecoverSealRunV3Input extends V3MutationIdentity {
  runId: string;
  expectedRunRevision: number;
}

export interface RepublishArtifactV3Input extends V3MutationIdentity {
  artifactId: string;
  consumerCommand: string;
  alias: string;
  assessmentHash: string;
  expectedArtifactRevision: number;
  expectedSessionRevision: number;
}

export interface CompleteSessionV3Input extends V3MutationIdentity {
  expectedOrchestrationRevision: number;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new V3StructuredError('INVALID_ARGUMENT', `${label} is required`);
  return normalized;
}

function readRunOrThrow(tx: SessionV30StoreTransaction, runId: string): RunV30 {
  if (!tx.runExists(runId)) {
    throw new V3StructuredError('RUN_NOT_FOUND', `Run ${runId} was not found`, {
      target_type: 'run',
      target_id: runId,
      next_actions: ['check-run-id', 'read-session-status'],
    });
  }
  return tx.readRun(runId);
}

function normalizedIdentity(input: V3MutationIdentity): Required<Omit<V3MutationIdentity, 'evidenceRefs' | 'recordedAt'>> & {
  evidenceRefs: string[];
  recordedAt: string;
} {
  const sessionId = required(input.sessionId, 'session ID');
  const requestId = required(input.requestId, 'request ID');
  const actorId = required(input.actorId, 'actor ID');
  assertSafePathSegment(sessionId, 'session ID');
  assertSafePathSegment(requestId, 'request ID');
  return {
    sessionId,
    requestId,
    actorId,
    reason: required(input.reason, 'reason'),
    evidenceRefs: [...new Set((input.evidenceRefs ?? []).map(item => item.trim()).filter(Boolean))].sort(),
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

function auditPayload(identity: ReturnType<typeof normalizedIdentity>) {
  return {
    actor_id: identity.actorId,
    reason: identity.reason,
    evidence_refs: identity.evidenceRefs,
  };
}

function creationPayload(run: RunV30) {
  return {
    schema_version: run.schema_version,
    run_id: run.run_id,
    session_id: run.session_id,
    step_id: run.step_id,
    parent_run_id: run.parent_run_id,
    retry_of_run_id: run.retry_of_run_id,
    attempt: run.attempt,
    command: run.command,
    args: run.args,
    goal: run.goal,
    input_refs: run.input_refs,
  };
}

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new V3StructuredError('INVALID_ARGUMENT', `${label} must be a non-negative safe integer`);
  }
}

function assertRunRevision(run: RunV30, expected: number): void {
  assertRevision(expected, 'expected Run revision');
  if (run.revision !== expected) {
    throw createRevisionConflictError({
      code: 'RUN_REVISION_CONFLICT',
      targetType: 'run',
      targetId: run.run_id,
      expectedRevision: expected,
      currentRevision: run.revision,
      changedBy: run.actor_id,
    });
  }
}

function assertOrchestrationRevision(session: SessionStateV30, expected: number): void {
  assertRevision(expected, 'expected orchestration revision');
  if (session.orchestration_revision !== expected) {
    throw createRevisionConflictError({
      code: 'ORCHESTRATION_REVISION_CONFLICT',
      targetType: 'orchestration',
      targetId: session.session_id,
      expectedRevision: expected,
      currentRevision: session.orchestration_revision,
      changedBy: 'unknown',
    });
  }
}

function replay(
  tx: SessionV30StoreTransaction,
  identity: ReturnType<typeof normalizedIdentity>,
  payloadHash: string,
): V3MutationResult | null {
  const transition = replayRequestReceipt({
    tx,
    sessionId: identity.sessionId,
    requestId: identity.requestId,
    // The participant dimension was simplified away: receipts store
    // participant_id = actor_id, so the replay identity key is actor-based.
    participantId: identity.actorId,
    payloadHash,
  });
  return transition ? { status: 'replayed', transition } : null;
}

function stageApplied(input: {
  tx: SessionV30StoreTransaction;
  identity: ReturnType<typeof normalizedIdentity>;
  payloadHash: string;
  session: SessionStateV30;
  run?: RunV30;
  targetType: TransitionReceiptV20['target_type'];
  targetId: string;
  revisionBefore: number;
  revisionAfter: number;
  result: unknown;
}): V3MutationResult {
  const transitionId = `tr_${randomUUID()}`;
  const transition = createTransitionReceipt({
    transitionId,
    requestId: input.identity.requestId,
    sessionId: input.identity.sessionId,
    activityRevision: input.session.activity_revision,
    targetType: input.targetType,
    targetId: input.targetId,
    revisionBefore: input.revisionBefore,
    revisionAfter: input.revisionAfter,
    actorId: input.identity.actorId,
    participantId: input.identity.actorId,
    reason: input.identity.reason,
    evidenceRefs: input.identity.evidenceRefs,
    recordedAt: input.identity.recordedAt,
    result: input.result,
  });
  const reference = transitionReceiptRef(transition.activity_revision, transition.transition_id);
  const request = createRequestReceipt({
    requestId: input.identity.requestId,
    participantId: input.identity.actorId,
    payloadHash: input.payloadHash,
    transitionReceiptRef: reference,
  });
  input.tx.writeSession(input.session);
  if (input.run) input.tx.writeRun(input.run);
  input.tx.writeTransitionReceipt(transition);
  input.tx.writeRequestReceipt(request);
  return { status: 'applied', transition };
}

function assertRunCreationLineage(
  tx: SessionV30StoreTransaction,
  candidate: RunV30,
  stepStatus: SessionStateV30['chain'][number]['status'],
): void {
  if (candidate.retry_of_run_id === null) {
    if (candidate.attempt !== 1) {
      throw new V3StructuredError('INVALID_ARGUMENT', 'an initial Run must have attempt 1');
    }
    if (stepStatus !== 'pending') {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `chain step ${candidate.step_id} is not pending`);
    }
    return;
  }
  if (!tx.runExists(candidate.retry_of_run_id)) {
    throw new V3StructuredError('INVALID_ARGUMENT', `unknown retry source Run ${candidate.retry_of_run_id}`);
  }
  const source = readRunOrThrow(tx, candidate.retry_of_run_id);
  if (source.step_id !== candidate.step_id) {
    throw new V3StructuredError('INVALID_ARGUMENT', `retry source Run ${source.run_id} belongs to a different chain step`);
  }
  const expected = source.status === 'sealed'
    ? buildRetryMetadata({
      runId: source.run_id,
      attempt: source.attempt,
      status: source.status,
      verdict: source.verdict,
    })
    : buildRetryMetadata({
      runId: source.run_id,
      attempt: source.attempt,
      status: source.status,
    });
  if (candidate.retry_of_run_id !== expected.retryOfRunId || candidate.attempt !== expected.attempt) {
    throw new V3StructuredError(
      'INVALID_ARGUMENT',
      `retry Run must use source ${expected.retryOfRunId} and attempt ${expected.attempt}`,
    );
  }
  if (stepStatus !== 'failed') {
    throw new V3StructuredError('INVALID_STATE_TRANSITION', `retry chain step ${candidate.step_id} is not failed`);
  }
}

function updatedSessionActivity(
  session: SessionStateV30,
  recordedAt: string,
  orchestrationRevision = session.orchestration_revision,
): SessionStateV30 {
  return {
    ...session,
    orchestration_revision: orchestrationRevision,
    activity_revision: session.activity_revision + 1,
    updated_at: recordedAt,
  };
}

function artifactId(runId: string, relativePath: string): string {
  const digest = canonicalPayloadHash({ run_id: runId, relative_path: relativePath })
    .slice('sha256:'.length, 'sha256:'.length + 20);
  return `ART-${digest}`;
}

function registerRunArtifacts(
  registry: ArtifactRegistry,
  run: RunV30,
  discovered: readonly DiscoveredArtifact[],
): string[] {
  const ids: string[] = [];
  for (const item of [...discovered].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const existing = Object.entries(registry.artifacts).find(([, artifact]) => (
      artifact.producer_run_id === run.run_id && artifact.relative_path === item.relativePath
    ));
    const id = existing?.[0] ?? artifactId(run.run_id, item.relativePath);
    const previous = existing?.[1];
    const collision = registry.artifacts[id];
    if (collision && !previous) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `Artifact ID collision for ${item.relativePath}`);
    }
    if (previous?.status === 'sealed' && previous.content_hash !== item.contentHash) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `sealed Artifact is immutable: ${item.relativePath}`);
    }
    const alias = item.alias
      ?? (item.role === 'primary' ? defaultArtifactAlias(item.kind, run.command) : undefined);
    const priorAliasId = alias ? registry.aliases[alias] : undefined;
    if (priorAliasId && priorAliasId !== id) {
      const prior = registry.artifacts[priorAliasId];
      if (prior?.status === 'sealed') prior.status = 'superseded';
    }
    registry.artifacts[id] = {
      kind: item.kind,
      role: item.role,
      producer_run_id: run.run_id,
      relative_path: item.relativePath,
      media_type: item.mediaType,
      schema_version: item.schemaVersion,
      content_hash: item.contentHash,
      size: item.size,
      status: 'sealed',
      derived_from: [...run.input_refs],
      replaces: priorAliasId && priorAliasId !== id ? priorAliasId : previous?.replaces ?? null,
    };
    if (alias) registry.aliases[alias] = id;
    ids.push(id);
  }
  registry.revision++;
  return ids;
}

interface ArtifactPublicationAuthority {
  authority: 'transition-receipt/2.0';
  artifact_registry_revision: number;
  artifact_ids: string[];
  primary_artifact_id: string | null;
  artifacts: ArtifactRegistry['artifacts'];
  aliases: Record<string, string>;
}

function prepareArtifactPublication(input: {
  store: SessionStore;
  tx: SessionV30StoreTransaction;
  session: SessionStateV30;
  run: RunV30;
  strict: boolean;
}): { authority: ArtifactPublicationAuthority; warnings: string[] } {
  const runDir = input.store.runDir(input.session.session_id, input.run.run_id);
  const sessionDir = input.store.sessionDir(input.session.session_id);
  const contract = resolveCommandSource(input.store.projectRoot, input.run.command).contract;
  const scan = scanOutputs(runDir, sessionDir, contract);
  if (input.strict) validateStrictArtifactContract(runDir, contract, scan);
  if (scan.errors.length > 0) {
    throw new V3StructuredError('INVALID_STATE_TRANSITION', `Run output validation failed: ${scan.errors.join('; ')}`, {
      details: { reason: 'RUN_OUTPUT_VALIDATION_FAILED', errors: scan.errors, warnings: scan.warnings },
      target_type: 'run', target_id: input.run.run_id,
      next_actions: [`repair-run-outputs:${input.run.run_id}`, `check-run:${input.run.run_id}`],
    });
  }
  const artifactsPath = resolve(sessionDir, input.session.artifacts_ref);
  const artifacts = input.tx.readJson(artifactsPath, artifactRegistrySchema);
  const artifactIds = registerRunArtifacts(artifacts, input.run, scan.artifacts);
  const primaryArtifactId = artifactIds.find(id => artifacts.artifacts[id]?.role === 'primary') ?? null;
  const publishedArtifactSet = new Set(artifactIds);
  const authority: ArtifactPublicationAuthority = {
    authority: 'transition-receipt/2.0',
    artifact_registry_revision: artifacts.revision,
    artifact_ids: artifactIds,
    primary_artifact_id: primaryArtifactId,
    artifacts: Object.fromEntries(artifactIds.map(id => [id, structuredClone(artifacts.artifacts[id])])),
    aliases: Object.fromEntries(Object.entries(artifacts.aliases).filter(([, id]) => publishedArtifactSet.has(id))),
  };
  input.tx.writeJson(artifactsPath, artifacts, artifactRegistrySchema);
  return { authority, warnings: scan.warnings };
}

function publicationAuthority(result: unknown, run: RunV30): ArtifactPublicationAuthority | null {
  if (typeof result !== 'object' || result === null) return null;
  const value = result as Record<string, unknown>;
  const raw = value.artifact_publication;
  if ((value.operation !== 'run-complete-and-seal' && value.operation !== 'run-recovery-seal')
    || value.run_id !== run.run_id
    || value.status !== 'sealed'
    || value.run_revision !== run.revision
    || typeof raw !== 'object'
    || raw === null) return null;
  const publication = raw as Record<string, unknown>;
  if (publication.authority !== 'transition-receipt/2.0'
    || !Number.isSafeInteger(publication.artifact_registry_revision)
    || (publication.artifact_registry_revision as number) < 0
    || !Array.isArray(publication.artifact_ids)
    || !publication.artifact_ids.every(id => typeof id === 'string')
    || new Set(publication.artifact_ids).size !== publication.artifact_ids.length
    || !(publication.primary_artifact_id === null || typeof publication.primary_artifact_id === 'string')
    || typeof publication.artifacts !== 'object'
    || publication.artifacts === null
    || Array.isArray(publication.artifacts)
    || typeof publication.aliases !== 'object'
    || publication.aliases === null
    || Array.isArray(publication.aliases)) {
    return null;
  }
  return publication as unknown as ArtifactPublicationAuthority;
}

function republishPublicationReceipt(
  tx: SessionV30StoreTransaction,
  result: unknown,
  run: RunV30,
  artifacts: ArtifactRegistry,
): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const value = result as Record<string, unknown>;
  if (value.operation !== 'artifact-republish') return false;
  const parsed = artifactRepublishReceiptSchema.safeParse(value.receipt);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  const stored = tx.readArtifactRepublishReceipt(receipt.receipt_id);
  const artifact = artifacts.artifacts[receipt.artifact_id];
  return stored !== null
    && canonicalPayloadHash(stored) === canonicalPayloadHash(receipt)
    && artifactRepublishReceiptHash(receipt) === receipt.receipt_hash
    && receipt.compatibility_run_id === run.run_id
    && run.status === 'sealed'
    && run.output_refs.length === 1
    && run.output_refs[0] === receipt.artifact_id
    && artifact?.status === 'sealed'
    && artifact.producer_run_id === run.run_id
    && `sha256:${artifact.content_hash}` === receipt.artifact_hash
    && JSON.stringify(artifact.derived_from) === JSON.stringify([receipt.source_artifact_id]);
}

function assertPredecessorDecisionGateResolved(session: SessionStateV30, stepIndex: number): void {
  if (stepIndex === 0) return;
  const previousStep = session.chain[stepIndex - 1];
  // Skipped predecessors carry their own evidence; the gate check applies to
  // completed predecessors only.
  if (previousStep.status !== 'completed') return;
  const gateId = previousStep.decision_ref;
  if (!gateId) return;
  // A declared gate with no decision record counts as open: the decision must
  // be recorded (run decide) before the chain advances past the gate.
  const status = session.decisions.find(decision => decision.decision_id === gateId)?.status ?? 'open';
  if (status !== 'open' && status !== 'escalated') return;
  throw new V3StructuredError(
    'INVALID_STATE_TRANSITION',
    `decision gate ${gateId} on completed predecessor step ${previousStep.step_id} is ${status}; resolve it before advancing`, {
      details: {
        reason: 'DECISION_GATE_BLOCKED',
        decision_id: gateId,
        decision_status: status,
        predecessor_step_id: previousStep.step_id,
      },
      target_type: 'orchestration',
      target_id: session.session_id,
      next_actions: status === 'escalated'
        ? [`run-decide:${gateId}`, `review-escalated-decision:${gateId}`]
        : [`run-decide:${gateId}`],
    },
  );
}

function assertNextPredecessorPublished(
  tx: SessionV30StoreTransaction,
  session: SessionStateV30,
  stepIndex: number,
  artifacts: ArtifactRegistry,
): void {
  if (stepIndex === 0) return;
  const previousStep = session.chain[stepIndex - 1];
  if (previousStep.status === 'skipped') return;
  if (previousStep.status !== 'completed') {
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor chain step ${previousStep.step_id} is ${previousStep.status}, expected completed`,
      { target_type: 'orchestration', target_id: session.session_id, next_actions: ['finish-predecessor-run'] },
    );
  }
  const predecessor = previousStep.run_ids
    .map(runId => tx.readRun(runId))
    .sort((left, right) => right.attempt - left.attempt || right.run_id.localeCompare(left.run_id))[0];
  if (!predecessor) {
    throw new V3StructuredError('INVALID_STATE_TRANSITION', `completed predecessor step ${previousStep.step_id} has no Run`);
  }
  if (predecessor.status !== 'sealed') {
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor Run ${predecessor.run_id} is ${predecessor.status}, expected sealed`,
      { target_type: 'run', target_id: predecessor.run_id, next_actions: [`recover-run-seal:${predecessor.run_id}`] },
    );
  }
  const republishAuthorities = tx.listTransitionReceipts()
    .filter(receipt => republishPublicationReceipt(tx, receipt.result, predecessor, artifacts));
  if (republishAuthorities.length === 1) {
    const authority = republishAuthorities[0];
    const request = tx.readRequestReceipt(authority.request_id);
    if (request
      && request.participant_id === authority.participant_id
      && request.transition_receipt_ref === transitionReceiptRef(authority.activity_revision, authority.transition_id)) {
      return;
    }
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor Run ${predecessor.run_id} Artifact republish request receipt is missing or inconsistent`,
    );
  }
  if (republishAuthorities.length > 1) {
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor Run ${predecessor.run_id} has ambiguous Artifact republish authority`,
    );
  }
  const authorities = tx.listTransitionReceipts()
    .map(receipt => ({ receipt, publication: publicationAuthority(receipt.result, predecessor) }))
    .filter((value): value is { receipt: TransitionReceiptV20; publication: ArtifactPublicationAuthority } => (
      value.publication !== null
    ));
  if (authorities.length !== 1) {
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor Run ${predecessor.run_id} lacks unique artifact publication authority`,
      { target_type: 'run', target_id: predecessor.run_id, next_actions: ['inspect-completion-receipt'] },
    );
  }
  const { receipt, publication } = authorities[0];
  const request = tx.readRequestReceipt(receipt.request_id);
  if (!request
    || request.participant_id !== receipt.participant_id
    || request.transition_receipt_ref !== transitionReceiptRef(receipt.activity_revision, receipt.transition_id)) {
    throw new V3StructuredError(
      'INVALID_STATE_TRANSITION',
      `predecessor Run ${predecessor.run_id} publication request receipt is missing or inconsistent`,
      { target_type: 'run', target_id: predecessor.run_id, next_actions: ['inspect-completion-receipt'] },
    );
  }
  const artifactIds = [...publication.artifact_ids].sort();
  if (publication.artifact_registry_revision > artifacts.revision
    || JSON.stringify(artifactIds) !== JSON.stringify([...predecessor.output_refs].sort())
    || JSON.stringify(artifactIds) !== JSON.stringify(Object.keys(publication.artifacts).sort())
    || publication.primary_artifact_id !== predecessor.primary_artifact_id) {
    throw new V3StructuredError('INVALID_STATE_TRANSITION', `predecessor Run ${predecessor.run_id} publication binding changed`);
  }
  for (const artifactId of artifactIds) {
    const artifact = artifacts.artifacts[artifactId];
    const committed = publication.artifacts[artifactId];
    if (!artifact
      || artifact.producer_run_id !== predecessor.run_id
      || artifact.status !== 'sealed'
      || canonicalPayloadHash(artifact) !== canonicalPayloadHash(committed)) {
      throw new V3StructuredError(
        'INVALID_STATE_TRANSITION',
        `predecessor Run ${predecessor.run_id} Artifact ${artifactId} is not sealed publication authority`,
      );
    }
  }
  for (const [alias, artifactId] of Object.entries(publication.aliases)) {
    if (!artifactIds.includes(artifactId) || artifacts.aliases[alias] !== artifactId) {
      throw new V3StructuredError(
        'INVALID_STATE_TRANSITION',
        `predecessor Run ${predecessor.run_id} Artifact alias ${alias} changed`,
      );
    }
  }
}

export function mutateRunV3(store: SessionStore, input: MutateRunV3Input): V3MutationResult {
  const identity = normalizedIdentity(input);
  const runId = required(input.runId, 'run ID');
  const payload = {
    operation: 'run-transition', run_id: runId, expected_run_revision: input.expectedRunRevision,
    expected_orchestration_revision: input.expectedOrchestrationRevision ?? null,
    to_status: input.toStatus, summary: input.summary, verdict: input.verdict,
    transition_evidence: input.transitionEvidence ?? {},
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    const run = readRunOrThrow(tx, runId);
    assertRunRevision(run, input.expectedRunRevision);
    if (input.toStatus === 'failed' || input.toStatus === 'cancelled') {
      if (input.expectedOrchestrationRevision === undefined) {
        throw new V3StructuredError(
          'INVALID_ARGUMENT',
          `expected orchestration revision is required when transitioning a Run to ${input.toStatus}`,
        );
      }
      assertOrchestrationRevision(session, input.expectedOrchestrationRevision);
    }
    assertSessionRunTransitionAllowed(session.status, run.status, input.toStatus, input.transitionEvidence);
    const transitioned = transitionRun(run, input.toStatus, input.transitionEvidence);
    const nextRun: RunV30 = {
      ...transitioned,
      revision: run.revision + 1,
      actor_id: identity.actorId,
      summary: input.summary === undefined ? run.summary : input.summary,
      verdict: input.verdict === undefined ? run.verdict : input.verdict,
      started_at: input.toStatus === 'running' ? (run.started_at ?? identity.recordedAt) : run.started_at,
      ended_at: ['completed', 'failed', 'cancelled'].includes(input.toStatus) ? identity.recordedAt : run.ended_at,
      sealed_at: input.toStatus === 'sealed' ? identity.recordedAt : run.sealed_at,
    };
    const terminal = ['completed', 'failed', 'cancelled', 'sealed'].includes(input.toStatus);
    const stepIndex = session.chain.findIndex(step => step.step_id === run.step_id);
    const terminalStepStatus = input.toStatus === 'failed'
      ? 'failed' as const
      : input.toStatus === 'cancelled'
        ? 'pending' as const
        : null;
    const changesRunningStep = terminalStepStatus !== null
      && stepIndex >= 0
      && session.chain[stepIndex].status === 'running'
      && session.chain[stepIndex].run_ids.includes(runId);
    const chain = changesRunningStep
      ? session.chain.map((step, index) => index === stepIndex ? { ...step, status: terminalStepStatus } : step)
      : session.chain;
    const nextSession = updatedSessionActivity(terminal
      ? { ...session, chain, active_run_ids: session.active_run_ids.filter(id => id !== runId) }
      : session, identity.recordedAt, changesRunningStep
        ? session.orchestration_revision + 1
        : session.orchestration_revision);
    const continuation = input.toStatus === 'running'
      ? v3CompleteNext({
        sessionId: identity.sessionId,
        runId,
        orchestrationRevision: nextSession.orchestration_revision,
        runRevision: nextRun.revision,
        reason: 'Run returned to running; execute and complete it with run complete --advance',
      })
      : input.toStatus === 'cancelled' && nextSession.chain.some(step => step.status === 'pending')
        ? v3RunNext({
          sessionId: identity.sessionId,
          orchestrationRevision: nextSession.orchestration_revision,
          reason: 'Run cancelled; dispatch the pending chain step with run next',
        })
        : v3CheckNext({
          sessionId: identity.sessionId,
          runId,
          reason: `Run is ${nextRun.status}; inspect canonical Run state before continuing`,
        });
    return stageApplied({
      tx, identity, payloadHash, session: nextSession, run: nextRun,
      targetType: 'run', targetId: runId,
      revisionBefore: run.revision, revisionAfter: nextRun.revision,
      result: {
        run_id: runId, status: nextRun.status, revision: nextRun.revision,
        orchestration_revision: nextSession.orchestration_revision,
        ...continuation,
      },
    });
  });
}

export function recoverSealRunV3(store: SessionStore, input: RecoverSealRunV3Input): V3MutationResult {
  const identity = normalizedIdentity(input);
  const runId = required(input.runId, 'run ID');
  const payload = {
    operation: 'run-recovery-seal', run_id: runId,
    expected_run_revision: input.expectedRunRevision,
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    const run = readRunOrThrow(tx, runId);
    assertRunRevision(run, input.expectedRunRevision);
    assertSessionRunTransitionAllowed(session.status, run.status, 'sealed');
    const publication = prepareArtifactPublication({
      store, tx, session, run, strict: run.status === 'completed',
    });
    const nextRun: RunV30 = {
      ...transitionRun(run, 'sealed'),
      revision: run.revision + 1,
      actor_id: identity.actorId,
      output_refs: publication.authority.artifact_ids,
      primary_artifact_id: publication.authority.primary_artifact_id,
      sealed_at: identity.recordedAt,
    };
    const nextSession = updatedSessionActivity({
      ...session,
      active_run_ids: session.active_run_ids.filter(id => id !== runId),
    }, identity.recordedAt);
    const continuation = run.status === 'completed'
      ? nextSession.chain.some(step => step.status === 'pending')
        ? v3RunNext({
          sessionId: identity.sessionId,
          orchestrationRevision: nextSession.orchestration_revision,
          reason: 'Deprecated recovery seal completed; dispatch the next pending chain Run',
        })
        : v3SessionCompleteNext({
          sessionId: identity.sessionId,
          orchestrationRevision: nextSession.orchestration_revision,
          reason: 'Deprecated recovery seal completed; complete the terminal Session',
        })
      : v3CheckNext({
        sessionId: identity.sessionId,
        runId,
        reason: 'Deprecated recovery seal completed; re-read canonical Run authority before continuing',
      });
    return stageApplied({
      tx, identity, payloadHash, session: nextSession, run: nextRun,
      targetType: 'run', targetId: runId,
      revisionBefore: run.revision, revisionAfter: nextRun.revision,
      result: {
        operation: 'run-recovery-seal', run_id: runId,
        run_revision: nextRun.revision, status: nextRun.status,
        artifact_publication: publication.authority,
        output_warnings: publication.warnings,
        ...continuation,
      },
    });
  });
}

export function createRunV3(store: SessionStore, input: CreateRunV3Input): V3MutationResult {
  const identity = normalizedIdentity(input);
  const candidate = structuredClone(input.run);
  const payload = {
    operation: 'run-create', expected_orchestration_revision: input.expectedOrchestrationRevision,
    run: creationPayload(candidate),
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    assertOrchestrationRevision(session, input.expectedOrchestrationRevision);
    assertSessionOperationAllowed(session.status, 'create_run');
    if (candidate.session_id !== identity.sessionId || candidate.revision !== 0 || candidate.status !== 'pending') {
      throw new V3StructuredError('INVALID_ARGUMENT', 'new Run must target the Session with pending status and revision 0');
    }
    if (tx.runExists(candidate.run_id)) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `Run ${candidate.run_id} already exists`, {
        target_type: 'run', target_id: candidate.run_id, next_actions: ['choose-a-new-run-id', 'inspect-existing-run'],
      });
    }
    const stepIndex = session.chain.findIndex(step => step.step_id === candidate.step_id);
    if (stepIndex < 0) throw new V3StructuredError('INVALID_ARGUMENT', `unknown chain step ${candidate.step_id}`);
    assertRunCreationLineage(tx, candidate, session.chain[stepIndex].status);
    const artifacts = tx.readJson(
      resolve(store.sessionDir(identity.sessionId), session.artifacts_ref),
      artifactRegistrySchema,
    );
    assertExplicitArtifactInputs(candidate.input_refs, artifacts);
    if (session.active_run_ids.includes(candidate.run_id)) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `Run ${candidate.run_id} is already active`);
    }
    const chain = session.chain.map((step, index) => index === stepIndex
      ? { ...step, run_ids: [...new Set([...step.run_ids, candidate.run_id])].sort() }
      : step);
    const nextSession = updatedSessionActivity({
      ...session,
      chain,
      active_run_ids: [...session.active_run_ids, candidate.run_id].sort(),
    }, identity.recordedAt, session.orchestration_revision + 1);
    const nextRun: RunV30 = {
      ...candidate,
      actor_id: identity.actorId,
    };
    return stageApplied({
      tx, identity, payloadHash, session: nextSession, run: nextRun,
      targetType: 'orchestration', targetId: identity.sessionId,
      revisionBefore: session.orchestration_revision,
      revisionAfter: nextSession.orchestration_revision,
      result: { run_id: nextRun.run_id, revision: nextRun.revision },
    });
  });
}

function assertExplicitArtifactInputs(inputRefs: readonly string[], artifacts: ArtifactRegistry): void {
  for (const artifactId of [...new Set(inputRefs)]) {
    const artifact = artifacts.artifacts[artifactId];
    if (!artifact) {
      throw new V3StructuredError(
        'INVALID_ARGUMENT',
        `explicit input Artifact ${artifactId} does not exist in this Session`,
        {
          details: { artifact_id: artifactId, required_status: 'sealed' },
          next_actions: ['select-a-same-session-artifact-id', 'inspect-session-artifacts'],
        },
      );
    }
    if (artifact.status !== 'sealed') {
      throw new V3StructuredError(
        'INVALID_STATE_TRANSITION',
        `explicit input Artifact ${artifactId} is ${artifact.status}; only sealed Artifacts may be consumed`,
        {
          details: { artifact_id: artifactId, current_status: artifact.status, required_status: 'sealed' },
          next_actions: ['seal-the-input-artifact', 'select-a-sealed-same-session-artifact-id'],
        },
      );
    }
  }
}

function republishedConsumerInputs(
  store: SessionStore,
  session: SessionStateV30,
  command: string,
  artifacts: ArtifactRegistry,
): string[] {
  const source = resolveCommandSource(store.projectRoot, command);
  const contractHash = `sha256:${hashCommandContract(source.contract)}`;
  return source.contract.consumes.flatMap((consume, slotIndex) => {
    if (!consume.alias || !consume.role || (!consume.schema && !consume.schema_range)) return [];
    const artifactId = artifacts.aliases[consume.alias];
    if (!artifactId) return [];
    const receipt = exactArtifactRepublishReceipt(store, session.session_id, artifactId, {
      command,
      command_contract_hash: contractHash,
      slot_index: slotIndex,
      slot: {
        kind: consume.kind,
        schema: consume.schema ?? consume.schema_range!,
        role: consume.role,
        alias: consume.alias,
      },
    });
    return receipt ? [artifactId] : [];
  });
}

export function createRunningRunV3(store: SessionStore, input: CreateRunningRunV3Input): V3MutationResult {
  const identity = normalizedIdentity(input);
  const candidate = structuredClone(input.run);
  const payload = {
    operation: input.requestOperation ?? 'run-next', expected_orchestration_revision: input.expectedOrchestrationRevision,
    run: creationPayload(candidate),
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    assertOrchestrationRevision(session, input.expectedOrchestrationRevision);
    assertSessionOperationAllowed(session.status, 'create_run');
    assertSessionOperationAllowed(session.status, 'advance_chain');
    if (candidate.session_id !== identity.sessionId || candidate.revision !== 0 || candidate.status !== 'pending') {
      throw new V3StructuredError('INVALID_ARGUMENT', 'next Run must target the Session with pending status and revision 0');
    }
    if (tx.runExists(candidate.run_id)) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `Run ${candidate.run_id} already exists`, {
        target_type: 'run', target_id: candidate.run_id, next_actions: ['choose-a-new-run-id', 'inspect-existing-run'],
      });
    }
    const stepIndex = session.chain.findIndex(step => step.step_id === candidate.step_id);
    if (stepIndex < 0) {
      throw new V3StructuredError('INVALID_ARGUMENT', `unknown chain step ${candidate.step_id}`);
    }
    assertRunCreationLineage(tx, candidate, session.chain[stepIndex].status);
    assertPredecessorDecisionGateResolved(session, stepIndex);
    // Predecessor publication is enforced for BOTH run-next and run-create
    // (audit H1-①): a manually created Run must not bypass chain ordering /
    // artifact publication authority. stepIndex 0 (no predecessor) returns
    // immediately inside assertNextPredecessorPublished.
    const artifacts = tx.readJson(
      resolve(store.sessionDir(identity.sessionId), session.artifacts_ref),
      artifactRegistrySchema,
    );
    assertExplicitArtifactInputs(candidate.input_refs, artifacts);
    assertNextPredecessorPublished(tx, session, stepIndex, artifacts);
    const republishedInputs = republishedConsumerInputs(store, session, candidate.command, artifacts);
    const nextRun: RunV30 = {
      ...candidate,
      input_refs: [...new Set([...candidate.input_refs, ...republishedInputs])].sort(),
      status: 'running',
      revision: 1,
      actor_id: identity.actorId,
      started_at: identity.recordedAt,
    };
    const chain = session.chain.map((step, index) => index === stepIndex
      ? { ...step, status: 'running' as const, run_ids: [...new Set([...step.run_ids, candidate.run_id])].sort() }
      : step);
    const nextSession = updatedSessionActivity({
      ...session,
      chain,
      active_run_ids: [...session.active_run_ids, candidate.run_id].sort(),
    }, identity.recordedAt, session.orchestration_revision + 1);
    return stageApplied({
      tx, identity, payloadHash, session: nextSession, run: nextRun,
      targetType: 'orchestration', targetId: identity.sessionId,
      revisionBefore: session.orchestration_revision,
      revisionAfter: nextSession.orchestration_revision,
      result: v3BirthPacket(store, nextSession, nextRun, artifacts),
    });
  });
}

/**
 * v3 birth packet — the executor-facing payload emitted by `run next`/`run create`.
 * Mirrors the v2 NextResult essentials (run_dir/upstream/guidance/knowledge/brief)
 * so a v3 executor can execute without an extra round trip; replaying the same
 * request-id returns the identical packet via the persisted receipt.
 */
export interface V3BirthPacket extends V3NextContract {
  run_id: string;
  run_dir: string;
  step_id: string;
  status: RunStatus;
  revision: number;
  /** Immutable execution inputs copied from the canonical Run. */
  task: V3TaskContract;
  /** Consumed artifacts resolved from the Session artifact registry (by id). */
  upstream: Record<string, { artifact_id: string; path: string; kind: string; status: 'sealed' | 'draft' }>;
  /** Command guidance snapshot (prepare/workflow/run-mode hashes); null when no source resolves. */
  guidance: GuidanceSnapshot | null;
  /** Knowledge delta handle; candidates are staged by `run complete`, so this may be empty at birth. */
  knowledge_context: { path: string; revision: number; candidate_count: number } | null;
  brief: { command: string };
  /** Explicit invariant preventing executors from allocating a duplicate Run. */
  run_already_created: true;
}

function v3Sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function buildV3GuidanceSnapshot(store: SessionStore, command: string): GuidanceSnapshot | null {
  const source = resolveCommandSource(store.projectRoot, command);
  const guidance = resolveStepContent(store.projectRoot, command);
  if (!guidance.prepare && !guidance.workflow && !guidance.runMode) return null;
  return guidanceSnapshotSchema.parse({
    schema_version: 'guidance-snapshot/1.0',
    source_path: source.relativePath,
    content_hash: v3Sha256(source.raw),
    resolved_prompt_hash: v3Sha256(source.raw),
    prepare_hash: guidance.prepare ? v3Sha256(guidance.prepare.raw) : null,
    workflow_hash: guidance.workflow ? v3Sha256(guidance.workflow.raw) : null,
    run_mode_hash: guidance.runMode ? v3Sha256(guidance.runMode.raw) : null,
  });
}

export function v3BirthPacket(store: SessionStore, session: SessionStateV30, run: RunV30, artifacts: ArtifactRegistry): V3BirthPacket {
  const upstream: V3BirthPacket['upstream'] = {};
  for (const artifactId of run.input_refs) {
    const artifact = artifacts.artifacts[artifactId];
    if (!artifact) continue;
    upstream[artifactId] = {
      artifact_id: artifactId,
      path: artifact.relative_path,
      kind: artifact.media_type,
      status: artifact.status === 'sealed' ? 'sealed' : 'draft',
    };
  }
  const delta = readRunKnowledgeDelta(store, session.session_id, run.run_id, false);
  const continuation = v3CompleteNext({
    sessionId: session.session_id,
    runId: run.run_id,
    orchestrationRevision: session.orchestration_revision,
    runRevision: run.revision,
    reason: 'Run created - execute and complete it with run complete --advance',
  });
  return {
    run_id: run.run_id,
    run_dir: store.runDir(session.session_id, run.run_id),
    step_id: run.step_id,
    status: run.status,
    revision: run.revision,
    task: v3TaskContractSchema.parse({
      command: run.command,
      args: [...run.args],
      goal: run.goal,
      input_refs: [...run.input_refs],
    }),
    upstream,
    guidance: buildV3GuidanceSnapshot(store, run.command),
    knowledge_context: delta
      ? {
          path: runKnowledgeDeltaPath(store, session.session_id, run.run_id),
          revision: delta.revision,
          candidate_count: delta.candidates.length,
        }
      : null,
    brief: { command: v3BriefCommand(session.session_id, run.run_id) },
    ...continuation,
    run_already_created: true,
  };
}

/**
 * v3 staging adapter: convert report.md frontmatter facts into pending
 * knowledge candidates inside the sealing transaction (mirrors v2
 * stageHandoffKnowledgeCandidates, which requires the v2 handoff shape v3
 * Runs do not carry). Accepted decisions and locked constraints become
 * pending spec candidates with run-scoped evidence; automatic suppression is
 * applied from the reconciliation receipt when provided. Writes the delta at
 * the canonical v2 path so `knowledge review/promote` (summarizeSessionKnowledge)
 * can see v3 candidates.
 */
function stageV3RunKnowledgeCandidates(input: {
  store: SessionStore;
  tx: SessionV30StoreTransaction;
  sessionId: string;
  runId: string;
  frontmatter: ReportFrontmatter;
  reconciliation?: KnowledgeReconciliation | null;
}): RunKnowledgeDelta | null {
  const { store, tx, sessionId, runId, frontmatter } = input;
  const now = new Date().toISOString();
  const delta = readRunKnowledgeDelta(store, sessionId, runId, true);
  const evidence = [`run:${runId}`];
  let staged = false;
  for (const [index, decision] of frontmatter.decisions.entries()) {
    const content = decision.text.trim();
    if (decision.status !== 'accepted' || !content) continue;
    addCandidate(delta, {
      target: 'spec', action: 'propose', title: content.slice(0, 120), content,
      category: 'arch', source_kind: 'decision',
      evidence_refs: [...evidence, `report.md#decision:${index}`],
    }, now);
    staged = true;
  }
  for (const [index, constraint] of frontmatter.constraints.entries()) {
    const content = constraint.text.trim();
    if (constraint.status !== 'locked' || !content) continue;
    addCandidate(delta, {
      target: 'spec', action: 'propose', title: content.slice(0, 120), content,
      category: 'arch', source_kind: 'constraint',
      evidence_refs: [...evidence, `report.md#constraint:${index}`],
    }, now);
    staged = true;
  }
  if (!staged) return null;
  delta.revision++;
  delta.updated_at = now;
  if (input.reconciliation) applyAutomaticKnowledgeSuppression(delta, input.reconciliation);
  tx.writeJson(runKnowledgeDeltaPath(store, sessionId, runId), delta, runKnowledgeDeltaSchema);
  return delta;
}

export function completeRunAndAdvance(
  store: SessionStore,
  input: CompleteRunAndAdvanceInput,
): V3MutationResult {
  const identity = normalizedIdentity(input);
  const runId = required(input.runId, 'run ID');
  const payload = {
    operation: 'run-complete-and-seal', run_id: runId,
    expected_run_revision: input.expectedRunRevision,
    expected_orchestration_revision: input.expectedOrchestrationRevision,
    summary: input.summary ?? null,
    verdict: input.verdict,
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    const run = readRunOrThrow(tx, runId);
    assertRunRevision(run, input.expectedRunRevision);
    assertOrchestrationRevision(session, input.expectedOrchestrationRevision);
    assertSessionRunTransitionAllowed(session.status, run.status, 'completed');
    const stepIndex = session.chain.findIndex(step => step.step_id === run.step_id);
    if (stepIndex < 0) throw new V3StructuredError('INVALID_ARGUMENT', `Run ${runId} references unknown step ${run.step_id}`);

    const runDir = store.runDir(identity.sessionId, runId);

    // ── report.md frontmatter summary fallback ─────────────────────────────
    const frontmatter = readReportFrontmatter(runDir);
    const summary = input.summary !== undefined && input.summary !== null && input.summary.trim() !== ''
      ? input.summary
      : frontmatter.summary;

    const publication = prepareArtifactPublication({
      store, tx, session, run, strict: true,
    });
    const artifactIds = publication.authority.artifact_ids;
    const primaryArtifactId = publication.authority.primary_artifact_id;

    const completedStepIndex = session.chain.findIndex(step => step.step_id === run.step_id);
    if (completedStepIndex < 0) {
      throw new V3StructuredError('INVALID_ARGUMENT', `Run ${runId} references unknown step ${run.step_id}`);
    }
    const nextPendingIndex = session.chain.findIndex((step, index) => (
      index > completedStepIndex && step.status === 'pending'
    ));
    const chain = session.chain.map((step, index) => (
      index === completedStepIndex ? { ...step, status: 'completed' as const } : step
    ));
    const completed = transitionRun(run, 'completed');
    const nextRun: RunV30 = {
      ...transitionRun(completed, 'sealed'),
      revision: run.revision + 1,
      actor_id: identity.actorId,
      output_refs: artifactIds,
      primary_artifact_id: primaryArtifactId,
      verdict: input.verdict,
      summary: required(summary, 'summary'),
      ended_at: identity.recordedAt,
      sealed_at: identity.recordedAt,
    };
    const nextSession = updatedSessionActivity({
      ...session,
      chain,
      active_run_ids: session.active_run_ids.filter(id => id !== runId),
    }, identity.recordedAt, session.orchestration_revision + 1);

    // ── knowledge staging + reconciliation receipt (atomic with the seal) ──
    const frontmatterCandidates = reportKnowledgeCandidateDrafts(frontmatter, runId);
    let knowledgeReceipt: KnowledgeReconciliation | null = null;
    const knowledgeConcerns: string[] = [];
    try {
      const corpusFingerprint = currentKnowledgeCorpusFingerprint(store.projectRoot);
      const persisted = readKnowledgeReconciliation(store, identity.sessionId, runId, true);
      const supplied = input.knowledgeReconciliation;
      const freshReceipt = [persisted, supplied].find(receipt => receipt && isKnowledgeReconciliationFresh(
        store.projectRoot,
        identity.sessionId,
        runId,
        receipt,
        frontmatter,
        corpusFingerprint,
      )) ?? null;
      knowledgeReceipt = freshReceipt
        ?? reconcileRunKnowledgeSync(store.projectRoot, identity.sessionId, runId, frontmatter);
      if (!isKnowledgeReconciliationFresh(
        store.projectRoot,
        identity.sessionId,
        runId,
        knowledgeReceipt,
        frontmatter,
        corpusFingerprint,
      )) {
        throw new Error('reconciliation changed while completing the Run');
      }
    } catch (error) {
      if (frontmatterCandidates.length > 0) {
        throw new V3StructuredError(
          'INVALID_STATE_TRANSITION',
          `Run ${runId} has candidate-bearing report frontmatter that cannot be reconciled`,
          {
            details: { cause: error instanceof Error ? error.message : String(error) },
            next_actions: [`maestro knowledge review ${identity.sessionId} --refresh`],
          },
        );
      }
      knowledgeReceipt = null;
      knowledgeConcerns.push(
        `knowledge reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (knowledgeReceipt) {
      stageV3RunKnowledgeCandidates({
        store, tx, sessionId: identity.sessionId, runId, frontmatter,
        reconciliation: knowledgeReceipt,
      });
      tx.writeJson(
        reconciliationPath(store, identity.sessionId, runId),
        knowledgeReceipt,
        knowledgeReconciliationSchema,
      );
    }

    const completedStep = chain[completedStepIndex];
    const gateDecisionId = completedStep.decision_ref;
    const gateDecision = gateDecisionId === null
      ? null
      : nextSession.decisions.find(decision => decision.decision_id === gateDecisionId) ?? null;
    const gateUnresolved = gateDecisionId !== null
      && (gateDecision === null || gateDecision.status === 'open' || gateDecision.status === 'escalated');
    const continuation = gateUnresolved
      ? v3DecideNext({
        sessionId: identity.sessionId,
        pointId: gateDecisionId,
        orchestrationRevision: nextSession.orchestration_revision,
        reason: `Run sealed; decide post-step gate ${gateDecisionId} before continuing`,
      })
      : nextPendingIndex >= 0
        ? v3RunNext({
          sessionId: identity.sessionId,
          orchestrationRevision: nextSession.orchestration_revision,
          reason: 'Run sealed; explicit run next may allocate the next chain Run',
        })
        : v3SessionCompleteNext({
          sessionId: identity.sessionId,
          orchestrationRevision: nextSession.orchestration_revision,
          reason: 'Run sealed; no pending chain step remains, so complete the Session',
        });
    return stageApplied({
      tx, identity, payloadHash, session: nextSession, run: nextRun,
      targetType: 'orchestration', targetId: identity.sessionId,
      revisionBefore: session.orchestration_revision,
      revisionAfter: nextSession.orchestration_revision,
      result: {
        operation: 'run-complete-and-seal',
        run_id: runId,
        run_revision: nextRun.revision,
        status: nextRun.status,
        orchestration_revision: nextSession.orchestration_revision,
        artifact_publication: publication.authority,
        output_warnings: publication.warnings,
        next_step_id: nextPendingIndex >= 0 ? chain[nextPendingIndex].step_id : null,
        ...continuation,
        ...(knowledgeReceipt
          ? { knowledge_reconciliation: reconciliationSummary(knowledgeReceipt) }
          : {}),
        ...(knowledgeConcerns.length > 0 ? { concerns: knowledgeConcerns } : {}),
      },
    });
  });
}

export function republishArtifactV3(
  store: SessionStore,
  input: RepublishArtifactV3Input,
): V3MutationResult {
  const identity = normalizedIdentity(input);
  const artifactIdInput = required(input.artifactId, 'Artifact ID');
  const payload = {
    operation: 'artifact-republish',
    artifact_id: artifactIdInput,
    consumer_command: required(input.consumerCommand, 'consumer command'),
    alias: required(input.alias, 'consumer alias'),
    assessment_hash: required(input.assessmentHash, 'assessment hash'),
    expected_artifact_revision: input.expectedArtifactRevision,
    expected_session_revision: input.expectedSessionRevision,
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    assertOrchestrationRevision(session, input.expectedSessionRevision);
    if (session.status !== 'open') {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `Session ${session.session_id} is ${session.status}; artifact republish requires open`);
    }
    const artifactsPath = resolve(store.sessionDir(identity.sessionId), session.artifacts_ref);
    const artifacts = tx.readJson(artifactsPath, artifactRegistrySchema);
    assertRevision(input.expectedArtifactRevision, 'expected Artifact registry revision');
    if (artifacts.revision !== input.expectedArtifactRevision) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', 'Artifact registry revision conflict', {
        details: { expected_revision: input.expectedArtifactRevision, current_revision: artifacts.revision },
        target_type: 'artifact', target_id: artifactIdInput,
        next_actions: ['inspect-artifact-compatibility', 'resubmit-with-new-request-id'],
      });
    }
    const preparedOptions: PrepareArtifactRepublishOptions = {
      sessionId: identity.sessionId,
      artifactId: artifactIdInput,
      consumerCommand: input.consumerCommand,
      alias: input.alias,
      assessmentHash: input.assessmentHash,
      requestId: identity.requestId,
      expectedArtifactRevision: input.expectedArtifactRevision,
      expectedSessionRevision: input.expectedSessionRevision,
      participantId: identity.actorId,
      actorId: identity.actorId,
      reason: identity.reason,
      evidenceRefs: identity.evidenceRefs,
      recordedAt: identity.recordedAt,
    };
    const prepared = prepareArtifactRepublish(store.projectRoot, preparedOptions, store);
    const consumerIndexes = session.chain
      .map((step, index) => ({ step, index }))
      .filter(item => item.step.command === input.consumerCommand && item.step.status === 'pending');
    if (consumerIndexes.length !== 1 || consumerIndexes[0].step.run_ids.length !== 0) {
      throw new V3StructuredError(
        'INVALID_STATE_TRANSITION',
        'artifact republish requires one pending consumer step with no allocated Run',
      );
    }
    if (consumerIndexes[0].step.run_ids.some(runId => session.active_run_ids.includes(runId))) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', 'artifact republish cannot target an active consumer Run');
    }
    if (artifacts.artifacts[prepared.artifactId]) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `derived Artifact already exists: ${prepared.artifactId}`);
    }
    artifacts.artifacts[prepared.artifactId] = prepared.artifact;
    artifacts.aliases[input.alias] = prepared.artifactId;
    artifacts.revision++;
    const compatibilityRun: RunV30 = {
      schema_version: 'run/3.0',
      run_id: prepared.compatibilityRunId,
      session_id: identity.sessionId,
      step_id: prepared.compatibilityStepId,
      parent_run_id: prepared.sourceArtifact.producer_run_id,
      retry_of_run_id: null,
      attempt: 1,
      command: 'artifact-compatibility-republish',
      args: [prepared.assessment.assessment_hash],
      goal: null,
      status: 'sealed',
      revision: 1,
      actor_id: identity.actorId,
      input_refs: [artifactIdInput],
      output_refs: [prepared.artifactId],
      primary_artifact_id: prepared.artifact.role === 'primary' ? prepared.artifactId : null,
      verdict: 'done',
      summary: `Republished ${artifactIdInput} for ${input.consumerCommand}:${input.alias}`,
      legacy_execution_generation: null,
      created_at: identity.recordedAt,
      started_at: identity.recordedAt,
      ended_at: identity.recordedAt,
      sealed_at: identity.recordedAt,
    };
    if (tx.runExists(compatibilityRun.run_id)) {
      throw new V3StructuredError('INVALID_STATE_TRANSITION', `compatibility Run already exists: ${compatibilityRun.run_id}`);
    }
    const chain = [...session.chain];
    chain.splice(consumerIndexes[0].index, 0, {
      step_id: prepared.compatibilityStepId,
      command: 'artifact-compatibility-republish',
      args: [prepared.assessment.assessment_hash],
      status: 'completed',
      run_ids: [prepared.compatibilityRunId],
      goal_ref: null,
      decision_ref: null,
      decision_refs: [prepared.compatibilityRunId],
    });
    const nextSession = updatedSessionActivity(
      { ...session, chain }, identity.recordedAt, session.orchestration_revision + 1,
    );
    const receipt = createArtifactRepublishReceipt({
      receipt_id: prepared.compatibilityRunId,
      request_id: identity.requestId,
      session_id: identity.sessionId,
      assessment_hash: prepared.assessment.assessment_hash,
      source_artifact_id: artifactIdInput,
      source_artifact_hash: prepared.assessment.source.artifact_hash,
      artifact_id: prepared.artifactId,
      artifact_hash: `sha256:${prepared.artifact.content_hash}`,
      artifact_path: prepared.artifactPath,
      derived_from: [artifactIdInput],
      consumer: prepared.assessment.consumer,
      transformed_metadata: {
        role: { from: prepared.assessment.source.raw_slot.role, to: prepared.assessment.consumer.slot.role },
        alias: { from: prepared.assessment.source.raw_slot.alias, to: prepared.assessment.consumer.slot.alias },
      },
      compatibility_run_id: prepared.compatibilityRunId,
      compatibility_step_id: prepared.compatibilityStepId,
      artifact_registry_revision_before: input.expectedArtifactRevision,
      artifact_registry_revision_after: artifacts.revision,
      session_revision_before: input.expectedSessionRevision,
      session_revision_after: nextSession.orchestration_revision,
      actor_id: identity.actorId,
      participant_id: identity.actorId,
      reason: identity.reason,
      evidence_refs: identity.evidenceRefs,
      recorded_at: identity.recordedAt,
    });
    tx.writeRaw(resolve(store.sessionDir(identity.sessionId), prepared.artifactPath), prepared.content, 0o600);
    tx.writeJson(artifactsPath, artifacts, artifactRegistrySchema);
    tx.writeArtifactRepublishReceipt(receipt);
    return stageApplied({
      tx,
      identity,
      payloadHash,
      session: nextSession,
      run: compatibilityRun,
      targetType: 'artifact',
      targetId: prepared.artifactId,
      revisionBefore: input.expectedArtifactRevision,
      revisionAfter: artifacts.revision,
      result: {
        operation: 'artifact-republish',
        source_artifact_id: artifactIdInput,
        artifact_id: prepared.artifactId,
        compatibility_run_id: prepared.compatibilityRunId,
        compatibility_step_id: prepared.compatibilityStepId,
        assessment_hash: prepared.assessment.assessment_hash,
        artifact_registry_revision: artifacts.revision,
        session_revision: nextSession.orchestration_revision,
        receipt,
      },
    });
  });
}

export function completeSessionV3(store: SessionStore, input: CompleteSessionV3Input): V3MutationResult {
  const identity = normalizedIdentity(input);
  const payload = {
    operation: 'session-complete', expected_orchestration_revision: input.expectedOrchestrationRevision,
    ...auditPayload(identity),
  };
  const payloadHash = canonicalPayloadHash(payload);
  return store.withV30Transaction(identity.sessionId, tx => {
    const replayed = replay(tx, identity, payloadHash);
    if (replayed) return replayed;
    const session = tx.readSession();
    assertOrchestrationRevision(session, input.expectedOrchestrationRevision);
    const referencedRunIds = [...new Set([
      ...session.active_run_ids,
      ...session.chain.flatMap(step => step.run_ids),
    ])].sort();
    const runs = referencedRunIds.map(runId => tx.readRun(runId));
    // Decision gates: every chain step that declares decision_ref. A missing
    // decision record counts as open (declared but never decided). Escalated
    // gates pass completion but are surfaced in result.concerns. The legacy
    // gates.json registry is retired from v3 authority (snapshot-only);
    // completion blockers no longer consult it.
    const decisionGates = session.chain
      .filter(step => step.decision_ref !== null)
      .map(step => ({
        gateId: step.decision_ref!,
        status: session.decisions.find(decision => decision.decision_id === step.decision_ref)?.status ?? 'open',
      }));
    const completion: SessionCompletionSnapshot = {
      runs: runs.map(run => ({ runId: run.run_id, status: run.status })),
      blockingGates: [],
      requiredSteps: session.chain.map(step => ({
        stepId: step.step_id,
        status: step.status,
        skipEvidence: step.status === 'skipped' ? step.decision_refs : undefined,
      })),
      decisionGates,
    };
    assertSessionCanComplete(completion);
    const escalatedGates = decisionGates.filter(gate => gate.status === 'escalated');
    const transitioned = transitionSession(session, 'completed', completion);
    const nextSession = updatedSessionActivity({
      ...transitioned,
      completed_at: identity.recordedAt,
      active_run_ids: [],
    }, identity.recordedAt, session.orchestration_revision + 1);
    return stageApplied({
      tx, identity, payloadHash, session: nextSession,
      targetType: 'orchestration', targetId: identity.sessionId,
      revisionBefore: session.orchestration_revision,
      revisionAfter: nextSession.orchestration_revision,
      result: {
        status: nextSession.status,
        orchestration_revision: nextSession.orchestration_revision,
        ...(escalatedGates.length > 0
          ? { concerns: escalatedGates.map(gate => `decision gate ${gate.gateId} is escalated and remains open for review`) }
          : {}),
      },
    });
  });
}
