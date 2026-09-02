import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'catlog22/maestro-flow';
const WORKFLOW_ID = 247776234;
const WORKFLOW_PATH = '.github/workflows/deploy-docs.yml';
const DEFAULT_REF = 'refs/heads/master';
const DEFAULT_BLOB_SHA = 'd070327596e52788a309d4aeea84d54339b545b6';
const RUN_KEY = '20260724-010-plan';
const TRANSACTION_SCHEMA = 'native-lifecycle-dispatch-intent/1';
const LOCK_SCHEMA = 'native-lifecycle-dispatch-lock/1';
const RECEIPT_SCHEMA = 'native-lifecycle-dispatch-receipt/1';
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const NONCE = /^native-[0-9a-f]{32}$/;
const BRANCH = /^maestro\/native-lifecycle-20260724-010-plan-[0-9a-f]{12}$/;
const TARGETS = Object.freeze({
  'x86_64-pc-windows-msvc': Object.freeze({
    jobId: 'win32-x64',
    runner: 'windows-2025',
    platform: 'win32',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/win32-x64/maestro-lifecycle-fs.exe',
  }),
  'x86_64-unknown-linux-gnu': Object.freeze({
    jobId: 'linux-x64',
    runner: 'ubuntu-24.04',
    platform: 'linux',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/linux-x64/maestro-lifecycle-fs',
  }),
  'aarch64-unknown-linux-gnu': Object.freeze({
    jobId: 'linux-arm64',
    runner: 'ubuntu-24.04-arm',
    platform: 'linux',
    arch: 'arm64',
    binaryPath: 'resources/lifecycle-fs/linux-arm64/maestro-lifecycle-fs',
  }),
  'x86_64-apple-darwin': Object.freeze({
    jobId: 'darwin-x64',
    runner: 'macos-15-intel',
    platform: 'darwin',
    arch: 'x64',
    binaryPath: 'resources/lifecycle-fs/darwin-x64/maestro-lifecycle-fs',
  }),
  'aarch64-apple-darwin': Object.freeze({
    jobId: 'darwin-arm64',
    runner: 'macos-15',
    platform: 'darwin',
    arch: 'arm64',
    binaryPath: 'resources/lifecycle-fs/darwin-arm64/maestro-lifecycle-fs',
  }),
});
const POLL_POLICY = Object.freeze({
  attempts: 12,
  interval_ms: 5000,
  maximum_elapsed_ms: 60000,
  per_page: 100,
  maximum_pages: 10,
});
const WORKTREE_ALLOWLIST = Object.freeze([
  WORKFLOW_PATH,
  'native/lifecycle-fs/Cargo.toml',
  'native/lifecycle-fs/Cargo.lock',
  'native/lifecycle-fs/src',
  'native/lifecycle-fs/tests',
  'scripts/write-lifecycle-fs-native-receipt.mjs',
  'scripts/verify-lifecycle-fs-native-aggregate.mjs',
]);
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

function fail(message) {
  throw new Error(`native dispatch: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must be exactly ${wanted.join(', ')}`);
  }
}

/**
 * RFC 8785 JSON Canonicalization Scheme for JSON-domain values.
 * ECMAScript JSON number serialization and UTF-16 property ordering are the
 * primitives required by JCS.
 */
export function jcs(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('JCS rejects non-finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        fail('JCS rejects non-JSON array values');
      }
      return jcs(item);
    }).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('JCS accepts plain JSON objects only');
    }
    const entries = Object.keys(value).sort().map(key => {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        fail(`JCS rejects non-JSON object value at ${key}`);
      }
      return `${JSON.stringify(key)}:${jcs(child)}`;
    });
    return `{${entries.join(',')}}`;
  }
  fail(`JCS rejects ${typeof value}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function deriveDispatchIdentity({
  repo,
  workflowId,
  ref,
  headSha,
  inputs,
}) {
  if (repo !== REPO || workflowId !== WORKFLOW_ID) fail('repo or workflow_id is not authorized');
  if (!ref.startsWith('refs/heads/') || !HEX_40.test(headSha)) fail('invalid ref or head_sha');
  const canonicalInputs = Object.fromEntries(
    Object.entries(inputs).filter(([key]) => key !== 'dispatch_nonce'),
  );
  exactKeys(canonicalInputs, ['source_sha'], 'canonical inputs');
  if (canonicalInputs.source_sha !== headSha) fail('source_sha must equal head_sha');
  const inputsHash = sha256(jcs(canonicalInputs));
  const tuple = {
    repo,
    workflow_id: workflowId,
    ref,
    head_sha: headSha,
    inputs_hash: inputsHash,
  };
  const tupleHash = sha256(jcs(tuple));
  return {
    canonicalInputs,
    inputsHash,
    tuple,
    tupleHash,
    dispatchNonce: `native-${tupleHash.slice(0, 32)}`,
  };
}

function fsyncDirectory(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch (error) {
    if (!(process.platform === 'win32' && error?.code === 'EPERM')) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeExclusiveCanonical(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeSync(fd, jcs(value), null, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  }
  closeSync(fd);
  fsyncDirectory(dirname(path));
}

export function atomicWriteCanonical(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(16).toString('hex')}`;
  try {
    writeExclusiveCanonical(tempPath, value);
    renameSync(tempPath, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Preserve the primary persistence error.
    }
    throw error;
  }
}

function containedRelative(workspaceRoot, path, label) {
  const rel = relative(resolve(workspaceRoot), resolve(path)).replaceAll('\\', '/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    fail(`${label} escapes the workspace`);
  }
  return rel;
}

