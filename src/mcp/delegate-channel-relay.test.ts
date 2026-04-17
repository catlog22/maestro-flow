import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

process.env.MAESTRO_HOME = join(tmpdir(), 'maestro-async-delegate-tests');

import { DelegateBrokerClient } from '../async/index.js';
import { DelegateChannelRelay } from './delegate-channel-relay.js';

describe('DelegateChannelRelay', () => {
  let tempDir: string;
  let statePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'maestro-channel-relay-'));
    statePath = join(tempDir, 'delegate-broker.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers a relay session, emits concise channel notifications, and acks duplicate status events', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'relay-test',
      pollIntervalMs: 20,
      statusThrottleMs: 1_000,
      snapshotThrottleMs: 1_000,
      now: () => '2026-04-07T01:00:05.000Z',
    });

    // Start relay first — events published before start are drained (not emitted)
    await relay.start();

    broker.publishEvent({
      jobId: 'job-1',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'collect', progress: 10 },
      payload: { summary: 'collecting context' },
      now: '2026-04-07T01:00:00.000Z',
    });
    broker.publishEvent({
      jobId: 'job-1',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'collect', progress: 10 },
      payload: { summary: 'collecting context' },
      now: '2026-04-07T01:00:01.000Z',
    });
    broker.publishEvent({
      jobId: 'job-1',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'still running' },
      now: '2026-04-07T01:00:02.000Z',
    });
    broker.publishEvent({
      jobId: 'job-1',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'still running' },
      now: '2026-04-07T01:00:03.000Z',
    });
    broker.publishEvent({
      jobId: 'job-1',
      type: 'completed',
      status: 'completed',
      payload: {
        summary: 'done with final output that should stay behind delegate_output rather than flooding the channel',
      },
      now: '2026-04-07T01:00:04.000Z',
    });

    await delay(120);
    relay.stop();

    assert.equal(notifications.length, 3);
    assert.equal(notifications[0].method, 'notifications/claude/channel');
    assert.match(notifications[0].params.content, /RUNNING/);
    assert.match(notifications[1].params.content, /RUNNING/);
    assert.match(notifications[2].params.content, /DONE/);

    for (const notification of notifications) {
      assert.ok(notification.params.content.length <= 240);
      assert.equal(notification.params.meta.job_id, 'job-1');
      assert.equal(notification.params.meta.exec_id, 'job-1');
    }

    const remaining = broker.pollEvents({ sessionId: 'relay-test' });
    assert.deepEqual(remaining, []);
  });

  it('includes exec_id alias in notification meta', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'relay-exec-id-test',
      pollIntervalMs: 20,
      now: () => '2026-04-07T02:00:01.000Z',
    });

    await relay.start();

    broker.publishEvent({
      jobId: 'job-42',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'done' },
      now: '2026-04-07T02:00:00.000Z',
    });

    await delay(80);
    relay.stop();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].params.meta.job_id, 'job-42');
    assert.equal(notifications[0].params.meta.exec_id, 'job-42');
    assert.equal(notifications[0].params.meta.event_type, 'completed');
    assert.equal(notifications[0].params.meta.status, 'completed');
  });

  it('drains pre-existing events on startup without emitting them', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    // Publish events BEFORE relay starts — simulates history from a prior session
    broker.publishEvent({
      jobId: 'old-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'finished in previous session' },
      now: '2026-04-07T00:00:00.000Z',
    });

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'drain-test',
      pollIntervalMs: 20,
      now: () => '2026-04-07T01:00:00.000Z',
    });

    await relay.start();

    // Publish a new event AFTER start — this should be emitted
    broker.publishEvent({
      jobId: 'new-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'new work' },
      now: '2026-04-07T01:00:01.000Z',
    });

    await delay(80);
    relay.stop();

    // Only the post-startup event should have been emitted
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].params.meta.job_id, 'new-job');

    // All events (old + new) should be acked
    const remaining = broker.pollEvents({ sessionId: 'drain-test' });
    assert.deepEqual(remaining, []);
  });

  it('stops polling after 3 consecutive failures', async () => {
    let heartbeatCount = 0;
    let pollCount = 0;
    const failingBroker = {
      registerSession() { return {} as ReturnType<DelegateBrokerClient['registerSession']>; },
      heartbeat() {
        heartbeatCount++;
        // Succeed on first call (from start's initial pollOnce) then fail
        if (heartbeatCount > 1) {
          throw new Error('broker unavailable');
        }
      },
      pollEvents() { pollCount++; return []; },
      ack() { return 0; },
      getJob() { return null; },
      listJobEvents() { return []; },
      requestCancel() { return {} as ReturnType<DelegateBrokerClient['requestCancel']>; },
      queueMessage() { return {} as ReturnType<DelegateBrokerClient['queueMessage']>; },
      listMessages() { return []; },
      updateMessage() { return null; },
      checkTimeouts() { return []; },
      purgeExpiredEvents() { return { purgedEventCount: 0, purgedJobCount: 0, purgedSessionCount: 0 }; },
    };

    const relay = new DelegateChannelRelay({
      server: { async notification() {} },
      broker: failingBroker,
      sessionId: 'relay-health-test',
      pollIntervalMs: 10,
    });

    await relay.start();  // First pollOnce succeeds
    await delay(200);     // Give time for interval polls to fail 3 times
    relay.stop();

    // heartbeat 1 = initial success, then 3+ failures before circuit breaker trips
    assert.ok(heartbeatCount >= 4, `Expected at least 4 heartbeat calls, got ${heartbeatCount}`);
    // pollCount: 1 from drain + 1 from initial pollOnce = 2, then failures prevent further polls
    assert.equal(pollCount, 2, 'Only the drain and initial poll should have proceeded');
  });

  it('filters events by origin sessionId in metadata', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'relay-session-A',
      pollIntervalMs: 20,
      now: () => '2026-04-09T01:00:01.000Z',
    });

    await relay.start();

    // Event from this session's job
    broker.publishEvent({
      jobId: 'my-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'done' },
      jobMetadata: { sessionId: 'relay-session-A' },
      now: '2026-04-09T01:00:00.000Z',
    });

    // Event from another session's job
    broker.publishEvent({
      jobId: 'other-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'also done' },
      jobMetadata: { sessionId: 'relay-session-B' },
      now: '2026-04-09T01:00:00.000Z',
    });

    await delay(80);
    relay.stop();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].params.meta.job_id, 'my-job');
  });

  it('emits events without sessionId in metadata for backward compatibility', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'relay-session-A',
      pollIntervalMs: 20,
      now: () => '2026-04-09T02:00:01.000Z',
    });

    await relay.start();

    // Legacy job without sessionId in metadata
    broker.publishEvent({
      jobId: 'legacy-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'legacy done' },
      now: '2026-04-09T02:00:00.000Z',
    });

    await delay(80);
    relay.stop();

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].params.meta.job_id, 'legacy-job');
  });

  it('full relay cycle: publish, format, notify, and ack with real broker', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'full-cycle-test',
      pollIntervalMs: 20,
      statusThrottleMs: 0,
      snapshotThrottleMs: 0,
      now: () => '2026-04-12T01:00:05.000Z',
    });

    await relay.start();

    // Publish queued -> running -> completed lifecycle
    broker.publishEvent({
      jobId: 'lifecycle-job',
      type: 'queued',
      status: 'queued',
      payload: { summary: 'Starting work' },
      now: '2026-04-12T01:00:00.000Z',
    });
    broker.publishEvent({
      jobId: 'lifecycle-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'Analyzing code' },
      now: '2026-04-12T01:00:01.000Z',
    });
    broker.publishEvent({
      jobId: 'lifecycle-job',
      type: 'completed',
      status: 'completed',
      payload: { summary: 'Analysis complete' },
      now: '2026-04-12T01:00:02.000Z',
    });

    await delay(120);
    relay.stop();

    // Should get notifications for queued, status_update, and completed
    assert.ok(notifications.length >= 2, `Expected at least 2 notifications, got ${notifications.length}`);

    // All notifications should have correct meta structure
    for (const n of notifications) {
      assert.equal(n.method, 'notifications/claude/channel');
      assert.equal(n.params.meta.job_id, 'lifecycle-job');
      assert.equal(n.params.meta.exec_id, 'lifecycle-job');
      assert.ok(n.params.content.length <= 240);
    }

    // Completed notification should have DONE label
    const completedNotif = notifications.find((n) => n.params.meta.event_type === 'completed');
    assert.ok(completedNotif);
    assert.match(completedNotif!.params.content, /DONE/);

    // All events should be acked
    const remaining = broker.pollEvents({ sessionId: 'full-cycle-test' });
    assert.deepEqual(remaining, []);
  });

  it('throttles status events within throttle window', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'throttle-status-test',
      pollIntervalMs: 20,
      statusThrottleMs: 60_000, // very long throttle
      snapshotThrottleMs: 60_000,
      now: () => '2026-04-12T02:00:05.000Z',
    });

    await relay.start();

    // Publish multiple status_update events rapidly
    broker.publishEvent({
      jobId: 'throttle-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'step 1' },
      now: '2026-04-12T02:00:00.000Z',
    });
    broker.publishEvent({
      jobId: 'throttle-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'step 2' },
      now: '2026-04-12T02:00:01.000Z',
    });
    broker.publishEvent({
      jobId: 'throttle-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'step 3' },
      now: '2026-04-12T02:00:02.000Z',
    });

    await delay(120);
    relay.stop();

    // With a 60s throttle window, only the first status_update should produce a notification
    const statusNotifs = notifications.filter((n) => n.params.meta.event_type === 'status_update');
    assert.equal(statusNotifs.length, 1, `Expected 1 status notification due to throttle, got ${statusNotifs.length}`);

    // Events should still all be acked despite throttling
    const remaining = broker.pollEvents({ sessionId: 'throttle-status-test' });
    assert.deepEqual(remaining, []);
  });

  it('snapshot throttling works independently from status throttling', async () => {
    const broker = new DelegateBrokerClient({ statePath });
    const notifications: Array<{ method: string; params: { content: string; meta: Record<string, string> } }> = [];

    const relay = new DelegateChannelRelay({
      server: {
        async notification(message) {
          notifications.push(message);
        },
      },
      broker,
      sessionId: 'independent-throttle-test',
      pollIntervalMs: 20,
      statusThrottleMs: 60_000, // long status throttle
      snapshotThrottleMs: 0,    // no snapshot throttle
      now: () => '2026-04-12T03:00:05.000Z',
    });

    await relay.start();

    // Publish one status_update then two snapshots
    broker.publishEvent({
      jobId: 'indie-job',
      type: 'status_update',
      status: 'running',
      payload: { summary: 'processing' },
      now: '2026-04-12T03:00:00.000Z',
    });
    broker.publishEvent({
      jobId: 'indie-job',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'collect', progress: 30 },
      payload: { summary: 'snapshot 1' },
      now: '2026-04-12T03:00:01.000Z',
    });
    broker.publishEvent({
      jobId: 'indie-job',
      type: 'snapshot',
      status: 'running',
      snapshot: { phase: 'analyze', progress: 60 },
      payload: { summary: 'snapshot 2' },
      now: '2026-04-12T03:00:02.000Z',
    });

    await delay(120);
    relay.stop();

    // Status should produce 1 (first one passes)
    const statusNotifs = notifications.filter((n) => n.params.meta.event_type === 'status_update');
    assert.equal(statusNotifs.length, 1);

    // Snapshots should produce 2 (no throttle, different signatures)
    const snapshotNotifs = notifications.filter((n) => n.params.meta.event_type === 'snapshot');
    assert.equal(snapshotNotifs.length, 2, `Expected 2 snapshot notifications, got ${snapshotNotifs.length}`);
  });

  it('writes relay session file on start and removes on stop', async () => {
    const broker = new DelegateBrokerClient({ statePath });

    const relay = new DelegateChannelRelay({
      server: { async notification() {} },
      broker,
      sessionId: 'file-lifecycle-test',
      pollIntervalMs: 60_000,
      now: () => '2026-04-09T03:00:00.000Z',
    });

    await relay.start();

    const sessionDir = join(process.env.MAESTRO_HOME!, 'data', 'async');
    const sessionFile = join(sessionDir, `relay-session-${process.pid}.id`);
    assert.ok(existsSync(sessionFile), 'Session file should exist after start');

    const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));
    assert.equal(data.sessionId, 'file-lifecycle-test');
    assert.equal(data.pid, process.pid);

    relay.stop();

    assert.equal(existsSync(sessionFile), false, 'Session file should be removed after stop');
  });

  it('records ownerPid (parent PID) in the session file so stale relays can be detected', async () => {
    const broker = new DelegateBrokerClient({ statePath });

    const relay = new DelegateChannelRelay({
      server: { async notification() {} },
      broker,
      sessionId: 'owner-pid-test',
      pollIntervalMs: 60_000,
      now: () => '2026-04-16T11:00:00.000Z',
    });

    await relay.start();

    try {
      const sessionDir = join(process.env.MAESTRO_HOME!, 'data', 'async');
      const sessionFile = join(sessionDir, `relay-session-${process.pid}.id`);
      const data = JSON.parse(readFileSync(sessionFile, 'utf-8'));

      assert.equal(data.pid, process.pid);
      assert.equal(data.ownerPid, process.ppid, 'ownerPid should equal process.ppid at write time');
    } finally {
      relay.stop();
    }
  });
});
