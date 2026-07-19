import { checkLease, type LeaseClaim } from './lease.js';
import { sessionTransitionSchema, type SessionTransition, type TransitionRequest } from './protocol-schemas.js';
import { SessionStore } from './store.js';
import { createTransitionOutcome, createTransitionRequest } from './transition-receipts.js';

export type ResolutionTarget =
  | { kind: 'decision'; id: string; disposition: 'proceed' | 'retry' }
  | { kind: 'step'; id: string; disposition: 'retry' | 'skip' };

export interface SessionTransitionOptions {
  requestId: string;
  actor: string;
  reason: string;
  evidence: string[];
  expectedIdentityRevision: number;
  expectedActivityRevision: number;
  /** Optional concurrency fence; when present the complete lease triple is required. */
  leaseClaim?: LeaseClaim;
}

export interface ResolveSessionOptions extends SessionTransitionOptions {
  target: ResolutionTarget;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function expectedRevision(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function normalizedLeaseClaim(options: SessionTransitionOptions): LeaseClaim {
  const claim = options.leaseClaim ?? {};
  const supplied = [claim.executionOwner, claim.ownerEpoch, claim.leaseId]
    .filter(value => value !== undefined).length;
  if (supplied !== 0 && supplied !== 3) {
    throw new Error('lease claim requires --execution-owner, --owner-epoch, and --lease-id together');
  }
  return supplied === 0 ? {} : claim;
}

function requestFor(
  store: SessionStore,
  sessionId: string,
  operation: 'resolve' | 'resume',
  options: SessionTransitionOptions,
  payload: Record<string, unknown>,
): TransitionRequest {
  const existing = store.readBundle(sessionId).session.requests.find(
    item => item.type === 'transition' && item.request_id === options.requestId && 'outcome' in item,
  ) as Extract<ReturnType<SessionStore['readBundle']>['session']['requests'][number], { type: 'transition' }> | undefined;
  const preconditions = existing?.payload.preconditions ?? store.readSessionFence(sessionId);
  return createTransitionRequest({
    request_id: required(options.requestId, 'request/transition ID'),
    operation,
    subject: { session_id: sessionId, run_id: null, chain_step_id: null },
    requested_at: existing?.payload.requested_at ?? options.requestId,
    preconditions,
    payload,
  });
}

function normalizedEvidence(options: SessionTransitionOptions): string[] {
  const evidence = (options.evidence ?? []).map(item => item.trim()).filter(Boolean);
  if (evidence.length === 0) throw new Error('at least one evidence reference is required');
  return evidence;
}

function commonPayload(options: SessionTransitionOptions): Record<string, unknown> {
  return {
    actor: required(options.actor, 'actor'),
    reason: required(options.reason, 'reason'),
    evidence: normalizedEvidence(options),
    expected_identity_revision: expectedRevision(options.expectedIdentityRevision, 'expected identity revision'),
    expected_activity_revision: expectedRevision(options.expectedActivityRevision, 'expected activity revision'),
    lease: normalizedLeaseClaim(options),
  };
}

function assertCommonGuards(
  session: ReturnType<SessionStore['readBundle']>['session'],
  options: SessionTransitionOptions,
): void {
  if (session.status !== 'paused') throw new Error(`session is "${session.status}", expected "paused"`);
  if (session.identity_revision !== options.expectedIdentityRevision) {
    throw new Error(`stale identity revision: expected ${options.expectedIdentityRevision}, current ${session.identity_revision}`);
  }
  if (session.activity_revision !== options.expectedActivityRevision) {
    throw new Error(`stale activity revision: expected ${options.expectedActivityRevision}, current ${session.activity_revision}`);
  }
  if (session.active_run_id) throw new Error(`session has active Run ${session.active_run_id}`);
  if (session.orchestration.chain.some(step => step.status === 'running')) throw new Error('session has a running chain step');
  const leaseConflict = checkLease(session.orchestration.lease, normalizedLeaseClaim(options));
  if (leaseConflict) throw new Error(leaseConflict);
}

function assertNoResumeBlockers(
  session: ReturnType<SessionStore['readBundle']>['session'],
): void {
  const escalated = session.orchestration.decision_points.find(point => point.status === 'escalated');
  if (escalated) throw new Error(`unresolved escalated decision: ${escalated.point_id}`);
  const failed = session.orchestration.chain.find(step => step.status === 'failed');
  if (failed) throw new Error(`unresolved failed chain step: ${failed.step_id}`);
}

export function resolveSession(
  projectRoot: string,
  sessionId: string,
  options: ResolveSessionOptions,
): SessionTransition {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) throw new Error(`session not found: ${sessionId}`);
  const payload = { ...commonPayload(options), target: options.target };
  const request = requestFor(store, sessionId, 'resolve', options, payload);
  const evaluated = store.replayOrApplyTransition(sessionId, request, (draft) => {
    assertCommonGuards(draft.session, options);
    const target = options.target;
    if (target.kind === 'decision') {
      const point = draft.session.orchestration.decision_points.find(item => item.point_id === target.id);
      if (!point || point.status !== 'escalated') throw new Error(`decision ${target.id} is not escalated`);
      const node = draft.session.orchestration.chain.find(step => step.decision_ref === target.id);
      if (target.disposition === 'proceed') {
        point.status = 'passed';
        if (node) node.status = 'sealed';
      } else {
        point.status = 'pending';
        if (node) node.status = 'pending';
      }
      point.evidence_ref = normalizedEvidence(options).join('; ');
    } else {
      const step = draft.session.orchestration.chain.find(item => item.step_id === target.id);
      if (!step || step.status !== 'failed') throw new Error(`chain step ${target.id} is not failed`);
      if (target.disposition === 'skip') step.status = 'skipped';
      else {
        step.status = 'pending';
        step.run_id = null;
      }
    }
    draft.session.activity_revision++;
    const after = { ...request.preconditions, session_activity_revision: draft.session.activity_revision };
    return createTransitionOutcome({
      request_id: request.request_id,
      request_hash: request.normalized_request_hash,
      operation: 'resolve',
      status: 'applied',
      applied_at: new Date().toISOString(),
      subject: request.subject,
      postconditions: after,
      exit_code: 0,
      error_code: null,
      result: { target, session_status: draft.session.status },
    });
  });
  return sessionTransitionSchema.parse({
    schema_version: 'session-transition/1.0', operation: 'resolve', session_id: sessionId,
    transition_id: evaluated.outcome.transition_id, request_id: request.request_id,
    before: request.preconditions, after: evaluated.outcome.postconditions, replayed: evaluated.replayed,
    next: { suggest_only: true, command: `maestro session resume --session ${sessionId}`, reason: 'target resolved; Session remains paused until explicit resume' },
  });
}

export function resumeSession(
  projectRoot: string,
  sessionId: string,
  options: SessionTransitionOptions,
): SessionTransition {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) throw new Error(`session not found: ${sessionId}`);
  const payload = commonPayload(options);
  const request = requestFor(store, sessionId, 'resume', options, payload);
  const evaluated = store.replayOrApplyTransition(sessionId, request, (draft) => {
    assertCommonGuards(draft.session, options);
    assertNoResumeBlockers(draft.session);
    draft.session.status = 'running';
    draft.session.activity_revision++;
    const after = { ...request.preconditions, session_activity_revision: draft.session.activity_revision };
    return createTransitionOutcome({
      request_id: request.request_id,
      request_hash: request.normalized_request_hash,
      operation: 'resume', status: 'applied', applied_at: new Date().toISOString(),
      subject: request.subject, postconditions: after, exit_code: 0, error_code: null,
      result: { session_status: 'running' },
    });
  });
  return sessionTransitionSchema.parse({
    schema_version: 'session-transition/1.0', operation: 'resume', session_id: sessionId,
    transition_id: evaluated.outcome.transition_id, request_id: request.request_id,
    before: request.preconditions, after: evaluated.outcome.postconditions, replayed: evaluated.replayed,
    next: { suggest_only: true, command: `maestro run next --session ${sessionId}`, reason: 'Session resumed; Run creation remains an explicit next operation' },
  });
}
