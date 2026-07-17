import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerPath, logMutation, readLedger } from './mutation-ledger.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'mutation-ledger-'));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('mutation ledger', () => {
  it('appends schema-valid entries through the workflow lock', () => {
    const projectRoot = root();
    logMutation(projectRoot, 'test', join(projectRoot, 'src', 'a.ts'), {
      mutationType: 'patch', runId: 'run-1', contentHash: 'abc',
    });
    expect(readLedger(projectRoot)).toEqual([expect.objectContaining({
      actor: 'test', target: 'src/a.ts', mutation_type: 'patch', run_id: 'run-1',
    })]);
  });

  it('fails closed on a corrupt ledger entry', () => {
    const projectRoot = root();
    logMutation(projectRoot, 'test', join(projectRoot, 'src', 'a.ts'));
    writeFileSync(ledgerPath(projectRoot), '{"mutation_type":"unknown"}\n', 'utf8');
    expect(() => readLedger(projectRoot)).toThrow(/Invalid mutation ledger entry at line 1/);
  });
});
