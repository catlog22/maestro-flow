#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(repoRoot, 'bin', 'maestro.js');

function command(projectRoot, name, contract) {
  const commands = join(projectRoot, '.claude', 'commands');
  const workflows = join(projectRoot, 'workflows');
  mkdirSync(commands, { recursive: true });
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(commands, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
  writeFileSync(join(workflows, `${name}.md`), `# ${name}\n\nwork\n`, 'utf8');
}

function invoke(args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function parseEnvelope(result, label) {
  assert.equal(result.error, undefined, `${label}: child process failed to start`);
  assert.equal(result.stderr, '', `${label}: machine stderr must be empty`);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `${label}: expected exactly one stdout envelope`);
  const body = JSON.parse(lines[0]);
  assert.equal(body.schema_version, 'run-response/1.0', `${label}: response schema`);
  assert.equal(body.exit_code, result.status, `${label}: process/envelope exit parity`);
  return body;
}

async function seedReviewedPlan(projectRoot) {
  const { completeRun, createRun } = await import('../dist/src/run/runtime.js');
  command(projectRoot, 'release-review-plan', [
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
  command(projectRoot, 'release-review-execute', [
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

  const plan = createRun({
    projectRoot,
    command: 'release-review-plan',
    sessionId: 'release-machine',
    intent: 'release machine reviewed plan',
  });
  const planDir = join(projectRoot, '.workflow', 'sessions', 'release-machine', 'runs', plan.run_id);
  writeFileSync(join(planDir, 'outputs', 'plan.json'), JSON.stringify({
    _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
    tasks: [],
  }, null, 2), 'utf8');
  writeFileSync(join(planDir, 'report.md'), [
    '---',
    'verdict: ready_with_concerns',
    'summary: release machine reviewed plan',
    'constraints: []',
    'decisions: []',
    'concerns:',
    '  - manual review required',
    'next: []',
    '---',
    '',
  ].join('\n'), 'utf8');
  const completed = completeRun(projectRoot, plan.run_id, 'release-machine');
  assert.deepEqual(completed.errors, [], 'release fixture plan errors');
  assert.deepEqual(completed.gates.blocking, [], 'release fixture plan gates');
  assert.equal(completed.sealed, true, 'release fixture plan must seal');
  return createRun({
    projectRoot,
    command: 'release-review-execute',
    sessionId: 'release-machine',
    intent: 'release machine reviewed plan',
  });
}

async function main() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-release-machine-'));
  try {
    const execute = await seedReviewedPlan(projectRoot);
    const { SessionStore } = await import('../dist/src/run/store.js');
    const store = new SessionStore(projectRoot);
    const run = store.readRun('release-machine', execute.run_id);
    const review = run.input.reuse_assessments.find(item => item.decision === 'REVIEW');
    assert.ok(review, 'release fixture must produce one REVIEW assessment');
    const session = store.readBundle('release-machine').session;
    const acceptanceArgs = [
      'run', 'accept-reuse', execute.run_id,
      '--session', 'release-machine',
      '--assessment-hash', review.assessment_hash,
      '--request-id', 'req-release-machine-accept',
      '--actor', 'release-machine',
      '--reason', 'release child-process parity proof',
      '--evidence', 'scripts/check-session-run-release-machine.mjs',
      '--expected-identity-revision', String(session.identity_revision),
      '--expected-activity-revision', String(session.activity_revision),
      '--json',
      '--workflow-root', projectRoot,
    ];

    const appliedResult = invoke(acceptanceArgs);
    assert.equal(appliedResult.status, 0, `accept-reuse applied exit: ${appliedResult.stderr}`);
    const applied = parseEnvelope(appliedResult, 'accept-reuse applied');
    assert.deepEqual(
      {
        operation: applied.operation,
        ok: applied.ok,
        request_id: applied.request_id,
        replay: applied.replay?.status,
      },
      {
        operation: 'accept-reuse',
        ok: true,
        request_id: 'req-release-machine-accept',
        replay: 'applied',
      },
    );

    const replayResult = invoke(acceptanceArgs);
    assert.equal(replayResult.status, 0, `accept-reuse replay exit: ${replayResult.stderr}`);
    const replay = parseEnvelope(replayResult, 'accept-reuse replay');
    assert.equal(replay.operation, 'accept-reuse');
    assert.equal(replay.ok, true);
    assert.equal(replay.request_id, 'req-release-machine-accept');
    assert.equal(replay.replay?.status, 'replayed');
    assert.equal(replay.replay?.transition_id, applied.replay?.transition_id);

    const usageResult = invoke([
      'run', 'accept-reuse', 'missing', '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(usageResult.status, 2, `accept-reuse usage exit: ${usageResult.stderr}`);
    const usage = parseEnvelope(usageResult, 'accept-reuse usage');
    assert.equal(usage.operation, 'accept-reuse');
    assert.equal(usage.ok, false);
    assert.equal(usage.error?.code, 'COMMANDER_USAGE');

    const mutations = invoke(['run', 'mutations', '--json', '--workflow-root', projectRoot]);
    assert.equal(mutations.status, 1, 'mutations --json must be rejected');
    assert.equal(mutations.stdout, '', 'mutations --json stdout must stay empty');
    assert.match(mutations.stderr, /^error: unknown option '--json'\r?\n$/);

    console.log('session-run release machine parity passed: accept-reuse applied/replayed/usage and mutations rejection');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`session-run release machine parity failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
