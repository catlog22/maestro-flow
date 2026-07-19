import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_HOOK_DEFS,
  getGenericHooksForLevel,
  installCodexHooksByLevel,
} from './hooks.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHooksPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-codex-hooks-'));
  roots.push(root);
  return join(root, 'hooks.json');
}

describe('Codex prompt context lifecycle', () => {
  it('keeps one prompt context hook and only guards in PreToolUse', () => {
    expect(CODEX_HOOK_DEFS['keyword-spec-injector']).toMatchObject({
      event: 'UserPromptSubmit',
      level: 'standard',
    });
    expect(CODEX_HOOK_DEFS['kg-context-injector']).toBeUndefined();
    expect(CODEX_HOOK_DEFS['kg-unified-injector']).toBeUndefined();
    expect(CODEX_HOOK_DEFS['kg-unified-injector-agent']).toBeUndefined();
    expect(CODEX_HOOK_DEFS['spec-validator'].matcher).toBe('Write');

    const preToolHooks = Object.entries(CODEX_HOOK_DEFS)
      .filter(([, def]) => def.event === 'PreToolUse')
      .map(([name]) => name);
    expect(preToolHooks).toEqual(['preflight-guard', 'spec-validator', 'workflow-guard']);
  });

  it('installs one prompt context hook and removes all legacy KG hook entries', () => {
    const hooksPath = tempHooksPath();
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Agent',
            hooks: [{ type: 'command', command: 'maestro hooks run kg-context-injector' }],
          },
          {
            matcher: 'Agent',
            hooks: [{ type: 'command', command: 'maestro hooks run kg-unified-injector-agent' }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [{ type: 'command', command: 'maestro hooks run kg-unified-injector' }],
          },
        ],
      },
    }));

    installCodexHooksByLevel('standard', { hooksPath });
    const installed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    const preToolCommands = (installed.hooks.PreToolUse ?? [])
      .flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks.map(hook => hook.command));
    const promptCommands = (installed.hooks.UserPromptSubmit ?? [])
      .flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks.map(hook => hook.command));

    expect(preToolCommands).toEqual([
      'maestro hooks run preflight-guard',
      'maestro hooks run spec-validator',
    ]);
    expect(promptCommands).toContain('maestro hooks run keyword-spec-injector');
    expect(JSON.stringify(installed)).not.toMatch(/kg-(?:context|unified)-injector/);
  });

  it('does not expose removed KG hook variants through generic platforms', () => {
    expect(getGenericHooksForLevel('codebuddy', 'standard')).not.toContain('kg-context-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-context-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-unified-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-unified-injector-agent');
  });
});