function assertContainedRegularFile(root, path, label) {
  const rootReal = realpathSync(root);
  const pathReal = realpathSync(path);
  const rel = relative(rootReal, pathReal);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(`${label} escapes its root`);
  }
  if (!lstatSync(pathReal).isFile()) fail(`${label} must be a regular file`);
  return pathReal;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function sleep(milliseconds) {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

function readStableLock(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const before = fstatSync(fd);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const pathStats = statSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino
      || after.dev !== pathStats.dev || after.ino !== pathStats.ino
      || before.size !== after.size || after.size !== pathStats.size) {
      return null;
    }
    return { record: JSON.parse(bytes), dev: after.dev, ino: after.ino, size: after.size };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`cannot safely inspect lock: ${error.message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function validateLockRecord(record, identity) {
  exactKeys(record, [
    'schema',
    'tuple',
    'tuple_hash',
    'generation',
    'owner_pid',
    'owner_host',
    'owner_process_started_at',
    'owner_started_at',
    'acquired_at',
  ], 'lock record');
  if (record.schema !== LOCK_SCHEMA
    || jcs(record.tuple) !== jcs(identity.tuple)
    || record.tuple_hash !== identity.tupleHash
    || !/^[0-9a-f]{32}$/.test(record.generation)
    || !Number.isInteger(record.owner_pid) || record.owner_pid <= 0
    || typeof record.owner_host !== 'string' || !record.owner_host
    || !Number.isFinite(Date.parse(record.owner_process_started_at))
    || !Number.isFinite(Date.parse(record.owner_started_at))
    || !Number.isFinite(Date.parse(record.acquired_at))) {
    fail('lock record does not bind the canonical tuple and owner');
  }
}

function sameSnapshot(left, right) {
  return left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && jcs(left.record) === jcs(right.record);
}

export function acquireTupleLock({ lockPath, identity, waitMs = 60000 }) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  const owner = {
    schema: LOCK_SCHEMA,
    tuple: identity.tuple,
    tuple_hash: identity.tupleHash,
    generation: randomBytes(16).toString('hex'),
    owner_pid: process.pid,
    owner_host: hostname(),
    owner_process_started_at: PROCESS_STARTED_AT,
    owner_started_at: new Date().toISOString(),
    acquired_at: new Date().toISOString(),
  };
  while (true) {
    try {
      writeExclusiveCanonical(lockPath, owner);
      return owner;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const snapshot = readStableLock(lockPath);
    if (!snapshot) continue;
    validateLockRecord(snapshot.record, identity);
    const verified = readStableLock(lockPath);
    if (!sameSnapshot(snapshot, verified)) continue;
    if (snapshot.record.owner_host !== hostname()) {
      fail('manual_recovery: cross-host lock ownership is not reclaimable');
    }
    const liveness = processLiveness(snapshot.record.owner_pid);
    if (liveness === 'alive') {
      if (Date.now() - started >= waitMs) fail('manual_recovery: live tuple lock wait expired');
      sleep(25);
      continue;
    }
    if (liveness !== 'dead' || snapshot.record.owner_process_started_at === PROCESS_STARTED_AT) {
      fail('manual_recovery: stale lock ownership is unverifiable');
    }
    const claimPath = `${lockPath}.recovery-${snapshot.record.generation}`;
    const claim = {
      schema: 'native-lifecycle-dispatch-lock-recovery/1',
      tuple_hash: identity.tupleHash,
      stale_generation: snapshot.record.generation,
      claimant_generation: owner.generation,
      claimant_pid: process.pid,
      claimant_host: hostname(),
      claimed_at: new Date().toISOString(),
    };
    try {
      writeExclusiveCanonical(claimPath, claim);
    } catch (error) {
      if (error?.code === 'EEXIST') fail('manual_recovery: stale lock already has a recovery claim');
      throw error;
    }
    const finalSnapshot = readStableLock(lockPath);
    if (!sameSnapshot(snapshot, finalSnapshot)) {
      fail('manual_recovery: lock generation changed during stale recovery');
    }
    unlinkSync(lockPath);
    fsyncDirectory(dirname(lockPath));
    unlinkSync(claimPath);
    fsyncDirectory(dirname(lockPath));
  }
}

export function releaseTupleLock({ lockPath, identity, owner }) {
  const snapshot = readStableLock(lockPath);
  if (!snapshot) fail('lock vanished before owner-bound release');
  validateLockRecord(snapshot.record, identity);
  const expected = [
    snapshot.record.generation === owner.generation,
    snapshot.record.owner_pid === owner.owner_pid,
    snapshot.record.owner_host === owner.owner_host,
    snapshot.record.owner_process_started_at === owner.owner_process_started_at,
  ];
  if (expected.some(value => !value)) fail('lock owner generation changed before release');
  const verified = readStableLock(lockPath);
  if (!sameSnapshot(snapshot, verified)) fail('lock generation changed during release');
  unlinkSync(lockPath);
  fsyncDirectory(dirname(lockPath));
}

function transactionPaths(workspaceRoot, runKey, tupleHash) {
  const root = resolve(
    workspaceRoot,
    '.workflow',
    'tmp',
    'lifecycle-native',
    runKey,
    'dispatch-transactions',
    tupleHash,
  );
  const expectedBase = resolve(workspaceRoot, '.workflow', 'tmp', 'lifecycle-native', runKey);
  const rel = relative(expectedBase, root);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('transaction root is outside authorized temp root');
  const relativeRoot = containedRelative(workspaceRoot, root, 'transaction root');
  return {
    root,
    relativeRoot,
    lockPath: join(root, 'lock'),
    intentPath: join(root, 'dispatch-intent.json'),
    receiptPath: join(root, 'dispatch-receipt.json'),
    downloadPath: join(root, 'download'),
    relativeIntentPath: `${relativeRoot}/dispatch-intent.json`,
    relativeReceiptPath: `${relativeRoot}/dispatch-receipt.json`,
  };
}

function newIntent(identity, paths, now) {
  return {
    schema: TRANSACTION_SCHEMA,
    state: 'pending',
    tuple: identity.tuple,
    tuple_hash: identity.tupleHash,
    dispatch_nonce: identity.dispatchNonce,
    canonical_inputs: identity.canonicalInputs,
    inputs_hash: identity.inputsHash,
    created_at: now,
    updated_at: now,
    poll_policy: POLL_POLICY,
    receipt_path: paths.relativeReceiptPath,
    cleanup_required: true,
    post_started_at: null,
    post_count: 0,
    accepted_at: null,
    receipt_sha256: null,
    last_reconciliation: null,
  };
}

function validateReconciliation(value) {
  if (value === null) return;
  exactKeys(value, [
    'started_at',
    'completed_at',
    'attempts',
    'match_count',
    'page_response_sha256',
    'outcome',
  ], 'last_reconciliation');
  if (!Number.isFinite(Date.parse(value.started_at))
    || !Number.isFinite(Date.parse(value.completed_at))
    || !Number.isInteger(value.attempts) || value.attempts < 1 || value.attempts > 12
    || !Number.isInteger(value.match_count) || value.match_count < 0
    || !Array.isArray(value.page_response_sha256)
    || value.page_response_sha256.some(hash => !HEX_64.test(hash))
    || !['one', 'zero', 'multiple', 'mismatch', 'pagination_saturated'].includes(value.outcome)) {
    fail('last_reconciliation is invalid');
  }
}

function validateIntent(value, identity, paths) {
  exactKeys(value, [
    'schema',
    'state',
    'tuple',
    'tuple_hash',
    'dispatch_nonce',
    'canonical_inputs',
    'inputs_hash',
    'created_at',
    'updated_at',
    'poll_policy',
    'receipt_path',
    'cleanup_required',
    'post_started_at',
    'post_count',
    'accepted_at',
    'receipt_sha256',
    'last_reconciliation',
  ], 'dispatch intent');
  if (value.schema !== TRANSACTION_SCHEMA
    || !['pending', 'dispatching', 'accepted_unreceipted', 'receipted', 'manual_recovery'].includes(value.state)
    || jcs(value.tuple) !== jcs(identity.tuple)
    || value.tuple_hash !== identity.tupleHash
    || value.dispatch_nonce !== identity.dispatchNonce
    || jcs(value.canonical_inputs) !== jcs(identity.canonicalInputs)
    || value.inputs_hash !== identity.inputsHash
    || value.receipt_path !== paths.relativeReceiptPath
    || value.cleanup_required !== true
    || jcs(value.poll_policy) !== jcs(POLL_POLICY)
    || !Number.isFinite(Date.parse(value.created_at))
    || !Number.isFinite(Date.parse(value.updated_at))
    || ![0, 1].includes(value.post_count)
    || (value.post_started_at !== null && !Number.isFinite(Date.parse(value.post_started_at)))
    || (value.accepted_at !== null && !Number.isFinite(Date.parse(value.accepted_at)))
    || (value.receipt_sha256 !== null && !HEX_64.test(value.receipt_sha256))) {
    fail('dispatch intent does not revalidate byte-for-byte');
  }
  const stateRules = {
    pending: value.post_count === 0 && value.post_started_at === null
      && value.accepted_at === null && value.receipt_sha256 === null,
    dispatching: value.post_count === 1 && value.post_started_at !== null
      && value.accepted_at === null && value.receipt_sha256 === null,
    accepted_unreceipted: value.post_count === 1 && value.post_started_at !== null
      && value.accepted_at !== null && value.receipt_sha256 === null,
    receipted: value.post_count <= 1 && value.receipt_sha256 !== null,
    manual_recovery: true,
  };
  if (!stateRules[value.state]) fail(`illegal durable values for ${value.state}`);
  validateReconciliation(value.last_reconciliation);
  return value;
}

function persistIntent(paths, identity, next) {
  validateIntent(next, identity, paths);
  atomicWriteCanonical(paths.intentPath, next);
  return next;
}

function transitionIntent(paths, identity, intent, patch) {
  const next = {
    ...intent,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  return persistIntent(paths, identity, next);
}

function expectedDisplayTitle(identity) {
  return `native-lifecycle-${identity.tuple.head_sha}-${identity.dispatchNonce}`;
}

async function apiJson(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(body ? { body: jcs(body) } : {}),
  });
  if (!response.ok) {
    const detail = await response.text();
    fail(`GitHub API ${method} ${url} returned ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function reconcileRuns({
  apiBase,
  token,
  identity,
  branch,
  attempt = 1,
}) {
  const startedAt = new Date().toISOString();
  const pageHashes = [];
  const rows = [];
  let saturated = false;
  for (let page = 1; page <= POLL_POLICY.maximum_pages; page += 1) {
    const query = new URLSearchParams({
      branch,
      event: 'workflow_dispatch',
      per_page: String(POLL_POLICY.per_page),
      page: String(page),
    });
    const response = await apiJson(
      `${apiBase}/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?${query}`,
      { token },
    );
    if (!response || !Array.isArray(response.workflow_runs)) {
      fail('workflow runs response is not a workflow_runs object');
    }
    pageHashes.push(sha256(jcs(response)));
    rows.push(...response.workflow_runs);
    if (response.workflow_runs.length < POLL_POLICY.per_page) break;
    if (page === POLL_POLICY.maximum_pages) saturated = true;
  }
  const candidates = rows.filter(run => run.head_sha === identity.tuple.head_sha);
  const exact = candidates.filter(run => (
    run.workflow_id === WORKFLOW_ID
    && run.event === 'workflow_dispatch'
    && run.head_sha === identity.tuple.head_sha
    && run.head_branch === branch
    && run.display_title === expectedDisplayTitle(identity)
  ));
  const mismatched = candidates.filter(run => !exact.includes(run));
  let outcome = 'zero';
  if (saturated) outcome = 'pagination_saturated';
  else if (mismatched.length > 0) outcome = 'mismatch';
  else if (exact.length === 1) outcome = 'one';
  else if (exact.length > 1) outcome = 'multiple';
  return {
    outcome,
    matches: exact,
    record: {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      attempts: attempt,
      match_count: exact.length,
      page_response_sha256: pageHashes,
      outcome,
    },
  };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} failed: ${
        result.error?.message ?? (result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`)
      }`,
    );
  }
  return result.stdout.trim();
}

