// P2 adapter coverage for `maestro ralph next`.
//
// After the adapter refactor, `ralph next` delegates the step-driving trunk to
// `run next` (src/run/next.ts) and assembles the executor prompt on top. These
// tests lock the executor-facing surface the maestro-ralph FSM depends on:
//   - the session anchor equals the P0 builder baseline (Intent/Scope/Boundary/
//     Progress/Goals/Criteria/Signals in order, wrapped in <session_anchor>);
//   - the birth packet adds an Upstream inputs table + a Previous step section;
//   - the completion-meta comment format is byte-stable;
//   - exit codes 0/2/3 and the lease-conflict path are unchanged.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runNext } from '../cmd-next.js';
import { runComplete } from '../cmd-complete.js';
import { SessionStore } from '../../run/store.js';
import { writeMeta, type RalphMeta } from '../session-adapter.js';
import type { RalphTaskDecompositionItem } from '../status-schema.js';

interface ChainSeed {
  command: string;
  status?: string;
  run_id?: string | null;
  decision_ref?: string | null;
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

/** Pair a command with a contract file + a minimal workflow body. */
function stepCommand(root: string, name: string, contract: string, body = 'workflow body'): void {
  const cmdDir = join(root, '.claude', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
  const wfDir = join(root, 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, `${name}.md`), `# ${name}\n\n${body}\n`, 'utf8');
}

/**
 * Write a run-mode.md so its summary + control line are injected. Written to
 * `.workflow/workflows/` (the project.workflow dir), which resolveStepContent
 * checks before the installed global `~/.maestro/workflows/run-mode.md` — so the
 * test controls run-mode content instead of resolving against the real install.
 */
function writeRunMode(root: string): void {
  const wfDir = join(root, '.workflow', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  // Mirror the real run-mode shape: the "Start or Resume" `run create`
  // instruction sits past the 8-line summary window, so summarizeRunMode drops
  // it (eliminating G9) while keeping the leading protocol lines.
  // summarizeRunMode keeps the first 8 non-empty non-# lines. Headings are
  // filtered out (not treated as boundaries), so 8 non-heading lines must
  // precede the `run create` instruction for it to fall past the window.
  writeFileSync(join(wfDir, 'run-mode.md'), `# Canonical Run Mode

Lifecycle verbs: prepare -> create -> brief -> complete.
Load the workflow manual, then execute it.
Write formal artifacts under outputs/.
Retain the returned run_id and run_dir.
Consume upstream only from the injected map.
Do not locate artifacts by glob or mtime.
Report status via the completion verb.
Preview upstream availability before committing.
Run \`maestro run create <command-name>\` before domain work.
`, 'utf8');
}

/** Write a prepare file with refs frontmatter for the given workflow base. */
function writePrepareWithRefs(root: string, base: string, refs: Array<{ path: string; when: string }>): void {
  const prepDir = join(root, 'prepare');
  mkdirSync(prepDir, { recursive: true });
  const refLines = refs.map(r => `  - path: ${r.path}\n    when: ${r.when}`).join('\n');
  writeFileSync(join(prepDir, `${base}.md`), `---\nrefs:\n${refLines}\n---\n# prepare ${base}\n`, 'utf8');
}

function seedRalphSession(
  root: string,
  sessionId: string,
  intent: string,
  chain: ChainSeed[],
  meta: Partial<RalphMeta> = {},
  boundary?: { in_scope: string[]; out_of_scope: string[]; constraints: string[]; definition_of_done: string },
): void {
  const store = new SessionStore(root);
  store.createSession(sessionId, intent);
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'ralph';
    draft.session.orchestration.chain = chain.map((s, i) => ({
      step_id: `step-${String(i).padStart(3, '0')}-${s.command}`,
      command: s.command,
      status: s.status ?? 'pending',
      run_id: s.run_id ?? null,
      inserted_by: 'test',
      decision_ref: s.decision_ref ?? null,
    }));
    if (boundary) draft.session.boundary_contract = boundary;
    return null;
  });
  const sessionDir = store.sessionDir(sessionId);
  writeMeta(sessionDir, { lifecycle_position: 'execute', phase: null, milestone: '', ...meta });
}

function captureStdout(): { restore: () => void; text: () => string } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return { restore: () => spy.mockRestore(), text: () => chunks.join('') };
}

