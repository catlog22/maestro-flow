import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNextStep } from './next.js';
import { completeRun, createRun } from './runtime.js';
import { SessionStore } from './store.js';
import { writeStateJson, migrateV1toV2 } from '../utils/state-schema.js';
import type { SessionState } from './schemas.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-next-'));
  roots.push(path);
  return path;
}

function commandFile(projectRoot: string, name: string, contract: string): void {
  const dir = join(projectRoot, '.claude', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
}

/**
 * A step needs prepare-or-workflow content for `run next` to dispatch it, so pair
 * each command with a minimal workflow file. Use unique names to avoid resolving
 * against the installed global prepare/workflow set.
 */
function stepCommand(projectRoot: string, name: string, contract: string, body = 'workflow body'): void {
  commandFile(projectRoot, name, contract);
  const wfDir = join(projectRoot, 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, `${name}.md`), `# ${name}\n\n${body}\n`, 'utf8');
}

/** Write a prepare file with refs frontmatter for the given workflow base. */
function writePrepareWithRefs(projectRoot: string, base: string, refs: Array<{ path: string; when: string }>): void {
  const prepDir = join(projectRoot, 'prepare');
  mkdirSync(prepDir, { recursive: true });
  const refLines = refs.map(r => `  - path: ${r.path}\n    when: ${r.when}`).join('\n');
  writeFileSync(join(prepDir, `${base}.md`), `---\nrefs:\n${refLines}\n---\n# prepare ${base}\n`, 'utf8');
}

const PLAN_CONTRACT = `consumes: []
produces:
  - kind: plan
    primary: true
    path: outputs/plan.json
    alias: current-plan
gates:
  entry: []
  exit: []`;

const EXEC_CONTRACT = `consumes:
  - kind: plan
    alias: current-plan
    required: false
produces: []
gates:
  entry: []
  exit: []`;

interface ChainStepSeed {
  command: string;
  status?: string;
  decision_ref?: string | null;
}

function seedSession(
  projectRoot: string,
  sessionId: string,
  intent: string,
  steps: ChainStepSeed[],
  opts: { active?: boolean } = {},
): void {
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, intent);
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'coordinator';
    draft.session.orchestration.chain = steps.map((s, i) => ({
      step_id: `step-${String(i).padStart(3, '0')}-${s.command}`,
      command: s.command,
      status: s.status ?? 'pending',
      run_id: null,
      inserted_by: 'test',
      decision_ref: s.decision_ref ?? null,
    }));
    return null;
  });
  const state = migrateV1toV2({ project_name: 'demo', status: 'active' });
  state.sessions = [{
    session_id: sessionId,
    intent,
    status: 'running',
    depends_on: [],
    roadmap_artifact_id: null,
    seed_ref: null,
  }];
  if (opts.active) state.active_session_id = sessionId;
  writeStateJson(projectRoot, state);
}

function writePlanOutputs(projectRoot: string, sessionId: string, runId: string, summary: string): void {
  const dir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(dir, 'outputs', 'plan.json'), JSON.stringify({
    _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
    tasks: [{ id: 'T1' }],
  }, null, 2));
  writeFileSync(join(dir, 'report.md'), `---
verdict: ready
summary: ${summary}
constraints: []
decisions:
  - id: D1
    text: Chose the canonical store
    status: accepted
concerns: []
next: []
---
## 摘要
${summary}
`, 'utf8');
}

/** Write plan outputs whose handoff carries an explicit next[] suggestion list. */
function writePlanOutputsWithNext(
  projectRoot: string,
  sessionId: string,
  runId: string,
  summary: string,
  next: Array<{ command: string; reason: string; needs: string[] }>,
): void {
  const dir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(dir, 'outputs', 'plan.json'), JSON.stringify({
    _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
    tasks: [{ id: 'T1' }],
  }, null, 2));
  const nextYaml = next.map(n =>
    `  - command: ${n.command}\n    reason: ${n.reason}\n    needs: [${n.needs.join(', ')}]`,
  ).join('\n');
  writeFileSync(join(dir, 'report.md'), `---
verdict: ready
summary: ${summary}
constraints: []
decisions: []
concerns: []
next:
${nextYaml}
---
## 摘要
${summary}
`, 'utf8');
}

