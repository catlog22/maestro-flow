import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acquireTupleLock,
  atomicWriteCanonical,
  createCanonicalFixtureReceipt,
  deriveDispatchIdentity,
  jcs,
  makeAggregateVerifierHermetic,
  releaseTupleLock,
  sha256,
  validateCanonicalReceipt,
} from '../run-lifecycle-fs-native-dispatch.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'run-lifecycle-fs-native-dispatch.mjs');
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'native-lifecycle-dispatch-receipt.valid.json');
const HEAD_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const BRANCH = 'maestro/native-lifecycle-20260724-010-plan-123456789abc';
const TARGETS = Object.freeze({
  'x86_64-pc-windows-msvc': {
    jobId: 'win32-x64',
    runner: 'windows-2025',
    platform: 'win32',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/win32-x64/maestro-lifecycle-fs.exe',
  },
  'x86_64-unknown-linux-gnu': {
    jobId: 'linux-x64',
    runner: 'ubuntu-24.04',
    platform: 'linux',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/linux-x64/maestro-lifecycle-fs',
  },
  'aarch64-unknown-linux-gnu': {
    jobId: 'linux-arm64',
    runner: 'ubuntu-24.04-arm',
    platform: 'linux',
    arch: 'arm64',
    binaryPath: 'resources/lifecycle-fs/linux-arm64/maestro-lifecycle-fs',
  },
  'x86_64-apple-darwin': {
    jobId: 'darwin-x64',
    runner: 'macos-15-intel',
    platform: 'darwin',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/darwin-x64/maestro-lifecycle-fs',
  },
  'aarch64-apple-darwin': {
    jobId: 'darwin-arm64',
    runner: 'macos-15',
    platform: 'darwin',
    arch: 'arm64',
    binaryPath: 'resources/lifecycle-fs/darwin-arm64/maestro-lifecycle-fs',
  },
});

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function identity(headSha = HEAD_SHA, branch = BRANCH) {
  return deriveDispatchIdentity({
    repo: 'catlog22/maestro-flow',
    workflowId: 247776234,
    ref: `refs/heads/${branch}`,
    headSha,
    inputs: { source_sha: headSha },
  });
}

function transactionRoot(workspace, tupleHash) {
  return join(
    workspace,
    '.workflow',
    'tmp',
    'lifecycle-native',
    '20260724-010-plan',
    'dispatch-transactions',
    tupleHash,
  );
}

function readTransaction(workspace, tupleHash, name) {
  return JSON.parse(readFileSync(join(transactionRoot(workspace, tupleHash), name), 'utf8'));
}

function buildAggregateFiles(runIdentity) {
  const files = [];
  const artifacts = [];
  for (const [target, mapping] of Object.entries(TARGETS)) {
    const artifactName = `lifecycle-fs-${mapping.platform}-${mapping.arch}-${runIdentity.tuple.head_sha}`;
    const binary = Buffer.from(`binary:${target}:${runIdentity.tuple.head_sha}`);
    const receipt = {
      schema_version: 'lifecycle-fs-native-receipt/1.0',
      task_id: 'TASK-004',
      job_id: mapping.jobId,
      runner: mapping.runner,
      target,
      platform: mapping.platform,
      arch: mapping.arch,
      artifact_name: artifactName,
      binary_path: mapping.binaryPath,
      protocol: 'lifecycle-fs-helper/1.0',
      binary_sha256: hash(binary),
      source_sha: runIdentity.tuple.head_sha,
      dispatch_nonce: runIdentity.dispatchNonce,
      run_name: `native-lifecycle-${runIdentity.tuple.head_sha}-${runIdentity.dispatchNonce}`,
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    files.push({
      path: `${artifactName}/${mapping.binaryPath}`,
      base64: binary.toString('base64'),
    });
    files.push({
      path: `${artifactName}/receipt.json`,
      base64: receiptBytes.toString('base64'),
    });
    artifacts.push({
      job_id: mapping.jobId,
      runner: mapping.runner,
      target,
      platform: mapping.platform,
      arch: mapping.arch,
      artifact_name: artifactName,
      binary_path: mapping.binaryPath,
      protocol: 'lifecycle-fs-helper/1.0',
      binary_sha256: hash(binary),
      receipt_sha256: hash(receiptBytes),
    });
  }
  const body = {
    schema_version: 'lifecycle-fs-native-aggregate/1.0',
    task_id: 'TASK-004',
    source_sha: runIdentity.tuple.head_sha,
    dispatch_nonce: runIdentity.dispatchNonce,
    run_name: `native-lifecycle-${runIdentity.tuple.head_sha}-${runIdentity.dispatchNonce}`,
    protocol: 'lifecycle-fs-helper/1.0',
    artifacts,
  };
  const aggregate = { ...body, aggregate_sha256: hash(JSON.stringify(body)) };
  files.push({
    path: 'aggregate-provenance.json',
    base64: Buffer.from(`${JSON.stringify(aggregate, null, 2)}\n`).toString('base64'),
  });
  return files;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks));
}

