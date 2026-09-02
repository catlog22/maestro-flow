import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  grokDirFromRulesMaestroPath,
  stripLegacyGrokAgentsAtGrokDir,
  stripLegacyGrokAgentsMd,
} from './grok-legacy-agents.js';

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-legacy-agents-'));
  temps.push(dir);
  return dir;
}

describe('grokDirFromRulesMaestroPath', () => {
  it('resolves the .grok directory from a rules/maestro.md dest', () => {
    expect(grokDirFromRulesMaestroPath(join('D:', 'proj', '.grok', 'rules', 'maestro.md')))
      .toBe(join('D:', 'proj', '.grok'));
    expect(grokDirFromRulesMaestroPath(join('D:', 'proj', '.cursor', 'AGENTS.md'))).toBeNull();
  });
});

describe('stripLegacyGrokAgentsMd', () => {
  it('deletes a file that only contains Maestro sections', () => {
    const root = tempDir();
    const grokDir = join(root, '.grok');
    mkdirSync(grokDir, { recursive: true });
    const file = join(grokDir, 'AGENTS.md');
    writeFileSync(file, [
      '<!-- maestro:start section="core" -->',
      '# Maestro',
      '<!-- maestro:end section="core" -->',
      '',
      '<!-- maestro:start section="chinese" -->',
      '用中文',
      '<!-- maestro:end section="chinese" -->',
      '',
    ].join('\n'));

    expect(stripLegacyGrokAgentsAtGrokDir(grokDir)).toBe('deleted');
    expect(existsSync(file)).toBe(false);
  });

  it('keeps user prose and strips only Maestro sections', () => {
    const file = join(tempDir(), 'AGENTS.md');
    writeFileSync(file, [
      '# 工作原则',
      '保持简单',
      '',
      '<!-- maestro:start section="core" -->',
      '# Maestro',
      '<!-- maestro:end section="core" -->',
      '',
    ].join('\n'));

    expect(stripLegacyGrokAgentsMd(file)).toBe('stripped');
    const next = readFileSync(file, 'utf8');
    expect(next).toContain('# 工作原则');
    expect(next).toContain('保持简单');
    expect(next).not.toContain('maestro:start');
    expect(next).not.toContain('# Maestro');
  });

  it('leaves marker-free files and missing paths alone', () => {
    const file = join(tempDir(), 'AGENTS.md');
    writeFileSync(file, '# mine\n');
    expect(stripLegacyGrokAgentsMd(file)).toBe('untouched');
    expect(readFileSync(file, 'utf8')).toBe('# mine\n');
    expect(stripLegacyGrokAgentsMd(join(tempDir(), 'missing.md'))).toBe('absent');
  });
});
