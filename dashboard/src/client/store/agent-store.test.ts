import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agent-store.js';
import type { AgentProcess, NormalizedEntry } from '@/shared/agent-types.js';
import { EntryNormalizer } from '@/server/agents/entry-normalizer.js';

function makeProcess(id: string, status: 'running' | 'stopped' = 'running'): AgentProcess {
  return {
    id,
    type: 'claude-code',
    status,
    config: { type: 'claude-code', prompt: 'test', workDir: '/tmp' },
    startedAt: '2026-01-01T00:00:00Z',
  };
}

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().clearAll();
  });

  // -----------------------------------------------------------------------
  // addEntry idempotency (R1)
  // -----------------------------------------------------------------------

  describe('addEntry — idempotency', () => {
    it('skips duplicate entries with the same id', () => {
      const { addProcess, addEntry } = useAgentStore.getState();
      addProcess(makeProcess('p1'));

      const entry = EntryNormalizer.userMessage('p1', 'hello');
      addEntry('p1', entry);
      addEntry('p1', entry); // duplicate

      expect(useAgentStore.getState().entries['p1']).toHaveLength(1);
    });

    it('allows entries with different ids', () => {
      const { addProcess, addEntry } = useAgentStore.getState();
      addProcess(makeProcess('p1'));

      addEntry('p1', EntryNormalizer.userMessage('p1', 'first'));
      addEntry('p1', EntryNormalizer.userMessage('p1', 'second'));

      expect(useAgentStore.getState().entries['p1']).toHaveLength(2);
    });

    it('allows entries without id (treats as unique)', () => {
      const { addProcess, addEntry } = useAgentStore.getState();
      addProcess(makeProcess('p1'));

      const noIdEntry = { processId: 'p1', type: 'user_message', content: 'x', timestamp: new Date().toISOString() } as NormalizedEntry;
      addEntry('p1', noIdEntry);
      addEntry('p1', noIdEntry);

      // Both added since id is falsy
      expect(useAgentStore.getState().entries['p1']).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect scenario simulation (G1 + R1 combined)
  // -----------------------------------------------------------------------

  describe('reconnect scenario — WS entries + API fetch dedup', () => {
    it('real-time WS entries are not duplicated by reconnect fetch', () => {
      const { addProcess, addEntry } = useAgentStore.getState();
      addProcess(makeProcess('p-recon'));

      // Simulate: 3 entries arrived via WS before disconnect
      const wsEntries = [
        EntryNormalizer.userMessage('p-recon', 'prompt'),
        EntryNormalizer.assistantMessage('p-recon', 'response', false),
        EntryNormalizer.toolUse('p-recon', 'Read', {}, 'completed'),
      ];
      for (const e of wsEntries) addEntry('p-recon', e);

      expect(useAgentStore.getState().entries['p-recon']).toHaveLength(3);

      // Simulate: reconnect fetches same 3 entries + 1 new one from server buffer
      const newEntry = EntryNormalizer.assistantMessage('p-recon', 'after reconnect', false);
      const serverBuffer = [...wsEntries, newEntry];

      for (const e of serverBuffer) addEntry('p-recon', e);

      // Should be 4 total: 3 original (deduped) + 1 new
      expect(useAgentStore.getState().entries['p-recon']).toHaveLength(4);
    });

    it('process re-added on reconnect preserves existing entries', () => {
      const { addProcess, addEntry } = useAgentStore.getState();
      const proc = makeProcess('p-readd');
      addProcess(proc);

      addEntry('p-readd', EntryNormalizer.userMessage('p-readd', 'before'));

      // Simulate: reconnect calls addProcess again
      addProcess(proc);

      // Entries should be preserved (addProcess uses ?? to keep existing)
      expect(useAgentStore.getState().entries['p-readd']).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Token usage accumulation
  // -----------------------------------------------------------------------

  describe('updateProcessTokenUsage', () => {
    it('accumulates token usage across multiple calls', () => {
      const { addProcess, updateProcessTokenUsage } = useAgentStore.getState();
      addProcess(makeProcess('p-tok'));

      updateProcessTokenUsage('p-tok', 100, 50, 10, 5);
      updateProcessTokenUsage('p-tok', 200, 100, 20, 10);

      const usage = useAgentStore.getState().processTokenUsage['p-tok'];
      expect(usage).toEqual({
        input: 300,
        output: 150,
        cacheRead: 30,
        cacheWrite: 15,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Process status updates
  // -----------------------------------------------------------------------

  describe('updateProcessStatus', () => {
    it('updates status of existing process', () => {
      const { addProcess, updateProcessStatus } = useAgentStore.getState();
      addProcess(makeProcess('p-status', 'running'));

      updateProcessStatus('p-status', 'stopped');

      expect(useAgentStore.getState().processes['p-status'].status).toBe('stopped');
    });

    it('no-ops for unknown process', () => {
      const before = useAgentStore.getState();
      useAgentStore.getState().updateProcessStatus('nonexistent', 'stopped');
      expect(useAgentStore.getState().processes).toEqual(before.processes);
    });
  });
});
