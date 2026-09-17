import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { maestroHookCommand } from '../core/mcp-launch.js';
import {
  CODEX_HOOK_DEFS,
  GROK_HOOK_DEFS,
  HOOK_DEFS,
  conversationPayloadFromHook,
  getGenericHooksForLevel,
  getHooksForLevel,
  installCodexHooksByLevel,
  installGenericHooksByLevel,
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
      maestroHookCommand('preflight-guard'),
      maestroHookCommand('spec-validator'),
    ]);
    expect(promptCommands).toContain(maestroHookCommand('keyword-spec-injector'));
    expect(JSON.stringify(installed)).not.toMatch(/kg-(?:context|unified)-injector/);
  });

  it('does not expose removed KG hook variants through generic platforms', () => {
    expect(getGenericHooksForLevel('codebuddy', 'standard')).not.toContain('kg-context-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-context-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-unified-injector');
    expect(getGenericHooksForLevel('cursor', 'standard')).not.toContain('kg-unified-injector-agent');
  });

  it('places Grok memory-inject on PreToolUse and Claude/Codex on UserPromptSubmit', () => {
    expect(HOOK_DEFS['memory-inject-prompt']).toMatchObject({
      event: 'UserPromptSubmit',
      runner: 'memory-inject',
    });
    expect(CODEX_HOOK_DEFS['memory-inject-prompt']).toMatchObject({
      event: 'UserPromptSubmit',
      runner: 'memory-inject',
    });
    expect(GROK_HOOK_DEFS['memory-inject-prompt']).toMatchObject({
      event: 'PreToolUse',
      runner: 'memory-inject',
    });
    expect(GROK_HOOK_DEFS['memory-inject-prompt'].matcher).toBeUndefined();
    expect(getHooksForLevel('standard', 'claude')).toEqual(expect.arrayContaining([
      'memory-extract',
      'memory-inject-start',
      'memory-inject-prompt',
    ]));
    expect(getHooksForLevel('standard', 'codex')).toEqual(expect.arrayContaining([
      'memory-extract',
      'memory-inject-start',
      'memory-inject-prompt',
    ]));
  });

  it('installs Grok standard memory-inject on PreToolUse', () => {
    const hooksPath = tempHooksPath();
    const result = installGenericHooksByLevel('grok', 'standard', { hooksPath });
    const installed = JSON.parse(readFileSync(hooksPath, 'utf8'));
    expect(result.installedHooks).toEqual(expect.arrayContaining([
      'memory-inject-prompt',
      'memory-extract',
    ]));
    const preToolCommands = (installed.hooks.PreToolUse ?? [])
      .flatMap((group: { hooks: Array<{ command?: string }> }) => group.hooks.map(hook => hook.command ?? ''));
    const promptCommands = (installed.hooks.UserPromptSubmit ?? [])
      .flatMap((group: { hooks: Array<{ command?: string }> }) => group.hooks.map(hook => hook.command ?? ''));
    expect(preToolCommands.some(command => command.includes('hooks run memory-inject'))).toBe(true);
    expect(promptCommands.some(command => command.includes('hooks run memory-inject'))).toBe(false);
  });

  it('maps conversation_id into the working-memory payload', () => {
    const payload = conversationPayloadFromHook({
      conversation_id: 'conv-1',
      transcript_path: 'C:/tmp/transcript.jsonl',
      hook_event_name: 'PreToolUse',
    }, 'D:/proj');
    expect(payload.session_id).toBe('conv-1');
    expect(payload.transcript_path).toBe('C:/tmp/transcript.jsonl');
    expect(payload.hook_event_name).toBe('PreToolUse');
  });
});
