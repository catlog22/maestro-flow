import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNextStep } from './next.js';
import { completeRun } from './runtime.js';
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
    expect(outcome.message).toContain('still running');
  });

  it('returns exit 2 when the next node is a decision node', () => {
    const projectRoot = root();
    seedSession(projectRoot, 's', 'decision next', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], { active: true });
    const outcome = runNextStep(projectRoot);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.message).toContain('decision node');
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
