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
    readonly code: 'REQUEST_CONFLICT' | 'REPLAY_STATE_DIVERGED' | 'INVALID_TRANSITION_RECEIPT',
    message: string,
  ) {
    super(message);
    this.name = 'TransitionReceiptError';
  }
}

function sameFence(left: TransitionFence, right: TransitionFence): boolean {
  return stableJsonUtf8(left) === stableJsonUtf8(right);
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
): ReplayOrApplyTransitionResult {
  const request = transitionRequestSchema.parse(requestInput);
  const existing = records.find(record => record.request_id === request.request_id);
  if (existing) {
    const parsed = persistedTransitionRecordSchema.parse(existing);
    if (parsed.payload.normalized_request_hash !== request.normalized_request_hash) {
      throw new TransitionReceiptError(
        'REQUEST_CONFLICT',
        `request_id ${request.request_id} was already used with a different normalized request hash`,
      );
    }
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
    || outcome.operation !== request.operation) {
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
