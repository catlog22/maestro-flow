import { randomBytes, randomUUID } from 'node:crypto';

import {
  recallConfirmationFinalTargetSchema,
  recallConfirmationOutcomeSchema,
  recallConfirmationRecordSchema,
  recallConfirmationRegistrySchema,
  recallConfirmationReservationSchema,
  recallConfirmationTargetIdentitySchema,
  recallReservationMarkerSchema,
  staleRecallReservationSchema,
  sourceFenceSchema,
  targetFenceSchema,
  type RecallConfirmationFinalTarget,
  type RecallConfirmationOutcome,
  type RecallConfirmationRecord,
  type RecallConfirmationRegistry,
  type RecallConfirmationTargetIdentity,
  type RecallReservationMarker,
  type StaleRecallReservation,
} from './protocol-schemas.js';
import { sha256Digest, stableJsonUtf8 } from './transition-receipts.js';

export const RECALL_CONFIRMATION_TTL_MS = 600_000;
export const RECALL_CONFIRMATION_RESERVATION_TTL_MS = 120_000;
export const RECALL_CONFIRMATION_RECONCILIATION_TTL_MS = 120_000;

export function createRecallConfirmationRegistry(): RecallConfirmationRegistry {
  return recallConfirmationRegistrySchema.parse({
    schema_version: 'recall-confirmations/1.0',
    revision: 0,
    records: {},
  });
}

export interface IssueRecallConfirmationInput {
  action: RecallConfirmationRecord['action'];
  candidate_id?: string | null;
  request_hash: string;
  source_fence?: RecallConfirmationRecord['source_fence'];
  target_fence: RecallConfirmationRecord['target_fence'];
  target_session_id: string;
  now?: Date;
  ttl_ms?: number;
}

export function issueRecallConfirmationRecord(
  input: IssueRecallConfirmationInput,
): { token: string; record: RecallConfirmationRecord } {
  const now = input.now ?? new Date();
  const token = `rcf_${randomBytes(32).toString('base64url')}`;
  const record = recallConfirmationRecordSchema.parse({
    schema_version: 'recall-confirmation/1.0',
    token_hash: sha256Digest(token),
    action: input.action,
    candidate_id: input.candidate_id ?? null,
    request_hash: input.request_hash,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (input.ttl_ms ?? RECALL_CONFIRMATION_TTL_MS)).toISOString(),
    consumed_at: null,
    source_fence: input.source_fence ?? null,
    target_fence: input.target_fence,
    target_session_id: input.target_session_id,
    result_session_id: null,
    result_run_id: null,
    reservation: null,
    outcome: null,
  });
  return { token, record };
}

export class RecallConfirmationError extends Error {
  constructor(
    readonly code:
      | 'TOKEN_INVALID'
      | 'TOKEN_EXPIRED'
      | 'TOKEN_REPLAYED'
      | 'TOKEN_RESERVED'
      | 'REQUEST_CONFLICT'
      | 'FENCE_CONFLICT'
      | 'RESERVATION_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'RecallConfirmationError';
  }
}

export function assertRecallConfirmationConsumable(
  recordInput: RecallConfirmationRecord,
  expected: { action: RecallConfirmationRecord['action']; request_hash: string; now?: Date },
): RecallConfirmationRecord {
  const record = recallConfirmationRecordSchema.parse(recordInput);
  if (record.action !== expected.action || record.request_hash !== expected.request_hash) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'confirmation token is bound to a different action or request');
  }
  if (record.consumed_at) {
    throw new RecallConfirmationError('TOKEN_REPLAYED', 'confirmation token was already consumed');
  }
  const now = expected.now ?? new Date();
  if (Date.parse(record.expires_at) <= now.getTime()) {
    throw new RecallConfirmationError('TOKEN_EXPIRED', 'confirmation token has expired');
  }
  if (record.reservation && Date.parse(record.reservation.expires_at) > now.getTime()) {
    throw new RecallConfirmationError('TOKEN_RESERVED', 'confirmation token has an active reservation');
  }
  return record;
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJsonUtf8(left) === stableJsonUtf8(right);
}

