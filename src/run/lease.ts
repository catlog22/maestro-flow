// ---------------------------------------------------------------------------
// Lease guard — engine-agnostic concurrency check over
// `session.orchestration.lease`. When a session carries a non-null lease with a
// non-empty owner, `run next` / `run complete` must present the matching
// execution-owner / owner-epoch / lease-id triple or be refused.
//
// Semantics mirror the ralph lease rejection path (src/ralph/cmd-next.ts /
// cmd-complete.ts): a mismatch is a plain "lease conflict: ..." message that the
// caller surfaces on stderr with exit code 1. A null lease (or one with a null
// owner) imposes zero verification — non-leased sessions are unaffected.
// ---------------------------------------------------------------------------

import type { OrchestrationLease } from './schemas.js';

export interface LeaseClaim {
  executionOwner?: string;
  ownerEpoch?: number;
  leaseId?: string;
}

/**
 * Verify a claim against a session lease. Returns a conflict message (for the
 * caller to print on stderr before exiting 1) or null when the claim passes.
 *
 * A lease is inert unless it exists and names an owner: `null` lease or
 * `owner === null` short-circuits to null (no verification, no effect). When
 * active, each set field of the lease must match the claim:
 *   - `owner` ≠ executionOwner  → conflict (mirrors ralph execution_owner check)
 *   - `id`    ≠ leaseId         → conflict (mirrors ralph lease_id check)
 *   - `epoch` ≠ ownerEpoch      → conflict (epoch fencing; an active lease
 *                                 requires the complete owner/epoch/id claim)
 */
export function checkLease(
  lease: OrchestrationLease | null | undefined,
  claim: LeaseClaim,
): string | null {
  if (!lease || !lease.owner) return null;

  if (lease.owner !== claim.executionOwner) {
    return `lease conflict: session owned by "${lease.owner}", got "${claim.executionOwner ?? '<none>'}"`;
  }
  if (!lease.id) {
    return 'lease conflict: active session lease has no lease_id';
  }
  if (lease.id !== claim.leaseId) {
    return `lease conflict: session lease_id is "${lease.id}", got "${claim.leaseId ?? '<none>'}"`;
  }
  if (lease.epoch !== claim.ownerEpoch) {
    return `lease conflict: session epoch is ${lease.epoch}, got ${claim.ownerEpoch ?? '<none>'}`;
  }
  return null;
}

/**
 * The lease value after a claim, or null when nothing should be written. Mirrors
 * the ralph cmd-next claim path (`m.execution_owner = ...` after the step goes
 * live): a claim is written only when the caller supplies an executionOwner and
 * either the session has no active lease owner (fresh claim) or the existing
 * owner matches (renewal). A conflicting claim never reaches here — checkLease
 * rejects it upstream. An active owner always requires a complete epoch/id
 * fencing tuple; omitted fields are rejected instead of inherited or defaulted.
 *
 * Returns null (no write) when no executionOwner is supplied, so `run next`
 * without `--execution-owner` leaves a leaseless session leaseless.
 */
export function claimLease(
  lease: OrchestrationLease | null | undefined,
  claim: LeaseClaim,
): OrchestrationLease | null {
  if (!claim.executionOwner) return null;
  if (claim.ownerEpoch === undefined) {
    throw new Error('lease claim requires --owner-epoch when --execution-owner is set');
  }
  if (!claim.leaseId) {
    throw new Error('lease claim requires --lease-id when --execution-owner is set');
  }
  // A conflict would have been rejected by checkLease; persist the complete
  // fencing tuple supplied by this claim without inheriting omitted fields.
  return {
    owner: claim.executionOwner,
    epoch: claim.ownerEpoch,
    id: claim.leaseId,
  };
}
