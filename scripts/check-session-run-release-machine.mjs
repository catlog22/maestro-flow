#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(repoRoot, 'bin', 'maestro.js');

const REQUIRED_BEHAVIOR_PROOFS = Object.freeze([
  'capabilities-exact',
  'v3-capabilities-branch',
  'v3-workflow-root-equals-routing',
  'v3-help-json-catalog',
  'v2-help-run-compatibility',
  'v3-retired-execution-structured-response',
  'v3-run-complete-requires-advance',
  'statusless-create-migration-gate',
  'archive-unarchive-cas-receipt-chain',
  'lease-acquisition-handoff-stale-release-seal',
  'execution-seal-lock-release-failure-ordering',
  'execution-lease-release-lock-release-failure-ordering',
  'execution-seal-receipt-source-fence-1.1',
  'execution-aware-create-complete',
  'execution-aware-next',
  'plan-publish-execution-run-audit-redaction',
  'plan-publish-execution-applied-replayed-fences',
  'plan-publish-empty-execution-bootstrap-chain',
  'plan-publish-legacy-1.x-fallback',
  'session-seal-execution-alias-applied-replayed-conflict',
  'session-seal-legacy-1.x-fallback',
  'run-seal-session-execution-alias-applied-replayed-conflict',
  'run-seal-session-legacy-1.x-fallback',
  'complete-needs-retry',
  'complete-blocked',
  'decide-terminal-escalate-replay',
  'commander-real-secret-redaction',
  'legacy-1.0-create',
  'session-source-promotion-without-session-seal',
  'transition-secret-persistence-redaction',
]);

function command(projectRoot, name) {
  const commands = join(projectRoot, '.claude', 'commands');
  const workflows = join(projectRoot, 'workflows');
  mkdirSync(commands, { recursive: true });
  mkdirSync(workflows, { recursive: true });
  writeFileSync(
    join(commands, `${name}.md`),
    '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n',
    'utf8',
  );
  writeFileSync(join(workflows, `${name}.md`), `# ${name}\n\nwork\n`, 'utf8');
}

function invoke(args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function enableStatusless(projectRoot) {
  const workflowRoot = join(projectRoot, '.workflow');
  mkdirSync(workflowRoot, { recursive: true });
  writeFileSync(join(workflowRoot, 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/2.0',
      features: { session_statusless: true },
    },
  }, null, 2)}\n`, 'utf8');
}

function enableV13(projectRoot) {
  const workflowRoot = join(projectRoot, '.workflow');
  mkdirSync(workflowRoot, { recursive: true });
  writeFileSync(join(workflowRoot, 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/1.3',
      features: { session_statusless: false },
    },
  }, null, 2)}
`, 'utf8');
}

function enableV3(projectRoot) {
  const workflowRoot = join(projectRoot, '.workflow');
  mkdirSync(workflowRoot, { recursive: true });
  writeFileSync(join(workflowRoot, 'config.json'), `${JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }, null, 2)}\n`, 'utf8');
}

function runFocusedVitest(relativePath, testName) {
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', relativePath, '-t', testName,
      '--testTimeout=30000', '--hookTimeout=30000'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    `focused proof failed: ${relativePath} -t ${JSON.stringify(testName)}\n${result.stdout}\n${result.stderr}`,
  );
}

function assertMachineStreams(result, label) {
  assert.equal(result.error, undefined, `${label}: child process failed to start`);
  assert.equal(result.stderr, '', `${label}: machine stderr must be empty`);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `${label}: expected exactly one stdout JSON line`);
  return lines[0];
}

function parseEnvelope(result, label, schemaVersion = 'run-response/1.1') {
  const line = assertMachineStreams(result, label);
  const body = JSON.parse(line);
  assert.equal(body.schema_version, schemaVersion, `${label}: response schema`);
  assert.equal(body.exit_code, result.status, `${label}: process/envelope exit parity`);
  return body;
}

function assertTokenRedacted(value, token, label) {
  assert.equal(JSON.stringify(value).includes(token), false, `${label}: private token was exposed`);
}

function acquisitionClaim(response, label) {
  const claim = response?.result?.lease_claim;
  assert.equal(typeof claim?.owner_id, 'string', `${label}: owner_id`);
  assert.equal(typeof claim?.owner_kind, 'string', `${label}: owner_kind`);
  assert.equal(Number.isInteger(claim?.epoch), true, `${label}: epoch`);
  assert.equal(typeof claim?.lease_id, 'string', `${label}: lease_id`);
  assert.equal(claim.lease_id.length > 20, true, `${label}: lease token length`);
  return claim;
}

function leaseArgs(claim) {
  return [
    '--execution-owner', claim.owner_id,
    '--owner-kind', claim.owner_kind,
    '--owner-epoch', String(claim.epoch),
    '--lease-id', claim.lease_id,
  ];
}

function acquisitionArgs(ownerId, ownerKind, expectedLeaseEpoch) {
  return [
    '--execution-owner', ownerId,
    '--owner-kind', ownerKind,
    '--expected-lease-epoch', String(expectedLeaseEpoch),
  ];
}

// Execution-aware Run commands retain their established claim flag names.
function runLeaseArgs(claim) {
  return [
    '--owner-id', claim.owner_id,
    '--owner-kind', claim.owner_kind,
    '--lease-epoch', String(claim.epoch),
    '--lease-id', claim.lease_id,
  ];
}

function auditArgs(reason) {
  return [
    '--actor', 'release-machine',
    '--reason', reason,
    '--evidence', 'scripts/check-session-run-release-machine.mjs',
  ];
}

function sessionCasArgs(store, sessionId, { identity = false, activity = false } = {}) {
  const session = store.readSessionRecord(sessionId);
  return [
    ...(identity ? ['--expected-identity-revision', String(session.identity_revision)] : []),
    ...(activity ? ['--expected-activity-revision', String(session.activity_revision)] : []),
  ];
}

function locatorArgs(sessionId, executionId) {
  return ['--session', sessionId, '--execution', executionId];
}

function mutationArgs(sessionId, executionId, requestId, revision, claim) {
  return [
    ...locatorArgs(sessionId, executionId),
    '--request-id', requestId,
    '--expected-execution-revision', String(revision),
    ...leaseArgs(claim),
  ];
}

function filesBelow(root) {
  const files = [];
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else files.push(child);
    }
  };
  visit(root);
  return files;
}

function assertTransitionSecretsRedacted(projectRoot, tokens) {
  const protectedFiles = filesBelow(join(projectRoot, '.workflow'))
    .filter(path => path.includes(`${join('executions', '').slice(0, -1)}`))
    .filter(path => path.includes(`${join('transitions', '').slice(0, -1)}`) || path.endsWith('.handoff-claim.json'));
  for (const path of protectedFiles) {
    const text = readFileSync(path, 'utf8');
    for (const token of tokens) {
      assert.equal(text.includes(token), false, 'transition or handoff persistence exposed a private token');
    }
  }
}

function writeReport(projectRoot, sessionId, runId) {
  const path = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId, 'report.md');
  writeFileSync(path, [
    '---',
    'verdict: ready',
    'summary: release machine execution run',
    'constraints: []',
    'decisions: []',
    'concerns: []',
    'next: []',
    '---',
    '',
  ].join('\n'), 'utf8');
}

function writePlanPublishFixture(projectRoot) {
  const prepare = join(projectRoot, 'prepare');
  mkdirSync(prepare, { recursive: true });
  writeFileSync(join(prepare, 'plan-publish.md'), `---
name: plan-publish
session-mode: run
contract:
  contract_version: 2.1
  arguments: []
  consumes: []
  produces:
    - path: outputs/plan.json
      kind: plan
      alias: current-plan
      role: primary
      required: true
      schema: plan/1.0
  gates:
    entry: []
    exit: []
---
`, 'utf8');
}

function replaceFlagValue(args, flag, value) {
  const changed = [...args];
  const index = changed.indexOf(flag);
  assert.notEqual(index, -1, `missing fixture flag ${flag}`);
  changed[index + 1] = value;
  return changed;
}

function withoutFlag(args, flag) {
  const changed = [...args];
  const index = changed.indexOf(flag);
  assert.notEqual(index, -1, `missing fixture flag ${flag}`);
  changed.splice(index, 2);
  return changed;
}

