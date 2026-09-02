import type { AgentManager } from './agent-manager.js';
import { EntryNormalizer } from './entry-normalizer.js';
import type { DashboardEventBus } from '../state/event-bus.js';
import type {
  AgentProcess,
  AgentType,
  AgentProcessStatus,
  NormalizedEntry,
  AgentRepositoryContext,
} from '../../shared/agent-types.js';
import {
  DelegateBrokerClient,
  type DelegateBrokerApi,
  type DelegateJobEvent,
  type DelegateJobRecord,
  type DelegateQueuedMessage,
} from '../../../../src/async/index.js';

export interface DelegateBrokerMonitorOptions {
  agentManager: AgentManager;
  eventBus: DashboardEventBus;
  broker?: DelegateBrokerApi;
  sessionId?: string;
  pollIntervalMs?: number;
  pollLimit?: number;
}

interface MonitorJobState {
  processId: string;
  promptEmitted: boolean;
  lastAssistantSignature?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_POLL_LIMIT = 25;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function buildProcessId(jobId: string): string {
  return `cli-history-${jobId}`;
}

function normalizeAgentType(tool: string | undefined): AgentType {
  switch (tool) {
    case 'claude':
      return 'claude-code';
    case 'codex':
    case 'gemini':
    case 'qwen':
    case 'opencode':
    case 'agy':
    case 'api-explore':
    case 'pi':
      return tool;
    default:
      return 'codex';
  }
}

function mapStatus(job: DelegateJobRecord | null, event: DelegateJobEvent): AgentProcessStatus {
  if (event.type === 'queued') {
    return 'spawning';
  }
  if (event.type === 'cancel_requested') {
    return 'stopping';
  }
  if (event.type === 'failed') {
    return 'error';
  }
  if (event.type === 'completed' || event.type === 'cancelled') {
    return 'stopped';
  }
  if (job?.metadata && typeof job.metadata.cancelRequestedAt === 'string') {
    return 'stopping';
  }
  return 'running';
}

/** Known lifecycle status values that are not real content summaries */
const LIFECYCLE_STATUSES = new Set([
  'spawned', 'spawning', 'running', 'completed', 'stopped',
  'stopping', 'failed', 'cancelled', 'queued', 'success',
  'pending', 'error', 'paused',
]);

function extractSummary(event: DelegateJobEvent): string | undefined {
  const payload = event.payload as Record<string, unknown>;
  // Note: payload.status is excluded — it contains lifecycle state names
  // (e.g. "spawned", "completed") that are not real content summaries.
  const direct = readString(payload.summary)
    ?? readString(payload.message)
    ?? readString(payload.preview);
  if (direct) {
    return direct.replace(/\s+/g, ' ').trim();
  }

  if (event.snapshot && typeof event.snapshot.outputPreview === 'string') {
    return event.snapshot.outputPreview.replace(/\s+/g, ' ').trim();
  }

  return undefined;
}

function readQueuedMessages(metadata: unknown): DelegateQueuedMessage[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }
  const queuedMessages = (metadata as { queuedMessages?: unknown }).queuedMessages;
  if (!Array.isArray(queuedMessages)) {
    return [];
  }
  return queuedMessages.filter(
    (item): item is DelegateQueuedMessage =>
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as { messageId?: unknown }).messageId === 'string'
      && typeof (item as { message?: unknown }).message === 'string',
  );
}

function extractQueuedMessage(
  job: DelegateJobRecord | null,
  event: DelegateJobEvent,
): DelegateQueuedMessage | undefined {
  const payload = event.payload as Record<string, unknown>;
  const messageId = readString(payload.messageId);
  if (!messageId) {
    return undefined;
  }
  return readQueuedMessages(job?.metadata ?? event.metadata).find(
    (item) => item.messageId === messageId,
  );
}

function buildFollowUpReason(prefix: string, queuedMessage: DelegateQueuedMessage | undefined): string {
  if (!queuedMessage) {
    return prefix;
  }
  return `${prefix} (${queuedMessage.delivery})`;
}

