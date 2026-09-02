import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync,} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createChainSession } from './chain-admin.js';
import {
  continuationAfterDecide,
  continuationForNextFailure,
  inspectSessionContinuation,
  renderContinuationCard,
} from './continuation.js';
import { SessionStore } from './store.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-continuation-'));

  v2Workspace(path);
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('canonical Run continuation', () => {
  it('dispatches a confirmed pending step for manual engine without requiring -y', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'manual', {
      intent: 'continue manual chain',
      engine: 'manual',
      definition: { steps: [{ command: 'plan' }] },
    });

    const result = inspectSessionContinuation(projectRoot, created.sessionId);
    expect(result).toMatchObject({
      schema_version: 'run-continuation/1.0',
      action: 'dispatch_next',
      authority: 'automatic',
      auto_mode: false,
      reason_code: 'MORE_STEPS',
      command: `maestro run next --session ${created.sessionId} --json`,
    });
    expect(renderContinuationCard(result)).toContain('`suggest_only` means the CLI is passive');
  });

  it('persists auto mode in the directive but keeps normal dispatch automatic', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'auto', {
      intent: 'continue auto chain',
      engine: 'manual',
      autoMode: true,
      definition: { steps: [{ command: 'execute' }] },
    });

    expect(inspectSessionContinuation(projectRoot, created.sessionId)).toMatchObject({
      action: 'dispatch_next',
      authority: 'automatic',
      auto_mode: true,
    });
  });

  it('surfaces a decision as an automatic formal node without allocating a Run', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'decision', {
      intent: 'evaluate quality before execution',
      engine: 'ralph',
      definition: {
        steps: [
          { command: 'quality-gate', decision_ref: 'DP-quality' },
          { command: 'execute' },
        ],
        decision_points: [{ point_id: 'DP-quality', after_step_id: null, max_retries: 2 }],
      },
    });

    const result = inspectSessionContinuation(projectRoot, created.sessionId);
    expect(result).toMatchObject({
      action: 'evaluate_decision',
      authority: 'automatic',
      reason_code: 'DECISION_REQUIRED',
      run_id: null,
    });
    expect(result.preconditions).toEqual(expect.arrayContaining([
      'decision_point=DP-quality',
      'do not allocate an execution Run for a decision node',
    ]));
    expect(renderContinuationCard(result)).toContain('- decision_point=DP-quality');
  });

  it('does not loop a fix decision without new repair evidence', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'decision-fix', {
      intent: 'repair before re-evaluation',
      engine: 'ralph',
      definition: {
        steps: [{ command: 'quality-gate', decision_ref: 'DP-quality' }],
        decision_points: [{ point_id: 'DP-quality', after_step_id: null, max_retries: 2 }],
      },
    });

    expect(continuationAfterDecide(
      projectRoot,
      created.sessionId,
      'DP-quality',
      'fix',
      { count: 1, max: 2, exhausted: false },
    )).toMatchObject({
      action: 'repair_chain',
      authority: 'user_required',
      reason_code: 'DECISION_FIX_REQUIRED',
      command: null,
    });
  });

  it('does not request run next again after the decision card is already loaded', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'decision-card', {
      intent: 'evaluate one loaded card',
      engine: 'ralph',
      definition: {
        steps: [{ command: 'quality-gate', decision_ref: 'DP-quality' }],
        decision_points: [{ point_id: 'DP-quality', after_step_id: null, max_retries: 2 }],
      },
    });

    expect(continuationForNextFailure(
      projectRoot,
      created.sessionId,
      'DECISION_REQUIRED',
      'canonical decision card',
    )).toMatchObject({
      action: 'evaluate_decision',
      authority: 'automatic',
      reason_code: 'DECISION_CARD_READY',
      command: null,
      preconditions: expect.arrayContaining([
        'do not call run next again for this decision card',
      ]),
    });
  });

  it('requires audited recovery for a paused Session', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'paused', {
      intent: 'recover paused chain',
      definition: { steps: [{ command: 'review' }] },
    });
    new SessionStore(projectRoot).update(created.sessionId, draft => {
      draft.session.status = 'paused';
      return null;
    });

    expect(inspectSessionContinuation(projectRoot, created.sessionId)).toMatchObject({
      action: 'recover_session',
      authority: 'user_required',
      reason_code: 'SESSION_PAUSED',
      command: null,
    });
  });

  it('seals a drained running chain instead of inventing another command', () => {
    const projectRoot = root();
    const created = createChainSession(projectRoot, 'drained', {
      intent: 'seal drained chain',
      definition: { steps: [{ command: 'test' }] },
    });
    new SessionStore(projectRoot).update(created.sessionId, draft => {
      draft.session.orchestration.chain[0].status = 'sealed';
      return null;
    });

    expect(inspectSessionContinuation(projectRoot, created.sessionId)).toMatchObject({
      action: 'seal_session',
      authority: 'automatic',
      reason_code: 'CHAIN_COMPLETE',
      command: `maestro run seal-session ${created.sessionId} --json`,
    });
  });
});

