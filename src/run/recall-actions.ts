import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { hashDirectory, hashFile } from './artifacts.js';
import { canonicalWorkspaceId, createIntentIdentity } from './intent-identity.js';
import { recallActionRequestHash, type RecallActionRequest } from './recall-confirmation.js';
import { hashRecallConfirmationToken, RecallConfirmationError } from './recall-confirmation-store.js';
import {
  importManifestSchema,
  recallConfirmationTargetIdentitySchema,
  type ImportManifest,
  type RecallConfirmationRecord,
  type RecallConfirmationTargetIdentity,
  type ValidatedRecallSource,
} from './protocol-schemas.js';
import { createRun } from './runtime.js';
import { SessionStore } from './store.js';

export interface ExecuteRecallActionInput extends RecallActionRequest { confirmation_token: string; }
export interface ExecuteRecallActionOptions {
  now?: Date;
  reservationTtlMs?: number;
  afterClaim?: () => void;
  afterArtifactCopy?: (index: number) => void;
  afterCreate?: () => void;
}
export interface RecallActionResult {
  action: 'fork' | 'import' | 'new';
  session_id: string;
  run_id: string;
  run_dir: string;
  import_manifest: ImportManifest | null;
  replayed: boolean;
  reservation_id: string;
}

interface StagedImport {
  source_kind: string;
  source_path: string;
  source_hash: string;
  staged_path: string;
  size: number;
  is_directory: boolean;
}

function transientLockRace(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
    && (error instanceof Error && error.message.includes('.session-store.lock'));
}

function retryLock<T>(operation: () => T): T {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return operation(); }
    catch (error) {
      if (!transientLockRace(error) || attempt === 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8 * (attempt + 1));
    }
  }
  throw new Error('unreachable SessionStore lock retry state');
}

function hashPath(path: string): { hash: string; size: number; isDirectory: boolean } {
  const stat = statSync(path);
  const value = stat.isDirectory() ? hashDirectory(path) : hashFile(path);
  return { hash: `sha256:${value.hash}`, size: value.size, isDirectory: stat.isDirectory() };
}

function replayResult(outcome: Record<string, unknown>): RecallActionResult {
  return {
    action: outcome.action as RecallActionResult['action'],
    session_id: String(outcome.session_id),
    run_id: String(outcome.run_id),
    run_dir: String(outcome.run_dir),
    import_manifest: outcome.import_manifest ? importManifestSchema.parse(outcome.import_manifest) : null,
    replayed: true,
    reservation_id: String(outcome.reservation_id),
  };
}

function validatedSourceOrThrow(
  store: SessionStore,
  action: RecallActionResult['action'],
  sourceFence: RecallConfirmationRecord['source_fence'],
): ValidatedRecallSource | null {
  return retryLock(() => store.validateRecallConfirmationSource(action, sourceFence));
}

function copyValidatedArtifactsToStaging(
  store: SessionStore,
  targetSessionId: string,
  source: ValidatedRecallSource,
  options: ExecuteRecallActionOptions,
): StagedImport[] {
  const stagingRoot = join(store.sessionDir(targetSessionId), '.recall-import-staging');
  mkdirSync(stagingRoot, { recursive: true });
  return source.fence.selected_artifacts.map((artifact, index) => {
    const sourcePath = join(source.source_project_root, '.workflow', 'sessions', source.session_id, artifact.relative_path);
    const live = hashPath(sourcePath);
    if (live.hash !== artifact.content_hash) {
      throw new RecallConfirmationError('FENCE_CONFLICT', `validated source artifact bytes changed: ${artifact.relative_path}`);
    }
    const stagedPath = join(stagingRoot, `${String(index).padStart(4, '0')}-${basename(artifact.relative_path)}`);
    cpSync(sourcePath, stagedPath, { recursive: true });
    const copied = hashPath(stagedPath);
    if (copied.hash !== live.hash) {
      throw new RecallConfirmationError('FENCE_CONFLICT', `copied artifact hash mismatch: ${artifact.relative_path}`);
    }
    options.afterArtifactCopy?.(index);
    return {
      source_kind: artifact.kind,
      source_path: artifact.relative_path,
      source_hash: copied.hash,
      staged_path: stagedPath,
      size: copied.size,
      is_directory: copied.isDirectory,
    };
  });
}

