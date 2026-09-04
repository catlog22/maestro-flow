import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  SCHEMA_SHA256,
  SEARCH_MEASUREMENT_LANES,
  makeBuiltSearchAdapterFixture,
  parseBuiltSearchAdapterExpected,
  parseBuiltSearchAdapterReport,
} from '../../shared/built-search-adapter-contract.mjs';
import {
  ATTESTATION_ENV_ALLOWLIST,
  ATTESTATION_MANIFEST_TYPE,
  ATTESTATION_STDIO,
  ATTESTATION_TRANSCRIPT_TYPE,
  assertCertifiedAttestationRuntime,
  authenticateAttestationTranscript,
  canonicalJsonBuffer,
  createAttestationManifest,
  decodeAttestationFrame,
  deriveProbeModuleAttestation,
  encodeAttestationFrame,
  extractCertifiedBootstrapBuffer,
  loadProbeDynamicEdgeManifest,
  ModuleAttestationError,
  READ_ONLY_FORBIDDEN_GUARDS,
  runCertifiedAttestedChild,
  sanitizeAttestationEnvironment,
  verifyAttestationTranscript,
} from '../search-ranking-module-attestation.mjs';
import {
  deriveSearchRankingDirectControlGraph,
  parseDirectControlRoots,
  parseShellScript,
} from '../search-ranking-direct-control-graph.mjs';
import {
  assertPhaseSequence,
  assertMachineVerdict,
  assertReportedAggregatesMatch,
  builtSearchAdapterPath,
  certifyNativeControls,
  createDerivedControlCertificate,
  dashboardRoot,
  DASHBOARD_TEST_PATHS,
  deriveCertifiedArtifactPaths,
  deriveBuiltSearchAdapterExpected,
  expandedCorpusSha256,
  openRetainedArtifactHandle,
  parseArguments,
  parseArtifactJson,
  parseBuiltAdapterContract,
  parseVitestReport,
  PRODUCTION_ARTIFACTS,
  readArtifact,
  recomputeBuiltAggregates,
  revalidateCertifiedArtifacts,
  repoRoot,
  resolveNpmInvocation,
  ROOT_TEST_PATHS,
  runNativeLifecycleProtocolProbe,
  runNpmChild,
  runBuiltAdapterChild,
  runBuiltPhase,
  runPhases,
  runSourcePhase,
  snapshotWorkspaceState,
  validatePiReleaseContract,
  validatePackageWiring,
} from '../check-search-ranking-release-machine.mjs';

const temporaryRoots = [];
const originalNpmExecPath = process.env.npm_execpath;
const validPiFixture = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', 'pi-knowledge-absolute.json'),
  'utf8',
));
const validHoldoutsFixture = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', 'search-ranking-holdouts.json'),
  'utf8',
));
const validBaselineFixture = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', 'search-ranking-baseline.json'),
  'utf8',
));
const validQrelsFixture = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', 'search-ranking-qrels.json'),
  'utf8',
));
const validCorpusFixture = JSON.parse(readFileSync(
  join(repoRoot, 'src', 'search', 'evaluation', 'fixtures', 'search-ranking-corpus.json'),
  'utf8',
));
const certifiedAdapterRelativePath =
  'dist/src/search/evaluation/built-search-adapter.js';
