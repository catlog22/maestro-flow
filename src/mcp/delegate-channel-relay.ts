import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  DelegateBrokerClient,
  type DelegateBrokerApi,
  type DelegateJobEvent,
  type JsonObject,
  type JsonValue,
} from '../async/index.js';
import { truncateRaw } from '../utils/cli-format.js';

interface ChannelNotification {
  method: 'notifications/claude/channel';
  params: {
    content: string;
    meta: Record<string, string>;
  };
}

export interface ChannelNotificationServer {
  notification(message: ChannelNotification): Promise<unknown>;
}

export interface DelegateChannelRelayOptions {
  server: ChannelNotificationServer;
  broker?: DelegateBrokerApi;
  sessionId?: string;
  channelId?: string;
  pollIntervalMs?: number;
  pollLimit?: number;
  statusThrottleMs?: number;
  snapshotThrottleMs?: number;
  now?: () => string;
}

interface RelayJobState {
  lastStatusKey?: string;
  lastStatusAt?: number;
  lastSnapshotKey?: string;
  lastSnapshotAt?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_POLL_LIMIT = 25;
const DEFAULT_STATUS_THROTTLE_MS = 10_000;
const DEFAULT_SNAPSHOT_THROTTLE_MS = 15_000;
const MAX_CHANNEL_TEXT_LENGTH = 240;
const SUPPORTED_EVENT_TYPES = new Set([
  'queued',
  'snapshot',
  'status_update',
  'input_required',
  'completed',
  'failed',
  'cancelled',
  'cancel_requested',
]);

function asOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function formatProgress(snapshot: JsonObject | undefined): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const phase = readString(snapshot.phase);
  const progress = readNumber(snapshot.progress);
  const parts = [
    phase ? `phase=${phase}` : undefined,
    progress !== undefined ? `progress=${progress}%` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractSummary(event: DelegateJobEvent): string | undefined {
  const payload = event.payload;
  const directSummary = readString(payload.summary)
    ?? readString(payload.message)
    ?? readString(payload.status)
    ?? readString(payload.preview);

  if (directSummary) {
    return asOneLine(directSummary);
  }

  return formatProgress(event.snapshot);
}

function buildStatusLabel(event: DelegateJobEvent): string {
  if (event.type === 'completed') {
    return 'DONE';
  }

  if (event.type === 'failed') {
    return 'FAILED';
  }

  if (event.type === 'cancelled') {
    return 'CANCELLED';
  }

  if (event.type === 'cancel_requested') {
    return 'CANCELLING';
  }

  if (event.type === 'input_required') {
    return 'INPUT REQUIRED';
  }

  if (event.type === 'queued') {
    return 'QUEUED';
  }

  return String(event.status ?? 'RUNNING').toUpperCase();
}

function buildSignature(event: DelegateJobEvent): string {
  return JSON.stringify({
    type: event.type,
    status: event.status ?? null,
    summary: extractSummary(event) ?? null,
    snapshot: event.snapshot ?? null,
  });
}

function buildNotificationContent(event: DelegateJobEvent): string {
  const status = buildStatusLabel(event);
  const summary = extractSummary(event);
  const headlineParts = [`[DELEGATE ${status}]`, event.jobId];

  if (summary) {
    headlineParts.push(truncateRaw(summary, 120));
  }

  return truncateRaw(headlineParts.join(' '), MAX_CHANNEL_TEXT_LENGTH);
}

export class DelegateChannelRelay {
  private readonly server: ChannelNotificationServer;
  private readonly broker: DelegateBrokerApi;
  private readonly sessionId: string;
  private readonly channelId: string;
  private readonly pollIntervalMs: number;
  private readonly pollLimit: number;
  private readonly statusThrottleMs: number;
  private readonly snapshotThrottleMs: number;
  private readonly now: () => string;
  private readonly jobState = new Map<string, RelayJobState>();

  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private polling = false;
  private consecutiveFailures = 0;

  constructor(options: DelegateChannelRelayOptions) {
    this.server = options.server;
    this.broker = options.broker ?? new DelegateBrokerClient();
    this.sessionId = options.sessionId ?? `maestro-mcp-relay-${randomUUID()}`;
    this.channelId = options.channelId ?? 'claude/channel';
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollLimit = options.pollLimit ?? DEFAULT_POLL_LIMIT;
    this.statusThrottleMs = options.statusThrottleMs ?? DEFAULT_STATUS_THROTTLE_MS;
    this.snapshotThrottleMs = options.snapshotThrottleMs ?? DEFAULT_SNAPSHOT_THROTTLE_MS;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get id(): string {
    return this.sessionId;
  }

  private get sessionFilePath(): string {
    const maestroHome = process.env.MAESTRO_HOME ?? join(homedir(), '.maestro');
    return join(maestroHome, 'data', 'async', `relay-session-${process.pid}.id`);
  }

  private writeSessionFile(): void {
    try {
      mkdirSync(dirname(this.sessionFilePath), { recursive: true });
      const data: Record<string, unknown> = {
        sessionId: this.sessionId,
        pid: process.pid,
        startedAt: this.now(),
      };
      // Record SSE port so delegate CLI can match relay to current Claude Code session
      if (process.env.CLAUDE_CODE_SSE_PORT) {
        data.ssePort = process.env.CLAUDE_CODE_SSE_PORT;
      }
      // Record parent PID (= Claude Code process that spawned this MCP).
      // Lets the delegate CLI discard zombie relays whose parent has already died,
      // even when the ephemeral SSE port has been reused by a new CC session.
      if (typeof process.ppid === 'number' && process.ppid > 0) {
        data.ownerPid = process.ppid;
      }
      writeFileSync(this.sessionFilePath, JSON.stringify(data), 'utf-8');
    } catch {
      // Best-effort — file write failure shouldn't block relay
    }
  }

  private cleanupSessionFile(): void {
    try {
      unlinkSync(this.sessionFilePath);
    } catch { /* file may not exist */ }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Purge expired events/jobs/sessions before registering, so stale history
    // from previous sessions doesn't replay into the new channel.
    this.broker.purgeExpiredEvents({ now: this.now() });

    this.broker.registerSession({
      sessionId: this.sessionId,
      channelId: this.channelId,
      metadata: { source: 'maestro-mcp-relay' },
      now: this.now(),
    });

    this.writeSessionFile();

    // Drain all pre-existing events so only events published after startup
    // are emitted to the channel. Prevents historical replay on new sessions.
    this.drainExistingEvents();

    await this.pollOnce();

    this.pollTimer = setInterval(() => {
      this.pollOnce().catch(() => {
        // Best-effort relay; the next interval will retry.
      });
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  stop(): void {
    this.cleanupSessionFile();
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (!this.running || this.polling) {
      return;
    }

    this.polling = true;
    const ackIds: number[] = [];

    try {
      this.broker.heartbeat({
        sessionId: this.sessionId,
        now: this.now(),
      });

      const events = this.broker.pollEvents({
        sessionId: this.sessionId,
        limit: this.pollLimit,
        now: this.now(),
      });

      for (const event of events) {
        const shouldAck = await this.handleEvent(event);
        if (!shouldAck) {
          break;
        }
        ackIds.push(event.eventId);
      }

      if (ackIds.length > 0) {
        this.broker.ack({
          sessionId: this.sessionId,
          eventIds: ackIds,
          now: this.now(),
        });
      }

      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) {
        console.warn(`[DelegateChannelRelay] Stopping poll after ${this.consecutiveFailures} consecutive failures`);
        this.stop();
      }
      throw error;
    } finally {
      this.polling = false;
    }
  }

  private drainExistingEvents(): void {
    for (;;) {
      const events = this.broker.pollEvents({
        sessionId: this.sessionId,
        limit: this.pollLimit,
        now: this.now(),
      });

      if (events.length === 0) {
        break;
      }

      this.broker.ack({
        sessionId: this.sessionId,
        eventIds: events.map((e) => e.eventId),
        now: this.now(),
      });
    }
  }

  private async handleEvent(event: DelegateJobEvent): Promise<boolean> {
    if (!SUPPORTED_EVENT_TYPES.has(event.type)) {
      return true;
    }

    // Session isolation: only emit events from jobs originated by this relay session.
    // Jobs without sessionId in metadata are still emitted (backward compatibility).
    const originSession = event.metadata?.sessionId;
    if (typeof originSession === 'string' && originSession !== this.sessionId) {
      return true;  // Belongs to another session — ack but don't push
    }

    if (!this.shouldEmit(event)) {
      return true;
    }

    await this.server.notification({
      method: 'notifications/claude/channel',
      params: {
        content: buildNotificationContent(event),
        meta: {
          job_id: event.jobId,
          exec_id: event.jobId,
          event_id: String(event.eventId),
          event_type: event.type,
          status: String(event.status ?? ''),
        },
      },
    });

    return true;
  }

  private shouldEmit(event: DelegateJobEvent): boolean {
    if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled') {
      return true;
    }

    const currentTime = Date.now();
    const state = this.jobState.get(event.jobId) ?? {};
    const signature = buildSignature(event);

    if (event.type === 'status_update') {
      if (state.lastStatusKey === signature) {
        return false;
      }
      if (state.lastStatusAt && currentTime - state.lastStatusAt < this.statusThrottleMs) {
        return false;
      }

      state.lastStatusKey = signature;
      state.lastStatusAt = currentTime;
      this.jobState.set(event.jobId, state);
      return true;
    }

    if (event.type === 'snapshot') {
      if (state.lastSnapshotKey === signature) {
        return false;
      }
      if (state.lastSnapshotAt && currentTime - state.lastSnapshotAt < this.snapshotThrottleMs) {
        return false;
      }

      state.lastSnapshotKey = signature;
      state.lastSnapshotAt = currentTime;
      this.jobState.set(event.jobId, state);
      return true;
    }

    return true;
  }
}
