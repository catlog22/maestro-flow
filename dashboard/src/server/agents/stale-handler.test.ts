import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';

vi.mock('./process-tree-kill.js', () => ({
  killProcessTree: vi.fn(),
}));

import { createStaleHandler } from './stale-handler.js';
import { killProcessTree } from './process-tree-kill.js';

const killProcessTreeMock = vi.mocked(killProcessTree);

function fakeChild(): ChildProcess {
  return {
    pid: 12345,
    stdin: { writable: true, end: vi.fn() },
  } as unknown as ChildProcess;
}

describe('createStaleHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    killProcessTreeMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('logs the configured timeout and closes stdin immediately', () => {
    const child = fakeChild();
    const onStaleDetected = vi.fn();
    const handler = createStaleHandler({
      processId: 'p1',
      child,
      timeoutMs: 600_000,
      onStaleDetected,
      isStopped: () => false,
      emitStopped: vi.fn(),
    });

    handler();

    expect(onStaleDetected).toHaveBeenCalledWith('Stream stale: no output for 600s');
    expect((child.stdin as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled();
  });

  it('escalates SIGTERM → SIGKILL → emitStopped when never stopped', () => {
    const child = fakeChild();
    const emitStopped = vi.fn();
    const handler = createStaleHandler({
      processId: 'p1',
      child,
      timeoutMs: 60_000,
      onStaleDetected: vi.fn(),
      isStopped: () => false,
      emitStopped,
    });

    handler();

    vi.advanceTimersByTime(5_000);
    expect(killProcessTreeMock).toHaveBeenCalledWith(12345, 'SIGTERM');

    vi.advanceTimersByTime(3_000);
    expect(killProcessTreeMock).toHaveBeenCalledWith(12345, 'SIGKILL');

    vi.advanceTimersByTime(2_000);
    expect(emitStopped).toHaveBeenCalledWith('Force stopped (stale stream fallback)');
  });

  it('does nothing further once the process is already stopped', () => {
    const child = fakeChild();
    const emitStopped = vi.fn();
    const handler = createStaleHandler({
      processId: 'p1',
      child,
      timeoutMs: 60_000,
      onStaleDetected: vi.fn(),
      isStopped: () => true,
      emitStopped,
    });

    handler();
    vi.advanceTimersByTime(20_000);

    expect(killProcessTreeMock).not.toHaveBeenCalled();
    expect(emitStopped).not.toHaveBeenCalled();
  });

  it('stops escalating if the process exits between SIGTERM and SIGKILL', () => {
    const child = fakeChild();
    let stopped = false;
    const handler = createStaleHandler({
      processId: 'p1',
      child,
      timeoutMs: 60_000,
      onStaleDetected: vi.fn(),
      isStopped: () => stopped,
      emitStopped: vi.fn(),
    });

    handler();
    vi.advanceTimersByTime(5_000);
    expect(killProcessTreeMock).toHaveBeenCalledWith(12345, 'SIGTERM');

    stopped = true; // process exited in response to SIGTERM
    vi.advanceTimersByTime(5_000);
    expect(killProcessTreeMock).not.toHaveBeenCalledWith(12345, 'SIGKILL');
  });
});
