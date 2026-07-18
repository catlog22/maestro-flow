import type OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silentEmitter } from './stream-json-emitter.js';
import type { ToolSchema } from './tools.js';

const mocks = vi.hoisted(() => ({
  callLlm: vi.fn(),
  executeToolAsync: vi.fn(),
}));

vi.mock('./llm.js', () => ({ callLlm: mocks.callLlm }));
vi.mock('./tools.js', () => ({ executeToolAsync: mocks.executeToolAsync }));

import { agentLoop } from './agent-loop.js';

const client = {} as OpenAI;
const llmConfig = { model: 'test', baseUrl: 'https://example.test', apiKey: 'test' };
const batchSchema: ToolSchema = {
  type: 'function',
  function: {
    name: 'Batch',
    description: 'test batch',
    parameters: { type: 'object', properties: {} },
  },
};

function batchResponse(id: string) {
  return {
    content: null,
    toolCalls: [{ id, name: 'Batch', arguments: '{"commands":[{"type":"Search","query":"x"}]}' }],
    usage: { inputTokens: 10, outputTokens: 2 },
    stopReason: 'tool_calls',
  };
}

beforeEach(() => {
  mocks.callLlm.mockReset();
  mocks.executeToolAsync.mockReset();
  mocks.executeToolAsync.mockResolvedValue('batch result');
});

describe('agentLoop Batch round budget', () => {
  it('disables tools and forces a final answer after the configured Batch rounds', async () => {
    mocks.callLlm
      .mockResolvedValueOnce(batchResponse('batch-1'))
      .mockResolvedValueOnce(batchResponse('batch-2'))
      .mockResolvedValueOnce({
        content: 'final answer',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 4 },
        stopReason: 'stop',
      });

    const result = await agentLoop({
      prompt: 'find x',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [batchSchema],
      maxTurns: 2,
      cwd: process.cwd(),
      emitter: silentEmitter,
    });

    expect(result.content).toBe('final answer');
    expect(mocks.executeToolAsync).toHaveBeenCalledTimes(2);
    expect(mocks.callLlm).toHaveBeenCalledTimes(3);
    expect(mocks.callLlm.mock.calls[0][3]).toHaveLength(1);
    expect(mocks.callLlm.mock.calls[1][3]).toHaveLength(1);
    expect(mocks.callLlm.mock.calls[2][3]).toEqual([]);
    expect(mocks.callLlm.mock.calls[2][4]).toBeUndefined();
    const finalMessages = mocks.callLlm.mock.calls[2][2] as Array<{ role: string; content: string }>;
    expect(finalMessages.at(-1)?.content).toContain('Tools are now disabled');
  });

  it('does not force tool use when the caller intentionally supplies no tools', async () => {
    mocks.callLlm.mockResolvedValueOnce({
      content: 'aggregate answer',
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 2 },
      stopReason: 'stop',
    });

    const result = await agentLoop({
      prompt: 'aggregate',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [],
      maxTurns: 5,
      cwd: process.cwd(),
      emitter: silentEmitter,
    });

    expect(result.content).toBe('aggregate answer');
    expect(mocks.callLlm).toHaveBeenCalledTimes(1);
  });

  it('keeps only the three most recent tool rounds in the forced final request', async () => {
    for (let round = 1; round <= 5; round++) {
      mocks.callLlm.mockResolvedValueOnce(batchResponse(`batch-${round}`));
    }
    mocks.callLlm.mockResolvedValueOnce({
      content: 'compacted final answer',
      toolCalls: [],
      usage: { inputTokens: 20, outputTokens: 4 },
      stopReason: 'stop',
    });

    await agentLoop({
      prompt: 'find x',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [batchSchema],
      maxTurns: 5,
      cwd: process.cwd(),
      emitter: silentEmitter,
    });

    const finalMessages = mocks.callLlm.mock.calls[5][2] as Array<{
      role: string;
      content?: string;
      tool_calls?: unknown[];
    }>;
    const retainedToolRounds = finalMessages.filter(message =>
      message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
    );
    expect(retainedToolRounds).toHaveLength(3);
    expect(finalMessages.some(message => message.content?.includes('Earlier Batch rounds omitted'))).toBe(true);
    expect(mocks.callLlm.mock.calls[5][3]).toEqual([]);
  });

  it('merges undeclared direct Search and Read calls into one Batch round', async () => {
    mocks.callLlm
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'direct-search', name: 'Search', arguments: '{"query":"target","path":"src"}' },
          { id: 'direct-read', name: 'Read', arguments: '{"file_path":"src/target.ts","offset":10}' },
        ],
        usage: { inputTokens: 10, outputTokens: 2 },
        stopReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: 'final answer',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 4 },
        stopReason: 'stop',
      });

    const result = await agentLoop({
      prompt: 'find target',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [batchSchema],
      maxTurns: 1,
      cwd: process.cwd(),
      emitter: silentEmitter,
    });

    expect(result.content).toBe('final answer');
    expect(mocks.executeToolAsync).toHaveBeenCalledTimes(1);
    expect(mocks.executeToolAsync.mock.calls[0][0]).toBe('Batch');
    expect(JSON.parse(mocks.executeToolAsync.mock.calls[0][1])).toEqual({
      commands: [
        { query: 'target', path: 'src', type: 'Search' },
        { file_path: 'src/target.ts', offset: 10, type: 'Read' },
      ],
    });
  });

  it('adds an efficiency checkpoint after two rounds without consuming the hard cap', async () => {
    mocks.callLlm
      .mockResolvedValueOnce(batchResponse('batch-1'))
      .mockResolvedValueOnce(batchResponse('batch-2'))
      .mockResolvedValueOnce({
        content: 'enough evidence',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 4 },
        stopReason: 'stop',
      });

    const result = await agentLoop({
      prompt: 'trace x',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [batchSchema],
      maxTurns: 5,
      cwd: process.cwd(),
      emitter: silentEmitter,
    });

    expect(result.content).toBe('enough evidence');
    expect(mocks.callLlm.mock.calls[2][3]).toHaveLength(1);
    const checkpointMessages = mocks.callLlm.mock.calls[2][2] as Array<{ content?: string }>;
    expect(checkpointMessages.at(-1)?.content).toContain('Efficiency checkpoint');
  });

  it('injects ignored exact files into the first Batch once and deduplicates model Reads', async () => {
    mocks.callLlm
      .mockResolvedValueOnce({
        ...batchResponse('batch-1'),
        toolCalls: [{
          id: 'batch-1',
          name: 'Batch',
          arguments: '{"commands":[{"type":"Read","file_path":"docs/audit.md"},{"type":"Search","query":"X1"}]}',
        }],
      })
      .mockResolvedValueOnce({
        content: 'verified',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 4 },
        stopReason: 'stop',
      });

    await agentLoop({
      prompt: 'verify docs/audit.md',
      systemPrompt: 'system',
      client,
      llmConfig,
      toolSchemas: [batchSchema],
      maxTurns: 1,
      cwd: process.cwd(),
      emitter: silentEmitter,
      requiredInitialReads: ['docs/audit.md'],
    });

    expect(JSON.parse(mocks.executeToolAsync.mock.calls[0][1])).toEqual({
      commands: [
        { type: 'Read', file_path: 'docs/audit.md' },
        { type: 'Search', query: 'X1' },
      ],
    });
  });
});
