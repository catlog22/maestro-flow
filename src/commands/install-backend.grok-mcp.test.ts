import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addExtraMcpServer,
  getExtraMcpTargetSpec,
  removeExtraMcpServer,
} from './install-backend.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): { root: string; configPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-grok-mcp-test-'));
  roots.push(root);
  const configPath = join(root, '.grok', 'config.toml');
  mkdirSync(join(root, '.grok'), { recursive: true });
  return { root, configPath };
}

describe('grok MCP target (toml-mcp-servers)', () => {
  it('registers the grok target with project and global config paths', () => {
    const spec = getExtraMcpTargetSpec('grok');
    expect(spec?.format).toBe('toml-mcp-servers');
    expect(spec?.configPath('project', '/proj')).toBe(join('/proj', '.grok', 'config.toml'));
  });

  it('writes a [mcp_servers.maestro-tools] table into an existing config, preserving other content', () => {
    const { root, configPath } = project();
    writeFileSync(configPath, [
      '[models]',
      'default = "grok-4.6"',
      '',
      '# user comment',
      '[ui]',
      'compact_mode = false',
      '',
    ].join('\n'));

    expect(addExtraMcpServer('grok', 'project', root, ['read_file', 'write_file'], root)).toBe(configPath);
    const content = readFileSync(configPath, 'utf8');

    // Untouched sections and comments survive
    expect(content).toContain('[models]\ndefault = "grok-4.6"');
    expect(content).toContain('# user comment');
    expect(content).toContain('[ui]\ncompact_mode = false');

    // New server table
    expect(content).toContain('[mcp_servers.maestro-tools]');
    expect(content).toContain('enabled = true');
    expect(content).toMatch(/env = \{ MAESTRO_ENABLED_TOOLS = "read_file,write_file", MAESTRO_PROJECT_ROOT = ".*" \}/);
  });

  it('creates the config file from scratch when missing', () => {
    const { root, configPath } = project();
    rmSync(configPath, { force: true });

    expect(addExtraMcpServer('grok', 'project', root, ['read_file'])).toBe(configPath);
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('[mcp_servers.maestro-tools]');
    expect(content).toContain('MAESTRO_ENABLED_TOOLS = "read_file"');
  });

  it('replaces its own section idempotently without duplicating or touching other servers', () => {
    const { root, configPath } = project();
    writeFileSync(configPath, [
      '[mcp_servers.other]',
      'command = "/bin/other"',
      '',
    ].join('\n'));

    addExtraMcpServer('grok', 'project', root, ['a']);
    addExtraMcpServer('grok', 'project', root, ['b', 'c']);
    const content = readFileSync(configPath, 'utf8');

    expect(content.match(/\[mcp_servers\.maestro-tools\]/g)).toHaveLength(1);
    expect(content).toContain('MAESTRO_ENABLED_TOOLS = "b,c"');
    expect(content).not.toContain('MAESTRO_ENABLED_TOOLS = "a"');
    expect(content).toContain('[mcp_servers.other]\ncommand = "/bin/other"');
  });

  it('removes only the maestro section on uninstall', () => {
    const { root, configPath } = project();
    writeFileSync(configPath, [
      '[models]',
      'default = "grok-4.6"',
      '',
    ].join('\n'));
    addExtraMcpServer('grok', 'project', root, ['read_file']);

    expect(removeExtraMcpServer('grok', 'project', root)).toBe(true);
    const content = readFileSync(configPath, 'utf8');
    expect(content).not.toContain('mcp_servers.maestro-tools');
    expect(content).toContain('[models]\ndefault = "grok-4.6"');

    // Second removal is a no-op
    expect(removeExtraMcpServer('grok', 'project', root)).toBe(false);
    expect(existsSync(configPath)).toBe(true);
  });

  it('escapes backslashes and quotes in TOML basic strings', () => {
    const { root, configPath } = project();
    rmSync(configPath, { force: true });
    const evilRoot = 'C:\\path with \\"quotes\\"';

    addExtraMcpServer('grok', 'project', root, ['read_file'], evilRoot);
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('MAESTRO_PROJECT_ROOT = "C:\\\\path with \\\\\\"quotes\\\\\\""');
  });
});
