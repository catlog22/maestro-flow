// chain-admin coverage — predefined-chain session creation + the three chain
// edit verbs (insert / skip / replace) and the createRalphSession delegation.
//
// Covers: chain-file build (steps + decision_points + position/decomposition land
// correctly, step_id convention, schema rejects malformed input); empty-chain
// create; insert position validation (legal insert after active step / rejected
// insert before the active position); skip only pending + skipped not selected by
// nextPendingIndex; replace only pending; deriveSessionId slug vs explicit id.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chainDefinitionSchema,
  chainStepId,
  createChainSession,
  deriveSessionId,
  insertChainStep,
  replaceChainStep,
  skipChainStep,
  type ChainDefinition,
} from './chain-admin.js';
import { nextPendingIndex } from './chain.js';
import { SessionStore } from './store.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'chain-admin-'));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function fullDefinition(): ChainDefinition {
  return {
    intent: 'ship the feature',
    engine: 'ralph',
    quality_mode: 'full',
    auto_mode: true,
    steps: [
      { command: 'analyze', args: '--session s', stage: 'analyze', goal_ref: 'G1' },
      { command: 'plan', stage: 'plan' },
      { command: 'execute', stage: 'execute', retry_max: 3 },
      { command: 'post-execute', decision_ref: 'post-execute' },
    ],
    decision_points: [
      { point_id: 'post-execute', after_step_id: 'step-002-execute', max_retries: 2 },
    ],
    position: { lifecycle: 'execute', phase: 1, milestone: 'M1', passed_gates: ['g1'] },
    decomposition: {
      execution_criteria: ['builds', 'tests pass'],
      goals: [{ id: 'G1', goal: 'do the thing', status: 'pending' }],
      changelog: [],
    },
  };
}

describe('createChainSession — predefined chain', () => {
  it('builds chain, decision_points, position and decomposition from a definition', () => {
    const projectRoot = root();
    const { sessionId, session } = createChainSession(projectRoot, 'feat-x', {
      definition: fullDefinition(),
    });

    expect(sessionId).toMatch(/^feat-x-\d{8}-\d{6}$/);
    const o = session.orchestration;
    expect(o.engine).toBe('ralph');
    expect(o.quality_mode).toBe('full');
    expect(o.auto_mode).toBe(true);
    expect(o.chain).toHaveLength(4);

    // step_id convention: step-{NNN}-{command}
    expect(o.chain[0].step_id).toBe('step-000-analyze');
    expect(o.chain[2].step_id).toBe('step-002-execute');
    expect(o.chain.every(s => s.status === 'pending')).toBe(true);
    expect(o.chain.every(s => s.inserted_by === 'build')).toBe(true);

    // execution steps carry retry; decision node does not
    expect(o.chain[0].retry).toEqual({ count: 0, max: 2 });
    expect(o.chain[2].retry).toEqual({ count: 0, max: 3 });
    expect(o.chain[3].retry).toBeUndefined();
    expect(o.chain[3].decision_ref).toBe('post-execute');
    expect(o.chain[0].args).toBe('--session s');
    expect(o.chain[0].goal_ref).toBe('G1');

    expect(o.decision_points).toHaveLength(1);
    expect(o.decision_points[0]).toMatchObject({
      point_id: 'post-execute',
      after_step_id: 'step-002-execute',
      status: 'pending',
      retry_count: 0,
      max_retries: 2,
      evidence_ref: null,
    });

    expect(o.position).toMatchObject({ lifecycle: 'execute', phase: 1, milestone: 'M1', passed_gates: ['g1'] });
    expect(o.decomposition?.execution_criteria).toEqual(['builds', 'tests pass']);
    expect(o.decomposition?.goals).toHaveLength(1);
  });

  it('persists the session so it round-trips through the store', () => {
    const projectRoot = root();
    const { sessionId } = createChainSession(projectRoot, 'feat-y', { definition: fullDefinition() });
    const store = new SessionStore(projectRoot);
    const reloaded = store.readBundle(sessionId).session;
    expect(reloaded.schema_version).toBe('session/1.3');
    expect(reloaded.orchestration.chain).toHaveLength(4);
  });

  it('rejects path traversal and duplicate explicit session IDs', () => {
    const projectRoot = root();
    expect(() => createChainSession(projectRoot, '../escape', { intent: 'x' })).toThrow(/Invalid session ID/);
    createChainSession(projectRoot, 'fixed-20260717-000000', { intent: 'first' });
    expect(() => createChainSession(projectRoot, 'fixed-20260717-000000', { intent: 'second' }))
      .toThrow(/already exists/);
  });

  it('--intent overrides the intent inside the chain definition', () => {
    const projectRoot = root();
    const { sessionId } = createChainSession(projectRoot, 'feat-z', {
      intent: 'override intent',
      definition: fullDefinition(),
    });
    const store = new SessionStore(projectRoot);
    expect(store.readBundle(sessionId).session.intent).toBe('override intent');
  });

  it('creates an empty-chain session when no definition is passed', () => {
    const projectRoot = root();
    const { sessionId, session } = createChainSession(projectRoot, 'bare', { intent: 'just intent' });
    expect(session.orchestration.chain).toHaveLength(0);
    expect(session.orchestration.engine).toBe('manual');
    expect(session.intent).toBe('just intent');
    expect(sessionId).toMatch(/^bare-\d{8}-\d{6}$/);
  });

  it('throws when no intent is available', () => {
    const projectRoot = root();
    expect(() => createChainSession(projectRoot, 'noi', {})).toThrow(/intent is required/);
  });
});

