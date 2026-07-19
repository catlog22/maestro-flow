import { createHash, randomUUID } from 'node:crypto';

import {
  persistedTransitionRecordSchema,
  transitionOutcomeSchema,
  transitionRequestSchema,
  type PersistedTransitionRecord,
  type TransitionFence,
  type TransitionOutcome,
  type TransitionRequest,
} from './protocol-schemas.js';
import type { LeaseClaim } from './lease.js';
import type { SessionState } from './schemas.js';

export interface TransitionMutationOptions {
  requestId: string;
  expectedIdentityRevision: number;
  expectedActivityRevision: number;
  leaseClaim?: LeaseClaim;
}

export interface TransitionMutationReceipt {
  request_id: string;
  transition_id: string;
  status: 'applied' | 'replayed';
}

export type TransitionMutationResult<T> = T & { transition: TransitionMutationReceipt };

export interface PreparedTransitionMutation {
  request: TransitionRequest;
  options: TransitionMutationOptions;
}

export function stableJsonUtf8(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

export function sha256Digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function normalizedTransitionRequestHash(
  request: Omit<TransitionRequest, 'normalized_request_hash'>,
): string {
  return sha256Digest(stableJsonUtf8(request));
}

export function createTransitionRequest(
  input: Omit<TransitionRequest, 'schema_version' | 'normalized_request_hash'>,
): TransitionRequest {
  const unhashed = {
    schema_version: 'transition-request/1.0' as const,
    ...input,
  };
  return transitionRequestSchema.parse({
    ...unhashed,
    normalized_request_hash: normalizedTransitionRequestHash(unhashed),
  });
}

export class TransitionReceiptError extends Error {
  constructor(
    readonly code: 'REQUEST_CONFLICT' | 'REPLAY_STATE_DIVERGED' | 'INVALID_TRANSITION_RECEIPT' | 'FENCE_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'TransitionReceiptError';
  }
}

function transitionRecord(
  session: SessionState,
  requestId: string,
): PersistedTransitionRecord | undefined {
  return session.requests.find(item => (
    item.type === 'transition' && item.request_id === requestId && 'outcome' in item
  )) as PersistedTransitionRecord | undefined;
}

function numberFromPayload(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function leaseFromPayload(value: unknown): LeaseClaim | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw.executionOwner === 'string' ? { executionOwner: raw.executionOwner } : {}),
    ...(typeof raw.ownerEpoch === 'number' ? { ownerEpoch: raw.ownerEpoch } : {}),
    ...(typeof raw.leaseId === 'string' ? { leaseId: raw.leaseId } : {}),
  };
}

/**
 * Prepare one normalized retryable mutation request. Existing receipts supply
 * their original timestamp, precondition fence and omitted guard values so a
 * caller may retry with only the same request ID without changing its hash.
 */
export function prepareTransitionMutation(input: {
  session: SessionState;
  currentFence: TransitionFence;
  operation: TransitionRequest['operation'];
  subject: TransitionRequest['subject'];
  payload: Record<string, unknown>;
  options?: Partial<TransitionMutationOptions>;
}): PreparedTransitionMutation {
  const requestId = input.options?.requestId?.trim() || `req_${randomUUID()}`;
  const existing = transitionRecord(input.session, requestId);
  const existingPayload = existing?.payload.payload ?? {};
  const expectedIdentityRevision = input.options?.expectedIdentityRevision
    ?? numberFromPayload(existingPayload.expected_identity_revision)
    ?? input.currentFence.session_identity_revision;
  const expectedActivityRevision = input.options?.expectedActivityRevision
    ?? numberFromPayload(existingPayload.expected_activity_revision)
    ?? input.currentFence.session_activity_revision;
  const leaseClaim = input.options?.leaseClaim ?? leaseFromPayload(existingPayload.lease);
  const options: TransitionMutationOptions = {
    requestId,
    expectedIdentityRevision,
    expectedActivityRevision,
    ...(leaseClaim ? { leaseClaim } : {}),
  };
  const payload = {
    ...input.payload,
    expected_identity_revision: expectedIdentityRevision,
    expected_activity_revision: expectedActivityRevision,
    lease: leaseClaim ?? {},
  };
  const subject = existing
    && existing.payload.subject.session_id === input.subject.session_id
    && existing.payload.subject.run_id === input.subject.run_id
    ? existing.payload.subject
    : input.subject;
  return {
    options,
    request: createTransitionRequest({
      request_id: requestId,
      operation: input.operation,
      subject,
      requested_at: existing?.payload.requested_at ?? new Date().toISOString(),
      preconditions: existing?.payload.preconditions ?? input.currentFence,
      payload,
    }),
  };
}

export function assertTransitionMutationRevisions(
  session: SessionState,
  options: TransitionMutationOptions,
): void {
  if (session.identity_revision !== options.expectedIdentityRevision) {
    throw new TransitionReceiptError(
      'FENCE_CONFLICT',
      `stale identity revision: expected ${options.expectedIdentityRevision}, current ${session.identity_revision}`,
    );
  }
  if (session.activity_revision !== options.expectedActivityRevision) {
    throw new TransitionReceiptError(
      'FENCE_CONFLICT',
      `stale activity revision: expected ${options.expectedActivityRevision}, current ${session.activity_revision}`,
    );
  }
}

