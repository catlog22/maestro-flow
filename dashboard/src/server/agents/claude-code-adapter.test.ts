import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentConfig } from '../../shared/agent-types.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

// Capture spawn calls
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ClaudeCodeAdapter } from './claude-code-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeStdin {
  writable: boolean;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

/** Create a fake ChildProcess with piped stdio streams */
function createFakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  } as FakeStdin;
  child.pid = 12345;
  child.killed = false;
  child.kill = vi.fn();
  return child;
}

function baseConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    type: 'claude-code',
    prompt: 'Hello world',
    workDir: '/tmp/test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;
  let fakeChild: ReturnType<typeof createFakeChild>;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
    fakeChild = createFakeChild();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeChild);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // supportsInteractive
  // -----------------------------------------------------------------------

  it('supportsInteractive returns true', () => {
    expect(adapter.supportsInteractive()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Default (non-interactive) spawn mode
  // -----------------------------------------------------------------------

  describe('default spawn mode (--print)', () => {
    it('uses --print flag and passes prompt as CLI argument', async () => {
      const config = baseConfig();
      await adapter.spawn(config);

      const spawnArgs = spawnMock.mock.calls[0];
      const cliArgs: string[] = spawnArgs[1];
      expect(cliArgs).toContain('--print');
      expect(cliArgs).toContain('--output-format=stream-json');
      expect(cliArgs).toContain('Hello world');
      expect(cliArgs).not.toContain('--input-format=stream-json');
    });

    it('closes stdin immediately', async () => {
      const config = baseConfig();
      await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      expect(stdin.end).toHaveBeenCalled();
      expect(stdin.write).not.toHaveBeenCalled();
    });

    it('returns AgentProcess with interactive=true', async () => {
      const config = baseConfig();
      const proc = await adapter.spawn(config);

      expect(proc.interactive).toBe(true);
      expect(proc.status).toBe('running');
      expect(proc.type).toBe('claude-code');
    });
  });

  // -----------------------------------------------------------------------
  // Interactive spawn mode
  // -----------------------------------------------------------------------

  describe('interactive spawn mode (--input-format=stream-json)', () => {
    it('uses --input-format=stream-json instead of --print', async () => {
      const config = baseConfig({ interactive: true, prompt: 'Interactive prompt' });
      await adapter.spawn(config);

      const spawnArgs = spawnMock.mock.calls[0];
      const cliArgs: string[] = spawnArgs[1];
      expect(cliArgs).toContain('--input-format=stream-json');
      expect(cliArgs).toContain('--output-format=stream-json');
      expect(cliArgs).toContain('--print');
      // Prompt should NOT be in CLI args (sent via stdin instead)
      expect(cliArgs).not.toContain('Interactive prompt');
    });

    it('sends initial prompt via stdin as user_message JSON', async () => {
      const config = baseConfig({ interactive: true, prompt: 'Test prompt' });
      await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      expect(stdin.write).toHaveBeenCalledTimes(1);

      const written = stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({ type: 'user', message: { role: 'user', content: 'Test prompt' } });
    });

    it('does NOT close stdin', async () => {
      const config = baseConfig({ interactive: true });
      await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      expect(stdin.end).not.toHaveBeenCalled();
    });

    it('returns AgentProcess with interactive=true', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      expect(proc.interactive).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // doSendMessage
  // -----------------------------------------------------------------------

  describe('sendMessage in interactive mode', () => {
    it('writes user_message JSON to stdin', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      // Clear the initial prompt write
      stdin.write.mockClear();

      await adapter.sendMessage(proc.id, 'Follow-up message');

      expect(stdin.write).toHaveBeenCalledTimes(1);
      const written = stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed).toEqual({ type: 'user', message: { role: 'user', content: 'Follow-up message' } });
    });
  });

  // -----------------------------------------------------------------------
  // interactive=false explicit
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // approvalMode → --permission-mode mapping
  // -----------------------------------------------------------------------

  describe('approvalMode permission flags', () => {
    it('approvalMode=auto passes --permission-mode bypassPermissions', async () => {
      const config = baseConfig({ approvalMode: 'auto' });
      await adapter.spawn(config);

      const cliArgs: string[] = spawnMock.mock.calls[0][1];
      expect(cliArgs).toContain('--permission-mode');
      expect(cliArgs[cliArgs.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    });

    it('approvalMode=suggest passes --permission-mode default with read-only allowedTools', async () => {
      const config = baseConfig({ approvalMode: 'suggest' });
      await adapter.spawn(config);

      const cliArgs: string[] = spawnMock.mock.calls[0][1];
      expect(cliArgs).toContain('--permission-mode');
      expect(cliArgs[cliArgs.indexOf('--permission-mode') + 1]).toBe('default');
      expect(cliArgs).toContain('--allowedTools');
      expect(cliArgs[cliArgs.indexOf('--allowedTools') + 1]).toContain('Read');
    });

    it('no approvalMode does not add permission flags', async () => {
      const config = baseConfig();
      await adapter.spawn(config);

      const cliArgs: string[] = spawnMock.mock.calls[0][1];
      expect(cliArgs).not.toContain('--permission-mode');
      expect(cliArgs).not.toContain('--allowedTools');
    });
  });

  it('interactive=false uses default --print mode', async () => {
    const config = baseConfig({ interactive: false });
    await adapter.spawn(config);

    const spawnArgs = spawnMock.mock.calls[0];
    const cliArgs: string[] = spawnArgs[1];
    expect(cliArgs).toContain('--print');
    expect(cliArgs).not.toContain('--input-format=stream-json');
  });

  // -----------------------------------------------------------------------
  // Streaming message injection during execution
  // -----------------------------------------------------------------------

  describe('streaming message injection during execution', () => {
    it('can inject multiple messages sequentially while process is running', async () => {
      const config = baseConfig({ interactive: true, prompt: 'Initial' });
      const proc = await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      stdin.write.mockClear();

      await adapter.sendMessage(proc.id, 'Message 1');
      await adapter.sendMessage(proc.id, 'Message 2');
      await adapter.sendMessage(proc.id, 'Message 3');

      expect(stdin.write).toHaveBeenCalledTimes(3);

      const messages = stdin.write.mock.calls.map(
        (call: unknown[]) => JSON.parse((call[0] as string).trim()),
      );
      expect(messages).toEqual([
        { type: 'user', message: { role: 'user', content: 'Message 1' } },
        { type: 'user', message: { role: 'user', content: 'Message 2' } },
        { type: 'user', message: { role: 'user', content: 'Message 3' } },
      ]);
    });

    it('throws when sending message to non-interactive (stdin closed) process', async () => {
      const config = baseConfig({ interactive: false });
      const proc = await adapter.spawn(config);

      // In non-interactive mode stdin.end() was called, mark as not writable
      (fakeChild.stdin as FakeStdin).writable = false;

      await expect(adapter.sendMessage(proc.id, 'Should fail'))
        .rejects.toThrow(/stdin not writable/);
    });

    it('throws when sending message after process has exited', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      // Simulate process exit
      fakeChild.emit('exit', 0, null);

      // After exit, process is removed — sendMessage should throw
      await expect(adapter.sendMessage(proc.id, 'Too late'))
        .rejects.toThrow();
    });

    it('handles message with special characters and newlines', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      stdin.write.mockClear();

      const specialContent = 'Line1\nLine2\n{"nested": "json"}\ttabs';
      await adapter.sendMessage(proc.id, specialContent);

      const written = stdin.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed.message.content).toBe(specialContent);
      expect(parsed.type).toBe('user');
    });

    it('can interleave sendMessage with receiving stream output', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<{ type: string; content?: string }> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push({ type: entry.type, content: 'content' in entry ? entry.content as string : undefined });
      });

      const stdin = fakeChild.stdin as FakeStdin;
      stdin.write.mockClear();

      // Simulate assistant response arriving
      const assistantMsg = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Response 1' }] },
      });
      fakeChild.stdout.write(assistantMsg + '\n');

      // Give readline time to process
      await new Promise((r) => setTimeout(r, 10));

      // Inject a follow-up message mid-stream
      await adapter.sendMessage(proc.id, 'Follow-up question');

      // Simulate another assistant response
      const assistantMsg2 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Response 2' }] },
      });
      fakeChild.stdout.write(assistantMsg2 + '\n');

      await new Promise((r) => setTimeout(r, 10));

      // Verify both responses were captured
      const assistantEntries = entries.filter((e) => e.type === 'assistant_message');
      expect(assistantEntries).toHaveLength(2);
      expect(assistantEntries[0].content).toBe('Response 1');
      expect(assistantEntries[1].content).toBe('Response 2');

      // Verify follow-up was written to stdin
      expect(stdin.write).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse((stdin.write.mock.calls[0][0] as string).trim());
      expect(parsed).toEqual({ type: 'user', message: { role: 'user', content: 'Follow-up question' } });
    });
  });

  // -----------------------------------------------------------------------
  // Stream-json parsing
  // -----------------------------------------------------------------------

  describe('stream-json message parsing', () => {
    async function spawnAndCollect(messages: string[]) {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<Record<string, unknown>> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push(entry as unknown as Record<string, unknown>);
      });

      for (const msg of messages) {
        fakeChild.stdout.write(msg + '\n');
      }
      await new Promise((r) => setTimeout(r, 10));

      return entries;
    }

    it('parses content_block_delta for streaming tokens', async () => {
      const entries = await spawnAndCollect([
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial ' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'response' } }),
      ]);

      const partials = entries.filter((e) => e.type === 'assistant_message' && e.partial === true);
      expect(partials).toHaveLength(2);
    });

    it('parses tool_use and tool_result pair', async () => {
      const entries = await spawnAndCollect([
        JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: '/test.ts' } }),
        JSON.stringify({ type: 'tool_result', name: 'Read', content: 'file contents', is_error: false }),
      ]);

      const toolEntries = entries.filter((e) => e.type === 'tool_use');
      expect(toolEntries).toHaveLength(2);
      expect(toolEntries[0].name).toBe('Read');
      expect(toolEntries[0].status).toBe('running');
      expect(toolEntries[1].status).toBe('completed');
    });

    it('parses result with token usage', async () => {
      const entries = await spawnAndCollect([
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'Done',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 },
        }),
      ]);

      const usage = entries.filter((e) => e.type === 'token_usage');
      expect(usage).toHaveLength(1);
      expect(usage[0].inputTokens).toBe(100);
      expect(usage[0].outputTokens).toBe(50);
    });

    it('skips non-JSON lines gracefully', async () => {
      const entries = await spawnAndCollect([
        'npx: installing @anthropic-ai/claude-code...',
        '',
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      ]);

      // Only the valid JSON line should produce an entry
      const assistantEntries = entries.filter((e) => e.type === 'assistant_message');
      expect(assistantEntries).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Stop and cleanup
  // -----------------------------------------------------------------------

  describe('stop and cleanup', () => {
    it('sends SIGTERM on stop', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      await adapter.stop(proc.id);

      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('emits status_change entry on process exit', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<Record<string, unknown>> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push(entry as unknown as Record<string, unknown>);
      });

      fakeChild.emit('exit', 0, null);
      await new Promise((r) => setTimeout(r, 10));

      const statusEntries = entries.filter((e) => e.type === 'status_change');
      expect(statusEntries).toHaveLength(1);
      expect(statusEntries[0].status).toBe('stopped');
    });

    it('emits stopped on child close event (Windows fallback)', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<Record<string, unknown>> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push(entry as unknown as Record<string, unknown>);
      });

      // Only 'close' fires, not 'exit' (Windows process tree edge case)
      fakeChild.emit('close', 0, null);
      await new Promise((r) => setTimeout(r, 10));

      const statusEntries = entries.filter((e) => e.type === 'status_change');
      expect(statusEntries).toHaveLength(1);
      expect(statusEntries[0].status).toBe('stopped');
    });

    it('emits stopped only once when both exit and close fire', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<Record<string, unknown>> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push(entry as unknown as Record<string, unknown>);
      });

      fakeChild.emit('exit', 0, null);
      fakeChild.emit('close', 0, null);
      await new Promise((r) => setTimeout(r, 10));

      const stoppedEntries = entries.filter(
        (e) => e.type === 'status_change' && e.status === 'stopped',
      );
      expect(stoppedEntries).toHaveLength(1);
    });

    it('readline close fallback emits stopped when exit/close are missed', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const entries: Array<Record<string, unknown>> = [];
      adapter.onEntry(proc.id, (entry) => {
        entries.push(entry as unknown as Record<string, unknown>);
      });

      // Simulate stdout ending without exit/close events on the child process
      fakeChild.stdout.push(null);
      // readline 'close' handler has 500ms delay
      await new Promise((r) => setTimeout(r, 700));

      const stoppedEntries = entries.filter(
        (e) => e.type === 'status_change' && e.status === 'stopped',
      );
      expect(stoppedEntries).toHaveLength(1);
    });

    it('doStop closes stdin before sending SIGTERM', async () => {
      const config = baseConfig({ interactive: true });
      const proc = await adapter.spawn(config);

      const stdin = fakeChild.stdin as FakeStdin;
      await adapter.stop(proc.id);

      expect(stdin.end).toHaveBeenCalled();
      expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