function readChain(projectRoot: string, sessionId: string): SessionState['orchestration']['chain'] {
  return new SessionStore(projectRoot).readBundle(sessionId).session.orchestration.chain;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('run next — session resolution', () => {
  it('errors when no running session has a pending step', () => {
    const projectRoot = root();
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('no running session with a pending chain step');
  });

  it('resolves via state.active_session_id when set', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 'sess-active', 'active session', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.session_id).toBe('sess-active');
  });

  it('reports ambiguity and lists candidates when multiple running sessions have pending steps', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 'sess-a', 'first', [{ command: 'demo-plan' }]);
    // second session, no active pointer → both are candidates
    const store = new SessionStore(projectRoot);
    store.createSession('sess-b', 'second');
    store.update('sess-b', (draft) => {
      draft.session.orchestration.chain = [{
        step_id: 'step-000-demo-plan', command: 'demo-plan', status: 'pending',
        run_id: null, inserted_by: 'test', decision_ref: null,
      }];
      return null;
    });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('ambiguous');
    expect(outcome.message).toContain('sess-a');
    expect(outcome.message).toContain('sess-b');
  });

  it('errors when an explicit session id does not exist', () => {
    const projectRoot = root();
    const outcome = runNextStep(projectRoot, { sessionId: 'nope' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('session not found');
  });
});

describe('run next — step navigation', () => {
  it('refuses with exit 3 when a step is already running', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'running step', [{ command: 'demo-plan', status: 'running' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.message).toContain('Step running');
  });

  it('returns exit 2 when the next node is a decision node', () => {
    const projectRoot = root();
    seedSession(projectRoot, 's', 'decision next', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('Decision node');
  });

  it('halts on an unresolved mid-chain decision node instead of dispatching past it', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'decision gate', [
      { command: 'demo-plan', status: 'sealed' },
      { command: 'gate', decision_ref: 'DP-1' },
      { command: 'demo-plan' },
    ], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('Decision node');
    expect(outcome.message).toContain('DP-1');
    // The execution step behind the gate must stay pending — no Run created.
    const chain = readChain(projectRoot, 's');
    expect(chain[2].status).toBe('pending');
    expect(chain[2].run_id).toBeNull();
  });

  it('refuses a --pick that jumps past an unresolved pending decision node', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'pick past gate', [
      { command: 'gate', decision_ref: 'DP-1' },
      { command: 'demo-plan' },
    ], { active: true });
    const outcome = runNextStep(projectRoot, { pick: 'step-001-demo-plan' });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('Decision node');
    const chain = readChain(projectRoot, 's');
    expect(chain[1].status).toBe('pending');
  });

  it('returns exit 2 when all steps are complete', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'all done', [{ command: 'demo-plan', status: 'sealed' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('all complete');
  });

  it('advances a pending step: creates a Run and marks the chain step running', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'advance', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.run_id).toMatch(/-001-demo-plan$/);
    expect(outcome.result?.step).toMatchObject({ index: 0, total: 1, command: 'demo-plan' });
    const chain = readChain(projectRoot, 's');
    expect(chain[0].status).toBe('running');
    expect(chain[0].run_id).toBe(outcome.result?.run_id);
  });
});

