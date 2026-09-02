import { describe, it, expect } from 'vitest';
import { handler } from '../delegate-mcp.js';
import type { CliToolsConfig } from '../../config/cli-tools-config.js';
import type { DelegateExecutionRequest } from '../../commands/delegate.js';
import type { ExecutionMeta } from '../../agents/cli-history-store.js';
import type { DelegateBrokerClient } from '../../async/delegate-broker-client.js';
import type { CliHistoryStore } from '../../agents/cli-history-store.js';

const enabledConfig: CliToolsConfig = {
  version: '1',
  tools: {
    grok: { enabled: true, primaryModel: 'grok-4.6', tags: ['fullstack'], type: 'builtin' },
    gemini: { enabled: false, primaryModel: 'gemini-x', tags: ['fullstack'], type: 'builtin' },
  },
};

function loadConfig(): Promise<CliToolsConfig> {
  return Promise.resolve(enabledConfig);
}

describe('delegate MCP tool', () => {
  it('rejects unknown operation', async () => {
    const result = await handler({ operation: 'bogus' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid params');
  });

  it('run requires prompt', async () => {
    const result = await handler({ operation: 'run' }, { loadConfig });
    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt');
  });

  it('run defaults to analysis and does not silently pick a disabled --to', async () => {
    const launched: DelegateExecutionRequest[] = [];
    const result = await handler({ operation: 'run', prompt: 'summarize README', to: 'grok' }, {
      loadConfig,
      launch: (req) => { launched.push(req); },
    });
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ tool: 'grok', mode: 'analysis', status: 'queued' });
    expect(launched).toHaveLength(1);
    expect(launched[0].mode).toBe('analysis');
    expect(launched[0].tool).toBe('grok');
    expect(launched[0].execId.startsWith('grk-')).toBe(true);
  });

  it('run requires explicit write', async () => {
    const launched: DelegateExecutionRequest[] = [];
    const result = await handler({ operation: 'run', prompt: 'edit file', to: 'grok', mode: 'write' }, {
      loadConfig,
      launch: (req) => { launched.push(req); },
    });
    expect(result.success).toBe(true);
    expect(launched[0].mode).toBe('write');
  });

  it('run rejects disabled tool instead of falling back', async () => {
    const result = await handler({ operation: 'run', prompt: 'x', to: 'gemini' }, { loadConfig });
    expect(result.success).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('run rejects unknown tool', async () => {
    const result = await handler({ operation: 'run', prompt: 'x', to: 'nope' }, { loadConfig });
    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown tool');
  });

  it('message / status / output / cancel require id', async () => {
    for (const operation of ['message', 'status', 'output', 'cancel'] as const) {
      const result = await handler({ operation, message: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('id');
    }
  });

  it('message requires message text', async () => {
    const result = await handler({ operation: 'message', id: 'grk-1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });

  it('status / output / cancel report missing executions', async () => {
    const store = {
      loadMeta: () => null,
      getOutput: () => '',
    } as unknown as CliHistoryStore;
    const broker = {
      getJob: () => null,
      listJobEvents: () => [],
    } as unknown as DelegateBrokerClient;

    for (const operation of ['status', 'output', 'cancel'] as const) {
      const result = await handler({ operation, id: 'missing' }, { historyStore: store, broker });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    }
  });

  it('status and output return stored state', async () => {
    const meta: ExecutionMeta = {
      execId: 'grk-1',
      tool: 'grok',
      mode: 'analysis',
      prompt: 'summarize',
      workDir: '/tmp',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const store = {
      loadMeta: (id: string) => (id === 'grk-1' ? meta : null),
      getOutput: (id: string) => (id === 'grk-1' ? 'hello from grok' : ''),
    } as unknown as CliHistoryStore;
    const broker = {
      getJob: (id: string) => (id === 'grk-1' ? { status: 'completed' } : null),
      listJobEvents: () => [{ type: 'completed', status: 'completed', createdAt: meta.startedAt }],
    } as unknown as DelegateBrokerClient;

    const status = await handler({ operation: 'status', id: 'grk-1' }, { historyStore: store, broker });
    expect(status.success).toBe(true);
    expect(status.result).toMatchObject({ exec_id: 'grk-1', status: 'completed', tool: 'grok' });

    const output = await handler({ operation: 'output', id: 'grk-1' }, { historyStore: store, broker });
    expect(output.success).toBe(true);
    expect(output.result).toMatchObject({ output: 'hello from grok' });
  });

  it('cancel requests broker cancel', async () => {
    const store = {
      loadMeta: () => ({
        execId: 'grk-1',
        tool: 'grok',
        mode: 'analysis',
        prompt: 'x',
        workDir: '/tmp',
        startedAt: 't',
      }),
      getOutput: () => '',
    } as unknown as CliHistoryStore;
    const broker = {
      getJob: () => ({ status: 'running' }),
      listJobEvents: () => [],
      requestCancel: () => ({ status: 'running', metadata: { cancelRequestedAt: 'now' } }),
    } as unknown as DelegateBrokerClient;

    const result = await handler({ operation: 'cancel', id: 'grk-1' }, { historyStore: store, broker });
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ status: 'cancelling' });
  });
});
