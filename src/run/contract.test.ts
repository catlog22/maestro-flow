import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listResolvableSteps, resolveStepContent } from './contract.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-steps-'));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// Fixture names use a zz prefix so assertions never collide with the installed
// global ~/.maestro prepare/workflow set (which the scanner also lists).
describe('listResolvableSteps', () => {
  it('lists prepare and workflow basenames with project scope', () => {
    const r = root();
    mkdirSync(join(r, 'prepare'), { recursive: true });
    writeFileSync(join(r, 'prepare', 'zzstep-analyze.md'), '# prepare\n', 'utf8');
    mkdirSync(join(r, '.workflow', 'workflows'), { recursive: true });
    writeFileSync(join(r, '.workflow', 'workflows', 'zzstep-review.md'), '# wf\n', 'utf8');

    const byName = new Map(listResolvableSteps(r).map(s => [s.name, s]));
    expect(byName.get('zzstep-analyze')).toMatchObject({ scope: 'project', source: 'prepare' });
    expect(byName.get('zzstep-review')).toMatchObject({ scope: 'project', source: 'workflow' });
  });

  it('lists workflow association aliases and skips platform-suffixed overrides', () => {
    const r = root();
    const wf = join(r, 'workflows');
    mkdirSync(wf, { recursive: true });
    writeFileSync(
      join(wf, 'zzstep-exec.md'),
      '---\nname: zzstep-exec\nprepare: zzstep-exec\ncommands:\n  - zzalias-exec\n---\n# wf\n',
      'utf8',
    );
    writeFileSync(join(wf, 'zzstep-exec.codex.md'), '# codex override\n', 'utf8');

    const names = listResolvableSteps(r).map(s => s.name);
    expect(names).toContain('zzstep-exec');
    expect(names).toContain('zzalias-exec');
    expect(names).not.toContain('zzstep-exec.codex');
  });

  it('dedupes a name present in both prepare and workflows into one entry', () => {
    const r = root();
    mkdirSync(join(r, 'prepare'), { recursive: true });
    writeFileSync(join(r, 'prepare', 'zzstep-plan.md'), '# prepare\n', 'utf8');
    mkdirSync(join(r, 'workflows'), { recursive: true });
    writeFileSync(join(r, 'workflows', 'zzstep-plan.md'), '# wf\n', 'utf8');

    expect(listResolvableSteps(r).filter(s => s.name === 'zzstep-plan')).toHaveLength(1);
  });

  it('every listed name resolves via resolveStepContent (registry parity)', () => {
    const r = root();
    mkdirSync(join(r, 'prepare'), { recursive: true });
    writeFileSync(join(r, 'prepare', 'zzstep-only-prep.md'), '# prepare\n', 'utf8');
    mkdirSync(join(r, 'workflows'), { recursive: true });
    writeFileSync(
      join(r, 'workflows', 'zzstep-only-wf.md'),
      '---\nname: zzstep-only-wf\nprepare: zzstep-only-wf\ncommands:\n  - zzalias-wf\n---\n# wf\n',
      'utf8',
    );

    const mine = listResolvableSteps(r).filter(s => s.name.startsWith('zz'));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    for (const s of mine) {
      const content = resolveStepContent(r, s.name);
      expect(content.prepare !== null || content.workflow !== null).toBe(true);
    }
  });
});