describe('run next — atomic chain binding', () => {
  it('forwards the predefined chain args into the created Run', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'args', [{ command: 'demo-plan' }], { active: true });
    const store = new SessionStore(projectRoot);
    store.update('s', draft => {
      draft.session.orchestration.chain[0].args = '--depth deep';
      return null;
    });

    const outcome = runNextStep(projectRoot, { sessionId: 's' });
    expect(outcome.exitCode).toBe(0);
    expect(store.readRun('s', outcome.result!.run_id).input.args).toEqual(['--depth deep']);
  });

  it('rejects a second Run binding after the pending step was claimed', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'atomic', [{ command: 'demo-plan' }], { active: true });
    const stepId = new SessionStore(projectRoot).readBundle('s').session.orchestration.chain[0].step_id;

    createRun({ projectRoot, command: 'demo-plan', sessionId: 's', chainStepId: stepId });
    expect(() => createRun({ projectRoot, command: 'demo-plan', sessionId: 's', chainStepId: stepId }))
      .toThrow(/already running|not pending/);
  });
});

describe('run next — sealed reconciliation fencing', () => {
  it('does not overwrite a concurrent needs-retry requeue with a stale sealed Run', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'reconcile race', [{ command: 'demo-plan' }], { active: true });
    const created = createRun({ projectRoot, command: 'demo-plan', sessionId: 's' });
    completeRun(projectRoot, created.run_id, 's');

    const originalUpdate = SessionStore.prototype.update;
    let injected = false;
    const spy = vi.spyOn(SessionStore.prototype, 'update').mockImplementation(function (
      this: SessionStore,
      sessionId,
      mutator,
    ) {
      if (!injected && sessionId === 's') {
        injected = true;
        originalUpdate.call(this, sessionId, (draft) => {
          const step = draft.session.orchestration.chain[0];
          step.status = 'pending';
          step.run_id = null;
          step.retry = { count: 1, max: 2 };
          return null;
        });
      }
      return originalUpdate.call(this, sessionId, mutator);
    });

    const outcome = runNextStep(projectRoot, { sessionId: 's' });
    spy.mockRestore();

    expect(outcome.exitCode).toBe(0);
    const step = readChain(projectRoot, 's')[0];
    expect(step.status).toBe('running');
    expect(step.run_id).not.toBe(created.run_id);
    expect(step.retry).toEqual({ count: 1, max: 2 });
  });
});

describe('run next — lease guard', () => {
  function setLease(projectRoot: string, sessionId: string, lease: SessionState['orchestration']['lease']): void {
    new SessionStore(projectRoot).update(sessionId, (draft) => {
      draft.session.orchestration.lease = lease;
      return null;
    });
  }

  it('refuses (exit 1) when a leased session gets a mismatched owner', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'leased', [{ command: 'demo-plan' }], { active: true });
    setLease(projectRoot, 's', { owner: 'ralph-execute', epoch: 1, id: 'L1' });

    const outcome = runNextStep(projectRoot, { executionOwner: 'other', leaseId: 'L1' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('lease conflict');
    // Chain must not advance on a conflict.
    expect(readChain(projectRoot, 's')[0].status).toBe('pending');
  });

  it('advances when the lease claim matches', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'leased ok', [{ command: 'demo-plan' }], { active: true });
    setLease(projectRoot, 's', { owner: 'ralph-execute', epoch: 2, id: 'L1' });

    const outcome = runNextStep(projectRoot, { executionOwner: 'ralph-execute', ownerEpoch: 2, leaseId: 'L1' });
    expect(outcome.exitCode).toBe(0);
    expect(readChain(projectRoot, 's')[0].status).toBe('running');
  });

  it('a null lease imposes zero verification', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'no lease', [{ command: 'demo-plan' }], { active: true });
    // No setLease — orchestration.lease stays null. No claim passed → still advances.
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
  });
});

