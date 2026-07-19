import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanOutputs } from './artifacts.js';
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

  it('registers a complete _meta kind and schema', () => {
    const { runDir, sessionDir } = createRun();
    writeFileSync(join(runDir, 'outputs', 'result.json'), JSON.stringify({
      _meta: { kind: 'review-analysis', schema: 'review-analysis/2.0', role: 'primary' },
      findings: [],
    }));

    const result = scanOutputs(runDir, sessionDir, contract);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.artifacts[0]).toMatchObject({
      kind: 'review-analysis',
      schemaVersion: 'review-analysis/2.0',
      role: 'primary',
    });
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
