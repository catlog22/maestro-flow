import { describe, it, expect, beforeEach } from 'vitest';
import { useExecutionStore } from './execution-store.js';
import type { ExecutionSlot, SupervisorStatus } from '@/shared/execution-types.js';

function makeSlot(overrides: Partial<ExecutionSlot> = {}): ExecutionSlot {
  return {
    issueId: 'ISS-001',
    processId: 'proc-001',
    executor: 'claude-code',
    startedAt: '2026-01-01T00:00:00Z',
    lastActivityAt: '2026-01-01T00:00:00Z',
    turnNumber: 1,
    maxTurns: 3,
    ...overrides,
  };
}

describe('useExecutionStore', () => {
  beforeEach(() => {
    useExecutionStore.setState({
      slots: {},
      queue: [],
      supervisorStatus: null,
      selectedIssueIds: new Set(),
      cliPanelIssueId: null,
    });
  });

  describe('addSlot / removeSlot', () => {
    it('adds a slot by processId', () => {
      const slot = makeSlot();
      useExecutionStore.getState().addSlot(slot);
      expect(useExecutionStore.getState().slots['proc-001']).toBe(slot);
    });

    it('removes a slot', () => {
      useExecutionStore.getState().addSlot(makeSlot());
      useExecutionStore.getState().removeSlot('proc-001');
      expect(useExecutionStore.getState().slots['proc-001']).toBeUndefined();
    });
  });

  describe('setQueue', () => {
    it('sets the queue array', () => {
      useExecutionStore.getState().setQueue(['a', 'b']);
      expect(useExecutionStore.getState().queue).toEqual(['a', 'b']);
    });
  });

  describe('setSupervisorStatus', () => {
    it('sets supervisor status and updates queue', () => {
      const status: SupervisorStatus = {
        enabled: true,
        running: [],
        queued: ['ISS-1', 'ISS-2'],
        retrying: [],
        lastTickAt: null,
        isCommanderActive: false,
        stats: { totalDispatched: 0, totalCompleted: 0, totalFailed: 0 },
      } as SupervisorStatus;
      useExecutionStore.getState().setSupervisorStatus(status);
      expect(useExecutionStore.getState().supervisorStatus).toBe(status);
      expect(useExecutionStore.getState().queue).toEqual(['ISS-1', 'ISS-2']);
    });
  });

  describe('toggleSelect', () => {
    it('adds issue to selection', () => {
      useExecutionStore.getState().toggleSelect('ISS-001');
      expect(useExecutionStore.getState().selectedIssueIds.has('ISS-001')).toBe(true);
    });

    it('removes issue from selection on second toggle', () => {
      useExecutionStore.getState().toggleSelect('ISS-001');
      useExecutionStore.getState().toggleSelect('ISS-001');
      expect(useExecutionStore.getState().selectedIssueIds.has('ISS-001')).toBe(false);
    });
  });

  describe('selectAll / clearSelection', () => {
    it('selectAll sets all provided ids', () => {
      useExecutionStore.getState().selectAll(['a', 'b', 'c']);
      expect(useExecutionStore.getState().selectedIssueIds.size).toBe(3);
    });

    it('clearSelection empties the set', () => {
      useExecutionStore.getState().selectAll(['a']);
      useExecutionStore.getState().clearSelection();
      expect(useExecutionStore.getState().selectedIssueIds.size).toBe(0);
    });
  });

  describe('CLI panel', () => {
    it('opens and closes CLI panel', () => {
      useExecutionStore.getState().openCliPanel('ISS-001');
      expect(useExecutionStore.getState().cliPanelIssueId).toBe('ISS-001');
      useExecutionStore.getState().closeCliPanel();
      expect(useExecutionStore.getState().cliPanelIssueId).toBeNull();
    });
  });

  describe('derived helpers', () => {
    it('getSlotForIssue finds slot by issueId', () => {
      useExecutionStore.getState().addSlot(makeSlot({ issueId: 'ISS-X', processId: 'p1' }));
      const slot = useExecutionStore.getState().getSlotForIssue('ISS-X');
      expect(slot?.processId).toBe('p1');
    });

    it('getSlotForIssue returns undefined for missing issue', () => {
      expect(useExecutionStore.getState().getSlotForIssue('nope')).toBeUndefined();
    });

    it('isIssueRunning returns true when slot exists', () => {
      useExecutionStore.getState().addSlot(makeSlot({ issueId: 'ISS-R' }));
      expect(useExecutionStore.getState().isIssueRunning('ISS-R')).toBe(true);
    });

    it('isIssueRunning returns false when no slot', () => {
      expect(useExecutionStore.getState().isIssueRunning('ISS-R')).toBe(false);
    });
  });
});