export function createRecallReservationMarker(
  reservation: NonNullable<RecallConfirmationRecord['reservation']>,
): RecallReservationMarker {
  return recallReservationMarkerSchema.parse({
    schema_version: 'recall-reservation-marker/1.0',
    reservation_id: reservation.reservation_id,
    workspace_id: reservation.proposed_target.workspace_id,
    session_id: reservation.proposed_target.session_id,
    intent_identity_hash: reservation.proposed_target.intent_identity.normalized_hash,
    created_at: reservation.reserved_at,
  });
}

export function createStaleRecallReservation(
  reservation: NonNullable<RecallConfirmationRecord['reservation']>,
): StaleRecallReservation {
  return staleRecallReservationSchema.parse({
    schema_version: 'stale-recall-reservation/1.0',
    reservation_id: reservation.reservation_id,
    action: reservation.action,
    request_hash: reservation.request_hash,
    phase: reservation.phase,
    proposed_target: reservation.proposed_target,
    marker: createRecallReservationMarker(reservation),
    marker_relative_path: '.recall-reservation.json',
    reserved_at: reservation.reserved_at,
    expires_at: reservation.expires_at,
  });
}

function assertBoundRequest(
  record: RecallConfirmationRecord,
  expected: {
    action: RecallConfirmationRecord['action'];
    request_hash: string;
    source_fence: RecallConfirmationRecord['source_fence'];
    target_fence: RecallConfirmationRecord['target_fence'];
    proposed_target: RecallConfirmationTargetIdentity;
  },
): RecallConfirmationTargetIdentity {
  const proposedTarget = recallConfirmationTargetIdentitySchema.parse(expected.proposed_target);
  const sourceFence = expected.source_fence === null ? null : sourceFenceSchema.parse(expected.source_fence);
  const targetFence = targetFenceSchema.parse(expected.target_fence);
  if (record.action !== expected.action || record.request_hash !== expected.request_hash) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'confirmation token is bound to a different action or request');
  }
  if (!sameValue(record.source_fence, sourceFence) || !sameValue(record.target_fence, targetFence)) {
    throw new RecallConfirmationError('FENCE_CONFLICT', 'confirmation token authority fence changed');
  }
  if (
    record.target_session_id !== proposedTarget.session_id
    || targetFence.session_id !== proposedTarget.session_id
    || targetFence.workspace_id !== proposedTarget.workspace_id
    || proposedTarget.intent_identity.workspace_id !== proposedTarget.workspace_id
  ) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'proposed target identity does not match the confirmation request');
  }
  return proposedTarget;
}

export interface ReserveRecallConfirmationInput {
  action: RecallConfirmationRecord['action'];
  request_hash: string;
  source_fence: RecallConfirmationRecord['source_fence'];
  target_fence: RecallConfirmationRecord['target_fence'];
  proposed_target: RecallConfirmationTargetIdentity;
  now?: Date;
  reservation_ttl_ms?: number;
}

export type ReserveRecallConfirmationResult =
  | {
    status: 'reserved';
    record: RecallConfirmationRecord;
    reservation_id: string;
    rollback_target: RecallConfirmationTargetIdentity;
    marker: RecallReservationMarker;
  }
  | {
    status: 'replayed';
    record: RecallConfirmationRecord;
    reservation_id: null;
    outcome: RecallConfirmationOutcome;
  }
  | {
    status: 'stale';
    record: RecallConfirmationRecord;
    reservation_id: string;
    stale: StaleRecallReservation;
    rollback_target: RecallConfirmationTargetIdentity;
    marker: RecallReservationMarker;
  };