describe('ralph next — adapter', () => {
  let root: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), 'ralph-adapter-'));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it('emits a session anchor equal to the P0 builder baseline, plus the completion meta', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT, 'WORKFLOW_BODY_HERE');
    const goals: RalphTaskDecompositionItem[] = [
      { id: 'G1', goal: 'ship the feature', done_when: 'tests green', status: 'pending' },
    ];
    seedRalphSession(
      root,
      'sess-anchor',
      'refactor auth',
      [{ command: 'demo-plan' }],
      {
        scope_verdict: 'small',
        phase: 1,
        milestone: 'M1',
        execution_criteria: ['no schema bump'],
        task_decomposition: goals,
        step_details: {},
      },
      { in_scope: ['src/run'], out_of_scope: ['schemas'], constraints: [], definition_of_done: 'green' },
    );

    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-anchor' });
    cap.restore();
    expect(code).toBe(0);
    const out = cap.text();

    // Anchor frame + canonical section order (Intent → Scope → Boundary →
    // Goals → Criteria), identical to the P0 builder assembly.
    expect(out).toContain('<session_anchor>');
    expect(out).toContain('## Session Anchor — sess-anchor');
    expect(out).toContain('**Intent**: refactor auth');
    expect(out).toContain('**Scope**: small | Phase 1 | Milestone: M1');
    expect(out).toContain('**Boundary Contract**:');
    expect(out).toContain('**Goals Overview**:');
    expect(out).toContain('**Execution Criteria**: no schema bump');
    const iIntent = out.indexOf('**Intent**:');
    const iScope = out.indexOf('**Scope**:');
    const iBoundary = out.indexOf('**Boundary Contract**:');
    const iGoals = out.indexOf('**Goals Overview**:');
    expect(iScope).toBeGreaterThan(iIntent);
    expect(iBoundary).toBeGreaterThan(iScope);
    expect(iGoals).toBeGreaterThan(iBoundary);

    // Workflow body is present (single-shot — unlike run next).
    expect(out).toContain('WORKFLOW_BODY_HERE');

    // Completion meta format is byte-stable.
    expect(out).toMatch(/<!-- maestro ralph: step \[0\/1\] command=demo-plan session=sess-anchor run=\S+ -->/);
    expect(out).toContain('maestro ralph complete 0 --session sess-anchor --status DONE --summary');
    expect(out).toContain('maestro ralph retry 0 --session sess-anchor');
  });

  it('prefers Session 1.1 lease, args, position and decomposition over stale ralph-meta', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT, 'WORKFLOW_BODY_HERE');
    seedRalphSession(root, 'sess-canonical', 'canonical state', [{ command: 'demo-plan' }], {
      scope_verdict: 'small', phase: 1, milestone: 'legacy', execution_criteria: ['legacy criterion'],
      task_decomposition: [{ id: 'OLD', goal: 'old goal', status: 'pending' }],
      step_details: { 'step-000-demo-plan': { args: '--legacy', stage: 'old', skill: 'demo-plan' } },
    });
    const store = new SessionStore(root);
    store.update('sess-canonical', draft => {
      draft.session.orchestration.lease = { owner: 'agent-a', epoch: 2, id: 'lease-a' };
      draft.session.orchestration.position = {
        lifecycle: 'execute', phase: 3, phase_is_new: false, milestone: 'M3', planning_mode: null,
        passed_gates: ['scope'], scope_verdict: 'large',
      };
      draft.session.orchestration.decomposition = {
        execution_criteria: ['canonical criterion'],
        goals: [{ id: 'G1', goal: 'canonical goal', status: 'pending' }],
        changelog: [],
      };
      draft.session.orchestration.chain[0].args = '--canonical';
      draft.session.orchestration.chain[0].goal_ref = 'G1';
      return null;
    });

    const cap = captureStdout();
    const code = await runNext({
      sessionId: 'sess-canonical', executionOwner: 'agent-a', ownerEpoch: 2, leaseId: 'lease-a',
    });
    cap.restore();
    expect(code).toBe(0);
    const out = cap.text();
    expect(out).toContain('**Scope**: large | Phase 3 | Milestone: M3');
    expect(out).toContain('canonical goal');
    expect(out).toContain('canonical criterion');
    expect(out).toContain('args="--canonical"');
    const runId = store.readBundle('sess-canonical').session.orchestration.chain[0].run_id!;
    expect(store.readRun('sess-canonical', runId).input.args).toEqual(['--canonical']);
  });

  it('surfaces the upstream table and previous step handoff (fixes the dropped-upstream bug)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    stepCommand(root, 'demo-execute', EXEC_CONTRACT);
    seedRalphSession(root, 'sess-loop', 'closed loop', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { step_details: {} });

    // Step 0: plan — advance, write outputs, complete with a summary.
    let cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-loop' })).toBe(0);
    cap.restore();
    const store = new SessionStore(root);
    const planRunId = store.readBundle('sess-loop').session.orchestration.chain[0].run_id!;
    const runDir = join(root, '.workflow', 'sessions', 'sess-loop', 'runs', planRunId);
    writeFileSync(join(runDir, 'outputs', 'plan.json'), JSON.stringify({
      _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
      tasks: [{ id: 'T1' }],
    }, null, 2));
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Plan is ready
constraints: []
decisions: []
concerns: []
next: []
---
## 摘要
Plan is ready
`, 'utf8');
    expect(await runComplete({ sessionId: 'sess-loop', index: 0, status: 'DONE', evidence: [], summary: 'Plan is ready' })).toBe(0);

    // Step 1: execute — birth packet should carry the plan upstream + prev handoff.
    cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-loop' })).toBe(0);
    cap.restore();
    const out = cap.text();
    expect(out).toContain('**Upstream inputs**:');
    expect(out).toContain('current-plan → ');
    expect(out).toContain('(plan, sealed)');
    expect(out).toContain('**Previous step** (');
    expect(out).toContain('Plan is ready');
  });

  it('counts the just-dispatched step as pending in the Progress line (legacy anchor semantics)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    stepCommand(root, 'demo-execute', EXEC_CONTRACT);
    seedRalphSession(root, 'sess-mid', 'mid-chain', [
      { command: 'demo-plan', status: 'completed' },
      { command: 'demo-execute' },
      { command: 'demo-execute' },
    ], {
      step_details: {
        'step-000-demo-plan': { args: '', stage: 'plan', skill: 'demo-plan', completion_summary: 'planned the work' },
      },
    });

    const cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-mid' })).toBe(0);
    cap.restore();
    const out = cap.text();

    // The pre-advance snapshot drives the anchor: step-001 was flipped to
    // running by the driver, but the legacy emitter counted it as pending.
    expect(out).toContain('**Execution Progress**:');
    expect(out).toContain('planned the work');
    expect(out).toContain('- Progress: 1 done, 2 pending');
  });

  it('keeps exit codes: 3 when a step is already running', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    seedRalphSession(root, 'sess-run', 'busy', [
      { command: 'demo-plan', status: 'running', run_id: 'some-run' },
    ], { step_details: {} });
    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-run' });
    cap.restore();
    expect(code).toBe(3);
  });

  it('keeps exit codes: 2 when the next node is a decision node', async () => {
    seedRalphSession(root, 'sess-dp', 'decision', [
      { command: 'gate', decision_ref: 'DP-1' },
    ], { step_details: {} });
    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-dp' });
    cap.restore();
    expect(code).toBe(2);
  });

  it('keeps exit codes: 2 when all steps are complete', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    seedRalphSession(root, 'sess-done', 'done', [
      { command: 'demo-plan', status: 'sealed' },
    ], { step_details: {} });
    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-done' });
    cap.restore();
    expect(code).toBe(2);
  });

  it('keeps the lease-conflict path: mismatched execution_owner returns 1', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    seedRalphSession(root, 'sess-lease', 'leased', [
      { command: 'demo-plan' },
    ], { execution_owner: 'ralph-execute', lease_id: 'L1', step_details: {} });
    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-lease', executionOwner: 'other', leaseId: 'L1' });
    cap.restore();
    expect(code).toBe(1);
    // Chain step must stay pending — a lease conflict never advances the chain.
    const chain = new SessionStore(root).readBundle('sess-lease').session.orchestration.chain;
    expect(chain[0].status).toBe('pending');
  });

  it('injects the run-mode summary + control line, not the full "Start or Resume" protocol (P2.5/G8)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT, 'WORKFLOW_BODY_HERE');
    writeRunMode(root);
    seedRalphSession(root, 'sess-rm', 'inject run-mode', [{ command: 'demo-plan' }], { step_details: {} });

    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-rm' });
    cap.restore();
    expect(code).toBe(0);
    const out = cap.text();

    // Summary keeps a run-mode content line but drops the section heading and
    // the standalone-executor `run create` instruction line.
    expect(out).toContain('Load the workflow manual, then execute it.');
    expect(out).not.toContain('## Start or Resume');
    expect(out).not.toContain('maestro run create <command-name>');

    // Generated control line: run already created + outputs/report.md + prohibition.
    const runId = new SessionStore(root).readBundle('sess-rm').session.orchestration.chain[0].run_id!;
    expect(out).toContain(`Run already created: ${runId}`);
    expect(out).toContain('/outputs/');
    expect(out).toContain('report.md');
    expect(out).toContain('Do NOT call `maestro run create`');

    // Workflow body still present after the run-mode separator.
    expect(out).toContain('WORKFLOW_BODY_HERE');
  });

  it('emits a deferred-reading manifest from prepare refs, without inlining ref bodies (P2.5/G3)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT, 'WORKFLOW_BODY_HERE');
    // The workflow base for `demo-plan` is `demo-plan`; its prepare declares refs.
    writePrepareWithRefs(root, 'demo-plan', [
      { path: 'docs/schema.md', when: 'before touching the store' },
    ]);
    seedRalphSession(root, 'sess-refs', 'deferred reading', [{ command: 'demo-plan' }], { step_details: {} });

    const cap = captureStdout();
    const code = await runNext({ sessionId: 'sess-refs' });
    cap.restore();
    expect(code).toBe(0);
    const out = cap.text();

    expect(out).toContain('**按需参考（Read when needed）**:');
    expect(out).toContain('- docs/schema.md — before touching the store');
  });

  it('sources the Progress summary from the completed step Run handoff (P3.1 single source)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    stepCommand(root, 'demo-execute', EXEC_CONTRACT);
    seedRalphSession(root, 'sess-ho', 'handoff source', [
      { command: 'demo-plan' },
      { command: 'demo-execute' },
    ], { step_details: {} });

    // Step 0: run a real plan step to completion so its Run carries a sealed
    // handoff. step_details.completion_summary is deliberately left blank — the
    // Progress line must come from the handoff, not the meta fallback.
    let cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-ho' })).toBe(0);
    cap.restore();
    const store = new SessionStore(root);
    const planRunId = store.readBundle('sess-ho').session.orchestration.chain[0].run_id!;
    const runDir = join(root, '.workflow', 'sessions', 'sess-ho', 'runs', planRunId);
    writeFileSync(join(runDir, 'outputs', 'plan.json'), JSON.stringify({
      _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
      tasks: [{ id: 'T1' }],
    }, null, 2));
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Handoff-sourced summary
constraints: []
decisions: []
concerns:
  - lock the store first
next: []
---
## 摘要
Handoff-sourced summary
`, 'utf8');
    expect(await runComplete({ sessionId: 'sess-ho', index: 0, status: 'DONE', evidence: [], summary: 'Handoff-sourced summary' })).toBe(0);

    // Step 1: the anchor's Progress line for the completed step-0 must show the
    // handoff summary + concern, not the empty step_details.
    cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-ho' })).toBe(0);
    cap.restore();
    const out = cap.text();
    expect(out).toContain('**Execution Progress**:');
    expect(out).toContain('Handoff-sourced summary');
    expect(out).toContain('⚠️ lock the store first');
    expect(out).toContain('**⚠️ Accumulated Signals**:');
    expect(out).toContain('Caveats: lock the store first');
  });

  it('falls back to step_details when a completed step has no readable Run handoff (P3.1 dual-write)', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    stepCommand(root, 'demo-execute', EXEC_CONTRACT);
    // step-0 is completed but carries no run_id, so no handoff is readable —
    // Progress + Signals must fall back to ralph-meta step_details.
    seedRalphSession(root, 'sess-fallback', 'meta fallback', [
      { command: 'demo-plan', status: 'completed' },
      { command: 'demo-execute' },
    ], {
      step_details: {
        'step-000-demo-plan': {
          args: '',
          stage: 'plan',
          skill: 'demo-plan',
          completion_summary: 'meta fallback summary',
          completion_caveats: 'meta fallback caveat',
        },
      },
    });

    const cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-fallback' })).toBe(0);
    cap.restore();
    const out = cap.text();
    expect(out).toContain('**Execution Progress**:');
    expect(out).toContain('meta fallback summary');
    expect(out).toContain('⚠️ meta fallback caveat');
    expect(out).toContain('Caveats: meta fallback caveat');
  });
});