function validateRunView(runView, run, identity, branch) {
  const id = runView.databaseId ?? runView.id;
  const attempt = runView.attempt ?? run.run_attempt ?? 1;
  const workflowId = runView.workflowDatabaseId ?? runView.workflow_id ?? run.workflow_id;
  const displayTitle = runView.displayTitle ?? runView.display_title ?? run.display_title;
  const event = runView.event ?? run.event;
  const headSha = runView.headSha ?? runView.head_sha ?? run.head_sha;
  const headBranch = runView.headBranch ?? runView.head_branch ?? run.head_branch;
  const status = runView.status ?? run.status;
  const conclusion = runView.conclusion ?? run.conclusion;
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(attempt) || attempt < 1
    || workflowId !== WORKFLOW_ID || event !== 'workflow_dispatch'
    || headSha !== identity.tuple.head_sha || headBranch !== branch
    || displayTitle !== expectedDisplayTitle(identity)
    || status !== 'completed' || conclusion !== 'success') {
    fail('exact workflow run identity or successful conclusion mismatch');
  }
  const jobNames = (runView.jobs ?? []).map(job => job.name).sort();
  const expectedJobs = [...Object.values(TARGETS).map(item => item.jobId), 'aggregate'].sort();
  if (JSON.stringify(jobNames) !== JSON.stringify(expectedJobs)) {
    fail('exact run must contain only five native jobs plus aggregate');
  }
  return {
    id,
    attempt,
    workflow_id: workflowId,
    event,
    head_sha: headSha,
    head_branch: headBranch,
    head_ref: identity.tuple.ref,
    display_title: displayTitle,
  };
}

function validateReceiptWorkflowRun(run, identity, branch) {
  exactKeys(run, [
    'id',
    'attempt',
    'workflow_id',
    'event',
    'head_sha',
    'head_branch',
    'head_ref',
    'display_title',
  ], 'receipt workflow_run');
  if (!Number.isInteger(run.id) || run.id <= 0
    || !Number.isInteger(run.attempt) || run.attempt < 1
    || run.workflow_id !== WORKFLOW_ID
    || run.event !== 'workflow_dispatch'
    || run.head_sha !== identity.tuple.head_sha
    || run.head_branch !== branch
    || run.head_ref !== identity.tuple.ref
    || run.display_title !== expectedDisplayTitle(identity)) {
    fail('receipt workflow_run identity mismatch');
  }
}

function validateJobReceipt(receipt, target, identity) {
  const mapping = TARGETS[target];
  exactKeys(receipt, [
    'schema_version',
    'task_id',
    'job_id',
    'runner',
    'target',
    'platform',
    'arch',
    'artifact_name',
    'binary_path',
    'protocol',
    'binary_sha256',
    'source_sha',
    'dispatch_nonce',
    'run_name',
  ], `${target} receipt`);
  const expected = {
    schema_version: 'lifecycle-fs-native-receipt/1.0',
    task_id: 'TASK-004',
    job_id: mapping.jobId,
    runner: mapping.runner,
    target,
    platform: mapping.platform,
    arch: mapping.arch,
    artifact_name: `lifecycle-fs-${mapping.platform}-${mapping.arch}-${identity.tuple.head_sha}`,
    binary_path: mapping.binaryPath,
    protocol: 'lifecycle-fs-helper/1.0',
    source_sha: identity.tuple.head_sha,
    dispatch_nonce: identity.dispatchNonce,
    run_name: expectedDisplayTitle(identity),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) fail(`${target} receipt ${key} mismatch`);
  }
  if (!HEX_64.test(receipt.binary_sha256)) fail(`${target} binary_sha256 is invalid`);
}

function findNamedFile(root, name) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const stats = lstatSync(path);
      if (stats.isDirectory()) stack.push(path);
      else if (entry.name === name) return path;
    }
  }
  fail(`${name} is missing from downloaded aggregate`);
}