export function reserveRecallConfirmationRecord(
  recordInput: RecallConfirmationRecord,
  input: ReserveRecallConfirmationInput,
): ReserveRecallConfirmationResult {
  const record = recallConfirmationRecordSchema.parse(recordInput);
  const proposedTarget = assertBoundRequest(record, input);
  if (record.reservation && !sameValue(record.reservation.proposed_target, proposedTarget)) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'confirmation reservation target identity mismatch');
  }
  if (record.outcome && !sameValue({
    workspace_id: record.outcome.target.workspace_id,
    session_id: record.outcome.target.session_id,
    intent_identity: record.outcome.target.intent_identity,
  }, proposedTarget)) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'completed confirmation target identity mismatch');
  }
  if (record.consumed_at) {
    if (record.outcome) {
      return { status: 'replayed', record, reservation_id: null, outcome: record.outcome };
    }
    throw new RecallConfirmationError('TOKEN_REPLAYED', 'confirmation token was already consumed');
  }
  const now = input.now ?? new Date();
  if (record.reservation) {
    if (record.reservation.phase === 'rollback-partial' || record.reservation.phase === 'conflict') {
      return {
        status: 'stale',
        record,
        reservation_id: record.reservation.reservation_id,
        stale: createStaleRecallReservation(record.reservation),
        rollback_target: record.reservation.proposed_target,
        marker: createRecallReservationMarker(record.reservation),
      };
    }
    const activeUntil = record.reservation.phase === 'resume-finalize'
      ? record.reservation.reconcile_expires_at
      : record.reservation.expires_at;
    if (activeUntil && Date.parse(activeUntil) > now.getTime()) {
      throw new RecallConfirmationError('TOKEN_RESERVED', 'confirmation token has an active reservation');
    }
    return {
      status: 'stale',
      record,
      reservation_id: record.reservation.reservation_id,
      stale: createStaleRecallReservation(record.reservation),
      rollback_target: record.reservation.proposed_target,
      marker: createRecallReservationMarker(record.reservation),
    };
  }
  if (Date.parse(record.expires_at) <= now.getTime()) {
    throw new RecallConfirmationError('TOKEN_EXPIRED', 'confirmation token has expired');
  }
  const ttl = input.reservation_ttl_ms ?? RECALL_CONFIRMATION_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'reservation TTL must be a positive integer');
  }
  const reservationId = `rsv_${randomUUID()}`;
  const reservation = recallConfirmationReservationSchema.parse({
    schema_version: 'recall-confirmation-reservation/1.0',
    reservation_id: reservationId,
    action: input.action,
    request_hash: input.request_hash,
    source_fence: input.source_fence,
    target_fence: input.target_fence,
    proposed_target: proposedTarget,
    phase: 'reserved',
    reserved_at: now.toISOString(),
    expires_at: new Date(Math.min(
      Date.parse(record.expires_at),
      now.getTime() + ttl,
    )).toISOString(),
    reconcile_expires_at: null,
  });
  const reserved = recallConfirmationRecordSchema.parse({ ...record, reservation });
  return {
    status: 'reserved',
    record: reserved,
    reservation_id: reservationId,
    rollback_target: proposedTarget,
    marker: createRecallReservationMarker(reservation),
  };
}

export interface FinalizeRecallConfirmationInput {
  action: RecallConfirmationRecord['action'];
  request_hash: string;
  target: RecallConfirmationFinalTarget;
  target_hash: string;
  outcome: Record<string, unknown>;
  now?: Date;
}

