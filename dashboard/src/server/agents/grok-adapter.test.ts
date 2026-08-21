import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import type { AgentConfig } from '../../shared/agent-types.js';

const spawnMock = vi.fn();
const killProcessTreeMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('./env-file-loader.js', () => ({
  loadEnvFile: vi.fn(() => ({})),
}));

vi.mock('./env-cleanup.js', () => ({
  cleanSpawnEnv: vi.fn((overrides: Record<string, string>) => ({
    ...process.env,
    ...overrides,
  })),
}));

vi.mock('./process-tree-kill.js', () => ({
  killProcessTree: (...args: unknown[]) => killProcessTreeMock(...args),
}));

import { GrokAdapter } from './grok-adapter.js';

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  pid: number;
  exitCode: number | null;
  signalCode: string | null;
  killed: boolean;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.pid = 54321;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  return child;
}

function baseConfig(): AgentConfig {
  return {
    type: 'grok',
    prompt: 'Test Grok stream',
    workDir: 'D:/maestro2',
  };
}

async function flushLines(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Extract the --prompt-file path from the spawn args and read its content */
function readSpawnedPrompt(): string {
  const args = spawnMock.mock.calls[0][1] as string[];
  const flagIndex = args.indexOf('--prompt-file');
  expect(flagIndex).toBeGreaterThan(-1);
  const promptPath = (args[flagIndex + 1] as string).replace(/^"|"$/g, '');
  expect(existsSync(promptPath)).toBe(true);
  return readFileSync(promptPath, 'utf-8');
}

describe('GrokAdapter', () => {
  let adapter: GrokAdapter;
  let child: FakeChild;

  beforeEach(() => {
    adapter = new GrokAdapter();
    child = createFakeChild();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);
    killProcessTreeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (adapter.listProcesses().length > 0) {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    }
  });

  it('passes the prompt via --prompt-file and closes stdin', async () => {
    const process = await adapter.spawn(baseConfig());

    expect(readSpawnedPrompt()).toBe('Test Grok stream');
    expect(child.stdin.end).toHaveBeenCalled();
    expect(adapter.getProcess(process.id)?.status).toBe('running');
  });

  it('builds args with streaming-json output, model and always-approve', async () => {
    await adapter.spawn({
      ...baseConfig(),
      model: 'grok-4.6',
      approvalMode: 'auto',
      apiKey: 'xai-test-key',
    });

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('streaming-json');
    expect(args[args.indexOf('-m') + 1]).toBe('grok-4.6');
    expect(args).toContain('--always-approve');

    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.XAI_API_KEY).toBe('xai-test-key');
  });

  it('streams text deltas as partial assistant messages', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    child.stdout.write(`${JSON.stringify({ type: 'text', data: 'hello' })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'text', data: ' world' })}\n`);
    await flushLines();

    const messages = entries.filter((entry) => entry.type === 'assistant_message');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ content: 'hello', partial: true });
    expect(messages[1]).toMatchObject({ content: ' world', partial: true });
  });

  it('buffers thought deltas and flushes one thinking entry on first text', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    child.stdout.write(`${JSON.stringify({ type: 'thought', data: 'The user' })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'thought', data: ' wants hello.' })}\n`);
    child.stdout.write(`${JSON.stringify({ type: 'text', data: 'hello' })}\n`);
    await flushLines();

    const thinking = entries.filter((entry) => entry.type === 'thinking');
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({ content: 'The user wants hello.' });
  });

  it('maps tool_call to running and tool_call_update to completed with result', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    const events = [
      {
        type: 'tool_call',
        toolCallId: 'call-1',
        title: 'list_dir',
        kind: 'list',
        status: 'pending',
        toolName: 'list_dir',
        rawInput: { target_directory: '.' },
        content: [],
        locations: [],
      },
      // Intermediate update without a terminal status is ignored
      { type: 'tool_call_update', toolCallId: 'call-1', status: null, content: [], rawOutput: null, locations: [] },
      {
        type: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [],
        rawOutput: { type: 'ListDir', Content: { content: '- a.ts\n- b.ts' } },
        locations: [],
      },
    ];
    for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
    await flushLines();

    const tools = entries.filter((entry) => entry.type === 'tool_use');
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'list_dir', status: 'running', input: { target_directory: '.' } });
    expect(tools[1]).toMatchObject({ name: 'list_dir', status: 'completed' });
    expect(String(tools[1].result)).toContain('a.ts');
  });

  it('marks failed tool_call_update as failed', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    child.stdout.write(`${JSON.stringify({
      type: 'tool_call', toolCallId: 'call-9', toolName: 'bash', status: 'pending', rawInput: {}, content: [], locations: [],
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      type: 'tool_call_update', toolCallId: 'call-9', status: 'failed', content: [], rawOutput: 'boom', locations: [],
    })}\n`);
    await flushLines();

    const tools = entries.filter((entry) => entry.type === 'tool_use');
    expect(tools.at(-1)).toMatchObject({ name: 'bash', status: 'failed', result: 'boom' });
  });

  it('ignores available_commands and per-turn usage, emits token usage from end', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    const events = [
      { type: 'available_commands', tools: ['read_file'], commands: ['compact'] },
      { type: 'usage', usage: { input_tokens: 100, output_tokens: 10 } },
      {
        type: 'end',
        stopReason: 'end_turn',
        sessionId: 'session-1',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
      },
    ];
    for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
    await flushLines();

    const usageEntries = entries.filter((entry) => entry.type === 'token_usage');
    expect(usageEntries).toHaveLength(1);
    expect(usageEntries[0]).toMatchObject({
      inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2,
    });
  });

  it('skips non-JSON lines without failing', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    child.stdout.write('grok: checking for updates…\n');
    child.stdout.write(`${JSON.stringify({ type: 'text', data: 'ok' })}\n`);
    await flushLines();

    expect(entries.filter((entry) => entry.type === 'error')).toHaveLength(0);
    expect(entries.filter((entry) => entry.type === 'assistant_message')).toHaveLength(1);
  });

  it('rejects follow-up messages', async () => {
    const process = await adapter.spawn(baseConfig());
    await expect(adapter.sendMessage(process.id, 'follow up')).rejects.toThrow(/not supported/);
  });

  it('passes --permission-mode dontAsk when approvalMode is not auto', async () => {
    await adapter.spawn(baseConfig());

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args).not.toContain('--always-approve');
  });

  it('rejects a model id with shell-unsafe characters before spawning', async () => {
    await expect(
      adapter.spawn({ ...baseConfig(), model: 'safe; printf PWNED' }),
    ).rejects.toThrow(/Invalid model id/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('keeps tool name mappings isolated across concurrent processes', async () => {
    const first = await adapter.spawn(baseConfig());
    const child2 = createFakeChild();
    child2.pid = 99999;
    spawnMock.mockReturnValue(child2);
    const second = await adapter.spawn(baseConfig());

    const entries2: Array<Record<string, unknown>> = [];
    adapter.onEntry(second.id, (entry) => entries2.push(entry as unknown as Record<string, unknown>));

    // Same toolCallId used by both sessions — names must not collide
    child.stdout.write(`${JSON.stringify({
      type: 'tool_call', toolCallId: 'call-1', toolName: 'list_dir', status: 'pending', rawInput: {}, content: [], locations: [],
    })}\n`);
    child2.stdout.write(`${JSON.stringify({
      type: 'tool_call', toolCallId: 'call-1', toolName: 'read_file', status: 'pending', rawInput: {}, content: [], locations: [],
    })}\n`);
    await flushLines();

    // Stopping the first session must not wipe the second's mappings
    await adapter.stop(first.id);
    child2.stdout.write(`${JSON.stringify({
      type: 'tool_call_update', toolCallId: 'call-1', status: 'completed', content: [], rawOutput: 'ok', locations: [],
    })}\n`);
    await flushLines();

    const tools = entries2.filter((entry) => entry.type === 'tool_use');
    expect(tools.at(-1)).toMatchObject({ name: 'read_file', status: 'completed', result: 'ok' });

    child2.exitCode = 0;
    child2.emit('exit', 0, null);
  });

  it('emits stopped status on exit and deletes the prompt file', async () => {
    const process = await adapter.spawn(baseConfig());
    const entries: Array<Record<string, unknown>> = [];
    adapter.onEntry(process.id, (entry) => entries.push(entry as unknown as Record<string, unknown>));

    const args = spawnMock.mock.calls[0][1] as string[];
    const promptPath = (args[args.indexOf('--prompt-file') + 1] as string).replace(/^"|"$/g, '');

    child.exitCode = 0;
    child.emit('exit', 0, null);
    await flushLines();

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status_change', status: 'stopped' }),
    ]));
    expect(existsSync(promptPath)).toBe(false);
    expect(adapter.getProcess(process.id)).toBeUndefined();
  });

  it('does not escalate a stopped child to SIGKILL after its exit event', async () => {
    vi.useFakeTimers();
    const process = await adapter.spawn(baseConfig());

    await adapter.stop(process.id);
    child.signalCode = 'SIGTERM';
    child.emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);

    expect(killProcessTreeMock).toHaveBeenCalledTimes(1);
    expect(killProcessTreeMock).toHaveBeenCalledWith(child.pid, 'SIGTERM');
  });

  it('escalates to SIGKILL when the child has not exited after five seconds', async () => {
    vi.useFakeTimers();
    const process = await adapter.spawn(baseConfig());

    const stopPromise = adapter.stop(process.id);
    await vi.advanceTimersByTimeAsync(5000);
    await stopPromise;

    expect(killProcessTreeMock.mock.calls).toEqual([
      [child.pid, 'SIGTERM'],
      [child.pid, 'SIGKILL'],
    ]);
  });
});