function verifyDownloadedAggregate(workspaceRoot, paths, identity) {
  const provenancePath = findNamedFile(paths.downloadPath, 'aggregate-provenance.json');
  const provenanceBytes = readFileSync(provenancePath);
  const aggregate = JSON.parse(provenanceBytes);
  exactKeys(aggregate, [
    'schema_version',
    'task_id',
    'source_sha',
    'dispatch_nonce',
    'run_name',
    'protocol',
    'artifacts',
    'aggregate_sha256',
  ], 'aggregate provenance');
  if (aggregate.schema_version !== 'lifecycle-fs-native-aggregate/1.0'
    || aggregate.task_id !== 'TASK-004'
    || aggregate.source_sha !== identity.tuple.head_sha
    || aggregate.dispatch_nonce !== identity.dispatchNonce
    || aggregate.run_name !== expectedDisplayTitle(identity)
    || aggregate.protocol !== 'lifecycle-fs-helper/1.0'
    || !Array.isArray(aggregate.artifacts)
    || aggregate.artifacts.length !== 5) {
    fail('aggregate provenance identity mismatch');
  }
  const { aggregate_sha256: storedAggregateHash, ...aggregateBody } = aggregate;
  if (storedAggregateHash !== sha256(JSON.stringify(aggregateBody))) {
    fail('aggregate provenance self-hash mismatch');
  }
  const targetSet = new Set(aggregate.artifacts.map(item => item.target));
  if (targetSet.size !== 5 || Object.keys(TARGETS).some(target => !targetSet.has(target))) {
    fail('aggregate target set mismatch');
  }
  const artifacts = aggregate.artifacts.map(item => {
    const target = item.target;
    const mapping = TARGETS[target];
    if (!mapping) fail(`unknown aggregate target ${target}`);
    const artifactName = `lifecycle-fs-${mapping.platform}-${mapping.arch}-${identity.tuple.head_sha}`;
    if (item.job_id !== mapping.jobId || item.runner !== mapping.runner
      || item.artifact_name !== artifactName || item.binary_path !== mapping.binaryPath
      || item.protocol !== 'lifecycle-fs-helper/1.0' || !HEX_64.test(item.binary_sha256)
      || !HEX_64.test(item.receipt_sha256)) {
      fail(`${target} aggregate mapping mismatch`);
    }
    const artifactRoot = resolve(dirname(provenancePath), artifactName);
    const receiptPath = assertContainedRegularFile(
      artifactRoot,
      join(artifactRoot, 'receipt.json'),
      `${target} receipt`,
    );
    const receiptBytes = readFileSync(receiptPath);
    const receipt = JSON.parse(receiptBytes);
    validateJobReceipt(receipt, target, identity);
    if (sha256(receiptBytes) !== item.receipt_sha256) fail(`${target} job receipt hash mismatch`);
    const binaryPath = assertContainedRegularFile(
      artifactRoot,
      join(artifactRoot, item.binary_path),
      `${target} binary`,
    );
    if (sha256(readFileSync(binaryPath)) !== item.binary_sha256
      || receipt.binary_sha256 !== item.binary_sha256) {
      fail(`${target} binary byte hash mismatch`);
    }
    const downloadPath = containedRelative(workspaceRoot, artifactRoot, `${target} download`);
    return {
      target,
      runner_label: mapping.runner,
      artifact_name: artifactName,
      download_path: downloadPath,
      binary_path: containedRelative(workspaceRoot, binaryPath, `${target} binary`),
      binary_sha256: item.binary_sha256,
      protocol_version: item.protocol,
      job_receipt_sha256: item.receipt_sha256,
      provenance_path: containedRelative(workspaceRoot, receiptPath, `${target} provenance`),
      provenance_sha256: item.receipt_sha256,
    };
  });
  return {
    artifacts,
    aggregateProvenance: {
      path: containedRelative(workspaceRoot, provenancePath, 'aggregate provenance'),
      sha256: sha256(provenanceBytes),
    },
  };
}

async function downloadAndVerifyRun({
  apiBase,
  token,
  repo,
  workspaceRoot,
  paths,
  identity,
  branch,
  run,
  testMode,
}) {
  mkdirSync(paths.downloadPath, { recursive: true });
  let runView;
  if (testMode) {
    const payload = await apiJson(`${apiBase}/repos/${repo}/actions/runs/${run.id}/test-aggregate`, { token });
    exactKeys(payload, ['run_view', 'files'], 'fake exact-run aggregate');
    if (!Array.isArray(payload.files)) fail('fake exact-run files must be an array');
    for (const file of payload.files) {
      exactKeys(file, ['path', 'base64'], 'fake exact-run file');
      const target = resolve(paths.downloadPath, file.path);
      const rel = relative(paths.downloadPath, target);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('fake exact-run file escapes download root');
      mkdirSync(dirname(target), { recursive: true });
      let fd;
      try {
        fd = openSync(target, 'wx', 0o600);
        writeSync(fd, Buffer.from(file.base64, 'base64'));
        fsyncSync(fd);
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    fsyncDirectory(paths.downloadPath);
    runView = payload.run_view;
  } else {
    runCommand('gh', ['run', 'watch', String(run.id), '--repo', repo, '--exit-status']);
    runView = JSON.parse(runCommand('gh', [
      'run',
      'view',
      String(run.id),
      '--repo',
      repo,
      '--json',
      'databaseId,displayTitle,event,headBranch,headSha,jobs,status,conclusion,workflowDatabaseId,workflowName',
    ]));
    runCommand('gh', [
      'run',
      'download',
      String(run.id),
      '--repo',
      repo,
      '--name',
      `lifecycle-fs-aggregate-${identity.tuple.head_sha}`,
      '--dir',
      paths.downloadPath,
    ]);
  }
  return {
    workflowRun: validateRunView(runView, run, identity, branch),
    ...verifyDownloadedAggregate(workspaceRoot, paths, identity),
  };
}

export function serializeCanonicalReceipt(input) {
  const body = {
    schema_version: RECEIPT_SCHEMA,
    transaction_state: 'receipted',
    cleanup: { state: 'pending', required: true },
    cleanup_required: true,
    tuple: input.identity.tuple,
    tuple_hash: input.identity.tupleHash,
    canonical_inputs: input.identity.canonicalInputs,
    dispatch_nonce: input.identity.dispatchNonce,
    branch: input.branch,
    ref: input.identity.tuple.ref,
    default_ref: DEFAULT_REF,
    default_blob_sha: DEFAULT_BLOB_SHA,
    overlay_commit_sha: input.identity.tuple.head_sha,
    workflow_run: input.workflowRun,
    artifacts: input.artifacts,
    aggregate_provenance: input.aggregateProvenance,
    intent_path: input.paths.relativeIntentPath,
    receipt_path: input.paths.relativeReceiptPath,
    created_at: input.createdAt,
    receipted_at: input.receiptedAt,
  };
  return { ...body, receipt_sha256: sha256(jcs(body)) };
}

function assertNormalizedWorkspacePath(path, prefix, label) {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/')
    || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')
    || !path.startsWith(prefix)) {
    fail(`${label} is not a contained normalized workspace path`);
  }
}

export function validateCanonicalReceipt(receipt, identity, paths, branch) {
  exactKeys(receipt, [
    'schema_version',
    'transaction_state',
    'cleanup',
    'cleanup_required',
    'tuple',
    'tuple_hash',
    'canonical_inputs',
    'dispatch_nonce',
    'branch',
    'ref',
    'default_ref',
    'default_blob_sha',
    'overlay_commit_sha',
    'workflow_run',
    'artifacts',
    'aggregate_provenance',
    'intent_path',
    'receipt_path',
    'created_at',
    'receipted_at',
    'receipt_sha256',
  ], 'canonical dispatch receipt');
  const { receipt_sha256: storedHash, ...body } = receipt;
  if (receipt.schema_version !== RECEIPT_SCHEMA
    || receipt.transaction_state !== 'receipted'
    || jcs(receipt.cleanup) !== jcs({ state: 'pending', required: true })
    || receipt.cleanup_required !== true
    || jcs(receipt.tuple) !== jcs(identity.tuple)
    || receipt.tuple_hash !== identity.tupleHash
    || jcs(receipt.canonical_inputs) !== jcs(identity.canonicalInputs)
    || receipt.dispatch_nonce !== identity.dispatchNonce
    || receipt.branch !== branch || !BRANCH.test(branch)
    || receipt.ref !== identity.tuple.ref
    || receipt.default_ref !== DEFAULT_REF
    || receipt.default_blob_sha !== DEFAULT_BLOB_SHA
    || receipt.overlay_commit_sha !== identity.tuple.head_sha
    || receipt.intent_path !== paths.relativeIntentPath
    || receipt.receipt_path !== paths.relativeReceiptPath
    || !Number.isFinite(Date.parse(receipt.created_at))
    || !Number.isFinite(Date.parse(receipt.receipted_at))
    || Date.parse(receipt.receipted_at) < Date.parse(receipt.created_at)
    || storedHash !== sha256(jcs(body))) {
    fail('canonical dispatch receipt identity or self-hash mismatch');
  }
  validateReceiptWorkflowRun(receipt.workflow_run, identity, branch);
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length !== 5
    || new Set(receipt.artifacts.map(item => item.target)).size !== 5
    || Object.keys(TARGETS).some(target => !receipt.artifacts.some(item => item.target === target))) {
    fail('canonical dispatch receipt artifact set mismatch');
  }
  for (const item of receipt.artifacts) {
    exactKeys(item, [
      'target',
      'runner_label',
      'artifact_name',
      'download_path',
      'binary_path',
      'binary_sha256',
      'protocol_version',
      'job_receipt_sha256',
      'provenance_path',
      'provenance_sha256',
    ], `${item.target} canonical artifact`);
    const mapping = TARGETS[item.target];
    if (!mapping || item.runner_label !== mapping.runner
      || !HEX_64.test(item.binary_sha256)
      || !HEX_64.test(item.job_receipt_sha256)
      || !HEX_64.test(item.provenance_sha256)
      || item.protocol_version !== 'lifecycle-fs-helper/1.0') {
      fail(`${item.target} canonical artifact mismatch`);
    }
    assertNormalizedWorkspacePath(item.download_path, `${paths.relativeRoot}/download/`, `${item.target} download_path`);
    assertNormalizedWorkspacePath(item.binary_path, `${item.download_path}/`, `${item.target} binary_path`);
    assertNormalizedWorkspacePath(item.provenance_path, `${item.download_path}/`, `${item.target} provenance_path`);
  }
  exactKeys(receipt.aggregate_provenance, ['path', 'sha256'], 'aggregate_provenance');
  if (!HEX_64.test(receipt.aggregate_provenance.sha256)) fail('aggregate provenance hash is invalid');
  assertNormalizedWorkspacePath(
    receipt.aggregate_provenance.path,
    `${paths.relativeRoot}/download/`,
    'aggregate provenance path',
  );
  return receipt;
}