describe('chainDefinitionSchema — input validation', () => {
  it('rejects an empty steps array', () => {
    expect(() => chainDefinitionSchema.parse({ intent: 'x', steps: [] })).toThrow();
  });

  it('rejects an unknown engine', () => {
    expect(() => chainDefinitionSchema.parse({ intent: 'x', engine: 'bogus', steps: [{ command: 'a' }] })).toThrow();
  });

  it('rejects a step missing command', () => {
    expect(() => chainDefinitionSchema.parse({ intent: 'x', steps: [{ args: 'a' }] })).toThrow();
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(() => chainDefinitionSchema.parse({ intent: 'x', steps: [{ command: 'a' }], bogus: 1 })).toThrow();
  });

  it('rejects decision steps without a matching decision point', () => {
    expect(() => chainDefinitionSchema.parse({
      steps: [{ command: 'gate', decision_ref: 'DP-missing' }],
      decision_points: [],
    })).toThrow(/no matching decision point/);
  });
});

describe('deriveSessionId', () => {
  it('appends a timestamp to a plain slug', () => {
    expect(deriveSessionId('my-feature')).toMatch(/^my-feature-\d{8}-\d{6}$/);
  });

  it('uses an explicit ralph-style id verbatim', () => {
    expect(deriveSessionId('ralph-20260716-123456')).toBe('ralph-20260716-123456');
  });

  it('uses a 14-digit-tail id verbatim', () => {
    expect(deriveSessionId('sess-20260716123456')).toBe('sess-20260716123456');
  });
});

describe('chainStepId', () => {
  it('zero-pads the index to 3 digits', () => {
    expect(chainStepId(0, 'analyze')).toBe('step-000-analyze');
    expect(chainStepId(12, 'execute')).toBe('step-012-execute');
  });
});

// ── insert ───────────────────────────────────────────────────────────────────