async function startFakeGitHub({
  initialRuns = [],
  postCreates = true,
  pageFactory,
} = {}) {
  const state = {
    runs: structuredClone(initialRuns),
    postCount: 0,
    log: [],
    nextId: 8000,
    postCreates,
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    state.log.push(`${request.method} ${url.pathname}${url.search}`);
    if (request.method === 'GET'
      && url.pathname === '/repos/catlog22/maestro-flow/actions/workflows/247776234/runs') {
      const page = Number(url.searchParams.get('page'));
      const workflowRuns = pageFactory
        ? pageFactory(page, state)
        : (page === 1 ? state.runs : []);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ total_count: workflowRuns.length, workflow_runs: workflowRuns }));
      return;
    }
    if (request.method === 'POST'
      && url.pathname === '/repos/catlog22/maestro-flow/actions/workflows/247776234/dispatches') {
      const body = await readRequestBody(request);
      state.postCount += 1;
      state.lastPost = body;
      if (state.postCreates) {
        state.runs.push({
          id: state.nextId++,
          run_attempt: 1,
          workflow_id: 247776234,
          event: 'workflow_dispatch',
          head_sha: body.inputs.source_sha,
          head_branch: body.ref,
          display_title: `native-lifecycle-${body.inputs.source_sha}-${body.inputs.dispatch_nonce}`,
          status: 'completed',
          conclusion: 'success',
        });
      }
      response.writeHead(204);
      response.end();
      return;
    }
    const match = url.pathname.match(/^\/repos\/catlog22\/maestro-flow\/actions\/runs\/(\d+)\/test-aggregate$/);
    if (request.method === 'GET' && match) {
      const run = state.runs.find(item => item.id === Number(match[1]));
      if (!run) {
        response.writeHead(404);
        response.end('missing run');
        return;
      }
      const runIdentity = identity(run.head_sha, run.head_branch);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        run_view: {
          databaseId: run.id,
          attempt: run.run_attempt,
          workflowDatabaseId: run.workflow_id,
          event: run.event,
          headSha: run.head_sha,
          headBranch: run.head_branch,
          displayTitle: run.display_title,
          status: run.status,
          conclusion: run.conclusion,
          jobs: [...Object.values(TARGETS).map(item => ({ name: item.jobId })), { name: 'aggregate' }],
        },
        files: buildAggregateFiles(runIdentity),
      }));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  return {
    state,
    apiBase: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolvePromise => server.close(resolvePromise)),
  };
}

