import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanOutputs, validateStrictArtifactContract } from './artifacts.js';
import type { CommandContract } from './contract.js';

const contract: CommandContract = {
  consumes: [],
  produces: [],
  gates: { entry: [], exit: [] },
};

const roots: string[] = [];

function createRun(): { runDir: string; sessionDir: string } {
  const sessionDir = mkdtempSync(join(tmpdir(), 'maestro-artifacts-'));
  const runDir = join(sessionDir, 'runs', 'run-001');
  mkdirSync(join(runDir, 'outputs'), { recursive: true });
  roots.push(sessionDir);
  return { runDir, sessionDir };
}

function tryCreateDirectorySymlink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, 'dir');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return false;
    throw error;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scanOutputs JSON metadata', () => {
  it('scans declared path templates as individual nested artifacts', () => {
    const { runDir, sessionDir } = createRun();
    const tasksDir = join(runDir, 'outputs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    for (const id of ['001', '002']) {
      writeFileSync(join(tasksDir, `TASK-${id}.json`), JSON.stringify({
        _meta: { kind: 'plan-task', schema: 'plan-task/1.0', role: 'attachment' },
        id: `TASK-${id}`,
      }));
    }
    const templatedContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/tasks/TASK-{NNN}.json', kind: 'plan-task' }],
      gates: { entry: [], exit: [] },
    };

    const result = scanOutputs(runDir, sessionDir, templatedContract);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.artifacts.map(item => [item.kind, item.relativePath])).toEqual([
      ['plan-task', 'runs/run-001/outputs/tasks/TASK-001.json'],
      ['plan-task', 'runs/run-001/outputs/tasks/TASK-002.json'],
    ]);
  });

  it('keeps a missing declared path template blocking', () => {
    const { runDir, sessionDir } = createRun();
    mkdirSync(join(runDir, 'outputs', 'tasks'), { recursive: true });
    const templatedContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/tasks/TASK-{NNN}.json', kind: 'plan-task' }],
      gates: { entry: [], exit: [] },
    };

    const result = scanOutputs(runDir, sessionDir, templatedContract);

    expect(result.artifacts).toEqual([]);
    expect(result.warnings).toEqual(['Expected outputs/tasks/TASK-{NNN}.json was not produced']);
  });

  it('does not traverse a nested directory symlink outside outputs', () => {
    const { runDir, sessionDir } = createRun();
    const tasksDir = join(runDir, 'outputs', 'tasks');
    const externalDir = join(sessionDir, 'external');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(externalDir, 'TASK-999.json'), JSON.stringify({
      _meta: { kind: 'external-task', schema: 'external-task/1.0' },
    }));
    const linkCreated = tryCreateDirectorySymlink(externalDir, join(tasksDir, 'linked'));
    if (!linkCreated) {
      expect(process.platform).toBe('win32');
      return;
    }
    const templatedContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/tasks/TASK-{NNN}.json', kind: 'plan-task' }],
      gates: { entry: [], exit: [] },
    };

    const result = scanOutputs(runDir, sessionDir, templatedContract);

    expect(result.artifacts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['Expected outputs/tasks/TASK-{NNN}.json was not produced']);
  });

  it.skipIf(process.platform !== 'win32')('does not traverse a Windows junction outside outputs', () => {
    const { runDir, sessionDir } = createRun();
    const tasksDir = join(runDir, 'outputs', 'tasks');
    const externalDir = join(sessionDir, 'external');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(externalDir, 'TASK-999.json'), JSON.stringify({
      _meta: { kind: 'external-task', schema: 'external-task/1.0' },
    }));
    symlinkSync(externalDir, join(tasksDir, 'linked'), 'junction');
    const templatedContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/tasks/TASK-{NNN}.json', kind: 'plan-task' }],
      gates: { entry: [], exit: [] },
    };

    const result = scanOutputs(runDir, sessionDir, templatedContract);

    expect(result.artifacts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['Expected outputs/tasks/TASK-{NNN}.json was not produced']);
  });

  it('keeps metadata-free JSON backward compatible through filename inference', () => {
    const { runDir, sessionDir } = createRun();
    writeFileSync(join(runDir, 'outputs', 'review-analysis.json'), '{"findings":[]}');

    const result = scanOutputs(runDir, sessionDir, contract);

    expect(result.errors).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      kind: 'review-analysis',
      schemaVersion: 'review-analysis/1.0',
    });
    expect(result.warnings).toContain('outputs/review-analysis.json: missing _meta; inferred kind=review-analysis');
  });

  it.each(['json', 'ndjson', 'jsonl', 'md'])('infers declared schema and evidence role without metadata in .%s', extension => {
    const { runDir, sessionDir } = createRun();
    const path = `outputs/evidence.${extension}`;
    writeFileSync(join(runDir, path), extension === 'md' ? '# Evidence' : '{"event":"verified"}\n');
    const declared: CommandContract = {
      ...contract, contract_version: 2,
      produces: [{ path, kind: 'evidence', role: 'evidence', schema: 'evidence/2.0', required: true }],
    };
    const scan = scanOutputs(runDir, sessionDir, declared);
    validateStrictArtifactContract(runDir, declared, scan);
    expect(scan.errors).toEqual([]);
    expect(scan.artifacts[0]).toMatchObject({ kind: 'evidence', role: 'evidence', schemaVersion: 'evidence/2.0' });
    expect(scan.warnings).not.toHaveLength(0);
  });

  it('does not repair explicitly mismatched artifact metadata', () => {
    const { runDir, sessionDir } = createRun();
    writeFileSync(join(runDir, 'outputs/evidence.ndjson'), JSON.stringify({
      _meta: { kind: 'evidence', role: 'attachment', schema: 'evidence/1.0' },
    }));
    const declared: CommandContract = {
      ...contract, contract_version: 2,
      produces: [{ path: 'outputs/evidence.ndjson', kind: 'evidence', role: 'evidence', schema: 'evidence/2.0' }],
    };
    const scan = scanOutputs(runDir, sessionDir, declared);
    validateStrictArtifactContract(runDir, declared, scan);
    expect(scan.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('_meta.role attachment does not match contract evidence'),
      expect.stringContaining('_meta.schema evidence/1.0 does not match contract evidence/2.0'),
    ]));
  });

  it('registers complete metadata from BOM-prefixed JSON', () => {
    const { runDir, sessionDir } = createRun();
    writeFileSync(join(runDir, 'outputs', 'result.json'), `\uFEFF${JSON.stringify({
      _meta: { kind: 'review-analysis', schema: 'review-analysis/2.0', role: 'primary' },
      findings: [],
    })}`);

    const result = scanOutputs(runDir, sessionDir, contract);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.artifacts[0]).toMatchObject({
      kind: 'review-analysis',
      schemaVersion: 'review-analysis/2.0',
      role: 'primary',
    });
  });

  it.each(['ndjson', 'jsonl'])('registers BOM-prefixed metadata from the first .%s record', extension => {
    const { runDir, sessionDir } = createRun();
    const name = `evidence.${extension}`;
    writeFileSync(join(runDir, 'outputs', name), `\uFEFF${[
      JSON.stringify({
        _meta: { kind: 'evidence', schema: 'evidence/1.0', role: 'evidence', alias: 'run-evidence' },
      }),
      JSON.stringify({ ts: '2026-08-08T00:41:00+08:00', type: 'criteria-defined' }),
    ].join('\n')}`);
    const evidenceContract: CommandContract = {
      consumes: [],
      produces: [{
        path: `outputs/${name}`,
        kind: 'evidence',
        primary: false,
        role: 'evidence',
        schema: 'evidence/1.0',
      }],
      gates: { entry: [], exit: [] },
    };

    const result = scanOutputs(runDir, sessionDir, evidenceContract);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.artifacts[0]).toMatchObject({
      kind: 'evidence',
      schemaVersion: 'evidence/1.0',
      role: 'evidence',
      alias: 'run-evidence',
      mediaType: 'application/x-ndjson',
    });
  });

  it('fails closed when an inspected file is atomically replaced by an external symlink before read', () => {
    const { runDir, sessionDir } = createRun();
    const artifactPath = join(runDir, 'outputs', 'result.json');
    const externalPath = join(sessionDir, 'external.json');
    const swapPath = join(runDir, 'outputs', '.result-swap');
    writeFileSync(artifactPath, JSON.stringify({
      _meta: { kind: 'internal-result', schema: 'internal-result/1.0', role: 'primary' },
      value: 'internal-bytes',
    }));
    writeFileSync(externalPath, JSON.stringify({
      _meta: { kind: 'external-result', schema: 'external-result/1.0', role: 'primary' },
      value: 'external-bytes-must-not-be-read',
    }));
    symlinkSync(externalPath, swapPath, 'file');
    const declaredContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/result.json', kind: 'internal-result', primary: true }],
      gates: { entry: [], exit: [] },
    };
    let swapped = false;

    const result = scanOutputs(runDir, sessionDir, declaredContract, {
      afterFileInspection(path) {
        if (path !== artifactPath || swapped) return;
        renameSync(swapPath, artifactPath);
        swapped = true;
      },
    });

    expect(swapped).toBe(true);
    expect(result.artifacts).toEqual([]);
    expect(result.errors.some(error => error.includes('unsafe path changed during artifact scan'))).toBe(true);
    expect(result.errors.join('\n')).not.toContain('external-bytes-must-not-be-read');
    expect(result.warnings).toContain('Expected outputs/result.json was not produced');
  });

  it('uses the same verified buffers while hashing directory artifacts', () => {
    const { runDir, sessionDir } = createRun();
    const bundlePath = join(runDir, 'outputs', 'bundle');
    const artifactPath = join(bundlePath, 'result.json');
    const externalPath = join(sessionDir, 'external-directory-result.json');
    const swapPath = join(bundlePath, '.result-swap');
    mkdirSync(bundlePath, { recursive: true });
    writeFileSync(artifactPath, '{"value":"internal-directory-bytes"}');
    writeFileSync(externalPath, '{"value":"external-directory-bytes-must-not-be-read"}');
    symlinkSync(externalPath, swapPath, 'file');
    const directoryContract: CommandContract = {
      consumes: [],
      produces: [{ path: 'outputs/bundle', kind: 'result-bundle', primary: true }],
      gates: { entry: [], exit: [] },
    };
    let swapped = false;

    const result = scanOutputs(runDir, sessionDir, directoryContract, {
      afterFileInspection(path) {
        if (path !== artifactPath || swapped) return;
        renameSync(swapPath, artifactPath);
        swapped = true;
      },
    });

    expect(swapped).toBe(true);
    expect(result.artifacts).toEqual([]);
    expect(result.errors.some(error => error.includes('unsafe path changed during artifact scan'))).toBe(true);
    expect(result.errors.join('\n')).not.toContain('external-directory-bytes-must-not-be-read');
    expect(result.warnings).toContain('Expected outputs/bundle was not produced');
  });

  it.each([
    ['missing schema', { kind: 'review-analysis' }],
    ['missing kind', { schema: 'review-analysis/1.0' }],
    ['null metadata', null],
  ])('fails closed with an actionable error for %s', (_label, meta) => {
    const { runDir, sessionDir } = createRun();
    writeFileSync(join(runDir, 'outputs', 'review-analysis.json'), JSON.stringify({ _meta: meta, findings: [] }));

    const result = scanOutputs(runDir, sessionDir, contract);

    expect(result.artifacts).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('outputs/review-analysis.json: invalid _meta; expected non-empty kind and schema');
  });
});
