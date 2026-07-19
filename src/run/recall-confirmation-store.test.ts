import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createIntentIdentity } from './intent-identity.js';
import { buildSourceFence } from './recall.js';
import { completeRun, createRun, sealSession } from './runtime.js';
import {
  recallConfirmationOutcomeSchema,
  recallConfirmationReservationSchema,
  recallConfirmationTargetIdentitySchema,
  recallReservationMarkerSchema,
  recallReservationObservationSchema,
  recallReservationReconciliationSchema,
  staleRecallReservationSchema,
  validatedRecallSourceSchema,
  type RecallConfirmationRecord,
  type RecallConfirmationTargetIdentity,
} from './protocol-schemas.js';
import { RecallConfirmationError } from './recall-confirmation-store.js';
import { SessionStore } from './store.js';

const requestHash = `sha256:${'a'.repeat(64)}`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-confirmation-reservation-'));
  roots.push(value);
  return value;
}

function target(projectRoot: string, sessionId = 'target'): RecallConfirmationTargetIdentity {
  const intentIdentity = createIntentIdentity(projectRoot, 'demo', 'reserved target');
  return recallConfirmationTargetIdentitySchema.parse({
    workspace_id: intentIdentity.workspace_id,
    session_id: sessionId,
    intent_identity: intentIdentity,
  });
}

function targetFence(proposed: RecallConfirmationTargetIdentity): RecallConfirmationRecord['target_fence'] {
  return {
    workspace_id: proposed.workspace_id,
    session_id: proposed.session_id,
    must_not_exist: true,
    status: null,
    identity_revision: null,
    activity_revision: null,
    active_run_id: null,
    artifact_registry_revision: null,
  };
}

function issue(store: SessionStore, proposed: RecallConfirmationTargetIdentity, now = new Date('2026-07-19T00:00:00.000Z')) {
  return store.issueRecallConfirmation({
    action: 'new',
    request_hash: requestHash,
    source_fence: null,
    target_fence: targetFence(proposed),
    target_session_id: proposed.session_id,
    now,
  });
}

function reservationInput(proposed: RecallConfirmationTargetIdentity, now = new Date('2026-07-19T00:01:00.000Z')) {
  return {
    action: 'new' as const,
    request_hash: requestHash,
    source_fence: null,
    target_fence: targetFence(proposed),
    proposed_target: proposed,
    now,
  };
}

function writeCommand(projectRoot: string): void {
  const commandDir = join(projectRoot, '.claude', 'commands');
  mkdirSync(commandDir, { recursive: true });
  writeFileSync(join(commandDir, 'demo.md'), '---\nsession-mode: run\n---\n# Demo\n');
}

function sealedSource(projectRoot: string, linkName: string | null) {
  writeCommand(projectRoot);
  const created = createRun({ projectRoot, command: 'demo', sessionId: 'source', intent: 'sealed source' });
  expect(completeRun(projectRoot, created.run_id, created.session_id).sealed).toBe(true);
  sealSession(projectRoot, created.session_id, 'sealed source');
  return buildSourceFence(projectRoot, created.session_id, created.run_id, linkName);
}

function writeLinkedConfig(projectRoot: string, name: string, linkedRoot: string): void {
  mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
  writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
    workspaces: { linked: [{ name, path: linkedRoot, share: ['session'] }] },
  }, null, 2));
}