function readRepositoryContext(value: unknown): AgentRepositoryContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const context = value as Partial<AgentRepositoryContext>;
  if (typeof context.currentRepoName !== 'string'
    || typeof context.currentProjectRoot !== 'string'
    || !Array.isArray(context.linkedRepositories)) return undefined;
  if (context.currentRepoId !== null && typeof context.currentRepoId !== 'string') return undefined;
  return context as AgentRepositoryContext;
}

function buildProcess(jobId: string, job: DelegateJobRecord | null, event: DelegateJobEvent): AgentProcess {
  const metadata = job?.metadata ?? event.metadata ?? {};
  const tool = readString(metadata.tool);
  const prompt = readString(metadata.prompt) ?? `Delegated job ${jobId}`;
  const repositoryContext = readRepositoryContext(metadata.repositoryContext);
  // Compatibility display may use recorded workDir, but never unrelated monitor cwd.
  const workDir = repositoryContext?.currentProjectRoot ?? readString(metadata.workDir) ?? '';
  const model = readString(metadata.model);
  const processId = buildProcessId(jobId);
  const processStatus = mapStatus(job, event);

  return {
    id: processId,
    type: normalizeAgentType(tool),
    status: processStatus,
    config: {
      type: normalizeAgentType(tool),
      prompt,
      workDir,
      ...(model ? { model } : {}),
      ...(repositoryContext ? {
        repositoryContext,
        metadata: { repositoryContext },
      } : {}),
    },
    startedAt: job?.createdAt ?? event.createdAt,
    interactive: true,
    ...(typeof metadata.workerPid === 'number' ? { pid: metadata.workerPid } : {}),
  };
}

export class DelegateBrokerMonitor {
  private readonly agentManager: AgentManager;
  private readonly eventBus: DashboardEventBus;
  private readonly broker: DelegateBrokerApi;
  private readonly sessionId: string;
  private readonly pollIntervalMs: number;
  private readonly pollLimit: number;
  private readonly jobState = new Map<string, MonitorJobState>();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private running = false;

