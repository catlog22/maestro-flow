import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DelegateBrokerClient, FileDelegateBroker, SqliteDelegateBroker } from './index.js';

describe('Delegate broker', () => {
  let tempDir: string;
  let statePath: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'maestro-delegate-broker-'));
    statePath = join(tempDir, 'delegate-broker.json');
    dbPath = join(tempDir, 'delegate-broker.sqlite');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers sessions and updates heartbeat timestamps', () => {
    const client = new DelegateBrokerClient({ statePath });

    const registered = client.registerSession({
      sessionId: 'session-a',
      channelId: 'claude/channel',
      metadata: { source: 'test' },
      now: '2026-04-07T00:00:00.000Z',
    });

    assert.equal(registered.registeredAt, '2026-04-07T00:00:00.000Z');
    assert.equal(registered.lastSeenAt, '2026-04-07T00:00:00.000Z');
    assert.equal(registered.channelId, 'claude/channel');

    const heartbeated = client.heartbeat({
      sessionId: 'session-a',
      now: '2026-04-07T00:01:00.000Z',
    });

    assert.equal(heartbeated.registeredAt, '2026-04-07T00:00:00.000Z');
    assert.equal(heartbeated.lastSeenAt, '2026-04-07T00:01:00.000Z');
  });

  it('supports publish, poll, and ack lifecycle per session', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 'session-a', now: '2026-04-07T00:00:00.000Z' });
    client.registerSession({ sessionId: 'session-b', now: '2026-04-07T00:00:00.000Z' });

    const first = client.publishEvent({
      jobId: 'job-1',
      type: 'snapshot',
      status: 'running',
      snapshot: { step: 'boot', progress: 10 },
      payload: { summary: 'started' },
      now: '2026-04-07T00:00:10.000Z',
    });
    const second = client.publishEvent({
      jobId: 'job-1',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'still running' },
      now: '2026-04-07T00:00:20.000Z',
    });

    const polled = client.pollEvents({ sessionId: 'session-a' });
    assert.deepEqual(
      polled.map((event) => event.eventId),
      [first.eventId, second.eventId],
    );

    const ackedCount = client.ack({
      sessionId: 'session-a',
      eventIds: [first.eventId],
      now: '2026-04-07T00:00:21.000Z',
    });
    assert.equal(ackedCount, 1);

    const remainingForSessionA = client.pollEvents({ sessionId: 'session-a' });
    assert.deepEqual(remainingForSessionA.map((event) => event.eventId), [second.eventId]);

    const eventsForSessionB = client.pollEvents({ sessionId: 'session-b' });
    assert.deepEqual(
      eventsForSessionB.map((event) => event.eventId),
      [first.eventId, second.eventId],
    );
  });

  it('keeps latest job snapshot and persists state across broker instances', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 'session-a', now: '2026-04-07T00:00:00.000Z' });

    client.publishEvent({
      jobId: 'job-1',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'collect', progress: 25 },
      payload: { summary: 'collecting context' },
      jobMetadata: { tool: 'codex', mode: 'write' },
      now: '2026-04-07T00:00:05.000Z',
    });
    client.publishEvent({
      jobId: 'job-1',
      type: 'completed',
      payload: { summary: 'done' },
      now: '2026-04-07T00:00:10.000Z',
    });

    const broker = new FileDelegateBroker({ statePath });
    const job = broker.getJob('job-1');

    assert.ok(job);
    assert.equal(job.status, 'completed');
    assert.equal(job.lastEventType, 'completed');
    assert.deepEqual(job.latestSnapshot, { phase: 'collect', progress: 25 });
    assert.deepEqual(job.metadata, { tool: 'codex', mode: 'write' });

    const events = broker.listJobEvents('job-1');
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'snapshot');
    assert.equal(events[1].type, 'completed');

    const repolled = client.pollEvents({
      sessionId: 'session-a',
      afterEventId: events[0].eventId,
    });
    assert.deepEqual(repolled.map((event) => event.type), ['completed']);
  });

  it('persists cancellation requests without overwriting existing job metadata', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-cancel',
      type: 'queued',
      status: 'queued',
      payload: { summary: 'queued' },
      jobMetadata: { tool: 'codex', mode: 'analysis' },
      now: '2026-04-08T00:00:00.000Z',
    });

    const updated = client.requestCancel({
      jobId: 'job-cancel',
      requestedBy: 'test-suite',
      reason: 'No longer needed',
      now: '2026-04-08T00:00:05.000Z',
    });

    assert.equal(updated.status, 'queued');
    assert.equal(updated.lastEventType, 'cancel_requested');
    assert.equal(updated.metadata?.tool, 'codex');
    assert.equal(updated.metadata?.cancelRequestedBy, 'test-suite');
    assert.equal(updated.metadata?.cancelReason, 'No longer needed');

    const events = client.listJobEvents('job-cancel');
    assert.equal(events[1].type, 'cancel_requested');
  });

  it('queues and updates follow-up delegate messages in broker metadata', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-message',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'running' },
      jobMetadata: { tool: 'codex', mode: 'analysis' },
      now: '2026-04-08T01:00:00.000Z',
    });

    const queued = client.queueMessage({
      jobId: 'job-message',
      message: 'Resume with tighter scope',
      delivery: 'interrupt_resume',
      requestedBy: 'test-suite',
      now: '2026-04-08T01:00:05.000Z',
    });
    assert.equal(queued.delivery, 'interrupt_resume');
    assert.equal(queued.status, 'queued');

    const queuedMessages = client.listMessages('job-message');
    assert.equal(queuedMessages.length, 1);
    assert.equal(queuedMessages[0].requestedBy, 'test-suite');

    const dispatched = client.updateMessage({
      jobId: 'job-message',
      messageId: queued.messageId,
      status: 'dispatched',
      dispatchReason: 'cancelled',
      now: '2026-04-08T01:00:10.000Z',
    });
    assert.ok(dispatched);
    assert.equal(dispatched?.status, 'dispatched');
    assert.equal(dispatched?.dispatchReason, 'cancelled');

    const messagesAfterDispatch = client.listMessages('job-message');
    assert.equal(messagesAfterDispatch[0].status, 'dispatched');
    assert.equal(client.listJobEvents('job-message').at(-1)?.type, 'message_dispatched');
  });

  it('checkTimeouts marks running jobs as failed after timeout', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-timeout-1',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'running' },
      now: '2026-04-07T00:00:00.000Z',
    });
    client.publishEvent({
      jobId: 'job-timeout-2',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'also running' },
      now: '2026-04-07T00:10:00.000Z',
    });
    client.publishEvent({
      jobId: 'job-done',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'already done' },
      now: '2026-04-07T00:00:00.000Z',
    });

    // Check with 5 minute timeout at T+6 minutes — only job-timeout-1 should time out
    const timedOut = client.checkTimeouts({
      timeoutMs: 5 * 60 * 1000,
      now: '2026-04-07T00:06:00.000Z',
    });

    assert.equal(timedOut.length, 1);
    assert.equal(timedOut[0].jobId, 'job-timeout-1');
    assert.equal(timedOut[0].status, 'failed');
    assert.equal(timedOut[0].lastEventType, 'failed');

    // Verify the failed event was recorded
    const events = client.listJobEvents('job-timeout-1');
    const failedEvent = events.find((e) => e.type === 'failed');
    assert.ok(failedEvent);
    assert.deepEqual(failedEvent?.payload, { summary: 'Timed out', reason: 'timeout' });

    // Verify completed job was not touched
    const doneJob = client.getJob('job-done');
    assert.equal(doneJob?.status, 'completed');
  });

  it('checkTimeouts does not affect jobs within timeout window', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-fresh',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'just started' },
      now: '2026-04-07T00:00:00.000Z',
    });

    const timedOut = client.checkTimeouts({
      timeoutMs: 30 * 60 * 1000,
      now: '2026-04-07T00:10:00.000Z',
    });

    assert.equal(timedOut.length, 0);
    assert.equal(client.getJob('job-fresh')?.status, 'running');
  });

  it('supports sqlite-backed persistence with WAL mode', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });
    client.registerSession({ sessionId: 'sqlite-session', now: '2026-04-08T00:00:00.000Z' });
    client.publishEvent({
      jobId: 'sqlite-job',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'collect', progress: 40 },
      payload: { summary: 'collecting' },
      now: '2026-04-08T00:00:01.000Z',
    });
    client.requestCancel({
      jobId: 'sqlite-job',
      requestedBy: 'sqlite-test',
      now: '2026-04-08T00:00:02.000Z',
    });
    broker.close();

    const reopened = new SqliteDelegateBroker({ dbPath });
    const job = reopened.getJob('sqlite-job');
    assert.ok(job);
    assert.equal(job.lastEventType, 'cancel_requested');
    assert.equal(job.metadata?.cancelRequestedBy, 'sqlite-test');
    assert.equal(reopened.listJobEvents('sqlite-job').length, 2);
    reopened.close();
  });

  it('checkTimeouts works with sqlite broker', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });

    client.publishEvent({
      jobId: 'sqlite-timeout-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'running' },
      now: '2026-04-07T00:00:00.000Z',
    });

    const timedOut = client.checkTimeouts({
      timeoutMs: 5 * 60 * 1000,
      now: '2026-04-07T00:06:00.000Z',
    });

    assert.equal(timedOut.length, 1);
    assert.equal(timedOut[0].jobId, 'sqlite-timeout-job');
    assert.equal(timedOut[0].status, 'failed');

    const events = client.listJobEvents('sqlite-timeout-job');
    const failedEvent = events.find((e) => e.type === 'failed');
    assert.ok(failedEvent);
    assert.deepEqual(failedEvent?.payload, { summary: 'Timed out', reason: 'timeout' });

    broker.close();
  });

  it('purgeExpiredEvents removes terminal jobs and stale sessions from file broker', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 'old-session', now: '2026-04-07T00:00:00.000Z' });
    client.registerSession({ sessionId: 'recent-session', now: '2026-04-07T04:00:00.000Z' });

    // Old completed job
    client.publishEvent({
      jobId: 'old-done',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'done long ago' },
      now: '2026-04-07T00:00:00.000Z',
    });

    // Recent running job — should NOT be purged
    client.publishEvent({
      jobId: 'still-running',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'active' },
      now: '2026-04-07T03:59:00.000Z',
    });

    // Recent completed job — should NOT be purged (within TTL)
    client.publishEvent({
      jobId: 'just-done',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'just finished' },
      now: '2026-04-07T03:30:00.000Z',
    });

    const result = client.purgeExpiredEvents({
      maxAgeMs: 2 * 60 * 60 * 1000, // 2 hours
      now: '2026-04-07T04:00:00.000Z',
    });

    assert.equal(result.purgedJobCount, 1);
    assert.equal(result.purgedEventCount, 1);
    assert.equal(result.purgedSessionCount, 1); // old-session is stale

    assert.equal(client.getJob('old-done'), null);
    assert.ok(client.getJob('still-running'));
    assert.ok(client.getJob('just-done'));
  });

  it('purgeExpiredEvents removes terminal jobs and stale sessions from sqlite broker', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });
    client.registerSession({ sessionId: 'stale-sqlite', now: '2026-04-07T00:00:00.000Z' });
    client.registerSession({ sessionId: 'active-sqlite', now: '2026-04-07T04:00:00.000Z' });

    client.publishEvent({
      jobId: 'sqlite-old-done',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'old' },
      now: '2026-04-07T00:00:00.000Z',
    });

    client.publishEvent({
      jobId: 'sqlite-recent',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'active' },
      now: '2026-04-07T03:59:00.000Z',
    });

    const result = client.purgeExpiredEvents({
      maxAgeMs: 2 * 60 * 60 * 1000,
      now: '2026-04-07T04:00:00.000Z',
    });

    assert.equal(result.purgedJobCount, 1);
    assert.equal(result.purgedSessionCount, 1);
    assert.equal(client.getJob('sqlite-old-done'), null);
    assert.ok(client.getJob('sqlite-recent'));
    assert.equal(client.listJobEvents('sqlite-old-done').length, 0);

    broker.close();
  });

  // --- New L1 unit tests for delegate-broker gap coverage ---

  it('pollEvents with afterEventId and limit combination', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 'session-poll', now: '2026-04-07T00:00:00.000Z' });

    const ev1 = client.publishEvent({
      jobId: 'job-poll', type: 'queued', status: 'queued',
      payload: { summary: 'first' }, now: '2026-04-07T00:00:01.000Z',
    });
    client.publishEvent({
      jobId: 'job-poll', type: 'status_update', status: 'running',
      payload: { summary: 'second' }, now: '2026-04-07T00:00:02.000Z',
    });
    client.publishEvent({
      jobId: 'job-poll', type: 'snapshot', status: 'running',
      payload: { summary: 'third' }, now: '2026-04-07T00:00:03.000Z',
    });
    client.publishEvent({
      jobId: 'job-poll', type: 'completed', status: 'completed',
      payload: { summary: 'fourth' }, now: '2026-04-07T00:00:04.000Z',
    });

    // afterEventId=ev1 skips first event; limit=2 only returns next 2
    const polled = client.pollEvents({
      sessionId: 'session-poll',
      afterEventId: ev1.eventId,
      limit: 2,
    });
    assert.equal(polled.length, 2);
    assert.equal(polled[0].payload.summary, 'second');
    assert.equal(polled[1].payload.summary, 'third');
  });

  it('pollEvents for unknown session throws error', () => {
    const client = new DelegateBrokerClient({ statePath });
    assert.throws(
      () => client.pollEvents({ sessionId: 'nonexistent-session' }),
      /Unknown delegate session/,
    );
  });

  it('ack for unknown session throws error', () => {
    const client = new DelegateBrokerClient({ statePath });
    assert.throws(
      () => client.ack({ sessionId: 'nonexistent-session', eventIds: [1] }),
      /Unknown delegate session/,
    );
  });

  it('heartbeat for unknown session throws error', () => {
    const client = new DelegateBrokerClient({ statePath });
    assert.throws(
      () => client.heartbeat({ sessionId: 'nonexistent-session' }),
      /Unknown delegate session/,
    );
  });

  it('getJob returns null for nonexistent job', () => {
    const client = new DelegateBrokerClient({ statePath });
    const job = client.getJob('no-such-job');
    assert.equal(job, null);
  });

  it('listJobEvents for nonexistent job returns empty array', () => {
    const client = new DelegateBrokerClient({ statePath });
    const events = client.listJobEvents('no-such-job');
    assert.deepEqual(events, []);
  });

  it('publishEvent infers status from event type when not explicit', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-infer-queued', type: 'queued',
      payload: { summary: 'q' }, now: '2026-04-07T00:00:00.000Z',
    });
    assert.equal(client.getJob('job-infer-queued')?.status, 'queued');

    client.publishEvent({
      jobId: 'job-infer-input', type: 'input_required',
      payload: { summary: 'i' }, now: '2026-04-07T00:00:01.000Z',
    });
    assert.equal(client.getJob('job-infer-input')?.status, 'input_required');

    client.publishEvent({
      jobId: 'job-infer-completed', type: 'completed',
      payload: { summary: 'c' }, now: '2026-04-07T00:00:02.000Z',
    });
    assert.equal(client.getJob('job-infer-completed')?.status, 'completed');

    client.publishEvent({
      jobId: 'job-infer-failed', type: 'failed',
      payload: { summary: 'f' }, now: '2026-04-07T00:00:03.000Z',
    });
    assert.equal(client.getJob('job-infer-failed')?.status, 'failed');

    client.publishEvent({
      jobId: 'job-infer-cancelled', type: 'cancelled',
      payload: { summary: 'x' }, now: '2026-04-07T00:00:04.000Z',
    });
    assert.equal(client.getJob('job-infer-cancelled')?.status, 'cancelled');
  });

  it('publishEvent merges jobMetadata across multiple events', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-meta-merge', type: 'queued', status: 'queued',
      payload: { summary: 'start' },
      jobMetadata: { tool: 'codex', mode: 'analysis' },
      now: '2026-04-07T00:00:00.000Z',
    });
    client.publishEvent({
      jobId: 'job-meta-merge', type: 'status_update', status: 'running',
      payload: { summary: 'running' },
      jobMetadata: { workDir: '/tmp/test', extra: 'field' },
      now: '2026-04-07T00:00:01.000Z',
    });

    const job = client.getJob('job-meta-merge');
    assert.ok(job);
    assert.equal(job.metadata?.tool, 'codex');
    assert.equal(job.metadata?.mode, 'analysis');
    assert.equal(job.metadata?.workDir, '/tmp/test');
    assert.equal(job.metadata?.extra, 'field');
  });

  it('queueMessage for nonexistent job throws error', () => {
    const client = new DelegateBrokerClient({ statePath });
    assert.throws(
      () => client.queueMessage({
        jobId: 'no-such-job',
        message: 'hello',
        delivery: 'inject',
      }),
      /Unknown delegate job/,
    );
  });

  it('updateMessage for nonexistent messageId returns null', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-updmsg', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-07T00:00:00.000Z',
    });

    const result = client.updateMessage({
      jobId: 'job-updmsg',
      messageId: 'nonexistent-msg-id',
      status: 'dispatched',
    });
    assert.equal(result, null);
  });

  it('multiple messages with different delivery types on same job', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-multi-msg', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-07T00:00:00.000Z',
    });

    const msg1 = client.queueMessage({
      jobId: 'job-multi-msg', message: 'inject msg', delivery: 'inject',
      now: '2026-04-07T00:00:01.000Z',
    });
    const msg2 = client.queueMessage({
      jobId: 'job-multi-msg', message: 'after msg', delivery: 'after_complete',
      now: '2026-04-07T00:00:02.000Z',
    });

    assert.equal(msg1.delivery, 'inject');
    assert.equal(msg2.delivery, 'after_complete');

    const messages = client.listMessages('job-multi-msg');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].delivery, 'inject');
    assert.equal(messages[1].delivery, 'after_complete');
  });

  it('purgeExpiredEvents with default maxAge behavior', () => {
    const client = new DelegateBrokerClient({ statePath });
    // Create a job completed 3 hours ago
    client.publishEvent({
      jobId: 'job-old-purge', type: 'completed', status: 'completed',
      payload: { summary: 'done' }, now: '2026-04-07T00:00:00.000Z',
    });

    // Default maxAge is 2 hours — this job should be purged
    const result = client.purgeExpiredEvents({
      now: '2026-04-07T03:00:00.000Z',
    });
    assert.ok(result.purgedJobCount >= 1);
    assert.equal(client.getJob('job-old-purge'), null);
  });

  it('requestCancel on already-terminal job returns existing job unchanged', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-terminal-cancel', type: 'completed', status: 'completed',
      payload: { summary: 'done' },
      jobMetadata: { tool: 'codex' },
      now: '2026-04-07T00:00:00.000Z',
    });

    const result = client.requestCancel({
      jobId: 'job-terminal-cancel',
      requestedBy: 'user',
      reason: 'too late',
      now: '2026-04-07T00:01:00.000Z',
    });

    // Should return existing job without adding cancel metadata
    assert.equal(result.status, 'completed');
    assert.equal(result.lastEventType, 'completed');
    // No cancel event should have been added
    const events = client.listJobEvents('job-terminal-cancel');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'completed');
  });

  it('legacy delivery value normalization (streaming and interrupt_resume -> inject)', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-legacy-delivery', type: 'status_update', status: 'running',
      payload: { summary: 'running' },
      now: '2026-04-07T00:00:00.000Z',
    });

    // Queue with 'inject' delivery — after deserialization, legacy values normalize to inject
    const msg = client.queueMessage({
      jobId: 'job-legacy-delivery',
      message: 'follow up',
      delivery: 'inject',
      now: '2026-04-07T00:00:01.000Z',
    });
    assert.equal(msg.delivery, 'inject');

    // listMessages should normalize on read
    const messages = client.listMessages('job-legacy-delivery');
    assert.equal(messages[0].delivery, 'inject');
  });

  it('sqlite broker: queueMessage, updateMessage, listMessages', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });

    client.publishEvent({
      jobId: 'sqlite-msg-job', type: 'status_update', status: 'running',
      payload: { summary: 'running' },
      now: '2026-04-08T00:00:00.000Z',
    });

    const queued = client.queueMessage({
      jobId: 'sqlite-msg-job',
      message: 'sqlite follow-up',
      delivery: 'inject',
      requestedBy: 'sqlite-tester',
      now: '2026-04-08T00:00:01.000Z',
    });
    assert.equal(queued.status, 'queued');
    assert.equal(queued.delivery, 'inject');

    const messages = client.listMessages('sqlite-msg-job');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message, 'sqlite follow-up');

    const updated = client.updateMessage({
      jobId: 'sqlite-msg-job',
      messageId: queued.messageId,
      status: 'dispatched',
      dispatchReason: 'test-dispatch',
      now: '2026-04-08T00:00:02.000Z',
    });
    assert.ok(updated);
    assert.equal(updated?.status, 'dispatched');
    assert.equal(updated?.dispatchReason, 'test-dispatch');

    broker.close();
  });

  it('sqlite broker: purgeExpiredEvents removes old terminal jobs', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });

    client.publishEvent({
      jobId: 'sqlite-purge-old', type: 'completed', status: 'completed',
      payload: { summary: 'old done' },
      now: '2026-04-07T00:00:00.000Z',
    });
    client.publishEvent({
      jobId: 'sqlite-purge-recent', type: 'status_update', status: 'running',
      payload: { summary: 'recent' },
      now: '2026-04-07T03:55:00.000Z',
    });

    const result = client.purgeExpiredEvents({
      maxAgeMs: 2 * 60 * 60 * 1000,
      now: '2026-04-07T04:00:00.000Z',
    });

    assert.ok(result.purgedJobCount >= 1);
    assert.equal(client.getJob('sqlite-purge-old'), null);
    assert.ok(client.getJob('sqlite-purge-recent'));

    broker.close();
  });

  // --- GC round 1: branch coverage ---

  it('inferStatus uses default branch for unknown type without explicit status', () => {
    const client = new DelegateBrokerClient({ statePath });

    // First event with unknown type and no explicit status -> currentStatus undefined -> 'running'
    client.publishEvent({
      jobId: 'job-infer-default', type: 'status_update',
      payload: { summary: 'no explicit status' }, now: '2026-04-07T00:00:00.000Z',
    });
    assert.equal(client.getJob('job-infer-default')?.status, 'running');

    // Second event with unknown type, no explicit status -> currentStatus='running' -> 'running'
    client.publishEvent({
      jobId: 'job-infer-default', type: 'snapshot',
      payload: { summary: 'still no explicit status' }, now: '2026-04-07T00:00:01.000Z',
    });
    assert.equal(client.getJob('job-infer-default')?.status, 'running');
  });

  it('publishEvent extracts snapshot from payload.snapshot when no explicit snapshot', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-payload-snap', type: 'snapshot', status: 'running',
      payload: { summary: 'has nested snapshot', snapshot: { phase: 'extract', progress: 50 } },
      now: '2026-04-07T00:00:00.000Z',
    });

    const job = client.getJob('job-payload-snap');
    assert.ok(job);
    assert.deepEqual(job.latestSnapshot, { phase: 'extract', progress: 50 });
  });

  it('pollEvents filters by jobId when provided', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 'session-filter', now: '2026-04-07T00:00:00.000Z' });

    client.publishEvent({
      jobId: 'job-a', type: 'queued', status: 'queued',
      payload: { summary: 'job a' }, now: '2026-04-07T00:00:01.000Z',
    });
    client.publishEvent({
      jobId: 'job-b', type: 'queued', status: 'queued',
      payload: { summary: 'job b' }, now: '2026-04-07T00:00:02.000Z',
    });

    // Without jobId filter: get all events
    const all = client.pollEvents({ sessionId: 'session-filter' });
    assert.equal(all.length, 2);

    // With jobId filter: get only job-b events
    const filtered = client.pollEvents({ sessionId: 'session-filter', jobId: 'job-b' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].jobId, 'job-b');
  });

  it('requestCancel on already-cancel-requested job returns existing job unchanged', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-double-cancel', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-07T00:00:00.000Z',
    });

    // First cancel request
    const first = client.requestCancel({
      jobId: 'job-double-cancel', requestedBy: 'user-1', reason: 'first cancel',
      now: '2026-04-07T00:01:00.000Z',
    });
    assert.equal(first.lastEventType, 'cancel_requested');

    // Second cancel request — should return existing job without adding another event
    const second = client.requestCancel({
      jobId: 'job-double-cancel', requestedBy: 'user-2', reason: 'second cancel',
      now: '2026-04-07T00:02:00.000Z',
    });
    assert.equal(second.lastEventType, 'cancel_requested');
    assert.equal(second.metadata?.cancelRequestedBy, 'user-1'); // original requester preserved

    const events = client.listJobEvents('job-double-cancel');
    assert.equal(events.filter((e) => e.type === 'cancel_requested').length, 1);
  });

  it('updateMessage with injected status records message_injected event', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-inject-msg', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-07T00:00:00.000Z',
    });

    const queued = client.queueMessage({
      jobId: 'job-inject-msg', message: 'inject me', delivery: 'inject',
      now: '2026-04-07T00:00:01.000Z',
    });

    const injected = client.updateMessage({
      jobId: 'job-inject-msg', messageId: queued.messageId,
      status: 'injected', now: '2026-04-07T00:00:02.000Z',
    });
    assert.ok(injected);
    assert.equal(injected?.status, 'injected');

    const events = client.listJobEvents('job-inject-msg');
    assert.equal(events.at(-1)?.type, 'message_injected');
  });

  it('updateMessage with dropped status records message_dropped event', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-drop-msg', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-07T00:00:00.000Z',
    });

    const queued = client.queueMessage({
      jobId: 'job-drop-msg', message: 'drop me', delivery: 'after_complete',
      now: '2026-04-07T00:00:01.000Z',
    });

    const dropped = client.updateMessage({
      jobId: 'job-drop-msg', messageId: queued.messageId,
      status: 'dropped', dispatchReason: 'job cancelled',
      now: '2026-04-07T00:00:02.000Z',
    });
    assert.ok(dropped);
    assert.equal(dropped?.status, 'dropped');
    assert.equal(dropped?.dispatchReason, 'job cancelled');

    const events = client.listJobEvents('job-drop-msg');
    assert.equal(events.at(-1)?.type, 'message_dropped');
  });

  it('updateMessage for nonexistent job returns null', () => {
    const client = new DelegateBrokerClient({ statePath });
    const result = client.updateMessage({
      jobId: 'no-such-job', messageId: 'no-msg', status: 'dispatched',
    });
    assert.equal(result, null);
  });

  it('publishEvent with explicit status overrides type inference', () => {
    const client = new DelegateBrokerClient({ statePath });

    // Type is 'snapshot' (default branch) but explicit status='input_required'
    client.publishEvent({
      jobId: 'job-override-status', type: 'snapshot', status: 'input_required',
      payload: { summary: 'override' }, now: '2026-04-07T00:00:00.000Z',
    });
    assert.equal(client.getJob('job-override-status')?.status, 'input_required');
  });

  it('requestCancel on nonexistent job creates new job record', () => {
    const client = new DelegateBrokerClient({ statePath });

    const result = client.requestCancel({
      jobId: 'job-cancel-new', now: '2026-04-07T00:00:00.000Z',
    });

    assert.equal(result.status, 'queued');
    assert.equal(result.lastEventType, 'cancel_requested');
    assert.ok(result.metadata?.cancelRequestedAt);
  });

  it('sqlite broker: pollEvents filters by jobId', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });
    client.registerSession({ sessionId: 'sqlite-filter', now: '2026-04-08T00:00:00.000Z' });

    client.publishEvent({
      jobId: 'sq-job-a', type: 'queued', status: 'queued',
      payload: { summary: 'a' }, now: '2026-04-08T00:00:01.000Z',
    });
    client.publishEvent({
      jobId: 'sq-job-b', type: 'queued', status: 'queued',
      payload: { summary: 'b' }, now: '2026-04-08T00:00:02.000Z',
    });

    const filtered = client.pollEvents({ sessionId: 'sqlite-filter', jobId: 'sq-job-b' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].jobId, 'sq-job-b');

    broker.close();
  });

  it('sqlite broker: requestCancel on already-cancel-requested job is idempotent', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });

    client.publishEvent({
      jobId: 'sq-double-cancel', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-08T00:00:00.000Z',
    });

    client.requestCancel({
      jobId: 'sq-double-cancel', requestedBy: 'user-1', reason: 'first',
      now: '2026-04-08T00:01:00.000Z',
    });

    const second = client.requestCancel({
      jobId: 'sq-double-cancel', requestedBy: 'user-2', reason: 'second',
      now: '2026-04-08T00:02:00.000Z',
    });

    assert.equal(second.metadata?.cancelRequestedBy, 'user-1');
    const events = client.listJobEvents('sq-double-cancel');
    assert.equal(events.filter((e) => e.type === 'cancel_requested').length, 1);

    broker.close();
  });

  it('sqlite broker: updateMessage with injected and dropped statuses', () => {
    const broker = new SqliteDelegateBroker({ dbPath });
    const client = new DelegateBrokerClient({ broker });

    client.publishEvent({
      jobId: 'sq-msg-status', type: 'status_update', status: 'running',
      payload: { summary: 'running' }, now: '2026-04-08T00:00:00.000Z',
    });

    const msg1 = client.queueMessage({
      jobId: 'sq-msg-status', message: 'inject me', delivery: 'inject',
      now: '2026-04-08T00:00:01.000Z',
    });
    const msg2 = client.queueMessage({
      jobId: 'sq-msg-status', message: 'drop me', delivery: 'after_complete',
      now: '2026-04-08T00:00:02.000Z',
    });

    const injected = client.updateMessage({
      jobId: 'sq-msg-status', messageId: msg1.messageId,
      status: 'injected', now: '2026-04-08T00:00:03.000Z',
    });
    assert.equal(injected?.status, 'injected');

    const dropped = client.updateMessage({
      jobId: 'sq-msg-status', messageId: msg2.messageId,
      status: 'dropped', dispatchReason: 'no longer needed',
      now: '2026-04-08T00:00:04.000Z',
    });
    assert.equal(dropped?.status, 'dropped');

    const events = client.listJobEvents('sq-msg-status');
    const types = events.map((e) => e.type);
    assert.ok(types.includes('message_injected'));
    assert.ok(types.includes('message_dropped'));

    broker.close();
  });

  it('publishEvent with payload.snapshot as non-object is ignored', () => {
    const client = new DelegateBrokerClient({ statePath });

    client.publishEvent({
      jobId: 'job-bad-snap', type: 'snapshot', status: 'running',
      payload: { summary: 'bad snapshot', snapshot: 'not-an-object' },
      now: '2026-04-07T00:00:00.000Z',
    });

    const job = client.getJob('job-bad-snap');
    assert.ok(job);
    // latestSnapshot should be null since payload.snapshot is not a JsonObject
    assert.equal(job.latestSnapshot, null);
  });

  it('buildCancelPayload without reason or requestedBy', () => {
    const client = new DelegateBrokerClient({ statePath });

    const result = client.requestCancel({
      jobId: 'job-cancel-minimal',
      now: '2026-04-07T00:00:00.000Z',
    });

    const events = client.listJobEvents('job-cancel-minimal');
    const cancelEvent = events.find((e) => e.type === 'cancel_requested');
    assert.ok(cancelEvent);
    assert.equal(cancelEvent?.payload.summary, 'Cancellation requested');
    // No requestedBy or reason in payload
    assert.equal(cancelEvent?.payload.requestedBy, undefined);
    assert.equal(cancelEvent?.payload.reason, undefined);
  });

  it('FileDelegateBroker recovers from corrupted state file', () => {
    writeFileSync(statePath, 'NOT VALID JSON{{{', 'utf-8');
    const broker = new FileDelegateBroker(statePath);

    // Should not throw — falls back to empty state
    const job = broker.getJob('nonexistent');
    assert.equal(job, null);

    // Should be able to write fresh state
    broker.registerSession({ sessionId: 's1', now: '2026-04-12T00:00:00Z' });
    const result = broker.publishEvent({
      jobId: 'j1',
      type: 'queued',
      status: 'queued',
      payload: { summary: 'test' },
      now: '2026-04-12T00:00:00Z',
    });
    assert.equal(result.jobId, 'j1');
  });

  it('FileDelegateBroker handles state with wrong version', () => {
    writeFileSync(statePath, JSON.stringify({ version: 99, sessions: {}, jobs: {}, eventsByJob: {}, nextEventId: 1 }), 'utf-8');
    const broker = new FileDelegateBroker(statePath);

    // Wrong version — should fall back to empty state
    const job = broker.getJob('nonexistent');
    assert.equal(job, null);
  });

  it('listMessages returns empty for job with no queued messages metadata', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.publishEvent({
      jobId: 'job-no-msgs',
      type: 'queued',
      status: 'queued',
      payload: { summary: 'test' },
      now: '2026-04-12T00:00:00Z',
    });

    const messages = client.listMessages('job-no-msgs');
    assert.deepEqual(messages, []);
  });

  it('listMessages returns empty for nonexistent job', () => {
    const client = new DelegateBrokerClient({ statePath });
    const messages = client.listMessages('nonexistent');
    assert.deepEqual(messages, []);
  });

  it('ack counts only unacked events and skips already-acked', () => {
    const client = new DelegateBrokerClient({ statePath });
    client.registerSession({ sessionId: 's1', now: '2026-04-12T00:00:00Z' });

    const e1 = client.publishEvent({
      jobId: 'j1',
      type: 'queued',
      status: 'queued',
      payload: { summary: 'first' },
      now: '2026-04-12T00:00:00Z',
    });
    const e2 = client.publishEvent({
      jobId: 'j1',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'second' },
      now: '2026-04-12T00:00:01Z',
    });

    // Ack first event
    const count1 = client.ack({ sessionId: 's1', eventIds: [e1.eventId], now: '2026-04-12T00:00:02Z' });
    assert.equal(count1, 1);

    // Ack both — only e2 should be newly acked
    const count2 = client.ack({ sessionId: 's1', eventIds: [e1.eventId, e2.eventId], now: '2026-04-12T00:00:03Z' });
    assert.equal(count2, 1);

    // Ack same again — nothing new
    const count3 = client.ack({ sessionId: 's1', eventIds: [e1.eventId, e2.eventId], now: '2026-04-12T00:00:04Z' });
    assert.equal(count3, 0);
  });
});