export function createCanonicalFixtureReceipt() {
  const headSha = '0123456789abcdef0123456789abcdef01234567';
  const branch = `maestro/native-lifecycle-${RUN_KEY}-${headSha.slice(0, 12)}`;
  const identity = deriveDispatchIdentity({
    repo: REPO,
    workflowId: WORKFLOW_ID,
    ref: `refs/heads/${branch}`,
    headSha,
    inputs: { source_sha: headSha },
  });
  const relativeRoot = `.workflow/tmp/lifecycle-native/${RUN_KEY}/dispatch-transactions/${identity.tupleHash}`;
  const paths = {
    relativeRoot,
    relativeIntentPath: `${relativeRoot}/dispatch-intent.json`,
    relativeReceiptPath: `${relativeRoot}/dispatch-receipt.json`,
  };
  const artifacts = Object.entries(TARGETS).map(([target, mapping], index) => {
    const artifactName = `lifecycle-fs-${mapping.platform}-${mapping.arch}-${headSha}`;
    const downloadPath = `${relativeRoot}/download/${artifactName}`;
    return {
      target,
      runner_label: mapping.runner,
      artifact_name: artifactName,
      download_path: downloadPath,
      binary_path: `${downloadPath}/${mapping.binaryPath}`,
      binary_sha256: (index + 1).toString(16).repeat(64),
      protocol_version: 'lifecycle-fs-helper/1.0',
      job_receipt_sha256: (index + 6).toString(16).repeat(64),
      provenance_path: `${downloadPath}/receipt.json`,
      provenance_sha256: (index + 6).toString(16).repeat(64),
    };
  });
  return serializeCanonicalReceipt({
    identity,
    paths,
    branch,
    workflowRun: {
      id: 101,
      attempt: 1,
      workflow_id: WORKFLOW_ID,
      event: 'workflow_dispatch',
      head_sha: headSha,
      head_branch: branch,
      head_ref: `refs/heads/${branch}`,
      display_title: expectedDisplayTitle(identity),
    },
    artifacts,
    aggregateProvenance: {
      path: `${relativeRoot}/download/aggregate-provenance.json`,
      sha256: 'b'.repeat(64),
    },
    createdAt: '2026-07-24T00:00:00.000Z',
    receiptedAt: '2026-07-24T00:01:00.000Z',
  });
}

async function receiptUniqueRun(options, intent, run) {
  if (existsSync(options.paths.receiptPath)) {
    const existing = validateCanonicalReceipt(
      readJson(options.paths.receiptPath, 'dispatch receipt'),
      options.identity,
      options.paths,
      options.branch,
    );
    if (intent.state !== 'receipted') {
      transitionIntent(options.paths, options.identity, intent, {
        state: 'receipted',
        receipt_sha256: existing.receipt_sha256,
      });
    }
    return existing;
  }
  let verified;
  try {
    verified = await downloadAndVerifyRun({ ...options, run });
  } catch (error) {
    transitionIntent(options.paths, options.identity, intent, {
      state: 'manual_recovery',
    });
    throw error;
  }
  const receipt = serializeCanonicalReceipt({
    identity: options.identity,
    paths: options.paths,
    branch: options.branch,
    workflowRun: verified.workflowRun,
    artifacts: verified.artifacts,
    aggregateProvenance: verified.aggregateProvenance,
    createdAt: intent.created_at,
    receiptedAt: new Date().toISOString(),
  });
  validateCanonicalReceipt(receipt, options.identity, options.paths, options.branch);
  atomicWriteCanonical(options.paths.receiptPath, receipt);
  if (options.failpoint === 'after-receipt') process.exit(94);
  transitionIntent(options.paths, options.identity, intent, {
    state: 'receipted',
    receipt_sha256: receipt.receipt_sha256,
  });
  return receipt;
}

async function pollWindow(options, first, attempts = POLL_POLICY.attempts) {
  let latest = first;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 || !latest) {
      sleep(options.pollIntervalMs);
      latest = await reconcileRuns({
        apiBase: options.apiBase,
        token: options.token,
        identity: options.identity,
        branch: options.branch,
        attempt,
      });
    } else {
      latest.record.attempts = attempt;
    }
    if (latest.outcome !== 'zero') return latest;
  }
  return latest;
}