function seededSession(projectRoot: string, statuses: string[]): string {
  const { sessionId } = createChainSession(projectRoot, 'edit', {
    intent: 'edit target',
    definition: {
      intent: 'edit target',
      steps: statuses.map((_, i) => ({ command: `cmd${i}` })),
    },
  });
  // Overlay the desired statuses directly (createChainSession always starts all
  // pending; tests need mixed states to exercise the boundary).
  const store = new SessionStore(projectRoot);
  store.update(sessionId, (draft) => {
    draft.session.orchestration.chain.forEach((step, i) => { step.status = statuses[i]; });
    return null;
  });
  return sessionId;
}

describe('insertChainStep', () => {
  it('does not create step-001-fix-2 when an insert request is replayed', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['running', 'pending']);
    const store = new SessionStore(projectRoot);
    const before = store.readBundle(sessionId).session;
    const after = before.orchestration.chain[0].step_id;
    const transition = {
      requestId: 'req-insert-fix-once',
      expectedIdentityRevision: before.identity_revision,
      expectedActivityRevision: before.activity_revision,
    };
    const first = insertChainStep(projectRoot, sessionId, {
      after, command: 'fix', insertedBy: 'test', transition,
    });
    const replay = insertChainStep(projectRoot, sessionId, {
      after, command: 'fix', insertedBy: 'test', transition,
    });
    expect(first.transition.status).toBe('applied');
    expect(replay.transition.status).toBe('replayed');
    const serialized = JSON.stringify(store.readBundle(sessionId).session.orchestration.chain);
    expect(serialized.match(/step-001-fix/g)).toHaveLength(1);
    expect(serialized).not.toContain('step-001-fix-2');
  });

  it('inserts after the active (running) step — the fix-loop case', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'running', 'pending']);
    const store = new SessionStore(projectRoot);
    const runningStepId = store.readBundle(sessionId).session.orchestration.chain[1].step_id;

    const inserted = insertChainStep(projectRoot, sessionId, {
      after: runningStepId,
      command: 'debug',
      insertedBy: 'post-execute',
    });

    const chain = store.readBundle(sessionId).session.orchestration.chain;
    expect(chain).toHaveLength(4);
    expect(chain[2]).toMatchObject({ command: 'debug', status: 'pending', inserted_by: 'post-execute' });
    expect(chain[2].step_id).toBe('step-002-debug');
    expect(inserted.step_id).toBe('step-002-debug');
    expect(inserted.retry).toEqual({ count: 0, max: 2 });
  });

  it('accepts a numeric index for --after', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'pending', 'pending']);
    insertChainStep(projectRoot, sessionId, { after: '1', command: 'extra', insertedBy: 'manual' });
    const store = new SessionStore(projectRoot);
    const chain = store.readBundle(sessionId).session.orchestration.chain;
    expect(chain[2].command).toBe('extra');
  });

  it('rejects inserting before the active position', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'running', 'pending']);
    const store = new SessionStore(projectRoot);
    const completedStepId = store.readBundle(sessionId).session.orchestration.chain[0].step_id;

    expect(() =>
      insertChainStep(projectRoot, sessionId, { after: completedStepId, command: 'x', insertedBy: 'manual' }),
    ).toThrow(/cannot insert before the active position/);
  });

  it('rejects an out-of-range index and an unknown step_id', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['pending', 'pending']);
    expect(() => insertChainStep(projectRoot, sessionId, { after: '9', command: 'x', insertedBy: 'm' })).toThrow(/out of range/);
    expect(() => insertChainStep(projectRoot, sessionId, { after: 'nope', command: 'x', insertedBy: 'm' })).toThrow(/after step not found/);
  });

  it('inserts a decision node without a retry counter', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['running', 'pending']);
    const store = new SessionStore(projectRoot);
    const runningStepId = store.readBundle(sessionId).session.orchestration.chain[0].step_id;
    const inserted = insertChainStep(projectRoot, sessionId, {
      after: runningStepId,
      command: 'decision:gate',
      insertedBy: 'post-goal-audit',
      decisionRef: 'post-goal-audit',
    });
    expect(inserted.decision_ref).toBe('post-goal-audit');
    expect(inserted.retry).toBeUndefined();
    expect(store.readBundle(sessionId).session.orchestration.decision_points[0]).toMatchObject({
      point_id: 'post-goal-audit', status: 'pending', retry_count: 0, max_retries: 2,
    });
  });

  it('keeps inserted step IDs unique when the command matches the pending tail', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['running', 'pending']);
    const store = new SessionStore(projectRoot);
    const chain = store.readBundle(sessionId).session.orchestration.chain;
    const inserted = insertChainStep(projectRoot, sessionId, {
      after: chain[0].step_id,
      command: chain[1].command,
      insertedBy: 'test',
    });
    const ids = store.readBundle(sessionId).session.orchestration.chain.map(step => step.step_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(inserted.step_id).not.toBe(chain[1].step_id);
  });
});