describe('atomic recall confirmation reservations', () => {
  it('reserves, finalizes and durably replays the same completed request', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);

    const reserved = store.reserveRecallConfirmation(issued.token, reservationInput(proposed));
    expect(reserved.status).toBe('reserved');
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    expect(recallConfirmationReservationSchema.parse(reserved.record.reservation).reservation_id)
      .toBe(reserved.reservation_id);

    const registryText = readFileSync(join(projectRoot, '.workflow', 'sessions', 'recall-confirmations.json'), 'utf8');
    expect(registryText).not.toContain(issued.token);
    expect(registryText).toContain(issued.record.token_hash);

    store.createSession(proposed.session_id, 'reserved target', {
      command: 'demo',
      intentIdentity: proposed.intent_identity,
      ifExists: 'error',
    });
    const finalTarget = { ...proposed, run_id: null };
    const targetHash = store.readRecallTargetHash(finalTarget);
    const completion = {
      action: 'new' as const,
      request_hash: requestHash,
      target: finalTarget,
      target_hash: targetHash,
      outcome: { action: 'new', session_id: proposed.session_id, run_id: null },
      now: new Date('2026-07-19T00:02:00.000Z'),
    };
    const finalized = store.finalizeRecallConfirmation(reserved.reservation_id, completion);
    expect(finalized.replayed).toBe(false);
    expect(recallConfirmationOutcomeSchema.parse(finalized.outcome).target_hash).toBe(targetHash);

    expect(store.finalizeRecallConfirmation(reserved.reservation_id, completion).replayed).toBe(true);
    const replay = store.reserveRecallConfirmation(
      issued.token,
      reservationInput(proposed, new Date('2026-07-20T00:00:00.000Z')),
    );
    expect(replay.status).toBe('replayed');
    if (replay.status === 'replayed') expect(replay.outcome.outcome).toEqual(completion.outcome);
    const driftedTarget = {
      ...proposed,
      intent_identity: createIntentIdentity(projectRoot, 'demo', 'different target'),
    };
    expect(() => store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), proposed_target: driftedTarget,
    })).toThrow(/completed confirmation target identity mismatch/);
  });

  it('allows only one active reservation across two Store instances', async () => {
    const projectRoot = root();
    const firstStore = new SessionStore(projectRoot);
    const secondStore = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(firstStore, proposed);
    const input = reservationInput(proposed);

    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => firstStore.reserveRecallConfirmation(issued.token, input)),
      Promise.resolve().then(() => secondStore.reserveRecallConfirmation(issued.token, input)),
    ]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(item => item.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(RecallConfirmationError);
      expect((rejected.reason as RecallConfirmationError).code).toBe('TOKEN_RESERVED');
    }
  });

  it('cancels only the matching reservation and leaves rollback to its owner', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);
    const reserved = store.reserveRecallConfirmation(issued.token, reservationInput(proposed));
    if (reserved.status !== 'reserved') throw new Error('expected reservation');

    const partialTarget = store.sessionDir(proposed.session_id);
    mkdirSync(partialTarget, { recursive: true });
    writeFileSync(join(partialTarget, 'partial.tmp'), 'reservation-owned partial target');

    expect(() => store.cancelRecallConfirmation('rsv_wrong-reservation-id'))
      .toThrow(/reservation not found/);
    expect(store.readRecallConfirmation(issued.token)?.reservation?.reservation_id)
      .toBe(reserved.reservation_id);

    const cancelled = store.cancelRecallConfirmation(reserved.reservation_id);
    expect(cancelled.rollback_target).toEqual(proposed);
    expect(existsSync(join(partialTarget, 'partial.tmp'))).toBe(true);

    const retried = store.reserveRecallConfirmation(
      issued.token,
      reservationInput(proposed, new Date('2026-07-19T00:02:00.000Z')),
    );
    expect(retried.status).toBe('reserved');
    if (retried.status === 'reserved') expect(retried.reservation_id).not.toBe(reserved.reservation_id);
  });

  it('expires unused tokens and requires reconciliation before replacing a stale reservation', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const expired = store.issueRecallConfirmation({
      action: 'new',
      request_hash: requestHash,
      source_fence: null,
      target_fence: targetFence(proposed),
      target_session_id: proposed.session_id,
      now: new Date('2026-07-19T00:00:00.000Z'),
      ttl_ms: 1_000,
    });
    expect(() => store.reserveRecallConfirmation(
      expired.token,
      reservationInput(proposed, new Date('2026-07-19T00:00:02.000Z')),
    )).toThrow(/expired/);

    const issued = issue(store, proposed);
    const first = store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed),
      reservation_ttl_ms: 1_000,
    });
    if (first.status !== 'reserved') throw new Error('expected reservation');
    const stale = store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed, new Date('2026-07-19T00:01:02.000Z')),
      reservation_ttl_ms: 1_000,
    });
    expect(stale.status).toBe('stale');
    if (stale.status !== 'stale') throw new Error('expected stale reservation');
    expect(stale.reservation_id).toBe(first.reservation_id);
    expect(staleRecallReservationSchema.parse(stale.stale).reservation_id).toBe(first.reservation_id);
    const observer = new SessionStore(projectRoot);
    const observation = observer.observeRecallConfirmationReservation(
      first.reservation_id,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(observation).toMatchObject({ marker: { state: 'missing' }, target: { state: 'absent' } });
    const reconciliation = observer.reconcileExpiredRecallConfirmation(
      first.reservation_id,
      observation,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(recallReservationReconciliationSchema.parse(reconciliation).decision).toBe('rollback_partial');
    const released = observer.completeRecallConfirmationRollback(
      first.reservation_id,
      observer.observeRecallConfirmationReservation(first.reservation_id, new Date('2026-07-19T00:01:03.000Z')),
    );
    expect(released.released).toBe(true);
    const second = store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed, new Date('2026-07-19T00:01:04.000Z')),
      reservation_ttl_ms: 1_000,
    });
    expect(second.status).toBe('reserved');
    if (second.status !== 'reserved') throw new Error('expected replacement reservation');
    expect(second.reservation_id).not.toBe(first.reservation_id);
    store.cancelRecallConfirmation(second.reservation_id, new Date('2026-07-19T00:01:04.500Z'));
    store.createSession(proposed.session_id, 'reserved target', {
      command: 'demo', intentIdentity: proposed.intent_identity, ifExists: 'error',
    });
    expect(() => store.reserveRecallConfirmation(
      issued.token,
      reservationInput(proposed, new Date('2026-07-19T00:03:00.000Z')),
    )).toThrow(/already exists/);
  });

  it('rejects request, fence, identity and final target hash mismatches without consuming', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);
    expect(() => store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), request_hash: `sha256:${'b'.repeat(64)}`,
    })).toThrow(/different action or request/);
    expect(() => store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed),
      target_fence: { ...targetFence(proposed), activity_revision: 1 },
    })).toThrow(/fence changed/);
    const another = target(projectRoot, 'another-target');
    expect(() => store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), proposed_target: another,
    })).toThrow(/proposed target identity/);

    const reserved = store.reserveRecallConfirmation(issued.token, reservationInput(proposed));
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    store.createSession(proposed.session_id, 'reserved target', {
      command: 'demo', intentIdentity: proposed.intent_identity, ifExists: 'error',
    });
    const finalTarget = { ...proposed, run_id: null };
    expect(() => store.finalizeRecallConfirmation(reserved.reservation_id, {
      action: 'new', request_hash: requestHash, target: finalTarget,
      target_hash: `sha256:${'c'.repeat(64)}`, outcome: { session_id: proposed.session_id },
    })).toThrow(/authority hash changed/);
    expect(store.readRecallConfirmation(issued.token)?.consumed_at).toBeNull();
    expect(store.readRecallConfirmation(issued.token)?.reservation?.reservation_id).toBe(reserved.reservation_id);
  });

  it('reconciles an expired matching partial target before allowing retry across Store instances', () => {
    const projectRoot = root();
    const firstStore = new SessionStore(projectRoot);
    const secondStore = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(firstStore, proposed);
    const reserved = firstStore.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), reservation_ttl_ms: 1_000,
    });
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    const claimed = firstStore.claimRecallConfirmationTarget(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:00.500Z'),
    );
    expect(recallReservationMarkerSchema.parse(claimed.marker).reservation_id).toBe(reserved.reservation_id);
    writeFileSync(join(firstStore.sessionDir(proposed.session_id), 'partial.tmp'), 'partial target');

    const stale = secondStore.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed, new Date('2026-07-19T00:01:02.000Z')),
      reservation_ttl_ms: 1_000,
    });
    expect(stale.status).toBe('stale');
    const observation = secondStore.observeRecallConfirmationReservation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(recallReservationObservationSchema.parse(observation)).toMatchObject({
      marker: { state: 'matching', reservation_id: reserved.reservation_id },
      target: { state: 'partial' },
    });
    expect(secondStore.reconcileExpiredRecallConfirmation(
      reserved.reservation_id,
      observation,
      new Date('2026-07-19T00:01:02.000Z'),
    ).decision).toBe('rollback_partial');
    expect(() => secondStore.completeRecallConfirmationRollback(reserved.reservation_id, observation))
      .toThrow(/still exists/);

    rmSync(firstStore.sessionDir(proposed.session_id), { recursive: true, force: true });
    const cleared = secondStore.observeRecallConfirmationReservation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:03.000Z'),
    );
    expect(secondStore.completeRecallConfirmationRollback(reserved.reservation_id, cleared).released).toBe(true);
    expect(firstStore.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed, new Date('2026-07-19T00:01:04.000Z')),
      reservation_ttl_ms: 1_000,
    }).status).toBe('reserved');
  });

  it('keeps a claimed partial target fenced until rollback completion', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);
    const reserved = store.reserveRecallConfirmation(issued.token, reservationInput(proposed));
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    store.claimRecallConfirmationTarget(reserved.reservation_id, new Date('2026-07-19T00:01:01.000Z'));
    writeFileSync(join(store.sessionDir(proposed.session_id), 'partial.tmp'), 'partial target');
    const cancelled = store.cancelRecallConfirmation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(cancelled.released).toBe(false);
    expect(store.readRecallConfirmation(issued.token)?.reservation?.phase).toBe('rollback-partial');
    expect(store.reserveRecallConfirmation(
      issued.token,
      reservationInput(proposed, new Date('2026-07-19T00:01:03.000Z')),
    ).status).toBe('stale');
    rmSync(store.sessionDir(proposed.session_id), { recursive: true, force: true });
    const cleared = store.observeRecallConfirmationReservation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:04.000Z'),
    );
    expect(store.completeRecallConfirmationRollback(reserved.reservation_id, cleared).released).toBe(true);
  });

  it('resumes finalize only for a complete target with the matching stale marker and identity', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);
    const reserved = store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), reservation_ttl_ms: 1_000,
    });
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    store.claimRecallConfirmationTarget(reserved.reservation_id, new Date('2026-07-19T00:01:00.500Z'));
    store.createSession(proposed.session_id, 'reserved target', {
      command: 'demo', intentIdentity: proposed.intent_identity, ifExists: 'error',
    });
    const observation = store.observeRecallConfirmationReservation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(observation).toMatchObject({ marker: { state: 'matching' }, target: { state: 'complete' } });
    const reconciliation = store.reconcileExpiredRecallConfirmation(
      reserved.reservation_id,
      observation,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(reconciliation.decision).toBe('resume_finalize');
    const finalTarget = { ...proposed, run_id: null };
    const targetHash = store.readRecallTargetHash(finalTarget);
    const finalized = store.finalizeRecallConfirmation(reserved.reservation_id, {
      action: 'new', request_hash: requestHash, target: finalTarget, target_hash: targetHash,
      outcome: { action: 'new', session_id: proposed.session_id, run_id: null },
      now: new Date('2026-07-19T00:01:03.000Z'),
    });
    expect(finalized.replayed).toBe(false);
    expect(existsSync(join(store.sessionDir(proposed.session_id), '.recall-reservation.json'))).toBe(false);
    expect(store.reserveRecallConfirmation(
      issued.token,
      reservationInput(proposed, new Date('2026-07-20T00:00:00.000Z')),
    ).status).toBe('replayed');
  });

  it('returns conflict for a mismatched marker or complete foreign target and never releases it', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = issue(store, proposed);
    const reserved = store.reserveRecallConfirmation(issued.token, {
      ...reservationInput(proposed), reservation_ttl_ms: 1_000,
    });
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    const claimed = store.claimRecallConfirmationTarget(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:00.500Z'),
    );
    const foreignIdentity = createIntentIdentity(projectRoot, 'demo', 'foreign target');
    store.createSession(proposed.session_id, 'foreign target', {
      command: 'demo', intentIdentity: foreignIdentity, ifExists: 'error',
    });
    writeFileSync(claimed.marker_path, JSON.stringify({
      ...claimed.marker,
      reservation_id: 'rsv_1234567890abcdef',
    }, null, 2));
    const observation = store.observeRecallConfirmationReservation(
      reserved.reservation_id,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(observation).toMatchObject({ marker: { state: 'mismatched' }, target: { state: 'complete' } });
    const reconciliation = store.reconcileExpiredRecallConfirmation(
      reserved.reservation_id,
      observation,
      new Date('2026-07-19T00:01:02.000Z'),
    );
    expect(reconciliation.decision).toBe('conflict');
    expect(() => store.completeRecallConfirmationRollback(reserved.reservation_id, observation))
      .toThrow(/not authorized/);
    expect(store.sessionExists(proposed.session_id)).toBe(true);
  });

  it('resolves and revalidates a linked sealed source before reserve and finalize', () => {
    const sourceRoot = root();
    const projectRoot = root();
    const sourceFence = sealedSource(sourceRoot, 'sealed-link');
    writeLinkedConfig(projectRoot, 'sealed-link', sourceRoot);
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = store.issueRecallConfirmation({
      action: 'import', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposed), target_session_id: proposed.session_id,
    });
    const reserved = store.reserveRecallConfirmation(issued.token, {
      action: 'import', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposed), proposed_target: proposed,
    });
    if (reserved.status !== 'reserved') throw new Error('expected reservation');
    expect(validatedRecallSourceSchema.parse(reserved.validated_source)).toMatchObject({
      scope: 'linked', workspace_link_name: 'sealed-link',
      source_project_root: sourceRoot, session_id: sourceFence.session_id, run_id: sourceFence.run_id,
    });
    store.createSession(proposed.session_id, 'reserved target', {
      command: 'demo', intentIdentity: proposed.intent_identity, ifExists: 'error',
    });
    const finalTarget = { ...proposed, run_id: null };
    const targetHash = store.readRecallTargetHash(finalTarget);
    const sourceSessionPath = join(sourceRoot, '.workflow', 'sessions', sourceFence.session_id, 'session.json');
    const sourceSession = JSON.parse(readFileSync(sourceSessionPath, 'utf8')) as Record<string, unknown>;
    sourceSession.activity_revision = Number(sourceSession.activity_revision) + 1;
    writeFileSync(sourceSessionPath, JSON.stringify(sourceSession, null, 2));
    expect(() => store.finalizeRecallConfirmation(reserved.reservation_id, {
      action: 'import', request_hash: requestHash, target: finalTarget, target_hash: targetHash,
      outcome: { action: 'import', session_id: proposed.session_id },
    })).toThrow(/source authority fence changed/);

    const impostorRoot = root();
    mkdirSync(join(impostorRoot, '.workflow'), { recursive: true });
    writeLinkedConfig(projectRoot, 'sealed-link', impostorRoot);
    const proposedTwo = target(projectRoot, 'target-two');
    const issuedTwo = store.issueRecallConfirmation({
      action: 'import', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposedTwo), target_session_id: proposedTwo.session_id,
    });
    expect(() => store.reserveRecallConfirmation(issuedTwo.token, {
      action: 'import', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposedTwo), proposed_target: proposedTwo,
    })).toThrow(/workspace identity changed/);
  });

  it('revalidates local source revision and file hashes while holding the global lock', () => {
    const projectRoot = root();
    const sourceFence = sealedSource(projectRoot, null);
    const store = new SessionStore(projectRoot);
    const proposed = target(projectRoot);
    const issued = store.issueRecallConfirmation({
      action: 'fork', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposed), target_session_id: proposed.session_id,
    });
    const sessionPath = join(store.sessionDir(sourceFence.session_id), 'session.json');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
    session.status = 'running';
    session.activity_revision = Number(session.activity_revision) + 1;
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    expect(() => store.reserveRecallConfirmation(issued.token, {
      action: 'fork', request_hash: requestHash, source_fence: sourceFence,
      target_fence: targetFence(proposed), proposed_target: proposed,
    })).toThrow(/must remain sealed and immutable/);
    expect(store.readRecallConfirmation(issued.token)?.reservation).toBeNull();
  });
});