  constructor(options: DelegateBrokerMonitorOptions) {
    this.agentManager = options.agentManager;
    this.eventBus = options.eventBus;
    this.broker = options.broker ?? new DelegateBrokerClient();
    this.sessionId = options.sessionId ?? 'dashboard-delegate-monitor';
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollLimit = options.pollLimit ?? DEFAULT_POLL_LIMIT;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.broker.registerSession({
      sessionId: this.sessionId,
      metadata: { source: 'dashboard', consumer: 'delegate-broker-monitor' },
    });
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling) {
      return;
    }
    this.polling = true;
    try {
      const events = this.broker.pollEvents({
        sessionId: this.sessionId,
        limit: this.pollLimit,
      });
      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        this.handleEvent(event);
      }
      this.broker.ack({
        sessionId: this.sessionId,
        eventIds: events.map((event) => event.eventId),
      });
    } finally {
      this.polling = false;
    }
  }

  private handleEvent(event: DelegateJobEvent): void {
    const job = this.broker.getJob(event.jobId);
    const process = buildProcess(event.jobId, job, event);
    const state = this.ensureProcess(job, event, process);
    const queuedMessage = extractQueuedMessage(job, event);

    if (event.type === 'cancel_requested') {
      const entry = EntryNormalizer.statusChange(process.id, 'stopping', 'Cancellation requested');
      this.pushEntry(process.id, entry);
      this.agentManager.updateCliProcessStatus(process.id, 'stopping');
      this.eventBus.emit('agent:status', { processId: process.id, status: 'stopping', reason: 'Cancellation requested' });
      return;
    }

    if (event.type === 'message_queued') {
      if (queuedMessage) {
        this.pushEntry(process.id, EntryNormalizer.userMessage(process.id, queuedMessage.message));
      }
      const reason = buildFollowUpReason('Follow-up queued', queuedMessage);
      this.agentManager.updateCliProcessStatus(process.id, process.status);
      this.eventBus.emit('agent:status', { processId: process.id, status: process.status, reason });
      return;
    }

    if (event.type === 'message_dispatched') {
      const reason = buildFollowUpReason('Follow-up dispatched', queuedMessage);
      this.pushEntry(process.id, EntryNormalizer.statusChange(process.id, process.status, reason));
      this.agentManager.updateCliProcessStatus(process.id, process.status);
      this.eventBus.emit('agent:status', { processId: process.id, status: process.status, reason });
      return;
    }

    if (event.type === 'message_dropped') {
      const payload = event.payload as Record<string, unknown>;
      const dropReason = readString(payload.reason);
      const reason = dropReason
        ? `Follow-up dropped: ${dropReason}`
        : 'Follow-up dropped';
      this.pushEntry(process.id, EntryNormalizer.error(process.id, reason));
      this.agentManager.updateCliProcessStatus(process.id, process.status);
      this.eventBus.emit('agent:status', { processId: process.id, status: process.status, reason });
      return;
    }

    if (event.type === 'message_injected') {
      const reason = buildFollowUpReason('Follow-up injected', queuedMessage);
      this.pushEntry(process.id, EntryNormalizer.statusChange(process.id, process.status, reason));
      this.agentManager.updateCliProcessStatus(process.id, process.status);
      this.eventBus.emit('agent:status', { processId: process.id, status: process.status, reason });
      return;
    }

    const summary = extractSummary(event);
    if (summary) {
      const signature = `${event.type}:${summary}`;
      if (signature !== state.lastAssistantSignature) {
        state.lastAssistantSignature = signature;
        this.pushEntry(process.id, EntryNormalizer.assistantMessage(process.id, summary, event.type !== 'completed'));
      }
    }

    if (event.type === 'completed') {
      const reason = 'Delegate completed';
      this.pushEntry(process.id, EntryNormalizer.statusChange(process.id, 'stopped', reason));
      this.agentManager.updateCliProcessStatus(process.id, 'stopped');
      this.eventBus.emit('agent:status', { processId: process.id, status: 'stopped', reason });
      this.eventBus.emit('agent:stopped', { processId: process.id, reason });
      return;
    }

    if (event.type === 'failed') {
      const reason = summary ?? 'Delegate failed';
      this.pushEntry(process.id, EntryNormalizer.error(process.id, reason));
      this.pushEntry(process.id, EntryNormalizer.statusChange(process.id, 'error', reason));
      this.agentManager.updateCliProcessStatus(process.id, 'error');
      this.eventBus.emit('agent:status', { processId: process.id, status: 'error', reason });
      this.eventBus.emit('agent:stopped', { processId: process.id, reason });
      return;
    }

    if (event.type === 'cancelled') {
      const reason = 'Delegate cancelled';
      this.pushEntry(process.id, EntryNormalizer.statusChange(process.id, 'stopped', reason));
      this.agentManager.updateCliProcessStatus(process.id, 'stopped');
      this.eventBus.emit('agent:status', { processId: process.id, status: 'stopped', reason });
      this.eventBus.emit('agent:stopped', { processId: process.id, reason });
      return;
    }

    this.agentManager.updateCliProcessStatus(process.id, process.status);
    this.eventBus.emit('agent:status', { processId: process.id, status: process.status });
  }

  private ensureProcess(
    job: DelegateJobRecord | null,
    event: DelegateJobEvent,
    process: AgentProcess,
  ): MonitorJobState {
    const existing = this.jobState.get(event.jobId);
    if (existing) {
      this.agentManager.registerCliProcess(process);
      return existing;
    }

    const state: MonitorJobState = {
      processId: process.id,
      promptEmitted: false,
    };
    this.jobState.set(event.jobId, state);
    this.agentManager.registerCliProcess(process);
    this.eventBus.emit('agent:spawned', process);

    const prompt = readString((job?.metadata ?? event.metadata ?? {}).prompt);
    if (prompt) {
      state.promptEmitted = true;
      this.pushEntry(process.id, EntryNormalizer.userMessage(process.id, prompt));
    }

    return state;
  }

  private pushEntry(processId: string, entry: NormalizedEntry): void {
    this.agentManager.addCliEntry(processId, entry);
    this.eventBus.emit('agent:entry', entry);
  }
}
