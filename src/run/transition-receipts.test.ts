import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createTransitionOutcome,
  createTransitionRequest,
  replayOrApplyTransition,
  TransitionReceiptError,
} from './transition-receipts.js';
import {
  importManifestSchema,
  recallConfirmationOutcomeSchema,
  persistedTransitionRecordSchema,
  recallConfirmationRecordSchema,
  recallConfirmationRegistrySchema,
  recallConfirmationReservationSchema,
  recallReservationMarkerSchema,
  recallReservationObservationSchema,
  recallReservationReconciliationSchema,
  runRecallSchema,
  sessionTransitionSchema,
  transitionOutcomeSchema,
  transitionRequestSchema,
  validatedRecallSourceSchema,
  type TransitionFence,
} from './protocol-schemas.js';
import { createIntentIdentity } from './intent-identity.js';
import { SessionStore } from './store.js';

const hash = `sha256:${'a'.repeat(64)}`;
const otherHash = `sha256:${'b'.repeat(64)}`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fence(activity = 1): TransitionFence {
  return {
    session_identity_revision: 1,
    session_activity_revision: activity,
    active_run_id: null,
    run_hash: null,
    artifact_registry_revision: 0,
  };
}

function request() {
  return createTransitionRequest({
    request_id: 'req-1',
    operation: 'resume',
    subject: { session_id: 's', run_id: null, chain_step_id: null },
    requested_at: '2026-07-19T00:00:00.000Z',
    preconditions: fence(0),
    payload: { actor: 'user' },
  });
}

describe('transition request/outcome receipts', () => {
  it('applies and replays every retryable mutation operation', () => {
    const operations = [
      'chain-insert', 'chain-replace', 'chain-skip', 'meta-update', 'decide', 'complete', 'accept-reuse',
    ] as const;
    for (const operation of operations) {
      let revision = 0;
      const req = createTransitionRequest({
        request_id: `req-${operation}`,
        operation,
        subject: { session_id: 's', run_id: operation === 'complete' ? 'r' : null, chain_step_id: null },
        requested_at: '2026-07-19T00:00:00.000Z',
        preconditions: fence(0),
        payload: { operation, value: 1 },
      });
      const first = replayOrApplyTransition([], req, fence(0), () => {
        revision++;
        return createTransitionOutcome({
          request_id: req.request_id, request_hash: req.normalized_request_hash, operation,
          status: 'applied', applied_at: '2026-07-19T00:00:01.000Z', subject: req.subject,
          postconditions: fence(1), exit_code: 0, error_code: null, result: { revision },
        });
      });
      expect(first.replayed).toBe(false);
      const replay = replayOrApplyTransition([first.record], req, fence(1), () => {
        revision++;
        return first.outcome;
      });
      expect(replay.replayed).toBe(true);
      expect(revision).toBe(1);
      const driftedPayload = createTransitionRequest({
        request_id: req.request_id, operation, subject: req.subject,
        requested_at: req.requested_at, preconditions: req.preconditions,
        payload: { operation, value: 2 },
      });
      expect(() => replayOrApplyTransition([first.record], driftedPayload, fence(1), () => first.outcome))
        .toThrowError(expect.objectContaining({ code: 'REQUEST_CONFLICT' }));
      expect(() => replayOrApplyTransition([first.record], req, fence(2), () => first.outcome))
        .toThrowError(expect.objectContaining({ code: 'REPLAY_STATE_DIVERGED' }));
    }
  });

  it('applies once and replays the identical request without invoking mutation', () => {
    const req = request();
    let applied = 0;
    const first = replayOrApplyTransition([], req, fence(0), () => {
      applied++;
      return createTransitionOutcome({
        request_id: req.request_id,
        request_hash: req.normalized_request_hash,
        operation: req.operation,
        status: 'applied',
        applied_at: '2026-07-19T00:00:01.000Z',
        subject: req.subject,
        postconditions: fence(1),
        exit_code: 0,
        error_code: null,
        result: { status: 'running' },
      });
    });
    expect(first.replayed).toBe(false);
    expect(persistedTransitionRecordSchema.parse(first.record).outcome.status).toBe('applied');

    const replayed = replayOrApplyTransition([first.record], req, fence(1), () => {
      applied++;
      throw new Error('must not run');
    });
    expect(replayed.replayed).toBe(true);
    expect(replayed.outcome.transition_id).toBe(first.outcome.transition_id);
    expect(applied).toBe(1);
  });

  it('rejects same ID with another hash and replay state divergence', () => {
    const req = request();
    const first = replayOrApplyTransition([], req, fence(0), () => createTransitionOutcome({
      request_id: req.request_id,
      request_hash: req.normalized_request_hash,
      operation: req.operation,
      status: 'applied',
      applied_at: '2026-07-19T00:00:01.000Z',
      subject: req.subject,
      postconditions: fence(1),
      exit_code: 0,
      error_code: null,
      result: { status: 'running' },
    }));
    expect(() => replayOrApplyTransition([
      first.record,
    ], { ...req, normalized_request_hash: otherHash }, fence(1), () => first.outcome))
      .toThrowError(TransitionReceiptError);
    expect(() => replayOrApplyTransition([first.record], req, fence(2), () => first.outcome))
      .toThrow(/no longer matches current authority revisions/);
    expect(() => transitionRequestSchema.parse({ ...req, schema_version: 'transition-request/2.0' })).toThrow();
    expect(() => transitionOutcomeSchema.parse({ ...first.outcome, request_hash: 'bad' })).toThrow();
  });
});

