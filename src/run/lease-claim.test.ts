// M6 — `run next` lease claim (§1.4): a session with a null/empty-owner lease has
// the claim written on advance; a matching owner renews; a conflicting owner is
// refused (exit 1) and the chain is never advanced. Also unit-tests claimLease.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNextStep } from './next.js';
import { checkLease, claimLease } from './lease.js';
import { SessionStore } from './store.js';
import { writeStateJson, migrateV1toV2 } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-lease-'));
  roots.push(path);
  return path;
}

function stepCommand(projectRoot: string, name: string): void {
  const cmdDir = join(projectRoot, '.claude', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, `${name}.md`), `<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n`, 'utf8');
  const wfDir = join(projectRoot, 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, `${name}.md`), `# ${name}\n\nwork\n`, 'utf8');
}

function seedSession(
  projectRoot: string,
  sessionId: string,
  lease: SessionState['orchestration']['lease'],
): void {
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, `intent ${sessionId}`);
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'coordinator';
    draft.session.orchestration.chain = [{
      step_id: 'step-000-demo',
      command: 'demo',
      status: 'pending',
      run_id: null,
      inserted_by: 'test',
      decision_ref: null,
    }];
    draft.session.orchestration.lease = lease;
    return null;
  });
  const state = migrateV1toV2({ project_name: 'demo', status: 'active' });
  state.sessions = [{
    session_id: sessionId, intent: `intent ${sessionId}`, status: 'running',
    depends_on: [], roadmap_artifact_id: null, seed_ref: null,
  }];
  writeStateJson(projectRoot, state);
}

function leaseOf(projectRoot: string, sessionId: string): SessionState['orchestration']['lease'] {
  return new SessionStore(projectRoot).readBundle(sessionId).session.orchestration.lease;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

// ── claimLease unit ─────────────────────────────────────────────────────────────

describe('claimLease', () => {
  it('returns null without an execution owner (no write)', () => {
    expect(claimLease(null, {})).toBeNull();
    expect(claimLease({ owner: null, epoch: 0, id: null }, { leaseId: 'L1' })).toBeNull();
  });

  it('mints a fresh lease on a null-lease session', () => {
    expect(claimLease(null, { executionOwner: 'ralph-execute', leaseId: 'L1', ownerEpoch: 3 }))
      .toEqual({ owner: 'ralph-execute', epoch: 3, id: 'L1' });
  });

  it('carries current epoch/id on renewal when claim omits them', () => {
    expect(claimLease({ owner: 'ralph-execute', epoch: 5, id: 'L9' }, { executionOwner: 'ralph-execute' }))
      .toEqual({ owner: 'ralph-execute', epoch: 5, id: 'L9' });
  });

  it('defaults epoch 0 / id null on a fresh owner-less lease', () => {
    expect(claimLease({ owner: null, epoch: 0, id: null }, { executionOwner: 'ralph-execute' }))
      .toEqual({ owner: 'ralph-execute', epoch: 0, id: null });
  });
});

// ── run next integration ─────────────────────────────────────────────────────────

describe('run next — lease claim', () => {
  it('claims an unowned session on advance', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', null);

    const outcome = runNextStep(projectRoot, {
      sessionId: 's',
      executionOwner: 'ralph-execute',
      leaseId: 'L1',
      ownerEpoch: 1,
    });
    expect(outcome.exitCode).toBe(0);
    expect(leaseOf(projectRoot, 's')).toEqual({ owner: 'ralph-execute', epoch: 1, id: 'L1' });
  });

  it('renews a matching-owner lease and advances', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', { owner: 'ralph-execute', epoch: 2, id: 'L2' });

    const outcome = runNextStep(projectRoot, {
      sessionId: 's',
      executionOwner: 'ralph-execute',
      leaseId: 'L2',
      ownerEpoch: 2,
    });
    expect(outcome.exitCode).toBe(0);
    expect(leaseOf(projectRoot, 's')).toEqual({ owner: 'ralph-execute', epoch: 2, id: 'L2' });
  });

  it('refuses a conflicting owner (exit 1) and never advances the chain', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', { owner: 'ralph-execute', epoch: 1, id: 'L1' });

    const outcome = runNextStep(projectRoot, {
      sessionId: 's',
      executionOwner: 'intruder',
      leaseId: 'L1',
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('lease conflict');
    // Chain untouched; lease untouched.
    const orch = new SessionStore(projectRoot).readBundle('s').session.orchestration;
    expect(orch.chain[0].status).toBe('pending');
    expect(orch.lease).toEqual({ owner: 'ralph-execute', epoch: 1, id: 'L1' });
  });

  it('leaves a leaseless session leaseless when no owner is claimed', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', null);

    const outcome = runNextStep(projectRoot, { sessionId: 's' });
    expect(outcome.exitCode).toBe(0);
    expect(leaseOf(projectRoot, 's')).toBeNull();
  });

  it('checkLease sees the written lease on the next call (fencing)', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo');
    seedSession(projectRoot, 's', null);
    runNextStep(projectRoot, { sessionId: 's', executionOwner: 'ralph-execute', leaseId: 'L1', ownerEpoch: 1 });

    const lease = leaseOf(projectRoot, 's');
    expect(checkLease(lease, { executionOwner: 'other', leaseId: 'L1' })).toContain('lease conflict');
    expect(checkLease(lease, { executionOwner: 'ralph-execute', leaseId: 'L1' })).toContain('epoch');
    expect(checkLease(lease, { executionOwner: 'ralph-execute', leaseId: 'L1', ownerEpoch: 1 })).toBeNull();
  });
});
