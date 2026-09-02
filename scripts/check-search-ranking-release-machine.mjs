#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn as spawnChild, spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SCHEMA_SHA256,
  parseBuiltSearchAdapterExpected,
  parseBuiltSearchAdapterReport,
} from '../shared/built-search-adapter-contract.mjs';
import {
  createAttestationManifest,
  deriveProbeModuleAttestation,
  extractCertifiedBootstrapBuffer,
  loadProbeDynamicEdgeManifest,
  runCertifiedAttestedChild,
} from './search-ranking-module-attestation.mjs';
import {
  deriveSearchRankingDirectControlGraph,
} from './search-ranking-direct-control-graph.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const dashboardRoot = join(repoRoot, 'dashboard');
export const binPath = join(repoRoot, 'bin', 'maestro.js');
export const builtSearchAdapterPath = join(
  repoRoot,
  'dist',
  'src',
  'search',
  'evaluation',
  'built-search-adapter.js',
);

export const ROOT_TEST_PATHS = Object.freeze([
  'src/search/evaluation/relevance-evaluator.test.ts',
  'src/graph/kg/__tests__/search-ranking.test.ts',
  'src/commands/search-linked-code.test.ts',
  'src/commands/search-mixed-fusion.test.ts',
  'src/tools/__tests__/knowhow-lifecycle.test.ts',
  'src/search/evaluation/pi-knowledge-absolute.test.ts',
]);

export const DASHBOARD_TEST_PATHS = Object.freeze([
  'src/server/wiki/search-ranking.test.ts',
  'src/server/wiki/wiki-indexer.test.ts',
]);

const MODE_PHASES = Object.freeze({
  standalone: ['source-tests', 'build', 'built-bin'],
  source: ['source-tests'],
  built: ['built-bin'],
});

const FIXTURE_ROOT = join(repoRoot, 'src', 'search', 'evaluation', 'fixtures');
const ATTESTATION_BOOTSTRAP_PATH =
  'scripts/search-ranking-module-attestation.mjs';
const DYNAMIC_EDGE_MANIFEST_PATH =
  'scripts/search-ranking-probe-dynamic-edges.json';
export const PRODUCTION_ARTIFACTS = Object.freeze([
  'dist/src/search/evaluation/built-search-adapter.js',
  'dist/src/commands/search.js',
  'dist/src/graph/kg/query/search.js',
  'dist/src/graph/kg/query/scoring.js',
  'dashboard/dist-server/dashboard/src/server/wiki/search.js',
  'dashboard/dist-server/dashboard/src/server/wiki/wiki-indexer.js',
]);

const BUILT_PROVIDER_FUNCTIONS = Object.freeze({
  wiki: 'WikiIndexer.searchWithMeta',
  kg: 'MaestroGraph.searchUnified',
  code: 'runCodeSearch/MaestroGraph.searchCode',
  mixed: 'runMixedSearch',
  linked: 'runCodeSearch/MaestroGraph.openReadOnly.searchCode',
});

const BUILT_SIDE_EFFECT_EVENTS = Object.freeze({
  daemonLookupCalls: 'daemon-lookup',
  daemonStartCalls: 'daemon-start',
  filesystemCacheReadCalls: 'filesystem-cache-read',
  filesystemCacheWriteCalls: 'filesystem-cache-write',
  filesystemIndexWriteCalls: 'filesystem-index-write',
  embeddingBuildCalls: 'embedding-build',
  embeddingSaveCalls: 'embedding-save',
  credibilityHitWriteCalls: 'credibility-hit-write',
});

export function deriveCertifiedArtifactPaths(options = {}) {
  return Object.freeze([
    ...deriveSearchRankingDirectControlGraph({ phase: 'full', ...options }).expected_paths,
  ]);
}

const LIMITS = Object.freeze({
  exactMrrAt10: 0.95,
  overallNdcgGain: 0.1,
  maxCategoryNdcgDrop: 0.02,
  knowledgeRecallAt20: 0.90,
  piPrimaryCount: 2,
  piHoldoutCount: 2,
  piRecallAt20: 0.90,
  kgWarmP95Ms: 34.8,
  kgWarmMaxMs: 50,
  wikiQueryP95Ms: 50,
  wikiIndexP95Ms: 500,
});

export class ReleaseMachineError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ReleaseMachineError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      schema_version: 'search-ranking-release-failure/1.0',
      ok: false,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

function fail(code, message, details) {
  throw new ReleaseMachineError(code, message, details);
}

