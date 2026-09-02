import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ToolRegistry } from '../core/tool-registry.js';
import { initializeRepositoryIdentity } from '../repository/context.js';
import type { Tool } from '../types/index.js';
import { getProjectRoot } from '../utils/path-validator.js';
import {
  createMcpToolAccessPolicy,
  createMcpToolRequestHandlers,
} from './tool-access.js';

function makeTool(name: string, handler: Tool['handler'] = async () => ({
  content: [{ type: 'text', text: `${name} result` }],
})): Tool {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    handler,
  };
}

function registryWith(...tools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) registry.register(tool);
  return registry;
}

describe('MCP tool access policy', () => {
  it('uses configured tools when the environment override is absent', async () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const policy = createMcpToolAccessPolicy(['read'], undefined);

    expect(policy.filter(registry.list()).map((tool) => tool.name)).toEqual(['read']);
    expect((await policy.execute(registry, 'read', {})).isError).toBeUndefined();
  });

  it('uses a non-empty environment override instead of configured tools', async () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const policy = createMcpToolAccessPolicy(['read'], ' team_agent, ');

    expect(policy.filter(registry.list()).map((tool) => tool.name)).toEqual(['team_agent']);
    expect((await policy.execute(registry, 'read', {})).isError).toBe(true);
    expect((await policy.execute(registry, 'team_agent', {})).isError).toBeUndefined();
  });

  it('keeps the existing empty-environment fallback behavior', () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const policy = createMcpToolAccessPolicy(['read'], '');

    expect(policy.filter(registry.list()).map((tool) => tool.name)).toEqual(['read']);
  });

  it('allows discovery and execution of every registered tool with all', async () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const policy = createMcpToolAccessPolicy(['all'], undefined);

    expect(policy.filter(registry.list()).map((tool) => tool.name)).toEqual([
      'read',
      'team_agent',
    ]);
    expect((await policy.execute(registry, 'team_agent', {})).isError).toBeUndefined();
  });

  it('rejects a hidden registered tool without invoking its handler', async () => {
    const hiddenHandler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'must not execute' }],
    }));
    const registry = registryWith(makeTool('read'), makeTool('team_agent', hiddenHandler));
    const policy = createMcpToolAccessPolicy(['read'], undefined);

    const result = await policy.execute(registry, 'team_agent', { session_id: 'guessed' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Tool is not available: team_agent' }],
      isError: true,
    });
    expect(hiddenHandler).not.toHaveBeenCalled();
  });

  it('preserves ToolRegistry unknown-tool behavior after authorization', async () => {
    const policy = createMcpToolAccessPolicy(['all'], undefined);
    const result = await policy.execute(new ToolRegistry(), 'does_not_exist', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Unknown tool: does_not_exist');
  });

  it('captures a policy snapshot instead of retaining the mutable config array', () => {
    const configured = ['read'];
    const policy = createMcpToolAccessPolicy(configured, undefined);
    configured.push('team_agent');
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));

    expect(policy.filter(registry.list()).map((tool) => tool.name)).toEqual(['read']);
  });

  it('fails closed for mutation when the MCP actor binding is missing', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'written' }] }));
    const policy = createMcpToolAccessPolicy(['write_file'], undefined, {
      repositoryBindingError: 'MAESTRO_REPO_ID is missing',
    });
    const result = await policy.execute(registryWith(makeTool('write_file', handler)), 'write_file', {
      path: 'unsafe.txt',
      content: 'no',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('MAESTRO_REPO_ID is missing');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects prompt-supplied target IDs outside the host-owned repository context', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'written' }] }));
    const policy = createMcpToolAccessPolicy(['write_file'], undefined, {
      repositoryContext: {
        currentRepoId: '11111111-1111-4111-8111-111111111111',
        currentRepoName: 'actor',
        currentProjectRoot: '/actor',
        identityPersisted: true,
        linkedRepositories: [],
      },
    });
    const result = await policy.execute(registryWith(makeTool('write_file', handler)), 'write_file', {
      path: 'unsafe.txt',
      content: 'no',
      targetRepoId: '22222222-2222-4222-8222-222222222222',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available to this actor');
    expect(handler).not.toHaveBeenCalled();
  });

  it('host-resolves a capability-granted linked mutation target and observes revocation', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'maestro-mcp-linked-write-'));
    const actorRoot = join(sandbox, 'actor');
    const linkedRoot = join(sandbox, 'linked');
    mkdirSync(join(actorRoot, '.workflow'), { recursive: true });
    mkdirSync(join(linkedRoot, '.workflow'), { recursive: true });
    try {
      const actorIdentity = initializeRepositoryIdentity(actorRoot, { repoName: 'actor' });
      const linkedIdentity = initializeRepositoryIdentity(linkedRoot, { repoName: 'linked' });
      const configPath = join(actorRoot, '.workflow', 'config.json');
      const writeConfig = (write: string[]) => writeFileSync(configPath, JSON.stringify({
        workspaces: { linked: [{
          name: 'linked', path: linkedRoot, repo_id: linkedIdentity.repo_id,
          share: ['codebase'], write,
        }] },
      }));
      writeConfig(['codebase']);
      const handler = vi.fn(async (input: Record<string, unknown>) => ({
        content: [{ type: 'text' as const, text: `${getProjectRoot()}:${input.targetRepoId}` }],
      }));
      const policy = createMcpToolAccessPolicy(['write_file'], undefined, {
        repositoryContext: {
          currentRepoId: actorIdentity.repo_id,
          currentRepoName: 'actor',
          currentProjectRoot: actorRoot,
          identityPersisted: true,
          linkedRepositories: [{
            repoId: linkedIdentity.repo_id,
            repoName: 'linked',
            projectRoot: linkedRoot,
            relation: 'linked',
            alias: 'linked',
            identityPersisted: true,
            readCapabilities: ['codebase'],
            writeCapabilities: ['codebase'],
          }],
        },
      });
      const registry = registryWith(makeTool('write_file', handler));
      const result = await policy.execute(registry, 'write_file', {
        path: 'safe.txt', content: 'yes', targetRepoId: linkedIdentity.repo_id,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(`${linkedRoot}:${linkedIdentity.repo_id}`);
      expect(handler).toHaveBeenCalledOnce();

      writeConfig([]);
      const revoked = await policy.execute(registry, 'write_file', {
        path: 'safe.txt', content: 'no', targetRepoId: linkedIdentity.repo_id,
      });
      expect(revoked.isError).toBe(true);
      expect(revoked.content[0].text).toContain('does not grant write capability');
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('advertises only targetRepoId while keeping actor context out of tool input', () => {
    const policy = createMcpToolAccessPolicy(['read'], undefined);
    const [tool] = policy.filter(registryWith(makeTool('read')).list());
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;

    expect(properties).toHaveProperty('targetRepoId');
    expect(properties).not.toHaveProperty('repositoryContext');
    expect(properties).not.toHaveProperty('repoId');
  });
});

describe('MCP tool request handlers', () => {
  it('applies an environment override to both ListTools and CallTool', async () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const handlers = createMcpToolRequestHandlers(registry, ['read'], 'team_agent');

    expect(handlers.list().tools.map((tool) => tool.name)).toEqual(['team_agent']);
    expect((await handlers.call('read', {})).isError).toBe(true);
    expect((await handlers.call('team_agent', {})).isError).toBeUndefined();
  });

  it('uses config fallback for both handlers and never invokes a hidden tool', async () => {
    const hiddenHandler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'must not execute' }],
    }));
    const registry = registryWith(makeTool('read'), makeTool('team_agent', hiddenHandler));
    const handlers = createMcpToolRequestHandlers(registry, ['read'], '');

    expect(handlers.list().tools.map((tool) => tool.name)).toEqual(['read']);
    expect((await handlers.call('team_agent', {})).isError).toBe(true);
    expect(hiddenHandler).not.toHaveBeenCalled();
  });

  it('applies an environment all override to discovery and execution', async () => {
    const registry = registryWith(makeTool('read'), makeTool('team_agent'));
    const handlers = createMcpToolRequestHandlers(registry, [], 'all');

    expect(handlers.list().tools.map((tool) => tool.name)).toEqual([
      'read',
      'team_agent',
    ]);
    expect((await handlers.call('team_agent', {})).isError).toBeUndefined();
  });
});
