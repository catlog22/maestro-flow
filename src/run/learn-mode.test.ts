import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { paths } from '../config/paths.js';
import { buildAgentsStandardSkills, buildAgySkills } from '../core/skill-converter.js';
import { resolveCommandSource, resolveStepContent } from './contract.js';
import { createRun } from './runtime.js';

const repoRoot = process.cwd();
const fixtures: string[] = [];

function frontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('missing frontmatter');
  return YAML.parse(match[1]);
}

function fixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'learn-mode-'));
  fixtures.push(root);
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  const projectWorkflowDir = join(paths.project(root).workflow, 'workflows');
  mkdirSync(projectWorkflowDir, { recursive: true });
  writeFileSync(
    join(root, '.claude', 'commands', 'maestro-learn.md'),
    readFileSync(join(repoRoot, '.claude', 'commands', 'maestro-learn.md')),
  );
  writeFileSync(
    join(projectWorkflowDir, 'learn.md'),
    readFileSync(join(repoRoot, 'workflows', 'learn.md')),
  );
  return root;
}

afterEach(() => {
  while (fixtures.length > 0) rmSync(fixtures.pop()!, { recursive: true, force: true });
});

describe('maestro-learn non-Run compatibility contract', () => {
  it('keeps the four direct subcommands while declaring no Run contract', () => {
    const text = readFileSync(join(repoRoot, '.claude', 'commands', 'maestro-learn.md'), 'utf8');
    const data = frontmatter(text);
    expect(data.name).toBe('maestro-learn');
    expect(data['session-mode']).toBe('none');
    expect(data).not.toHaveProperty('contract');
    for (const subcommand of ['follow', 'investigate', 'decompose', 'consult']) {
      expect(text).toContain(`\`${subcommand}\``);
    }
    expect(existsSync(join(repoRoot, '.claude', 'commands', 'learn.md'))).toBe(false);
  });

  it('rejects Run creation before writing any Session state', () => {
    const projectRoot = fixtureProject();
    const source = resolveCommandSource(projectRoot, 'maestro-learn');
    expect(source.sessionMode).toBe('none');
    expect(() => createRun({ projectRoot, command: 'maestro-learn', intent: 'read code' }))
      .toThrow(/session-mode: none and cannot create a Run/);
    expect(existsSync(join(projectRoot, '.workflow', 'sessions'))).toBe(false);
  });

  it('keeps a terminal basename tombstone for direct workflow consumers', () => {
    const projectRoot = fixtureProject();
    const resolved = resolveStepContent(projectRoot, 'learn');
    expect(resolved.prepare).toBeNull();
    expect(resolved.workflow?.path).toBe(join(paths.project(projectRoot).workflow, 'workflows', 'learn.md'));
    expect(resolved.workflow?.raw).toContain('maestro:retired-workflow executable="false"');
    const data = frontmatter(resolved.workflow!.raw);
    expect(data).toMatchObject({ name: 'learn', 'session-mode': 'none', retired: true });
    expect(data).not.toHaveProperty('prepare');
    expect(data).not.toHaveProperty('commands');
    expect(resolved.workflow?.raw).not.toMatch(/\/manage-learn|## Stage \d|^contract:/m);
  });

  it('keeps generated maestro-learn surfaces non-Run and free of managed lifecycle metadata', () => {
    const generatedRoot = mkdtempSync(join(tmpdir(), 'learn-standard-'));
    fixtures.push(generatedRoot);
    const standardSkills = join(generatedRoot, 'skills');
    const agySkills = join(generatedRoot, 'agy-skills');
    buildAgentsStandardSkills(join(repoRoot, '.claude'), standardSkills);
    buildAgySkills(join(repoRoot, '.claude'), agySkills);
    for (const path of [
      join(agySkills, 'maestro-learn', 'SKILL.md'),
      join(standardSkills, 'maestro-learn', 'SKILL.md'),
      join(repoRoot, '.codex', 'skills', 'maestro-learn', 'SKILL.md'),
    ]) {
      const text = readFileSync(path, 'utf8');
      const data = frontmatter(text);
      expect(data.name).toBe('maestro-learn');
      expect(data['session-mode']).toBe('none');
      expect(data).not.toHaveProperty('contract');
      expect(text).not.toContain('@~/.maestro/workflows/run-mode.md');
      expect(text).not.toContain('@~/.maestro/workflows/run-mode-lite.md');
      expect(text).not.toContain('@~/.maestro/workflows/codex-run-mode.md');
    }
    expect(existsSync(join(agySkills, 'learn'))).toBe(false);
    expect(existsSync(join(standardSkills, 'learn'))).toBe(false);
    expect(existsSync(join(repoRoot, '.codex', 'skills', 'learn'))).toBe(false);
  });
});