function materializeImport(
  store: SessionStore,
  created: { session_id: string; run_id: string },
  source: ValidatedRecallSource,
  staged: StagedImport[],
): ImportManifest {
  const artifacts = staged.map(item => {
    const targetRel = `runs/${created.run_id}/outputs/imported/${item.source_kind}-${randomUUID()}`;
    const targetPath = join(store.sessionDir(created.session_id), targetRel);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(item.staged_path, targetPath, { recursive: true });
    const finalHash = hashPath(targetPath);
    if (finalHash.hash !== item.source_hash) {
      throw new RecallConfirmationError('FENCE_CONFLICT', `final imported artifact hash mismatch: ${item.source_path}`);
    }
    return {
      source_kind: item.source_kind,
      source_path: item.source_path,
      source_hash: finalHash.hash,
      target_artifact_id: `ART-${randomUUID()}`,
      target_path: targetRel,
      size: finalHash.size,
      is_directory: finalHash.isDirectory,
    };
  });
  retryLock(() => store.update(created.session_id, draft => {
    for (const item of artifacts) {
      draft.artifacts.artifacts[item.target_artifact_id] = {
        kind: item.source_kind,
        role: 'attachment',
        producer_run_id: created.run_id,
        relative_path: item.target_path,
        media_type: item.is_directory ? 'application/vnd.maestro.directory' : 'application/octet-stream',
        schema_version: `${item.source_kind}/1.0`,
        content_hash: item.source_hash.replace(/^sha256:/, ''),
        size: item.size,
        status: 'sealed',
        derived_from: [],
        replaces: null,
      };
    }
    draft.artifacts.revision++;
  }));
  rmSync(join(store.sessionDir(created.session_id), '.recall-import-staging'), { recursive: true, force: true });
  return importManifestSchema.parse({
    schema_version: 'import-manifest/1.0',
    source: { workspace_id: source.workspace_id, session_id: source.session_id, run_id: source.run_id },
    target: { workspace_id: canonicalWorkspaceId(store.projectRoot), session_id: created.session_id, run_id: created.run_id },
    artifacts: artifacts.map(({ size: _size, is_directory: _directory, ...artifact }) => artifact),
    created_at: new Date().toISOString(),
  });
}

function reconstructImportManifest(
  store: SessionStore,
  sessionId: string,
  runId: string,
  source: ValidatedRecallSource,
): ImportManifest {
  const bundle = retryLock(() => store.readBundle(sessionId));
  const available = Object.entries(bundle.artifacts.artifacts)
    .filter(([, artifact]) => artifact.producer_run_id === runId && artifact.status === 'sealed');
  const used = new Set<string>();
  const artifacts = source.fence.selected_artifacts.map(sourceArtifact => {
    const match = available.find(([id, artifact]) => !used.has(id)
      && artifact.kind === sourceArtifact.kind
      && `sha256:${artifact.content_hash}` === sourceArtifact.content_hash);
    if (!match) throw new RecallConfirmationError('FENCE_CONFLICT', `completed import is missing artifact ${sourceArtifact.relative_path}`);
    used.add(match[0]);
    return {
      source_kind: sourceArtifact.kind,
      source_path: sourceArtifact.relative_path,
      source_hash: `sha256:${match[1].content_hash}`,
      target_artifact_id: match[0],
      target_path: match[1].relative_path,
    };
  });
  return importManifestSchema.parse({
    schema_version: 'import-manifest/1.0',
    source: { workspace_id: source.workspace_id, session_id: source.session_id, run_id: source.run_id },
    target: { workspace_id: canonicalWorkspaceId(store.projectRoot), session_id: sessionId, run_id: runId },
    artifacts,
    created_at: retryLock(() => store.readRun(sessionId, runId)).started_at,
  });
}