describe('run next — birth packet', () => {
  it('does not include the workflow body and points to run brief', () => {
    const projectRoot = root();
    // The workflow body must NOT leak into the birth packet — it stays behind run brief.
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT, 'SECRET_WORKFLOW_BODY line one\nline two');
    seedSession(projectRoot, 's', 'no leak', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.message).not.toContain('SECRET_WORKFLOW_BODY');
    expect(outcome.message).toContain(`maestro run brief ${outcome.result?.run_id}`);
  });

  it('surfaces upstream aliases and the previous step handoff in the birth packet', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'closed loop', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { active: true });

    // Step 0: plan — advance, produce outputs, complete.
    const first = runNextStep(projectRoot);
    expect(first.exitCode).toBe(0);
    writePlanOutputs(projectRoot, 's', first.result!.run_id, 'Plan is ready');
    const done = completeRun(projectRoot, first.result!.run_id, 's');
    expect(done.sealed).toBe(true);

    // Step 1: execute — birth packet should carry plan upstream + prev handoff.
    const second = runNextStep(projectRoot);
    expect(second.exitCode).toBe(0);
    expect(second.result?.upstream['current-plan']).toBeDefined();
    expect(second.result?.upstream['current-plan'].kind).toBe('plan');
    expect(second.result?.prev_handoff?.run_id).toBe(first.result!.run_id);
    expect(second.result?.prev_handoff?.summary).toBe('Plan is ready');
    // Human-readable packet mentions both.
    expect(second.message).toContain('current-plan');
    expect(second.message).toContain('Plan is ready');
  });

  it('emits JSON when requested', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'json out', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot, { json: true });
    expect(outcome.exitCode).toBe(0);
    const parsed = JSON.parse(outcome.message);
    expect(parsed.run_id).toBe(outcome.result?.run_id);
    expect(parsed.next.command).toContain('maestro run brief');
  });

  it('carries prepare refs as a deferred-reading manifest (path + when), never inlined', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    writePrepareWithRefs(projectRoot, 'demo-plan', [
      { path: 'docs/schema.md', when: 'before touching the store' },
    ]);
    seedSession(projectRoot, 's', 'deferred reading', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    // Structured field.
    expect(outcome.result?.refs).toEqual([{ path: 'docs/schema.md', when: 'before touching the store' }]);
    // Human-readable manifest — path + when only.
    expect(outcome.message).toContain('**按需参考（Read when needed）**:');
    expect(outcome.message).toContain('- docs/schema.md — before touching the store');
  });

  it('omits the deferred-reading section when there are no refs', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'no refs', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.refs).toEqual([]);
    expect(outcome.message).not.toContain('按需参考');
  });
});

describe('run next — running info card (exit 3)', () => {
  it('renders a step info card with run_dir/goal and the brief/complete指引', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'busy session', [{ command: 'demo-plan' }], { active: true });

    // Advance step 0 → it is now running with a real Run on disk.
    const first = runNextStep(projectRoot);
    expect(first.exitCode).toBe(0);
    const runId = first.result!.run_id;

    // Second call refuses with the info card (exit code unchanged at 3).
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.message).toContain('Step running — step [0/1] demo-plan');
    expect(outcome.message).toContain(`run_id:   ${runId}`);
    expect(outcome.message).toContain('run_dir:');
    expect(outcome.message).toContain('goal:     busy session');
    expect(outcome.message).toContain(`maestro run brief ${runId} --session s`);
    expect(outcome.message).toContain(`maestro run complete ${runId} --session s`);
  });

  it('degrades gracefully when the running step run is unreadable', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    // Seed a running step whose run_id points at a Run that never got a run.json.
    seedSession(projectRoot, 's', 'ghost run', [{ command: 'demo-plan', status: 'running' }], { active: true });
    const store = new SessionStore(projectRoot);
    store.update('s', (draft) => {
      draft.session.orchestration.chain[0].run_id = 'ghost-run';
      return null;
    });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.message).toContain('Step running');
    expect(outcome.message).toContain('run_dir:  <unreadable>');
  });
});