describe('recall, confirmation, transition and import protocol schemas', () => {
  it('enforces automatic=false and confirmation token fences', () => {
    const identity = {
      schema_version: 'intent-identity/1.0',
      normalization: 'NFKC+unicode-lower+whitespace-collapse/1',
      workspace_id: hash,
      command: 'plan',
      verbatim: 'Plan',
      normalized: 'plan',
      normalized_length: 4,
      normalized_hash: hash,
      revision: 1,
      source: 'persisted',
      backfill_status: 'native',
      empty: false,
    } as const;
    const recall = {
      schema_version: 'run-recall/1.0',
      request: { request_id: 'recall-1', request_hash: hash, command: 'plan', intent: 'Plan', workspace: hash, as_of: '2026-07-19T00:00:00.000Z', interactive: true },
      intent_identity: identity,
      exact_candidates: [],
      historical_candidates: [],
      recommendation: { action: 'new', candidate_id: null, automatic: false, reason_codes: ['NEW_SESSION_AVAILABLE'] },
      confirmation: { required: true, issuance_command: 'maestro run recall-confirm new', allowed_actions: ['new'] },
      next: { suggest_only: true, command: 'maestro run create plan', reason: 'explicit new' },
    } as const;
    expect(runRecallSchema.parse(recall).recommendation.automatic).toBe(false);
    expect(() => runRecallSchema.parse({
      ...recall,
      recommendation: { ...recall.recommendation, automatic: true },
    })).toThrow();

    const confirmation = {
      schema_version: 'recall-confirmation/1.0', token_hash: hash, action: 'new', candidate_id: null,
      request_hash: hash, issued_at: '2026-07-19T00:00:00.000Z', expires_at: '2026-07-19T00:10:00.000Z',
      consumed_at: null, source_fence: null,
      target_fence: { workspace_id: hash, session_id: 'target', must_not_exist: true, status: null, identity_revision: null, activity_revision: null, active_run_id: null, artifact_registry_revision: null },
      target_session_id: 'target', result_session_id: null, result_run_id: null,
      reservation: null, outcome: null,
    } as const;
    expect(recallConfirmationRecordSchema.parse(confirmation).action).toBe('new');
    expect(() => recallConfirmationRecordSchema.parse({ ...confirmation, token_hash: 'raw-token' })).toThrow();
    expect(recallConfirmationRegistrySchema.parse({
      schema_version: 'recall-confirmations/1.0', revision: 0, records: { [confirmation.token_hash]: confirmation },
    }).revision).toBe(0);
    expect(() => recallConfirmationRegistrySchema.parse({
      schema_version: 'recall-confirmations/2.0', revision: 0, records: {},
    })).toThrow();

    const reservation = {
      schema_version: 'recall-confirmation-reservation/1.0',
      reservation_id: 'rsv_1234567890abcdef', action: 'new', request_hash: hash,
      source_fence: null, target_fence: confirmation.target_fence,
      proposed_target: { workspace_id: hash, session_id: 'target', intent_identity: identity },
      phase: 'target-claimed',
      reserved_at: '2026-07-19T00:01:00.000Z', expires_at: '2026-07-19T00:03:00.000Z',
      reconcile_expires_at: null,
    } as const;
    expect(recallConfirmationReservationSchema.parse(reservation).reservation_id).toBe(reservation.reservation_id);
    expect(() => recallConfirmationReservationSchema.parse({ ...reservation, reservation_id: 'raw-token' })).toThrow();
    expect(() => recallConfirmationReservationSchema.parse({ ...reservation, phase: 'deleted' })).toThrow();
    const outcome = {
      schema_version: 'recall-confirmation-outcome/1.0', reservation_id: reservation.reservation_id,
      action: 'new', request_hash: hash,
      target: { ...reservation.proposed_target, run_id: null }, target_hash: hash, outcome_hash: otherHash,
      outcome: { session_id: 'target' }, finalized_at: '2026-07-19T00:02:00.000Z',
    } as const;
    expect(recallConfirmationOutcomeSchema.parse(outcome).target.session_id).toBe('target');
    expect(() => recallConfirmationOutcomeSchema.parse({ ...outcome, target_hash: 'bad' })).toThrow();

    const marker = {
      schema_version: 'recall-reservation-marker/1.0', reservation_id: reservation.reservation_id,
      workspace_id: hash, session_id: 'target', intent_identity_hash: identity.normalized_hash,
      created_at: reservation.reserved_at,
    } as const;
    expect(recallReservationMarkerSchema.parse(marker).session_id).toBe('target');
    expect(() => recallReservationMarkerSchema.parse({ ...marker, intent_identity_hash: 'raw' })).toThrow();
    const observation = {
      schema_version: 'recall-reservation-observation/1.0', reservation_id: reservation.reservation_id,
      observed_at: '2026-07-19T00:04:00.000Z',
      marker: { state: 'matching', reservation_id: reservation.reservation_id },
      target: { state: 'partial', authority_hash: hash, intent_identity: null, run_id: null },
    } as const;
    expect(recallReservationObservationSchema.parse(observation).target.state).toBe('partial');
    expect(() => recallReservationObservationSchema.parse({
      ...observation, target: { ...observation.target, state: 'deleted' },
    })).toThrow();
    expect(recallReservationReconciliationSchema.parse({
      schema_version: 'recall-reservation-reconciliation/1.0', reservation_id: reservation.reservation_id,
      decision: 'rollback_partial', reason: 'matching partial target',
      stale: {
        schema_version: 'stale-recall-reservation/1.0', reservation_id: reservation.reservation_id,
        action: 'new', request_hash: hash, phase: 'target-claimed', proposed_target: reservation.proposed_target,
        marker, marker_relative_path: '.recall-reservation.json',
        reserved_at: reservation.reserved_at, expires_at: reservation.expires_at,
      },
      observed: observation, reconcile_expires_at: null,
    }).decision).toBe('rollback_partial');
    expect(validatedRecallSourceSchema.parse({
      schema_version: 'validated-recall-source/1.0', scope: 'linked', workspace_link_name: 'source',
      source_project_root: 'D:/source', source_workflow_root: 'D:/source/.workflow', workspace_id: hash,
      session_id: 'source-session', run_id: 'source-run', session_status: 'sealed', run_status: 'sealed',
      session_intent_identity: identity,
      fence: {
        workspace_id: hash, workspace_link_name: 'source', session_id: 'source-session',
        session_schema_version: 'session/1.2', session_identity_revision: 1, session_activity_revision: 1,
        session_hash: hash, run_id: 'source-run', run_schema_version: 'command-run/1.2', run_hash: otherHash,
        artifact_registry_revision: 0, selected_artifacts: [],
      },
    }).scope).toBe('linked');
  });

  it('validates session-transition and import-manifest provenance without source artifact IDs', () => {
    const sessionTransition = {
      schema_version: 'session-transition/1.0', operation: 'resume', session_id: 's', transition_id: 'tr-1', request_id: 'req-1',
      before: fence(0), after: fence(1), replayed: false,
      next: { suggest_only: true, command: 'maestro run next --session s', reason: 'resumed' },
    } as const;
    expect(sessionTransitionSchema.parse(sessionTransition).operation).toBe('resume');
    expect(() => sessionTransitionSchema.parse({ ...sessionTransition, next: { ...sessionTransition.next, suggest_only: false } })).toThrow();

    const manifest = {
      schema_version: 'import-manifest/1.0',
      source: { workspace_id: hash, session_id: 'source-s', run_id: 'source-r' },
      target: { workspace_id: otherHash, session_id: 'target-s', run_id: 'target-r' },
      artifacts: [{ source_kind: 'plan', source_path: 'outputs/plan.json', source_hash: hash, target_artifact_id: 'ART-001', target_path: 'outputs/imported-plan.json' }],
      created_at: '2026-07-19T00:00:00.000Z',
    } as const;
    expect(importManifestSchema.parse(manifest).artifacts[0].target_artifact_id).toBe('ART-001');
    expect(() => importManifestSchema.parse({ ...manifest, artifacts: [{ ...manifest.artifacts[0], source_hash: 'bad' }] })).toThrow();
  });
});

