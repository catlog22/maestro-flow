import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  NATIVE_PROTOCOL,
  NATIVE_RECEIPT_SCHEMA,
  NATIVE_TARGETS,
  NATIVE_TASK_ID,
} from '../write-lifecycle-fs-native-receipt.mjs';
import {
  NATIVE_AGGREGATE_SCHEMA,
  NATIVE_JOB_IDS,
  verifyNativeAggregate,
  verifyNativeWorkflowDocument,
} from '../verify-lifecycle-fs-native-aggregate.mjs';

const workflowPath = new URL('../native-lifecycle-workflow-overlay.yml', import.meta.url);
const workflowSource = readFileSync(workflowPath, 'utf8');
const sourceSha = '0123456789abcdef0123456789abcdef01234567';
const dispatchNonce = 'maestro-search-ranking-exec-20260723-102551-20260724-010-plan-TASK-013-attempt-1';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function temporaryDirectory(label) {
  return mkdtempSync(join(tmpdir(), `maestro-${label}-`));
}

function artifactName(jobId, sha = sourceSha) {
  const target = NATIVE_TARGETS[jobId];
  return `lifecycle-fs-${target.platform}-${target.arch}-${sha}`;
}

function receiptFor(jobId, binaryBytes, overrides = {}) {
  const target = NATIVE_TARGETS[jobId];
  return {
    schema_version: NATIVE_RECEIPT_SCHEMA,
    task_id: NATIVE_TASK_ID,
    job_id: jobId,
    runner: target.runner,
    target: target.target,
    platform: target.platform,
    arch: target.arch,
    artifact_name: artifactName(jobId),
    binary_path: target.binaryPath,
    protocol: NATIVE_PROTOCOL,
    binary_sha256: sha256(binaryBytes),
    source_sha: sourceSha,
    dispatch_nonce: dispatchNonce,
    run_name: `native-lifecycle-${sourceSha}-${dispatchNonce}`,
    ...overrides,
  };
}

