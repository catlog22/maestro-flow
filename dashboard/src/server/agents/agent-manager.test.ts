import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentManager } from './agent-manager.js';
import { DashboardEventBus } from '../state/event-bus.js';
import { EntryNormalizer } from './entry-normalizer.js';
import type { AgentProcess, NormalizedEntry } from '../../shared/agent-types.js';

// Mock fs to prevent real file I/O
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

function makeCliProcess(id: string, prompt = 'test prompt'): AgentProcess {
  return {
    id,
    type: 'claude-code',
    status: 'running',
    config: { type: 'claude-code', prompt, workDir: '/tmp' },
    startedAt: new Date().toISOString(),
  };
}

describe('AgentManager — CLI Bridge lifecycle', () => {
  let manager: AgentManager;
  let eventBus: DashboardEventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new DashboardEventBus();
    manager = new AgentManager(eventBus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Registration & entry buffering
  // -----------------------------------------------------------------------

  it('registerCliProcess makes process visible in listProcesses', () => {
    const proc = makeCliProcess('cli-1');
    manager.registerCliProcess(proc);
    const list = manager.listProcesses();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('cli-1');
  });

  it('addCliEntry buffers entries retrievable via getEntries', () => {
    const proc = makeCliProcess('cli-2');
    manager.registerCliProcess(proc);

    const entry = EntryNormalizer.userMessage('cli-2', 'hello');
    manager.addCliEntry('cli-2', entry);

    const entries = manager.getEntries('cli-2');
    expect(entries).toHaveLength(1);
    expect((entries[0] as { content: string }).content).toBe('hello');
  });

  it('addCliEntry caps history at MAX_HISTORY', () => {
    const proc = makeCliProcess('cli-cap');
    manager.registerCliProcess(proc);

    // Push 1001 entries — oldest should be evicted
    for (let i = 0; i < 1001; i++) {
      manager.addCliEntry('cli-cap', EntryNormalizer.userMessage('cli-cap', `msg-${i}`));
    }

    const entries = manager.getEntries('cli-cap');
    expect(entries).toHaveLength(1000);
    // First entry should be msg-1 (msg-0 evicted)
    expect((entries[0] as { content: string }).content).toBe('msg-1');
  });

  // -----------------------------------------------------------------------
  // CLI stop → delayed cleanup (P4 + G2)
  // -----------------------------------------------------------------------

  describe('updateCliProcessStatus — delayed cleanup', () => {
    it('marks process as stopped but keeps entries available', () => {
      const proc = makeCliProcess('cli-stop');
      manager.registerCliProcess(proc);
      manager.addCliEntry('cli-stop', EntryNormalizer.userMessage('cli-stop', 'data'));

      manager.updateCliProcessStatus('cli-stop', 'stopped');

      // Entries still available immediately after stop
      expect(manager.getEntries('cli-stop')).toHaveLength(1);
      // Process still listed (status updated)
      const listed = manager.listProcesses().find(p => p.id === 'cli-stop');
      expect(listed?.status).toBe('stopped');
    });

    it('cleans up entries after 5-minute delay', () => {
      const proc = makeCliProcess('cli-delay');
      manager.registerCliProcess(proc);
      manager.addCliEntry('cli-delay', EntryNormalizer.userMessage('cli-delay', 'data'));

      manager.updateCliProcessStatus('cli-delay', 'stopped');

      // Before 5 min: still available
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(manager.getEntries('cli-delay')).toHaveLength(1);
      expect(manager.listProcesses().some(p => p.id === 'cli-delay')).toBe(true);

      // After 5 min: cleaned up
      vi.advanceTimersByTime(1 * 60 * 1000 + 1);
      expect(manager.getEntries('cli-delay')).toHaveLength(0);
      expect(manager.listProcesses().some(p => p.id === 'cli-delay')).toBe(false);
    });

    it('resets cleanup timer on repeated status updates', () => {
      const proc = makeCliProcess('cli-reset');
      manager.registerCliProcess(proc);
      manager.addCliEntry('cli-reset', EntryNormalizer.userMessage('cli-reset', 'data'));

      manager.updateCliProcessStatus('cli-reset', 'stopped');

      // Advance 4 minutes, then update status again (resets timer)
      vi.advanceTimersByTime(4 * 60 * 1000);
      manager.updateCliProcessStatus('cli-reset', 'error');

      // Another 4 minutes — still within new 5-min window
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(manager.getEntries('cli-reset')).toHaveLength(1);

      // Final minute + 1ms — now cleaned up
      vi.advanceTimersByTime(1 * 60 * 1000 + 1);
      expect(manager.getEntries('cli-reset')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect recovery scenario (G1 simulation)
  // -----------------------------------------------------------------------

  describe('reconnect recovery — entries available for fetch', () => {
    it('stopped CLI process entries are fetchable within cleanup window', () => {
      const proc = makeCliProcess('cli-reconnect');
      manager.registerCliProcess(proc);

      // Simulate a session with multiple entries
      const entries = [
        EntryNormalizer.userMessage('cli-reconnect', 'initial prompt'),
        EntryNormalizer.assistantMessage('cli-reconnect', 'response text', false),
        EntryNormalizer.toolUse('cli-reconnect', 'Read', { path: '/test' }, 'completed', 'ok'),
      ];
      for (const e of entries) manager.addCliEntry('cli-reconnect', e);

      // Process stops
      manager.updateCliProcessStatus('cli-reconnect', 'stopped');

      // Simulate 2 minutes later — frontend reconnects
      vi.advanceTimersByTime(2 * 60 * 1000);

      // listProcesses still returns it (frontend discovers it)
      const processes = manager.listProcesses();
      expect(processes.some(p => p.id === 'cli-reconnect')).toBe(true);

      // getEntries returns full history (frontend loads it)
      const recovered = manager.getEntries('cli-reconnect');
      expect(recovered).toHaveLength(3);
      expect((recovered[0] as { content: string }).content).toBe('initial prompt');
    });

    it('entries are gone after cleanup window expires', () => {
      const proc = makeCliProcess('cli-expired');
      manager.registerCliProcess(proc);
      manager.addCliEntry('cli-expired', EntryNormalizer.userMessage('cli-expired', 'old data'));

      manager.updateCliProcessStatus('cli-expired', 'stopped');

      // 6 minutes later — past cleanup window
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(manager.listProcesses().some(p => p.id === 'cli-expired')).toBe(false);
      expect(manager.getEntries('cli-expired')).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // EventBus integration
  // -----------------------------------------------------------------------

  describe('eventBus emissions', () => {
    it('does not emit events for CLI bridge operations (read-only registration)', () => {
      const events: string[] = [];
      eventBus.onAny((e) => events.push(e.type));

      const proc = makeCliProcess('cli-quiet');
      manager.registerCliProcess(proc);
      manager.addCliEntry('cli-quiet', EntryNormalizer.userMessage('cli-quiet', 'test'));

      // registerCliProcess and addCliEntry are silent — events are emitted
      // by ws-manager which calls eventBus.emit separately
      expect(events).toHaveLength(0);
    });
  });
});
