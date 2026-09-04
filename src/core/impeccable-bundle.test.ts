import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const commandPath = join(root, '.claude', 'commands', 'maestro-impeccable.md');
const agentPath = join(root, '.claude', 'agents', 'impeccable-agent.md');
const bundleDir = join(root, 'workflows', 'impeccable');

function filesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe('bundled maestro-impeccable core', () => {
  it('routes the Claude command only through Maestro-owned workflow paths', () => {
    const command = readFileSync(commandPath, 'utf8');

    expect(command).toContain('<embedded_contract>');
    expect(command).toContain('workflows/impeccable/SKILL.md');
    expect(command).toContain('~/.maestro/workflows/impeccable/SKILL.md');
    expect(command).toContain('No separately installed `impeccable` Skill or npm runtime is required.');
    expect(command).not.toContain('.claude/skills/impeccable');
    expect(command).not.toContain('Invoke Skill `impeccable`');
    expect(command).not.toMatch(/^\s*- Skill\s*$/m);
  });

  it('ships the complete 4.1.3 core, platform variants, scripts, and attribution', () => {
    const required = [
      'SKILL.md', 'UPSTREAM.md', 'LICENSE', 'NOTICE.md',
      'reference/routing.md', 'reference/new-work.md', 'reference/craft-floor.md',
      'reference/audit.native.md', 'reference/adapt.native.md',
      'reference/hooks.md', 'reference/doctor.md',
      'scripts/context.mjs', 'scripts/detect.mjs', 'scripts/doctor.mjs',
      'scripts/hook-admin.mjs', 'scripts/pin.mjs', 'scripts/live.mjs',
      'scripts/detector/vendor/static-html-parser.bundle.mjs',
      'scripts/detector/vendor/THIRD_PARTY_LICENSES.md',
    ];
    for (const relative of required) {
      expect(existsSync(join(bundleDir, relative)), relative).toBe(true);
    }

    const core = readFileSync(join(bundleDir, 'SKILL.md'), 'utf8');
    expect(core).toContain('version: 4.1.3');
    expect(core).toContain('name: maestro-impeccable-core');
    expect(readFileSync(join(bundleDir, 'UPSTREAM.md'), 'utf8')).toContain('4c5243fcd42d39c1fc281adcaf10be0913095f74');
  });

  it('contains no runtime instruction to resolve or execute the external package', () => {
    const inspected = filesBelow(bundleDir)
      .filter((path) => /\.(?:md|mjs|js|json)$/.test(path));
    const violations = inspected.flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      const reasons = [
        text.includes('npx impeccable') ? 'npx impeccable' : null,
        text.includes('node .claude/skills/impeccable') ? 'external skill script path' : null,
        text.includes('Skill({ skill: "impeccable" })') ? 'external Skill invocation' : null,
      ].filter(Boolean);
      return reasons.map((reason) => `${path}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps all execution agents on the same bundled core', () => {
    const agent = readFileSync(agentPath, 'utf8');
    expect(agent).toContain('<impeccable-base>/reference/{command}.md');
    expect(agent).toContain('Never resolve or install another Impeccable Skill.');
    expect(agent).not.toMatch(/^\s*- Skill\s*$/m);
    expect(agent).not.toContain('~/.maestro/workflows/impeccable/{command}.md');

    for (const name of ['asset-producer', 'documenter', 'finish-reviewer', 'manual-edit-applier']) {
      const path = join(root, '.claude', 'agents', `maestro-impeccable-${name}.md`);
      expect(existsSync(path), path).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('Maestro-bundled adaptation');
    }

    const newWork = readFileSync(join(bundleDir, 'reference', 'new-work.md'), 'utf8');
    expect(newWork).toContain('maestro-impeccable-finish-reviewer');
    expect(newWork).toContain('maestro-impeccable-documenter');
    expect(newWork).not.toContain('maestro-maestro-impeccable');
  });
});
