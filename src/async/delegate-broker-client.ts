import type {
  AckEventsInput,
  CheckTimeoutsInput,
  DelegateBrokerApi,
  DelegateJobEvent,
  DelegateJobRecord,
  DelegateSessionRecord,
  FileDelegateBrokerOptions,
  HeartbeatInput,
  PollEventsInput,
  PublishJobEventInput,
  PurgeExpiredEventsInput,
  PurgeExpiredEventsResult,
  QueueMessageInput,
  RequestCancelInput,
  RegisterSessionInput,
  UpdateMessageInput,
  DelegateQueuedMessage,
} from './delegate-broker.js';
import { createDefaultDelegateBroker as createBroker } from './delegate-broker.js';

export interface DelegateBrokerClientOptions extends FileDelegateBrokerOptions {
  broker?: DelegateBrokerApi;
}

export class DelegateBrokerClient implements DelegateBrokerApi {
  private readonly broker: DelegateBrokerApi;

  constructor(options: DelegateBrokerClientOptions = {}) {
    this.broker = options.broker ?? createBroker(options);
  }

  registerSession(input: RegisterSessionInput): DelegateSessionRecord {
    return this.broker.registerSession(input);
  }

  heartbeat(input: HeartbeatInput): DelegateSessionRecord {
    return this.broker.heartbeat(input);
  }

  publishEvent(input: PublishJobEventInput): DelegateJobEvent {
    return this.broker.publishEvent(input);
  }

  pollEvents(input: PollEventsInput): DelegateJobEvent[] {
    return this.broker.pollEvents(input);
  }

  ack(input: AckEventsInput): number {
    return this.broker.ack(input);
  }

  getJob(jobId: string): DelegateJobRecord | null {
    return this.broker.getJob(jobId);
  }

  listJobs(): DelegateJobRecord[] {
    return this.broker.listJobs();
  }

  listJobEvents(jobId: string): DelegateJobEvent[] {
    return this.broker.listJobEvents(jobId);
  }

  requestCancel(input: RequestCancelInput): DelegateJobRecord {
    return this.broker.requestCancel(input);
  }

  queueMessage(input: QueueMessageInput): DelegateQueuedMessage {
    return this.broker.queueMessage(input);
  }

  listMessages(jobId: string): DelegateQueuedMessage[] {
    return this.broker.listMessages(jobId);
  }

  updateMessage(input: UpdateMessageInput): DelegateQueuedMessage | null {
    return this.broker.updateMessage(input);
  }

  checkTimeouts(input?: CheckTimeoutsInput): DelegateJobRecord[] {
    return this.broker.checkTimeouts(input);
  }

  purgeExpiredEvents(input?: PurgeExpiredEventsInput): PurgeExpiredEventsResult {
    return this.broker.purgeExpiredEvents(input);
  }
}
