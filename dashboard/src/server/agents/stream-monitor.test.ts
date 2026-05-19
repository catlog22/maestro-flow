import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamMonitor, DEFAULT_STREAM_TIMEOUT_MS } from './stream-monitor.js';

describe('StreamMonitor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('default silence window is 10 minutes', () => {
    expect(DEFAULT_STREAM_TIMEOUT_MS).toBe(600_000);
  });

  it('fires onStale after maxSilenceMs of inactivity', () => {
    const onStale = vi.fn();
    const monitor = new StreamMonitor(onStale, 1_000, 100);

    vi.advanceTimersByTime(900);
    expect(onStale).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300); // total 1200 > 1000
    expect(onStale).toHaveBeenCalledTimes(1);

    monitor.dispose();
  });

  it('fires only once until a heartbeat resets it', () => {
    const onStale = vi.fn();
    const monitor = new StreamMonitor(onStale, 1_000, 100);

    vi.advanceTimersByTime(2_000);
    expect(onStale).toHaveBeenCalledTimes(1); // not repeated every check

    monitor.heartbeat();
    vi.advanceTimersByTime(1_200);
    expect(onStale).toHaveBeenCalledTimes(2);

    monitor.dispose();
  });

  it('heartbeat keeps the monitor alive indefinitely', () => {
    const onStale = vi.fn();
    const monitor = new StreamMonitor(onStale, 1_000, 100);

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(500);
      monitor.heartbeat();
    }
    expect(onStale).not.toHaveBeenCalled();

    monitor.dispose();
  });

  it('dispose stops the timer', () => {
    const onStale = vi.fn();
    const monitor = new StreamMonitor(onStale, 1_000, 100);

    monitor.dispose();
    vi.advanceTimersByTime(5_000);
    expect(onStale).not.toHaveBeenCalled();
  });
});