function isExistingAbsoluteFile(path) {
  if (typeof path !== 'string' || path.length === 0 || !isAbsolute(path) || !existsSync(path)) {
    return false;
  }
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveNpmInvocation(npmArgs, { npmCliOverride } = {}) {
  if (!Array.isArray(npmArgs) || !npmArgs.every(arg => typeof arg === 'string')) {
    fail('INVALID_NPM_ARGS', 'npm arguments must be an array of strings');
  }
  const npmExecPath = isExistingAbsoluteFile(process.env.npm_execpath)
    ? process.env.npm_execpath
    : isExistingAbsoluteFile(npmCliOverride)
      ? npmCliOverride
      : null;
  if (npmExecPath === null) {
    fail(
      'NPM_CLI_UNAVAILABLE',
      'npm_execpath must name an existing absolute file; standalone may use --npm-cli <existing-abs>',
      {
        npm_execpath: process.env.npm_execpath ?? null,
        npmCliOverride: npmCliOverride ?? null,
      },
    );
  }
  return {
    command: process.execPath,
    args: [npmExecPath, ...npmArgs],
  };
}

function childFailure(label, result) {
  fail('CHILD_PROCESS_FAILED', `${label} failed`, {
    label,
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error
      ? {
          name: result.error.name,
          message: result.error.message,
          code: result.error.code ?? null,
        }
      : null,
  });
}

function npmChildTrace(label, invocation, cwd, result) {
  return {
    label,
    command: invocation.command,
    args: invocation.args,
    cwd,
    shell: false,
    status: result.status,
    signal: result.signal ?? null,
    stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
    stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
  };
}

export function runNpmChild(
  label,
  npmArgs,
  cwd,
  { npmCliOverride, spawn = spawnSync } = {},
) {
  const invocation = resolveNpmInvocation(npmArgs, { npmCliOverride });
  const result = spawn(invocation.command, invocation.args, {
    shell: false,
    cwd,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) childFailure(label, result);
  return npmChildTrace(label, invocation, cwd, result);
}

export async function runNpmChildAsync(
  label,
  npmArgs,
  cwd,
  { npmCliOverride, spawn = spawnChild } = {},
) {
  const invocation = resolveNpmInvocation(npmArgs, { npmCliOverride });
  let child;
  try {
    child = spawn(invocation.command, invocation.args, {
      shell: false,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    childFailure(label, { error });
  }

  if (Object.hasOwn(child, 'status')) {
    if (child.error || child.status !== 0) childFailure(label, child);
    return npmChildTrace(label, invocation, cwd, child);
  }

  return new Promise((resolveChild, rejectChild) => {
    let stdout = '';
    let stderr = '';
    let spawnError;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { spawnError = error; });
    child.once('close', (status, signal) => {
      const result = { status, signal, stdout, stderr, error: spawnError };
      try {
        if (result.error || result.status !== 0) childFailure(label, result);
        resolveChild(npmChildTrace(label, invocation, cwd, result));
      } catch (error) {
        rejectChild(error);
      }
    });
  });
}

function normalizedReportedPath(path, cwd) {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  return relative(cwd, absolute).split(sep).join('/');
}

export function parseVitestReport(reportPath, {
  label,
  cwd,
  expectedFiles,
  exactCollectedFiles,
} = {}) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (error) {
    fail('INVALID_TEST_REPORT', `${label}: cannot parse Vitest JSON report`, {
      reportPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const testResults = Array.isArray(report.testResults) ? report.testResults : [];
  const collectedFiles = testResults.length;
  const tests = Number.isInteger(report.numTotalTests)
    ? report.numTotalTests
    : testResults.reduce(
        (count, result) => count + (Array.isArray(result.assertionResults)
          ? result.assertionResults.length
          : 0),
        0,
      );
  const failures = Number.isInteger(report.numFailedTests)
    ? report.numFailedTests
    : testResults.reduce(
        (count, result) => count + (Array.isArray(result.assertionResults)
          ? result.assertionResults.filter(assertion => assertion.status === 'failed').length
          : 0),
        0,
      );
  const files = testResults.map(result => normalizedReportedPath(result.name, cwd)).sort();
  const expected = [...expectedFiles].sort();

  if (collectedFiles === 0 || tests === 0) {
    fail('ZERO_TEST_COLLECTION', `${label}: Vitest collected no files or tests`, {
      collectedFiles,
      tests,
      files,
    });
  }
  if (failures !== 0 || report.success === false) {
    fail('SOURCE_TEST_FAILURE', `${label}: Vitest reported failures`, {
      collectedFiles,
      tests,
      failures,
      files,
    });
  }
  if (exactCollectedFiles !== undefined && collectedFiles !== exactCollectedFiles) {
    fail('UNEXPECTED_TEST_COLLECTION', `${label}: collected file count differs from ownership matrix`, {
      expected: exactCollectedFiles,
      actual: collectedFiles,
      files,
    });
  }
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    fail('TEST_OWNERSHIP_MISMATCH', `${label}: collected files differ from focused ownership matrix`, {
      expected,
      actual: files,
    });
  }
  return { label, cwd, collectedFiles, tests, failures, files };
}

export async function runSourcePhase({ npmCliOverride, spawn = spawnChild, tempRoot } = {}) {
  const ownedTempRoot = tempRoot ?? mkdtempSync(join(tmpdir(), 'maestro-search-ranking-source-'));
  const shouldCleanup = tempRoot === undefined;
  const rootReport = join(ownedTempRoot, 'root-vitest.json');
  const dashboardReport = join(ownedTempRoot, 'dashboard-vitest.json');
  try {
    const rootArgs = [
      'test',
      '--',
      '--reporter=json',
      '--maxWorkers=6',
      '--testTimeout=15000',
      '--outputFile',
      rootReport,
      ...ROOT_TEST_PATHS,
    ];
    const dashboardArgs = [
      'test',
      '--',
      '--reporter=json',
      '--maxWorkers=2',
      '--testTimeout=15000',
      '--outputFile',
      dashboardReport,
      ...DASHBOARD_TEST_PATHS,
    ];
    if (dashboardArgs.some(arg => arg.startsWith('dashboard/'))) {
      fail('DASHBOARD_PATH_PREFIX', 'dashboard test arguments must be relative to dashboard root');
    }

    const traces = await Promise.allSettled([
      runNpmChildAsync('source-tests:root', rootArgs, repoRoot, { npmCliOverride, spawn }),
      runNpmChildAsync('source-tests:dashboard', dashboardArgs, dashboardRoot, {
        npmCliOverride,
        spawn,
      }),
    ]);
    const failedTrace = traces.find(result => result.status === 'rejected');
    if (failedTrace) throw failedTrace.reason;
    const [rootTrace, dashboardTrace] = traces.map(result => result.value);

    const root = parseVitestReport(rootReport, {
      label: 'source-tests:root',
      cwd: repoRoot,
      expectedFiles: ROOT_TEST_PATHS,
      exactCollectedFiles: ROOT_TEST_PATHS.length,
    });
    const dashboard = parseVitestReport(dashboardReport, {
      label: 'source-tests:dashboard',
      cwd: dashboardRoot,
      expectedFiles: DASHBOARD_TEST_PATHS,
      exactCollectedFiles: 2,
    });

    return {
      phase: 'source-tests',
      runners: [root, dashboard],
      trace: [rootTrace, dashboardTrace],
    };
  } finally {
    if (shouldCleanup) rmSync(ownedTempRoot, { recursive: true, force: true });
  }
}

export function runBuildPhase({ npmCliOverride, spawn = spawnSync } = {}) {
  return {
    phase: 'build',
    trace: runNpmChild('build', ['run', 'build'], repoRoot, { npmCliOverride, spawn }),
  };
}

function containedPath(root, target) {
  const relativePath = relative(root, target);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

export function readArtifact(relativePath, { root = repoRoot } = {}) {
  const rootReal = realpathSync(root);
  const requested = resolve(root, relativePath);
  const beforeLstat = lstatSync(requested);
  const beforeReal = realpathSync(requested);
  if (!beforeLstat.isFile() || !containedPath(rootReal, beforeReal)) {
    fail('ARTIFACT_BOUNDARY', `artifact is not a contained regular file: ${relativePath}`);
  }

  const fd = openSync(beforeReal, 'r');
  try {
    const beforeFstat = fstatSync(fd);
    const buffer = readFileSync(fd);
    const afterFstat = fstatSync(fd);
    const afterLstat = lstatSync(requested);
    const afterReal = realpathSync(requested);
    const unchanged = beforeFstat.isFile()
      && beforeReal === afterReal
      && beforeLstat.dev === beforeFstat.dev
      && beforeLstat.ino === beforeFstat.ino
      && beforeLstat.size === beforeFstat.size
      && beforeLstat.mtimeMs === beforeFstat.mtimeMs
      && beforeLstat.dev === afterLstat.dev
      && beforeLstat.ino === afterLstat.ino
      && beforeLstat.size === afterLstat.size
      && beforeLstat.mtimeMs === afterLstat.mtimeMs
      && beforeFstat.dev === afterFstat.dev
      && beforeFstat.ino === afterFstat.ino
      && beforeFstat.size === afterFstat.size
      && beforeFstat.mtimeMs === afterFstat.mtimeMs
      && afterLstat.dev === afterFstat.dev
      && afterLstat.ino === afterFstat.ino
      && afterLstat.size === afterFstat.size
      && afterLstat.mtimeMs === afterFstat.mtimeMs
      && buffer.length === beforeFstat.size;
    if (!unchanged) {
      fail('ARTIFACT_IDENTITY_CHANGED', `artifact changed while being read: ${relativePath}`);
    }
    return {
      relativePath,
      realPath: beforeReal,
      identity: {
        dev: afterFstat.dev,
        ino: afterFstat.ino,
        size: afterFstat.size,
        mtimeMs: afterFstat.mtimeMs,
      },
      buffer,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  } finally {
    closeSync(fd);
  }
}

function certificateMetadata(certificate) {
  return {
    relativePath: certificate.relativePath,
    realPath: certificate.realPath,
    identity: certificate.identity,
    sha256: certificate.sha256,
  };
}

export function revalidateCertifiedArtifacts(
  certificates,
  { root = repoRoot } = {},
) {
  return certificates.map(certificate => {
    let current;
    try {
      current = readArtifact(certificate.relativePath, { root });
    } catch (error) {
      fail(
        'ARTIFACT_POST_CHILD_CHANGED',
        `certified artifact could not be revalidated after built children: ${certificate.relativePath}`,
        {
          relativePath: certificate.relativePath,
          expected: certificateMetadata(certificate),
          cause: {
            code: error instanceof ReleaseMachineError ? error.code : null,
            message: error instanceof Error ? error.message : String(error),
          },
        },
      );
    }

    const changed = [
      ['realPath', certificate.realPath, current.realPath],
      ['dev', certificate.identity.dev, current.identity.dev],
      ['ino', certificate.identity.ino, current.identity.ino],
      ['size', certificate.identity.size, current.identity.size],
      ['mtimeMs', certificate.identity.mtimeMs, current.identity.mtimeMs],
      ['sha256', certificate.sha256, current.sha256],
    ].filter(([, expected, actual]) => expected !== actual)
      .map(([field]) => field);
    if (changed.length > 0) {
      fail(
        'ARTIFACT_POST_CHILD_CHANGED',
        `certified artifact changed after built children: ${certificate.relativePath}`,
        {
          relativePath: certificate.relativePath,
          changed,
          expected: certificateMetadata(certificate),
          actual: certificateMetadata(current),
        },
      );
    }
    return current;
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function exactSortedSet(values, label) {
  if (!Array.isArray(values)
      || values.some(value => typeof value !== 'string' || value.length === 0)
      || JSON.stringify(values) !== JSON.stringify(sortedUnique(values))) {
    fail('INVALID_DIRECT_CONTROL_GRAPH', `${label} must be a sorted unique path set`);
  }
  return values;
}

function handleIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameHandleIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function identityHashProjection(artifact) {
  return {
    relativePath: artifact.relativePath,
    realPath: artifact.realPath,
    identity: {
      dev: String(artifact.identity.dev),
      ino: String(artifact.identity.ino),
      mode: artifact.identity.mode,
      size: artifact.identity.size,
      mtimeMs: artifact.identity.mtimeMs,
      ctimeMs: artifact.identity.ctimeMs,
    },
  };
}

function readRetainedBuffer(fd, stat, relativePath) {
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
    fail('ARTIFACT_IDENTITY_CHANGED', `artifact has an unsupported size: ${relativePath}`, {
      size: stat.size,
    });
  }
  const buffer = Buffer.allocUnsafe(stat.size);
  let offset = 0;
  while (offset < buffer.length) {
    const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
    if (read === 0) {
      fail('ARTIFACT_IDENTITY_CHANGED', `artifact became shorter while being read: ${relativePath}`);
    }
    offset += read;
  }
  const extra = Buffer.allocUnsafe(1);
  if (readSync(fd, extra, 0, 1, stat.size) !== 0) {
    fail('ARTIFACT_IDENTITY_CHANGED', `artifact became longer while being read: ${relativePath}`);
  }
  return buffer;
}

function pathIdentityForHandle(handle) {
  const currentReal = realpathSync(handle.requestedPath);
  const currentLstat = lstatSync(handle.requestedPath);
  if (!currentLstat.isFile()
      || currentLstat.isSymbolicLink()
      || currentReal !== handle.realPath) {
    fail(
      'ARTIFACT_POST_CHILD_CHANGED',
      `certified artifact path identity changed: ${handle.relativePath}`,
      {
        relativePath: handle.relativePath,
        changed: ['realPath'],
        expectedRealPath: handle.realPath,
        actualRealPath: currentReal,
      },
    );
  }
  return handleIdentity(currentLstat);
}

export function openRetainedArtifactHandle(
  relativePath,
  { root = repoRoot } = {},
) {
  const rootReal = realpathSync(root);
  const requestedPath = resolve(root, relativePath);
  const beforeLstat = lstatSync(requestedPath);
  const realPath = realpathSync(requestedPath);
  if (!beforeLstat.isFile()
      || beforeLstat.isSymbolicLink()
      || !containedPath(rootReal, realPath)) {
    fail('ARTIFACT_BOUNDARY', `artifact is not a contained regular file: ${relativePath}`);
  }
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number'
    ? fsConstants.O_NOFOLLOW
    : 0;
  const fd = openSync(requestedPath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(fd);
    const beforeIdentity = handleIdentity(beforeLstat);
    const openedIdentity = handleIdentity(opened);
    if (!opened.isFile() || !sameHandleIdentity(beforeIdentity, openedIdentity)) {
      fail('ARTIFACT_IDENTITY_CHANGED', `artifact changed before retained open: ${relativePath}`);
    }
    const buffer = readRetainedBuffer(fd, opened, relativePath);
    const after = fstatSync(fd);
    const afterIdentity = handleIdentity(after);
    if (!sameHandleIdentity(openedIdentity, afterIdentity)
        || !sameHandleIdentity(afterIdentity, pathIdentityForHandle({
          requestedPath,
          realPath,
          relativePath,
        }))) {
      fail('ARTIFACT_IDENTITY_CHANGED', `artifact changed during retained open: ${relativePath}`);
    }
    const artifact = {
      relativePath,
      realPath,
      identity: afterIdentity,
      buffer,
      sha256: sha256(buffer),
    };
    return {
      relativePath,
      requestedPath,
      realPath,
      fd,
      initial: artifact,
      closed: false,
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function rehashRetainedArtifactHandle(handle, {
  baseline = handle?.initial,
  allowContentTransition = false,
} = {}) {
  if (!handle || handle.closed === true || !Number.isInteger(handle.fd)) {
    fail('INVALID_RETAINED_HANDLE', 'retained artifact handle is missing or closed');
  }
  if (!baseline) {
    fail('INVALID_RETAINED_HANDLE', 'retained artifact baseline is missing');
  }
  let before;
  let buffer;
  let after;
  let pathIdentity;
  try {
    before = fstatSync(handle.fd);
    buffer = readRetainedBuffer(handle.fd, before, handle.relativePath);
    after = fstatSync(handle.fd);
    pathIdentity = pathIdentityForHandle(handle);
  } catch (error) {
    if (error instanceof ReleaseMachineError) throw error;
    fail(
      'ARTIFACT_POST_CHILD_CHANGED',
      `retained artifact could not be rehashed: ${handle.relativePath}`,
      {
        relativePath: handle.relativePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const beforeIdentity = handleIdentity(before);
  const afterIdentity = handleIdentity(after);
  const current = {
    relativePath: handle.relativePath,
    realPath: handle.realPath,
    identity: afterIdentity,
    buffer,
    sha256: sha256(buffer),
  };
  const changed = [];
  if (!sameHandleIdentity(beforeIdentity, afterIdentity)) changed.push('handleIdentity');
  if (!sameHandleIdentity(afterIdentity, pathIdentity)) changed.push('pathIdentity');
  for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs']) {
    if (afterIdentity[field] !== pathIdentity[field]) changed.push(field);
  }
  if (baseline.realPath !== current.realPath) changed.push('realPath');
  const baselineFields = allowContentTransition
    ? ['dev', 'ino', 'mode']
    : ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'];
  for (const field of baselineFields) {
    if (baseline.identity[field] !== current.identity[field]) changed.push(field);
  }
  if (!allowContentTransition && baseline.sha256 !== current.sha256) changed.push('sha256');
  if (changed.length > 0) {
    fail(
      'ARTIFACT_POST_CHILD_CHANGED',
      `retained artifact changed after certification: ${handle.relativePath}`,
      {
        relativePath: handle.relativePath,
        changed: sortedUnique(changed),
        expected: certificateMetadata(baseline),
        actual: certificateMetadata(current),
      },
    );
  }
  return current;
}

export function closeRetainedArtifactHandles(handles) {
  for (const handle of handles) {
    if (handle.closed === true) continue;
    closeSync(handle.fd);
    handle.closed = true;
  }
}

function validateDirectControlGraph(graph, phase) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)
      || graph.schema_version !== 'search-ranking-direct-control-graph/1.0'
      || graph.phase !== phase
      || graph.derived_count !== graph.expected_paths?.length
      || !Array.isArray(graph.edges)
      || !Array.isArray(graph.virtual_command_nodes)) {
    fail('INVALID_DIRECT_CONTROL_GRAPH', `direct-control graph is invalid for phase=${phase}`);
  }
  exactSortedSet(graph.expected_paths, `${phase} expected paths`);
  return graph;
}

function validateActualPackageBuildControls(graph) {
  const buildRoot = graph.roots?.package_scripts?.includes('build');
  const bareTsc = graph.edges.some(edge => (
    edge.class === 'package-script-token'
    && edge.from === 'package.json#scripts.build'
    && edge.to === 'external:node_modules/.bin/tsc'
    && edge.provenance?.package === 'typescript'
  ));
  const inlineNodes = graph.virtual_command_nodes.filter(node => (
    node.kind === 'node-inline-program'
    && node.owner === 'package.json#scripts.build'
  ));
  const inlineEdgesValid = inlineNodes.every(node => (
    /^[a-f0-9]{64}$/.test(node.sha256)
    && graph.edges.some(edge => (
      edge.class === 'package-script-token'
      && edge.from === node.owner
      && edge.to === node.id
      && edge.provenance?.command === 'node -e'
    ))
    && graph.edges.some(edge => (
      edge.class === 'generated-output-source'
      && edge.from === node.id
      && edge.provenance?.role === 'source'
    ))
  ));
  if (!buildRoot || !bareTsc || inlineNodes.length !== 3 || !inlineEdgesValid) {
    fail(
      'INVALID_PACKAGE_BUILD_GRAPH',
      'source graph must resolve the actual build root, bare tsc, and all node -e controls',
      {
        buildRoot,
        bareTsc,
        inlineNodeCount: inlineNodes.length,
        inlineEdgesValid,
      },
    );
  }
}

function graphHash(graph) {
  return sha256(Buffer.from(JSON.stringify(canonical(graph)), 'utf8'));
}

function phaseCertificate({
  phaseId,
  graphPhase,
  graph,
  expectedPaths,
  artifacts,
  deltaPaths = [],
}) {
  const sortedArtifacts = [...artifacts]
    .sort((left, right) => (
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0
    ));
  const artifactPaths = sortedArtifacts.map(artifact => artifact.relativePath);
  if (JSON.stringify(artifactPaths) !== JSON.stringify(expectedPaths)) {
    fail('CERTIFICATE_HANDLE_SET_MISMATCH', `${phaseId} retained handles differ from expected set`, {
      expected: expectedPaths,
      actual: artifactPaths,
    });
  }
  const identities = sortedArtifacts.map(identityHashProjection);
  const perHandle = Object.fromEntries(
    sortedArtifacts.map(artifact => [artifact.relativePath, artifact.sha256]),
  );
  return {
    phase_id: phaseId,
    graph_phase: graphPhase,
    count: expectedPaths.length,
    graph_sha256: graphHash(graph),
    sorted_set_sha256: sha256(Buffer.from(JSON.stringify(expectedPaths), 'utf8')),
    handle_identity_sha256: sha256(Buffer.from(JSON.stringify(identities), 'utf8')),
    per_handle_buffer_sha256: perHandle,
    delta_count: deltaPaths.length,
    delta_paths: [...deltaPaths],
  };
}

function graphPhaseDelta(fullGraph, sourceExpected) {
  const sourceSet = new Set(sourceExpected);
  const delta = fullGraph.expected_paths.filter(path => !sourceSet.has(path));
  const generated = fullGraph.edges
    .filter(edge => (
      edge.class === 'generated-output-source'
      && edge.provenance?.role === 'output'
    ))
    .map(edge => edge.to);
  const native = fullGraph.edges
    .filter(edge => (
      edge.class === 'native-manifest'
      && typeof edge.provenance?.target === 'string'
      && typeof edge.provenance?.sha256 === 'string'
    ))
    .map(edge => edge.to);
  const classified = sortedUnique([...generated, ...native])
    .filter(path => !sourceSet.has(path));
  if (JSON.stringify(delta) !== JSON.stringify(classified)) {
    fail(
      'INVALID_FULL_PHASE_DELTA',
      'full phase delta must be exactly generated outputs plus selected Native bytes',
      {
        delta,
        classified,
      },
    );
  }
  return delta;
}

export function createDerivedControlCertificate({
  root = repoRoot,
  deriveGraph = phase => deriveSearchRankingDirectControlGraph({ phase }),
  openHandle = openRetainedArtifactHandle,
} = {}) {
  const handlesByPath = new Map();
  let sourceState;
  let fullState;
  let finalState;

  const openPaths = paths => {
    const opened = [];
    try {
      for (const relativePath of paths) {
        if (handlesByPath.has(relativePath)) {
          fail('CERTIFICATE_HANDLE_REOPEN', `certified path was opened more than once: ${relativePath}`);
        }
        const handle = openHandle(relativePath, { root });
        handlesByPath.set(relativePath, handle);
        opened.push(handle);
      }
    } catch (error) {
      closeRetainedArtifactHandles(opened);
      for (const handle of opened) handlesByPath.delete(handle.relativePath);
      throw error;
    }
  };
  const artifactsFor = paths => paths.map(path => {
    const handle = handlesByPath.get(path);
    if (!handle) fail('CERTIFICATE_HANDLE_MISSING', `retained handle is missing: ${path}`);
    return handle.initial;
  });

  const captureSource = () => {
    if (sourceState) fail('CERTIFICATE_PHASE_DUPLICATE', 'source certificate was already captured');
    const graph = validateDirectControlGraph(deriveGraph('source'), 'source');
    validateActualPackageBuildControls(graph);
    openPaths(graph.expected_paths);
    const artifacts = artifactsFor(graph.expected_paths);
    sourceState = {
      graph,
      expectedPaths: [...graph.expected_paths],
      certificate: phaseCertificate({
        phaseId: 'source',
        graphPhase: 'source',
        graph,
        expectedPaths: graph.expected_paths,
        artifacts,
      }),
    };
    return sourceState;
  };

  const captureFull = () => {
    if (fullState) fail('CERTIFICATE_PHASE_DUPLICATE', 'full certificate was already captured');
    const sourceGraph = sourceState?.graph
      ?? validateDirectControlGraph(deriveGraph('source'), 'source');
    validateActualPackageBuildControls(sourceGraph);
    const fullGraph = validateDirectControlGraph(deriveGraph('full'), 'full');
    const sourceExpected = sourceState?.expectedPaths ?? sourceGraph.expected_paths;
    const fullSourceProjection = fullGraph.expected_paths
      .filter(path => new Set(sourceExpected).has(path));
    if (JSON.stringify(fullSourceProjection) !== JSON.stringify(sourceExpected)) {
      fail(
        'FULL_PHASE_SOURCE_MISMATCH',
        'fullExpected must retain sourceExpected byte-for-byte',
        {
          sourceExpected,
          fullSourceProjection,
        },
      );
    }
    const deltaPaths = graphPhaseDelta(fullGraph, sourceExpected);
    const pathsToOpen = sourceState ? deltaPaths : fullGraph.expected_paths;
    openPaths(pathsToOpen);
    const handlePaths = [...handlesByPath.keys()].sort();
    if (JSON.stringify(handlePaths) !== JSON.stringify(fullGraph.expected_paths)) {
      fail('CERTIFICATE_HANDLE_SET_MISMATCH', 'fullHandles must equal fullExpected', {
        expected: fullGraph.expected_paths,
        actual: handlePaths,
      });
    }
    const sourceSet = new Set(sourceExpected);
    const artifacts = fullGraph.expected_paths.map(path => {
      const handle = handlesByPath.get(path);
      const artifact = sourceState && sourceSet.has(path)
        ? rehashRetainedArtifactHandle(handle, {
            baseline: handle.initial,
            allowContentTransition: true,
          })
        : handle.initial;
      handle.fullBaseline = artifact;
      return artifact;
    });
    fullState = {
      graph: fullGraph,
      expectedPaths: [...fullGraph.expected_paths],
      deltaPaths,
      certificate: phaseCertificate({
        phaseId: 'full',
        graphPhase: 'full',
        graph: fullGraph,
        expectedPaths: fullGraph.expected_paths,
        artifacts,
        deltaPaths,
      }),
    };
    return fullState;
  };

  const captureFinal = () => {
    if (!fullState) fail('CERTIFICATE_PHASE_ORDER', 'final certificate requires full certificate');
    if (finalState) fail('CERTIFICATE_PHASE_DUPLICATE', 'final certificate was already captured');
    const graph = validateDirectControlGraph(deriveGraph('full'), 'full');
    if (JSON.stringify(graph.expected_paths) !== JSON.stringify(fullState.expectedPaths)) {
      fail(
        'FINAL_PHASE_SET_MISMATCH',
        'finalExpected must equal fullExpected byte-for-byte',
        {
          expected: fullState.expectedPaths,
          actual: graph.expected_paths,
        },
      );
    }
    if (graphHash(graph) !== fullState.certificate.graph_sha256) {
      fail('FINAL_PHASE_GRAPH_MISMATCH', 'final full graph hash differs from the full certificate');
    }
    const artifacts = fullState.expectedPaths.map(path => {
      const handle = handlesByPath.get(path);
      return rehashRetainedArtifactHandle(handle, {
        baseline: handle.fullBaseline,
      });
    });
    finalState = {
      graph,
      expectedPaths: [...graph.expected_paths],
      artifacts,
      certificate: phaseCertificate({
        phaseId: 'final',
        graphPhase: 'full',
        graph,
        expectedPaths: graph.expected_paths,
        artifacts,
        deltaPaths: [],
      }),
    };
    if (finalState.certificate.delta_count !== 0
        || finalState.certificate.sorted_set_sha256
          !== fullState.certificate.sorted_set_sha256
        || finalState.certificate.handle_identity_sha256
          !== fullState.certificate.handle_identity_sha256
        || JSON.stringify(finalState.certificate.per_handle_buffer_sha256)
          !== JSON.stringify(fullState.certificate.per_handle_buffer_sha256)) {
      fail('FINAL_PHASE_CERTIFICATE_MISMATCH', 'final same-handle certificate differs from full');
    }
    return finalState;
  };

  const rehashSource = () => {
    if (!sourceState || fullState) {
      fail('CERTIFICATE_PHASE_ORDER', 'source-only rehash requires source without full');
    }
    const artifacts = sourceState.expectedPaths.map(path => (
      rehashRetainedArtifactHandle(handlesByPath.get(path))
    ));
    return {
      artifacts,
      certificate: phaseCertificate({
        phaseId: 'source',
        graphPhase: 'source',
        graph: sourceState.graph,
        expectedPaths: sourceState.expectedPaths,
        artifacts,
      }),
    };
  };

  return {
    captureSource,
    captureFull,
    captureFinal,
    rehashSource,
    getHandle(relativePath) {
      return handlesByPath.get(relativePath);
    },
    get source() {
      return sourceState;
    },
    get full() {
      return fullState;
    },
    get final() {
      return finalState;
    },
    close() {
      closeRetainedArtifactHandles(handlesByPath.values());
    },
    result() {
      const phases = {};
      if (sourceState) phases.source = sourceState.certificate;
      if (fullState) phases.full = fullState.certificate;
      if (finalState) phases.final = finalState.certificate;
      const derivedSet = finalState?.expectedPaths
        ?? fullState?.expectedPaths
        ?? sourceState?.expectedPaths
        ?? [];
      return {
        schema_version: 'search-ranking-direct-control-certificate/1.0',
        count: derivedSet.length,
        phases,
      };
    },
  };
}

export function parseArtifactJson(artifact) {
  try {
    return JSON.parse(artifact.buffer.toString('utf8'));
  } catch (error) {
    fail('INVALID_ARTIFACT_JSON', `cannot parse artifact JSON: ${artifact.relativePath}`, {
      sha256: artifact.sha256,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function graphNativePaths(graph) {
  const manifestPath = graph.edges.find(edge => (
    edge.class === 'native-manifest'
    && edge.provenance?.role === 'native-manifest'
  ))?.to;
  const provenancePath = graph.edges.find(edge => (
    edge.class === 'native-manifest'
    && edge.provenance?.role === 'native-provenance'
  ))?.to;
  const bytePaths = sortedUnique(graph.edges
    .filter(edge => (
      edge.class === 'native-manifest'
      && typeof edge.provenance?.target === 'string'
      && typeof edge.provenance?.sha256 === 'string'
    ))
    .map(edge => edge.to));
  if (typeof manifestPath !== 'string'
      || typeof provenancePath !== 'string'
      || bytePaths.length === 0) {
    fail('INVALID_NATIVE_CERTIFICATE_GRAPH', 'direct-control graph has no Native manifest closure');
  }
  return { manifestPath, provenancePath, bytePaths };
}

export function runNativeLifecycleProtocolProbe({
  root = repoRoot,
  spawn = spawnSync,
} = {}) {
  const script = join(root, 'scripts', 'run-lifecycle-fs-native-tests.mjs');
  const result = spawn(process.execPath, [script], {
    cwd: root,
    shell: false,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    childFailure('native-lifecycle:current-platform-protocol', result);
  }
  return {
    label: 'native-lifecycle:current-platform-protocol',
    command: process.execPath,
    args: [script],
    cwd: root,
    shell: false,
    status: result.status,
    signal: result.signal ?? null,
    stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
    stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
  };
}

export function certifyNativeControls({
  graph,
  getHandle,
  protocolProbe = () => runNativeLifecycleProtocolProbe(),
} = {}) {
  validateDirectControlGraph(graph, 'full');
  if (typeof getHandle !== 'function') {
    fail('INVALID_NATIVE_CERTIFICATE', 'Native certificate requires retained handles');
  }
  const { manifestPath, provenancePath, bytePaths } = graphNativePaths(graph);
  const artifactFor = path => {
    const handle = getHandle(path);
    if (!handle?.initial) {
      fail('CERTIFICATE_HANDLE_MISSING', `Native retained handle is missing: ${path}`);
    }
    return handle.initial;
  };
  const manifestArtifact = artifactFor(manifestPath);
  const provenanceArtifact = artifactFor(provenancePath);
  const manifest = parseArtifactJson(manifestArtifact);
  const provenance = parseArtifactJson(provenanceArtifact);
  if (manifest.schema_version !== 'lifecycle-fs-native-manifest/1.0'
      || manifest.protocol !== 'lifecycle-fs-helper/1.0'
      || !Array.isArray(manifest.artifacts)
      || manifest.artifacts.length !== 5
      || !Array.isArray(provenance.artifacts)
      || provenance.artifacts.length !== manifest.artifacts.length) {
    fail('INVALID_NATIVE_CERTIFICATE', 'Native manifest/provenance shape is invalid');
  }
  const manifestTargets = manifest.artifacts.map(artifact => artifact.target);
  const provenanceTargets = provenance.artifacts.map(artifact => artifact.target);
  if (new Set(manifestTargets).size !== manifestTargets.length
      || new Set(provenanceTargets).size !== provenanceTargets.length
      || JSON.stringify([...manifestTargets].sort()) !== JSON.stringify([...provenanceTargets].sort())
      || JSON.stringify(bytePaths) !== JSON.stringify(
        manifest.artifacts.map(artifact => artifact.path).sort(),
      )) {
    fail('INVALID_NATIVE_CERTIFICATE', 'Native targets and graph byte paths differ');
  }
  const provenanceByTarget = new Map(
    provenance.artifacts.map(artifact => [artifact.target, artifact]),
  );
  const receiptNodes = graph.virtual_command_nodes
    .filter(node => node.kind === 'native-job-receipt');
  if (receiptNodes.length !== manifest.artifacts.length) {
    fail('INVALID_NATIVE_CERTIFICATE', 'Native receipt node count differs from manifest');
  }
  const mappings = manifest.artifacts.map(artifact => {
    const receipt = provenanceByTarget.get(artifact.target);
    const byteArtifact = artifactFor(artifact.path);
    const receiptNode = receiptNodes.find(node => (
      node.id === `virtual:native-job-receipt:${artifact.target}:${receipt?.job_receipt_sha256}`
    ));
    if (!receipt
        || artifact.protocol !== manifest.protocol
        || !/^[a-f0-9]{64}$/.test(receipt.job_receipt_sha256 ?? '')
        || artifact.sha256 !== receipt.binary_sha256
        || artifact.sha256 !== byteArtifact.sha256
        || !receiptNode) {
      fail('INVALID_NATIVE_CERTIFICATE', `Native byte/receipt mismatch: ${artifact.target}`, {
        target: artifact.target,
        manifestSha256: artifact.sha256,
        provenanceSha256: receipt?.binary_sha256 ?? null,
        actualSha256: byteArtifact.sha256,
        receiptNode: receiptNode?.id ?? null,
      });
    }
    return {
      target: artifact.target,
      platform: artifact.platform,
      arch: artifact.arch,
      path: artifact.path,
      protocol: artifact.protocol,
      binary_sha256: byteArtifact.sha256,
      job_receipt_sha256: receipt.job_receipt_sha256,
    };
  });
  const selected = mappings.filter(mapping => (
    mapping.platform === process.platform && mapping.arch === process.arch
  ));
  if (selected.length !== 1) {
    fail('INVALID_NATIVE_CERTIFICATE', 'current platform must select exactly one certified Native byte', {
      platform: process.platform,
      arch: process.arch,
      selected: selected.map(mapping => mapping.target),
    });
  }
  const probe = protocolProbe(selected[0]);
  if (!probe || probe.status !== 0) {
    fail('NATIVE_PROTOCOL_PROBE_FAILED', 'current-platform Native protocol probe did not pass');
  }
  return {
    manifest_path: manifestPath,
    manifest_sha256: manifestArtifact.sha256,
    provenance_path: provenancePath,
    provenance_sha256: provenanceArtifact.sha256,
    protocol: manifest.protocol,
    mappings,
    selected: selected[0],
    probe,
  };
}

export function validatePiReleaseContract(pi, holdouts) {
  const invalid = (message, details) => {
    fail('INVALID_PI_RELEASE_CONTRACT', message, details);
  };
  if (!pi || typeof pi !== 'object' || Array.isArray(pi)
      || pi.schema_version !== 'pi-knowledge-absolute/1.0') {
    invalid('Pi absolute fixture must use schema pi-knowledge-absolute/1.0');
  }
  if (!holdouts || typeof holdouts !== 'object' || Array.isArray(holdouts)
      || holdouts.schema_version !== 'search-ranking-holdouts/1.0'
      || !Array.isArray(holdouts.queries)) {
    invalid('Pi holdout fixture must use schema search-ranking-holdouts/1.0');
  }
  if (typeof pi.canonicalId !== 'string'
      || pi.canonicalId.trim().length === 0
      || pi.canonicalId !== pi.canonicalId.trim()) {
    invalid('Pi canonicalId must be a non-empty canonical string');
  }
  if (typeof pi.legacyId !== 'string'
      || pi.legacyId.trim().length === 0
      || pi.legacyId !== pi.legacyId.trim()
      || pi.legacyId === pi.canonicalId) {
    invalid('Pi legacyId must be a distinct non-empty string');
  }
  if (!Array.isArray(pi.queries) || pi.queries.length < LIMITS.piPrimaryCount) {
    invalid(`Pi absolute fixture must contain at least ${LIMITS.piPrimaryCount} primary queries`);
  }
  const holdoutQueries = holdouts.queries.filter(query => query?.category === 'pi');
  if (holdoutQueries.length < LIMITS.piHoldoutCount) {
    invalid(`Pi holdout fixture must contain at least ${LIMITS.piHoldoutCount} Pi queries`);
  }

  const expectedThresholds = {
    topK: 5,
    recallAt: 20,
    minRecall: LIMITS.piRecallAt20,
    maxDeprecatedLeakCount: 0,
  };
  if (!pi.thresholds || typeof pi.thresholds !== 'object' || Array.isArray(pi.thresholds)
      || Object.entries(expectedThresholds).some(
        ([name, value]) => pi.thresholds[name] !== value,
      )) {
    invalid('Pi thresholds must match the fixed release contract', {
      expected: expectedThresholds,
      actual: pi.thresholds ?? null,
    });
  }

  const seenIds = new Set();
  const seenQueries = new Set();
  const validateQuery = (query, group) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)
        || typeof query.id !== 'string'
        || query.id.trim().length === 0
        || query.id !== query.id.trim()
        || typeof query.query !== 'string'
        || query.query.trim().length === 0
        || query.query !== query.query.trim()) {
      invalid(`Pi ${group} contains a blank or invalid query`);
    }
    const normalized = normalizedQuery(query.query);
    if (seenIds.has(query.id)) {
      invalid(`Pi query id must be unique: ${query.id}`);
    }
    if (seenQueries.has(normalized)) {
      invalid(`Pi query text must be unique and primary/holdout disjoint: ${query.query}`);
    }
    seenIds.add(query.id);
    seenQueries.add(normalized);
    if (!Array.isArray(query.targetIds)
        || query.targetIds.length === 0
        || new Set(query.targetIds).size !== query.targetIds.length
        || query.targetIds.some(targetId => targetId !== pi.canonicalId)) {
      invalid(`Pi query targets must be non-empty canonical IDs: ${query.id}`, {
        canonicalId: pi.canonicalId,
        targetIds: query.targetIds ?? null,
      });
    }
  };
  for (const query of pi.queries) validateQuery(query, 'primary fixture');
  for (const query of holdoutQueries) validateQuery(query, 'holdout fixture');

  return {
    canonicalId: pi.canonicalId,
    legacyId: pi.legacyId,
    thresholds: pi.thresholds,
    primaryQueries: pi.queries,
    holdoutQueries,
  };
}

function runBinChild(label, args, {
  spawn = spawnSync,
  cwd = repoRoot,
  projectRoot = cwd,
} = {}) {
  const result = spawn(process.execPath, [binPath, ...args], {
    shell: false,
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      MAESTRO_PROJECT_ROOT: projectRoot,
      MAESTRO_NO_WASM_RELAUNCH: '1',
      NO_COLOR: '1',
    },
  });
  if (result.error || result.status !== 0) childFailure(label, result);
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch (error) {
    fail('INVALID_BIN_JSON', `${label}: public CLI did not emit JSON`, {
      status: result.status,
      signal: result.signal ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    body,
    trace: {
      label,
      command: process.execPath,
      args: [binPath, ...args],
      cwd,
      shell: false,
      status: result.status,
      signal: result.signal ?? null,
      stdoutBytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
      stderrBytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
      maestroProjectRoot: projectRoot,
    },
  };
}

function seedBuiltWorkspace(workspaceRoot) {
  const knowhowRoot = join(workspaceRoot, '.workflow', 'knowhow');
  mkdirSync(knowhowRoot, { recursive: true });
  for (const [fixture, name] of [
    ['pi-knowledge-legacy-superseded.md', 'RCP-20260716-pi-maestro-flow-cli.md'],
    ['pi-knowledge-canonical.md', 'RCP-20260723-pi-skills-canonical-generation.md'],
  ]) {
    copyFileSync(
      join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', fixture),
      join(knowhowRoot, name),
    );
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]),
  );
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function builtProviderForCategory(category) {
  switch (category) {
    case 'exact-symbol': return 'code';
    case 'wiki-short': return 'wiki';
    case 'knowledge': return 'kg';
    case 'mixed': return 'mixed';
    case 'linked-scope': return 'linked';
    default:
      fail('INVALID_RANKING_FIXTURES', `unknown ranking category: ${String(category)}`);
  }
}

function eligibleAuthorizedCorpusSize(judgment, provider, documentById) {
  const queryTerms = tokenize(judgment.query);
  let count = 0;
  for (const documentId of Object.keys(judgment.relevance)) {
    const document = documentById.get(documentId);
    if (!document
        || document.authorized === false
        || document.status === 'deprecated') continue;
    const workspace = document.workspace ?? 'local';
    const eligible = provider === 'linked'
      ? workspace === 'peer' && document.kind === 'code-symbol'
      : provider === 'code'
        ? workspace === 'local' && document.kind === 'code-symbol'
        : provider === 'wiki'
          ? workspace === 'local'
            && document.kind !== 'code-symbol'
            && document.kind !== 'latency-noise'
          : provider === 'mixed'
            ? workspace === 'local' && document.kind !== 'latency-noise'
            : workspace === 'local';
    const searchable = [
      document.title,
      document.summary,
      document.tags.join(' '),
      document.body,
    ].join(' ').toLocaleLowerCase('en-US');
    if (eligible && (
      provider === 'kg'
      || queryTerms.every(term => searchable.includes(term))
    )) count += 1;
  }
  return Math.min(20, count);
}

function validateParentRankingFixtures({ qrels, baseline, corpus, holdouts }) {
  const invalid = (message, details) => fail('INVALID_RANKING_FIXTURES', message, details);
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)
      || corpus.schema_version !== 'search-ranking-corpus/1.0'
      || !Array.isArray(corpus.documents)
      || !corpus.latencyCorpus
      || !Number.isInteger(corpus.latencyCorpus.size)
      || corpus.latencyCorpus.size < corpus.documents.length
      || !Array.isArray(corpus.latencyCorpus.vocabulary)
      || corpus.latencyCorpus.vocabulary.length === 0) {
    invalid('invalid search-ranking-corpus/1.0 fixture');
  }
  const documentById = new Map();
  for (const document of corpus.documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)
        || typeof document.id !== 'string' || document.id.length === 0
        || typeof document.kind !== 'string'
        || typeof document.title !== 'string'
        || typeof document.summary !== 'string'
        || typeof document.body !== 'string'
        || !Array.isArray(document.tags)
        || document.tags.some(tag => typeof tag !== 'string')
        || documentById.has(document.id)) {
      invalid('corpus contains an invalid or duplicate document');
    }
    documentById.set(document.id, document);
  }
  if (!qrels || typeof qrels !== 'object' || Array.isArray(qrels)
      || qrels.schema_version !== 'search-ranking-qrels/1.0'
      || !Array.isArray(qrels.queries)
      || qrels.queries.length === 0) {
    invalid('invalid search-ranking-qrels/1.0 fixture');
  }
  const queryIds = new Set();
  for (const query of qrels.queries) {
    if (!query || typeof query !== 'object' || Array.isArray(query)
        || typeof query.id !== 'string' || query.id.length === 0
        || typeof query.query !== 'string' || query.query.trim().length === 0
        || typeof query.category !== 'string'
        || !query.relevance || typeof query.relevance !== 'object'
        || Array.isArray(query.relevance)
        || Object.keys(query.relevance).length === 0
        || queryIds.has(query.id)) {
      invalid('qrels contains an invalid or duplicate query');
    }
    builtProviderForCategory(query.category);
    queryIds.add(query.id);
    for (const [documentId, grade] of Object.entries(query.relevance)) {
      if (!documentById.has(documentId)
          || !Number.isInteger(grade)
          || grade < 0
          || grade > 3) {
        invalid(`qrels contains an invalid judgment: ${query.id}/${documentId}`);
      }
    }
  }
  if (baseline !== undefined && (
    !baseline || typeof baseline !== 'object' || Array.isArray(baseline)
    || baseline.schema_version !== 'search-ranking-baseline/1.0'
    || !/^[a-f0-9]{64}$/.test(baseline.qrelsSha256)
    || !baseline.metrics || typeof baseline.metrics !== 'object'
    || !baseline.knownOrder || typeof baseline.knownOrder !== 'object'
  )) invalid('invalid search-ranking-baseline/1.0 fixture');
  if (holdouts !== undefined && (
    !holdouts || typeof holdouts !== 'object' || Array.isArray(holdouts)
    || holdouts.schema_version !== 'search-ranking-holdouts/1.0'
    || !Array.isArray(holdouts.queries)
  )) invalid('invalid search-ranking-holdouts/1.0 fixture');
  const frozenQueries = new Set(qrels.queries.map(query => normalizedQuery(query.query)));
  for (const query of corpus.absoluteQueries ?? []) {
    if (!query || typeof query.query !== 'string' || query.query.trim().length === 0) {
      invalid('corpus contains an invalid absolute query');
    }
    frozenQueries.add(normalizedQuery(query.query));
  }
  const holdoutOverlapIds = [];
  for (const query of holdouts?.queries ?? []) {
    if (!query || typeof query !== 'object' || Array.isArray(query)
        || typeof query.id !== 'string' || query.id.length === 0
        || typeof query.query !== 'string' || query.query.trim().length === 0
        || !Array.isArray(query.targetIds) || query.targetIds.length === 0) {
      invalid('holdouts contain an invalid query');
    }
    if (frozenQueries.has(normalizedQuery(query.query))) holdoutOverlapIds.push(query.id);
  }
  if (baseline !== undefined && !baselineGoldenMatches(qrels, baseline)) {
    invalid('baseline metrics are not reproducible from qrels and known-order rows');
  }
  return { documentById, holdoutOverlapIds };
}

export function deriveBuiltSearchAdapterExpected({
  workspaceRoot,
  qrels,
  corpus,
  qrelsSha256,
  runner = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: cpus().length,
  },
}) {
  const { documentById } = validateParentRankingFixtures({
    qrels,
    corpus,
  });
  const expected = {
    workspaceRoot,
    qrelsSha256,
    queries: qrels.queries.map(query => {
      const provider = builtProviderForCategory(query.category);
      return {
        queryId: query.id,
        category: query.category,
        provider,
        function: BUILT_PROVIDER_FUNCTIONS[provider],
        expectedCount: eligibleAuthorizedCorpusSize(query, provider, documentById),
      };
    }),
    databasePaths: {
      canonicalDatabase: join(workspaceRoot, '.workflow', 'kg', 'maestro.db'),
      linkedCanonicalDatabase: join(
        workspaceRoot,
        'linked-peer',
        '.workflow',
        'kg',
        'maestro.db',
      ),
      unauthorizedControlDatabase: join(
        workspaceRoot,
        'linked-secret-control',
        '.workflow',
        'kg',
        'maestro.db',
      ),
    },
    runner,
    constants: { runs: 5, topK: 20, warmups: 20, measuredSamples: 100 },
  };
  try {
    return parseBuiltSearchAdapterExpected(expected);
  } catch (error) {
    fail('INVALID_BUILT_ADAPTER_EXPECTED', 'parent-derived adapter Expected is invalid', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function parseBuiltAdapterContract(body, expected) {
  try {
    return parseBuiltSearchAdapterReport(body, expected);
  } catch (error) {
    fail('INVALID_BUILT_ADAPTER_CONTRACT', 'compiled built adapter violated the generated contract', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function snapshotWorkspaceState(root) {
  const snapshot = {};
  const visit = directory => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const relativePath = relative(root, path).split(sep).join('/');
        const artifact = readArtifact(relativePath, { root });
        snapshot[relativePath] = {
          dev: artifact.identity.dev,
          ino: artifact.identity.ino,
          size: artifact.identity.size,
          mtimeMs: artifact.identity.mtimeMs,
          sha256: artifact.sha256,
        };
      } else {
        fail('PROTECTED_STATE_BOUNDARY', 'protected workspace contains a non-file entry', {
          path,
        });
      }
    }
  };
  visit(root);
  return snapshot;
}

function protectedStateProjection(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([path, identity]) => [
    path,
    {
      size: identity.size,
      mtimeMs: identity.mtimeMs,
      sha256: identity.sha256,
    },
  ]));
}

function expectedModuleSourceHashes(expectedUrls, {
  artifactRoot,
  certifiedArtifactsByPath,
}) {
  const rootReal = realpathSync(artifactRoot);
  return Object.fromEntries(expectedUrls.map(url => {
    const modulePath = fileURLToPath(url);
    const relativePath = relative(rootReal, modulePath);
    if (!containedPath(rootReal, modulePath)) {
      fail('ATTESTATION_MODULE_BOUNDARY', 'attested module escapes the artifact root', {
        url,
        artifactRoot: rootReal,
      });
    }
    const normalized = relativePath.split(sep).join('/');
    const certificate = certifiedArtifactsByPath?.get(normalized)
      ?? readArtifact(normalized, { root: rootReal });
    if (pathToFileURL(certificate.realPath).href !== url) {
      fail('ATTESTATION_MODULE_IDENTITY', 'attested module URL is not canonical', {
        expected: url,
        actual: pathToFileURL(certificate.realPath).href,
      });
    }
    return [url, certificate.sha256];
  }));
}

export function prepareBuiltAdapterAttestation({
  adapterPath,
  artifactRoot = repoRoot,
  certifiedArtifactsByPath,
  schemaSha256 = SCHEMA_SHA256,
} = {}) {
  const bootstrap = certifiedArtifactsByPath?.get(ATTESTATION_BOOTSTRAP_PATH)
    ?? readArtifact(ATTESTATION_BOOTSTRAP_PATH, { root: artifactRoot });
  const bootstrapBuffer = extractCertifiedBootstrapBuffer(bootstrap.buffer);
  const dynamicManifestArtifact = certifiedArtifactsByPath?.get(DYNAMIC_EDGE_MANIFEST_PATH);
  const dynamicManifest = dynamicManifestArtifact
    ? parseArtifactJson(dynamicManifestArtifact)
    : loadProbeDynamicEdgeManifest(join(artifactRoot, DYNAMIC_EDGE_MANIFEST_PATH));
  const derivation = deriveProbeModuleAttestation({
    certifiedRoots: [artifactRoot],
    probes: [{
      probeId: 'built-search-adapter',
      entry: adapterPath,
      guards: {
        'mixed-wiki-search': true,
        'code-search': true,
      },
    }, {
      probeId: 'read-only-probe',
      entry: join(artifactRoot, 'dist', 'src', 'commands', 'search.js'),
      guards: {
        'wiki-search': true,
      },
    }],
    manifest: dynamicManifest,
    manifestBase: artifactRoot,
  });
  const expectedUrls =
    derivation.probes['built-search-adapter'].expected_urls;
  return {
    bootstrapBuffer,
    manifest: createAttestationManifest({
      probeId: 'built-search-adapter',
      schemaSha256,
      bootstrapBuffer,
      moduleSourceHashes: expectedModuleSourceHashes(expectedUrls, {
        artifactRoot,
        certifiedArtifactsByPath,
      }),
    }),
  };
}

export async function runBuiltAdapterChild({
  attestation,
  attestedSpawn = runCertifiedAttestedChild,
  workspaceRoot,
  env = {},
  adapterPath = builtSearchAdapterPath,
  artifactRoot = repoRoot,
  expected,
  certifiedArtifactsByPath,
  schemaSha256 = SCHEMA_SHA256,
  timeoutMs = 600_000,
} = {}) {
  if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
    fail('INVALID_BUILT_WORKSPACE', 'built adapter workspace must be an absolute path');
  }
  if (!isExistingAbsoluteFile(adapterPath)) {
    fail('BUILT_ADAPTER_MISSING', 'compiled built search adapter is missing', {
      path: adapterPath,
    });
  }
  const args = [
    adapterPath,
    '--workspace', workspaceRoot,
    '--corpus', join(FIXTURE_ROOT, 'search-ranking-corpus.json'),
    '--qrels', join(FIXTURE_ROOT, 'search-ranking-qrels.json'),
    '--baseline', join(FIXTURE_ROOT, 'search-ranking-baseline.json'),
    '--holdouts', join(FIXTURE_ROOT, 'search-ranking-holdouts.json'),
  ];
  const certifiedAttestation = attestation ?? prepareBuiltAdapterAttestation({
    adapterPath,
    artifactRoot,
    certifiedArtifactsByPath,
    schemaSha256,
  });
  if (certifiedAttestation?.manifest?.schemaSha256 !== schemaSha256) {
    fail('BUILT_ADAPTER_SCHEMA_MISMATCH', 'attested adapter schema hash is not exact', {
      expected: schemaSha256,
      actual: certifiedAttestation?.manifest?.schemaSha256 ?? null,
    });
  }
  if (!expected) {
    fail('MISSING_BUILT_ADAPTER_EXPECTED', 'parent-derived adapter Expected is required');
  }
  const result = await attestedSpawn({
    args,
    cwd: workspaceRoot,
    projectRoot: workspaceRoot,
    bootstrapBuffer: certifiedAttestation.bootstrapBuffer,
    manifest: certifiedAttestation.manifest,
    parentEnvironment: {
      ...process.env,
      ...env,
      MAESTRO_PROJECT_ROOT: workspaceRoot,
    },
    timeoutMs,
  });
  const body = result?.transcript?.rawEvidence;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('INVALID_BUILT_ADAPTER_JSON', 'compiled built adapter did not emit machine JSON', {
      stdout: result?.stdout?.toString('utf8') ?? '',
      stderr: result?.stderr?.toString('utf8') ?? '',
    });
  }
  const parsed = parseBuiltAdapterContract(body, expected);
  return {
    body: parsed,
    rawBody: body,
    trace: {
      ...result.trace,
      label: 'built-bin:search-adapter',
      maestroProjectRoot: workspaceRoot,
      probeId: certifiedAttestation.manifest.probeId,
      nonce: certifiedAttestation.manifest.nonce,
      observedUrls: result.transcript.observedUrls,
      sourceHashes: result.transcript.sourceHashes,
    },
  };
}

function tokenize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}_$]+/gu) ?? [];
}

function normalizedQuery(value) {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function preparedCorpus(corpus) {
  const documents = [...corpus.documents];
  const vocabulary = corpus.latencyCorpus.vocabulary;
  for (let index = documents.length; index < corpus.latencyCorpus.size; index += 1) {
    const tokenA = vocabulary[index % vocabulary.length];
    const tokenB = vocabulary[(index * 7 + 3) % vocabulary.length];
    const suffix = String(index + 1).padStart(4, '0');
    documents.push({
      id: `${corpus.latencyCorpus.idPrefix}-${suffix}`,
      kind: 'latency-noise',
      title: `Synthetic ${tokenA} ${suffix}`,
      summary: `Deterministic ${tokenA} ${tokenB} latency document`,
      tags: ['latency', tokenA, tokenB],
      body: `${tokenA} ${tokenB} synthetic benchmark corpus entry ${suffix}`,
      status: 'active',
      workspace: 'local',
      authorized: true,
      provenance: { source: 'fixture', path: `latency/${suffix}.json` },
    });
  }
  return documents.map(document => ({
    document,
    title: tokenize(document.title),
    summary: tokenize(document.summary),
    tags: document.tags.flatMap(tokenize),
    body: tokenize(document.body),
  }));
}

function termFrequency(tokens, term) {
  let count = 0;
  for (const token of tokens) if (token === term) count += 1;
  return count;
}

function rankPrepared(query, prepared, limit) {
  const queryTerms = [...new Set(tokenize(query))];
  const normalized = normalizedQuery(query);
  const ranked = [];
  for (const item of prepared) {
    const { document } = item;
    if (document.status === 'deprecated' || document.authorized === false) continue;
    let score = normalizedQuery(document.title) === normalized ? 16 : 0;
    for (const term of queryTerms) {
      score += termFrequency(item.title, term) * 5;
      score += termFrequency(item.tags, term) * 3;
      score += termFrequency(item.summary, term) * 2;
      score += termFrequency(item.body, term);
    }
    if (score > 0) ranked.push({ id: document.id, score });
  }
  return ranked
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function rankingMetrics(rankedIds, relevance) {
  const relevantIds = Object.entries(relevance)
    .filter(([, grade]) => grade > 0)
    .map(([id]) => id);
  let dcg = 0;
  for (let index = 0; index < Math.min(10, rankedIds.length); index += 1) {
    const grade = relevance[rankedIds[index]] ?? 0;
    dcg += (2 ** grade - 1) / Math.log2(index + 2);
  }
  const idealGrades = relevantIds
    .map(id => relevance[id])
    .sort((left, right) => right - left)
    .slice(0, 10);
  const idcg = idealGrades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
  const firstRelevant = rankedIds.slice(0, 10).findIndex(id => (relevance[id] ?? 0) > 0);
  const recalled = new Set(rankedIds.slice(0, 20).filter(id => (relevance[id] ?? 0) > 0)).size;
  return {
    ndcgAt10: idcg === 0 ? 0 : dcg / idcg,
    mrrAt10: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
    recallAt20: recalled / relevantIds.length,
  };
}

function meanMetrics(values) {
  return {
    ndcgAt10: values.reduce((sum, value) => sum + value.ndcgAt10, 0) / values.length,
    mrrAt10: values.reduce((sum, value) => sum + value.mrrAt10, 0) / values.length,
    recallAt20: values.reduce((sum, value) => sum + value.recallAt20, 0) / values.length,
  };
}

function aggregateMetrics(rows) {
  const categories = {};
  for (const category of [...new Set(rows.map(row => row.category))].sort()) {
    categories[category] = meanMetrics(
      rows.filter(row => row.category === category).map(row => row.metrics),
    );
  }
  return { overall: meanMetrics(rows.map(row => row.metrics)), categories };
}

function baselineGoldenMatches(qrels, baseline) {
  const rows = qrels.queries.map(query => ({
    category: query.category,
    metrics: rankingMetrics(baseline.knownOrder[query.id] ?? [], query.relevance),
  }));
  const computed = aggregateMetrics(rows);
  const close = (left, right) => Math.abs(left - right) <= 1e-12;
  const metricsMatch = (left, right) => (
    close(left.ndcgAt10, right.ndcgAt10)
    && close(left.mrrAt10, right.mrrAt10)
    && close(left.recallAt20, right.recallAt20)
  );
  return metricsMatch(computed.overall, baseline.metrics.overall)
    && Object.entries(computed.categories).every(
      ([category, metrics]) => baseline.metrics.categories[category]
        && metricsMatch(metrics, baseline.metrics.categories[category]),
    );
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function compareMetricBaseline(metrics, baseline) {
  const categories = Object.keys(metrics.categories).sort();
  const baselineCategories = Object.keys(baseline.metrics.categories).sort();
  if (!sameJson(categories, baselineCategories)) {
    fail('INVALID_RANKING_FIXTURES', 'candidate and baseline category sets differ', {
      categories,
      baselineCategories,
    });
  }
  const overallNdcgGain = metrics.overall.ndcgAt10 - baseline.metrics.overall.ndcgAt10;
  const maxCategoryNdcgDrop = Math.max(
    0,
    ...categories.map(
      category => baseline.metrics.categories[category].ndcgAt10
        - metrics.categories[category].ndcgAt10,
    ),
  );
  return { overallNdcgGain, maxCategoryNdcgDrop };
}

function expectedWorkspaceFence(workspace) {
  return workspace === null || workspace === 'local' ? null : `linked:${workspace}`;
}

export function recomputeBuiltAggregates(report, {
  qrels,
  baseline,
  corpus,
  holdouts,
}) {
  const { documentById, holdoutOverlapIds } = validateParentRankingFixtures({
    qrels,
    baseline,
    corpus,
    holdouts,
  });
  const qrelsById = new Map(qrels.queries.map(query => [query.id, query]));
  const metricRows = [];
  const returnedIds = new Set();
  let stableTop20 = true;
  let expectedCountsMatch = true;
  let queryCoverage = report.evidence.queries.length === qrels.queries.length;

  for (let queryIndex = 0; queryIndex < report.evidence.queries.length; queryIndex += 1) {
    const evidence = report.evidence.queries[queryIndex];
    const judgment = qrels.queries[queryIndex];
    queryCoverage &&= judgment?.id === evidence.queryId
      && judgment.category === evidence.category
      && qrelsById.has(evidence.queryId);
    const runIds = evidence.runs.map(run => run.results.map(result => result.id));
    expectedCountsMatch &&= evidence.runs.length === 5
      && evidence.runs.every(run => (
        run.results.length === evidence.expectedCount
        && run.results.every((result, index) => result.rank === index + 1)
        && new Set(run.results.map(result => result.id)).size === run.results.length
      ));
    stableTop20 &&= runIds.slice(1).every(ids => sameJson(ids, runIds[0]));
    for (const id of runIds[0]) returnedIds.add(id);
    metricRows.push({
      category: judgment.category,
      metrics: rankingMetrics(runIds[0], judgment.relevance),
    });
  }

  const metrics = aggregateMetrics(metricRows);
  const baselineComparison = compareMetricBaseline(metrics, baseline);
  const firstRunResults = report.evidence.queries.flatMap(query => query.runs[0].results);
  const allEvidenceResults = report.evidence.queries.flatMap(query => (
    query.runs.flatMap(run => run.results)
  ));
  const deprecatedLeakIds = new Set();
  const unauthorizedWorkspaceIds = new Set();
  const provenanceLossIds = new Set();
  for (const result of allEvidenceResults) {
    const document = documentById.get(result.id);
    const expectedStatus = document?.status === 'deprecated' ? 'deprecated' : 'active';
    const expectedWorkspace = document?.workspace ?? null;
    const expectedAuthorized = document?.authorized !== false;
    const expectedProvenance = document?.provenance ?? null;
    if (!document || result.status !== expectedStatus || expectedStatus === 'deprecated') {
      deprecatedLeakIds.add(result.id);
    }
    if (!document
        || result.authorized !== expectedAuthorized
        || expectedAuthorized === false
        || result.workspace !== expectedWorkspace
        || result.workspaceFence !== expectedWorkspaceFence(expectedWorkspace)) {
      unauthorizedWorkspaceIds.add(result.id);
    }
    if (!document
        || expectedProvenance === null
        || !sameJson(result.provenance, expectedProvenance)) {
      provenanceLossIds.add(result.id);
    }
  }
  const countEvent = event => report.evidence.events
    .filter(row => row.event === event).length;
  const sideEffects = Object.fromEntries(
    Object.entries(BUILT_SIDE_EFFECT_EVENTS)
      .map(([counter, event]) => [counter, countEvent(event)]),
  );
  const latency = {
    kgWarmP95Ms: percentile(report.evidence.latency.kgWarmSamplesMs, 0.95),
    kgWarmMaxMs: Math.max(...report.evidence.latency.kgWarmSamplesMs),
    wikiQueryP95Ms: percentile(report.evidence.latency.wikiQuerySamplesMs, 0.95),
    wikiIndexP95Ms: percentile(
      report.evidence.latency.wikiIndexSamples.map(sample => sample.durationMs),
      0.95,
    ),
  };
  const integrity = {
    deprecatedLeakCount: deprecatedLeakIds.size,
    unauthorizedWorkspaceHitCount: unauthorizedWorkspaceIds.size,
    provenanceLossCount: provenanceLossIds.size,
    attachOrMergeCalls: countEvent('database-attach-or-merge'),
  };
  const reported = {
    metrics,
    overallNdcgGain: baselineComparison.overallNdcgGain,
    maxCategoryNdcgDrop: baselineComparison.maxCategoryNdcgDrop,
    stability: { runs: 5, topK: 20, stableTop20 },
    latency,
    integrity,
    sideEffects,
  };
  return {
    reported,
    queryCoverage,
    expectedCountsMatch,
    metrics,
    ...baselineComparison,
    stableTop20,
    integrity,
    sideEffects,
    latency,
    holdoutOverlapCount: holdoutOverlapIds.length,
    wikiIndexCacheHitCount: [
      ...report.evidence.latency.wikiIndexWarmupSamples,
      ...report.evidence.latency.wikiIndexSamples,
    ].filter(sample => sample.cacheState !== 'cold-build').length,
    returnedIds,
    firstRunResultCount: firstRunResults.length,
  };
}

function aggregateMismatchPaths(actual, expected, path = '$') {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Number.isFinite(actual)
      && Number.isFinite(expected)
      && Math.abs(actual - expected) <= 1e-12
      ? []
      : [path];
  }
  if (Array.isArray(actual) || Array.isArray(expected)
      || !actual || typeof actual !== 'object'
      || !expected || typeof expected !== 'object') {
    return Object.is(actual, expected) ? [] : [path];
  }
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (!sameJson(actualKeys, expectedKeys)) return [path];
  return actualKeys.flatMap(key => aggregateMismatchPaths(
    actual[key],
    expected[key],
    `${path}.${key}`,
  ));
}

export function assertReportedAggregatesMatch(actual, expected) {
  const mismatches = aggregateMismatchPaths(actual, expected);
  if (mismatches.length > 0) {
    fail('BUILT_REPORTED_MISMATCH', 'child aggregates do not match parent raw recomputation', {
      mismatches,
      actual,
      expected,
    });
  }
  return expected;
}

function assertProtectedWorkspaceState(report, before, after) {
  const beforeProjection = protectedStateProjection(before);
  const rawMatchesParent = sameJson(report.protectedState.before, beforeProjection)
    && sameJson(report.protectedState.after, beforeProjection);
  const durableIdentity = snapshot => Object.fromEntries(
    Object.entries(snapshot).map(([path, identity]) => [
      path,
      {
        dev: identity.dev,
        ino: identity.ino,
        size: identity.size,
        sha256: identity.sha256,
      },
    ]),
  );
  const parentUnchanged = sameJson(
    durableIdentity(before),
    durableIdentity(after),
  );
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap(path => {
      if (!Object.hasOwn(before, path)) return [{ path, fields: ['created'] }];
      if (!Object.hasOwn(after, path)) return [{ path, fields: ['removed'] }];
      const fields = ['dev', 'ino', 'size', 'sha256']
        .filter(field => before[path][field] !== after[path][field]);
      return fields.length === 0 ? [] : [{ path, fields }];
    });
  const mtimeOnlyChanges = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(path => (
      Object.hasOwn(before, path)
      && Object.hasOwn(after, path)
      && before[path].mtimeMs !== after[path].mtimeMs
      && ['dev', 'ino', 'size', 'sha256']
        .every(field => before[path][field] === after[path][field])
    ));
  return {
    rawMatchesParent,
    parentUnchanged,
    pass: parentUnchanged,
    changed,
    mtimeOnlyChanges,
  };
}

function measurePreparedLatency(prepared, query) {
  for (let index = 0; index < 20; index += 1) rankPrepared(query, prepared, 20);
  const samples = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    rankPrepared(query, prepared, 20);
    samples.push(performance.now() - started);
  }
  return {
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
  };
}

function measureWikiLatency(prepared, query) {
  const indexStarted = performance.now();
  const inverted = new Map();
  for (const item of prepared) {
    for (const token of new Set([
      ...item.title,
      ...item.summary,
      ...item.tags,
      ...item.body,
    ])) {
      const ids = inverted.get(token) ?? [];
      ids.push(item.document.id);
      inverted.set(token, ids);
    }
  }
  const indexMs = performance.now() - indexStarted;
  const terms = tokenize(query);
  const search = () => {
    const scores = new Map();
    for (const term of terms) {
      for (const id of inverted.get(term) ?? []) scores.set(id, (scores.get(id) ?? 0) + 1);
    }
    return [...scores].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  };
  for (let index = 0; index < 20; index += 1) search();
  const samples = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    search();
    samples.push(performance.now() - started);
  }
  return { indexMs, queryP95Ms: percentile(samples, 0.95) };
}

function scanQuerySpecialCases(queryFixtures, productionArtifacts) {
  const queries = new Set();
  const collect = value => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if (typeof value.query === 'string' && value.query.trim()) queries.add(value.query);
    for (const nested of Object.values(value)) collect(nested);
  };
  for (const fixture of queryFixtures) collect(fixture);

  let hits = 0;
  const branchPatterns = [
    /\b(?:isPiQuery|piBoost|boostPi)\b/g,
    /\bif\s*\([^\r\n]*(?:\bpi\b|['"`]pi['"`])[^\r\n]*\)/gi,
  ];
  for (const artifact of productionArtifacts) {
    const source = artifact.buffer.toString('utf8');
    const literals = [...source.matchAll(/(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g)]
      .map(match => match[2].replace(/\\(['"`\\])/g, '$1'));
    for (const query of queries) hits += literals.filter(literal => literal === query).length;
    for (const pattern of branchPatterns) {
      pattern.lastIndex = 0;
      hits += [...source.matchAll(pattern)].length;
    }
  }
  return hits;
}

function resultIds(body) {
  if (!body || !Array.isArray(body.results)) {
    fail('INVALID_SEARCH_ENVELOPE', 'search --json response must contain a results array');
  }
  return body.results.map(result => result.id).filter(id => typeof id === 'string');
}

function validateHistoryEnvelope(body, legacyId, canonicalId) {
  if (body?.schema_version !== 'knowhow-history-result/1.0'
      || body.operation !== 'history'
      || !Array.isArray(body.entries)
      || body.entries.length !== 2
      || body.entries[0]?.id !== legacyId
      || body.entries[0]?.deprecated !== true
      || body.entries[1]?.id !== canonicalId
      || body.entries[1]?.current !== true) {
    fail('INVALID_HISTORY_ENVELOPE', 'built knowhow history does not expose the sealed two-node chain', body);
  }
}

export function assertMachineVerdict(verdict) {
  const piCountsValid = Number.isInteger(verdict.piPrimaryCount)
    && verdict.piPrimaryCount >= LIMITS.piPrimaryCount
    && Number.isInteger(verdict.piHoldoutCount)
    && verdict.piHoldoutCount >= LIMITS.piHoldoutCount;
  const piDenominatorValid = Number.isInteger(verdict.piRelevantCount)
    && verdict.piRelevantCount > 0;
  const piNumeratorValid = Number.isInteger(verdict.piRecalledAt20)
    && verdict.piRecalledAt20 >= 0
    && piDenominatorValid
    && verdict.piRecalledAt20 <= verdict.piRelevantCount;
  const piRecallValid = Number.isFinite(verdict.piRecallAt20)
    && piNumeratorValid
    && Math.abs(
      verdict.piRecallAt20 - (verdict.piRecalledAt20 / verdict.piRelevantCount)
    ) <= 1e-12
    && verdict.piRecallAt20 >= LIMITS.piRecallAt20;
  const checks = [
    ['qrelsSha256Match', verdict.qrelsSha256Match === true],
    ['queryCoverage', verdict.queryCoverage === true],
    ['expectedCountsMatch', verdict.expectedCountsMatch === true],
    ['legacyRankGoldenMatch', verdict.legacyRankGoldenMatch === true],
    ['exactMrrAt10', verdict.exactMrrAt10 >= LIMITS.exactMrrAt10],
    ['overallNdcgGain', verdict.overallNdcgGain >= LIMITS.overallNdcgGain],
    ['maxCategoryNdcgDrop', verdict.maxCategoryNdcgDrop <= LIMITS.maxCategoryNdcgDrop],
    ['knowledgeRecallAt20', verdict.knowledgeRecallAt20 >= LIMITS.knowledgeRecallAt20],
    ['piPrimaryCount', piCountsValid],
    ['piHoldoutCount', piCountsValid],
    ['piRelevantCount', piDenominatorValid],
    ['piRecalledAt20', piNumeratorValid],
    ['piRecallAt20', piRecallValid],
    ['piPrimaryTop5Pass', verdict.piPrimaryTop5Pass === true],
    ['piHoldoutTop5Pass', verdict.piHoldoutTop5Pass === true],
    ['deprecatedLeakCount', verdict.deprecatedLeakCount === 0],
    ['unauthorizedWorkspaceHitCount', verdict.unauthorizedWorkspaceHitCount === 0],
    ['provenanceLossCount', verdict.provenanceLossCount === 0],
    ['attachOrMergeCalls', verdict.attachOrMergeCalls === 0],
    ['holdoutOverlapCount', verdict.holdoutOverlapCount === 0],
    ...Object.keys(BUILT_SIDE_EFFECT_EVENTS).map(
      counter => [counter, verdict[counter] === 0],
    ),
    ['stableTop20', verdict.stableTop20 === true],
    ['kgWarmP95Ms', verdict.kgWarmP95Ms < LIMITS.kgWarmP95Ms],
    ['kgWarmMaxMs', verdict.kgWarmMaxMs < LIMITS.kgWarmMaxMs],
    ['wikiQueryP95Ms', verdict.wikiQueryP95Ms < LIMITS.wikiQueryP95Ms],
    ['wikiIndexP95Ms', verdict.wikiIndexP95Ms < LIMITS.wikiIndexP95Ms],
    ['wikiIndexCacheHitCount', verdict.wikiIndexCacheHitCount === 0],
    ['protectedStateUnchanged', verdict.protectedStateUnchanged === true],
    ['querySpecialCaseHits', verdict.querySpecialCaseHits === 0],
  ];
  const failed = checks.filter(([, pass]) => !pass).map(([metric]) => metric);
  if (failed.length > 0) {
    fail('HARD_THRESHOLD_FAILED', `search ranking hard threshold failed: ${failed.join(', ')}`, {
      failed,
      verdict,
      limits: LIMITS,
    });
  }
  return verdict;
}

export async function runBuiltPhase({
  spawn = spawnSync,
  attestedSpawn = runCertifiedAttestedChild,
  attestation,
  adapterPath,
  artifactRoot = repoRoot,
  directControlGraph,
  piFixture,
  holdoutsFixture,
  certificateContext,
} = {}) {
  const controlGraph = directControlGraph
    ?? deriveSearchRankingDirectControlGraph({ phase: 'full' });
  const certifiedArtifactPaths = controlGraph.expected_paths;
  if (controlGraph.derived_count !== certifiedArtifactPaths.length
      || new Set(certifiedArtifactPaths).size !== certifiedArtifactPaths.length
      || JSON.stringify(certifiedArtifactPaths) !== JSON.stringify([...certifiedArtifactPaths].sort())) {
    fail('INVALID_DIRECT_CONTROL_GRAPH', 'direct-control graph file set is not sorted and unique');
  }
  const ownedCertificateContext = certificateContext
    ? null
    : createDerivedControlCertificate({
        root: artifactRoot,
        deriveGraph: phase => (
          phase === 'full'
            ? controlGraph
            : deriveSearchRankingDirectControlGraph({ phase: 'source' })
        ),
      });
  const activeCertificateContext = certificateContext ?? ownedCertificateContext;
  if (!activeCertificateContext.full) activeCertificateContext.captureFull();
  if (activeCertificateContext.full.graph !== controlGraph
      && graphHash(activeCertificateContext.full.graph) !== graphHash(controlGraph)) {
    fail('FULL_PHASE_GRAPH_MISMATCH', 'built phase graph differs from retained full certificate');
  }
  try {
  const initialCertificatesByPath = new Map(certifiedArtifactPaths.map(relativePath => {
    const handle = activeCertificateContext.getHandle(relativePath);
    if (!handle?.initial) {
      fail('CERTIFICATE_HANDLE_MISSING', `built retained handle is missing: ${relativePath}`);
    }
    return [relativePath, handle.initial];
  }));
  const readCertifiedArtifact = relativePath => {
    const artifact = initialCertificatesByPath.get(relativePath);
    if (!artifact) {
      fail('CERTIFICATE_HANDLE_MISSING', `built artifact is outside retained handles: ${relativePath}`);
    }
    return artifact;
  };
  const holdoutsArtifact = readCertifiedArtifact(
    'src/search/evaluation/fixtures/search-ranking-holdouts.json',
  );
  const piArtifact = readCertifiedArtifact(
    'src/search/evaluation/fixtures/pi-knowledge-absolute.json',
  );
  const holdouts = holdoutsFixture ?? parseArtifactJson(holdoutsArtifact);
  const pi = piFixture ?? parseArtifactJson(piArtifact);
  const piContract = validatePiReleaseContract(pi, holdouts);

  const binArtifact = initialCertificatesByPath.get('bin/maestro.js');
  const cliArtifact = initialCertificatesByPath.get('dist/src/cli.js');
  if (!binArtifact.buffer.includes(Buffer.from("../dist/src/cli.js"))
      || cliArtifact.buffer.length === 0) {
    fail('INVALID_BUILT_BIN', 'bin/maestro.js must load the built dist/src/cli.js artifact');
  }

  const qrelsArtifact = initialCertificatesByPath.get(
    'src/search/evaluation/fixtures/search-ranking-qrels.json',
  );
  const baselineArtifact = initialCertificatesByPath.get(
    'src/search/evaluation/fixtures/search-ranking-baseline.json',
  );
  const corpusArtifact = initialCertificatesByPath.get(
    'src/search/evaluation/fixtures/search-ranking-corpus.json',
  );
  const schemaArtifact = initialCertificatesByPath.get(
    'src/search/evaluation/built-search-adapter-contract.json',
  );
  if (!schemaArtifact || schemaArtifact.sha256 !== SCHEMA_SHA256) {
    fail('BUILT_ADAPTER_SCHEMA_MISMATCH', 'retained schema Buffer hash is not exact', {
      expected: SCHEMA_SHA256,
      actual: schemaArtifact?.sha256 ?? null,
    });
  }
  const qrels = parseArtifactJson(qrelsArtifact);
  const baseline = parseArtifactJson(baselineArtifact);
  const corpus = parseArtifactJson(corpusArtifact);
  validateParentRankingFixtures({ qrels, baseline, corpus, holdouts });
  if (qrelsArtifact.sha256 !== baseline.qrelsSha256) {
    fail('QRELS_HASH_MISMATCH', 'revalidated qrels bytes do not match the frozen baseline fence', {
      expected: baseline.qrelsSha256,
      actual: qrelsArtifact.sha256,
    });
  }
  const protectedRepoArtifacts = [
    readArtifact('src/search/evaluation/fixtures/pi-knowledge-legacy-before.md'),
    readArtifact('src/search/evaluation/fixtures/pi-knowledge-legacy-superseded.md'),
    readArtifact('src/search/evaluation/fixtures/pi-knowledge-canonical.md'),
  ];
  const certifiedAdapterPath = resolve(
    artifactRoot,
    'dist/src/search/evaluation/built-search-adapter.js',
  );
  const effectiveAdapterPath = adapterPath ?? certifiedAdapterPath;
  if (resolve(effectiveAdapterPath) !== certifiedAdapterPath) {
    fail('BUILT_ADAPTER_CERTIFICATE_MISMATCH', 'built adapter path must match its certificate', {
      expected: certifiedAdapterPath,
      actual: resolve(effectiveAdapterPath),
    });
  }
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'maestro-search-ranking-built-'));
  try {
    seedBuiltWorkspace(workspaceRoot);
    const initialExpected = deriveBuiltSearchAdapterExpected({
      workspaceRoot,
      qrels,
      corpus,
      qrelsSha256: qrelsArtifact.sha256,
    });
    const adapter = await runBuiltAdapterChild({
      attestedSpawn,
      attestation,
      workspaceRoot,
      adapterPath: effectiveAdapterPath,
      artifactRoot,
      expected: initialExpected,
      certifiedArtifactsByPath: initialCertificatesByPath,
      schemaSha256: schemaArtifact.sha256,
    });
    const protectedBefore = snapshotWorkspaceState(workspaceRoot);
    const history = runBinChild(
      'built-bin:knowhow-history',
      ['knowhow', 'history', pi.legacyId, '--json'],
      { spawn, cwd: workspaceRoot, projectRoot: workspaceRoot },
    );
    validateHistoryEnvelope(history.body, pi.legacyId, pi.canonicalId);

    const readOnlyArgs = ['--read-only-probe'];
    const piPrimary = piContract.primaryQueries.map(query => ({
      query,
      child: runBinChild(
        `built-bin:pi-primary:${query.id}`,
        [
          'search', query.query, '--wiki-only', '--no-emb',
          '--limit', String(piContract.thresholds.recallAt), '--json', ...readOnlyArgs,
        ],
        { spawn, cwd: workspaceRoot, projectRoot: workspaceRoot },
      ),
    }));
    const piHoldouts = piContract.holdoutQueries
      .map(query => ({
        query,
        child: runBinChild(
          `built-bin:pi-holdout:${query.id}`,
          [
            'search', query.query, '--wiki-only', '--no-emb',
            '--limit', String(piContract.thresholds.recallAt), '--json', ...readOnlyArgs,
          ],
          { spawn, cwd: workspaceRoot, projectRoot: workspaceRoot },
        ),
      }));
    const piRows = [...piPrimary, ...piHoldouts];
    let deprecatedLeakCount = 0;
    let piRelevantCount = 0;
    let piRecalledAt20 = 0;
    for (const row of piRows) {
      const ids = resultIds(row.child.body);
      deprecatedLeakCount += ids.filter(id => id === pi.legacyId).length;
      for (const targetId of row.query.targetIds) {
        piRelevantCount += 1;
        if (ids.slice(0, piContract.thresholds.recallAt).includes(targetId)) {
          piRecalledAt20 += 1;
        }
      }
      for (const result of row.child.body.results) {
        if (result.source !== 'wiki') {
          fail('INVALID_SEARCH_PROVENANCE', 'Pi built-bin smoke must attribute every result to wiki', {
            query: row.query.id,
            result,
          });
        }
      }
    }
    const protectedAfter = snapshotWorkspaceState(workspaceRoot);

    try {
      revalidateCertifiedArtifacts(protectedRepoArtifacts);
    } catch (error) {
      fail(
        'REAL_WORKFLOW_MUTATED',
        'built probes changed protected real repository workflow files',
        {
          cause: error instanceof Error ? error.message : String(error),
          details: error instanceof ReleaseMachineError ? error.details : null,
        },
      );
    }

    const finalCertificate = activeCertificateContext.captureFinal();
    const revalidatedArtifacts = finalCertificate.artifacts;
    const revalidatedByPath = new Map(
      revalidatedArtifacts.map(artifact => [artifact.relativePath, artifact]),
    );
    const revalidatedQrelsArtifact = revalidatedByPath.get(
      'src/search/evaluation/fixtures/search-ranking-qrels.json',
    );
    const revalidatedBaselineArtifact = revalidatedByPath.get(
      'src/search/evaluation/fixtures/search-ranking-baseline.json',
    );
    const revalidatedCorpusArtifact = revalidatedByPath.get(
      'src/search/evaluation/fixtures/search-ranking-corpus.json',
    );
    const revalidatedHoldoutsArtifact = revalidatedByPath.get(
      'src/search/evaluation/fixtures/search-ranking-holdouts.json',
    );
    const revalidatedQrels = parseArtifactJson(revalidatedQrelsArtifact);
    const revalidatedBaseline = parseArtifactJson(revalidatedBaselineArtifact);
    const revalidatedCorpus = parseArtifactJson(revalidatedCorpusArtifact);
    const revalidatedHoldouts = parseArtifactJson(revalidatedHoldoutsArtifact);
    validateParentRankingFixtures({
      qrels: revalidatedQrels,
      baseline: revalidatedBaseline,
      corpus: revalidatedCorpus,
      holdouts: revalidatedHoldouts,
    });
    if (revalidatedQrelsArtifact.sha256 !== revalidatedBaseline.qrelsSha256) {
      fail('QRELS_HASH_MISMATCH', 'revalidated qrels bytes do not match the frozen baseline fence', {
        expected: revalidatedBaseline.qrelsSha256,
        actual: revalidatedQrelsArtifact.sha256,
      });
    }
    const revalidatedExpected = deriveBuiltSearchAdapterExpected({
      workspaceRoot,
      qrels: revalidatedQrels,
      corpus: revalidatedCorpus,
      qrelsSha256: revalidatedQrelsArtifact.sha256,
    });
    if (!sameJson(initialExpected, revalidatedExpected)) {
      fail('BUILT_ADAPTER_EXPECTED_DRIFT', 'parent-derived adapter Expected changed after children', {
        initial: initialExpected,
        revalidated: revalidatedExpected,
      });
    }
    const built = parseBuiltAdapterContract(adapter.rawBody, revalidatedExpected);
    const recomputed = recomputeBuiltAggregates(built, {
      qrels: revalidatedQrels,
      baseline: revalidatedBaseline,
      corpus: revalidatedCorpus,
      holdouts: revalidatedHoldouts,
    });
    assertReportedAggregatesMatch(built.reported, recomputed.reported);
    const protectedState = assertProtectedWorkspaceState(
      built,
      protectedBefore,
      protectedAfter,
    );
    if (!protectedState.pass) {
      fail(
        'PROTECTED_STATE_CHANGED',
        'parent workspace identity or SHA changed across built read-only probes',
        protectedState,
      );
    }
    const verdict = {
      qrelsSha256Match: built.qrelsSha256 === revalidatedQrelsArtifact.sha256
        && revalidatedBaseline.qrelsSha256 === revalidatedQrelsArtifact.sha256,
      queryCoverage: recomputed.queryCoverage,
      expectedCountsMatch: recomputed.expectedCountsMatch,
      legacyRankGoldenMatch: baselineGoldenMatches(
        revalidatedQrels,
        revalidatedBaseline,
      ),
      exactMrrAt10: recomputed.metrics.categories['exact-symbol'].mrrAt10,
      overallNdcgGain: recomputed.overallNdcgGain,
      maxCategoryNdcgDrop: recomputed.maxCategoryNdcgDrop,
      knowledgeRecallAt20: recomputed.metrics.categories.knowledge.recallAt20,
      piPrimaryCount: piPrimary.length,
      piHoldoutCount: piHoldouts.length,
      piRelevantCount,
      piRecalledAt20,
      piRecallAt20: piRecalledAt20 / piRelevantCount,
      piPrimaryTop5Pass: piPrimary.every(row => row.query.targetIds.every(
        id => resultIds(row.child.body)
          .slice(0, piContract.thresholds.topK)
          .includes(id),
      )),
      piHoldoutTop5Pass: piHoldouts.every(row => row.query.targetIds.every(
        id => resultIds(row.child.body)
          .slice(0, piContract.thresholds.topK)
          .includes(id),
      )),
      deprecatedLeakCount: deprecatedLeakCount + recomputed.integrity.deprecatedLeakCount,
      unauthorizedWorkspaceHitCount: recomputed.integrity.unauthorizedWorkspaceHitCount,
      provenanceLossCount: recomputed.integrity.provenanceLossCount,
      attachOrMergeCalls: recomputed.integrity.attachOrMergeCalls,
      holdoutOverlapCount: recomputed.holdoutOverlapCount,
      ...recomputed.sideEffects,
      stableTop20: recomputed.stableTop20,
      kgWarmP95Ms: recomputed.latency.kgWarmP95Ms,
      kgWarmMaxMs: recomputed.latency.kgWarmMaxMs,
      wikiQueryP95Ms: recomputed.latency.wikiQueryP95Ms,
      wikiIndexP95Ms: recomputed.latency.wikiIndexP95Ms,
      wikiIndexCacheHitCount: recomputed.wikiIndexCacheHitCount,
      protectedStateUnchanged: protectedState.pass,
      querySpecialCaseHits: scanQuerySpecialCases(
        [revalidatedQrels, revalidatedHoldouts, pi],
        PRODUCTION_ARTIFACTS.map(path => revalidatedByPath.get(path)),
      ),
    };
    assertMachineVerdict(verdict);
    return {
      phase: 'built-bin',
      verdict,
      adapter: built,
      artifactHashes: Object.fromEntries(
        revalidatedArtifacts.map(artifact => [artifact.relativePath, artifact.sha256]),
      ),
      directControlDerivedCount: controlGraph.derived_count,
      certificate: finalCertificate.certificate,
      trace: [
        adapter.trace,
        history.trace,
        ...piPrimary.map(row => row.child.trace),
        ...piHoldouts.map(row => row.child.trace),
      ],
    };
  } finally {
    removeWorkspaceWithRetry(workspaceRoot);
  }
  } finally {
    ownedCertificateContext?.close();
  }
}

/**
 * Windows keeps a handle on a directory while a child that used it as its
 * cwd is still winding down; a single rmSync then fails with EBUSY and
 * masks the real gate verdict. Retry with a short backoff so a transient
 * handle release does not turn a passing phase into a cleanup failure.
 */
function removeWorkspaceWithRetry(root, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const busy = typeof error === 'object' && error !== null
        && (error.code === 'EBUSY' || error.code === 'EPERM');
      if (!busy) throw error;
      const delay = 200 * attempt;
      const until = Date.now() + delay;
      while (Date.now() < until) { /* synchronous backoff */ }
    }
  }
}

export function validatePackageWiring(packageJson) {
  const expectedScripts = {
    'check:search-ranking-release-machine':
      'node scripts/check-search-ranking-release-machine.mjs',
    'check:search-ranking-release-machine:source':
      'node scripts/check-search-ranking-release-machine.mjs --source-only',
    'check:search-ranking-release-machine:built':
      'node scripts/check-search-ranking-release-machine.mjs --built',
  };
  for (const [name, expected] of Object.entries(expectedScripts)) {
    if (packageJson?.scripts?.[name] !== expected) {
      fail('PACKAGE_SCRIPT_MISMATCH', `${name} must be wired to the exact release-machine command`, {
        expected,
        actual: packageJson?.scripts?.[name] ?? null,
      });
    }
  }

  const steps = String(packageJson?.scripts?.prepublishOnly ?? '')
    .split('&&')
    .map(step => step.trim())
    .filter(Boolean);
  const source = 'npm run check:search-ranking-release-machine:source';
  const build = 'npm run build';
  const built = 'npm run check:search-ranking-release-machine:built';
  const standalone = 'npm run check:search-ranking-release-machine';
  const count = step => steps.filter(item => item === step).length;
  const indexes = [steps.indexOf(source), steps.indexOf(build), steps.indexOf(built)];
  if (count(source) !== 1
      || count(build) !== 1
      || count(built) !== 1
      || count(standalone) !== 0
      || indexes.some(index => index < 0)
      || !(indexes[0] < indexes[1] && indexes[1] < indexes[2])) {
    fail('PREPUBLISH_ORDER_MISMATCH', 'prepublish search segment must be source -> unique build -> built', {
      steps,
      counts: {
        source: count(source),
        build: count(build),
        built: count(built),
        standalone: count(standalone),
      },
      indexes,
    });
  }
  return { steps, indexes, counts: { source: 1, build: 1, built: 1 } };
}

export function parseArguments(argv) {
  let mode = 'standalone';
  let npmCliOverride;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-only') {
      if (mode !== 'standalone') fail('INVALID_ARGUMENTS', 'release-machine modes are mutually exclusive');
      mode = 'source';
    } else if (arg === '--built') {
      if (mode !== 'standalone') fail('INVALID_ARGUMENTS', 'release-machine modes are mutually exclusive');
      mode = 'built';
    } else if (arg === '--npm-cli') {
      npmCliOverride = argv[index + 1];
      index += 1;
      if (!npmCliOverride) fail('INVALID_ARGUMENTS', '--npm-cli requires an absolute existing path');
    } else {
      fail('INVALID_ARGUMENTS', `unknown argument: ${arg}`);
    }
  }
  if (mode !== 'standalone' && npmCliOverride !== undefined) {
    fail('INVALID_ARGUMENTS', '--npm-cli is allowed only for direct standalone execution');
  }
  return { mode, npmCliOverride };
}

export function assertPhaseSequence(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('PHASE_ORDER_MISMATCH', 'release-machine phase sequence is missing, duplicated, or out of order', {
      expected,
      actual,
    });
  }
  return actual;
}

export async function runPhases(mode, handlers) {
  const expected = MODE_PHASES[mode];
  if (!expected) fail('INVALID_MODE', `unknown release-machine mode: ${mode}`);
  const results = [];
  for (const phase of expected) {
    const handler = handlers[phase];
    if (typeof handler !== 'function') fail('MISSING_PHASE', `missing phase handler: ${phase}`);
    const result = await handler();
    results.push({ phase, result });
  }
  const actual = results.map(result => result.phase);
  assertPhaseSequence(actual, expected);
  return results;
}

export async function runReleaseMachine({
  mode = 'standalone',
  npmCliOverride,
  spawn = spawnSync,
  root = repoRoot,
  deriveGraph = phase => deriveSearchRankingDirectControlGraph({ phase }),
  protocolProbe,
} = {}) {
  const certificateContext = createDerivedControlCertificate({
    root,
    deriveGraph,
  });
  let nativeCertificate;
  let sourceOnlyFinal;
  try {
    if (mode === 'standalone' || mode === 'source') {
      certificateContext.captureSource();
    } else if (mode === 'built') {
      certificateContext.captureFull();
    } else {
      fail('INVALID_MODE', `unknown release-machine mode: ${mode}`);
    }
    const initialPackageHandle = certificateContext.getHandle('package.json');
    if (!initialPackageHandle?.initial) {
      fail('CERTIFICATE_HANDLE_MISSING', 'package.json is absent from the derived certificate');
    }
    validatePackageWiring(parseArtifactJson(initialPackageHandle.initial));

    const phases = await runPhases(mode, {
      'source-tests': () => runSourcePhase({
        npmCliOverride,
        spawn: spawn === spawnSync ? spawnChild : spawn,
      }),
      build: () => runBuildPhase({ npmCliOverride, spawn }),
      'built-bin': async () => {
        if (!certificateContext.full) certificateContext.captureFull();
        nativeCertificate = certifyNativeControls({
          graph: certificateContext.full.graph,
          getHandle: path => certificateContext.getHandle(path),
          protocolProbe: protocolProbe
            ?? (() => runNativeLifecycleProtocolProbe({ root })),
        });
        return runBuiltPhase({
          spawn,
          artifactRoot: root,
          directControlGraph: certificateContext.full.graph,
          certificateContext,
        });
      },
    });
    if (mode === 'source') sourceOnlyFinal = certificateContext.rehashSource();
    const counts = {
      source: phases.filter(item => item.phase === 'source-tests').length,
      build: phases.filter(item => item.phase === 'build').length,
      built: phases.filter(item => item.phase === 'built-bin').length,
    };
    const expectedCounts = mode === 'standalone'
      ? { source: 1, build: 1, built: 1 }
      : mode === 'source'
        ? { source: 1, build: 0, built: 0 }
        : { source: 0, build: 0, built: 1 };
    if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
      fail('PHASE_COUNT_MISMATCH', 'release-machine phase counts differ from mode contract', {
        mode,
        expected: expectedCounts,
        actual: counts,
      });
    }
    const finalArtifacts = certificateContext.final?.artifacts
      ?? sourceOnlyFinal?.artifacts;
    const finalPackageArtifact = finalArtifacts?.find(
      artifact => artifact.relativePath === 'package.json',
    );
    if (!finalPackageArtifact) {
      fail('CERTIFICATE_HANDLE_MISSING', 'final same-handle package.json Buffer is missing');
    }
    const packageWiring = validatePackageWiring(parseArtifactJson(finalPackageArtifact));
    const certificate = certificateContext.result();
    if (nativeCertificate) certificate.native = nativeCertificate;
    certificate.package_wiring = {
      phase_id: certificateContext.final ? 'final' : 'source',
      relative_path: finalPackageArtifact.relativePath,
      sha256: finalPackageArtifact.sha256,
      same_handle: true,
    };
    return {
      schema_version: 'search-ranking-release-machine/1.0',
      ok: true,
      mode,
      counts,
      phases: phases.map(item => item.result),
      certificate,
      packageWiring,
      packageSha256: finalPackageArtifact.sha256,
    };
  } finally {
    certificateContext.close();
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runReleaseMachine(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const failure = error instanceof ReleaseMachineError
      ? error.toJSON()
      : {
          schema_version: 'search-ranking-release-failure/1.0',
          ok: false,
          code: 'UNEXPECTED_RELEASE_MACHINE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