const certifiedArtifactPaths = deriveCertifiedArtifactPaths();
function temporaryRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `search-release-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function createCertifiedArtifactRoot(label) {
  const root = temporaryRoot(label);
  for (const relativePath of certifiedArtifactPaths) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    if (relativePath.startsWith('src/search/evaluation/fixtures/')
        || relativePath === 'src/search/evaluation/built-search-adapter-contract.json') {
      copyFileSync(join(repoRoot, relativePath), target);
    } else if (relativePath === 'bin/maestro.js') {
      writeFileSync(target, 'await import("../dist/src/cli.js");\n');
    } else {
      writeFileSync(target, `export const artifact = ${JSON.stringify(relativePath)};\n`);
    }
  }
  return root;
}

function certificateFixtureGraph({
  phase,
  sourcePaths,
  generatedPaths = [],
  nativeArtifacts = [],
  manifestPath,
  provenancePath,
  receiptHashes = [],
  extraEdges = [],
}) {
  const inlineNodes = [0, 1, 2].map(index => ({
    id: `virtual:build-inline:${index}`,
    kind: 'node-inline-program',
    owner: 'package.json#scripts.build',
    sha256: String(index + 1).repeat(64),
    byte_length: 1,
  }));
  const nativePaths = nativeArtifacts.map(artifact => artifact.path);
  const expectedPaths = [
    ...sourcePaths,
    ...(phase === 'full' ? [...generatedPaths, ...nativePaths] : []),
  ].sort();
  const edges = [
    {
      class: 'package-script-token',
      from: 'package.json#scripts.build',
      to: 'external:node_modules/.bin/tsc',
      provenance: { package: 'typescript' },
    },
    ...inlineNodes.flatMap(node => [
      {
        class: 'package-script-token',
        from: node.owner,
        to: node.id,
        provenance: { command: 'node -e' },
      },
      {
        class: 'generated-output-source',
        from: node.id,
        to: sourcePaths[0],
        provenance: { role: 'source' },
      },
    ]),
    ...generatedPaths.map(path => ({
      class: 'generated-output-source',
      from: sourcePaths[0],
      to: path,
      provenance: { role: 'output', ...(phase === 'source' ? { phase: 'full' } : {}) },
    })),
    ...(manifestPath ? [{
      class: 'native-manifest',
      from: 'virtual:direct-control-root',
      to: manifestPath,
      provenance: { role: 'native-manifest' },
    }] : []),
    ...(manifestPath && provenancePath ? [{
      class: 'native-manifest',
      from: manifestPath,
      to: provenancePath,
      provenance: { role: 'native-provenance' },
    }] : []),
    ...nativeArtifacts.map(artifact => ({
      class: 'native-manifest',
      from: manifestPath,
      to: artifact.path,
      provenance: {
        target: artifact.target,
        sha256: artifact.sha256,
        protocol: artifact.protocol,
        ...(phase === 'source' ? { phase: 'full' } : {}),
      },
    })),
    ...extraEdges,
  ];
  const receiptNodes = receiptHashes.map(receipt => ({
    id: `virtual:native-job-receipt:${receipt.target}:${receipt.hash}`,
    kind: 'native-job-receipt',
    owner: provenancePath,
    sha256: createHash('sha256').update(receipt.hash).digest('hex'),
    byte_length: receipt.hash.length,
  }));
  return {
    schema_version: 'search-ranking-direct-control-graph/1.0',
    phase,
    roots: {
      package_scripts: ['build'],
      package_bins: ['maestro'],
      entrypoints: ['control.mjs'],
    },
    edge_classes: [
      'package-script-token',
      'generated-output-source',
      'native-manifest',
    ],
    expected_paths: expectedPaths,
    virtual_command_nodes: [...inlineNodes, ...receiptNodes],
    edges,
    exclusions: [],
    derived_count: expectedPaths.length,
  };
}

function createCertificateFixture(label) {
  const root = temporaryRoot(label);
  copyFileSync(join(repoRoot, 'package.json'), join(root, 'package.json'));
  write(join(root, 'control.mjs'), 'export const control = true;\n');
  write(join(root, 'generated.js'), 'export const generated = true;\n');
  const sourcePaths = ['control.mjs', 'package.json'];
  return {
    root,
    sourceGraph: certificateFixtureGraph({
      phase: 'source',
      sourcePaths,
      generatedPaths: ['generated.js'],
    }),
    fullGraph: certificateFixtureGraph({
      phase: 'full',
      sourcePaths,
      generatedPaths: ['generated.js'],
    }),
  };
}

function createNativeCertificateFixture(label, {
  tamperManifestByte = false,
  tamperReceipt = false,
} = {}) {
  const root = temporaryRoot(label);
  copyFileSync(join(repoRoot, 'package.json'), join(root, 'package.json'));
  write(join(root, 'control.mjs'), 'export const control = true;\n');
  write(join(root, 'generated.js'), 'export const generated = true;\n');
  const platforms = [
    ['x86_64-pc-windows-msvc', 'win32', 'x64', 'native/win32-x64.exe'],
    ['x86_64-unknown-linux-gnu', 'linux', 'x64', 'native/linux-x64'],
    ['aarch64-unknown-linux-gnu', 'linux', 'arm64', 'native/linux-arm64'],
    ['x86_64-apple-darwin', 'darwin', 'x64', 'native/darwin-x64'],
    ['aarch64-apple-darwin', 'darwin', 'arm64', 'native/darwin-arm64'],
  ];
  const artifacts = platforms.map(([target, platform, arch, path], index) => {
    const bytes = Buffer.from(`native-${target}`);
    write(join(root, path), bytes);
    return {
      target,
      platform,
      arch,
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      protocol: 'lifecycle-fs-helper/1.0',
      receiptHash: String(index + 1).repeat(64),
    };
  });
  const manifestArtifacts = artifacts.map((artifact, index) => ({
    target: artifact.target,
    platform: artifact.platform,
    arch: artifact.arch,
    path: artifact.path,
    sha256: tamperManifestByte && index === 0
      ? 'f'.repeat(64)
      : artifact.sha256,
    protocol: artifact.protocol,
  }));
  const manifestPath = 'native/manifest.json';
  const provenancePath = 'native/provenance.json';
  write(join(root, manifestPath), JSON.stringify({
    schema_version: 'lifecycle-fs-native-manifest/1.0',
    protocol: 'lifecycle-fs-helper/1.0',
    artifacts: manifestArtifacts,
  }));
  write(join(root, provenancePath), JSON.stringify({
    artifacts: artifacts.map((artifact, index) => ({
      target: artifact.target,
      job_receipt_sha256: tamperReceipt && index === 0
        ? 'e'.repeat(64)
        : artifact.receiptHash,
      binary_sha256: artifact.sha256,
    })),
  }));
  const sourcePaths = [
    'control.mjs',
    'package.json',
    manifestPath,
    provenancePath,
  ];
  const graphOptions = {
    sourcePaths,
    generatedPaths: ['generated.js'],
    nativeArtifacts: manifestArtifacts,
    manifestPath,
    provenancePath,
    receiptHashes: artifacts.map(artifact => ({
      target: artifact.target,
      hash: artifact.receiptHash,
    })),
  };
  return {
    root,
    sourceGraph: certificateFixtureGraph({ phase: 'source', ...graphOptions }),
    fullGraph: certificateFixtureGraph({ phase: 'full', ...graphOptions }),
  };
}

function protectedProjection(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([path, identity]) => [
    path,
    {
      size: identity.size,
      mtimeMs: identity.mtimeMs,
      sha256: identity.sha256,
    },
  ]));
}

function expectedForWorkspace(workspaceRoot) {
  return deriveBuiltSearchAdapterExpected({
    workspaceRoot,
    qrels: validQrelsFixture,
    corpus: validCorpusFixture,
    qrelsSha256: validBaselineFixture.qrelsSha256,
  });
}

function greenFixtureInput(workspaceRoot, reportedOverrides = null) {
  const expected = expectedForWorkspace(workspaceRoot);
  const documentById = new Map(
    validCorpusFixture.documents.map(document => [document.id, document]),
  );
  const qrelsById = new Map(
    validQrelsFixture.queries.map(query => [query.id, query]),
  );
  const queryRuns = Object.fromEntries(expected.queries.map(query => {
    const judgment = qrelsById.get(query.queryId);
    const results = Object.keys(judgment.relevance)
      .slice(0, query.expectedCount)
      .map((id, index) => {
        const document = documentById.get(id);
        return {
          id,
          rank: index + 1,
          score: 1,
          workspace: document.workspace ?? null,
          workspaceFence: query.provider === 'linked' ? 'linked:peer' : null,
          authorized: document.authorized !== false,
          status: document.status === 'deprecated' ? 'deprecated' : 'active',
          provenance: document.provenance ?? null,
        };
      });
    return [
      query.queryId,
      Array.from({ length: 5 }, () => ({
        results: structuredClone(results),
      })),
    ];
  }));
  const protectedState = protectedProjection(snapshotWorkspaceState(workspaceRoot));
  return {
    expected,
    queryRuns,
    events: [],
    kgWarmSamplesMs: Array.from({ length: 100 }, () => 1),
    wikiQuerySamplesMs: Array.from({ length: 100 }, () => 1),
    wikiIndexWarmupSamples: Array.from(
      { length: 20 },
      () => ({ durationMs: 1, cacheState: 'cold-build' }),
    ),
    wikiIndexSamples: Array.from(
      { length: 100 },
      () => ({ durationMs: 1, cacheState: 'cold-build' }),
    ),
    protectedState: {
      before: protectedState,
      after: structuredClone(protectedState),
      unchanged: true,
    },
    reportedOverrides,
  };
}

function greenAdapterBody(workspaceRoot) {
  const input = greenFixtureInput(workspaceRoot);
  const base = makeBuiltSearchAdapterFixture(input);
  const recomputed = recomputeBuiltAggregates(base, {
    qrels: validQrelsFixture,
    baseline: validBaselineFixture,
    corpus: validCorpusFixture,
    holdouts: validHoldoutsFixture,
  });
  return makeBuiltSearchAdapterFixture({
    ...input,
    reportedOverrides: recomputed.reported,
  });
}

function greenBuiltSpawn(adapterPath, onChildComplete) {
  let piChildCount = 0;
  return (_command, args, options) => {
    let stage;
    let body;
    if (args[0] === adapterPath) {
      throw new Error('adapter must use the attested async spawn');
    } else if (args[1] === 'knowhow') {
      stage = 'history';
      body = {
        schema_version: 'knowhow-history-result/1.0',
        operation: 'history',
        entries: [
          { id: validPiFixture.legacyId, deprecated: true },
          { id: validPiFixture.canonicalId, current: true },
        ],
      };
    } else if (args[1] === 'search') {
      piChildCount += 1;
      stage = 'pi';
      body = {
        results: [{
          id: validPiFixture.canonicalId,
          source: 'wiki',
        }],
      };
    } else {
      throw new Error(`unexpected built child: ${JSON.stringify(args)}`);
    }
    onChildComplete?.(stage, piChildCount);
    return {
      status: 0,
      signal: null,
      stdout: JSON.stringify(body),
      stderr: '',
    };
  };
}

function greenAttestedSpawn(onChildComplete) {
  return async options => {
    onChildComplete?.('adapter', 0);
    const body = greenAdapterBody(options.cwd);
    return fakeAttestedResult(body, options);
  };
}

async function runFixtureBuiltPhase(label, {
  mutateBody,
  onChildComplete,
} = {}) {
  const artifactRoot = createCertifiedArtifactRoot(label);
  const adapterPath = join(artifactRoot, certifiedAdapterRelativePath);
  const attestedSpawn = async options => {
    onChildComplete?.('adapter', 0, options);
    const body = greenAdapterBody(options.cwd);
    mutateBody?.(body, options);
    return fakeAttestedResult(body, options);
  };
  return runBuiltPhase({
    artifactRoot,
    adapterPath,
    spawn: greenBuiltSpawn(adapterPath, (stage, count) => {
      onChildComplete?.(stage, count, { cwd: null });
    }),
    attestedSpawn,
    attestation: fixtureAttestation(),
  });
}

function fakeAttestedResult(body, options) {
  return {
    transcript: {
      type: ATTESTATION_TRANSCRIPT_TYPE,
      nonce: options.manifest.nonce,
      probeId: options.manifest.probeId,
      rawEvidence: body,
      observedUrls: options.manifest.expectedUrls,
      sourceHashes: options.manifest.sourceHashes,
      hmacSha256: '0'.repeat(64),
    },
    stdout: Buffer.from(JSON.stringify(body)),
    stderr: Buffer.alloc(0),
    trace: {
      command: process.execPath,
      args: options.args,
      cwd: options.cwd,
      shell: false,
      stdio: [...ATTESTATION_STDIO],
      status: 0,
      signal: null,
      stdoutBytes: Buffer.byteLength(JSON.stringify(body)),
      stderrBytes: 0,
    },
  };
}

function fixtureAttestation() {
  return {
    bootstrapBuffer: Buffer.from('certified fixture bootstrap'),
    manifest: {
      type: ATTESTATION_MANIFEST_TYPE,
      nonce: '1'.repeat(64),
      probeId: 'built-search-adapter',
      schemaSha256: SCHEMA_SHA256,
      sourceHashes: {
        bootstrapSha256: '3'.repeat(64),
        modules: {},
      },
      expectedUrls: [],
    },
  };
}

function replaceFile(target, content = readFileSync(target)) {
  const replacement = `${target}.replacement`;
  const original = `${target}.original`;
  write(replacement, content);
  renameSync(target, original);
  renameSync(replacement, target);
}

function report(files, tests = files.length, failures = 0) {
  return {
    success: failures === 0,
    numTotalTests: tests,
    numFailedTests: failures,
    testResults: files.map(name => ({
      name,
      assertionResults: [{ status: failures > 0 ? 'failed' : 'passed' }],
    })),
  };
}

test.afterEach(() => {
  if (originalNpmExecPath === undefined) delete process.env.npm_execpath;
  else process.env.npm_execpath = originalNpmExecPath;
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test('resolveNpmInvocation uses process.execPath and preserves an absolute npm CLI path with spaces', () => {
  const root = temporaryRoot('npm path with spaces');
  const npmCli = join(root, 'npm cli.js');
  write(npmCli, '// fixture\n');
  process.env.npm_execpath = npmCli;

  assert.deepEqual(resolveNpmInvocation(['test', '--', 'fixture.test.ts']), {
    command: process.execPath,
    args: [npmCli, 'test', '--', 'fixture.test.ts'],
  });
});

test('resolveNpmInvocation fails closed and permits only an explicit valid fallback', () => {
  const root = temporaryRoot('npm-fallback');
  const npmCli = join(root, 'npm-cli.js');
  write(npmCli, '// fixture\n');

  for (const invalid of [undefined, 'relative/npm-cli.js', join(root, 'missing.js')]) {
    if (invalid === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = invalid;
    assert.throws(
      () => resolveNpmInvocation(['test']),
      error => error.code === 'NPM_CLI_UNAVAILABLE',
    );
    assert.deepEqual(resolveNpmInvocation(['test'], { npmCliOverride: npmCli }), {
      command: process.execPath,
      args: [npmCli, 'test'],
    });
  }

  assert.deepEqual(parseArguments(['--npm-cli', npmCli]), {
    mode: 'standalone',
    npmCliOverride: npmCli,
  });
  assert.throws(
    () => parseArguments(['--source-only', '--npm-cli', npmCli]),
    error => error.code === 'INVALID_ARGUMENTS',
  );
  assert.throws(
    () => parseArguments(['--built', '--npm-cli', npmCli]),
    error => error.code === 'INVALID_ARGUMENTS',
  );
});

test('source phase owns exact root/dashboard suites with shell false and explicit cwd', async () => {
  const tempRoot = temporaryRoot('source');
  const npmCli = join(tempRoot, 'npm cli.js');
  write(npmCli, '// fixture\n');
  process.env.npm_execpath = npmCli;
  const calls = [];
  let activeChildren = 0;
  let maxActiveChildren = 0;

  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const outputIndex = args.indexOf('--outputFile');
    assert.notEqual(outputIndex, -1);
    const reportPath = args[outputIndex + 1];
    const files = args.slice(outputIndex + 2).map(path => resolve(options.cwd, path));
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    activeChildren += 1;
    maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
    setImmediate(() => {
      write(reportPath, JSON.stringify(report(files, files.length + 3)));
      activeChildren -= 1;
      child.emit('close', 0, null);
    });
    return child;
  };

  const result = await runSourcePhase({ spawn, tempRoot });

  assert.equal(result.runners[0].cwd, repoRoot);
  assert.equal(result.runners[0].collectedFiles, ROOT_TEST_PATHS.length);
  assert.equal(result.runners[1].cwd, dashboardRoot);
  assert.equal(result.runners[1].collectedFiles, 2);
  assert.deepEqual(result.runners[1].files, [...DASHBOARD_TEST_PATHS].sort());
  assert.equal(calls.length, 2);
  assert.equal(maxActiveChildren, 2);
  for (const call of calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.args[0], npmCli);
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.options.stdio, ['ignore', 'pipe', 'pipe']);
  }
  assert.equal(calls[0].options.cwd, repoRoot);
  assert.equal(calls[1].options.cwd, dashboardRoot);
  assert.deepEqual(calls[0].args.slice(1, 7), [
    'exec', '--', 'vitest', 'run', '--config', 'vitest.config.ts',
  ]);
  assert.notEqual(calls[0].args.indexOf('--maxWorkers=2'), -1);
  assert.notEqual(calls[1].args.indexOf('--maxWorkers=2'), -1);
  assert.notEqual(calls[0].args.indexOf('--testTimeout=60000'), -1);
  assert.notEqual(calls[1].args.indexOf('--testTimeout=60000'), -1);
  assert.deepEqual(
    calls[1].args.slice(calls[1].args.indexOf('--outputFile') + 2),
    DASHBOARD_TEST_PATHS,
  );
  assert.equal(calls[1].args.some(arg => arg.startsWith('dashboard/')), false);
});

test('Vitest reports reject zero collection, failed tests, wrong cwd ownership and dashboard prefixes', () => {
  const root = temporaryRoot('reports');
  const path = join(root, 'report.json');
  write(path, JSON.stringify(report([], 0)));
  assert.throws(
    () => parseVitestReport(path, {
      label: 'zero',
      cwd: dashboardRoot,
      expectedFiles: DASHBOARD_TEST_PATHS,
      exactCollectedFiles: 2,
    }),
    error => error.code === 'ZERO_TEST_COLLECTION',
  );

  write(path, JSON.stringify(report(
    DASHBOARD_TEST_PATHS.map(file => resolve(repoRoot, 'dashboard', 'dashboard', file)),
    2,
  )));
  assert.throws(
    () => parseVitestReport(path, {
      label: 'wrong cwd',
      cwd: dashboardRoot,
      expectedFiles: DASHBOARD_TEST_PATHS,
      exactCollectedFiles: 2,
    }),
    error => error.code === 'TEST_OWNERSHIP_MISMATCH',
  );

  write(path, JSON.stringify(report(
    DASHBOARD_TEST_PATHS.map(file => resolve(dashboardRoot, file)),
    2,
    1,
  )));
  assert.throws(
    () => parseVitestReport(path, {
      label: 'failure',
      cwd: dashboardRoot,
      expectedFiles: DASHBOARD_TEST_PATHS,
      exactCollectedFiles: 2,
    }),
    error => error.code === 'SOURCE_TEST_FAILURE',
  );
});

test('npm child failures preserve error/status/signal/stdout/stderr attribution', () => {
  const root = temporaryRoot('child-failure');
  const npmCli = join(root, 'npm-cli.js');
  write(npmCli, '// fixture\n');
  process.env.npm_execpath = npmCli;

  for (const result of [
    {
      status: 7,
      signal: null,
      stdout: 'partial stdout',
      stderr: 'child stderr',
    },
    {
      status: null,
      signal: 'SIGTERM',
      stdout: 'signal stdout',
      stderr: 'signal stderr',
      error: Object.assign(new Error('spawn failed'), { code: 'ENOENT' }),
    },
  ]) {
    assert.throws(
      () => runNpmChild('fixture-child', ['test'], repoRoot, { spawn: () => result }),
      error => {
        assert.equal(error.code, 'CHILD_PROCESS_FAILED');
        assert.equal(error.details.status, result.status);
        assert.equal(error.details.signal, result.signal);
        assert.equal(error.details.stdout, result.stdout);
        assert.equal(error.details.stderr, result.stderr);
        assert.equal(error.details.error?.code ?? null, result.error?.code ?? null);
        return true;
      },
    );
  }
});

test('phase runner enforces standalone, source-only and built-only counts and fail-fast order', async () => {
  for (const [mode, expected] of [
    ['standalone', { source: 1, build: 1, built: 1 }],
    ['source', { source: 1, build: 0, built: 0 }],
    ['built', { source: 0, build: 0, built: 1 }],
  ]) {
    const counts = { source: 0, build: 0, built: 0 };
    const results = await runPhases(mode, {
      'source-tests': () => {
        counts.source += 1;
        return 'source';
      },
      build: () => {
        counts.build += 1;
        return 'build';
      },
      'built-bin': () => {
        counts.built += 1;
        return 'built';
      },
    });
    assert.deepEqual(counts, expected);
    assert.deepEqual(
      results.map(item => item.phase),
      mode === 'standalone'
        ? ['source-tests', 'build', 'built-bin']
        : mode === 'source'
          ? ['source-tests']
          : ['built-bin'],
    );
  }

  let builtCalls = 0;
  await assert.rejects(
    () => runPhases('standalone', {
      'source-tests': () => 'source',
      build: () => {
        throw new Error('injected build failure');
      },
      'built-bin': () => {
        builtCalls += 1;
      },
    }),
    /injected build failure/,
  );
  assert.equal(builtCalls, 0);

  for (const faulty of [
    ['source-tests', 'built-bin'],
    ['source-tests', 'build', 'build', 'built-bin'],
    ['build', 'source-tests', 'built-bin'],
  ]) {
    assert.throws(
      () => assertPhaseSequence(
        faulty,
        ['source-tests', 'build', 'built-bin'],
      ),
      error => error.code === 'PHASE_ORDER_MISMATCH',
    );
  }
});

test('package wiring requires exact commands and source -> unique build -> built prepublish order', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const result = validatePackageWiring(pkg);
  assert.deepEqual(result.counts, { source: 1, build: 1, built: 1 });

  const standalone = structuredClone(pkg);
  standalone.scripts.prepublishOnly = standalone.scripts.prepublishOnly.replace(
    'npm run check:search-ranking-release-machine:source',
    'npm run check:search-ranking-release-machine',
  );
  assert.throws(
    () => validatePackageWiring(standalone),
    error => error.code === 'PREPUBLISH_ORDER_MISMATCH',
  );

  const duplicateBuild = structuredClone(pkg);
  duplicateBuild.scripts.prepublishOnly = duplicateBuild.scripts.prepublishOnly.replace(
    'npm run check:search-ranking-release-machine:built',
    'npm run build && npm run check:search-ranking-release-machine:built',
  );
  assert.throws(
    () => validatePackageWiring(duplicateBuild),
    error => error.code === 'PREPUBLISH_ORDER_MISMATCH',
  );
});

test('rejects invalid Pi release contracts before spawning children', async () => {
  const mutate = change => {
    const pi = structuredClone(validPiFixture);
    const holdouts = structuredClone(validHoldoutsFixture);
    change(pi, holdouts);
    return { pi, holdouts };
  };
  const cases = [
    ['wrong absolute schema', (pi) => { pi.schema_version = 'pi-knowledge-absolute/0.9'; }],
    ['wrong holdout schema', (_pi, holdouts) => {
      holdouts.schema_version = 'search-ranking-holdouts/0.9';
    }],
    ['missing primary array', (pi) => { delete pi.queries; }],
    ['empty primary array', (pi) => { pi.queries = []; }],
    ['one primary query', (pi) => { pi.queries = pi.queries.slice(0, 1); }],
    ['missing holdout array', (_pi, holdouts) => { delete holdouts.queries; }],
    ['empty holdout array', (_pi, holdouts) => { holdouts.queries = []; }],
    ['one Pi holdout', (_pi, holdouts) => {
      let keptPi = false;
      holdouts.queries = holdouts.queries.filter(query => {
        if (query.category !== 'pi') return true;
        if (keptPi) return false;
        keptPi = true;
        return true;
      });
    }],
    ['blank canonical ID', (pi) => { pi.canonicalId = ' '; }],
    ['blank primary ID', (pi) => { pi.queries[0].id = ''; }],
    ['blank holdout ID', (_pi, holdouts) => { holdouts.queries[0].id = ' '; }],
    ['duplicate query IDs', (pi) => { pi.queries[1].id = pi.queries[0].id; }],
    ['blank primary query', (pi) => { pi.queries[0].query = ''; }],
    ['blank holdout query', (_pi, holdouts) => { holdouts.queries[0].query = ' '; }],
    ['duplicate primary queries', (pi) => { pi.queries[1].query = pi.queries[0].query; }],
    ['primary and holdout query overlap', (pi, holdouts) => {
      holdouts.queries[0].query = pi.queries[0].query;
    }],
    ['empty primary targets', (pi) => { pi.queries[0].targetIds = []; }],
    ['empty holdout targets', (_pi, holdouts) => { holdouts.queries[0].targetIds = []; }],
    ['retargeted primary', (pi) => { pi.queries[0].targetIds = ['knowhow-other']; }],
    ['retargeted holdout', (_pi, holdouts) => {
      holdouts.queries[0].targetIds = ['knowhow-other'];
    }],
    ['weakened Top-K', (pi) => { pi.thresholds.topK = 6; }],
    ['weakened Recall cutoff', (pi) => { pi.thresholds.recallAt = 21; }],
    ['weakened minimum Recall', (pi) => { pi.thresholds.minRecall = 0.899; }],
    ['weakened leak allowance', (pi) => { pi.thresholds.maxDeprecatedLeakCount = 1; }],
  ];

  for (const [label, change] of cases) {
    const { pi, holdouts } = mutate(change);
    let spawnCount = 0;
    await assert.rejects(
      () => runBuiltPhase({
        piFixture: pi,
        holdoutsFixture: holdouts,
        spawn: () => {
          spawnCount += 1;
          return { status: 0, signal: null, stdout: '{}', stderr: '' };
        },
      }),
      error => error.code === 'INVALID_PI_RELEASE_CONTRACT',
      label,
    );
    assert.equal(spawnCount, 0, label);
  }
});

const greenVerdict = Object.freeze({
  qrelsSha256Match: true,
  queryCoverage: true,
  expectedCountsMatch: true,
  legacyRankGoldenMatch: true,
  exactMrrAt10: 0.95,
  overallNdcgGain: 0.10,
  maxCategoryNdcgDrop: 0.02,
  knowledgeRecallAt20: 0.90,
  piPrimaryCount: 2,
  piHoldoutCount: 2,
  piRelevantCount: 10,
  piRecalledAt20: 9,
  piRecallAt20: 0.90,
  piPrimaryTop5Pass: true,
  piHoldoutTop5Pass: true,
  deprecatedLeakCount: 0,
  unauthorizedWorkspaceHitCount: 0,
  provenanceLossCount: 0,
  attachOrMergeCalls: 0,
  holdoutOverlapCount: 0,
  daemonLookupCalls: 0,
  daemonStartCalls: 0,
  filesystemCacheReadCalls: 0,
  filesystemCacheWriteCalls: 0,
  filesystemIndexWriteCalls: 0,
  embeddingBuildCalls: 0,
  embeddingSaveCalls: 0,
  credibilityHitWriteCalls: 0,
  stableTop20: true,
  kgWarmP95Ms: 34.799,
  kgWarmMaxMs: 49.999,
  wikiQueryP95Ms: 49.999,
  wikiIndexP95Ms: 499.999,
  wikiIndexCacheHitCount: 0,
  protectedStateUnchanged: true,
  querySpecialCaseHits: 0,
});

test('derives current package build direct-control graph', () => {
  const first = deriveSearchRankingDirectControlGraph({ phase: 'full' });
  const second = deriveSearchRankingDirectControlGraph({ phase: 'full' });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.derived_count, first.expected_paths.length);
  assert.deepEqual(first.expected_paths, [...new Set(first.expected_paths)].sort());
  assert.equal(first.expected_paths.includes('package.json'), true);
  assert.equal(first.expected_paths.includes('package-lock.json'), true);
  assert.equal(first.expected_paths.includes('dashboard/package.json'), true);
  assert.equal(first.expected_paths.includes('dashboard/package-lock.json'), true);
  assert.equal(first.expected_paths.includes('tsconfig.json'), true);
  assert.equal(first.expected_paths.includes('dashboard/tsconfig.node.json'), true);
  assert.equal(
    first.edges.some(edge => edge.to === 'external:node_modules/.bin/tsc'
      && edge.provenance.package === 'typescript'),
    true,
  );

  const inlineNodes = first.virtual_command_nodes.filter(
    node => node.kind === 'node-inline-program',
  );
  assert.equal(inlineNodes.length, 3);
  for (const node of inlineNodes) {
    assert.match(node.sha256, /^[a-f0-9]{64}$/);
    assert.equal(node.owner.startsWith('package.json#scripts.build'), true);
    assert.equal(
      first.edges.some(edge => edge.from === node.owner && edge.to === node.id),
      true,
    );
  }
  const roots = JSON.parse(readFileSync(
    join(repoRoot, 'scripts', 'search-ranking-direct-control-roots.json'),
    'utf8',
  ));
  assert.equal(Object.hasOwn(roots, 'expected_paths'), false);
  assert.equal(Object.hasOwn(roots, 'expected_count'), false);
});

test('covers actual package shell and every direct-control edge class', () => {
  const source = deriveSearchRankingDirectControlGraph({ phase: 'source' });
  const full = deriveSearchRankingDirectControlGraph({ phase: 'full' });
  for (const edgeClass of full.edge_classes) {
    assert.equal(
      full.edges.some(edge => edge.class === edgeClass),
      true,
      edgeClass,
    );
  }
  for (const path of [
    'src/tools/impeccable/live/static/live-browser-session.js',
    'src/tools/impeccable/live/static/live-browser.js',
    'src/tools/impeccable/live/static/modern-screenshot.umd.js',
    'dist/src/tools/impeccable/live/static/live-browser-session.js',
    'dist/src/tools/impeccable/live/static/live-browser.js',
    'dist/src/tools/impeccable/live/static/modern-screenshot.umd.js',
    'src/graph/db/schema.sql',
    'dist/src/graph/db/schema.sql',
    'src/graph/kg/schema.sql',
    'dist/src/graph/kg/schema.sql',
    'native/lifecycle-fs/Cargo.toml',
    'native/lifecycle-fs/Cargo.lock',
    'native/lifecycle-fs/src/main.rs',
    'scripts/native-lifecycle-workflow-overlay.yml',
    '.github/workflows/deploy-docs.yml',
  ]) {
    assert.equal(full.expected_paths.includes(path), true, path);
  }
  const nativeBytes = full.expected_paths.filter(
    path => path.startsWith('resources/lifecycle-fs/')
      && path !== 'resources/lifecycle-fs/manifest.json'
      && path !== 'resources/lifecycle-fs/provenance.json',
  );
  assert.equal(nativeBytes.length, 5);
  assert.equal(nativeBytes.every(path => !source.expected_paths.includes(path)), true);
  for (const path of PRODUCTION_ARTIFACTS) {
    assert.equal(full.expected_paths.includes(path), true, `full production artifact: ${path}`);
    assert.equal(source.expected_paths.includes(path), false, `source production artifact: ${path}`);
    assert.equal(
      source.edges.some(edge => edge.to === path && edge.provenance.phase === 'full'),
      true,
      `source full-phase edge: ${path}`,
    );
  }
  assert.equal(
    full.virtual_command_nodes.filter(node => node.kind === 'native-job-receipt').length,
    5,
  );
  for (const path of [...ROOT_TEST_PATHS, ...DASHBOARD_TEST_PATHS.map(
    value => `dashboard/${value}`,
  )]) {
    assert.equal(full.expected_paths.includes(path), true, path);
  }
  const parsed = parseShellScript(
    'MODE=release node "scripts/check-search-ranking-release-machine.mjs" --built'
      + ' && npm run build || node scripts/check-search-ranking-release-machine.mjs\\;literal',
  );
  assert.deepEqual(parsed.slice(0, 2).map(segment => segment.operator_before), [null, '&&']);
  assert.equal(parsed[0].tokens[0], 'MODE=release');
  assert.equal(parsed[0].tokens[1], 'node');
  assert.equal(parsed[2].operator_before, '||');
  assert.equal(parsed[2].tokens.at(-1).endsWith(';literal'), true);
});

test('certifies derived graph through retained handles', () => {
  const fixture = createCertificateFixture('retained-phase-certificate');
  const opened = [];
  const context = createDerivedControlCertificate({
    root: fixture.root,
    deriveGraph: phase => structuredClone(
      phase === 'source' ? fixture.sourceGraph : fixture.fullGraph,
    ),
    openHandle(relativePath, options) {
      opened.push(relativePath);
      return openRetainedArtifactHandle(relativePath, options);
    },
  });
  try {
    const source = context.captureSource();
    const sourceHandle = context.getHandle('control.mjs');
    const full = context.captureFull();
    assert.equal(context.getHandle('control.mjs'), sourceHandle);
    assert.deepEqual(opened, ['control.mjs', 'package.json', 'generated.js']);
    assert.deepEqual(full.deltaPaths, ['generated.js']);
    const final = context.captureFinal();
    const certificate = context.result();

    assert.equal(source.certificate.phase_id, 'source');
    assert.equal(full.certificate.phase_id, 'full');
    assert.equal(final.certificate.phase_id, 'final');
    assert.equal(source.certificate.count, fixture.sourceGraph.expected_paths.length);
    assert.equal(certificate.count, fixture.fullGraph.expected_paths.length);
    assert.equal(final.certificate.delta_count, 0);
    assert.deepEqual(final.certificate.delta_paths, []);
    assert.equal(
      full.certificate.sorted_set_sha256,
      final.certificate.sorted_set_sha256,
    );
    assert.equal(
      full.certificate.graph_sha256,
      final.certificate.graph_sha256,
    );
    assert.equal(
      full.certificate.handle_identity_sha256,
      final.certificate.handle_identity_sha256,
    );
    assert.deepEqual(
      full.certificate.per_handle_buffer_sha256,
      final.certificate.per_handle_buffer_sha256,
    );
    for (const phase of Object.values(certificate.phases)) {
      assert.match(phase.graph_sha256, /^[a-f0-9]{64}$/);
      assert.match(phase.sorted_set_sha256, /^[a-f0-9]{64}$/);
      assert.match(phase.handle_identity_sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        Object.keys(phase.per_handle_buffer_sha256).length,
        phase.count,
      );
    }
  } finally {
    context.close();
  }
});

test('rejects omitted or dynamic current package controls', () => {
  const actual = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const baseline = deriveSearchRankingDirectControlGraph({
    phase: 'full',
    packageJson: actual,
  });
  const faults = [
    ['dynamic command', '$TOOL scripts/check-search-ranking-release-machine.mjs'],
    ['command substitution', '$(node --version)'],
    ['unsupported pipe', 'node scripts/check-search-ranking-release-machine.mjs | node -e "0"'],
    ['unsupported redirect', 'node scripts/check-search-ranking-release-machine.mjs > result.json'],
  ];
  for (const [label, command] of faults) {
    const faulty = structuredClone(actual);
    faulty.scripts['check:search-ranking-release-machine'] = command;
    assert.throws(
      () => deriveSearchRankingDirectControlGraph({ phase: 'full', packageJson: faulty }),
      undefined,
      label,
    );
  }

  const recursive = structuredClone(actual);
  recursive.scripts.loop = 'npm run loop';
  recursive.scripts['check:search-ranking-release-machine'] = 'npm run loop';
  assert.throws(
    () => deriveSearchRankingDirectControlGraph({ phase: 'full', packageJson: recursive }),
    /cycle/,
  );

  const omitted = structuredClone(actual);
  delete omitted.bin.maestro;
  assert.throws(
    () => deriveSearchRankingDirectControlGraph({ phase: 'full', packageJson: omitted }),
    /missing package bin root/,
  );

  const bareTsc = structuredClone(actual);
  bareTsc.scripts.build = bareTsc.scripts.build.replace(
    '&& tsc &&',
    '&& tsc -p README.md &&',
  );
  const changedBareTsc = deriveSearchRankingDirectControlGraph({
    phase: 'full',
    packageJson: bareTsc,
  });
  assert.notDeepEqual(changedBareTsc.expected_paths, baseline.expected_paths);
  assert.equal(changedBareTsc.expected_paths.includes('README.md'), true);

  for (const [label, mutate] of [
    ['first inline source', value => value.replace(
      "s='src/tools/impeccable/live/static'",
      "s='src/search/evaluation/fixtures'",
    )],
    ['first inline output', value => value.replace(
      "d='dist/src/tools/impeccable/live/static'",
      "d='dist/src/graph/db'",
    )],
    ['second inline source', value => value.replace(
      "'src/graph/db/schema.sql'",
      "'docs/knowledge-system-architecture.md'",
    )],
    ['second inline output', value => value.replace(
      "'dist/src/graph/kg/schema.sql'",
      "'dist/src/graph/db/schema.sql'",
    )],
  ]) {
    const faulty = structuredClone(actual);
    faulty.scripts.build = mutate(faulty.scripts.build);
    let changed = false;
    try {
      changed = JSON.stringify(deriveSearchRankingDirectControlGraph({
        phase: 'full',
        packageJson: faulty,
      }).expected_paths) !== JSON.stringify(baseline.expected_paths);
    } catch {
      changed = true;
    }
    assert.equal(changed, true, label);
  }

  const nonliteralImport = structuredClone(actual);
  nonliteralImport.bin.maestro = 'dashboard/src/server/wiki/search-ranking.test.ts';
  assert.throws(
    () => deriveSearchRankingDirectControlGraph({
      phase: 'full',
      packageJson: nonliteralImport,
    }),
    /nonliteral dynamic import/,
  );

  const roots = JSON.parse(readFileSync(
    join(repoRoot, 'scripts', 'search-ranking-direct-control-roots.json'),
    'utf8',
  ));
  const malformed = structuredClone(roots);
  delete malformed.exclusions[0].rationale;
  assert.throws(() => parseDirectControlRoots(JSON.stringify(malformed)), /keys/);
  const membership = structuredClone(roots);
  membership.exclusions[0].rationale =
    'This path is omitted because it is not part of expected-set membership.';
  assert.throws(
    () => parseDirectControlRoots(JSON.stringify(membership)),
    /reasoned/,
  );
});

test('requires non-vacuous Pi absolute Recall@20', () => {
  const contract = validatePiReleaseContract(validPiFixture, validHoldoutsFixture);
  assert.equal(contract.primaryQueries.length >= 2, true);
  assert.equal(contract.holdoutQueries.length >= 2, true);

  const boundary = assertMachineVerdict({ ...greenVerdict });
  assert.equal(boundary.piPrimaryCount >= 2, true);
  assert.equal(boundary.piHoldoutCount >= 2, true);
  assert.equal(boundary.piRelevantCount > 0, true);
  assert.equal(Number.isFinite(boundary.piRecallAt20), true);
  assert.equal(boundary.piRecallAt20, 0.90);

  assert.throws(
    () => assertMachineVerdict({
      ...greenVerdict,
      piRelevantCount: 1000,
      piRecalledAt20: 899,
      piRecallAt20: 0.899,
    }),
    error => error.code === 'HARD_THRESHOLD_FAILED'
      && error.details.failed.includes('piRecallAt20'),
  );
  assert.throws(
    () => assertMachineVerdict({
      ...greenVerdict,
      piRelevantCount: 0,
      piRecalledAt20: 0,
      piRecallAt20: Number.NaN,
    }),
    error => error.code === 'HARD_THRESHOLD_FAILED'
      && error.details.failed.includes('piRelevantCount')
      && error.details.failed.includes('piRecallAt20'),
  );
});

test('machine verdict enforces every independent ranking/lifecycle hard threshold', () => {
  assert.equal(assertMachineVerdict({ ...greenVerdict }).exactMrrAt10, 0.95);
  const faults = {
    qrelsSha256Match: false,
    queryCoverage: false,
    expectedCountsMatch: false,
    legacyRankGoldenMatch: false,
    exactMrrAt10: 0.949,
    overallNdcgGain: 0.099,
    maxCategoryNdcgDrop: 0.021,
    knowledgeRecallAt20: 0.899,
    piPrimaryCount: 1,
    piHoldoutCount: 1,
    piRelevantCount: 0,
    piRecalledAt20: 11,
    piRecallAt20: 0.899,
    piPrimaryTop5Pass: false,
    piHoldoutTop5Pass: false,
    deprecatedLeakCount: 1,
    unauthorizedWorkspaceHitCount: 1,
    provenanceLossCount: 1,
    attachOrMergeCalls: 1,
    holdoutOverlapCount: 1,
    daemonLookupCalls: 1,
    daemonStartCalls: 1,
    filesystemCacheReadCalls: 1,
    filesystemCacheWriteCalls: 1,
    filesystemIndexWriteCalls: 1,
    embeddingBuildCalls: 1,
    embeddingSaveCalls: 1,
    credibilityHitWriteCalls: 1,
    stableTop20: false,
    kgWarmP95Ms: 34.8,
    kgWarmMaxMs: 50,
    wikiQueryP95Ms: 50,
    wikiIndexP95Ms: 500,
    wikiIndexCacheHitCount: 1,
    protectedStateUnchanged: false,
    querySpecialCaseHits: 1,
  };
  for (const [metric, value] of Object.entries(faults)) {
    assert.throws(
      () => assertMachineVerdict({ ...greenVerdict, [metric]: value }),
      error => error.code === 'HARD_THRESHOLD_FAILED'
        && error.details.failed.includes(metric),
      metric,
    );
  }
});

test('metric fault injection exits non-zero in a real child process', () => {
  const modulePath = join(repoRoot, 'scripts', 'check-search-ranking-release-machine.mjs');
  const script = [
    `import { assertMachineVerdict } from ${JSON.stringify(`file:///${modulePath.replaceAll('\\', '/')}`)};`,
    `const verdict = ${JSON.stringify({ ...greenVerdict, querySpecialCaseHits: 1 })};`,
    'assertMachineVerdict(verdict);',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    shell: false,
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /querySpecialCaseHits/);
});

test('artifact reader hashes and parses the same contained Buffer', () => {
  const artifact = readArtifact('package.json');
  const parsed = parseArtifactJson(artifact);
  assert.equal(parsed.name, 'maestro-flow');
  assert.equal(artifact.buffer.equals(readFileSync(join(repoRoot, 'package.json'))), true);
  assert.deepEqual(Object.keys(artifact.identity).sort(), ['dev', 'ino', 'mtimeMs', 'size']);
  assert.equal(artifact.identity.size, artifact.buffer.length);
  assert.equal(
    artifact.sha256,
    createHash('sha256').update(artifact.buffer).digest('hex'),
  );
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
});

test('certifies native provenance and final package bytes', () => {
  const context = createDerivedControlCertificate();
  try {
    context.captureSource();
    const full = context.captureFull();
    const native = certifyNativeControls({
      graph: full.graph,
      getHandle: path => context.getHandle(path),
      protocolProbe: () => runNativeLifecycleProtocolProbe(),
    });
    const final = context.captureFinal();
    const packageArtifact = final.artifacts.find(
      artifact => artifact.relativePath === 'package.json',
    );
    const packageWiring = validatePackageWiring(parseArtifactJson(packageArtifact));

    assert.equal(native.mappings.length, 5);
    assert.equal(native.selected.platform, process.platform);
    assert.equal(native.selected.arch, process.arch);
    assert.equal(native.selected.protocol, 'lifecycle-fs-helper/1.0');
    assert.equal(native.probe.status, 0);
    assert.equal(
      native.manifest_sha256,
      full.certificate.per_handle_buffer_sha256[native.manifest_path],
    );
    assert.equal(
      native.provenance_sha256,
      full.certificate.per_handle_buffer_sha256[native.provenance_path],
    );
    assert.deepEqual(packageWiring.counts, { source: 1, build: 1, built: 1 });
    assert.equal(
      packageArtifact.sha256,
      final.certificate.per_handle_buffer_sha256['package.json'],
    );
    assert.equal(context.getHandle('package.json').initial.buffer.equals(
      packageArtifact.buffer,
    ), true);
  } finally {
    context.close();
  }
});

test('rejects every derived certificate mutation', () => {
  const runPhaseFault = ({
    label,
    mutateGraphs,
    mutateFiles,
    expectedCode,
  }) => {
    const fixture = createCertificateFixture(`certificate-fault-${label}`);
    const graphs = mutateGraphs
      ? mutateGraphs(structuredClone(fixture.sourceGraph), structuredClone(fixture.fullGraph))
      : {
          source: structuredClone(fixture.sourceGraph),
          full: structuredClone(fixture.fullGraph),
        };
    let fullCalls = 0;
    const context = createDerivedControlCertificate({
      root: fixture.root,
      deriveGraph: phase => {
        if (phase === 'source') return structuredClone(graphs.source);
        const graph = Array.isArray(graphs.full)
          ? graphs.full[Math.min(fullCalls, graphs.full.length - 1)]
          : graphs.full;
        fullCalls += 1;
        return structuredClone(graph);
      },
    });
    try {
      if (expectedCode === 'INVALID_DIRECT_CONTROL_GRAPH') {
        assert.throws(() => context.captureSource(), error => error.code === expectedCode, label);
        return;
      }
      context.captureSource();
      if (expectedCode === 'INVALID_FULL_PHASE_DELTA') {
        assert.throws(() => context.captureFull(), error => error.code === expectedCode, label);
        return;
      }
      context.captureFull();
      mutateFiles?.(fixture.root);
      assert.throws(() => context.captureFinal(), error => error.code === expectedCode, label);
    } finally {
      context.close();
    }
  };

  runPhaseFault({
    label: 'wrong-source-phase-id',
    expectedCode: 'INVALID_DIRECT_CONTROL_GRAPH',
    mutateGraphs(source, full) {
      source.phase = 'full';
      return { source, full };
    },
  });
  runPhaseFault({
    label: 'ungraphed-full-member',
    expectedCode: 'INVALID_FULL_PHASE_DELTA',
    mutateGraphs(source, full) {
      write(join(temporaryRoots.at(-1), 'ungraphed.js'), 'ungraphed\n');
      full.expected_paths = [...full.expected_paths, 'ungraphed.js'].sort();
      full.derived_count = full.expected_paths.length;
      return { source, full };
    },
  });
  runPhaseFault({
    label: 'missing-generated-member',
    expectedCode: 'INVALID_FULL_PHASE_DELTA',
    mutateGraphs(source, full) {
      full.expected_paths = full.expected_paths.filter(path => path !== 'generated.js');
      full.derived_count = full.expected_paths.length;
      return { source, full };
    },
  });
  runPhaseFault({
    label: 'final-set-drift',
    expectedCode: 'FINAL_PHASE_SET_MISMATCH',
    mutateGraphs(source, full) {
      const final = structuredClone(full);
      final.expected_paths = [...final.expected_paths, 'rogue.js'].sort();
      final.derived_count = final.expected_paths.length;
      return { source, full: [full, final] };
    },
  });
  runPhaseFault({
    label: 'final-graph-hash-drift',
    expectedCode: 'FINAL_PHASE_GRAPH_MISMATCH',
    mutateGraphs(source, full) {
      const final = structuredClone(full);
      final.edges.push({
        class: 'package-script-token',
        from: 'package.json#scripts.build',
        to: 'external:retargeted-control',
        provenance: { excluded: true },
      });
      return { source, full: [full, final] };
    },
  });
  runPhaseFault({
    label: 'same-handle-byte-drift',
    expectedCode: 'ARTIFACT_POST_CHILD_CHANGED',
    mutateFiles(root) {
      writeFileSync(join(root, 'control.mjs'), 'export const control = false;\n');
    },
  });
  runPhaseFault({
    label: 'child-path-replacement',
    expectedCode: 'ARTIFACT_POST_CHILD_CHANGED',
    mutateFiles(root) {
      replaceFile(join(root, 'control.mjs'));
    },
  });
  runPhaseFault({
    label: 'final-package-buffer-drift',
    expectedCode: 'ARTIFACT_POST_CHILD_CHANGED',
    mutateFiles(root) {
      const packagePath = join(root, 'package.json');
      writeFileSync(packagePath, Buffer.concat([readFileSync(packagePath), Buffer.from(' ')]));
    },
  });

  for (const [label, options] of [
    ['native-byte', { tamperManifestByte: true }],
    ['native-receipt', { tamperReceipt: true }],
  ]) {
    const fixture = createNativeCertificateFixture(
      `certificate-fault-${label}`,
      options,
    );
    const context = createDerivedControlCertificate({
      root: fixture.root,
      deriveGraph: phase => structuredClone(
        phase === 'source' ? fixture.sourceGraph : fixture.fullGraph,
      ),
    });
    try {
      context.captureSource();
      const full = context.captureFull();
      assert.throws(
        () => certifyNativeControls({
          graph: full.graph,
          getHandle: path => context.getHandle(path),
          protocolProbe: () => ({ status: 0 }),
        }),
        error => error.code === 'INVALID_NATIVE_CERTIFICATE',
        label,
      );
    } finally {
      context.close();
    }
  }
});

test('fails when a certified artifact changes after a built child', () => {
  const modulePath = join(repoRoot, 'scripts', 'check-search-ranking-release-machine.mjs');
  const moduleUrl = `file:///${modulePath.replaceAll('\\', '/')}`;
  for (const relativePath of [
    'bin/maestro.js',
    'dist/src/cli.js',
    'src/search/evaluation/fixtures/search-ranking-qrels.json',
    certifiedAdapterRelativePath,
  ]) {
    const root = temporaryRoot(`post-child-process-${relativePath.replaceAll('/', '-')}`);
    const target = join(root, relativePath);
    write(target, `certified-${relativePath}`);
    const mutation = [
      "const { readFileSync, writeFileSync } = require('node:fs');",
      `const path = ${JSON.stringify(target)};`,
      'const bytes = readFileSync(path);',
      'bytes[0] ^= 1;',
      'writeFileSync(path, bytes);',
    ].join('\n');
    const script = [
      `import { spawnSync } from 'node:child_process';`,
      `import { readArtifact, revalidateCertifiedArtifacts } from ${JSON.stringify(moduleUrl)};`,
      `const root = ${JSON.stringify(root)};`,
      `const relativePath = ${JSON.stringify(relativePath)};`,
      'const certificate = readArtifact(relativePath, { root });',
      `const child = spawnSync(process.execPath, ['--eval', ${JSON.stringify(mutation)}], { shell: false, encoding: 'utf8' });`,
      "if (child.status !== 0) throw new Error(child.stderr || 'mutation child failed');",
      'try {',
      '  const post = revalidateCertifiedArtifacts([certificate], { root });',
      "  process.stdout.write(JSON.stringify({ ok: true, artifactHashes: { [relativePath]: post[0].sha256 } }));",
      '} catch (error) {',
      '  process.stderr.write(JSON.stringify(error.toJSON()));',
      '  process.exitCode = 1;',
      '}',
    ].join('\n');

    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      shell: false,
      cwd: repoRoot,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0, relativePath);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.ok, false, relativePath);
    assert.equal(failure.code, 'ARTIFACT_POST_CHILD_CHANGED', relativePath);
    assert.equal(Object.hasOwn(failure, 'verdict'), false, relativePath);
    assert.equal(Object.hasOwn(failure, 'artifactHashes'), false, relativePath);
    assert.equal(result.stdout, '', relativePath);
  }
});

