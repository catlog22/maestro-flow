import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { COMPONENT_DEFS } from './component-defs.js';

describe('Grok extra-platform install targets', () => {
  const projectPath = join('D:', 'tmp', 'proj');

  it('writes project instructions to .grok/rules/maestro.md, not AGENTS.md', () => {
    const context = COMPONENT_DEFS.find((def) => def.id === 'grok-context');
    const chinese = COMPONENT_DEFS.find((def) => def.id === 'grok-md-chinese');
    expect(context).toBeDefined();
    expect(chinese).toBeDefined();

    const projectTarget = context!.target('project', projectPath);
    expect(projectTarget).toBe(join(projectPath, '.grok', 'rules', 'maestro.md'));
    expect(projectTarget).not.toContain('AGENTS.md');
    expect(chinese!.target('project', projectPath)).toBe(projectTarget);

    expect(context!.target('global', projectPath)).toBe(
      join(homedir(), '.grok', 'rules', 'maestro.md'),
    );
  });

  it('keeps skills and agents under .grok/skills and .grok/agents', () => {
    const skills = COMPONENT_DEFS.find((def) => def.id === 'grok-skills');
    const agents = COMPONENT_DEFS.find((def) => def.id === 'grok-agents');
    expect(skills!.target('project', projectPath)).toBe(join(projectPath, '.grok', 'skills'));
    expect(agents!.target('project', projectPath)).toBe(join(projectPath, '.grok', 'agents'));
  });

  it('does not change other EXTRA_PLATFORMS context files', () => {
    const cursor = COMPONENT_DEFS.find((def) => def.id === 'cursor-context');
    expect(cursor!.target('project', projectPath)).toBe(join(projectPath, '.cursor', 'AGENTS.md'));
  });
});
