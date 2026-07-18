import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeRun, completeRunWithVerdict, createRun } from './runtime.js';
import { runNextStep } from './next.js';
import { observeGoalBinding } from './context.js';
import { recordRunCheckpoint, registerDispatchExpectation } from './checkpoint.js';
import { SessionStore } from './store.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-run-lineage-'));
  roots.push(value);
  return value;
}

function command(projectRoot: string, name: string): void {
  const commands = join(projectRoot, '.claude', 'commands');
  const workflows = join(projectRoot, 'workflows');
  mkdirSync(commands, { recursive: true });
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(commands, `${name}.md`), `<contract>
consumes: []
produces:
  - kind: proof
    primary: true
    path: outputs/proof.json
gates:
  entry: []
  exit: []
</contract>
`);
  writeFileSync(join(workflows, `${name}.md`), `# ${name}\n`);
}

function seed(projectRoot: string, sessionId: string, commands: string[]): void {
  const store = new SessionStore(projectRoot);
  store.createSession(sessionId, 'lineage test');
  store.update(sessionId, (draft) => {
    draft.session.orchestration.engine = 'coordinator';
    draft.session.orchestration.chain = commands.map((name, index) => ({
      step_id: `step-${String(index).padStart(3, '0')}-${name}`,
      command: name,
      status: 'pending',
      run_id: null,
      inserted_by: 'test',
      decision_ref: null,
    }));
    return null;
  });
}

function outputs(projectRoot: string, sessionId: string, runId: string): void {
  const runDir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(runDir, 'outputs', 'proof.json'), JSON.stringify({
    _meta: { kind: 'proof', schema: 'proof/1.0', role: 'primary' },
    ok: true,
  }, null, 2));
  writeFileSync(join(runDir, 'report.md'), '---\nverdict: ready\nsummary: verified\n---\n');
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('Run retry lineage', () => {
  it('uses a single-use retry token only for a replacement of the same chain step', () => {
    const projectRoot = root();
    command(projectRoot, 'retry-demo');
    seed(projectRoot, 's', ['retry-demo']);

    const first = runNextStep(projectRoot, { sessionId: 's' });
    outputs(projectRoot, 's', first.result!.run_id);
    completeRunWithVerdict(projectRoot, first.result!.run_id, 's', { verdict: 'needs-retry' });

    const store = new SessionStore(projectRoot);
    const pending = store.readBundle('s').session.orchestration.chain[0].pending_retry;
    expect(pending?.parent_run_id).toBe(first.result!.run_id);
    store.createSession('other', 'other session');
    expect(() => createRun({
      projectRoot, command: 'retry-demo', sessionId: 'other', retryToken: pending!.token,
    })).toThrow(/invalid/);
    command(projectRoot, 'other-demo');
    expect(() => createRun({
      projectRoot, command: 'other-demo', sessionId: 's', retryToken: pending!.token,
    })).toThrow(/expects command|for command/);
    expect(() => createRun({
      projectRoot, command: 'retry-demo', sessionId: 's', chainStepId: pending!.chain_step_id,
    })).toThrow(/requires its pending retry token/);

    const second = runNextStep(projectRoot, { sessionId: 's' });
    const replacement = store.readRun('s', second.result!.run_id);
    expect(replacement.parent_run_id).toBe(first.result!.run_id);
    expect(replacement.chain_step_id).toBe('step-000-retry-demo');
    expect(store.readRun('s', first.result!.run_id).retry_fence?.consumed_at).not.toBeNull();
    expect(store.readBundle('s').session.orchestration.chain[0].pending_retry).toBeNull();
    expect(() => createRun({
      projectRoot, command: 'retry-demo', sessionId: 's', retryToken: pending!.token,
    })).toThrow(/invalid|consumed/);
  });

  it('does not use a normal predecessor as parent_run_id', () => {
    const projectRoot = root();
    command(projectRoot, 'first-demo');
    command(projectRoot, 'second-demo');
    seed(projectRoot, 's', ['first-demo', 'second-demo']);
    const first = runNextStep(projectRoot, { sessionId: 's' });
    outputs(projectRoot, 's', first.result!.run_id);
    completeRunWithVerdict(projectRoot, first.result!.run_id, 's', { verdict: 'done' });
    const second = runNextStep(projectRoot, { sessionId: 's' });
    expect(new SessionStore(projectRoot).readRun('s', second.result!.run_id).parent_run_id).toBeNull();
  });
});

describe('dispatch checkpoint authority', () => {
  it('fences task/revision/artifact identity and keeps Goal observations non-authoritative', () => {
    const projectRoot = root();
    command(projectRoot, 'checkpoint-demo');
    seed(projectRoot, 's', ['checkpoint-demo']);
    const next = runNextStep(projectRoot, { sessionId: 's' });
    const runId = next.result!.run_id;
    const stepId = next.result!.step.step_id;

    registerDispatchExpectation(projectRoot, runId, {
      chain_step_id: stepId, team_task_id: 'BUILD-001', revision: 0,
    }, 's');
    observeGoalBinding(projectRoot, runId, {
      provider: 'codex', external_id: null, step_goal_ref: 'G1', observed_status: 'complete',
    }, 's');
    expect(new SessionStore(projectRoot).readRun('s', runId).status).toBe('running');
    expect(() => recordRunCheckpoint(projectRoot, runId, {
      run_id: runId, chain_step_id: stepId, team_task_id: 'OTHER', revision: 0, artifact_id: null, verdict: 'warn',
    }, 's')).toThrow(/task mismatch/);
    expect(() => recordRunCheckpoint(projectRoot, runId, {
      run_id: 'other-run', chain_step_id: stepId, team_task_id: 'BUILD-001', revision: 0, artifact_id: null, verdict: 'warn',
    }, 's')).toThrow(/run mismatch/);
    expect(() => recordRunCheckpoint(projectRoot, runId, {
      run_id: runId, chain_step_id: stepId, team_task_id: 'BUILD-001', revision: 0, artifact_id: null, verdict: 'pass',
    }, 's')).toThrow(/requires a sealed ArtifactRegistry artifact/);

    outputs(projectRoot, 's', runId);
    const completed = completeRunWithVerdict(projectRoot, runId, 's', { verdict: 'done' });
    const artifactId = completed.seal.primary_artifact_id!;
    const checkpoint = recordRunCheckpoint(projectRoot, runId, {
      run_id: runId,
      chain_step_id: stepId,
      team_task_id: 'BUILD-001',
      revision: 1,
      artifact_id: artifactId,
      verdict: 'pass',
    }, 's');
    expect(checkpoint.authoritative).toBe(true);
    expect(() => recordRunCheckpoint(projectRoot, runId, {
      run_id: runId, chain_step_id: stepId, team_task_id: 'BUILD-001', revision: 1, artifact_id: artifactId, verdict: 'pass',
    }, 's')).toThrow(/revision must increase/);

    const foreign = createRun({ projectRoot, command: 'checkpoint-demo', sessionId: 's' });
    outputs(projectRoot, 's', foreign.run_id);
    const foreignDone = completeRun(projectRoot, foreign.run_id, 's');
    expect(() => recordRunCheckpoint(projectRoot, runId, {
      run_id: runId,
      chain_step_id: stepId,
      team_task_id: 'BUILD-001',
      revision: 2,
      artifact_id: foreignDone.primary_artifact_id!,
      verdict: 'pass',
    }, 's')).toThrow(/belongs to Run/);
  });
});