export function transitionMutationReceipt(
  request: TransitionRequest,
  outcome: TransitionOutcome,
  replayed: boolean,
): TransitionMutationReceipt {
  return {
    request_id: request.request_id,
    transition_id: outcome.transition_id,
    status: replayed ? 'replayed' : 'applied',
  };
}

function sameFence(left: unknown, right: unknown): boolean {
  return stableJsonUtf8(left) === stableJsonUtf8(right);
}

function invalidReceipt(message: string): never {
  throw new TransitionReceiptError('INVALID_TRANSITION_RECEIPT', message);
}

function assertRequestHash(request: TransitionRequest): void {
  const { normalized_request_hash: _storedHash, ...unhashed } = request;
  if (normalizedTransitionRequestHash(unhashed) !== request.normalized_request_hash) {
    invalidReceipt(`transition request ${request.request_id} normalized request hash is invalid`);
  }
}

export function validatePersistedTransitionRecord(recordInput: unknown): PersistedTransitionRecord {
  const parsed = persistedTransitionRecordSchema.safeParse(recordInput);
  if (!parsed.success) invalidReceipt('persisted transition record does not satisfy its schema');
  const record = parsed.data;
  assertRequestHash(record.payload);
  if (sha256Digest(stableJsonUtf8(record.outcome.result)) !== record.outcome.result_hash) {
    invalidReceipt(`transition ${record.outcome.transition_id} result hash is invalid`);
  }
  if (record.request_id !== record.payload.request_id
    || record.request_id !== record.outcome.request_id
    || record.status !== record.outcome.status
    || record.payload.operation !== record.outcome.operation
    || !sameFence(record.payload.subject, record.outcome.subject)
    || record.outcome.request_hash !== record.payload.normalized_request_hash
    || record.claimed_by_run_id !== record.payload.subject.run_id
    || record.claimed_by_run_id !== record.outcome.subject.run_id) {
    invalidReceipt(`transition record ${record.request_id} is not cross-bound to its request and outcome`);
  }
  return record;
}

export interface ReplayOrApplyTransitionResult {
  outcome: TransitionOutcome;
  record: PersistedTransitionRecord;
  replayed: boolean;
}

/**
 * Pure replay gate. The caller owns the lock and persists `record` only when
 * `replayed` is false. Similarity/recall data is intentionally absent here.
 */
export function replayOrApplyTransition(
  records: readonly PersistedTransitionRecord[],
  requestInput: TransitionRequest,
  currentFence: TransitionFence,
  apply: () => TransitionOutcome,
  validateReplay?: (record: PersistedTransitionRecord) => void,
): ReplayOrApplyTransitionResult {
  const request = transitionRequestSchema.parse(requestInput);
  assertRequestHash(request);
  const parsedRecords = records.map(validatePersistedTransitionRecord);
  const existing = parsedRecords.find(record => record.request_id === request.request_id);
  if (existing) {
    const parsed = existing;
    if (parsed.payload.normalized_request_hash !== request.normalized_request_hash) {
      throw new TransitionReceiptError(
        'REQUEST_CONFLICT',
        `request_id ${request.request_id} was already used with a different normalized request hash`,
      );
    }
    validateReplay?.(parsed);
    if (!sameFence(parsed.outcome.postconditions, currentFence)) {
      throw new TransitionReceiptError(
        'REPLAY_STATE_DIVERGED',
        `request_id ${request.request_id} outcome no longer matches current authority revisions`,
      );
    }
    return { outcome: parsed.outcome, record: parsed, replayed: true };
  }

  const outcome = transitionOutcomeSchema.parse(apply());
  if (outcome.request_id !== request.request_id
    || outcome.request_hash !== request.normalized_request_hash
    || outcome.operation !== request.operation
    || !sameFence(outcome.subject, request.subject)
    || sha256Digest(stableJsonUtf8(outcome.result)) !== outcome.result_hash) {
    throw new TransitionReceiptError(
      'INVALID_TRANSITION_RECEIPT',
      `transition outcome does not bind request ${request.request_id}`,
    );
  }
  const record = persistedTransitionRecordSchema.parse({
    request_id: request.request_id,
    type: 'transition',
    status: outcome.status,
    payload: request,
    claimed_by_run_id: outcome.subject.run_id,
    outcome,
  });
  validatePersistedTransitionRecord(record);
  return { outcome, record, replayed: false };
}

export function createTransitionOutcome(
  input: Omit<TransitionOutcome, 'schema_version' | 'transition_id' | 'result_hash'> & {
    transition_id?: string;
  },
): TransitionOutcome {
  return transitionOutcomeSchema.parse({
    ...input,
    schema_version: 'transition-outcome/1.0',
    transition_id: input.transition_id ?? `tr_${randomUUID()}`,
    result_hash: sha256Digest(stableJsonUtf8(input.result)),
  });
}

export {
  persistedTransitionRecordSchema,
  transitionOutcomeSchema,
  transitionRequestSchema,
  type PersistedTransitionRecord,
  type TransitionFence,
  type TransitionOutcome,
  type TransitionRequest,
} from './protocol-schemas.js';