export function finalizeRecallConfirmationRecord(
  recordInput: RecallConfirmationRecord,
  reservationId: string,
  input: FinalizeRecallConfirmationInput,
): { record: RecallConfirmationRecord; outcome: RecallConfirmationOutcome; replayed: boolean } {
  const record = recallConfirmationRecordSchema.parse(recordInput);
  const target = recallConfirmationFinalTargetSchema.parse(input.target);
  const now = input.now ?? new Date();
  const outcomeHash = sha256Digest(stableJsonUtf8(input.outcome));
  if (record.outcome?.reservation_id === reservationId) {
    if (
      record.outcome.action !== input.action
      || record.outcome.request_hash !== input.request_hash
      || !sameValue(record.outcome.target, target)
      || record.outcome.target_hash !== input.target_hash
      || record.outcome.outcome_hash !== outcomeHash
    ) {
      throw new RecallConfirmationError('REQUEST_CONFLICT', 'finalized reservation outcome does not match');
    }
    return { record, outcome: record.outcome, replayed: true };
  }
  if (record.consumed_at) {
    throw new RecallConfirmationError('TOKEN_REPLAYED', 'confirmation token was already consumed');
  }
  const reservation = record.reservation;
  if (!reservation || reservation.reservation_id !== reservationId) {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
  }
  if (!['reserved', 'target-claimed', 'resume-finalize'].includes(reservation.phase)) {
    throw new RecallConfirmationError('RESERVATION_INVALID', `confirmation reservation phase ${reservation.phase} cannot finalize`);
  }
  const activeUntil = reservation.phase === 'resume-finalize'
    ? reservation.reconcile_expires_at
    : reservation.expires_at;
  if (!activeUntil || Date.parse(activeUntil) <= now.getTime()) {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation has expired');
  }
  if (reservation.action !== input.action || reservation.request_hash !== input.request_hash) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'confirmation reservation request mismatch');
  }
  if (
    target.workspace_id !== reservation.proposed_target.workspace_id
    || target.session_id !== reservation.proposed_target.session_id
    || !sameValue(target.intent_identity, reservation.proposed_target.intent_identity)
  ) {
    throw new RecallConfirmationError('REQUEST_CONFLICT', 'final target identity does not match the reservation');
  }
  const outcome = recallConfirmationOutcomeSchema.parse({
    schema_version: 'recall-confirmation-outcome/1.0',
    reservation_id: reservationId,
    action: input.action,
    request_hash: input.request_hash,
    target,
    target_hash: input.target_hash,
    outcome_hash: outcomeHash,
    outcome: input.outcome,
    finalized_at: now.toISOString(),
  });
  const finalized = recallConfirmationRecordSchema.parse({
    ...record,
    consumed_at: now.toISOString(),
    result_session_id: target.session_id,
    result_run_id: target.run_id,
    reservation: null,
    outcome,
  });
  return { record: finalized, outcome, replayed: false };
}

export function cancelRecallConfirmationRecord(
  recordInput: RecallConfirmationRecord,
  reservationId: string,
  now = new Date(),
): { record: RecallConfirmationRecord; rollback_target: RecallConfirmationTargetIdentity; released: boolean } {
  const record = recallConfirmationRecordSchema.parse(recordInput);
  if (record.consumed_at || record.outcome) {
    throw new RecallConfirmationError('TOKEN_REPLAYED', 'confirmation token was already consumed');
  }
  if (!record.reservation || record.reservation.reservation_id !== reservationId) {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation not found');
  }
  if (Date.parse(record.reservation.expires_at) <= now.getTime()) {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'expired confirmation reservation requires reconciliation');
  }
  const rollbackTarget = record.reservation.proposed_target;
  if (record.reservation.phase === 'target-claimed') {
    return {
      record: recallConfirmationRecordSchema.parse({
        ...record,
        reservation: { ...record.reservation, phase: 'rollback-partial', reconcile_expires_at: null },
      }),
      rollback_target: rollbackTarget,
      released: false,
    };
  }
  if (record.reservation.phase !== 'reserved') {
    throw new RecallConfirmationError('RESERVATION_INVALID', 'confirmation reservation requires reconciliation');
  }
  return {
    record: recallConfirmationRecordSchema.parse({ ...record, reservation: null }),
    rollback_target: rollbackTarget,
    released: true,
  };
}

export function hashRecallConfirmationToken(token: string): string {
  if (!token.startsWith('rcf_')) throw new RecallConfirmationError('TOKEN_INVALID', 'invalid confirmation token format');
  return sha256Digest(token);
}

export {
  recallConfirmationFinalTargetSchema,
  recallConfirmationOutcomeSchema,
  recallConfirmationRecordSchema,
  recallConfirmationRegistrySchema,
  recallConfirmationReservationSchema,
  recallConfirmationTargetIdentitySchema,
  recallReservationMarkerSchema,
  staleRecallReservationSchema,
  type RecallConfirmationFinalTarget,
  type RecallConfirmationOutcome,
  type RecallConfirmationRecord,
  type RecallConfirmationRegistry,
  type RecallConfirmationTargetIdentity,
  type RecallReservationMarker,
  type StaleRecallReservation,
} from './protocol-schemas.js';
