import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentManager } from './agent-manager.js';
import { DelegateBrokerMonitor } from './delegate-broker-monitor.js';
import { DashboardEventBus } from '../state/event-bus.js';

vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

describe('DelegateBrokerMonitor', () => {
  let agentManager: AgentManager;
  let eventBus: DashboardEventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new DashboardEventBus();
    agentManager = new AgentManager(eventBus);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects broker events into dashboard agent processes and entries', async () => {
    let polled = false;
    const broker = {
      registerSession: vi.fn(),
      heartbeat: vi.fn(),
      publishEvent: vi.fn(),
      pollEvents: vi.fn(() => {
        if (polled) {
          return [];
        }
        polled = true;
        return [
          {
            eventId: 1,
            sequence: 1,
            jobId: 'job-1',
            type: 'queued',
            createdAt: '2026-04-08T10:00:00.000Z',
            status: 'queued',
            payload: { summary: 'Queued for execution' },
            metadata: {
              tool: 'pi',
              prompt: 'Inspect async delegate',
              workDir: 'D:/maestro2',
              queuedMessages: [],
            },
          },
          {
            eventId: 2,
            sequence: 2,
            jobId: 'job-1',
            type: 'message_queued',
            createdAt: '2026-04-08T10:00:01.000Z',
            status: 'running',
            payload: { summary: 'Queued after_complete follow-up message', messageId: 'msg-2' },
            metadata: {
              tool: 'pi',
              prompt: 'Inspect async delegate',
              workDir: 'D:/maestro2',
              queuedMessages: [
                {
                  messageId: 'msg-2',
                  createdAt: '2026-04-08T10:00:01.000Z',
                  delivery: 'after_complete',
                  message: 'Continue with verification after this pass',
                  status: 'queued',
                },
              ],
            },
          },
          {
            eventId: 3,
            sequence: 3,
            jobId: 'job-1',
            type: 'snapshot',
            createdAt: '2026-04-08T10:00:02.000Z',
            status: 'running',
            payload: { summary: 'Collecting context' },
          },
          {
            eventId: 4,
            sequence: 4,
            jobId: 'job-1',
            type: 'completed',
            createdAt: '2026-04-08T10:00:03.000Z',
            status: 'completed',
            payload: { summary: 'Finished successfully' },
          },
        ];
      }),
      ack: vi.fn(() => 3),
      getJob: vi.fn(() => ({
        jobId: 'job-1',
        status: 'completed',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:03.000Z',
        lastEventId: 4,
        lastEventType: 'completed',
        latestSnapshot: { outputPreview: 'Finished successfully' },
        metadata: {
          tool: 'pi',
          prompt: 'Inspect async delegate',
          workDir: 'D:/untrusted-broker-cwd',
          repositoryContext: {
            currentRepoId: '11111111-1111-4111-8111-111111111111',
            currentRepoName: 'maestro2',
            currentProjectRoot: 'D:/maestro2',
            identityPersisted: true,
            linkedRepositories: [],
          },
          queuedMessages: [
            {
              messageId: 'msg-2',
              createdAt: '2026-04-08T10:00:01.000Z',
              delivery: 'after_complete',
              message: 'Continue with verification after this pass',
              status: 'queued',
            },
          ],
        },
      })),
      listJobEvents: vi.fn(() => []),
      requestCancel: vi.fn(),
    };

    const monitor = new DelegateBrokerMonitor({
      agentManager,
      eventBus,
      broker: broker as any,
      pollIntervalMs: 1000,
    });

    monitor.start();
    await (monitor as any).poll();
    monitor.stop();

    const spawned = eventBus
      .getRecentEvents(10, 'agent:spawned')
      .find((event) => (event.data as { id?: string }).id === 'cli-history-job-1')
      ?.data as {
        type?: string;
        interactive?: boolean;
        config?: { workDir?: string; repositoryContext?: { currentRepoId?: string } };
      } | undefined;
    expect(spawned).toBeTruthy();
    expect(spawned?.type).toBe('pi');
    expect(spawned?.interactive).toBe(true);
    expect(spawned?.config?.workDir).toBe('D:/maestro2');
    expect(spawned?.config?.repositoryContext?.currentRepoId).toBe('11111111-1111-4111-8111-111111111111');

    const entries = agentManager.getEntries('cli-history-job-1');
    expect(entries.some((entry) => entry.type === 'user_message' && 'content' in entry && entry.content === 'Inspect async delegate')).toBe(true);
    expect(entries.some((entry) => entry.type === 'user_message' && 'content' in entry && entry.content === 'Continue with verification after this pass')).toBe(true);
    expect(entries.some((entry) => entry.type === 'assistant_message')).toBe(true);
    expect(entries.some((entry) => entry.type === 'status_change')).toBe(true);
    expect(broker.ack).toHaveBeenCalled();
  });
});