export async function runDispatchTransaction(options) {
  const paths = transactionPaths(options.workspaceRoot, options.runKey, options.identity.tupleHash);
  const owner = acquireTupleLock({
    lockPath: paths.lockPath,
    identity: options.identity,
    waitMs: options.lockWaitMs,
  });
  const context = { ...options, paths };
  try {
    // This must remain the first protected operation on every new execution or recovery.
    const first = await reconcileRuns({
      apiBase: options.apiBase,
      token: options.token,
      identity: options.identity,
      branch: options.branch,
      attempt: 1,
    });
    let intent;
    if (existsSync(paths.intentPath)) {
      intent = validateIntent(readJson(paths.intentPath, 'dispatch intent'), options.identity, paths);
    } else {
      if (first.outcome !== 'zero') {
        const now = new Date().toISOString();
        intent = persistIntent(paths, options.identity, newIntent(options.identity, paths, now));
      } else {
        const now = new Date().toISOString();
        intent = persistIntent(paths, options.identity, {
          ...newIntent(options.identity, paths, now),
          last_reconciliation: first.record,
        });
      }
    }
    if (intent.state === 'receipted') {
      return validateCanonicalReceipt(
        readJson(paths.receiptPath, 'dispatch receipt'),
        options.identity,
        paths,
        options.branch,
      );
    }
    if (intent.state === 'manual_recovery') {
      fail('manual_recovery: transaction is permanently fenced from resend');
    }
    if (first.outcome === 'one') {
      intent = transitionIntent(paths, options.identity, intent, {
        last_reconciliation: first.record,
      });
      return await receiptUniqueRun(context, intent, first.matches[0]);
    }
    if (first.outcome !== 'zero') {
      transitionIntent(paths, options.identity, intent, {
        state: 'manual_recovery',
        last_reconciliation: first.record,
      });
      fail(`manual_recovery: remote reconciliation returned ${first.outcome}`);
    }
    if (intent.state === 'pending') {
      const window = await pollWindow(context, first);
      intent = transitionIntent(paths, options.identity, intent, {
        last_reconciliation: window.record,
      });
      if (window.outcome === 'one') return await receiptUniqueRun(context, intent, window.matches[0]);
      if (window.outcome !== 'zero') {
        transitionIntent(paths, options.identity, intent, { state: 'manual_recovery' });
        fail(`manual_recovery: pending reconciliation returned ${window.outcome}`);
      }
      if (options.failpoint === 'before-dispatching-transition') process.exit(91);
      if (intent.post_started_at !== null || intent.post_count !== 0) {
        transitionIntent(paths, options.identity, intent, { state: 'manual_recovery' });
        fail('manual_recovery: pending intent lacks single-POST authority');
      }
      const postStartedAt = new Date().toISOString();
      intent = transitionIntent(paths, options.identity, intent, {
        state: 'dispatching',
        post_started_at: postStartedAt,
        post_count: 1,
      });
      await apiJson(
        `${options.apiBase}/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
        {
          token: options.token,
          method: 'POST',
          body: {
            ref: options.branch,
            inputs: {
              source_sha: options.identity.tuple.head_sha,
              dispatch_nonce: options.identity.dispatchNonce,
            },
          },
        },
      );
      if (options.failpoint === 'after-post-before-accepted') process.exit(92);
      intent = transitionIntent(paths, options.identity, intent, {
        state: 'accepted_unreceipted',
        accepted_at: new Date().toISOString(),
      });
      if (options.failpoint === 'after-accepted') process.exit(93);
    }
    const recovery = await pollWindow(context, null);
    intent = transitionIntent(paths, options.identity, intent, {
      last_reconciliation: recovery.record,
    });
    if (recovery.outcome === 'one') {
      return await receiptUniqueRun(context, intent, recovery.matches[0]);
    }
    transitionIntent(paths, options.identity, intent, { state: 'manual_recovery' });
    fail(`manual_recovery: uncertain ${intent.state} transaction returned ${recovery.outcome}`);
  } finally {
    releaseTupleLock({ lockPath: paths.lockPath, identity: options.identity, owner });
  }
}

function patchNativeNonce(source) {
  const old = String.raw`^maestro-search-ranking-exec-20260723-102551-20260724-010-plan-TASK-013-attempt-[1-9][0-9]{0,5}$`;
  const patched = source.split(old).join(String.raw`^native-[0-9a-f]{32}$`);
  if (patched === source) fail('ephemeral payload did not contain the TASK-004 nonce pattern');
  if (patched.includes('TASK-013-attempt') || !patched.includes('native-[0-9a-f]{32}')) {
    fail('ephemeral native nonce patch is incomplete');
  }
  return patched;
}

export function makeAggregateVerifierHermetic(source) {
  const importLine = "import YAML from 'yaml';";
  const createRequireLine = "import { createRequire } from 'node:module';";
  const requireLine = "const YAML = require('yaml');";
  if (source.includes(requireLine)) {
    if (source.includes(importLine) || !source.includes(createRequireLine)) {
      fail('aggregate verifier hermetic transform is incomplete');
    }
    return source;
  }
  if (!source.includes(importLine)) {
    fail('aggregate verifier does not contain the expected YAML import');
  }
  let patched = source.replace(importLine, createRequireLine);
  const marker = /export function verifyNativeWorkflowDocument\(source\) \{(\r?\n)/g;
  const matches = [...patched.matchAll(marker)];
  if (matches.length !== 1) {
    fail('aggregate verifier does not expose exactly one verifyNativeWorkflowDocument');
  }
  patched = patched.replace(
    marker,
    (_match, endOfLine) => `export function verifyNativeWorkflowDocument(source) {${endOfLine}  const require = createRequire(import.meta.url);${endOfLine}  ${requireLine}${endOfLine}`,
  );
  if (patched.includes(importLine)
    || !patched.includes(createRequireLine)
    || !patched.includes(requireLine)) {
    fail('aggregate verifier hermetic transform is incomplete');
  }
  return patched;
}

function writeFileDurable(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(16).toString('hex')}`;
  let fd;
  try {
    fd = openSync(tempPath, 'wx', 0o600);
    writeSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Preserve the primary persistence error.
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function assertAuthorizedRoot(workspaceRoot, runKey) {
  const base = resolve(workspaceRoot, '.workflow', 'tmp', 'lifecycle-native', runKey);
  mkdirSync(base, { recursive: true });
  const resolved = realpathSync(base);
  const authorized = resolve(workspaceRoot, '.workflow', 'tmp', 'lifecycle-native', runKey);
  if (resolved.toLowerCase() !== authorized.toLowerCase()) {
    fail('Resolve-Path equivalent does not equal the authorized temporary root');
  }
  return resolved;
}

function regularFiles(root) {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isFile()) return [root];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) files.push(path);
      else fail(`payload contains a non-regular entry: ${path}`);
    }
  }
  return files.sort();
}

function snapshotPrimaryWorktree(workspaceRoot, authorizedRoot, executionBase) {
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: workspaceRoot,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (status.error || status.status !== 0) {
    fail(`cannot snapshot primary worktree: ${status.error?.message ?? status.stderr.toString()}`);
  }
  const payloadPaths = [
    resolve(workspaceRoot, 'scripts/native-lifecycle-workflow-overlay.yml'),
    ...WORKTREE_ALLOWLIST.slice(1).flatMap(item => regularFiles(resolve(workspaceRoot, item))),
  ];
  const payload = payloadPaths.map(path => ({
    path: containedRelative(workspaceRoot, path, 'snapshot payload'),
    sha256: sha256(readFileSync(path)),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const snapshot = {
    schema: 'native-lifecycle-primary-worktree-snapshot/1',
    execution_base_sha: executionBase,
    captured_at: new Date().toISOString(),
    status_sha256: sha256(status.stdout),
    payload,
  };
  atomicWriteCanonical(join(authorizedRoot, 'primary-worktree-snapshot.json'), snapshot);
  return snapshot;
}

async function verifyRemoteAuthority({ apiBase, token, remote, workspaceRoot }) {
  if (remote !== 'origin') fail('only remote origin is authorized');
  const remoteUrl = runCommand('git', ['remote', 'get-url', remote], { cwd: workspaceRoot });
  if (!/^https:\/\/github\.com\/catlog22\/maestro-flow(?:\.git)?$/i.test(remoteUrl)
    && !/^git@github\.com:catlog22\/maestro-flow(?:\.git)?$/i.test(remoteUrl)) {
    fail(`origin is not ${REPO}`);
  }
  const repo = await apiJson(`${apiBase}/repos/${REPO}`, { token });
  if (repo.default_branch !== 'master') fail('GitHub default branch is not master');
  const workflow = await apiJson(`${apiBase}/repos/${REPO}/actions/workflows/${WORKFLOW_ID}`, { token });
  if (workflow.id !== WORKFLOW_ID || workflow.path !== WORKFLOW_PATH || workflow.state !== 'active') {
    fail('registered workflow identity/path/state mismatch');
  }
  const blob = await apiJson(
    `${apiBase}/repos/${REPO}/contents/${WORKFLOW_PATH}?ref=master`,
    { token },
  );
  if (blob.sha !== DEFAULT_BLOB_SHA) fail('immutable default workflow blob mismatch');
}

function copyAuthorizedPayload(workspaceRoot, worktree) {
  const overlay = patchNativeNonce(
    readFileSync(resolve(workspaceRoot, 'scripts/native-lifecycle-workflow-overlay.yml'), 'utf8'),
  );
  writeFileDurable(resolve(worktree, WORKFLOW_PATH), overlay);
  for (const item of WORKTREE_ALLOWLIST.slice(1)) {
    const source = resolve(workspaceRoot, item);
    const target = resolve(worktree, item);
    if (!existsSync(source)) fail(`authorized payload source is missing: ${item}`);
    const stats = lstatSync(source);
    if (stats.isDirectory()) {
      cpSync(source, target, { recursive: true, errorOnExist: false, force: true });
    } else if (item.startsWith('scripts/')) {
      const noncePatched = patchNativeNonce(readFileSync(source, 'utf8'));
      writeFileDurable(
        target,
        item === 'scripts/verify-lifecycle-fs-native-aggregate.mjs'
          ? makeAggregateVerifierHermetic(noncePatched)
          : noncePatched,
      );
    } else {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  }
  const overlayText = readFileSync(resolve(worktree, WORKFLOW_PATH), 'utf8');
  const jobs = ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];
  if (!overlayText.includes('run-name: native-lifecycle-${{ inputs.source_sha }}-${{ inputs.dispatch_nonce }}')
    || jobs.some(job => !overlayText.includes(`  ${job}:`))
    || !overlayText.includes('  aggregate:')
    || /\b(deploy-pages|configure-pages|upload-pages-artifact|github-pages|npm\s+publish)\b/i.test(overlayText)) {
    fail('ephemeral workflow does not satisfy the five-job/no-deploy contract');
  }
}

function enumerateAllowlistFiles(worktree) {
  const output = runCommand('git', ['ls-files', '--others', '--modified', '--exclude-standard'], { cwd: worktree })
    .split(/\r?\n/)
    .filter(Boolean);
  const allowed = output.filter(path => (
    path === WORKFLOW_PATH
    || path === 'native/lifecycle-fs/Cargo.toml'
    || path === 'native/lifecycle-fs/Cargo.lock'
    || path.startsWith('native/lifecycle-fs/src/')
    || path.startsWith('native/lifecycle-fs/tests/')
    || path === 'scripts/write-lifecycle-fs-native-receipt.mjs'
    || path === 'scripts/verify-lifecycle-fs-native-aggregate.mjs'
  ));
  if (allowed.length !== output.length || allowed.length === 0) {
    fail(`worktree contains non-allowlisted or empty changes: ${output.join(', ')}`);
  }
  return allowed.sort();
}

function validateRetainedPayloadCommit({ worktree, branch, remote }) {
  const existingBranch = runCommand('git', ['branch', '--show-current'], { cwd: worktree });
  if (existingBranch !== branch) fail('retained worktree branch identity mismatch');
  if (runCommand('git', ['status', '--porcelain'], { cwd: worktree }) !== '') {
    fail('retained worktree is not clean');
  }
  const overlayCommitSha = runCommand('git', ['rev-parse', 'HEAD'], { cwd: worktree });
  const remoteSha = runCommand(
    'git',
    ['ls-remote', '--heads', remote, `refs/heads/${branch}`],
    { cwd: worktree },
  ).split(/\s+/)[0];
  if (remoteSha !== overlayCommitSha) fail('retained remote ref does not equal the overlay commit');
  const changed = runCommand(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', overlayCommitSha],
    { cwd: worktree },
  ).split(/\r?\n/).filter(Boolean);
  if (changed.length === 0 || changed.some(path => !(
    path === WORKFLOW_PATH
    || path === 'native/lifecycle-fs/Cargo.toml'
    || path === 'native/lifecycle-fs/Cargo.lock'
    || path.startsWith('native/lifecycle-fs/src/')
    || path.startsWith('native/lifecycle-fs/tests/')
    || path === 'scripts/write-lifecycle-fs-native-receipt.mjs'
    || path === 'scripts/verify-lifecycle-fs-native-aggregate.mjs'
  ))) {
    fail('retained overlay commit is outside the exact allowlist');
  }
  return overlayCommitSha;
}

function repairRetainedAggregatePayload({ workspaceRoot, remote, runKey }) {
  const base = assertAuthorizedRoot(workspaceRoot, runKey);
  const worktrees = readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^worktree-[0-9a-f]{12}$/.test(entry.name));
  if (worktrees.length !== 1) {
    fail('focused retry requires exactly one retained authorized worktree');
  }
  const worktree = resolve(base, worktrees[0].name);
  const branch = runCommand('git', ['branch', '--show-current'], { cwd: worktree });
  if (!BRANCH.test(branch) || !branch.endsWith(worktrees[0].name.slice('worktree-'.length))) {
    fail('focused retry retained branch/worktree identity mismatch');
  }
  const previousHead = validateRetainedPayloadCommit({ worktree, branch, remote });
  const verifierPath = resolve(worktree, 'scripts/verify-lifecycle-fs-native-aggregate.mjs');
  const source = readFileSync(verifierPath, 'utf8');
  const patched = makeAggregateVerifierHermetic(source);
  if (patched !== source) {
    writeFileDurable(verifierPath, patched);
    const status = runCommand('git', ['status', '--porcelain'], { cwd: worktree });
    if (status.trim() !== 'M scripts/verify-lifecycle-fs-native-aggregate.mjs') {
      fail(`focused retry changed bytes outside the verifier: ${status}`);
    }
    runCommand(
      'git',
      ['add', '--', 'scripts/verify-lifecycle-fs-native-aggregate.mjs'],
      { cwd: worktree },
    );
    const staged = runCommand('git', ['diff', '--cached', '--name-only'], { cwd: worktree });
    if (staged !== 'scripts/verify-lifecycle-fs-native-aggregate.mjs') {
      fail('focused retry staged files are not the exact verifier path');
    }
    runCommand('git', ['commit', '-m', 'fix: 消除 aggregate 运行时 YAML 依赖'], { cwd: worktree });
    const nextHead = runCommand('git', ['rev-parse', 'HEAD'], { cwd: worktree });
    const parent = runCommand('git', ['rev-parse', 'HEAD^'], { cwd: worktree });
    if (parent !== previousHead) fail('focused retry commit is not a fast-forward child');
    runCommand('git', ['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], { cwd: worktree });
    const remoteSha = runCommand(
      'git',
      ['ls-remote', '--heads', remote, `refs/heads/${branch}`],
      { cwd: worktree },
    ).split(/\s+/)[0];
    if (remoteSha !== nextHead) fail('focused retry remote ref did not fast-forward to the repair');
  }
  const overlayCommitSha = validateRetainedPayloadCommit({ worktree, branch, remote });
  return {
    executionBase: worktrees[0].name.slice('worktree-'.length),
    branch,
    worktree,
    overlayCommitSha,
    reused: true,
  };
}

function advanceRetainedHistoricalRetry({ workspaceRoot, remote, runKey }) {
  const prepared = repairRetainedAggregatePayload({ workspaceRoot, remote, runKey });
  const verifierPath = resolve(prepared.worktree, 'scripts/verify-lifecycle-fs-native-aggregate.mjs');
  const source = readFileSync(verifierPath, 'utf8');
  const marker = "  const YAML = require('yaml');";
  const comment = '  // YAML is resolved only for workflow authoring validation; aggregate CLI is dependency-free.';
  if (!source.includes(marker)) fail('retained verifier is missing the lazy YAML boundary');
  if (!source.includes(comment)) {
    writeFileDurable(verifierPath, source.replace(marker, `${comment}\n${marker}`));
    const status = runCommand('git', ['status', '--porcelain'], { cwd: prepared.worktree });
    if (status.trim() !== 'M scripts/verify-lifecycle-fs-native-aggregate.mjs') {
      fail(`historical-run retry changed bytes outside the verifier: ${status}`);
    }
    runCommand(
      'git',
      ['add', '--', 'scripts/verify-lifecycle-fs-native-aggregate.mjs'],
      { cwd: prepared.worktree },
    );
    const staged = runCommand('git', ['diff', '--cached', '--name-only'], { cwd: prepared.worktree });
    if (staged !== 'scripts/verify-lifecycle-fs-native-aggregate.mjs') {
      fail('historical-run retry staged files are not the exact verifier path');
    }
    runCommand('git', ['commit', '-m', 'chore: 记录 aggregate hermetic 边界'], {
      cwd: prepared.worktree,
    });
    const nextHead = runCommand('git', ['rev-parse', 'HEAD'], { cwd: prepared.worktree });
    const parent = runCommand('git', ['rev-parse', 'HEAD^'], { cwd: prepared.worktree });
    if (parent !== prepared.overlayCommitSha) fail('historical-run retry is not a fast-forward child');
    runCommand(
      'git',
      ['push', remote, `refs/heads/${prepared.branch}:refs/heads/${prepared.branch}`],
      { cwd: prepared.worktree },
    );
    const remoteSha = runCommand(
      'git',
      ['ls-remote', '--heads', remote, `refs/heads/${prepared.branch}`],
      { cwd: prepared.worktree },
    ).split(/\s+/)[0];
    if (remoteSha !== nextHead) fail('historical-run retry remote ref did not fast-forward');
  }
  return {
    ...prepared,
    overlayCommitSha: validateRetainedPayloadCommit({
      worktree: prepared.worktree,
      branch: prepared.branch,
      remote,
    }),
  };
}

function prepareEphemeralBranch({
  workspaceRoot,
  remote,
  runKey,
  retryHermetic = false,
  retryHistorical = false,
}) {
  if (retryHistorical) {
    return advanceRetainedHistoricalRetry({ workspaceRoot, remote, runKey });
  }
  if (retryHermetic) {
    return repairRetainedAggregatePayload({ workspaceRoot, remote, runKey });
  }
  const executionBase = runCommand('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot });
  if (!HEX_40.test(executionBase)) fail('execution base is not a full Git SHA');
  const branch = `maestro/native-lifecycle-${runKey}-${executionBase.slice(0, 12)}`;
  if (!BRANCH.test(branch)) fail('deterministic branch does not match the authorized pattern');
  const base = assertAuthorizedRoot(workspaceRoot, runKey);
  snapshotPrimaryWorktree(workspaceRoot, base, executionBase);
  const worktree = resolve(base, `worktree-${executionBase.slice(0, 12)}`);
  const rel = relative(base, worktree);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail('worktree escapes authorized temp root');
  if (existsSync(worktree)) {
    const overlayCommitSha = validateRetainedPayloadCommit({ worktree, branch, remote });
    return { executionBase, branch, worktree, overlayCommitSha, reused: true };
  }
  runCommand('git', ['worktree', 'add', '-b', branch, worktree, executionBase], { cwd: workspaceRoot });
  copyAuthorizedPayload(workspaceRoot, worktree);
  const files = enumerateAllowlistFiles(worktree);
  runCommand('git', ['add', '--', ...files], { cwd: worktree });
  const staged = runCommand('git', ['diff', '--cached', '--name-only'], { cwd: worktree })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  if (JSON.stringify(staged) !== JSON.stringify(files)) fail('staged bytes do not equal the exact allowlist');
  runCommand('git', ['commit', '-m', 'chore: 构建 lifecycle native 五平台制品'], { cwd: worktree });
  const overlayCommitSha = runCommand('git', ['rev-parse', 'HEAD'], { cwd: worktree });
  runCommand('git', ['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], { cwd: worktree });
  const remoteSha = runCommand('git', ['ls-remote', '--heads', remote, `refs/heads/${branch}`], { cwd: worktree })
    .split(/\s+/)[0];
  if (remoteSha !== overlayCommitSha) fail('pushed temporary ref does not equal the overlay commit');
  return { executionBase, branch, worktree, overlayCommitSha, reused: false };
}

function parseArguments(argv) {
  const values = {};
  const flags = new Set([
    '--cleanup',
    '--execute-authorized',
    '--transaction-only',
    '--test-mode',
    '--retry-hermetic-authorized',
    '--retry-historical-authorized',
  ]);
  const valued = new Set([
    '--repo',
    '--remote',
    '--run-key',
    '--workspace-root',
    '--api-base',
    '--token',
    '--branch',
    '--head-sha',
    '--failpoint',
    '--poll-interval-ms',
    '--lock-wait-ms',
    '--receipt',
    '--final-implementation-commit',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (flags.has(key)) {
      if (values[key]) fail(`duplicate argument ${key}`);
      values[key] = true;
      continue;
    }
    if (!valued.has(key) || values[key] !== undefined || argv[index + 1] === undefined) {
      fail(`invalid or duplicate argument ${key ?? '<missing>'}`);
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  return values;
}

async function main(argv) {
  const args = parseArguments(argv);
  const workspaceRoot = resolve(args['--workspace-root'] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (args['--cleanup']) {
    if (!args['--receipt']
      || args['--execute-authorized']
      || args['--transaction-only']
      || args['--test-mode']
      || args['--retry-hermetic-authorized']
      || args['--retry-historical-authorized']) {
      fail('--cleanup requires only --receipt and optional workspace/final-commit arguments');
    }
    const { cleanupNativeLifecycleDispatch } = await import('./verify-lifecycle-fs-native-matrix.mjs');
    const finalImplementationCommitSha = args['--final-implementation-commit']
      ?? runCommand('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot });
    const completed = cleanupNativeLifecycleDispatch({
      receiptPath: resolve(workspaceRoot, args['--receipt']),
      workspaceRoot,
      finalImplementationCommitSha,
      remote: 'origin',
    });
    process.stdout.write(`${jcs(completed.receipt)}\n`);
    return;
  }
  if (!args['--execute-authorized']) fail('--execute-authorized is required');
  if ((args['--repo'] ?? REPO) !== REPO || (args['--run-key'] ?? RUN_KEY) !== RUN_KEY) {
    fail('repo or run-key is outside authority');
  }
  const apiBase = (args['--api-base'] ?? 'https://api.github.com').replace(/\/$/, '');
  const testMode = Boolean(args['--test-mode']);
  if (testMode && process.env.NATIVE_LIFECYCLE_TESTING !== '1') {
    fail('--test-mode requires NATIVE_LIFECYCLE_TESTING=1');
  }
  const token = args['--token'] ?? (testMode ? 'test-token' : runCommand('gh', ['auth', 'token']));
  if (args['--retry-hermetic-authorized'] && args['--retry-historical-authorized']) {
    fail('focused retry modes are mutually exclusive');
  }
  let branch;
  let headSha;
  if (args['--transaction-only']) {
    if (!testMode) fail('--transaction-only is restricted to the test harness');
    branch = args['--branch'];
    headSha = args['--head-sha'];
  } else {
    await verifyRemoteAuthority({
      apiBase,
      token,
      remote: args['--remote'] ?? 'origin',
      workspaceRoot,
    });
    const prepared = prepareEphemeralBranch({
      workspaceRoot,
      remote: args['--remote'] ?? 'origin',
      runKey: RUN_KEY,
      retryHermetic: Boolean(args['--retry-hermetic-authorized']),
      retryHistorical: Boolean(args['--retry-historical-authorized']),
    });
    branch = prepared.branch;
    headSha = prepared.overlayCommitSha;
  }
  if (!BRANCH.test(branch) || !HEX_40.test(headSha)) fail('branch or head-sha is invalid');
  const identity = deriveDispatchIdentity({
    repo: REPO,
    workflowId: WORKFLOW_ID,
    ref: `refs/heads/${branch}`,
    headSha,
    inputs: { source_sha: headSha },
  });
  const receipt = await runDispatchTransaction({
    apiBase,
    token,
    repo: REPO,
    runKey: RUN_KEY,
    workspaceRoot,
    branch,
    identity,
    testMode,
    failpoint: args['--failpoint'] ?? null,
    pollIntervalMs: args['--poll-interval-ms'] === undefined
      ? POLL_POLICY.interval_ms
      : Number(args['--poll-interval-ms']),
    lockWaitMs: args['--lock-wait-ms'] === undefined ? 60000 : Number(args['--lock-wait-ms']),
  });
  process.stdout.write(`${jcs(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
