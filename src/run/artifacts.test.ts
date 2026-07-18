import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scanOutputs JSON metadata', () => {
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