function createArtifactTree(root, mutate) {
  for (const jobId of NATIVE_JOB_IDS) {
    const binaryBytes = Buffer.from(`native-binary:${jobId}\0${sourceSha}`);
    const artifactRoot = join(root, artifactName(jobId));
    const target = NATIVE_TARGETS[jobId];
    const binaryPath = join(artifactRoot, ...target.binaryPath.split('/'));
    mkdirSync(dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, binaryBytes);
    const receipt = receiptFor(jobId, binaryBytes);
    mutate?.({ jobId, artifactRoot, binaryPath, binaryBytes, receipt });
    writeFileSync(join(artifactRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  }
}

function withArtifactTree(label, callback, mutate) {
  const root = temporaryDirectory(label);
  try {
    createArtifactTree(root, mutate);
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertWorkflowRejected(source, label) {
  assert.throws(() => verifyNativeWorkflowDocument(source), /native aggregate:/, label);
}

test('declares five independent native receipt jobs and aggregate', () => {
  const workflow = verifyNativeWorkflowDocument(workflowSource);
  assert.equal(workflow.name, 'Native Lifecycle Artifact Build');
  assert.equal(
    workflow['run-name'],
    'native-lifecycle-${{ inputs.source_sha }}-${{ inputs.dispatch_nonce }}',
  );
  assert.deepEqual(
    Object.keys(workflow.on.workflow_dispatch.inputs).sort(),
    ['dispatch_nonce', 'source_sha'],
  );
  assert.deepEqual(Object.keys(workflow.jobs), [...NATIVE_JOB_IDS, 'aggregate']);
  assert.deepEqual(workflow.jobs.aggregate.needs, NATIVE_JOB_IDS);
  assert.equal(workflow.jobs['win32-x64']['runs-on'], 'windows-2025');
  assert.equal(workflow.jobs['linux-x64']['runs-on'], 'ubuntu-24.04');
  assert.equal(workflow.jobs['linux-arm64']['runs-on'], 'ubuntu-24.04-arm');
  assert.equal(workflow.jobs['darwin-x64']['runs-on'], 'macos-15-intel');
  assert.equal(workflow.jobs['darwin-arm64']['runs-on'], 'macos-15');
  assert.doesNotMatch(workflowSource, /deploy-pages|configure-pages|upload-pages-artifact|github-pages/i);
});

test('rejects incomplete native workflow', () => {
  const mutations = [
    ['missing source_sha input', source => source.replace(/      source_sha:[\s\S]*?        type: string\r?\n/, '')],
    ['renamed dispatch_nonce input', source => source.replace('      dispatch_nonce:', '      reused_nonce:')],
    ['changed run-name', source => source.replace('native-lifecycle-${{ inputs.source_sha }}-${{ inputs.dispatch_nonce }}', 'native-lifecycle-broken')],
    ['invalid nonce regex', source => source.replace('attempt-[1-9][0-9]{0,5}$', 'attempt-[0-9]+$')],
    ['changed nonce ceiling', source => source.replace('if ($nonce.Length -gt 128)', 'if ($nonce.Length -gt 129)')],
    ['changed pinned runner', source => source.replace('runs-on: windows-2025', 'runs-on: windows-latest')],
    ['changed pinned target', source => source.replaceAll('x86_64-pc-windows-msvc', 'x86_64-pc-windows-gnu')],
    ['removed native test', source => source.replace('cargo test --release --locked', 'cargo nextest run --release --locked')],
    ['removed protocol receipt probe', source => source.replace('write-lifecycle-fs-native-receipt.mjs', 'write-untrusted-receipt.mjs')],
    ['changed binary path', source => source.replace('release/lifecycle-fs-helper.exe', 'release/untrusted.exe')],
    ['changed artifact staging path', source => source.replace('.workflow/native-artifacts/win32-x64', '.workflow/native-artifacts/unbound')],
    ['changed source_sha receipt binding', source => source.replace('--source-sha "${{ inputs.source_sha }}"', '--source-sha "0"')],
    ['changed job artifact upload', source => source.replace('name: lifecycle-fs-linux-x64-${{ inputs.source_sha }}', 'name: lifecycle-fs-linux-x64-latest')],
    ['removed aggregate need', source => source.replace(/      - darwin-arm64\r?\n    runs-on: ubuntu-24\.04/, '    runs-on: ubuntu-24.04')],
    ['changed aggregate download', source => source.replace('actions/download-artifact@v4', 'actions/download-artifact@v3')],
    ['added docs deploy behavior', source => `${source}\n# actions/deploy-pages@v4\n`],
    ['added docs build behavior', source => `${source}\n# working-directory: docs-site\n`],
    ['added publish permission', source => source.replace('  contents: read', '  contents: read\n  packages: write')],
    ['added environment', source => source.replace(/  aggregate:(\r?\n)/, (_match, endOfLine) => `  aggregate:${endOfLine}    environment: production${endOfLine}`)],
  ];

  for (const [label, mutate] of mutations) {
    const mutated = mutate(workflowSource);
    assert.notEqual(mutated, workflowSource, `${label} mutation must change the workflow fixture`);
    assertWorkflowRejected(mutated, label);
  }
});

test('aggregates exact five native receipts', () => {
  withArtifactTree('native-aggregate-valid', inputRoot => {
    const outputRoot = join(dirname(inputRoot), `${inputRoot.split(/[\\/]/).at(-1)}-output`);
    try {
      const aggregate = verifyNativeAggregate({
        inputRoot,
        outputRoot,
        sourceSha,
        dispatchNonce,
      });
      assert.equal(aggregate.schema_version, NATIVE_AGGREGATE_SCHEMA);
      assert.equal(aggregate.task_id, NATIVE_TASK_ID);
      assert.equal(aggregate.source_sha, sourceSha);
      assert.equal(aggregate.dispatch_nonce, dispatchNonce);
      assert.equal(aggregate.protocol, NATIVE_PROTOCOL);
      assert.equal(aggregate.artifacts.length, 5);
      assert.deepEqual(aggregate.artifacts.map(item => item.job_id), NATIVE_JOB_IDS);
      assert.equal(
        aggregate.aggregate_sha256,
        sha256(JSON.stringify({
          schema_version: aggregate.schema_version,
          task_id: aggregate.task_id,
          source_sha: aggregate.source_sha,
          dispatch_nonce: aggregate.dispatch_nonce,
          run_name: aggregate.run_name,
          protocol: aggregate.protocol,
          artifacts: aggregate.artifacts,
        })),
      );
      const persisted = JSON.parse(readFileSync(join(outputRoot, 'aggregate-provenance.json')));
      assert.deepEqual(persisted, aggregate);
      for (const jobId of NATIVE_JOB_IDS) {
        assert.equal(
          readFileSync(join(
            outputRoot,
            artifactName(jobId),
            ...NATIVE_TARGETS[jobId].binaryPath.split('/'),
          )).toString(),
          `native-binary:${jobId}\0${sourceSha}`,
        );
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

test('rejects native receipt and byte mismatch', () => {
  const receiptFaults = [
    ['duplicate job receipt', ({ jobId, receipt }) => {
      if (jobId === 'linux-x64') receipt.job_id = 'win32-x64';
    }],
    ['retargeted receipt', ({ jobId, receipt }) => {
      if (jobId === 'linux-arm64') receipt.target = 'x86_64-unknown-linux-gnu';
    }],
    ['wrong protocol', ({ jobId, receipt }) => {
      if (jobId === 'darwin-x64') receipt.protocol = 'lifecycle-fs-helper/0.9';
    }],
    ['wrong source', ({ jobId, receipt }) => {
      if (jobId === 'darwin-arm64') receipt.source_sha = 'f'.repeat(40);
    }],
    ['byte tamper', ({ jobId, binaryPath }) => {
      if (jobId === 'win32-x64') writeFileSync(binaryPath, 'tampered');
    }],
    ['wrong task', ({ jobId, receipt }) => {
      if (jobId === 'linux-x64') receipt.task_id = 'TASK-013';
    }],
    ['inconsistent run-name', ({ jobId, receipt }) => {
      if (jobId === 'linux-arm64') receipt.run_name = 'native-lifecycle-unbound';
    }],
    ['renamed artifact reference', ({ jobId, receipt }) => {
      if (jobId === 'darwin-x64') receipt.artifact_name = 'lifecycle-fs-renamed';
    }],
    ['unexpected receipt field', ({ jobId, receipt }) => {
      if (jobId === 'darwin-arm64') receipt.publish = true;
    }],
  ];

  for (const [label, mutate] of receiptFaults) {
    withArtifactTree(`native-fault-${label.replaceAll(' ', '-')}`, inputRoot => {
      const outputRoot = `${inputRoot}-output`;
      assert.throws(
        () => verifyNativeAggregate({
          inputRoot,
          outputRoot,
          sourceSha,
          dispatchNonce,
        }),
        /native aggregate:/,
        label,
      );
      rmSync(outputRoot, { recursive: true, force: true });
    }, mutate);
  }

  withArtifactTree('native-fault-renamed-directory', inputRoot => {
    renameSync(
      join(inputRoot, artifactName('linux-x64')),
      join(inputRoot, 'lifecycle-fs-linux-x64-renamed'),
    );
    assert.throws(
      () => verifyNativeAggregate({
        inputRoot,
        outputRoot: `${inputRoot}-output`,
        sourceSha,
        dispatchNonce,
      }),
      /exactly the five expected artifacts/,
    );
  });

  withArtifactTree('native-fault-extra-directory', inputRoot => {
    cpSync(
      join(inputRoot, artifactName('linux-x64')),
      join(inputRoot, 'lifecycle-fs-linux-x64-duplicate'),
      { recursive: true },
    );
    assert.throws(
      () => verifyNativeAggregate({
        inputRoot,
        outputRoot: `${inputRoot}-output`,
        sourceSha,
        dispatchNonce,
      }),
      /exactly the five expected artifacts/,
    );
  });

  withArtifactTree('native-fault-invalid-identity', inputRoot => {
    assert.throws(
      () => verifyNativeAggregate({
        inputRoot,
        outputRoot: `${inputRoot}-output`,
        sourceSha: '0'.repeat(39),
        dispatchNonce,
      }),
      /source_sha/,
    );
    assert.throws(
      () => verifyNativeAggregate({
        inputRoot,
        outputRoot: `${inputRoot}-output`,
        sourceSha,
        dispatchNonce: `${dispatchNonce}-reused`,
      }),
      /dispatch_nonce/,
    );
  });

  assertWorkflowRejected(`${workflowSource}\n# actions/deploy-pages@v4\n`, 'deploy-capable workflow');
});
