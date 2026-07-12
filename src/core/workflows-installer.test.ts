import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installWorkflowsOnly } from './workflows-installer.js';

describe('installWorkflowsOnly', () => {
  it('copies only workflows and preserves unrelated target files', () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-workflows-only-'));
    const source = join(root, 'package');
    const target = join(root, '.maestro', 'workflows');
    mkdirSync(join(source, 'workflows', 'nested'), { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(source, 'workflows', 'analyze.md'), 'new analyze');
    writeFileSync(join(source, 'workflows', 'nested', 'review.md'), 'review');
    writeFileSync(join(target, 'custom.md'), 'keep me');

    const result = installWorkflowsOnly(source, target);

    expect(result.filesInstalled).toBe(2);
    expect(readFileSync(join(target, 'analyze.md'), 'utf8')).toBe('new analyze');
    expect(readFileSync(join(target, 'nested', 'review.md'), 'utf8')).toBe('review');
    expect(readFileSync(join(target, 'custom.md'), 'utf8')).toBe('keep me');
  });

  it('fails clearly when the package has no workflows directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-workflows-only-'));
    expect(() => installWorkflowsOnly(root, join(root, 'target'))).toThrow(/workflows directory not found/);
  });
});