function spawnDispatch({
  apiBase,
  workspace,
  failpoint,
  headSha = HEAD_SHA,
  branch = BRANCH,
  pollInterval = 1,
}) {
  const args = [
    SCRIPT,
    '--repo',
    'catlog22/maestro-flow',
    '--run-key',
    '20260724-010-plan',
    '--workspace-root',
    workspace,
    '--api-base',
    apiBase,
    '--token',
    'fake-token',
    '--branch',
    branch,
    '--head-sha',
    headSha,
    '--poll-interval-ms',
    String(pollInterval),
    '--lock-wait-ms',
    '10000',
    '--execute-authorized',
    '--transaction-only',
    '--test-mode',
  ];
  if (failpoint) args.push('--failpoint', failpoint);
  const child = spawn(process.execPath, args, {
    env: { ...process.env, NATIVE_LIFECYCLE_TESTING: '1' },
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise(resolvePromise => {
    child.on('close', code => resolvePromise({ code, stdout, stderr }));
  });
}

function uniqueRun(runIdentity, id = 7100) {
  return {
    id,
    run_attempt: 1,
    workflow_id: 247776234,
    event: 'workflow_dispatch',
    head_sha: runIdentity.tuple.head_sha,
    head_branch: runIdentity.tuple.ref.slice('refs/heads/'.length),
    display_title: `native-lifecycle-${runIdentity.tuple.head_sha}-${runIdentity.dispatchNonce}`,
    status: 'completed',
    conclusion: 'success',
  };
}

test('derives tuple and persists exclusive dispatch transaction', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-tuple-'));
  try {
    const first = identity();
    const second = identity();
    assert.equal(first.inputsHash, sha256(jcs({ source_sha: HEAD_SHA })));
    assert.equal(first.tupleHash, sha256(jcs(first.tuple)));
    assert.equal(first.dispatchNonce, `native-${first.tupleHash.slice(0, 32)}`);
    assert.deepEqual(first, second);
    assert.equal(jcs({ '\r': 1, a: 2, z: [true, null, -0] }), '{"\\r":1,"a":2,"z":[true,null,0]}');
    assert.throws(() => jcs({ bad: Number.NaN }), /non-finite/);

    const root = transactionRoot(workspace, first.tupleHash);
    mkdirSync(root, { recursive: true });
    const lockPath = join(root, 'lock');
    const owner = acquireTupleLock({ lockPath, identity: first, waitMs: 100 });
    assert.match(owner.generation, /^[0-9a-f]{32}$/);
    if (process.platform !== 'win32') assert.equal(statSync(lockPath).mode & 0o777, 0o600);
    releaseTupleLock({ lockPath, identity: first, owner });
    assert.equal(existsSync(lockPath), false);

    const intentPath = join(root, 'dispatch-intent.json');
    atomicWriteCanonical(intentPath, { z: 1, a: 2 });
    assert.equal(readFileSync(intentPath, 'utf8'), '{"a":2,"z":1}');

    const stale = {
      schema: 'native-lifecycle-dispatch-lock/1',
      tuple: first.tuple,
      tuple_hash: first.tupleHash,
      generation: 'a'.repeat(32),
      owner_pid: 2147483000,
      owner_host: hostname(),
      owner_process_started_at: '2020-01-01T00:00:00.000Z',
      owner_started_at: '2020-01-01T00:00:00.000Z',
      acquired_at: '2020-01-01T00:00:00.000Z',
    };
    writeFileSync(lockPath, jcs(stale), { flag: 'wx', mode: 0o600 });
    const recovered = acquireTupleLock({ lockPath, identity: first, waitMs: 100 });
    assert.notEqual(recovered.generation, stale.generation);
    releaseTupleLock({ lockPath, identity: first, owner: recovered });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('reconciles remotely before exactly one dispatch', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-once-'));
  const historical = uniqueRun(identity('1'.repeat(40), BRANCH), 7000);
  const fake = await startFakeGitHub({ initialRuns: [historical] });
  try {
    const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fake.state.postCount, 1);
    assert.match(fake.state.log[0], /^GET .*\/runs\?/);
    const postIndex = fake.state.log.findIndex(item => item.startsWith('POST '));
    assert.ok(postIndex >= 12, `POST index was ${postIndex}`);
    const runIdentity = identity();
    const receipt = readTransaction(workspace, runIdentity.tupleHash, 'dispatch-receipt.json');
    assert.equal(receipt.transaction_state, 'receipted');
    assert.deepEqual(receipt.cleanup, { state: 'pending', required: true });
    assert.equal(receipt.workflow_run.id, 8000);
    const replay = await spawnDispatch({ apiBase: fake.apiBase, workspace });
    assert.equal(replay.code, 0, replay.stderr);
    assert.equal(fake.state.postCount, 1);
  } finally {
    await fake.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('rejects native dispatch authority or exact-run violation', async t => {
  await t.test('mismatched remote row enters manual recovery without POST', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-mismatch-'));
    const runIdentity = identity();
    const mismatch = { ...uniqueRun(runIdentity), display_title: 'wrong-title' };
    const fake = await startFakeGitHub({ initialRuns: [mismatch] });
    try {
      const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /manual_recovery/);
      assert.equal(fake.state.postCount, 0);
      assert.equal(readTransaction(workspace, runIdentity.tupleHash, 'dispatch-intent.json').state, 'manual_recovery');
      const replay = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(replay.code, 1);
      assert.equal(fake.state.postCount, 0);
    } finally {
      await fake.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  await t.test('multiple exact rows never select latest', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-multiple-'));
    const runIdentity = identity();
    const fake = await startFakeGitHub({
      initialRuns: [uniqueRun(runIdentity, 7001), uniqueRun(runIdentity, 7002)],
    });
    try {
      const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /multiple/);
      assert.equal(fake.state.postCount, 0);
      assert.equal(existsSync(join(
        transactionRoot(workspace, runIdentity.tupleHash),
        'dispatch-receipt.json',
      )), false);
    } finally {
      await fake.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  await t.test('pagination saturation fails closed', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-pages-'));
    const runIdentity = identity();
    const fake = await startFakeGitHub({
      pageFactory: page => Array.from({ length: 100 }, (_, index) => ({
        ...uniqueRun(runIdentity, page * 1000 + index),
        display_title: `wrong-${page}-${index}`,
      })),
    });
    try {
      const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /pagination_saturated/);
      assert.equal(fake.state.postCount, 0);
      assert.equal(fake.state.log.filter(item => item.startsWith('GET ')).length, 10);
    } finally {
      await fake.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  await t.test('failed exact run enters manual recovery without resend', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-run-failed-'));
    const runIdentity = identity();
    const failedRun = { ...uniqueRun(runIdentity), conclusion: 'failure' };
    const fake = await startFakeGitHub({ initialRuns: [failedRun] });
    try {
      const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /successful conclusion mismatch/);
      assert.equal(fake.state.postCount, 0);
      assert.equal(
        readTransaction(workspace, runIdentity.tupleHash, 'dispatch-intent.json').state,
        'manual_recovery',
      );
      const replay = await spawnDispatch({ apiBase: fake.apiBase, workspace });
      assert.equal(replay.code, 1);
      assert.match(replay.stderr, /permanently fenced from resend/);
      assert.equal(fake.state.postCount, 0);
    } finally {
      await fake.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  assert.throws(() => deriveDispatchIdentity({
    repo: 'wrong/repo',
    workflowId: 247776234,
    ref: `refs/heads/${BRANCH}`,
    headSha: HEAD_SHA,
    inputs: { source_sha: HEAD_SHA },
  }), /not authorized/);
});

test('survives dispatch crash and concurrency matrix', async t => {
  for (const failpoint of [
    'before-dispatching-transition',
    'after-post-before-accepted',
    'after-accepted',
    'after-receipt',
  ]) {
    await t.test(failpoint, async () => {
      const workspace = mkdtempSync(join(tmpdir(), `native-dispatch-${failpoint}-`));
      const fake = await startFakeGitHub();
      try {
        const crashed = await spawnDispatch({ apiBase: fake.apiBase, workspace, failpoint });
        assert.ok([91, 92, 93, 94].includes(crashed.code), crashed.stderr);
        const resumed = await spawnDispatch({ apiBase: fake.apiBase, workspace });
        assert.equal(resumed.code, 0, resumed.stderr);
        assert.equal(fake.state.postCount, 1);
        assert.equal(fake.state.runs.length, 1);
        const receipt = readTransaction(workspace, identity().tupleHash, 'dispatch-receipt.json');
        assert.deepEqual(receipt.cleanup, { state: 'pending', required: true });
      } finally {
        await fake.close();
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  }

  await t.test('concurrent duplicate', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-concurrent-'));
    const fake = await startFakeGitHub();
    try {
      const [left, right] = await Promise.all([
        spawnDispatch({ apiBase: fake.apiBase, workspace, pollInterval: 3 }),
        spawnDispatch({ apiBase: fake.apiBase, workspace, pollInterval: 3 }),
      ]);
      assert.equal(left.code, 0, left.stderr);
      assert.equal(right.code, 0, right.stderr);
      assert.equal(fake.state.postCount, 1);
      assert.equal(fake.state.runs.length, 1);
      const receipt = readTransaction(workspace, identity().tupleHash, 'dispatch-receipt.json');
      assert.equal(receipt.transaction_state, 'receipted');
      assert.equal(receipt.cleanup.state, 'pending');
    } finally {
      await fake.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

test('binds exact run to five downloaded receipts', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-dispatch-bind-'));
  const runIdentity = identity();
  const fake = await startFakeGitHub({ initialRuns: [uniqueRun(runIdentity)] });
  try {
    const result = await spawnDispatch({ apiBase: fake.apiBase, workspace });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(fake.state.postCount, 0);
    const receipt = readTransaction(workspace, runIdentity.tupleHash, 'dispatch-receipt.json');
    assert.equal(receipt.workflow_run.id, 7100);
    assert.equal(receipt.artifacts.length, 5);
    assert.deepEqual(
      new Set(receipt.artifacts.map(item => item.target)),
      new Set(Object.keys(TARGETS)),
    );
    for (const artifact of receipt.artifacts) {
      assert.match(artifact.binary_sha256, /^[0-9a-f]{64}$/);
      assert.match(artifact.job_receipt_sha256, /^[0-9a-f]{64}$/);
      assert.ok(existsSync(resolve(workspace, artifact.binary_path)));
      assert.ok(existsSync(resolve(workspace, artifact.provenance_path)));
    }
  } finally {
    await fake.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('emits canonical native dispatch receipt fixture', () => {
  const expected = createCanonicalFixtureReceipt();
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(jcs(fixture), jcs(expected));
  const fixtureIdentity = deriveDispatchIdentity({
    repo: fixture.tuple.repo,
    workflowId: fixture.tuple.workflow_id,
    ref: fixture.tuple.ref,
    headSha: fixture.tuple.head_sha,
    inputs: fixture.canonical_inputs,
  });
  const relativeRoot = dirname(fixture.intent_path).replaceAll('\\', '/');
  validateCanonicalReceipt(fixture, fixtureIdentity, {
    relativeRoot,
    relativeIntentPath: fixture.intent_path,
    relativeReceiptPath: fixture.receipt_path,
  }, fixture.branch);
  assert.equal(fixture.transaction_state, 'receipted');
  assert.deepEqual(fixture.cleanup, { state: 'pending', required: true });
});

test('loads aggregate verifier without a runtime yaml dependency', () => {
  const isolated = mkdtempSync(join(tmpdir(), 'native-aggregate-hermetic-'));
  try {
    const source = readFileSync(
      resolve(dirname(SCRIPT), 'verify-lifecycle-fs-native-aggregate.mjs'),
      'utf8',
    );
    const lfPatched = makeAggregateVerifierHermetic(source.replace(/\r\n/g, '\n'));
    const crlfPatched = makeAggregateVerifierHermetic(source.replace(/\r?\n/g, '\r\n'));
    for (const patched of [lfPatched, crlfPatched]) {
      assert.equal(patched.includes("import YAML from 'yaml';"), false);
      assert.equal(patched.includes("const YAML = require('yaml');"), true);
      assert.equal(makeAggregateVerifierHermetic(patched), patched);
    }
    assert.doesNotMatch(lfPatched, /\r\n/);
    assert.doesNotMatch(crlfPatched, /(?<!\r)\n/);
    writeFileSync(join(isolated, 'verify-lifecycle-fs-native-aggregate.mjs'), crlfPatched);
    writeFileSync(
      join(isolated, 'write-lifecycle-fs-native-receipt.mjs'),
      readFileSync(resolve(dirname(SCRIPT), 'write-lifecycle-fs-native-receipt.mjs')),
    );
    const result = spawnSync(
      process.execPath,
      [join(isolated, 'verify-lifecycle-fs-native-aggregate.mjs')],
      {
        cwd: isolated,
        encoding: 'utf8',
        windowsHide: true,
        env: { SystemRoot: process.env.SystemRoot },
      },
    );
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package 'yaml'/);
    assert.match(result.stderr, /all four named arguments are required/);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test('enforces native no-publish and cleanup boundary', () => {
  const forbidden = [
    ['--repo', 'other/repo'],
    ['--run-key', 'wrong-run'],
    ['--transaction-only'],
  ];
  for (const extra of forbidden) {
    const result = spawnSync(process.execPath, [
      SCRIPT,
      '--execute-authorized',
      ...extra,
    ], { env: { ...process.env }, windowsHide: true, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
  const fixture = createCanonicalFixtureReceipt();
  assert.equal(fixture.cleanup.state, 'pending');
  assert.equal(fixture.cleanup.required, true);
  assert.equal(fixture.cleanup_required, true);
  assert.equal(JSON.stringify(fixture).includes('deploy-pages'), false);
  assert.equal(JSON.stringify(fixture).includes('npm publish'), false);
  assert.equal(Object.hasOwn(fixture, 'cleanup_command'), false);
});