function finalizeExistingTarget(
  store: SessionStore,
  reservationId: string,
  action: RecallActionResult['action'],
  requestHash: string,
  proposedTarget: RecallConfirmationTargetIdentity,
  sourceFence: RecallConfirmationRecord['source_fence'],
): RecallActionResult {
  const bundle = retryLock(() => store.readBundle(proposedTarget.session_id));
  const runId = bundle.session.active_run_id;
  if (!runId) throw new RecallConfirmationError('FENCE_CONFLICT', 'completed target has no active Run to finalize');
  const validatedSource = validatedSourceOrThrow(store, action, sourceFence);
  const manifest = action === 'import'
    ? reconstructImportManifest(store, proposedTarget.session_id, runId, validatedSource!)
    : null;
  const result: RecallActionResult = {
    action,
    session_id: proposedTarget.session_id,
    run_id: runId,
    run_dir: relative(store.projectRoot, store.runDir(proposedTarget.session_id, runId)).replaceAll('\\', '/'),
    import_manifest: manifest,
    replayed: false,
    reservation_id: reservationId,
  };
  const target = { ...proposedTarget, run_id: runId };
  const targetHash = retryLock(() => store.readRecallTargetHash(target));
  const finalized = retryLock(() => store.finalizeRecallConfirmation(reservationId, {
    action,
    request_hash: requestHash,
    target,
    target_hash: targetHash,
    outcome: { ...result },
  }));
  return finalized.replayed ? replayResult(finalized.outcome.outcome) : result;
}

function reconcileStale(
  store: SessionStore,
  reservationId: string,
  action: RecallActionResult['action'],
  requestHash: string,
  proposedTarget: RecallConfirmationTargetIdentity,
  sourceFence: RecallConfirmationRecord['source_fence'],
  options: ExecuteRecallActionOptions,
): RecallActionResult | null {
  const observed = retryLock(() => store.observeRecallConfirmationReservation(reservationId, options.now));
  const reconciliation = retryLock(() => store.reconcileExpiredRecallConfirmation(reservationId, observed, options.now));
  if (reconciliation.decision === 'conflict') {
    throw new RecallConfirmationError('FENCE_CONFLICT', reconciliation.reason);
  }
  if (reconciliation.decision === 'resume_finalize') {
    return finalizeExistingTarget(store, reservationId, action, requestHash, proposedTarget, sourceFence);
  }
  if (reconciliation.observed.marker.state === 'matching' && reconciliation.observed.target.state === 'partial') {
    rmSync(store.sessionDir(proposedTarget.session_id), { recursive: true, force: true });
  }
  const cleared = retryLock(() => store.observeRecallConfirmationReservation(reservationId, options.now));
  retryLock(() => store.completeRecallConfirmationRollback(reservationId, cleared));
  return null;
}

function settleFailure(
  store: SessionStore,
  reservationId: string,
  action: RecallActionResult['action'],
  requestHash: string,
  proposedTarget: RecallConfirmationTargetIdentity,
  sourceFence: RecallConfirmationRecord['source_fence'],
  options: ExecuteRecallActionOptions,
): void {
  const cancelled = retryLock(() => store.cancelRecallConfirmation(reservationId, options.now));
  if (cancelled.released) return;
  try { reconcileStale(store, reservationId, action, requestHash, proposedTarget, sourceFence, options); }
  catch { /* conflict or completed target remains fenced for the next retry */ }
}