test('detects post-child identity and realpath replacement', () => {
  const metadataRoot = temporaryRoot('certificate-metadata');
  write(join(metadataRoot, 'artifact.txt'), 'stable certificate bytes');
  const certificate = readArtifact('artifact.txt', { root: metadataRoot });
  const metadataCases = [
    ['realPath', { ...certificate, realPath: `${certificate.realPath}.previous` }],
    ['dev', {
      ...certificate,
      identity: {
        ...certificate.identity,
        dev: certificate.identity.dev === 0 ? 1 : 0,
      },
    }],
    ['ino', {
      ...certificate,
      identity: {
        ...certificate.identity,
        ino: certificate.identity.ino === 0 ? 1 : 0,
      },
    }],
    ['size', {
      ...certificate,
      identity: { ...certificate.identity, size: certificate.identity.size + 1 },
    }],
    ['mtimeMs', {
      ...certificate,
      identity: { ...certificate.identity, mtimeMs: certificate.identity.mtimeMs + 1 },
    }],
    ['sha256', { ...certificate, sha256: '0'.repeat(64) }],
  ];
  for (const [field, changedCertificate] of metadataCases) {
    assert.throws(
      () => revalidateCertifiedArtifacts([changedCertificate], { root: metadataRoot }),
      error => error.code === 'ARTIFACT_POST_CHILD_CHANGED'
        && error.details.changed.includes(field),
      field,
    );
  }

  const replacementRoot = temporaryRoot('certificate-atomic-replace');
  const replacementPath = join(replacementRoot, 'artifact.txt');
  write(replacementPath, 'same bytes');
  const replacementCertificate = readArtifact('artifact.txt', { root: replacementRoot });
  replaceFile(replacementPath);
  assert.throws(
    () => revalidateCertifiedArtifacts([replacementCertificate], { root: replacementRoot }),
    error => error.code === 'ARTIFACT_POST_CHILD_CHANGED'
      && error.details.changed.includes('ino'),
  );

  const retargetRoot = temporaryRoot('certificate-realpath-retarget');
  const firstRoot = join(retargetRoot, 'first');
  const secondRoot = join(retargetRoot, 'second');
  const activeRoot = join(retargetRoot, 'active');
  write(join(firstRoot, 'artifact.txt'), 'same bytes');
  write(join(secondRoot, 'artifact.txt'), 'same bytes');
  symlinkSync(firstRoot, activeRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const retargetCertificate = readArtifact('artifact.txt', { root: activeRoot });
  unlinkSync(activeRoot);
  symlinkSync(secondRoot, activeRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => revalidateCertifiedArtifacts([retargetCertificate], { root: activeRoot }),
    error => error.code === 'ARTIFACT_POST_CHILD_CHANGED'
      && error.details.changed.includes('realPath'),
  );
});

test('revalidates after adapter, history and Pi children before assembling a verdict', async () => {
  const fixedTime = new Date('2026-01-01T00:00:00.000Z');
  const cases = [
    {
      label: 'adapter mutates certified package manifest in place',
      stage: 'adapter',
      relativePath: 'package.json',
      mutate(target) {
        const bytes = readFileSync(target);
        bytes[0] ^= 1;
        writeFileSync(target, bytes);
      },
      expectedField: 'sha256',
    },
    {
      label: 'adapter mutates certified bin in place',
      stage: 'adapter',
      relativePath: 'bin/maestro.js',
      mutate(target) {
        const bytes = readFileSync(target);
        bytes[0] ^= 1;
        writeFileSync(target, bytes);
      },
    },
    {
      label: 'history atomically replaces certified dist CLI',
      stage: 'history',
      relativePath: 'dist/src/cli.js',
      mutate(target) {
        replaceFile(target);
      },
    },
    {
      label: 'Pi child changes qrels bytes without size or mtime drift',
      stage: 'pi',
      relativePath: 'src/search/evaluation/fixtures/search-ranking-qrels.json',
      prepare(target) {
        utimesSync(target, fixedTime, fixedTime);
      },
      mutate(target) {
        const bytes = readFileSync(target);
        const index = bytes.indexOf(Buffer.from('AuthTokenValidator'));
        assert.notEqual(index, -1);
        bytes[index] ^= 1;
        writeFileSync(target, bytes);
        utimesSync(target, fixedTime, fixedTime);
      },
      expectedField: 'sha256',
    },
    {
      label: 'Pi child changes certified Pi fixture mtime',
      stage: 'pi',
      relativePath: 'src/search/evaluation/fixtures/pi-knowledge-absolute.json',
      mutate(target) {
        const before = statSync(target);
        const changed = new Date(before.mtimeMs + 5_000);
        utimesSync(target, changed, changed);
      },
      expectedField: 'mtimeMs',
    },
    {
      label: 'Pi child atomically replaces compiled production adapter',
      stage: 'pi',
      relativePath: certifiedAdapterRelativePath,
      mutate(target) {
        replaceFile(target);
      },
      expectedField: 'ino',
    },
  ];

  for (const fault of cases) {
    const artifactRoot = createCertifiedArtifactRoot(
      `built-child-${fault.relativePath.replaceAll('/', '-')}`,
    );
    const target = join(artifactRoot, fault.relativePath);
    fault.prepare?.(target);
    const adapterPath = join(artifactRoot, certifiedAdapterRelativePath);
    let mutated = false;
    const onChildComplete = stage => {
      if (stage !== fault.stage || mutated) return;
      fault.mutate(target);
      mutated = true;
    };
    const childSpawn = greenBuiltSpawn(adapterPath, onChildComplete);
    const attestedSpawn = greenAttestedSpawn(onChildComplete);

    await assert.rejects(
      () => runBuiltPhase({
        spawn: childSpawn,
        attestedSpawn,
        attestation: fixtureAttestation(),
        artifactRoot,
        adapterPath,
      }),
      error => {
        assert.equal(error.code, 'ARTIFACT_POST_CHILD_CHANGED', fault.label);
        assert.equal(error.details.relativePath, fault.relativePath, fault.label);
        if (fault.expectedField) {
          assert.equal(error.details.changed.includes(fault.expectedField), true, fault.label);
        }
        const failure = error.toJSON();
        assert.equal(Object.hasOwn(failure, 'verdict'), false, fault.label);
        assert.equal(Object.hasOwn(failure, 'artifactHashes'), false, fault.label);
        return true;
      },
      fault.label,
    );
    assert.equal(mutated, true, fault.label);
  }
});

test('returns only revalidated post-child hashes', async () => {
  const artifactRoot = createCertifiedArtifactRoot('green-post-child');
  const adapterPath = join(artifactRoot, certifiedAdapterRelativePath);
  const initial = certifiedArtifactPaths.map(
    relativePath => readArtifact(relativePath, { root: artifactRoot }),
  );
  const result = await runBuiltPhase({
    artifactRoot,
    adapterPath,
    spawn: greenBuiltSpawn(adapterPath),
    attestedSpawn: greenAttestedSpawn(),
    attestation: fixtureAttestation(),
  });
  const post = revalidateCertifiedArtifacts(initial, { root: artifactRoot });

  assert.equal(result.trace.length, 6);
  assert.equal(new Set(result.trace.map(trace => trace.cwd)).size, 1);
  for (const trace of result.trace) {
    assert.equal(trace.command, process.execPath);
    assert.equal(trace.shell, false);
    assert.equal(trace.maestroProjectRoot, trace.cwd);
    assert.notEqual(trace.cwd, repoRoot);
  }
  assert.equal(post.length, certifiedArtifactPaths.length);
  for (let index = 0; index < initial.length; index += 1) {
    assert.equal(post[index].realPath, initial[index].realPath);
    assert.deepEqual(post[index].identity, initial[index].identity);
    assert.equal(post[index].sha256, initial[index].sha256);
    assert.equal(
      post[index].sha256,
      createHash('sha256').update(post[index].buffer).digest('hex'),
    );
  }
  assert.deepEqual(
    result.artifactHashes,
    Object.fromEntries(post.map(artifact => [artifact.relativePath, artifact.sha256])),
  );
});

test('parent recomputes every raw release verdict', async () => {
  const result = await runFixtureBuiltPhase('parent-raw-recompute');
  const { verdict, adapter } = result;
  assert.equal(verdict.qrelsSha256Match, true);
  assert.equal(verdict.queryCoverage, true);
  assert.equal(verdict.expectedCountsMatch, true);
  assert.equal(verdict.legacyRankGoldenMatch, true);
  assert.equal(verdict.exactMrrAt10, 1);
  assert.equal(verdict.knowledgeRecallAt20, 1);
  assert.equal(verdict.overallNdcgGain >= 0.1, true);
  assert.equal(verdict.maxCategoryNdcgDrop, 0);
  assert.equal(verdict.stableTop20, true);
  assert.equal(verdict.kgWarmP95Ms, 1);
  assert.equal(verdict.kgWarmMaxMs, 1);
  assert.equal(verdict.wikiQueryP95Ms, 1);
  assert.equal(verdict.wikiIndexP95Ms, 1);
  assert.equal(verdict.wikiIndexCacheHitCount, 0);
  assert.equal(verdict.protectedStateUnchanged, true);
  for (const counter of [
    'deprecatedLeakCount',
    'unauthorizedWorkspaceHitCount',
    'provenanceLossCount',
    'attachOrMergeCalls',
    'holdoutOverlapCount',
    'daemonLookupCalls',
    'daemonStartCalls',
    'filesystemCacheReadCalls',
    'filesystemCacheWriteCalls',
    'filesystemIndexWriteCalls',
    'embeddingBuildCalls',
    'embeddingSaveCalls',
    'credibilityHitWriteCalls',
  ]) {
    assert.equal(verdict[counter], 0, counter);
  }
  const recomputed = recomputeBuiltAggregates(adapter, {
    qrels: validQrelsFixture,
    baseline: validBaselineFixture,
    corpus: validCorpusFixture,
    holdouts: validHoldoutsFixture,
  });
  assert.deepEqual(
    assertReportedAggregatesMatch(adapter.reported, recomputed.reported),
    recomputed.reported,
  );
});

test('rejects aggregate green with raw evidence fault', async () => {
  const faults = [
    ['short run', body => {
      body.evidence.queries[0].runs[0].results.pop();
    }, 'INVALID_BUILT_ADAPTER_CONTRACT'],
    ['missing cold warmup', body => {
      body.evidence.latency.wikiIndexWarmupSamples.pop();
    }, 'INVALID_BUILT_ADAPTER_CONTRACT'],
    ['unstable result ID', body => {
      const result = body.evidence.queries[0].runs[1].results[0];
      result.id = 'wiki:unrelated-release-notes';
    }, 'INVALID_BUILT_ADAPTER_CONTRACT'],
    ['forbidden event', body => {
      body.evidence.events.push({
        sequence: 1,
        event: 'daemon-start',
        site: 'fault',
        queryId: null,
      });
    }, 'BUILT_REPORTED_MISMATCH'],
    ['provenance drift', body => {
      body.evidence.queries[0].runs[0].results[0].provenance.path = 'tampered.ts';
    }, 'BUILT_REPORTED_MISMATCH'],
    ['workspace drift', body => {
      body.evidence.queries[0].runs[0].results[0].workspace = 'secret';
    }, 'BUILT_REPORTED_MISMATCH'],
    ['authorization drift', body => {
      body.evidence.queries[0].runs[0].results[0].authorized = false;
    }, 'BUILT_REPORTED_MISMATCH'],
    ['status drift', body => {
      body.evidence.queries[0].runs[0].results[0].status = 'deprecated';
    }, 'BUILT_REPORTED_MISMATCH'],
    ['kg latency breach', body => {
      body.evidence.latency.kgWarmSamplesMs.fill(40);
    }, 'BUILT_REPORTED_MISMATCH'],
    ['wiki query latency breach', body => {
      body.evidence.latency.wikiQuerySamplesMs.fill(50);
    }, 'BUILT_REPORTED_MISMATCH'],
    ['wiki index latency breach', body => {
      body.evidence.latency.wikiIndexSamples
        .slice(-5)
        .forEach(sample => { sample.durationMs = 500; });
    }, 'BUILT_REPORTED_MISMATCH'],
  ];
  for (const [label, mutateBody, code] of faults) {
    await assert.rejects(
      () => runFixtureBuiltPhase(`raw-fault-${label.replaceAll(' ', '-')}`, { mutateBody }),
      error => error.code === code,
      label,
    );
  }
});

test('parent rejects corpus hash drift and non-canonical lane ordering', () => {
  assert.deepEqual(validCorpusFixture.manifest.measurementLanes, [...SEARCH_MEASUREMENT_LANES]);

  const permutedCorpus = structuredClone(validCorpusFixture);
  [permutedCorpus.manifest.measurementLanes[0], permutedCorpus.manifest.measurementLanes[1]] = [
    permutedCorpus.manifest.measurementLanes[1],
    permutedCorpus.manifest.measurementLanes[0],
  ];
  assert.throws(
    () => deriveBuiltSearchAdapterExpected({
      workspaceRoot: temporaryRoot('permuted-lanes'),
      qrels: validQrelsFixture,
      corpus: permutedCorpus,
      qrelsSha256: validBaselineFixture.qrelsSha256,
    }),
    error => error.code === 'INVALID_RANKING_FIXTURES'
      && /corpus manifest does not match deterministic expansion/.test(error.message),
  );

  const mutatedCorpus = structuredClone(validCorpusFixture);
  mutatedCorpus.latencyCorpus.vocabulary[0] = 'hash-mutated-alpha';
  mutatedCorpus.manifest.expandedSha256 = expandedCorpusSha256(mutatedCorpus);
  assert.equal(
    mutatedCorpus.manifest.expandedDocumentCount,
    validCorpusFixture.manifest.expandedDocumentCount,
  );
  assert.equal(
    mutatedCorpus.manifest.wikiSourceDocumentCount,
    validCorpusFixture.manifest.wikiSourceDocumentCount,
  );
  const root = temporaryRoot('baseline-corpus-hash');
  const report = greenAdapterBody(root);
  assert.throws(
    () => recomputeBuiltAggregates(report, {
      qrels: validQrelsFixture,
      baseline: validBaselineFixture,
      corpus: mutatedCorpus,
      holdouts: validHoldoutsFixture,
    }),
    error => error.code === 'INVALID_RANKING_FIXTURES'
      && /baseline protocol does not match corpus manifest/.test(error.message),
  );
});

test('parent uses generated adapter contract', async () => {
  const check = spawnSync(
    process.execPath,
    ['scripts/generate-built-search-adapter-contract.mjs', '--check'],
    { cwd: repoRoot, shell: false, encoding: 'utf8' },
  );
  assert.equal(check.status, 0, check.stderr);
  const schemaBytes = readFileSync(
    join(repoRoot, 'src', 'search', 'evaluation', 'built-search-adapter-contract.json'),
  );
  assert.equal(
    SCHEMA_SHA256,
    createHash('sha256').update(schemaBytes).digest('hex'),
  );

  const root = temporaryRoot('generated-parent-contract');
  const adapterPath = join(root, 'compiled adapter.js');
  write(adapterPath, '// compiled fixture\n');
  const expected = expectedForWorkspace(root);
  assert.equal(parseBuiltSearchAdapterExpected(expected), expected);
  const body = greenAdapterBody(root);
  assert.equal(parseBuiltSearchAdapterReport(body, expected), body);
  const result = await runBuiltAdapterChild({
    workspaceRoot: root,
    adapterPath,
    expected,
    attestation: fixtureAttestation(),
    attestedSpawn: async options => fakeAttestedResult(body, options),
  });
  assert.equal(result.body, body);

  const source = readFileSync(
    join(repoRoot, 'scripts', 'check-search-ranking-release-machine.mjs'),
    'utf8',
  );
  assert.match(source, /parseBuiltSearchAdapterExpected/);
  assert.match(source, /parseBuiltSearchAdapterReport/);
  assert.match(source, /SCHEMA_SHA256/);
});

test('rejects all adapter contract drift classes', async () => {
  const root = temporaryRoot('adapter-contract-drift');
  const adapterPath = join(root, 'compiled adapter.js');
  write(adapterPath, '// compiled fixture\n');
  const expected = expectedForWorkspace(root);
  const valid = greenAdapterBody(root);
  const faults = [
    ['semantic', body => { body.qrelsSha256 = '0'.repeat(64); }],
    ['extra', body => { body.extra = true; }],
    ['missing', body => { delete body.evidence; }],
    ['null', body => { body.evidence = null; }],
    ['type', body => { body.evidence.latency.kgWarmSamplesMs[0] = '1'; }],
    ['enum', body => {
      body.evidence.events.push({
        sequence: 1,
        event: 'unknown-event',
        site: 'fault',
        queryId: null,
      });
    }],
    ['runtime', body => { body.runner.node = 'v0.0.0'; }],
  ];
  for (const [label, mutate] of faults) {
    const body = structuredClone(valid);
    mutate(body);
    assert.throws(
      () => parseBuiltAdapterContract(body, expected),
      error => error.code === 'INVALID_BUILT_ADAPTER_CONTRACT',
      label,
    );
  }

  const duplicateExpected = structuredClone(expected);
  duplicateExpected.queries[1].queryId = duplicateExpected.queries[0].queryId;
  assert.throws(
    () => parseBuiltSearchAdapterExpected(duplicateExpected),
    /queryId values must be unique/,
  );
  const functionDrift = structuredClone(expected);
  functionDrift.queries[0].function = 'WikiIndexer.searchWithMeta';
  assert.throws(
    () => parseBuiltSearchAdapterExpected(functionDrift),
    /provider\/function mismatch/,
  );
  const fixtureInput = greenFixtureInput(root);
  assert.throws(
    () => makeBuiltSearchAdapterFixture({ ...fixtureInput, events: null }),
    /BuiltSearchAdapterFixtureInput validation failed/,
  );
  assert.throws(
    () => makeBuiltSearchAdapterFixture({
      ...fixtureInput,
      wikiIndexSamples: fixtureInput.wikiIndexSamples.slice(1),
    }),
    /BuiltSearchAdapterFixtureInput validation failed/,
  );

  await assert.rejects(
    () => runBuiltAdapterChild({
      workspaceRoot: root,
      adapterPath,
      expected,
      attestation: {
        ...fixtureAttestation(),
        manifest: {
          ...fixtureAttestation().manifest,
          schemaSha256: '0'.repeat(64),
        },
      },
      attestedSpawn: async options => fakeAttestedResult(valid, options),
    }),
    error => error.code === 'BUILT_ADAPTER_SCHEMA_MISMATCH',
  );
});

test('release machine source never spawns npm or npm.cmd directly', () => {
  const source = readFileSync(
    join(repoRoot, 'scripts', 'check-search-ranking-release-machine.mjs'),
    'utf8',
  );
  const tests = readFileSync(
    join(repoRoot, 'scripts', '__tests__', 'check-search-ranking-release-machine.test.mjs'),
    'utf8',
  );
  for (const text of [source, tests]) {
    assert.doesNotMatch(text, /spawnSync\(\s*['"]npm(?:\.cmd)?['"]/);
  }
  assert.match(source, /command:\s*process\.execPath/);
  assert.match(source, /shell:\s*false/);
});

test('runs every built probe in a hermetic workspace', async () => {
  const root = temporaryRoot('built-probe');
  const adapterPath = join(root, 'compiled adapter.js');
  write(adapterPath, '// compiled fixture\n');
  const calls = [];
  const expected = expectedForWorkspace(root);
  const attestedSpawn = async options => {
    calls.push(options);
    const body = greenAdapterBody(root);
    return fakeAttestedResult(body, options);
  };

  const result = await runBuiltAdapterChild({
    attestedSpawn,
    attestation: fixtureAttestation(),
    workspaceRoot: root,
    adapterPath,
    expected,
  });

  assert.equal(result.trace.command, process.execPath);
  assert.equal(result.trace.cwd, root);
  assert.equal(result.trace.shell, false);
  assert.equal(result.trace.maestroProjectRoot, root);
  assert.equal(calls[0].args[0], adapterPath);
  assert.equal(calls[0].cwd, root);
  assert.equal(calls[0].projectRoot, root);
  assert.equal(calls[0].parentEnvironment.MAESTRO_PROJECT_ROOT, root);
  assert.notEqual(root, repoRoot);
});

test('rejects malformed generated adapter evidence', async () => {
  const root = temporaryRoot('built-envelope');
  const adapterPath = join(root, 'compiled adapter.js');
  write(adapterPath, '// compiled fixture\n');
  const valid = greenAdapterBody(root);
  const expected = expectedForWorkspace(root);

  for (const body of [
    {
      ...valid,
      extra: true,
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        queries: valid.evidence.queries.map((query, index) => index === 0
          ? {
              ...query,
              runs: [
                { results: [] },
                ...query.runs.slice(1),
              ],
            }
          : query),
      },
    },
    {
      ...valid,
      protectedState: {
        before: valid.protectedState.before,
        after: {},
        unchanged: true,
      },
    },
  ]) {
    await assert.rejects(
      () => runBuiltAdapterChild({
        workspaceRoot: root,
        adapterPath,
        attestation: fixtureAttestation(),
        attestedSpawn: async options => fakeAttestedResult(body, options),
        expected,
      }),
      error => error.code === 'INVALID_BUILT_ADAPTER_CONTRACT',
    );
  }
});

test('derives built fields only from compiled production adapter ownership', () => {
  assert.equal(resolve(builtSearchAdapterPath), builtSearchAdapterPath);
  const source = readFileSync(
    join(repoRoot, 'scripts', 'check-search-ranking-release-machine.mjs'),
    'utf8',
  );
  const builtPhase = source.slice(
    source.indexOf('export async function runBuiltPhase'),
    source.indexOf('export function validatePackageWiring'),
  );
  assert.match(builtPhase, /adapter\.rawBody/);
  assert.match(builtPhase, /recomputeBuiltAggregates/);
  assert.doesNotMatch(
    builtPhase,
    /rankPrepared|measurePreparedLatency|measureWikiLatency/,
  );
});

test('propagates a compiled production adapter fault as non-zero', async () => {
  const root = temporaryRoot('built-fault');
  const adapterPath = join(root, 'compiled adapter.js');
  write(adapterPath, '// compiled fixture\n');

  await assert.rejects(
    () => runBuiltAdapterChild({
      workspaceRoot: root,
      adapterPath,
      attestation: fixtureAttestation(),
      expected: expectedForWorkspace(root),
      attestedSpawn: async () => {
        throw new ModuleAttestationError(
          'ATTESTATION_CHILD_FAILED',
          'attested child exit did not match a valid transcript',
          {
            status: 9,
            stderr: '{"code":"BUILT_RANKING_GATE"}',
          },
        );
      },
    }),
    error => error.code === 'ATTESTATION_CHILD_FAILED'
      && error.details.status === 9
      && error.details.stderr.includes('BUILT_RANKING_GATE'),
  );
});

function fixtureModuleUrl(path) {
  return pathToFileURL(resolve(path)).href;
}

function dynamicEdgeRow(probeId, caller, specifier, resolvedUrl, guard) {
  return {
    probe_id: probeId,
    caller,
    specifier,
    resolved_url: resolvedUrl,
    guard,
  };
}

function sourceHashes(paths) {
  return Object.fromEntries(paths.map(path => {
    const url = path instanceof URL ? path.href : fixtureModuleUrl(path);
    return [
      url,
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    ];
  }));
}

function protocolManifest(bootstrapBuffer, modulePaths, {
  probeId = 'read-only-probe',
  schemaSha256 = '4'.repeat(64),
} = {}) {
  return createAttestationManifest({
    probeId,
    schemaSha256,
    bootstrapBuffer,
    moduleSourceHashes: sourceHashes(modulePaths),
  });
}

async function spawnBootstrapFault({
  bootstrapBuffer,
  keyBytes,
  manifestBytes,
  closeKey = true,
  closeManifest = true,
  timeoutMs = 5_000,
}) {
  const bootstrapUrl =
    `data:text/javascript;base64,${bootstrapBuffer.toString('base64')}`;
  const child = spawn(
    process.execPath,
    [
      '--import',
      bootstrapUrl,
      '--input-type=module',
      '--eval',
      'process.stdout.write(JSON.stringify({ ok: true }))',
    ],
    {
      shell: false,
      cwd: repoRoot,
      env: sanitizeAttestationEnvironment(process.env, {
        projectRoot: repoRoot,
      }),
      stdio: [...ATTESTATION_STDIO],
      windowsHide: true,
    },
  );
  const stdout = [];
  const stderr = [];
  const fd5 = [];
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  child.stdio[5].on('data', chunk => fd5.push(Buffer.from(chunk)));
  if (closeKey) child.stdio[3].end(keyBytes);
  else child.stdio[3].write(keyBytes);
  if (closeManifest) child.stdio[4].end(manifestBytes);
  else child.stdio[4].write(manifestBytes);
  return new Promise(resolvePromise => {
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolvePromise({
        status,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        fd5: Buffer.concat(fd5),
      });
    });
  });
}

test('derives static closure plus current probe permitted dynamics', () => {
  const root = temporaryRoot('module-closure');
  const readEntry = join(root, 'read-entry.mjs');
  const alternateEntry = join(root, 'alternate-entry.mjs');
  write(readEntry, [
    "import './read-static.mjs';",
    "export { readExport } from './read-export.mjs';",
    "if (globalThis.enableReadDynamic) await import('./read-dynamic.mjs');",
    "if (globalThis.enableDisabledDynamic) await import('./read-disabled.mjs');",
  ].join('\n'));
  write(join(root, 'read-static.mjs'), 'export const readStatic = true;\n');
  write(join(root, 'read-export.mjs'), 'export const readExport = true;\n');
  write(
    join(root, 'read-dynamic.mjs'),
    "import './read-dynamic-leaf.mjs';\nexport const readDynamic = true;\n",
  );
  write(join(root, 'read-dynamic-leaf.mjs'), 'export const leaf = true;\n');
  write(join(root, 'read-disabled.mjs'), 'export const disabled = true;\n');
  write(alternateEntry, [
    "import './alternate-static.mjs';",
    "if (globalThis.enableAlternate) await import('./alternate-dynamic.mjs');",
  ].join('\n'));
  write(join(root, 'alternate-static.mjs'), 'export const alternateStatic = true;\n');
  write(join(root, 'alternate-dynamic.mjs'), 'export const alternateDynamic = true;\n');

  const readEntryUrl = fixtureModuleUrl(readEntry);
  const alternateEntryUrl = fixtureModuleUrl(alternateEntry);
  const result = deriveProbeModuleAttestation({
    certifiedRoots: [root],
    probes: [
      {
        probeId: 'read-only-probe',
        entry: readEntry,
        guards: { 'read-dynamic': true, 'disabled-dynamic': false },
      },
      {
        probeId: 'alternate-probe',
        entry: alternateEntry,
        guards: { 'alternate-dynamic': true },
      },
    ],
    manifest: [
      dynamicEdgeRow(
        'read-only-probe',
        readEntryUrl,
        './read-dynamic.mjs',
        fixtureModuleUrl(join(root, 'read-dynamic.mjs')),
        'read-dynamic',
      ),
      dynamicEdgeRow(
        'alternate-probe',
        alternateEntryUrl,
        './alternate-dynamic.mjs',
        fixtureModuleUrl(join(root, 'alternate-dynamic.mjs')),
        'alternate-dynamic',
      ),
      dynamicEdgeRow(
        'read-only-probe',
        readEntryUrl,
        './read-disabled.mjs',
        fixtureModuleUrl(join(root, 'read-disabled.mjs')),
        'disabled-dynamic',
      ),
    ],
  });

  assert.deepEqual(result.probes['read-only-probe'].static_closure, [
    fixtureModuleUrl(readEntry),
    fixtureModuleUrl(join(root, 'read-export.mjs')),
    fixtureModuleUrl(join(root, 'read-static.mjs')),
  ].sort());
  assert.deepEqual(result.probes['read-only-probe'].expected_urls, [
    fixtureModuleUrl(readEntry),
    fixtureModuleUrl(join(root, 'read-static.mjs')),
    fixtureModuleUrl(join(root, 'read-export.mjs')),
    fixtureModuleUrl(join(root, 'read-dynamic.mjs')),
    fixtureModuleUrl(join(root, 'read-dynamic-leaf.mjs')),
  ].sort());
  assert.deepEqual(result.probes['alternate-probe'].expected_urls, [
    fixtureModuleUrl(alternateEntry),
    fixtureModuleUrl(join(root, 'alternate-static.mjs')),
    fixtureModuleUrl(join(root, 'alternate-dynamic.mjs')),
  ].sort());
  assert.notDeepEqual(
    result.probes['read-only-probe'].expected_urls,
    result.probes['alternate-probe'].expected_urls,
  );
  assert.equal(result.probes['read-only-probe'].possible_dynamic_edges.length, 2);
  assert.equal(result.probes['read-only-probe'].permitted_dynamic_edges.length, 1);
  assert.equal(
    result.probes['read-only-probe'].expected_urls.includes(
      fixtureModuleUrl(join(root, 'read-disabled.mjs')),
    ),
    false,
  );
});

test('read-only manifest excludes forbidden and other-probe edges in dynamic-edge manifest', () => {
  const root = temporaryRoot('probe-specific-manifest');
  const readEntry = join(root, 'read-entry.mjs');
  const alternateEntry = join(root, 'alternate-entry.mjs');
  write(readEntry, "await import('./read-safe.mjs');\n");
  write(join(root, 'read-safe.mjs'), 'export const safe = true;\n');
  write(alternateEntry, "await import('./daemon-start.mjs');\n");
  write(join(root, 'daemon-start.mjs'), 'export const started = false;\n');

  const manifest = [
    dynamicEdgeRow(
      'read-only-probe',
      fixtureModuleUrl(readEntry),
      './read-safe.mjs',
      fixtureModuleUrl(join(root, 'read-safe.mjs')),
      'read-safe',
    ),
    dynamicEdgeRow(
      'alternate-probe',
      fixtureModuleUrl(alternateEntry),
      './daemon-start.mjs',
      fixtureModuleUrl(join(root, 'daemon-start.mjs')),
      'daemon-start',
    ),
  ];
  const result = deriveProbeModuleAttestation({
    certifiedRoots: [root],
    probes: [
      {
        probeId: 'read-only-probe',
        entry: readEntry,
        guards: { 'read-safe': true },
      },
      {
        probeId: 'alternate-probe',
        entry: alternateEntry,
        guards: { 'daemon-start': true },
      },
    ],
    manifest,
  });

  const readOnly = result.probes['read-only-probe'];
  assert.equal(
    readOnly.permitted_dynamic_edges.some(
      row => READ_ONLY_FORBIDDEN_GUARDS.includes(row.guard),
    ),
    false,
  );
  assert.equal(
    readOnly.expected_urls.includes(fixtureModuleUrl(join(root, 'daemon-start.mjs'))),
    false,
  );
  assert.equal(
    result.probes['alternate-probe'].expected_urls.includes(
      fixtureModuleUrl(join(root, 'daemon-start.mjs')),
    ),
    true,
  );

  const productionManifest = loadProbeDynamicEdgeManifest(
    join(repoRoot, 'scripts', 'search-ranking-probe-dynamic-edges.json'),
  );
  assert.equal(
    productionManifest
      .filter(row => row.probe_id === 'read-only-probe')
      .some(row => READ_ONLY_FORBIDDEN_GUARDS.includes(row.guard)),
    false,
  );
  assert.equal(
    productionManifest.some(row => (
      Object.hasOwn(row, 'expected_files')
      || Object.hasOwn(row, 'expected_urls')
    )),
    false,
  );
});

test('rejects invalid dynamic closure manifest', () => {
  const cases = [
    {
      label: 'nonliteral dynamic import',
      expectedCode: 'NONLITERAL_DYNAMIC_IMPORT',
      source: "const target = './dynamic.mjs';\nawait import(target);\n",
      files: { 'dynamic.mjs': 'export const dynamic = true;\n' },
      manifest: () => [],
      guards: {},
    },
    {
      label: 'ambiguous resolution',
      expectedCode: 'AMBIGUOUS_MODULE_RESOLUTION',
      source: "await import('./ambiguous');\n",
      files: {
        'ambiguous.js': 'export const js = true;\n',
        'ambiguous.mjs': 'export const mjs = true;\n',
      },
      manifest: () => [],
      guards: {},
    },
    {
      label: 'escaping resolution',
      expectedCode: 'MODULE_RESOLUTION_ESCAPE',
      source: "await import('../outside.mjs');\n",
      outside: 'export const outside = true;\n',
      manifest: () => [],
      guards: {},
    },
    {
      label: 'duplicate row',
      expectedCode: 'DUPLICATE_DYNAMIC_EDGE_ROW',
      source: "await import('./dynamic.mjs');\n",
      files: { 'dynamic.mjs': 'export const dynamic = true;\n' },
      manifest: ({ entryUrl, dynamicUrl }) => {
        const row = dynamicEdgeRow(
          'read-only-probe',
          entryUrl,
          './dynamic.mjs',
          dynamicUrl,
          'safe',
        );
        return [row, { ...row }];
      },
      guards: { safe: true },
    },
    {
      label: 'unknown guard',
      expectedCode: 'UNKNOWN_DYNAMIC_EDGE_GUARD',
      source: "await import('./dynamic.mjs');\n",
      files: { 'dynamic.mjs': 'export const dynamic = true;\n' },
      manifest: ({ entryUrl, dynamicUrl }) => [dynamicEdgeRow(
        'read-only-probe',
        entryUrl,
        './dynamic.mjs',
        dynamicUrl,
        'unknown',
      )],
      guards: { safe: true },
    },
    {
      label: 'unknown probe',
      expectedCode: 'UNKNOWN_DYNAMIC_EDGE_PROBE',
      source: "await import('./dynamic.mjs');\n",
      files: { 'dynamic.mjs': 'export const dynamic = true;\n' },
      manifest: ({ entryUrl, dynamicUrl }) => [dynamicEdgeRow(
        'other-probe',
        entryUrl,
        './dynamic.mjs',
        dynamicUrl,
        'safe',
      )],
      guards: { safe: true },
    },
    {
      label: 'forbidden read-only row',
      expectedCode: 'FORBIDDEN_DYNAMIC_EDGE_GUARD',
      source: "await import('./dynamic.mjs');\n",
      files: { 'dynamic.mjs': 'export const dynamic = true;\n' },
      manifest: ({ entryUrl, dynamicUrl }) => [dynamicEdgeRow(
        'read-only-probe',
        entryUrl,
        './dynamic.mjs',
        dynamicUrl,
        'daemon-start',
      )],
      guards: { 'daemon-start': true },
    },
    {
      label: 'resolved URL mismatch',
      expectedCode: 'DYNAMIC_EDGE_RESOLUTION_MISMATCH',
      source: "await import('./dynamic.mjs');\n",
      files: {
        'dynamic.mjs': 'export const dynamic = true;\n',
        'wrong.mjs': 'export const wrong = true;\n',
      },
      manifest: ({ entryUrl, wrongUrl }) => [dynamicEdgeRow(
        'read-only-probe',
        entryUrl,
        './dynamic.mjs',
        wrongUrl,
        'safe',
      )],
      guards: { safe: true },
    },
  ];

  for (const testCase of cases) {
    const container = temporaryRoot(`invalid-closure-${testCase.label.replaceAll(' ', '-')}`);
    const root = join(container, 'certified');
    const entry = join(root, 'entry.mjs');
    write(entry, testCase.source);
    for (const [name, source] of Object.entries(testCase.files ?? {})) {
      write(join(root, name), source);
    }
    if (testCase.outside) write(join(container, 'outside.mjs'), testCase.outside);
    const values = {
      entryUrl: fixtureModuleUrl(entry),
      dynamicUrl: fixtureModuleUrl(join(root, 'dynamic.mjs')),
      wrongUrl: fixtureModuleUrl(join(root, 'wrong.mjs')),
    };

    assert.throws(
      () => deriveProbeModuleAttestation({
        certifiedRoots: [root],
        probes: [{
          probeId: 'read-only-probe',
          entry,
          guards: testCase.guards,
        }],
        manifest: testCase.manifest(values),
      }),
      error => error instanceof ModuleAttestationError
        && error.code === testCase.expectedCode,
      testCase.label,
    );
  }
});

test('boots certified data URL with authenticated three-pipe transcript', async () => {
  const root = temporaryRoot('certified-three-pipe');
  const entry = join(root, 'entry.mjs');
  write(entry, [
    'const evidence = {',
    '  ok: true,',
    '  environmentKeys: Object.keys(process.env).sort(),',
    '  nodeOptions: process.env.NODE_OPTIONS ?? null,',
    '  inheritedSecret: process.env.ATTESTATION_TEST_SECRET ?? null,',
    '};',
    'process.stdout.write(JSON.stringify(evidence));',
  ].join('\n'));
  const bootstrapBuffer = extractCertifiedBootstrapBuffer(readFileSync(
    join(repoRoot, 'scripts', 'search-ranking-module-attestation.mjs'),
  ));
  const manifest = protocolManifest(bootstrapBuffer, [entry]);
  const result = await runCertifiedAttestedChild({
    args: [entry],
    cwd: root,
    projectRoot: root,
    bootstrapBuffer,
    manifest,
    parentEnvironment: {
      ...process.env,
      NODE_OPTIONS: '--import=forbidden-loader.mjs',
      NODE_PATH: join(root, 'forbidden-node-path'),
      ATTESTATION_TEST_SECRET: 'must-not-cross',
      MAESTRO_PROJECT_ROOT: join(root, 'wrong-root'),
    },
  });

  assert.equal(result.transcript.type, ATTESTATION_TRANSCRIPT_TYPE);
  assert.equal(result.transcript.nonce, manifest.nonce);
  assert.equal(result.transcript.probeId, manifest.probeId);
  assert.deepEqual(result.transcript.observedUrls, manifest.expectedUrls);
  assert.deepEqual(result.transcript.sourceHashes, manifest.sourceHashes);
  assert.equal(result.transcript.rawEvidence.nodeOptions, null);
  assert.equal(result.transcript.rawEvidence.inheritedSecret, null);
  assert.deepEqual(
    result.transcript.rawEvidence.environmentKeys,
    result.trace.environmentKeys,
  );
  assert.deepEqual(result.trace.stdio, [...ATTESTATION_STDIO]);
  assert.equal(result.trace.args[0], '--import');
  assert.match(result.trace.args[1], /^data:text\/javascript;base64,/);
  assert.equal(result.trace.args[1].includes('search-ranking-module-attestation.mjs'), false);
  assert.deepEqual(
    result.trace.environmentKeys.filter(key => !ATTESTATION_ENV_ALLOWLIST.includes(key)),
    [],
  );
});

test('enforces exact current-probe load transcript', async () => {
  const root = temporaryRoot('exact-current-probe');
  const readEntry = join(root, 'read-entry.mjs');
  const staticModule = join(root, 'static.mjs');
  const dynamicModule = join(root, 'dynamic.mjs');
  const otherEntry = join(root, 'other-entry.mjs');
  const otherModule = join(root, 'other.mjs');
  write(staticModule, 'export const staticValue = 1;\n');
  write(dynamicModule, 'export const dynamicValue = 2;\n');
  write(otherModule, [
    'globalThis.otherProbeExecuted = (globalThis.otherProbeExecuted ?? 0) + 1;',
    'export const other = true;',
  ].join('\n'));
  write(readEntry, [
    "import { staticValue } from './static.mjs';",
    "const { dynamicValue } = await import('./dynamic.mjs');",
    'process.stdout.write(JSON.stringify({',
    '  sum: staticValue + dynamicValue,',
    '  daemonStartCalls: 0,',
    '  embeddingBuildCalls: 0,',
    '  embeddingAdminCalls: 0,',
    '  otherProbeExecuted: globalThis.otherProbeExecuted ?? 0,',
    '}));',
  ].join('\n'));
  write(otherEntry, [
    "await import('./other.mjs');",
    'process.stdout.write(JSON.stringify({ other: true }));',
  ].join('\n'));

  const readEntryUrl = fixtureModuleUrl(readEntry);
  const otherEntryUrl = fixtureModuleUrl(otherEntry);
  const derivation = deriveProbeModuleAttestation({
    certifiedRoots: [root],
    probes: [
      {
        probeId: 'read-only-probe',
        entry: readEntry,
        guards: { 'wiki-search': true },
      },
      {
        probeId: 'other-probe',
        entry: otherEntry,
        guards: { 'other-branch': true },
      },
    ],
    manifest: [
      dynamicEdgeRow(
        'read-only-probe',
        readEntryUrl,
        './dynamic.mjs',
        fixtureModuleUrl(dynamicModule),
        'wiki-search',
      ),
      dynamicEdgeRow(
        'other-probe',
        otherEntryUrl,
        './other.mjs',
        fixtureModuleUrl(otherModule),
        'other-branch',
      ),
    ],
  });
  const expected = derivation.probes['read-only-probe'].expected_urls;
  assert.equal(expected.includes(fixtureModuleUrl(otherEntry)), false);
  assert.equal(expected.includes(fixtureModuleUrl(otherModule)), false);

  const bootstrapBuffer = extractCertifiedBootstrapBuffer(readFileSync(
    join(repoRoot, 'scripts', 'search-ranking-module-attestation.mjs'),
  ));
  const manifest = createAttestationManifest({
    probeId: 'read-only-probe',
    schemaSha256: '5'.repeat(64),
    bootstrapBuffer,
    moduleSourceHashes: sourceHashes(
      expected.map(url => new URL(url)),
    ),
  });
  const result = await runCertifiedAttestedChild({
    args: [readEntry],
    cwd: root,
    projectRoot: root,
    bootstrapBuffer,
    manifest,
  });

  assert.deepEqual(result.transcript.observedUrls, expected);
  assert.equal(result.transcript.rawEvidence.sum, 3);
  assert.equal(result.transcript.rawEvidence.daemonStartCalls, 0);
  assert.equal(result.transcript.rawEvidence.embeddingBuildCalls, 0);
  assert.equal(result.transcript.rawEvidence.embeddingAdminCalls, 0);
  assert.equal(result.transcript.rawEvidence.otherProbeExecuted, 0);
});

test('rejects hook transcript faults without requiring other probes', async () => {
  const bootstrapBuffer = extractCertifiedBootstrapBuffer(readFileSync(
    join(repoRoot, 'scripts', 'search-ranking-module-attestation.mjs'),
  ));
  const key = Buffer.alloc(32, 7);
  const manifest = createAttestationManifest({
    probeId: 'read-only-probe',
    schemaSha256: '6'.repeat(64),
    bootstrapBuffer,
    moduleSourceHashes: {},
    nonce: Buffer.alloc(32, 8),
  });
  const unsigned = {
    type: ATTESTATION_TRANSCRIPT_TYPE,
    nonce: manifest.nonce,
    probeId: manifest.probeId,
    rawEvidence: {
      daemonStartCalls: 0,
      embeddingBuildCalls: 0,
      otherProbeExecuted: 0,
    },
    observedUrls: [],
    sourceHashes: manifest.sourceHashes,
  };
  const signed = value => ({
    ...value,
    hmacSha256: authenticateAttestationTranscript(key, manifest, value),
  });
  const validFrame = encodeAttestationFrame(signed(unsigned));
  assert.deepEqual(
    verifyAttestationTranscript(validFrame, { key, manifest }).rawEvidence,
    unsigned.rawEvidence,
  );

  await assert.rejects(
    () => assertCertifiedAttestationRuntime({ nodeVersion: '23.0.0' }),
    error => error.code === 'UNSUPPORTED_ATTESTATION_RUNTIME',
  );
  await assert.rejects(
    () => assertCertifiedAttestationRuntime({
      nodeVersion: '22.19.0',
      moduleApi: {},
    }),
    error => error.code === 'REGISTER_HOOKS_UNAVAILABLE',
  );
  assert.throws(
    () => createAttestationManifest({
      probeId: 'read-only-probe',
      schemaSha256: '6'.repeat(64),
      bootstrapBuffer: join(repoRoot, 'scripts', 'search-ranking-module-attestation.mjs'),
      moduleSourceHashes: {},
    }),
    error => error.code === 'UNCERTIFIED_ATTESTATION_BOOTSTRAP',
  );

  const sanitized = sanitizeAttestationEnvironment({
    PATH: 'allowed',
    NODE_OPTIONS: '--require=forbidden.cjs',
    NODE_COMPILE_CACHE: 'forbidden-cache',
    NODE_PATH: 'forbidden-path',
    SECRET_TOKEN: 'forbidden-secret',
  }, { projectRoot: repoRoot });
  assert.deepEqual(sanitized, {
    PATH: 'allowed',
    MAESTRO_PROJECT_ROOT: repoRoot,
  });

  for (const [label, frame, code] of [
    ['missing header', validFrame.subarray(0, 3), 'TRUNCATED_ATTESTATION_FRAME'],
    ['truncated body', validFrame.subarray(0, -1), 'TRUNCATED_ATTESTATION_FRAME'],
    ['extra byte', Buffer.concat([validFrame, Buffer.from([0])]), 'TRAILING_ATTESTATION_BYTES'],
    ['extra frame', Buffer.concat([validFrame, validFrame]), 'TRAILING_ATTESTATION_BYTES'],
  ]) {
    assert.throws(
      () => decodeAttestationFrame(frame),
      error => error.code === code,
      label,
    );
  }
  const noncanonicalBody = Buffer.from('{"z":1,"a":2}', 'utf8');
  const noncanonicalFrame = Buffer.alloc(4 + noncanonicalBody.length);
  noncanonicalFrame.writeUInt32BE(noncanonicalBody.length, 0);
  noncanonicalBody.copy(noncanonicalFrame, 4);
  assert.throws(
    () => decodeAttestationFrame(noncanonicalFrame),
    error => error.code === 'NONCANONICAL_ATTESTATION_JSON',
  );

  const semanticFaults = [
    ['wrong nonce', { ...unsigned, nonce: '9'.repeat(64) }, 'INVALID_ATTESTATION_TRANSCRIPT'],
    ['wrong type', { ...unsigned, type: 'attestation-transcript/0' }, 'INVALID_ATTESTATION_TRANSCRIPT'],
    ['wrong probe', { ...unsigned, probeId: 'other-probe' }, 'INVALID_ATTESTATION_TRANSCRIPT'],
    ['forbidden/extra URL', {
      ...unsigned,
      observedUrls: [fixtureModuleUrl(join(repoRoot, 'package.json'))],
    }, 'ATTESTATION_CLOSURE_MISMATCH'],
    ['source hash drift', {
      ...unsigned,
      sourceHashes: {
        ...unsigned.sourceHashes,
        bootstrapSha256: '0'.repeat(64),
      },
    }, 'ATTESTATION_SOURCE_HASH_MISMATCH'],
  ];
  for (const [label, value, code] of semanticFaults) {
    assert.throws(
      () => verifyAttestationTranscript(
        encodeAttestationFrame(signed(value)),
        { key, manifest },
      ),
      error => error.code === code,
      label,
    );
  }
  const missingUrlManifest = createAttestationManifest({
    probeId: 'read-only-probe',
    schemaSha256: '6'.repeat(64),
    bootstrapBuffer,
    moduleSourceHashes: sourceHashes([join(repoRoot, 'package.json')]),
    nonce: Buffer.alloc(32, 8),
  });
  const missingUrlTranscript = {
    ...unsigned,
    sourceHashes: missingUrlManifest.sourceHashes,
  };
  assert.throws(
    () => verifyAttestationTranscript(
      encodeAttestationFrame({
        ...missingUrlTranscript,
        hmacSha256: authenticateAttestationTranscript(
          key,
          missingUrlManifest,
          missingUrlTranscript,
        ),
      }),
      { key, manifest: missingUrlManifest },
    ),
    error => error.code === 'ATTESTATION_CLOSURE_MISMATCH',
    'missing URL',
  );
  assert.throws(
    () => verifyAttestationTranscript(
      encodeAttestationFrame({
        ...signed(unsigned),
        hmacSha256: '0'.repeat(64),
      }),
      { key, manifest },
    ),
    error => error.code === 'ATTESTATION_HMAC_MISMATCH',
  );

  const malformedKey = await spawnBootstrapFault({
    bootstrapBuffer,
    keyBytes: Buffer.alloc(33, 1),
    manifestBytes: encodeAttestationFrame(manifest),
  });
  assert.notEqual(malformedKey.status, 0);
  assert.equal(malformedKey.fd5.length, 0);
  assert.match(malformedKey.stderr.toString('utf8'), /exactly 32 bytes/);

  const malformedManifest = await spawnBootstrapFault({
    bootstrapBuffer,
    keyBytes: Buffer.alloc(32, 1),
    manifestBytes: encodeAttestationFrame(manifest).subarray(0, -1),
  });
  assert.notEqual(malformedManifest.status, 0);
  assert.equal(malformedManifest.fd5.length, 0);
  assert.match(malformedManifest.stderr.toString('utf8'), /TRUNCATED_ATTESTATION_FRAME|truncated/i);

  const missingKeyEof = await spawnBootstrapFault({
    bootstrapBuffer,
    keyBytes: Buffer.alloc(32, 1),
    manifestBytes: encodeAttestationFrame(manifest),
    closeKey: false,
    timeoutMs: 300,
  });
  assert.notEqual(missingKeyEof.status, 0);
  assert.equal(missingKeyEof.fd5.length, 0);

  const missingManifestEof = await spawnBootstrapFault({
    bootstrapBuffer,
    keyBytes: Buffer.alloc(32, 1),
    manifestBytes: encodeAttestationFrame(manifest),
    closeManifest: false,
    timeoutMs: 300,
  });
  assert.notEqual(missingManifestEof.status, 0);
  assert.equal(missingManifestEof.fd5.length, 0);

  const reversedBootstrap = Buffer.from([
    "import { readFileSync, writeSync } from 'node:fs';",
    'writeSync(3, Buffer.from([1]));',
    'writeSync(4, Buffer.from([1]));',
    'readFileSync(5);',
  ].join('\n'));
  const reversedManifest = createAttestationManifest({
    probeId: 'read-only-probe',
    schemaSha256: '7'.repeat(64),
    bootstrapBuffer: reversedBootstrap,
    moduleSourceHashes: {},
  });
  await assert.rejects(
    () => runCertifiedAttestedChild({
      args: [
        '--input-type=module',
        '--eval',
        'process.stdout.write(JSON.stringify({ ok: true }))',
      ],
      cwd: repoRoot,
      projectRoot: repoRoot,
      bootstrapBuffer: reversedBootstrap,
      manifest: reversedManifest,
      timeoutMs: 300,
    }),
    error => error.code === 'ATTESTATION_TIMEOUT'
      || error.code === 'ATTESTATION_PARENT_WRITE_FAILED',
  );

  const nonliteralRoot = temporaryRoot('fault-nonliteral');
  const nonliteralEntry = join(nonliteralRoot, 'entry.mjs');
  write(nonliteralEntry, "const target = './dynamic.mjs';\nawait import(target);\n");
  write(join(nonliteralRoot, 'dynamic.mjs'), 'export const dynamic = true;\n');
  assert.throws(
    () => deriveProbeModuleAttestation({
      certifiedRoots: [nonliteralRoot],
      probes: [{
        probeId: 'read-only-probe',
        entry: nonliteralEntry,
        guards: {},
      }],
      manifest: [],
    }),
    error => error.code === 'NONLITERAL_DYNAMIC_IMPORT',
  );
  assert.equal(unsigned.rawEvidence.otherProbeExecuted, 0);
  assert.equal(canonicalJsonBuffer({ z: 1, a: 2 }).toString('utf8'), '{"a":2,"z":1}');
});