describe('ralph complete — signal passthrough', () => {
  let root: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), 'ralph-complete-'));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it('routes --caveats into run.json.handoff.concerns', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    seedRalphSession(root, 'sess-sig', 'signals', [{ command: 'demo-plan' }], { step_details: {} });

    const cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-sig' })).toBe(0);
    cap.restore();

    const store = new SessionStore(root);
    const runId = store.readBundle('sess-sig').session.orchestration.chain[0].run_id!;
    const runDir = join(root, '.workflow', 'sessions', 'sess-sig', 'runs', runId);
    writeFileSync(join(runDir, 'outputs', 'plan.json'), JSON.stringify({
      _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
      tasks: [{ id: 'T1' }],
    }, null, 2));
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Plan drafted
constraints: []
decisions: []
concerns: []
next: []
---
## 摘要
Plan drafted
`, 'utf8');

    expect(await runComplete({
      sessionId: 'sess-sig',
      index: 0,
      status: 'DONE',
      evidence: [],
      summary: 'Plan drafted',
      caveats: 'lock the store before writing',
    })).toBe(0);

    const handoff = store.readRun('sess-sig', runId).handoff;
    expect(handoff).not.toBeNull();
    expect(handoff!.concerns).toContain('lock the store before writing');
  });

  it('uses --summary as fallback when report frontmatter has no summary', async () => {
    stepCommand(root, 'demo-plan', PLAN_CONTRACT);
    seedRalphSession(root, 'sess-fb', 'fallback', [{ command: 'demo-plan' }], { step_details: {} });

    const cap = captureStdout();
    expect(await runNext({ sessionId: 'sess-fb' })).toBe(0);
    cap.restore();

    const store = new SessionStore(root);
    const runId = store.readBundle('sess-fb').session.orchestration.chain[0].run_id!;
    const runDir = join(root, '.workflow', 'sessions', 'sess-fb', 'runs', runId);
    writeFileSync(join(runDir, 'outputs', 'plan.json'), JSON.stringify({
      _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
      tasks: [{ id: 'T1' }],
    }, null, 2));
    // report.md with an empty summary field.
    writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: ""
constraints: []
decisions: []
concerns: []
next: []
---
## 摘要
`, 'utf8');

    expect(await runComplete({
      sessionId: 'sess-fb',
      index: 0,
      status: 'DONE',
      evidence: [],
      summary: 'CLI fallback summary',
    })).toBe(0);

    const handoff = store.readRun('sess-fb', runId).handoff;
    expect(handoff!.summary).toBe('CLI fallback summary');
  });
});