describe('run next — decision card (exit 2)', () => {
  it('renders a decision card with the matching decision_points entry', () => {
    const projectRoot = root();
    seedSession(projectRoot, 's', 'decision next', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], { active: true });
    // Attach a decision_points entry for DP-1.
    const store = new SessionStore(projectRoot);
    store.update('s', (draft) => {
      draft.session.orchestration.decision_points = [{
        point_id: 'DP-1',
        after_step_id: 'step-000-gate',
        status: 'pending',
        retry_count: 1,
        max_retries: 3,
        evidence_ref: 'evidence/dp1.json',
      }];
      return null;
    });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('Decision node — DP-1');
    expect(outcome.message).toContain('point_id:     DP-1');
    expect(outcome.message).toContain('retries:      1/3');
    expect(outcome.message).toContain('evidence:     evidence/dp1.json');
    expect(outcome.message).toContain('decision 由编排器');
  });

  it('renders the decision card without a decision_points entry', () => {
    const projectRoot = root();
    seedSession(projectRoot, 's', 'orphan decision', [
      { command: 'gate', decision_ref: 'DP-9' },
    ], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('Decision node — DP-9');
    expect(outcome.message).toContain('no matching decision_points entry');
  });
});

describe('run next — Queue + Recommended (exit 0)', () => {
  it('previews the pending steps after the advanced one, flagging decision nodes', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'queue preview', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
      { command: 'gate', decision_ref: 'DP-1' },
      { command: 'demo-execute' },
    ], { active: true });

    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    // Queue lists the steps after index 0, decision node flagged with ◆.
    expect(outcome.result?.queue).toEqual([
      { index: 1, step_id: 'step-001-demo-execute', command: 'demo-execute', is_decision: false },
      { index: 2, step_id: 'step-002-gate', command: 'gate', is_decision: true },
      { index: 3, step_id: 'step-003-demo-execute', command: 'demo-execute', is_decision: false },
    ]);
    expect(outcome.message).toContain('**Queue（后续步骤）**:');
    expect(outcome.message).toContain('- [1] demo-execute');
    expect(outcome.message).toContain('- [2] gate ◆');
  });

  it('caps the Queue preview at 3 entries', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'long queue', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
      { command: 'demo-execute' },
      { command: 'demo-execute' },
      { command: 'demo-execute' },
    ], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.queue?.length).toBe(3);
  });

  it('omits the Queue section when the advanced step is last', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'single step', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.queue).toEqual([]);
    expect(outcome.message).not.toContain('**Queue（后续步骤）**:');
  });

  it('surfaces the prior handoff.next[] as the Recommended section', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'recommend', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { active: true });

    // Step 0: advance + complete with a handoff carrying a next[] suggestion.
    const first = runNextStep(projectRoot);
    expect(first.exitCode).toBe(0);
    writePlanOutputsWithNext(projectRoot, 's', first.result!.run_id, 'Plan ready', [
      { command: 'demo-execute', reason: 'implement the plan', needs: ['current-plan'] },
    ]);
    const done = completeRun(projectRoot, first.result!.run_id, 's');
    expect(done.sealed).toBe(true);

    // Step 1: birth packet carries the Recommended section.
    const second = runNextStep(projectRoot);
    expect(second.exitCode).toBe(0);
    expect(second.result?.recommended).toEqual([
      { command: 'demo-execute', reason: 'implement the plan', needs: ['current-plan'] },
    ]);
    expect(second.message).toContain('**Recommended（建议）**:');
    expect(second.message).toContain('- demo-execute — implement the plan (needs: current-plan)');
  });

  it('omits the Recommended section when the prior handoff has no next[]', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'no recommend', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { active: true });
    const first = runNextStep(projectRoot);
    writePlanOutputs(projectRoot, 's', first.result!.run_id, 'Plan ready');
    completeRun(projectRoot, first.result!.run_id, 's');
    const second = runNextStep(projectRoot);
    expect(second.exitCode).toBe(0);
    expect(second.result?.recommended).toEqual([]);
    expect(second.message).not.toContain('**Recommended（建议）**:');
  });

  it('includes queue + recommended in --json output', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'json fields', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { active: true });
    const outcome = runNextStep(projectRoot, { json: true });
    expect(outcome.exitCode).toBe(0);
    const parsed = JSON.parse(outcome.message);
    expect(Array.isArray(parsed.queue)).toBe(true);
    expect(parsed.queue[0]).toMatchObject({ index: 1, command: 'demo-execute' });
    expect(Array.isArray(parsed.recommended)).toBe(true);
  });
});