describe('SessionStore confirmation and transition APIs', () => {
  it('issues, reads and consumes a single-use confirmation under the global lock', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-confirmation-'));
    roots.push(projectRoot);
    const store = new SessionStore(projectRoot);
    const identity = createIntentIdentity(projectRoot, 'plan', 'target');
    const issued = store.issueRecallConfirmation({
      action: 'new',
      request_hash: hash,
      target_fence: {
        workspace_id: identity.workspace_id,
        session_id: 'target',
        must_not_exist: true,
        status: null,
        identity_revision: null,
        activity_revision: null,
        active_run_id: null,
        artifact_registry_revision: null,
      },
      target_session_id: 'target',
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
    expect(store.readRecallConfirmation(issued.token)?.token_hash).toBe(issued.record.token_hash);
    const consumed = store.consumeRecallConfirmation(
      issued.token,
      { action: 'new', request_hash: hash, now: new Date('2026-07-19T00:01:00.000Z') },
      { session_id: 'target' },
    );
    expect(consumed.consumed_at).toBe('2026-07-19T00:01:00.000Z');
    expect(() => store.consumeRecallConfirmation(
      issued.token,
      { action: 'new', request_hash: hash, now: new Date('2026-07-19T00:02:00.000Z') },
      { session_id: 'target' },
    )).toThrow(/already consumed/);
  });

  it('persists a transition receipt with the Session mutation and replays without mutation', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-transition-store-'));
    roots.push(projectRoot);
    const store = new SessionStore(projectRoot);
    store.createSession('s', 'resume me', { command: 'plan' });
    store.update('s', draft => { draft.session.status = 'paused'; });
    const before = store.readSessionFence('s');
    const req = createTransitionRequest({
      request_id: 'req-store-resume',
      operation: 'resume',
      subject: { session_id: 's', run_id: null, chain_step_id: null },
      requested_at: '2026-07-19T00:00:00.000Z',
      preconditions: before,
      payload: { actor: 'user' },
    });
    const first = store.replayOrApplyTransition('s', req, draft => {
      draft.session.status = 'running';
      draft.session.activity_revision++;
      return createTransitionOutcome({
        request_id: req.request_id,
        request_hash: req.normalized_request_hash,
        operation: req.operation,
        status: 'applied',
        applied_at: '2026-07-19T00:00:01.000Z',
        subject: req.subject,
        postconditions: { ...before, session_activity_revision: before.session_activity_revision + 1 },
        exit_code: 0,
        error_code: null,
        result: { status: 'running' },
      });
    });
    expect(first.replayed).toBe(false);
    const activity = store.readBundle('s').session.activity_revision;
    const replay = store.replayOrApplyTransition('s', req, () => {
      throw new Error('must not mutate on replay');
    });
    expect(replay.replayed).toBe(true);
    expect(store.readBundle('s').session.activity_revision).toBe(activity);
  });
});
