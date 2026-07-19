import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { acceptRunReuse, checkRun, completeRun, createRun } from './runtime.js';
import { SessionStore } from './store.js';
import { registerRunCommand } from '../commands/run.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-reuse-accept-'));
  roots.push(path);
  return path;
}

function command(projectRoot: string, name: string, contract: string): void {
  const commands = join(projectRoot, '.claude', 'commands');
  const workflows = join(projectRoot, 'workflows');
  mkdirSync(commands, { recursive: true });
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(commands, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
  writeFileSync(join(workflows, `${name}.md`), `# ${name}\n\nwork\n`, 'utf8');
}

function seedReviewedPlan(projectRoot: string): ReturnType<typeof createRun> {
  command(projectRoot, 'review-plan-fixture', [
    'consumes: []',
    'produces:',
    '  - kind: plan',
    '    alias: current-plan',
    '    primary: true',
    '    path: outputs/plan.json',
    'gates:',
    '  entry: []',
    '  exit: []',
  ].join('\n'));
  command(projectRoot, 'review-execute-fixture', [
    'consumes:',
    '  - kind: plan',
    '    alias: current-plan',
    '    required: true',
    '    require_status: sealed',
    'produces: []',
    'gates:',
    '  entry: []',
    '  exit: []',
  ].join('\n'));
  const plan = createRun({ projectRoot, command: 'review-plan-fixture', sessionId: 's', intent: 'reviewed plan' });
  const planDir = join(projectRoot, '.workflow', 'sessions', 's', 'runs', plan.run_id);
  writeFileSync(join(planDir, 'outputs', 'plan.json'), JSON.stringify({
    _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
    tasks: [],
  }, null, 2), 'utf8');
  writeFileSync(join(planDir, 'report.md'), [
    '---', 'verdict: ready_with_concerns', 'summary: reviewed plan', 'constraints: []',
    'decisions: []', 'concerns:', '  - manual review required', 'next: []', '---', '',
  ].join('\n'), 'utf8');
  const completed = completeRun(projectRoot, plan.run_id, 's');
  expect(completed.errors).toEqual([]);
  expect(completed.gates.blocking).toEqual([]);
  expect(completed.sealed).toBe(true);
  return createRun({ projectRoot, command: 'review-execute-fixture', sessionId: 's', intent: 'reviewed plan' });
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('explicit REVIEW reuse acceptance', () => {
  it('keeps optional REJECT consumes non-blocking while required consumes fail closed', () => {
    const projectRoot = root();
    command(projectRoot, 'optional-producer-fixture', [
      'contract_version: 2.1', 'arguments: []', 'consumes: []', 'produces:',
      '  - kind: context', '    alias: current-context', '    role: primary',
      '    required: true', '    schema: context/1.0', '    path: outputs/context.json',
      'gates: { entry: [], exit: [] }',
    ].join('\n'));
    command(projectRoot, 'optional-consumer-fixture', [
      'contract_version: 2.1', 'arguments: []', 'consumes:', '  - kind: context',
      '    alias: current-context', '    required: false', '    require_status: sealed',
      '    schema: context/2.0', '    role: primary', 'produces: []',
      'gates: { entry: [], exit: [] }',
    ].join('\n'));
    const producer = createRun({ projectRoot, command: 'optional-producer-fixture', sessionId: 's', intent: 'optional' });
    const producerDir = join(projectRoot, '.workflow', 'sessions', 's', 'runs', producer.run_id);
    writeFileSync(join(producerDir, 'outputs', 'context.json'), JSON.stringify({
      _meta: { kind: 'context', schema: 'context/1.0', role: 'primary', alias: 'current-context' },
    }), 'utf8');
    expect(completeRun(projectRoot, producer.run_id, 's').sealed).toBe(true);
    const consumer = createRun({ projectRoot, command: 'optional-consumer-fixture', sessionId: 's', intent: 'optional' });
    expect(consumer.reuse_assessments[0]).toMatchObject({ decision: 'REJECT' });
    expect(consumer.upstream).toEqual({});
    expect(consumer.entry_gates.blocking).toEqual([]);
    expect(completeRun(projectRoot, consumer.run_id, 's').sealed).toBe(true);
  });

  it('requires actual consumes binding and revalidates only the exact accepted REVIEW', () => {
    const projectRoot = root();
    const execute = seedReviewedPlan(projectRoot);
    const store = new SessionStore(projectRoot);
    const beforeRun = store.readRun('s', execute.run_id);
    const review = beforeRun.input.reuse_assessments.find(item => item.decision === 'REVIEW');
    expect(review?.reason_codes).toContain('QUALITY_MEDIUM');
    expect(beforeRun.input.consumes).toEqual([]);
    expect(execute.entry_gates.blocking).toHaveLength(1);
    expect(beforeRun.status).toBe('blocked');

    const beforeSession = store.readBundle('s').session;
    const transition = {
      requestId: 'req-accept-reviewed-plan',
      expectedIdentityRevision: beforeSession.identity_revision,
      expectedActivityRevision: beforeSession.activity_revision,
    };
    const first = acceptRunReuse(projectRoot, execute.run_id, review!.assessment_hash, 's', transition);
    const replay = acceptRunReuse(projectRoot, execute.run_id, review!.assessment_hash, 's', transition);
    expect(first.transition.status).toBe('applied');
    expect(replay.transition.status).toBe('replayed');
    expect(replay.transition.transition_id).toBe(first.transition.transition_id);
    expect(store.readRun('s', execute.run_id).input.consumes).toEqual([review!.source_fence.artifact_id]);
    expect(first.entry_gates.blocking).toEqual([]);

    const validated = checkRun(projectRoot, execute.run_id, 's');
    expect(validated.errors).toEqual([]);
    expect(validated.upstream['current-plan']?.artifact_id).toBe(review!.source_fence.artifact_id);
    expect(validated.reuse_assessments.find(item => item.assessment_hash === review!.assessment_hash)?.decision)
      .toBe('REVIEW');

    store.update('s', draft => { draft.artifacts.revision++; });
    const drifted = checkRun(projectRoot, execute.run_id, 's');
    expect(drifted.errors.some(error => error.includes('no longer current or accepted'))).toBe(true);
  });

  it('exposes canonical run accept-reuse CLI with request, revision and lease fences', async () => {
    const projectRoot = root();
    const execute = seedReviewedPlan(projectRoot);
    const store = new SessionStore(projectRoot);
    const run = store.readRun('s', execute.run_id);
    const review = run.input.reuse_assessments.find(item => item.decision === 'REVIEW')!;
    const session = store.readBundle('s').session;
    const program = new Command();
    program.exitOverride();
    registerRunCommand(program);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync([
      'node', 'maestro', 'run', 'accept-reuse', execute.run_id,
      '--session', 's', '--assessment-hash', review.assessment_hash,
      '--request-id', 'req-cli-accept-review',
      '--expected-identity-revision', String(session.identity_revision),
      '--expected-activity-revision', String(session.activity_revision),
      '--workflow-root', projectRoot,
    ]);
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(output.transition.status).toBe('applied');
    expect(store.readRun('s', execute.run_id).input.consumes).toContain(review.source_fence.artifact_id);
  });
});