describe('run next — chain-complete recommendations (exit 2)', () => {
  it('appends run create suggestions from the last handoff.next[]', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'all done recommend', [{ command: 'demo-plan' }], { active: true });

    // Complete the only step so the chain has no pending steps left.
    const first = runNextStep(projectRoot);
    writePlanOutputsWithNext(projectRoot, 's', first.result!.run_id, 'Plan ready', [
      { command: 'demo-execute', reason: 'now build it', needs: [] },
    ]);
    completeRun(projectRoot, first.result!.run_id, 's');

    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('all complete');
    expect(outcome.message).toContain('suggested: maestro run create demo-execute --session s — now build it');
  });

  it('recommends from handoff.next[] for an empty-chain session', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    // Session with one completed step then emptied to simulate a chain-less state
    // whose latest_completed_run_id still carries a handoff.
    seedSession(projectRoot, 's', 'empty chain', [{ command: 'demo-plan' }], { active: true });
    const first = runNextStep(projectRoot);
    writePlanOutputsWithNext(projectRoot, 's', first.result!.run_id, 'Plan ready', [
      { command: 'demo-execute', reason: 'continue', needs: [] },
    ]);
    completeRun(projectRoot, first.result!.run_id, 's');
    // Empty the chain — latest_completed_run_id remains set.
    const store = new SessionStore(projectRoot);
    store.update('s', (draft) => {
      draft.session.orchestration.chain = [];
      return null;
    });
    const outcome = runNextStep(projectRoot, { sessionId: 's' });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('suggested: maestro run create demo-execute --session s');
  });
});

describe('run next — --pick', () => {
  it('advances a specific pending step instead of the queue head', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    stepCommand(projectRoot, 'demo-execute', EXEC_CONTRACT);
    seedSession(projectRoot, 's', 'pick target', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { active: true });

    const outcome = runNextStep(projectRoot, { pick: 'step-001-demo-execute' });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.step).toMatchObject({ index: 1, command: 'demo-execute' });
    const chain = readChain(projectRoot, 's');
    expect(chain[1].status).toBe('running');
    // The queue head (step 0) is untouched.
    expect(chain[0].status).toBe('pending');
  });

  it('errors and lists pending steps when --pick target does not exist', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'pick missing', [{ command: 'demo-plan' }], { active: true });
    const outcome = runNextStep(projectRoot, { pick: 'nope' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('--pick step not found: nope');
    expect(outcome.message).toContain('pending steps: step-000-demo-plan');
  });

  it('rejects a --pick target that is a decision node', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'pick decision', [
      { command: 'demo-plan' },
      { command: 'gate', decision_ref: 'DP-1' },
    ], { active: true });
    const outcome = runNextStep(projectRoot, { pick: 'step-001-gate' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('is a decision node');
  });

  it('rejects a --pick target that is not pending', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'pick sealed', [
      { command: 'demo-plan', status: 'sealed' },
      { command: 'demo-plan' },
    ], { active: true });
    const outcome = runNextStep(projectRoot, { pick: 'step-000-demo-plan' });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('is "sealed", not pending');
  });

  it('lets the single-running guard win over --pick', () => {
    const projectRoot = root();
    stepCommand(projectRoot, 'demo-plan', PLAN_CONTRACT);
    seedSession(projectRoot, 's', 'pick vs running', [{ command: 'demo-plan' }], { active: true });
    // Advance step 0 → running.
    runNextStep(projectRoot);
    // A --pick call still hits the running guard (exit 3), not the pick error.
    const outcome = runNextStep(projectRoot, { pick: 'step-000-demo-plan' });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.message).toContain('Step running');
  });
});