// ── skip ───────────────────────────────────────────────────────────────────

describe('skipChainStep', () => {
  it('marks a pending step skipped and it is not selected by nextPendingIndex', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'pending', 'pending']);
    const store = new SessionStore(projectRoot);
    const firstPendingId = store.readBundle(sessionId).session.orchestration.chain[1].step_id;

    skipChainStep(projectRoot, sessionId, firstPendingId);

    const session = store.readBundle(sessionId).session;
    expect(session.orchestration.chain[1].status).toBe('skipped');
    // nextPendingIndex now skips index 1 and lands on the next pending (index 2)
    expect(nextPendingIndex(session)).toBe(2);
  });

  it('rejects skipping a non-pending step', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'running']);
    const store = new SessionStore(projectRoot);
    const chain = store.readBundle(sessionId).session.orchestration.chain;
    expect(() => skipChainStep(projectRoot, sessionId, chain[0].step_id)).toThrow(/only pending steps can be skipped/);
    expect(() => skipChainStep(projectRoot, sessionId, chain[1].step_id)).toThrow(/only pending steps can be skipped/);
  });

  it('rejects an unknown step_id', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['pending']);
    expect(() => skipChainStep(projectRoot, sessionId, 'nope')).toThrow(/chain step not found/);
  });
});

// ── replace ──────────────────────────────────────────────────────────────────

describe('replaceChainStep', () => {
  it('replaces a pending step in place and regenerates step_id on command change', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['completed', 'pending']);
    const store = new SessionStore(projectRoot);
    const targetId = store.readBundle(sessionId).session.orchestration.chain[1].step_id;

    const replaced = replaceChainStep(projectRoot, sessionId, targetId, {
      command: 'newcmd',
      args: '--flag',
      stage: 'plan',
      goalRef: 'G2',
    });

    expect(replaced.command).toBe('newcmd');
    expect(replaced.step_id).toBe('step-001-newcmd');
    expect(replaced.args).toBe('--flag');
    expect(replaced.stage).toBe('plan');
    expect(replaced.goal_ref).toBe('G2');
  });

  it('keeps the step_id when command is unchanged', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['pending']);
    const store = new SessionStore(projectRoot);
    const targetId = store.readBundle(sessionId).session.orchestration.chain[0].step_id;
    const replaced = replaceChainStep(projectRoot, sessionId, targetId, { args: '--only-args' });
    expect(replaced.step_id).toBe(targetId);
    expect(replaced.args).toBe('--only-args');
  });

  it('rejects replacing a non-pending step', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['running']);
    const store = new SessionStore(projectRoot);
    const targetId = store.readBundle(sessionId).session.orchestration.chain[0].step_id;
    expect(() => replaceChainStep(projectRoot, sessionId, targetId, { command: 'x' })).toThrow(/only pending steps can be replaced/);
  });

  it('rejects an unknown step_id', () => {
    const projectRoot = root();
    const sessionId = seededSession(projectRoot, ['pending']);
    expect(() => replaceChainStep(projectRoot, sessionId, 'nope', { args: 'x' })).toThrow(/chain step not found/);
  });
});
