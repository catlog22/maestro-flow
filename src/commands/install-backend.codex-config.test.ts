import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCodexMcpServer, configureCodexMultiAgentV2, removeCodexMcpServer } from './install-backend.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-codex-config-test-'));
  roots.push(root);
  const configPath = join(root, '.codex', 'config.toml');
  mkdirSync(join(root, '.codex'), { recursive: true });
  return { root, configPath };
}

describe('configureCodexMultiAgentV2', () => {
  it('updates target keys while preserving unrelated TOML and remains idempotent', () => {
    const { root, configPath } = project();
    writeFileSync(configPath, [
      'model = "gpt-custom"',
      '# keep this comment',
      '',
      '[features]',
      'codex_hooks = true',
      'default_mode_request_user_input = false # existing comment',
      '',
      '[features.multi_agent_v2]',
      'enabled = false',
      'hide_spawn_agent_metadata = true',
      'tool_namespace = "collaboration"',
      'custom_user_key = 42',
      '',
      '[other]',
      'value = "keep"',
      '',
    ].join('\n'));

    expect(configureCodexMultiAgentV2('project', root)).toBe(configPath);
    const first = readFileSync(configPath, 'utf8');
    expect(first).toContain('model = "gpt-custom"');
    expect(first).toContain('# keep this comment');
    expect(first).toContain('codex_hooks = true');
    expect(first).toContain('custom_user_key = 42');
    expect(first).toContain('[other]\nvalue = "keep"');
    expect(first).toContain('default_mode_request_user_input = true # existing comment');
    expect(first).toContain('multi_agents_v2 = true');
    expect(first).toContain('enabled = true');
    expect(first).toContain('hide_spawn_agent_metadata = false');
    expect(first).toContain('tool_namespace = "maestro"');
    expect(first).toContain('max_concurrent_threads_per_session = 7');
    expect(first).toContain('min_wait_timeout_ms = 180000');
    expect(first).toContain('default_wait_timeout_ms = 180000');
    expect(first).toContain('max_wait_timeout_ms = 3600000');

    expect(configureCodexMultiAgentV2('project', root)).toBe(configPath);
    expect(readFileSync(configPath, 'utf8')).toBe(first);
  });

  it('creates a standards-compliant config when the file is missing', () => {
    const { root, configPath } = project();
    rmSync(configPath, { force: true });

    expect(configureCodexMultiAgentV2('project', root)).toBe(configPath);
    const content = readFileSync(configPath, 'utf8');
    expect(existsSync(configPath)).toBe(true);
    expect(content).toContain('[features]');
    expect(content).toContain('[features.multi_agent_v2]');
    expect(content).toContain('hide_spawn_agent_metadata = false');
    expect(content).toContain('tool_namespace = "maestro"');
  });

  it('preserves Multi-Agent V2 preferences when Maestro MCP is removed', () => {
    const { root, configPath } = project();
    expect(configureCodexMultiAgentV2('project', root)).toBe(configPath);
    expect(addCodexMcpServer('project', root, ['search'])).toBe(configPath);
    expect(removeCodexMcpServer('project', root)).toBe(true);

    const content = readFileSync(configPath, 'utf8');
    expect(content).not.toContain('[mcp_servers.maestro-tools]');
    expect(content).toContain('multi_agents_v2 = true');
    expect(content).toContain('tool_namespace = "maestro"');
    expect(content).toContain('min_wait_timeout_ms = 180000');
  });

  it('recognizes section headers with trailing comments without duplicating them', () => {
    const { root, configPath } = project();
    writeFileSync(configPath, [
      '[features] # user comment',
      'custom = true',
      '',
      '[features.multi_agent_v2] # keep this too',
      'enabled = false',
      '',
      '[other]',
      'value = "keep"',
      '',
    ].join('\n'));

    expect(configureCodexMultiAgentV2('project', root)).toBe(configPath);
    const content = readFileSync(configPath, 'utf8');
    expect(content.match(/^\[features\](?:\s|#|$)/gm)).toHaveLength(1);
    expect(content.match(/^\[features\.multi_agent_v2\](?:\s|#|$)/gm)).toHaveLength(1);
    expect(content).toContain('[features] # user comment');
    expect(content).toContain('[features.multi_agent_v2] # keep this too');
    expect(content).toContain('[other]\nvalue = "keep"');
    expect(content).toContain('tool_namespace = "maestro"');
    expect(content).toContain('min_wait_timeout_ms = 180000');
    expect(content).toContain('default_wait_timeout_ms = 180000');
    expect(content).toContain('max_wait_timeout_ms = 3600000');
  });
});