function proveExecutionSealAlias(projectRoot, store, commandPrefix, sessionId, started, reason) {
  const claim = acquisitionClaim(started, `${commandPrefix.join(' ')} start`);
  const requestId = `req-${sessionId}-seal`;
  const common = [
    ...commandPrefix, sessionId,
    '--request-id', requestId,
    '--expected-execution-revision', '1',
    '--expected-activity-revision', '1',
    '--owner-id', claim.owner_id,
    '--owner-kind', claim.owner_kind,
    '--lease-epoch', String(claim.epoch),
    '--lease-id', claim.lease_id,
    '--actor', 'release-alias-reviewer',
    '--reason', reason,
    '--evidence', 'evidence/release-alias.json',
    '--outcome', 'done',
    '--summary', `${sessionId} complete`,
    '--json', '--workflow-root', projectRoot,
  ];
  const executionId = started.locator.execution_id;

  for (const flag of ['--expected-activity-revision', '--actor']) {
    const missing = invoke(withoutFlag(common, flag));
    assert.equal(missing.status, 2, `${commandPrefix.join(' ')} missing ${flag} exit`);
    const usage = parseEnvelope(missing, `${commandPrefix.join(' ')} missing ${flag}`);
    assert.equal(usage.operation, 'execution-seal');
    assert.equal(usage.error?.code, 'COMMANDER_USAGE');
    assert.deepEqual(usage.warnings?.map(item => item.code), ['DEPRECATED_ALIAS']);
    assertTokenRedacted(usage, claim.lease_id, `${commandPrefix.join(' ')} missing ${flag}`);
    assert.equal(store.readExecutionTransition(sessionId, executionId, requestId), null);
    assert.deepEqual(
      { status: store.readExecution(sessionId, executionId).status, revision: store.readExecution(sessionId, executionId).revision },
      { status: 'active', revision: 1 },
      `${commandPrefix.join(' ')} missing ${flag} mutation guard`,
    );
  }

  const applied = parseEnvelope(invoke(common), `${commandPrefix.join(' ')} applied`);
  assert.equal(applied.operation, 'execution-seal');
  assert.equal(applied.replay?.status, 'applied');
  assert.equal(applied.result.execution.status, 'sealed');
  assert.deepEqual(applied.warnings?.map(item => item.code), ['DEPRECATED_ALIAS']);
  assert.equal(applied.warnings?.[0]?.replacement_command, 'maestro execution seal');
  assertTokenRedacted(applied, claim.lease_id, `${commandPrefix.join(' ')} applied`);

  const receipt = store.readExecutionTransition(sessionId, executionId, requestId);
  assert.equal(receipt?.payload.preconditions.execution_revision, 1);
  assert.equal(receipt?.payload.preconditions.session_activity_revision, 1);
  assert.equal(receipt?.payload.payload.actor, 'release-alias-reviewer');
  assert.equal(receipt?.payload.payload.reason, reason);
  assert.deepEqual(receipt?.payload.payload.evidence_refs, ['evidence/release-alias.json']);
  assert.equal(receipt?.payload.payload.outcome, 'done');
  assert.equal(receipt?.payload.payload.summary, `${sessionId} complete`);
  assert.equal(receipt?.payload.payload.lease?.epoch, 1);
  assert.equal(receipt?.payload.payload.lease?.lease_id_hash?.startsWith('sha256:'), true);
  assertTokenRedacted(receipt, claim.lease_id, `${commandPrefix.join(' ')} receipt`);

  const replayed = parseEnvelope(invoke(common), `${commandPrefix.join(' ')} replayed`);
  assert.equal(replayed.replay?.status, 'replayed');
  assert.equal(replayed.replay?.transition_id, applied.replay?.transition_id);
  assert.deepEqual(replayed.warnings?.map(item => item.code), ['DEPRECATED_ALIAS']);
  assertTokenRedacted(replayed, claim.lease_id, `${commandPrefix.join(' ')} replayed`);

  const conflictResult = invoke(replaceFlagValue(common, '--reason', `${reason} changed`));
  assert.equal(conflictResult.status, 1, `${commandPrefix.join(' ')} request conflict exit`);
  const conflict = parseEnvelope(conflictResult, `${commandPrefix.join(' ')} request conflict`);
  assert.equal(conflict.error?.code, 'REQUEST_CONFLICT');
  assert.deepEqual(conflict.warnings?.map(item => item.code), ['DEPRECATED_ALIAS']);
  assert.deepEqual(
    { status: store.readExecution(sessionId, executionId).status, revision: store.readExecution(sessionId, executionId).revision },
    { status: 'sealed', revision: 2 },
  );
  assertTokenRedacted(conflict, claim.lease_id, `${commandPrefix.join(' ')} request conflict`);
}

function proveLegacySealAlias(projectRoot, store, commandPrefix, sessionId) {
  store.createSession(sessionId, `${sessionId} legacy fallback`);
  const response = parseEnvelope(invoke([
    ...commandPrefix, sessionId, '--summary', `${sessionId} complete`,
    '--json', '--workflow-root', projectRoot,
  ]), `${commandPrefix.join(' ')} legacy fallback`, 'run-response/1.0');
  assert.equal(response.operation, 'seal-session');
  assert.equal(response.replay?.status, undefined);
  assert.equal(response.result.status, 'sealed');
  assert.equal(store.readSessionRecord(sessionId).schema_version, 'session/1.3');
  assert.equal(store.readBundle(sessionId).session.status, 'sealed');
}

function seedChain(store, sessionId, steps) {
  store.createSession(sessionId, `${sessionId} release proof`);
  store.update(sessionId, draft => {
    draft.session.orchestration.chain = steps.map((step, index) => ({
      step_id: `step-${index + 1}`,
      command: step.command,
      status: 'pending',
      run_id: null,
      inserted_by: 'release-machine',
      decision_ref: step.decision ?? null,
    }));
    draft.session.orchestration.decision_points = steps
      .filter(step => step.decision)
      .map(step => ({
        point_id: step.decision,
        after_step_id: null,
        status: 'pending',
        retry_count: 0,
        max_retries: 2,
        evidence_ref: null,
      }));
  });
}

function recordProof(proofs, proof) {
  assert.equal(REQUIRED_BEHAVIOR_PROOFS.includes(proof), true, `unknown release behavior proof: ${proof}`);
  assert.equal(proofs.has(proof), false, `duplicate release behavior proof: ${proof}`);
  proofs.add(proof);
}

