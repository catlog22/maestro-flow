import { describe, it, expect, vi } from 'vitest';
import {
  stdoutEmitter,
  silentEmitter,
  createTraceEmitter,
  type StreamEvent,
} from './stream-json-emitter.js';

describe('createTraceEmitter', () => {
  it('collects protocol events in order', () => {
    const trace: StreamEvent[] = [];
    const emitter = createTraceEmitter(trace);

    emitter.init();
    emitter.message('thinking', true);
    emitter.toolUse('Search', { query: 'foo' }, 'tc-1');
    emitter.toolResult('tc-1', 'found it');
    emitter.message('final answer');
    emitter.result({ input_tokens: 10, output_tokens: 5 });

    expect(trace.map(e => e.type)).toEqual([
      'init', 'message', 'tool_use', 'tool_result', 'message', 'result',
    ]);
    expect(trace[2]).toMatchObject({ tool_name: 'Search', tool_id: 'tc-1' });
    expect(trace[5]).toMatchObject({ usage: { input_tokens: 10, output_tokens: 5 } });
  });

  it('truncates oversized tool_result content with a marker', () => {
    const trace: StreamEvent[] = [];
    const emitter = createTraceEmitter(trace);
    const big = 'x'.repeat(5_000);

    emitter.toolResult('tc-1', big);
    emitter.toolResult('tc-2', 'short');

    const truncated = trace[0].content as string;
    expect(truncated.length).toBeLessThan(big.length);
    expect(truncated).toContain('…[truncated 3000 chars]');
    expect(trace[1].content).toBe('short');
  });

  it('preserves is_error flag on tool results', () => {
    const trace: StreamEvent[] = [];
    const emitter = createTraceEmitter(trace);

    emitter.toolResult('tc-1', 'boom', true);

    expect(trace[0]).toMatchObject({ type: 'tool_result', is_error: true });
  });
});

describe('silentEmitter', () => {
  it('drops all events without touching stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      silentEmitter.init();
      silentEmitter.message('hello');
      silentEmitter.result();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('stdoutEmitter', () => {
  it('writes one NDJSON line per event', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      stdoutEmitter.toolUse('Read', { path: 'a.ts' }, 'tc-9');
      stdoutEmitter.result({ input_tokens: 1, output_tokens: 2 });
    } finally {
      spy.mockRestore();
    }

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      type: 'tool_use', tool_name: 'Read', parameters: { path: 'a.ts' }, tool_id: 'tc-9',
    });
    expect(lines[1].endsWith('\n')).toBe(true);
  });
});