function executeRecallActionOnce(
  projectRoot: string,
  input: ExecuteRecallActionInput,
  options: ExecuteRecallActionOptions,
): RecallActionResult {
  if (!['fork', 'import', 'new'].includes(input.action)) throw new Error(`unsupported confirmed action: ${input.action}`);
  const action = input.action as RecallActionResult['action'];
  const store = new SessionStore(projectRoot);
  const requestHash = recallActionRequestHash(input);
  const record = retryLock(() => store.readRecallConfirmation(input.confirmation_token));
  if (!record) throw new RecallConfirmationError('TOKEN_INVALID', 'confirmation token not found');
  const intentIdentity = createIntentIdentity(projectRoot, input.command, input.intent);
  const proposedTarget = recallConfirmationTargetIdentitySchema.parse({
    workspace_id: canonicalWorkspaceId(projectRoot),
    session_id: input.target_session_id,
    intent_identity: intentIdentity,
  });
  let reservation = retryLock(() => store.reserveRecallConfirmation(input.confirmation_token, {
    action,
    request_hash: requestHash,
    source_fence: record.source_fence,
    target_fence: record.target_fence,
    proposed_target: proposedTarget,
    now: options.now,
    reservation_ttl_ms: options.reservationTtlMs,
  }));
  if (reservation.status === 'replayed') return replayResult(reservation.outcome.outcome);
  if (reservation.status === 'stale') {
    const recovered = reconcileStale(store, reservation.reservation_id, action, requestHash, proposedTarget, record.source_fence, options);
    if (recovered) return recovered;
    reservation = retryLock(() => store.reserveRecallConfirmation(input.confirmation_token, {
      action, request_hash: requestHash, source_fence: record.source_fence,
      target_fence: record.target_fence, proposed_target: proposedTarget,
      now: options.now, reservation_ttl_ms: options.reservationTtlMs,
    }));
    if (reservation.status !== 'reserved') throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation did not recover to reserved');
  }
  const reservationId = reservation.reservation_id;
  try {
    retryLock(() => store.claimRecallConfirmationTarget(reservationId, options.now));
    options.afterClaim?.();
    const validatedSource = reservation.validated_source;
    if (action === 'import' && !validatedSource) throw new RecallConfirmationError('FENCE_CONFLICT', 'import requires a validated source');
    const staged = action === 'import'
      ? copyValidatedArtifactsToStaging(store, input.target_session_id, validatedSource!, options)
      : [];
    const sourceFence = validatedSource?.fence ?? null;
    const provenance = sourceFence
      ? {
          source: action as 'fork' | 'import',
          forked_from: action === 'fork' ? sourceFence : null,
          imported_from: action === 'import' ? [sourceFence] : [],
          created_by: 'run-recall-confirmation',
        }
      : { source: 'native' as const, forked_from: null, imported_from: [], created_by: 'run-recall-confirmation' };
    const created = retryLock(() => createRun({
      projectRoot,
      command: input.command,
      sessionId: input.target_session_id,
      intent: input.intent,
      args: input.args ?? [],
      intentIdentity,
      sessionProvenance: provenance,
      creation: {
        requestId: null,
        mode: action === 'new' ? 'explicit-create' : action,
        authority: 'confirmation-token',
        confirmationTokenHash: hashRecallConfirmationToken(input.confirmation_token),
        provenance: {
          schema_version: 'creation-provenance/1.0',
          provenance: action === 'fork' ? 'fork' : action === 'import' ? 'import' : 'native-v2',
          source_workspace_id: sourceFence?.workspace_id ?? null,
          source_session_id: sourceFence?.session_id ?? null,
          source_run_id: sourceFence?.run_id ?? null,
          imported_artifact_hashes: action === 'import'
            ? staged.map(item => item.source_hash)
            : [],
        },
      },
    }));
    const manifest = action === 'import'
      ? materializeImport(store, created, validatedSource!, staged)
      : null;
    options.afterCreate?.();
    retryLock(() => store.validateRecallConfirmationSource(action, record.source_fence));
    const result: RecallActionResult = {
      action,
      session_id: created.session_id,
      run_id: created.run_id,
      run_dir: created.run_dir,
      import_manifest: manifest,
      replayed: false,
      reservation_id: reservationId,
    };
    const target = { ...proposedTarget, run_id: created.run_id };
    const targetHash = retryLock(() => store.readRecallTargetHash(target));
    const finalized = retryLock(() => store.finalizeRecallConfirmation(reservationId, {
      action,
      request_hash: requestHash,
      target,
      target_hash: targetHash,
      outcome: { ...result },
      now: options.now,
    }));
    return finalized.replayed ? replayResult(finalized.outcome.outcome) : result;
  } catch (error) {
    try { settleFailure(store, reservationId, action, requestHash, proposedTarget, record.source_fence, options); }
    catch { /* foreign, winner or complete targets remain fenced */ }
    throw error;
  }
}

export function executeRecallAction(
  projectRoot: string,
  input: ExecuteRecallActionInput,
  options: ExecuteRecallActionOptions = {},
): RecallActionResult {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return executeRecallActionOnce(projectRoot, input, options); }
    catch (error) {
      if (!transientLockRace(error) || attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
    }
  }
  throw new Error('unreachable recall action retry state');
}