async function main() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-release-machine-'));
  const proofs = new Set();
  try {
    // The v2 proofs below exercise the legacy writer surface; the default
    // writer is now session/3.0, so pin an explicit session/1.3 workspace.
    enableV13(projectRoot);
    const { SessionStore } = await import('../dist/src/run/store.js');
    const { createChainSession } = await import('../dist/src/run/chain-admin.js');
    const store = new SessionStore(projectRoot);
    command(projectRoot, 'release-execution');
    store.createSession('release-lifecycle', 'release lifecycle');
    store.createSession('release-run', 'release run binding');
    seedChain(store, 'release-next', [
      { command: 'release-execution' },
      { command: 'release-execution' },
    ]);
    seedChain(store, 'release-blocked', [{ command: 'release-execution' }]);
    seedChain(store, 'release-decision', [{ command: 'release-decision', decision: 'DP-release' }]);

    const capabilityResult = invoke(['capabilities', '--json', '--workflow-root', projectRoot]);
    assert.equal(capabilityResult.status, 0, 'capabilities exit');
    const capabilities = JSON.parse(assertMachineStreams(capabilityResult, 'capabilities'));
    assert.equal(typeof capabilities.cli_version, 'string');
    assert.deepEqual(
      { ...capabilities, cli_version: '<version>' },
      {
        schema_version: 'maestro-capabilities/1.0',
        cli_version: '<version>',
        session_schema_writes: ['session/1.3'],
        execution_schema_writes: ['execution/1.0'],
        run_response_writes: ['run-response/1.0', 'run-response/1.1', 'run-response/1.2'],
        features: {
          execution_generation: true,
          core_execution_lease: true,
          execution_handoff: true,
          session_statusless: true,
          legacy_session_aliases: true,
          session_run_minimal_v3: false,
          entity_revision_cas: false,
          participant_identity: false,
          request_receipts_v2: false,
          execution_lease: true,
          operation_registry: false,
          artifact_compatibility_v1: true,
          atomic_run_complete_seal: true,
          generation_scoped_seal_receipts: true,
        },
      },
    );
    recordProof(proofs, 'capabilities-exact');

    const v3Root = join(projectRoot, 'session-v3');
    enableV3(v3Root);
    const v3RootArg = `--workflow-root=${v3Root}`;
    const v3CapabilityResult = invoke(['capabilities', '--json', v3RootArg]);
    assert.equal(v3CapabilityResult.status, 0, 'v3 capabilities exit');
    const v3Capabilities = JSON.parse(assertMachineStreams(v3CapabilityResult, 'v3 capabilities'));
    assert.equal(typeof v3Capabilities.cli_version, 'string');
    assert.deepEqual(
      { ...v3Capabilities, cli_version: '<version>' },
      {
        schema_version: 'maestro-capabilities/1.0',
        cli_version: '<version>',
        session_schema_writes: ['session/3.0'],
        execution_schema_writes: [],
        run_response_writes: ['run-response/1.0', 'run-response/1.1', 'run-response/1.2'],
        features: {
          execution_generation: false,
          core_execution_lease: false,
          execution_handoff: false,
          session_statusless: false,
          legacy_session_aliases: false,
          session_run_minimal_v3: true,
          entity_revision_cas: true,
          participant_identity: true,
          request_receipts_v2: true,
          execution_lease: false,
          operation_registry: false,
          artifact_compatibility_v1: true,
          atomic_run_complete_seal: true,
          generation_scoped_seal_receipts: true,
        },
      },
    );
    recordProof(proofs, 'v3-capabilities-branch');

    const v3OpenArgs = [
      'session', 'open', 'release v3 workspace', '--id', 'release-v3',
      '--participant', 'release-actor', '--actor', 'release-actor',
      '--request-id', 'req-v3-open', '--reason', 'open v3 release proof',
      '--definition-of-done', 'release machine v3 proofs pass', '--json', v3RootArg,
    ];
    const v3Opened = parseEnvelope(invoke(v3OpenArgs), 'v3 Session open with equals root', 'run-response/1.2');
    assert.equal(v3Opened.operation, 'session-open');
    assert.equal(v3Opened.replay?.status, 'applied');
    assert.equal(v3Opened.result.schema_version, 'session/3.0');
    assert.equal(v3Opened.result.session_id, 'release-v3');
    const v3Status = parseEnvelope(invoke([
      'session', 'status', '--session', 'release-v3', '--json', v3RootArg,
    ]), 'v3 Session status with equals root', 'run-response/1.2');
    assert.equal(v3Status.operation, 'session-status');
    assert.equal(v3Status.result.schema_version, 'session/3.0');
    recordProof(proofs, 'v3-workflow-root-equals-routing');

    const v3HelpResult = invoke(['help', '--json', v3RootArg]);
    assert.equal(v3HelpResult.status, 0, 'v3 help --json exit');
    const v3Help = JSON.parse(assertMachineStreams(v3HelpResult, 'v3 help --json'));
    assert.equal(v3Help.schema_version, 'help-catalog/1.0');
    const expectedV3Commands = [
      'artifact inspect', 'artifact republish',
      'execution attach', 'execution handoff accept', 'execution handoff cancel', 'execution handoff prepare',
      'execution lease heartbeat', 'execution lease recover', 'execution lease release', 'execution lease status',
      'execution operation claim', 'execution operation heartbeat', 'execution operation release',
      'execution operation status', 'execution pause', 'execution resolve', 'execution resume', 'execution seal',
      'execution start', 'execution status',
      'run brief', 'run cancel', 'run check', 'run complete', 'run create', 'run decide', 'run done',
      'run list', 'run next', 'run rebind', 'run recall', 'run seal', 'run status', 'run transition',
      'session archive', 'session chain insert', 'session chain replace', 'session chain skip', 'session chain update',
      'session complete', 'session done', 'session list', 'session migrate', 'session open', 'session resume-view',
      'session status', 'session unarchive',
    ];
    assert.deepEqual(v3Help.commands.map(command => command.command), expectedV3Commands);
    recordProof(proofs, 'v3-help-json-catalog');
    const v2RunHelp = invoke(['help', 'run']);
    assert.equal(v2RunHelp.status, 0, `v2 help run exit: ${v2RunHelp.stderr}`);
    assert.equal(v2RunHelp.stderr, '', 'v2 help run stderr');
    assert.match(v2RunHelp.stdout, /Usage: maestro run/);
    assert.equal(v2RunHelp.stdout.includes('help-catalog/1.0'), false);
    recordProof(proofs, 'v2-help-run-compatibility');
    const retiredExecutionResult = invoke([
      'execution', 'status', '--session', 'release-v3', '--request-id', 'req-retired-execution',
      '--json', v3RootArg,
    ]);
    assert.equal(retiredExecutionResult.status, 1, 'v3 retired Execution exit');
    const retiredExecution = parseEnvelope(
      retiredExecutionResult, 'v3 retired Execution structured response', 'run-response/1.2',
    );
    assert.equal(retiredExecution.operation, 'execution-status');
    assert.equal(retiredExecution.disposition, 'domain_error');
    assert.equal(retiredExecution.error?.code, 'SESSION_SCHEMA_UNSUPPORTED');
    assert.deepEqual(retiredExecution.error?.details, {
      deprecated_command: 'execution status', replacement_command: 'session status / run check',
    });
    assert.deepEqual(retiredExecution.error?.next_actions, [
      'use-session-status', 'use-run-check',
    ]);
    recordProof(proofs, 'v3-retired-execution-structured-response');
    const v3Store = new SessionStore(v3Root);
    const insertStep = parseEnvelope(invoke([
      'session', 'chain', 'insert', '--session', 'release-v3', '--step-id', 'step-release',
      '--command', 'release-execution', '--participant', 'release-actor', '--actor', 'release-actor',
      '--request-id', 'req-v3-chain-insert', '--reason', 'add release proof step',
      '--expected-orchestration-revision', '1', '--json', v3RootArg,
    ]), 'v3 chain insert', 'run-response/1.2');
    assert.equal(insertStep.revision?.revision, 2);
    const v3Next = parseEnvelope(invoke([
      'run', 'next', '--session', 'release-v3', '--run', 'release-v3-run',
      '--participant', 'release-actor', '--actor', 'release-actor', '--request-id', 'req-v3-next',
      '--reason', 'start release proof Run', '--expected-orchestration-revision', '2', '--json', v3RootArg,
    ]), 'v3 run next', 'run-response/1.2');
    assert.equal(v3Next.result.status, 'running');
    assert.equal(v3Next.result.revision, 1);
    const completeWithoutAdvanceArgs = [
      'run', 'complete', 'release-v3-run', '--session', 'release-v3', '--summary', 'release proof done',
      '--participant', 'release-actor', '--actor', 'release-actor', '--request-id', 'req-v3-complete-no-advance',
      '--reason', 'prove atomic advance requirement', '--expected-run-revision', '1',
      '--expected-orchestration-revision', '3', '--json', v3RootArg,
    ];
    const completeWithoutAdvanceResult = invoke(completeWithoutAdvanceArgs);
    assert.equal(completeWithoutAdvanceResult.status, 1, 'v3 complete without --advance exit');
    const completeWithoutAdvance = parseEnvelope(
      completeWithoutAdvanceResult, 'v3 complete without --advance', 'run-response/1.2',
    );
    assert.equal(completeWithoutAdvance.operation, 'complete');
    assert.match(completeWithoutAdvance.error?.message ?? '', /requires --advance/);
    assert.deepEqual(
      {
        run_status: v3Store.readRunV30('release-v3', 'release-v3-run').status,
        run_revision: v3Store.readRunV30('release-v3', 'release-v3-run').revision,
        orchestration_revision: v3Store.readSessionV30('release-v3').orchestration_revision,
        step_status: v3Store.readSessionV30('release-v3').chain[0].status,
      },
      { run_status: 'running', run_revision: 1, orchestration_revision: 3, step_status: 'running' },
      'v3 complete without --advance mutation guard',
    );
    const completeWithAdvance = parseEnvelope(invoke([
      ...completeWithoutAdvanceArgs.slice(0, -2), '--advance', '--json', v3RootArg,
    ]), 'v3 complete with --advance', 'run-response/1.2');
    assert.equal(completeWithAdvance.result.run_revision, 2);
    assert.equal(completeWithAdvance.result.orchestration_revision, 4);
    assert.equal(completeWithAdvance.result.status, 'sealed');
    assert.deepEqual(completeWithAdvance.result.artifact_publication, {
      authority: 'transition-receipt/2.0',
      artifact_registry_revision: 1,
      artifact_ids: [],
      primary_artifact_id: null,
      artifacts: {},
      aliases: {},
    });
    assert.deepEqual(completeWithAdvance.result.next, {
      suggest_only: true,
      command: 'maestro session complete --session release-v3 --actor <actor-id> --expected-orchestration-revision 4 --json',
      reason: 'Run sealed; no pending chain step remains, so complete the Session',
    });
    assert.deepEqual(completeWithAdvance.result.continuation, {
      operation: 'session-complete',
      locator: { session_id: 'release-v3', run_id: null },
      revision_requirements: { expected_orchestration_revision: 4, expected_run_revision: null },
      required_caller_fields: ['actor'],
    });
    assert.equal(v3Store.readRunV30('release-v3', 'release-v3-run').status, 'sealed');
    assert.equal(v3Store.readSessionV30('release-v3').chain[0].status, 'completed');
    recordProof(proofs, 'v3-run-complete-requires-advance');

    const statuslessRoot = join(projectRoot, 'statusless-create');
    enableStatusless(statuslessRoot);
    const statuslessCreate = parseEnvelope(invoke([
      'session', 'create', 'statusless release identity', '--id', 'release-statusless',
      '--json', '--workflow-root', statuslessRoot,
    ]), 'statusless Session create');
    assert.equal(statuslessCreate.operation, 'session-create');
    assert.equal(statuslessCreate.result.schema_version, 'session/2.0');
    assert.equal(statuslessCreate.result.current_execution_id, null);
    const statuslessSessionId = statuslessCreate.result.session_id;
    const statuslessStore = new SessionStore(statuslessRoot);
    const statuslessIdentity = statuslessStore.readSessionRecord(statuslessSessionId);
    assert.equal(statuslessIdentity.schema_version, 'session/2.0');
    assert.equal('status' in statuslessIdentity, false);
    assert.equal('active_run_id' in statuslessIdentity, false);

    const nonIdentityCreate = invoke([
      'session', 'create', 'invalid statusless chain', '--id', 'invalid-statusless',
      '--chain', 'release-execution', '--json', '--workflow-root', statuslessRoot,
    ]);
    assert.equal(nonIdentityCreate.status, 2, 'statusless identity-only create gate exit');
    const nonIdentityError = parseEnvelope(nonIdentityCreate, 'statusless identity-only create gate');
    assert.match(nonIdentityError.error?.message ?? '', /session create --chain requires/);

    const migrationRoot = join(projectRoot, 'statusless-migration');
    enableV13(migrationRoot);
    const migrationLegacy = parseEnvelope(invoke([
      'run', 'create', 'release-execution', '--session', 'release-migrate',
      '--intent', 'migration source', '--json', '--workflow-root', migrationRoot,
    ]), 'migration legacy seed', 'run-response/1.0');
    assert.equal(migrationLegacy.ok, true);
    enableStatusless(migrationRoot);
    const implicitMigration = invoke([
      'session', 'migrate', '--session', 'release-migrate', '--workflow-root', migrationRoot,
    ]);
    assert.equal(implicitMigration.status, 1, 'implicit session/2.0 migration gate exit');
    assert.match(implicitMigration.stderr, /explicit --to session\/2\.0/);
    assert.equal(new SessionStore(migrationRoot).readSessionRecord('release-migrate').schema_version, 'session/1.3');
    const explicitMigration = invoke([
      'session', 'migrate', '--session', 'release-migrate', '--to', 'session/2.0',
      '--workflow-root', migrationRoot,
    ]);
    assert.equal(explicitMigration.status, 0, `explicit session/2.0 migration: ${explicitMigration.stderr}`);
    assert.equal(new SessionStore(migrationRoot).readSessionRecord('release-migrate').schema_version, 'session/2.0');
    recordProof(proofs, 'statusless-create-migration-gate');

    const archiveArgs = [
      'session', 'archive', '--session', statuslessSessionId, '--request-id', 'release-archive',
      '--actor', 'release-machine', '--reason', 'release history', '--evidence', 'evidence/release.json',
      '--expected-identity-revision', '1', '--expected-activity-revision', '0',
      '--json', '--workflow-root', statuslessRoot,
    ];
    const archived = parseEnvelope(invoke(archiveArgs), 'statusless archive');
    assert.equal(archived.operation, 'session-archive');
    assert.equal(archived.replay?.status, 'applied');
    assert.equal(archived.result.receipt.schema_version, 'session-archive-receipt/1.0');
    assert.equal(archived.result.receipt.previous_receipt_hash, null);
    assert.equal(archived.result.receipt.after.activity_revision, 1);
    const archiveHash = archived.result.receipt.receipt_hash;
    const archiveReplay = parseEnvelope(invoke(archiveArgs), 'statusless archive replay');
    assert.equal(archiveReplay.replay?.status, 'replayed');
    assert.equal(archiveReplay.result.receipt.receipt_hash, archiveHash);

    const staleUnarchive = invoke([
      'session', 'unarchive', '--session', statuslessSessionId, '--request-id', 'release-unarchive-stale',
      '--actor', 'release-machine', '--reason', 'restore history', '--evidence', 'evidence/release.json',
      '--expected-identity-revision', '1', '--expected-activity-revision', '0',
      '--json', '--workflow-root', statuslessRoot,
    ]);
    assert.equal(staleUnarchive.status, 1, 'stale unarchive CAS exit');
    const staleUnarchiveError = parseEnvelope(staleUnarchive, 'stale unarchive CAS');
    assert.match(staleUnarchiveError.error?.message ?? '', /stale activity revision/);
    const unarchived = parseEnvelope(invoke([
      'session', 'unarchive', '--session', statuslessSessionId, '--request-id', 'release-unarchive',
      '--actor', 'release-machine', '--reason', 'restore history', '--evidence', 'evidence/release.json',
      '--expected-identity-revision', '1', '--expected-activity-revision', '1',
      '--json', '--workflow-root', statuslessRoot,
    ]), 'statusless unarchive');
    assert.equal(unarchived.operation, 'session-unarchive');
    assert.equal(unarchived.result.receipt.previous_receipt_hash, archiveHash);
    assert.equal(unarchived.result.receipt.after.activity_revision, 2);
    assert.equal(unarchived.result.session.archived_at, null);
    assert.equal(statuslessStore.listSessionArchiveReceipts(statuslessSessionId).length, 2);
    recordProof(proofs, 'archive-unarchive-cas-receipt-chain');

    const startedResult = invoke([
      'execution', 'start', '--session', 'release-lifecycle', '--request-id', 'req-lifecycle-start',
      ...acquisitionArgs('owner-a', 'codex', 0),
      ...sessionCasArgs(store, 'release-lifecycle', { identity: true, activity: true }),
      ...auditArgs('start release lifecycle'),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(startedResult.status, 0, 'execution start exit');
    const started = parseEnvelope(startedResult, 'execution start');
    assert.equal(started.operation, 'execution-start');
    assert.equal(started.replay?.status, 'applied');
    assert.deepEqual(started.locator, {
      session_id: 'release-lifecycle', execution_id: 'execution-001', generation: 1, run_id: null,
    });
    assert.deepEqual(started.fence, {
      session_identity_revision: 1, session_activity_revision: 1, execution_revision: 1, lease_epoch: 1,
    });
    const claimA = acquisitionClaim(started, 'execution start');
    const startReceipt = store.readExecutionTransition('release-lifecycle', 'execution-001', 'req-lifecycle-start');
    assert.deepEqual(
      {
        actor: startReceipt?.payload.payload.actor,
        reason: startReceipt?.payload.payload.reason,
        evidence_refs: startReceipt?.payload.payload.evidence_refs,
      },
      {
        actor: 'release-machine',
        reason: 'start release lifecycle',
        evidence_refs: ['scripts/check-session-run-release-machine.mjs'],
      },
      'execution start audit receipt',
    );
    assert.equal(startReceipt?.payload.preconditions.session_identity_revision, 1, 'execution start identity CAS receipt');
    assert.equal(startReceipt?.payload.preconditions.session_activity_revision, 0, 'execution start activity CAS receipt');
    assertTokenRedacted(startReceipt, claimA.lease_id, 'execution start receipt');

    const statusResult = invoke([
      'execution', 'status', ...locatorArgs('release-lifecycle', 'execution-001'),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(statusResult.status, 0, 'execution status exit');
    const status = parseEnvelope(statusResult, 'execution status');
    assert.equal(status.operation, 'execution-status');
    assert.equal(status.result.session_status, 'running');
    assert.equal(status.result.lease.state, 'active');
    assert.equal(status.result.lease.lease_id_hash.startsWith('sha256:'), true);
    assertTokenRedacted(status, claimA.lease_id, 'execution status');

    const heartbeatArgs = [
      'execution', 'lease', 'heartbeat',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-heartbeat', 1, claimA),
      '--json', '--workflow-root', projectRoot,
    ];
    const heartbeatApplied = parseEnvelope(invoke(heartbeatArgs), 'heartbeat applied');
    assert.equal(heartbeatApplied.operation, 'execution-lease-heartbeat');
    assert.equal(heartbeatApplied.replay?.status, 'applied');
    assert.equal(heartbeatApplied.fence.execution_revision, 1);
    assertTokenRedacted(heartbeatApplied, claimA.lease_id, 'heartbeat applied');

    const heartbeatReplay = parseEnvelope(invoke(heartbeatArgs), 'heartbeat replay');
    assert.equal(heartbeatReplay.replay?.status, 'replayed');
    assert.equal(heartbeatReplay.replay?.transition_id, heartbeatApplied.replay?.transition_id);
    assertTokenRedacted(heartbeatReplay, claimA.lease_id, 'heartbeat replay');

    const conflictingClaim = { ...claimA, lease_id: `${claimA.lease_id}-changed` };
    const conflictResult = invoke([
      'execution', 'lease', 'heartbeat',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-heartbeat', 1, conflictingClaim),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(conflictResult.status, 1, 'heartbeat conflict exit');
    const conflict = parseEnvelope(conflictResult, 'heartbeat conflict');
    assert.equal(conflict.error?.code, 'REQUEST_CONFLICT');
    assertTokenRedacted(conflict, claimA.lease_id, 'heartbeat conflict');

    const handoffPreparedResult = invoke([
      'execution', 'handoff', 'prepare',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-handoff-prepare', 1, claimA),
      '--to-owner-id', 'owner-b', ...auditArgs('prepare owner handoff'),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(handoffPreparedResult.status, 0, 'handoff prepare exit');
    const handoffPrepared = parseEnvelope(handoffPreparedResult, 'handoff prepare');
    assert.equal(handoffPrepared.operation, 'execution-handoff-prepare');
    assert.equal(handoffPrepared.result.credential_status, 'issued');
    assert.equal(typeof handoffPrepared.result.handoff_token, 'string');
    assertTokenRedacted(handoffPrepared, claimA.lease_id, 'handoff prepare');
    const handoffToken = handoffPrepared.result.handoff_token;

    const handoffAcceptedResult = invoke([
      'execution', 'handoff', 'accept',
      ...locatorArgs('release-lifecycle', 'execution-001'),
      '--request-id', 'req-handoff-accept', '--expected-execution-revision', '2',
      ...acquisitionArgs('owner-b', 'pi', 1), '--handoff-token', handoffToken,
      ...auditArgs('accept owner handoff'), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(handoffAcceptedResult.status, 0, 'handoff accept exit');
    const handoffAccepted = parseEnvelope(handoffAcceptedResult, 'handoff accept');
    assert.equal(handoffAccepted.operation, 'execution-handoff-accept');
    assert.equal(handoffAccepted.fence.execution_revision, 3);
    assert.equal(handoffAccepted.fence.lease_epoch, 2);
    const claimB = acquisitionClaim(handoffAccepted, 'handoff accept');
    assertTokenRedacted(handoffAccepted, claimA.lease_id, 'handoff accept old claim');

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    const recoveredResult = invoke([
      'execution', 'lease', 'recover',
      ...locatorArgs('release-lifecycle', 'execution-001'),
      '--request-id', 'req-recover', '--expected-execution-revision', '3',
      ...acquisitionArgs('owner-c', 'manual', 2), '--stale-after-ms', '1',
      ...auditArgs('recover stale owner lease'), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(recoveredResult.status, 0, 'stale recovery exit');
    const recovered = parseEnvelope(recoveredResult, 'stale recovery');
    assert.equal(recovered.operation, 'execution-lease-recover');
    assert.equal(recovered.result.execution.revision, 4);
    assert.equal(recovered.result.execution.lease.epoch, 3);
    assert.equal(recovered.result.result, undefined);
    const claimC = acquisitionClaim(recovered, 'stale recovery');
    assertTokenRedacted(recovered, claimB.lease_id, 'stale recovery old claim');

    const fencedResult = invoke([
      'execution', 'lease', 'heartbeat',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-stale-owner', 4, claimB),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(fencedResult.status, 1, 'stale owner fence exit');
    const fenced = parseEnvelope(fencedResult, 'stale owner fence');
    assert.equal(fenced.error?.code, 'LEASE_FENCE_CONFLICT');
    assertTokenRedacted(fenced, claimB.lease_id, 'stale owner fence');
    assertTokenRedacted(fenced, claimC.lease_id, 'stale owner fence current claim');

    const releaseResult = invoke([
      'execution', 'lease', 'release',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-release', 4, claimC),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(releaseResult.status, 0, 'lease release exit');
    const released = parseEnvelope(releaseResult, 'lease release');
    assert.equal(released.operation, 'execution-lease-release');
    assert.equal(released.fence.execution_revision, 5);
    assert.equal(released.fence.lease_epoch, null);
    assertTokenRedacted(released, claimC.lease_id, 'lease release');

    const attachedResult = invoke([
      'execution', 'attach', ...locatorArgs('release-lifecycle', 'execution-001'),
      '--request-id', 'req-attach', '--expected-execution-revision', '5',
      ...acquisitionArgs('owner-d', 'claude', 3), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(attachedResult.status, 0, 'execution attach exit');
    const attached = parseEnvelope(attachedResult, 'execution attach');
    const claimD = acquisitionClaim(attached, 'execution attach');
    assert.equal(attached.fence.execution_revision, 6);

    const sealedResult = invoke([
      'execution', 'seal',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-seal', 6, claimD),
      ...sessionCasArgs(store, 'release-lifecycle', { activity: true }),
      '--outcome', 'done', '--summary', 'release lifecycle complete',
      ...auditArgs('seal release lifecycle'), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(sealedResult.status, 0, 'execution seal exit');
    const sealed = parseEnvelope(sealedResult, 'execution seal');
    assert.equal(sealed.operation, 'execution-seal');
    assert.equal(sealed.result.execution.status, 'sealed');
    assert.equal(sealed.result.execution.lease, null);
    assert.equal(sealed.result.execution.final_outcome, 'done');
    assertTokenRedacted(sealed, claimD.lease_id, 'execution seal');

    const postSealReleaseResult = invoke([
      'execution', 'lease', 'release',
      ...mutationArgs('release-lifecycle', 'execution-001', 'req-post-seal-release', 7, claimD),
      '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(postSealReleaseResult.status, 1, 'post-seal release exit');
    const postSealRelease = parseEnvelope(postSealReleaseResult, 'post-seal release');
    assert.equal(postSealRelease.error?.code, 'LEASE_FENCE_CONFLICT');
    assertTokenRedacted(postSealRelease, claimD.lease_id, 'post-seal release');
    recordProof(proofs, 'lease-acquisition-handoff-stale-release-seal');

    runFocusedVitest(
      'src/run/execution.test.ts',
      'commits the seal before lock release so release failure cannot roll it back',
    );
    recordProof(proofs, 'execution-seal-lock-release-failure-ordering');
    runFocusedVitest(
      'src/run/execution.test.ts',
      'commits the lease release before lock release so release failure cannot roll it back and remains replayable',
    );
    recordProof(proofs, 'execution-lease-release-lock-release-failure-ordering');

    runFocusedVitest(
      'src/run/recall-source-fence-v11.test.ts',
      'revalidates the same Execution anchor for reuse while aliases and later activity stay Session-global',
    );
    recordProof(proofs, 'execution-seal-receipt-source-fence-1.1');

    const runStartResult = invoke([
      'execution', 'start', '--session', 'release-run', '--request-id', 'req-run-start',
      ...acquisitionArgs('run-owner', 'codex', 0),
      ...sessionCasArgs(store, 'release-run', { identity: true, activity: true }),
      ...auditArgs('start run-bound execution'), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(runStartResult.status, 0, 'run execution start exit');
    const runStart = parseEnvelope(runStartResult, 'run execution start');
    const runClaim = acquisitionClaim(runStart, 'run execution start');

    const createArgs = [
      'run', 'create', 'release-execution', '--session', 'release-run',
      '--execution', 'execution-001', '--generation', '1',
      '--request-id', 'req-run-create', '--expected-execution-revision', '1',
      ...runLeaseArgs(runClaim), '--json', '--workflow-root', projectRoot,
    ];
    const runCreatedResult = invoke(createArgs);
    assert.equal(runCreatedResult.status, 0, 'execution-aware run create exit');
    const runCreated = parseEnvelope(runCreatedResult, 'execution-aware run create');
    assert.equal(runCreated.operation, 'create');
    assert.equal(runCreated.replay?.status, 'applied');
    assert.equal(runCreated.locator.execution_id, 'execution-001');
    assert.equal(runCreated.locator.generation, 1);
    assertTokenRedacted(runCreated, runClaim.lease_id, 'execution-aware run create');
    const runId = runCreated.result.run_id;
    assert.equal(store.readExecutionRun('release-run', runId).schema_version, 'command-run/1.4');

    const runCreateReplay = parseEnvelope(invoke(createArgs), 'execution-aware run create replay');
    assert.equal(runCreateReplay.replay?.status, 'replayed');
    assert.equal(runCreateReplay.replay?.transition_id, runCreated.replay?.transition_id);
    assertTokenRedacted(runCreateReplay, runClaim.lease_id, 'execution-aware run create replay');

    writeReport(projectRoot, 'release-run', runId);
    const completeArgs = [
      'run', 'complete', runId, '--session', 'release-run',
      '--execution', 'execution-001', '--generation', '1',
      '--request-id', 'req-run-complete', '--expected-execution-revision', '2',
      ...runLeaseArgs(runClaim), '--json', '--workflow-root', projectRoot,
    ];
    const runCompletedResult = invoke(completeArgs);
    assert.equal(runCompletedResult.status, 0, 'execution-aware run complete exit');
    const runCompleted = parseEnvelope(runCompletedResult, 'execution-aware run complete');
    assert.equal(runCompleted.operation, 'complete');
    assert.equal(runCompleted.replay?.status, 'applied');
    assert.equal(runCompleted.fence.execution_revision, 3);
    assert.equal(runCompleted.locator.run_id, null);
    assertTokenRedacted(runCompleted, runClaim.lease_id, 'execution-aware run complete');
    recordProof(proofs, 'execution-aware-create-complete');

    const nextStart = parseEnvelope(invoke([
      'execution', 'start', '--session', 'release-next', '--request-id', 'req-next-start',
      ...acquisitionArgs('next-owner', 'codex', 0),
      ...sessionCasArgs(store, 'release-next', { identity: true, activity: true }),
      ...auditArgs('start chain execution'), '--json', '--workflow-root', projectRoot,
    ]), 'next execution start');
    const nextClaim = acquisitionClaim(nextStart, 'next execution start');
    const nextArgs = [
      'run', 'next', '--session', 'release-next', '--execution', 'execution-001', '--generation', '1',
      '--request-id', 'req-next-first', '--expected-execution-revision', '1',
      ...runLeaseArgs(nextClaim), '--json', '--workflow-root', projectRoot,
    ];
    const nextApplied = parseEnvelope(invoke(nextArgs), 'execution-aware next applied');
    assert.equal(nextApplied.operation, 'next');
    assert.equal(nextApplied.replay?.status, 'applied');
    assert.equal(nextApplied.result.step.step_id, 'step-1');
    assert.equal(nextApplied.result.step.command, 'release-execution');
    assert.equal(nextApplied.fence.execution_revision, 2);
    assert.equal(nextApplied.locator.run_id, nextApplied.result.run_id);
    assert.equal(store.readExecutionRun('release-next', nextApplied.result.run_id).schema_version, 'command-run/1.4');
    assertTokenRedacted(nextApplied, nextClaim.lease_id, 'execution-aware next applied');
    const nextReplay = parseEnvelope(invoke(nextArgs), 'execution-aware next replay');
    assert.equal(nextReplay.replay?.status, 'replayed');
    assert.equal(nextReplay.replay?.transition_id, nextApplied.replay?.transition_id);
    assert.equal(nextReplay.result.run_id, nextApplied.result.run_id);
    assertTokenRedacted(nextReplay, nextClaim.lease_id, 'execution-aware next replay');
    recordProof(proofs, 'execution-aware-next');

    const planRoot = join(projectRoot, 'execution-plan-publish');
    writePlanPublishFixture(planRoot);
    enableV13(planRoot);
    const planStore = new SessionStore(planRoot);
    const planCreated = createChainSession(planRoot, 'release-plan-execution', {
      intent: 'release Plan publication',
      engine: 'manual',
      definition: {
        intent: 'release Plan publication',
        engine: 'manual',
        steps: [{ command: 'execute' }, { command: 'verify' }],
      },
    });
    const planSessionId = planCreated.sessionId;
    const planSource = join(planRoot, 'approved-plan.md');
    writeFileSync(planSource, '# Release approved Plan\n\nExecute with exact authority.\n', 'utf8');
    const planStart = parseEnvelope(invoke([
      'execution', 'start', '--session', planSessionId, '--request-id', 'req-plan-start',
      ...acquisitionArgs('plan-owner', 'pi', 0),
      ...sessionCasArgs(planStore, planSessionId, { identity: true, activity: true }),
      ...auditArgs('start Plan publication Execution'), '--json', '--workflow-root', planRoot,
    ]), 'Plan publication Execution start');
    const planClaim = acquisitionClaim(planStart, 'Plan publication Execution start');
    enableStatusless(planRoot);
    const planMigration = invoke([
      'session', 'migrate', '--session', planSessionId, '--to', 'session/2.0',
      '--workflow-root', planRoot,
    ]);
    assert.equal(planMigration.status, 0, `Plan Session migration: ${planMigration.stderr}`);
    const planSession = planStore.readSessionRecord(planSessionId);
    const planExecution = planStore.readExecution(planSessionId, 'execution-001');
    const planArgs = [
      'plan', 'publish', planSource, '--source-root', planRoot,
      '--session', planSessionId,
      '--handoff-key', 'release-plan-execution-handoff',
      '--source-pi-session', 'release-pi-session',
      '--plan-revision', '4', '--approved-at', '2026-08-11T20:00:00.000Z',
      '--request-id', 'req-plan-publish-execution',
      '--execution', 'execution-001', '--generation', '1',
      '--expected-execution-revision', String(planExecution.revision),
      '--expected-identity-revision', String(planSession.identity_revision),
      '--expected-activity-revision', String(planSession.activity_revision),
      ...leaseArgs(planClaim),
      '--actor', 'release-plan-reviewer', '--reason', 'publish approved release Plan',
      '--evidence', 'evidence/approved-plan.json',
      '--json', '--workflow-root', planRoot,
    ];

    for (const [label, changedArgs, expectedCode] of [
      ['revision', replaceFlagValue(
        planArgs, '--expected-execution-revision', String(planExecution.revision - 1),
      ), 'EXECUTION_REVISION_CONFLICT'],
      ['activity CAS', replaceFlagValue(
        planArgs, '--expected-activity-revision', String(planSession.activity_revision - 1),
      ), 'FENCE_CONFLICT'],
      ['lease', replaceFlagValue(planArgs, '--lease-id', `${planClaim.lease_id}-stale`), 'LEASE_FENCE_CONFLICT'],
    ]) {
      const staleResult = invoke(changedArgs);
      assert.equal(staleResult.status, 1, `Plan publish stale ${label} exit`);
      const stale = parseEnvelope(staleResult, `Plan publish stale ${label}`);
      assert.equal(stale.error?.code, expectedCode, `Plan publish stale ${label} code`);
      assertTokenRedacted(stale, planClaim.lease_id, `Plan publish stale ${label}`);
      assert.deepEqual(
        {
          revision: planStore.readExecution(planSessionId, 'execution-001').revision,
          active_run_id: planStore.readExecution(planSessionId, 'execution-001').active_run_id,
        },
        { revision: planExecution.revision, active_run_id: null },
        `Plan publish stale ${label} mutation guard`,
      );
      assert.equal(
        planStore.readExecutionTransition(
          planSessionId, 'execution-001', 'req-plan-publish-execution__allocate',
        ),
        null,
      );
    }

    const planApplied = parseEnvelope(invoke(planArgs), 'Execution-aware Plan publish applied');
    assert.equal(planApplied.operation, 'plan-publish');
    assert.equal(planApplied.replay?.status, 'applied');
    assert.equal(planApplied.result.schema_version, 'plan-publish-result/1.1');
    assert.equal(planApplied.result.execution_id, 'execution-001');
    assert.equal(planApplied.result.generation, 1);
    assert.equal(planApplied.locator.run_id, planApplied.result.run_id);
    assert.equal(planApplied.fence.execution_revision, planExecution.revision + 2);
    assert.equal(planApplied.result.claim.lease_id_hash.startsWith('sha256:'), true);
    assertTokenRedacted(planApplied, planClaim.lease_id, 'Execution-aware Plan publish applied');

    const planRun = planStore.readExecutionRun(planSessionId, planApplied.result.run_id);
    assert.equal(planRun.schema_version, 'command-run/1.4');
    assert.equal(planRun.execution_id, 'execution-001');
    assert.equal(planRun.generation, 1);
    assert.equal(planRun.status, 'sealed');
    const planInput = JSON.parse(planRun.input.args[0]);
    assert.deepEqual(planInput.audit, {
      actor: 'release-plan-reviewer',
      reason: 'publish approved release Plan',
      evidence: ['evidence/approved-plan.json'],
    });
    assert.equal(planInput.expected_identity_revision, planSession.identity_revision);
    assert.equal(planInput.expected_activity_revision, planSession.activity_revision);
    assert.equal(planInput.execution.expected_revision, planExecution.revision);
    assert.equal(planInput.claim.lease_id_hash.startsWith('sha256:'), true);
    assertTokenRedacted(planInput, planClaim.lease_id, 'Execution-aware Plan publish input');

    const planAllocate = planStore.readExecutionTransition(
      planSessionId, 'execution-001', 'req-plan-publish-execution__allocate',
    );
    const planComplete = planStore.readExecutionTransition(
      planSessionId, 'execution-001', 'req-plan-publish-execution__complete',
    );
    assert.equal(planAllocate?.payload.operation, 'create');
    assert.equal(planAllocate?.payload.preconditions.execution_revision, planExecution.revision);
    assert.equal(planAllocate?.payload.preconditions.session_identity_revision, planSession.identity_revision);
    assert.equal(planAllocate?.payload.preconditions.session_activity_revision, planSession.activity_revision);
    assert.equal(planComplete?.payload.operation, 'complete');
    assert.equal(planComplete?.payload.preconditions.execution_revision, planExecution.revision + 1);
    assert.equal(planComplete?.outcome.result.value.run_id, planApplied.result.run_id);
    assertTokenRedacted(planAllocate, planClaim.lease_id, 'Plan allocate receipt');
    assertTokenRedacted(planComplete, planClaim.lease_id, 'Plan complete receipt');
    assert.equal(
      readFileSync(join(planStore.runDir(planSessionId, planApplied.result.run_id), 'run.json'), 'utf8')
        .includes(planClaim.lease_id),
      false,
      'Execution-aware Plan Run persisted a private lease token',
    );
    recordProof(proofs, 'plan-publish-execution-run-audit-redaction');

    const planReplay = parseEnvelope(invoke(planArgs), 'Execution-aware Plan publish replayed');
    assert.equal(planReplay.replay?.status, 'replayed');
    assert.equal(planReplay.replay?.transition_id, planApplied.replay?.transition_id);
    assert.equal(planReplay.result.run_id, planApplied.result.run_id);
    assertTokenRedacted(planReplay, planClaim.lease_id, 'Execution-aware Plan publish replayed');

    const planConflictResult = invoke(replaceFlagValue(
      planArgs, '--reason', 'changed Plan publication audit',
    ));
    assert.equal(planConflictResult.status, 1, 'Execution-aware Plan publish request conflict exit');
    const planConflict = parseEnvelope(planConflictResult, 'Execution-aware Plan publish request conflict');
    assert.equal(planConflict.error?.code, 'REQUEST_CONFLICT');
    assert.equal(planStore.readExecution(planSessionId, 'execution-001').revision, planExecution.revision + 2);
    assert.equal(planStore.readExecution(planSessionId, 'execution-001').active_run_id, null);
    assertTokenRedacted(planConflict, planClaim.lease_id, 'Execution-aware Plan publish request conflict');
    assertTransitionSecretsRedacted(planRoot, [planClaim.lease_id]);
    recordProof(proofs, 'plan-publish-execution-applied-replayed-fences');

    const emptyPlanRoot = join(projectRoot, 'empty-execution-plan-publish');
    writePlanPublishFixture(emptyPlanRoot);
    command(emptyPlanRoot, 'execute');
    command(emptyPlanRoot, 'verify');
    enableStatusless(emptyPlanRoot);
    const emptyPlanStore = new SessionStore(emptyPlanRoot);
    const emptyPlanSessionId = 'release-plan-empty-execution';
    emptyPlanStore.createSession(emptyPlanSessionId, 'empty generation-1 Execution Plan publication');
    const emptyPlanStart = parseEnvelope(invoke([
      'execution', 'start', '--session', emptyPlanSessionId, '--request-id', 'req-empty-plan-start',
      ...acquisitionArgs('empty-plan-owner', 'pi', 0),
      ...sessionCasArgs(emptyPlanStore, emptyPlanSessionId, { identity: true, activity: true }),
      ...auditArgs('start empty Plan publication Execution'), '--json', '--workflow-root', emptyPlanRoot,
    ]), 'empty Plan publication Execution start');
    const emptyPlanClaim = acquisitionClaim(emptyPlanStart, 'empty Plan publication Execution start');
    const emptyPlanSessionBefore = emptyPlanStore.readSessionRecord(emptyPlanSessionId);
    const emptyPlanExecutionBefore = emptyPlanStore.readExecution(emptyPlanSessionId, 'execution-001');
    assert.equal(emptyPlanSessionBefore.schema_version, 'session/2.0');
    assert.equal(emptyPlanExecutionBefore.generation, 1);
    assert.deepEqual(emptyPlanExecutionBefore.chain, []);
    const emptyPlanSource = join(emptyPlanRoot, 'approved-empty-plan.md');
    writeFileSync(emptyPlanSource, '# Empty Execution approved Plan\n\nExecute and verify.\n', 'utf8');
    const emptyPlanArgs = [
      'plan', 'publish', emptyPlanSource, '--source-root', emptyPlanRoot,
      '--session', emptyPlanSessionId,
      '--handoff-key', 'release-empty-plan-handoff',
      '--source-pi-session', 'release-empty-pi-session',
      '--plan-revision', '1', '--approved-at', '2026-08-12T01:00:00.000Z',
      '--request-id', 'req-plan-empty-execution',
      '--execution', 'execution-001', '--generation', '1',
      '--expected-execution-revision', String(emptyPlanExecutionBefore.revision),
      '--expected-identity-revision', String(emptyPlanSessionBefore.identity_revision),
      '--expected-activity-revision', String(emptyPlanSessionBefore.activity_revision),
      ...leaseArgs(emptyPlanClaim),
      '--actor', 'release-empty-plan-reviewer',
      '--reason', 'publish approved Plan into empty Execution',
      '--evidence', 'evidence/approved-empty-plan.json',
      '--json', '--workflow-root', emptyPlanRoot,
    ];
    const emptyPlanApplied = parseEnvelope(invoke(emptyPlanArgs), 'empty Execution Plan publish applied');
    assert.equal(emptyPlanApplied.operation, 'plan-publish');
    assert.equal(emptyPlanApplied.replay?.status, 'applied');
    assert.equal(emptyPlanApplied.result.schema_version, 'plan-publish-result/1.1');
    assert.equal(emptyPlanApplied.result.generation, 1);
    assert.equal(emptyPlanApplied.fence.execution_revision, emptyPlanExecutionBefore.revision + 3);
    assert.equal(emptyPlanApplied.fence.session_activity_revision, emptyPlanSessionBefore.activity_revision + 3);
    assert.equal(
      emptyPlanStore.readExecution(emptyPlanSessionId, 'execution-001').revision,
      emptyPlanExecutionBefore.revision + 3,
    );
    assert.equal(
      emptyPlanStore.readSessionRecord(emptyPlanSessionId).activity_revision,
      emptyPlanSessionBefore.activity_revision + 3,
    );
    assertTokenRedacted(emptyPlanApplied, emptyPlanClaim.lease_id, 'empty Execution Plan publish applied');

    const emptyBootstrap = emptyPlanStore.readExecutionTransition(
      emptyPlanSessionId, 'execution-001', 'req-plan-empty-execution__bootstrap',
    );
    assert.equal(emptyBootstrap?.status, 'applied');
    assert.equal(emptyBootstrap?.payload.schema_version, 'transition-request/1.1');
    assert.equal(emptyBootstrap?.payload.operation, 'execution-chain-bootstrap');
    assert.deepEqual(
      {
        actor: emptyBootstrap?.payload.payload.actor,
        reason: emptyBootstrap?.payload.payload.reason,
        evidence_refs: emptyBootstrap?.payload.payload.evidence_refs,
      },
      {
        actor: 'release-empty-plan-reviewer',
        reason: 'publish approved Plan into empty Execution',
        evidence_refs: ['evidence/approved-empty-plan.json'],
      },
    );
    assert.match(emptyBootstrap?.payload.normalized_request_hash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.match(emptyBootstrap?.payload.payload.lease?.lease_id_hash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(emptyBootstrap?.outcome.schema_version, 'transition-outcome/1.1');
    assert.match(emptyBootstrap?.outcome.result_hash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.match(emptyBootstrap?.outcome.result.chain_hash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      emptyBootstrap?.outcome.postconditions.execution_revision,
      emptyPlanExecutionBefore.revision + 1,
    );
    assert.equal(
      emptyBootstrap?.outcome.postconditions.session_activity_revision,
      emptyPlanSessionBefore.activity_revision + 1,
    );
    assertTokenRedacted(emptyBootstrap, emptyPlanClaim.lease_id, 'empty Execution bootstrap receipt');

    const emptyPlanReplay = parseEnvelope(invoke(emptyPlanArgs), 'empty Execution Plan publish replayed');
    assert.equal(emptyPlanReplay.replay?.status, 'replayed');
    assert.equal(emptyPlanReplay.replay?.transition_id, emptyPlanApplied.replay?.transition_id);
    assert.equal(emptyPlanReplay.result.run_id, emptyPlanApplied.result.run_id);
    assert.equal(emptyPlanReplay.fence.execution_revision, emptyPlanApplied.fence.execution_revision);
    assert.equal(emptyPlanReplay.fence.session_activity_revision, emptyPlanApplied.fence.session_activity_revision);
    assert.deepEqual(
      emptyPlanStore.readExecution(emptyPlanSessionId, 'execution-001').chain.map(step => ({
        step_id: step.step_id, command: step.command, status: step.status, run_id: step.run_id,
      })),
      [
        { step_id: 'step-000-execute', command: 'execute', status: 'pending', run_id: null },
        { step_id: 'step-001-verify', command: 'verify', status: 'pending', run_id: null },
      ],
    );
    assert.equal(emptyPlanStore.listBoundExecutionRuns(emptyPlanSessionId, 'execution-001', 1).length, 1);

    let emptyPlanRevision = emptyPlanApplied.fence.execution_revision;
    const executedChainRunIds = [];
    for (const commandName of ['execute', 'verify']) {
      const next = parseEnvelope(invoke([
        'run', 'next', '--session', emptyPlanSessionId,
        '--execution', 'execution-001', '--generation', '1',
        '--request-id', `req-empty-plan-${commandName}-next`,
        '--expected-execution-revision', String(emptyPlanRevision),
        ...runLeaseArgs(emptyPlanClaim), '--json', '--workflow-root', emptyPlanRoot,
      ]), `empty Plan ${commandName} next`);
      assert.equal(next.operation, 'next');
      assert.equal(next.result.step.command, commandName);
      assert.equal(next.fence.execution_revision, ++emptyPlanRevision);
      executedChainRunIds.push(next.result.run_id);
      writeReport(emptyPlanRoot, emptyPlanSessionId, next.result.run_id);
      const completed = parseEnvelope(invoke([
        'run', 'complete', next.result.run_id, '--session', emptyPlanSessionId,
        '--execution', 'execution-001', '--generation', '1', '--verdict', 'done',
        '--request-id', `req-empty-plan-${commandName}-complete`,
        '--expected-execution-revision', String(emptyPlanRevision),
        ...runLeaseArgs(emptyPlanClaim), '--json', '--workflow-root', emptyPlanRoot,
      ]), `empty Plan ${commandName} complete`);
      assert.equal(completed.operation, 'complete');
      assert.equal(completed.result.sealed, true);
      assert.equal(completed.result.chain_transition.step_status, 'sealed');
      assert.equal(completed.fence.execution_revision, ++emptyPlanRevision);
    }

    const emptyPlanExecutionAfter = emptyPlanStore.readExecution(emptyPlanSessionId, 'execution-001');
    assert.deepEqual(emptyPlanExecutionAfter.chain.map(step => ({ command: step.command, status: step.status })), [
      { command: 'execute', status: 'sealed' },
      { command: 'verify', status: 'sealed' },
    ]);
    const emptyPlanRuns = emptyPlanStore.listBoundExecutionRuns(emptyPlanSessionId, 'execution-001', 1);
    assert.equal(emptyPlanRuns.length, 3);
    assert.equal(new Set(emptyPlanRuns.map(run => run.run_id)).size, 3);
    assert.equal(new Set(executedChainRunIds).size, 2);
    for (const run of emptyPlanRuns) {
      assert.equal(
        readFileSync(join(emptyPlanStore.runDir(emptyPlanSessionId, run.run_id), 'run.json'), 'utf8')
          .includes(emptyPlanClaim.lease_id),
        false,
        `empty Execution Run ${run.run_id} persisted a private lease token`,
      );
    }
    assertTransitionSecretsRedacted(emptyPlanRoot, [emptyPlanClaim.lease_id]);
    recordProof(proofs, 'plan-publish-empty-execution-bootstrap-chain');

    const legacyPlanRoot = join(projectRoot, 'legacy-plan-publish');
    writePlanPublishFixture(legacyPlanRoot);
    enableV13(legacyPlanRoot);
    const legacyPlanStore = new SessionStore(legacyPlanRoot);
    legacyPlanStore.createSession('release-plan-legacy', 'legacy Plan publication');
    const legacyPlanSource = join(legacyPlanRoot, 'approved-plan.md');
    writeFileSync(legacyPlanSource, '# Legacy approved Plan\n', 'utf8');
    const legacyPlan = parseEnvelope(invoke([
      'plan', 'publish', legacyPlanSource, '--source-root', legacyPlanRoot,
      '--session', 'release-plan-legacy', '--handoff-key', 'release-plan-legacy-handoff',
      '--source-pi-session', 'release-pi-session', '--plan-revision', '1',
      '--approved-at', '2026-08-11T20:00:00.000Z', '--request-id', 'req-plan-publish-legacy',
      '--json', '--workflow-root', legacyPlanRoot,
    ]), 'legacy Plan publish fallback', 'run-response/1.0');
    assert.equal(legacyPlan.operation, 'plan-publish');
    assert.equal(legacyPlan.replay?.status, 'applied');
    assert.equal(legacyPlan.result.schema_version, 'plan-publish-result/1.0');
    assert.equal(legacyPlanStore.readRun('release-plan-legacy', legacyPlan.result.run_id).schema_version, 'command-run/1.3');
    assert.equal(legacyPlanStore.readSessionRecord('release-plan-legacy').schema_version, 'session/1.3');
    recordProof(proofs, 'plan-publish-legacy-1.x-fallback');

    const sessionSealRoot = join(projectRoot, 'session-seal-alias');
    enableStatusless(sessionSealRoot);
    const sessionSealStore = new SessionStore(sessionSealRoot);
    sessionSealStore.createSession('release-session-seal', 'Session seal alias proof');
    const sessionSealStart = parseEnvelope(invoke([
      'execution', 'start', '--session', 'release-session-seal', '--request-id', 'req-session-seal-start',
      ...acquisitionArgs('session-seal-owner', 'codex', 0),
      ...sessionCasArgs(sessionSealStore, 'release-session-seal', { identity: true, activity: true }),
      ...auditArgs('start session seal alias proof'), '--json', '--workflow-root', sessionSealRoot,
    ]), 'session seal alias Execution start');
    proveExecutionSealAlias(
      sessionSealRoot, sessionSealStore, ['session', 'seal'],
      'release-session-seal', sessionSealStart, 'verified session seal alias',
    );
    recordProof(proofs, 'session-seal-execution-alias-applied-replayed-conflict');

    const legacySessionSealRoot = join(projectRoot, 'session-seal-legacy');
    enableV13(legacySessionSealRoot);
    const legacySessionSealStore = new SessionStore(legacySessionSealRoot);
    proveLegacySealAlias(
      legacySessionSealRoot, legacySessionSealStore, ['session', 'seal'], 'release-session-seal-legacy',
    );
    recordProof(proofs, 'session-seal-legacy-1.x-fallback');

    const runSealRoot = join(projectRoot, 'run-seal-session-alias');
    enableStatusless(runSealRoot);
    const runSealStore = new SessionStore(runSealRoot);
    runSealStore.createSession('release-run-seal-session', 'Run seal-session alias proof');
    const runSealStart = parseEnvelope(invoke([
      'execution', 'start', '--session', 'release-run-seal-session', '--request-id', 'req-run-seal-start',
      ...acquisitionArgs('run-seal-owner', 'codex', 0),
      ...sessionCasArgs(runSealStore, 'release-run-seal-session', { identity: true, activity: true }),
      ...auditArgs('start run seal-session alias proof'), '--json', '--workflow-root', runSealRoot,
    ]), 'run seal-session alias Execution start');
    proveExecutionSealAlias(
      runSealRoot, runSealStore, ['run', 'seal-session'],
      'release-run-seal-session', runSealStart, 'verified run seal-session alias',
    );
    recordProof(proofs, 'run-seal-session-execution-alias-applied-replayed-conflict');

    const legacyRunSealRoot = join(projectRoot, 'run-seal-session-legacy');
    enableV13(legacyRunSealRoot);
    const legacyRunSealStore = new SessionStore(legacyRunSealRoot);
    proveLegacySealAlias(
      legacyRunSealRoot, legacyRunSealStore, ['run', 'seal-session'], 'release-run-seal-session-legacy',
    );
    recordProof(proofs, 'run-seal-session-legacy-1.x-fallback');

    writeReport(projectRoot, 'release-next', nextApplied.result.run_id);
    const retryCompleted = parseEnvelope(invoke([
      'run', 'complete', nextApplied.result.run_id, '--session', 'release-next',
      '--execution', 'execution-001', '--generation', '1', '--verdict', 'needs-retry',
      '--request-id', 'req-complete-retry', '--expected-execution-revision', '2',
      ...runLeaseArgs(nextClaim), '--json', '--workflow-root', projectRoot,
    ]), 'execution-aware complete needs-retry');
    assert.equal(retryCompleted.operation, 'complete');
    assert.equal(retryCompleted.result.sealed, true);
    assert.equal(retryCompleted.result.chain_transition.step_status, 'pending');
    assert.equal(retryCompleted.result.chain_transition.retry.count, 1);
    assert.equal(retryCompleted.result.chain_transition.retry.exhausted, false);
    assert.equal(
      store.readExecutionTransition('release-next', 'execution-001', 'req-complete-retry')?.payload.payload.chain_verdict,
      'needs-retry',
    );
    assert.equal(retryCompleted.fence.execution_revision, 3);
    assert.equal(store.readExecution('release-next', 'execution-001').status, 'active');
    assert.equal(store.readBundle('release-next').session.orchestration.chain[0].status, 'pending');
    assertTokenRedacted(retryCompleted, nextClaim.lease_id, 'execution-aware complete needs-retry');

    const retryNext = parseEnvelope(invoke([
      'run', 'next', '--session', 'release-next', '--execution', 'execution-001', '--generation', '1',
      '--request-id', 'req-next-retry', '--expected-execution-revision', '3',
      ...runLeaseArgs(nextClaim), '--json', '--workflow-root', projectRoot,
    ]), 'execution-aware retry next');
    assert.equal(retryNext.result.step.step_id, 'step-1');
    assert.notEqual(retryNext.result.run_id, nextApplied.result.run_id);
    assert.equal(retryNext.fence.execution_revision, 4);
    assertTokenRedacted(retryNext, nextClaim.lease_id, 'execution-aware retry next');
    recordProof(proofs, 'complete-needs-retry');

    const blockedStart = parseEnvelope(invoke([
      'execution', 'start', '--session', 'release-blocked', '--request-id', 'req-blocked-start',
      ...acquisitionArgs('blocked-owner', 'codex', 0),
      ...sessionCasArgs(store, 'release-blocked', { identity: true, activity: true }),
      ...auditArgs('start blocked execution'), '--json', '--workflow-root', projectRoot,
    ]), 'blocked execution start');
    const blockedClaim = acquisitionClaim(blockedStart, 'blocked execution start');
    const blockedNext = parseEnvelope(invoke([
      'run', 'next', '--session', 'release-blocked', '--execution', 'execution-001', '--generation', '1',
      '--request-id', 'req-blocked-next', '--expected-execution-revision', '1',
      ...runLeaseArgs(blockedClaim), '--json', '--workflow-root', projectRoot,
    ]), 'blocked execution next');
    writeReport(projectRoot, 'release-blocked', blockedNext.result.run_id);
    const blockedComplete = parseEnvelope(invoke([
      'run', 'complete', blockedNext.result.run_id, '--session', 'release-blocked',
      '--execution', 'execution-001', '--generation', '1', '--verdict', 'blocked',
      '--request-id', 'req-complete-blocked', '--expected-execution-revision', '2',
      ...runLeaseArgs(blockedClaim), '--json', '--workflow-root', projectRoot,
    ]), 'execution-aware complete blocked');
    assert.equal(blockedComplete.result.sealed, true);
    assert.equal(blockedComplete.result.chain_transition.step_status, 'failed');
    assert.equal(
      store.readExecutionTransition('release-blocked', 'execution-001', 'req-complete-blocked')?.payload.payload.chain_verdict,
      'blocked',
    );
    assert.equal(blockedComplete.fence.execution_revision, 3);
    assert.equal(blockedComplete.fence.lease_epoch, null);
    assert.equal(store.readExecution('release-blocked', 'execution-001').status, 'paused');
    assert.equal(store.readExecution('release-blocked', 'execution-001').lease, null);
    assert.equal(store.readBundle('release-blocked').session.status, 'paused');
    assertTokenRedacted(blockedComplete, blockedClaim.lease_id, 'execution-aware complete blocked');
    recordProof(proofs, 'complete-blocked');

    const decisionStart = parseEnvelope(invoke([
      'execution', 'start', '--session', 'release-decision', '--request-id', 'req-decision-start',
      ...acquisitionArgs('decision-owner', 'codex', 0),
      ...sessionCasArgs(store, 'release-decision', { identity: true, activity: true }),
      ...auditArgs('start decision execution'), '--json', '--workflow-root', projectRoot,
    ]), 'decision execution start');
    const decisionClaim = acquisitionClaim(decisionStart, 'decision execution start');
    const decideArgs = [
      'run', 'decide', 'DP-release', '--session', 'release-decision',
      '--execution', 'execution-001', '--generation', '1', '--verdict', 'escalate', '--confidence', 'high',
      '--request-id', 'req-decision-escalate', '--expected-execution-revision', '1',
      ...runLeaseArgs(decisionClaim), '--json', '--workflow-root', projectRoot,
    ];
    const escalated = parseEnvelope(invoke(decideArgs), 'execution-aware decide escalate');
    assert.equal(escalated.operation, 'decide');
    assert.equal(escalated.replay?.status, 'applied');
    assert.equal(escalated.result.verdict, 'escalate');
    assert.equal(escalated.result.point_status, 'escalated');
    assert.equal(escalated.result.session_status, 'paused');
    assert.equal(escalated.fence.execution_revision, 2);
    assert.equal(escalated.fence.lease_epoch, null);
    assertTokenRedacted(escalated, decisionClaim.lease_id, 'execution-aware decide escalate');
    const escalatedReplay = parseEnvelope(invoke(decideArgs), 'execution-aware decide escalate replay');
    assert.equal(escalatedReplay.replay?.status, 'replayed');
    assert.equal(escalatedReplay.replay?.transition_id, escalated.replay?.transition_id);
    assert.equal(escalatedReplay.result.point_status, 'escalated');
    assert.equal(store.readExecution('release-decision', 'execution-001').status, 'paused');
    assert.equal(store.readExecution('release-decision', 'execution-001').lease, null);
    assertTokenRedacted(escalatedReplay, decisionClaim.lease_id, 'execution-aware decide escalate replay');
    recordProof(proofs, 'decide-terminal-escalate-replay');

    const usageResult = invoke([
      'execution', 'pause', '--session', 'release-run', '--execution', 'execution-001',
      '--request-id', 'req-malformed-real-secrets', '--expected-execution-revision', '3',
      ...leaseArgs(runClaim), '--handoff-token', handoffToken, '--unknown-release-option',
      ...auditArgs('exercise commander redaction'), '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(usageResult.status, 2, 'Commander usage exit');
    const usage = parseEnvelope(usageResult, 'Commander 1.1 usage');
    assert.equal(usage.operation, 'execution-pause');
    assert.equal(usage.disposition, 'usage_error');
    assert.equal(usage.error?.code, 'COMMANDER_USAGE');
    assertTokenRedacted(usage, runClaim.lease_id, 'Commander 1.1 usage');
    assertTokenRedacted(usage, handoffToken, 'Commander 1.1 handoff usage');
    assert.equal(usageResult.stdout.includes(runClaim.lease_id), false, 'Commander stdout exposed acquired lease token');
    assert.equal(usageResult.stderr.includes(runClaim.lease_id), false, 'Commander stderr exposed acquired lease token');
    assert.equal(usageResult.stdout.includes(handoffToken), false, 'Commander stdout exposed acquired handoff token');
    assert.equal(usageResult.stderr.includes(handoffToken), false, 'Commander stderr exposed acquired handoff token');
    recordProof(proofs, 'commander-real-secret-redaction');

    const legacyResult = invoke([
      'run', 'create', 'release-execution', '--session', 'release-legacy',
      '--intent', 'legacy compatibility', '--json', '--workflow-root', projectRoot,
    ]);
    assert.equal(legacyResult.status, 0, 'legacy create exit');
    const legacy = parseEnvelope(legacyResult, 'legacy run-response compatibility', 'run-response/1.0');
    assert.equal(legacy.operation, 'create');
    assert.equal(legacy.ok, true);
    assert.equal('fence' in legacy, false);
    assert.equal('warnings' in legacy, false);
    assert.equal(store.readRun('release-legacy', legacy.result.run_id).schema_version, 'command-run/1.3');
    assert.equal(store.readBundle('release-legacy').session.schema_version, 'session/1.3');
    recordProof(proofs, 'legacy-1.0-create');

    runFocusedVitest(
      'src/run/session-knowledge-promotion.test.ts',
      'promotes a reviewed session candidate without sealing the Session',
    );
    recordProof(proofs, 'session-source-promotion-without-session-seal');

    assertTransitionSecretsRedacted(projectRoot, [
      claimA.lease_id, claimB.lease_id, claimC.lease_id, claimD.lease_id, runClaim.lease_id,
      nextClaim.lease_id, blockedClaim.lease_id, decisionClaim.lease_id, handoffToken,
    ]);
    recordProof(proofs, 'transition-secret-persistence-redaction');

    assert.deepEqual([...proofs].sort(), [...REQUIRED_BEHAVIOR_PROOFS].sort(), 'release behavior proof set');
    console.log(`session-run release machine parity passed: ${[...proofs].sort().join(', ')}`);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`session-run release machine failed: ${error?.name ?? 'Error'}: ${error?.message ?? 'unknown failure'}`);
  process.exitCode = 1;
});