describe('ralph complete — legacy fallback fencing', () => {
  let root: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), 'ralph-complete-fallback-'));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it('re-checks the legacy lease inside the fallback transaction', async () => {
    seedRalphSession(root, 'sess-legacy', 'legacy fallback', [
      { command: 'demo-plan', status: 'running', run_id: null },
    ], {
      execution_owner: 'ralph-execute',
      owner_epoch: 1,
      lease_id: 'L1',
      step_details: {},
    });

    const originalUpdate = SessionStore.prototype.update;
    let injected = false;
    const spy = vi.spyOn(SessionStore.prototype, 'update').mockImplementation(function (
      this: SessionStore,
      sessionId,
      mutator,
    ) {
      if (!injected && sessionId === 'sess-legacy') {
        injected = true;
        writeMeta(this.sessionDir(sessionId), {
          lifecycle_position: 'execute',
          phase: null,
          milestone: '',
          execution_owner: 'other-owner',
          owner_epoch: 2,
          lease_id: 'L2',
          step_details: {},
        });
      }
      return originalUpdate.call(this, sessionId, mutator);
    });

    const result = await runComplete({
      sessionId: 'sess-legacy',
      index: 0,
      status: 'DONE',
      evidence: [],
      executionOwner: 'ralph-execute',
      ownerEpoch: 1,
      leaseId: 'L1',
    });
    spy.mockRestore();

    expect(result).toBe(1);
    expect(new SessionStore(root).readBundle('sess-legacy').session.orchestration.chain[0].status).toBe('running');
  });
});