function v3Workspace(root: string): void {
  mkdirSync(join(root, '.workflow'), { recursive: true });
  writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }));
}

function writeV3Session(root: string, input: {
  sessionId: string;
  status?: 'open' | 'completed' | 'archived' | 'failed';
  chainStatus?: 'pending' | 'running' | 'completed';
  activeRunIds?: string[];
  decisionRef?: string | null;
}): void {
  const sessionDir = join(root, '.workflow', 'sessions', input.sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'session.json'), `${JSON.stringify({
    schema_version: 'session/3.0',
    session_id: input.sessionId,
    objective: 'v3 continuation',
    definition_of_done: 'inspect without readBundle',
    status: input.status ?? 'open',
    orchestration_revision: 0,
    activity_revision: 0,
    chain: [{
      step_id: 'step-1',
      command: 'implement',
      args: [],
      status: input.chainStatus ?? 'pending',
      run_ids: input.activeRunIds ?? [],
      goal_ref: null,
      decision_ref: input.decisionRef ?? null,
      decision_refs: [],
    }],
    decisions: input.decisionRef
      ? [{ decision_id: input.decisionRef, after_step_id: 'step-1', status: 'open', evidence_refs: [] }]
      : [],
    active_run_ids: input.activeRunIds ?? [],
    artifacts_ref: 'artifacts.json',
    evidence_ref: 'evidence.json',
    created_at: '2026-08-24T00:00:00.000Z',
    updated_at: '2026-08-24T00:00:00.000Z',
    completed_at: input.status === 'completed' ? '2026-08-24T01:00:00.000Z' : null,
    archived_at: null,
  }, null, 2)}\n`);
  writeFileSync(join(sessionDir, 'artifacts.json'), `${JSON.stringify({
    schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
  }, null, 2)}\n`);
}

describe('session/3.0 continuation', () => {
  it('does not call readBundle and points at v3 run next', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-continuation-v3-'));
    roots.push(projectRoot);
    v3Workspace(projectRoot);
    writeV3Session(projectRoot, { sessionId: 's-v3' });

    expect(inspectSessionContinuation(projectRoot, 's-v3')).toMatchObject({
      schema_version: 'run-continuation/1.0',
      action: 'dispatch_next',
      authority: 'automatic',
      auto_mode: false,
      reason_code: 'MORE_STEPS',
      session_id: 's-v3',
    });
    const result = inspectSessionContinuation(projectRoot, 's-v3');
    expect(result.command).toContain('maestro run next --session s-v3');
    expect(result.command).toContain('--expected-orchestration-revision 0');
  });

  it('loads a unique active v3 Run via run brief', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-continuation-v3-run-'));
    roots.push(projectRoot);
    v3Workspace(projectRoot);
    writeV3Session(projectRoot, {
      sessionId: 's-v3',
      chainStatus: 'running',
      activeRunIds: ['run-1'],
    });
    const store = new SessionStore(projectRoot);
    store.writeRunV30({
      schema_version: 'run/3.0',
      run_id: 'run-1',
      session_id: 's-v3',
      step_id: 'step-1',
      parent_run_id: null,
      retry_of_run_id: null,
      attempt: 1,
      command: 'implement',
      args: [],
      goal: null,
      status: 'running',
      revision: 0,
      actor_id: 'actor',
      input_refs: [],
      output_refs: [],
      primary_artifact_id: null,
      verdict: null,
      summary: null,
      created_at: '2026-08-24T00:00:00.000Z',
      started_at: '2026-08-24T00:01:00.000Z',
      ended_at: null,
      sealed_at: null,
    });

    expect(inspectSessionContinuation(projectRoot, 's-v3')).toMatchObject({
      action: 'load_run',
      reason_code: 'RUN_ACTIVE',
      run_id: 'run-1',
      command: 'maestro run brief run-1 --session s-v3 --json',
    });
  });

  it('stops a terminal v3 Session without using the legacy bundle', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-continuation-v3-done-'));
    roots.push(projectRoot);
    v3Workspace(projectRoot);
    writeV3Session(projectRoot, { sessionId: 's-v3', status: 'completed', chainStatus: 'completed' });

    expect(inspectSessionContinuation(projectRoot, 's-v3')).toMatchObject({
      action: 'stop',
      reason_code: 'SESSION_TERMINAL',
      command: null,
    });
  });
});
