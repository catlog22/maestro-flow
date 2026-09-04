import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * A process-wide lease for the one persistent wiki-cache publisher.
 *
 * The lease is deliberately a small, independently-owned file rather than a
 * lock held by a JavaScript process.  `open(..., 'wx')` is the linearization
 * point: a daemon and a one-shot Dashboard publisher can never both believe
 * that they own publication.  Release is compare-and-delete, so a delayed
 * cleanup from an old owner cannot remove a successor's lease.
 */
export const WIKI_PUBLISHER_LEASE_FILE = 'wiki-index-publisher.lock';
const RECLAIM_SUFFIX = '.reclaim';
const LEASE_WAIT_MS = 2_000;

export interface WikiPublisherLease {
  readonly path: string;
  readonly token: string;
  readonly serialized: string;
  release(): void;
}

export interface WikiPublisherLeaseRecord {
  pid: number;
  token: string;
  startedAt: string;
}

function leasePath(workflowRoot: string): string {
  return join(resolve(workflowRoot), WIKI_PUBLISHER_LEASE_FILE);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be probed (for example a
    // protected Windows process); only ESRCH/invalid-PID outcomes are stale.
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

function readLease(path: string): { record: WikiPublisherLeaseRecord; serialized: string } | null {
  try {
    const serialized = readFileSync(path, 'utf8');
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<WikiPublisherLeaseRecord>;
    const pid = record.pid;
    const token = record.token;
    const startedAt = record.startedAt;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0
      || typeof token !== 'string' || token.length === 0
      || typeof startedAt !== 'string' || startedAt.length === 0) return null;
    return {
      record: {
        pid,
        token,
        startedAt,
      },
      serialized,
    };
  } catch {
    return null;
  }
}

function ownedLease(path: string, token: string, serialized: string): WikiPublisherLease {
  return {
    path,
    token,
    serialized,
    release: () => {
      // Reuse the reclaim guard to serialize release with stale-owner
      // arbitration. Without this, a stale reclaimer could remove the path
      // between our compare and unlink, allowing a successor to appear before
      // the delayed cleanup deletes that successor.
      const guardPath = `${path}${RECLAIM_SUFFIX}`;
      const guardToken = `release:${token}:${randomUUID()}`;
      let guardOwned = false;
      try {
        const fd = openSync(guardPath, 'wx', 0o600);
        try { writeFileSync(fd, guardToken, 'utf8'); } finally { closeSync(fd); }
        guardOwned = true;
        if (readFileSync(path, 'utf8') === serialized) unlinkSync(path);
      } catch {
        // A successor may already own the lease, or another reclaimer owns
        // arbitration. In either case, fail closed and preserve the file.
      } finally {
        if (guardOwned) {
          try {
            if (readFileSync(guardPath, 'utf8') === guardToken) unlinkSync(guardPath);
          } catch { /* already released */ }
        }
      }
    },
  };
}

function tryTake(path: string): WikiPublisherLease | null {
  const token = randomUUID();
  const serialized = JSON.stringify({
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  } satisfies WikiPublisherLeaseRecord);
  try {
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(fd, serialized, 'utf8');
    } finally {
      closeSync(fd);
    }
    return ownedLease(path, token, serialized);
  } catch {
    return null;
  }
}

/**
 * Acquire the publisher lease, reclaiming only a provably stale owner.
 *
 * Malformed or unreadable lease files are treated as held (fail closed). A
 * dead owner is reclaimed under a short secondary `wx` guard, and the target
 * contents are compared immediately before unlinking. This prevents a stale
 * reclaimer from deleting a fresh daemon lease that won the race.
 */
export function acquireWikiPublisherLease(workflowRoot: string): WikiPublisherLease | null {
  const path = leasePath(workflowRoot);
  const deadline = Date.now() + LEASE_WAIT_MS;
  while (Date.now() <= deadline) {
    const direct = tryTake(path);
    if (direct) return direct;

    const held = readLease(path);
    // Existing malformed or unreadable files are an ownership boundary. Do
    // not guess that they are stale and do not unlink them.
    if (!held || processIsAlive(held.record.pid)) return null;

    const reclaimPath = `${path}${RECLAIM_SUFFIX}`;
    const reclaimToken = `${process.pid}:${randomUUID()}`;
    let reclaimed = false;
    try {
      const fd = openSync(reclaimPath, 'wx', 0o600);
      try {
        writeFileSync(fd, reclaimToken, 'utf8');
      } finally {
        closeSync(fd);
      }
      const current = readLease(path);
      if (current?.serialized === held.serialized) {
        try {
          unlinkSync(path);
          reclaimed = true;
        } catch {
          // Another process won removal; the next direct attempt arbitrates.
        }
      }
    } catch {
      // A live reclaimer owns the arbitration. Avoid deleting its guard.
    } finally {
      try {
        if (readFileSync(reclaimPath, 'utf8') === reclaimToken) unlinkSync(reclaimPath);
      } catch {
        // Best effort; a later owner can safely leave an old guard in place.
      }
    }

    if (reclaimed) continue;
    // The lease API is synchronous so it cannot sleep without blocking the
    // event loop. One additional arbitration attempt is enough; callers can
    // retry from their own async lifecycle if they need to wait.
    if (Date.now() >= deadline) return null;
    return null;
  }
  return null;
}

/** Return the canonical lease path for diagnostics/tests. */
export function getWikiPublisherLeasePath(workflowRoot: string): string {
  return leasePath(workflowRoot);
}

/** Read the current lease owner without mutating it. */
export function readWikiPublisherLease(workflowRoot: string): WikiPublisherLeaseRecord | null {
  const held = readLease(leasePath(workflowRoot));
  return held?.record ?? null;
}

/** Remove a lease only when its serialized owner still matches. */
export function releaseWikiPublisherLease(lease: WikiPublisherLease | null | undefined): void {
  lease?.release();
}

/**
 * A cheap existence check used by readers that must avoid publication. It is
 * intentionally conservative: an unreadable file still counts as held.
 */
export function hasWikiPublisherLease(workflowRoot: string): boolean {
  return existsSync(leasePath(workflowRoot));
}
