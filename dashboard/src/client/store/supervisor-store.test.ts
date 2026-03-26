import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSupervisorStore } from './supervisor-store.js';
import type { LearningStats, CommandPattern } from '../../shared/learning-types.js';
import type { ScheduledTask } from '../../shared/schedule-types.js';
import type { ExtensionInfo } from '../../shared/extension-types.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const mockStats: LearningStats = {
  totalCommands: 10,
  uniquePatterns: 3,
  topPatterns: [
    { command: 'gemini', frequency: 5, successRate: 0.9, avgDuration: 5000, lastUsed: '2026-01-01', contexts: [] },
  ],
  suggestions: [],
  knowledgeBaseSize: 2,
};

const mockTasks: ScheduledTask[] = [
  {
    id: 'task-1', name: 'Health Check', cronExpression: '0 * * * *',
    taskType: 'health-check', config: {}, enabled: true,
    lastRun: null, nextRun: null, history: [],
  },
];

const mockExtensions: ExtensionInfo[] = [
  { name: 'standard', version: '1.0.0', type: 'builder', description: 'builder: standard', status: 'enabled' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SupervisorStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useSupervisorStore.setState({
      activeTab: 'commander',
      learningStats: null,
      learningPatterns: [],
      knowledgeEntries: [],
      scheduledTasks: [],
      extensions: [],
      promptModes: [],
      promptBindings: {},
      error: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useSupervisorStore.getState();
      expect(state.activeTab).toBe('commander');
      expect(state.learningStats).toBeNull();
      expect(state.learningPatterns).toEqual([]);
      expect(state.scheduledTasks).toEqual([]);
      expect(state.extensions).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // UI actions
  // -------------------------------------------------------------------------
  describe('setActiveTab', () => {
    it('updates active tab', () => {
      useSupervisorStore.getState().setActiveTab('learning');
      expect(useSupervisorStore.getState().activeTab).toBe('learning');
    });
  });

  describe('clearError', () => {
    it('clears error state', () => {
      useSupervisorStore.setState({ error: 'some error' });
      useSupervisorStore.getState().clearError();
      expect(useSupervisorStore.getState().error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // WS event handlers
  // -------------------------------------------------------------------------
  describe('onLearningUpdate', () => {
    it('updates learningStats and learningPatterns', () => {
      useSupervisorStore.getState().onLearningUpdate(mockStats);
      const state = useSupervisorStore.getState();
      expect(state.learningStats).toEqual(mockStats);
      expect(state.learningPatterns).toEqual(mockStats.topPatterns);
    });
  });

  describe('onScheduleUpdate', () => {
    it('updates scheduledTasks', () => {
      useSupervisorStore.getState().onScheduleUpdate(mockTasks);
      expect(useSupervisorStore.getState().scheduledTasks).toEqual(mockTasks);
    });
  });

  describe('onScheduleTriggered', () => {
    it('updates lastRun and appends to history', () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      useSupervisorStore.getState().onScheduleTriggered({
        taskId: 'task-1',
        taskName: 'Health Check',
        taskType: 'health-check',
      });

      const tasks = useSupervisorStore.getState().scheduledTasks;
      expect(tasks[0].lastRun).toBeTruthy();
      expect(tasks[0].history).toHaveLength(1);
      expect(tasks[0].history[0].status).toBe('success');
    });

    it('does not modify unrelated tasks', () => {
      const tasks = [
        ...mockTasks,
        { ...mockTasks[0], id: 'task-2', name: 'Other' },
      ];
      useSupervisorStore.setState({ scheduledTasks: tasks });

      useSupervisorStore.getState().onScheduleTriggered({
        taskId: 'task-1',
        taskName: 'Health Check',
        taskType: 'health-check',
      });

      const state = useSupervisorStore.getState();
      expect(state.scheduledTasks[1].history).toHaveLength(0);
    });
  });

  describe('onExtensionLoaded', () => {
    it('replaces extensions list', () => {
      useSupervisorStore.getState().onExtensionLoaded({ extensions: mockExtensions });
      expect(useSupervisorStore.getState().extensions).toEqual(mockExtensions);
    });
  });

  describe('onExtensionError', () => {
    it('disables the errored extension', () => {
      useSupervisorStore.setState({ extensions: [...mockExtensions] });
      useSupervisorStore.getState().onExtensionError({ name: 'standard', error: 'crash' });

      const ext = useSupervisorStore.getState().extensions.find((e) => e.name === 'standard');
      expect(ext!.status).toBe('disabled');
    });

    it('does not affect other extensions', () => {
      const exts = [
        ...mockExtensions,
        { ...mockExtensions[0], name: 'other' },
      ];
      useSupervisorStore.setState({ extensions: exts });
      useSupervisorStore.getState().onExtensionError({ name: 'standard', error: 'crash' });

      const other = useSupervisorStore.getState().extensions.find((e) => e.name === 'other');
      expect(other!.status).toBe('enabled');
    });
  });

  // -------------------------------------------------------------------------
  // REST fetchers
  // -------------------------------------------------------------------------
  describe('fetchLearningStats', () => {
    it('fetches and stores learning stats', async () => {
      mockFetch(async () => jsonResponse(mockStats));
      await useSupervisorStore.getState().fetchLearningStats();

      const state = useSupervisorStore.getState();
      expect(state.learningStats).toEqual(mockStats);
      expect(state.learningPatterns).toEqual(mockStats.topPatterns);
      expect(state.error).toBeNull();
    });

    it('sets error on non-OK response', async () => {
      mockFetch(async () => jsonResponse({}, 500));
      await useSupervisorStore.getState().fetchLearningStats();
      expect(useSupervisorStore.getState().error).toContain('500');
    });

    it('sets error on fetch failure', async () => {
      mockFetch(async () => { throw new Error('Network error'); });
      await useSupervisorStore.getState().fetchLearningStats();
      expect(useSupervisorStore.getState().error).toContain('Network error');
    });
  });

  describe('fetchSchedules', () => {
    it('fetches and stores schedules (wrapped format)', async () => {
      mockFetch(async () => jsonResponse({ tasks: mockTasks }));
      await useSupervisorStore.getState().fetchSchedules();

      expect(useSupervisorStore.getState().scheduledTasks).toEqual(mockTasks);
      expect(useSupervisorStore.getState().error).toBeNull();
    });

    it('handles array format gracefully', async () => {
      mockFetch(async () => jsonResponse(mockTasks));
      await useSupervisorStore.getState().fetchSchedules();
      expect(useSupervisorStore.getState().scheduledTasks).toEqual(mockTasks);
    });

    it('sets error on failure', async () => {
      mockFetch(async () => { throw new Error('Timeout'); });
      await useSupervisorStore.getState().fetchSchedules();
      expect(useSupervisorStore.getState().error).toContain('Timeout');
    });
  });

  describe('fetchExtensions', () => {
    it('fetches and stores extensions (wrapped format)', async () => {
      mockFetch(async () => jsonResponse({ extensions: mockExtensions }));
      await useSupervisorStore.getState().fetchExtensions();

      expect(useSupervisorStore.getState().extensions).toEqual(mockExtensions);
      expect(useSupervisorStore.getState().error).toBeNull();
    });

    it('handles array format gracefully', async () => {
      mockFetch(async () => jsonResponse(mockExtensions));
      await useSupervisorStore.getState().fetchExtensions();
      expect(useSupervisorStore.getState().extensions).toEqual(mockExtensions);
    });
  });

  describe('fetchPromptModes', () => {
    it('fetches builders and bindings', async () => {
      mockFetch(async () => jsonResponse({
        builders: ['standard', 'deep-analysis'],
        bindings: { strategy: 'standard' },
      }));
      await useSupervisorStore.getState().fetchPromptModes();

      const state = useSupervisorStore.getState();
      expect(state.promptModes).toEqual(['standard', 'deep-analysis']);
      expect(state.promptBindings).toEqual({ strategy: 'standard' });
    });
  });

  // -------------------------------------------------------------------------
  // Schedule CRUD
  // -------------------------------------------------------------------------
  describe('createSchedule', () => {
    it('adds created task to state', async () => {
      const newTask: ScheduledTask = { ...mockTasks[0], id: 'new-1' };
      mockFetch(async () => jsonResponse({ ok: true, task: newTask }));

      await useSupervisorStore.getState().createSchedule({
        name: 'New',
        cronExpression: '0 * * * *',
        taskType: 'custom',
        enabled: true,
        config: {},
      });

      expect(useSupervisorStore.getState().scheduledTasks).toHaveLength(1);
    });

    it('sets error on failure', async () => {
      mockFetch(async () => jsonResponse({}, 500));
      await useSupervisorStore.getState().createSchedule({
        name: 'Fail',
        cronExpression: '0 * * * *',
        taskType: 'custom',
        enabled: true,
        config: {},
      });
      expect(useSupervisorStore.getState().error).toContain('500');
    });
  });

  describe('updateSchedule', () => {
    it('replaces updated task in state', async () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      const updated = { ...mockTasks[0], name: 'Updated' };
      mockFetch(async () => jsonResponse({ ok: true, task: updated }));

      await useSupervisorStore.getState().updateSchedule('task-1', { name: 'Updated' });

      const task = useSupervisorStore.getState().scheduledTasks.find((t) => t.id === 'task-1');
      expect(task!.name).toBe('Updated');
    });
  });

  describe('deleteSchedule', () => {
    it('removes task from state', async () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      mockFetch(async () => jsonResponse({ ok: true }));

      await useSupervisorStore.getState().deleteSchedule('task-1');
      expect(useSupervisorStore.getState().scheduledTasks).toHaveLength(0);
    });

    it('sets error on failure', async () => {
      mockFetch(async () => jsonResponse({}, 404));
      await useSupervisorStore.getState().deleteSchedule('fake');
      expect(useSupervisorStore.getState().error).toContain('404');
    });
  });

  describe('toggleSchedule', () => {
    it('delegates to updateSchedule', async () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      const toggled = { ...mockTasks[0], enabled: false };
      mockFetch(async () => jsonResponse({ ok: true, task: toggled }));

      await useSupervisorStore.getState().toggleSchedule('task-1', false);

      const task = useSupervisorStore.getState().scheduledTasks.find((t) => t.id === 'task-1');
      expect(task!.enabled).toBe(false);
    });
  });

  describe('runSchedule', () => {
    it('sends POST without modifying state', async () => {
      let calledUrl = '';
      mockFetch(async (url) => {
        calledUrl = url;
        return jsonResponse({ ok: true });
      });

      await useSupervisorStore.getState().runSchedule('task-1');
      expect(calledUrl).toContain('task-1/run');
    });

    it('sets error on failure', async () => {
      mockFetch(async () => jsonResponse({}, 500));
      await useSupervisorStore.getState().runSchedule('fake');
      expect(useSupervisorStore.getState().error).toContain('500');
    });
  });

  // -------------------------------------------------------------------------
  // P1: Guard conditions & edge cases
  // -------------------------------------------------------------------------
  describe('fetchLearningStats guard', () => {
    it('does not update state when response lacks topPatterns', async () => {
      mockFetch(async () => jsonResponse({ unrelated: 'data' }));
      await useSupervisorStore.getState().fetchLearningStats();
      // learningStats should remain null since topPatterns check fails
      expect(useSupervisorStore.getState().learningStats).toBeNull();
    });
  });

  describe('fetchPromptModes edge cases', () => {
    it('handles missing builders and bindings gracefully', async () => {
      mockFetch(async () => jsonResponse({}));
      await useSupervisorStore.getState().fetchPromptModes();
      const state = useSupervisorStore.getState();
      expect(state.promptModes).toEqual([]);
      expect(state.promptBindings).toEqual({});
    });

    it('sets error on network failure', async () => {
      mockFetch(async () => { throw new Error('DNS failed'); });
      await useSupervisorStore.getState().fetchPromptModes();
      expect(useSupervisorStore.getState().error).toContain('DNS failed');
    });
  });

  describe('createSchedule guard', () => {
    it('does not modify state when response lacks task field', async () => {
      mockFetch(async () => jsonResponse({ ok: true })); // no task field
      await useSupervisorStore.getState().createSchedule({
        name: 'Ghost',
        cronExpression: '0 * * * *',
        taskType: 'custom',
        enabled: true,
        config: {},
      });
      expect(useSupervisorStore.getState().scheduledTasks).toHaveLength(0);
    });
  });

  describe('updateSchedule guard', () => {
    it('does not modify state when response lacks task field', async () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      mockFetch(async () => jsonResponse({ ok: true })); // no task field
      await useSupervisorStore.getState().updateSchedule('task-1', { name: 'X' });
      // Tasks should remain unchanged
      expect(useSupervisorStore.getState().scheduledTasks[0].name).toBe('Health Check');
    });

    it('sets error on network failure', async () => {
      mockFetch(async () => { throw new Error('Connection refused'); });
      await useSupervisorStore.getState().updateSchedule('task-1', { name: 'X' });
      expect(useSupervisorStore.getState().error).toContain('Connection refused');
    });
  });

  describe('fetchExtensions guard', () => {
    it('sets error on non-OK response', async () => {
      mockFetch(async () => jsonResponse({}, 503));
      await useSupervisorStore.getState().fetchExtensions();
      expect(useSupervisorStore.getState().error).toContain('503');
    });
  });

  describe('onScheduleTriggered edge', () => {
    it('does not modify tasks when taskId not found', () => {
      useSupervisorStore.setState({ scheduledTasks: [...mockTasks] });
      useSupervisorStore.getState().onScheduleTriggered({
        taskId: 'nonexistent',
        taskName: 'Ghost',
        taskType: 'custom',
      });
      // All tasks should be unchanged
      const tasks = useSupervisorStore.getState().scheduledTasks;
      expect(tasks[0].history).toHaveLength(0);
      expect(tasks[0].lastRun).toBeNull();
    });
  });
});
