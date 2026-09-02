import { describe, expect, it } from 'vitest';
import {
  normalizePayload,
  purgeRecords,
  registerRecord,
  markRecordStopped,
  type ChildRecord,
} from '../child-scope.js';

const NOW = '2026-09-02T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function makeRunning(overrides: Partial<ChildRecord> = {}): ChildRecord {
  return {
    v: 1,
    id: 'child-x',
    host: 'claude',
    host_session_id: 's1',
    maestro_session_id: null,
    kind: 'host_subagent',
    platform_handle: { agent_id: null, agent_type: null, job_id: null },
    status: 'running',
    spawned_at: NOW,
    stopped_at: null,
    source: 'subagent-start',
    ...overrides,
  };
}

describe('normalizePayload', () => {
  it('parses Claude snake_case payload and infers claude host', () => {
    const p = normalizePayload({
      hook_event_name: 'SubagentStart',
      session_id: 's1',
      agent_id: 'a-1',
      agent_type: 'Explore',
    });
    expect(p.event).toBe('subagentstart');
    expect(p.sessionId).toBe('s1');
    expect(p.agentId).toBe('a-1');
    expect(p.agentType).toBe('Explore');
    expect(p.host).toBe('claude');
  });

  it('parses Grok camelCase payload and infers grok host', () => {
    const p = normalizePayload({
      hookEventName: 'subagent_stop',
      sessionId: 'g1',
      subagentType: 'explore',
      stopHookActive: true,
    });
    expect(p.event).toBe('subagentstop');
    expect(p.agentType).toBe('explore');
    expect(p.stopHookActive).toBe(true);
    expect(p.host).toBe('grok');
  });

  it('maps SubagentEnd alias to subagentstop', () => {
    expect(normalizePayload({ hook_event_name: 'SubagentEnd' }).event).toBe('subagentstop');
  });
});

describe('registerRecord', () => {
  it('dedupes SubagentStart arriving after PreToolUse within the adopt window', () => {
    const records: ChildRecord[] = [];
    registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: null, agentType: null, source: 'pretool-agent', now: NOW });
    const changed = registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-1', agentType: 'Explore', source: 'subagent-start', now: NOW });
    expect(changed).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].platform_handle.agent_id).toBe('a-1');
    expect(records[0].source).toBe('subagent-start');
  });

  it('skips PreToolUse when a SubagentStart record already exists in the window', () => {
    const records: ChildRecord[] = [];
    registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-1', agentType: null, source: 'subagent-start', now: NOW });
    const changed = registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: null, agentType: null, source: 'pretool-agent', now: NOW });
    expect(changed).toBe(false);
    expect(records).toHaveLength(1);
  });

  it('dedupes repeated SubagentStart for the same agent id', () => {
    const records: ChildRecord[] = [];
    const ctx = { host: 'claude', sessionId: 's1', kind: 'host_subagent' as const, agentId: 'a-1', agentType: null, source: 'subagent-start' as const, now: NOW };
    registerRecord(records, ctx);
    expect(registerRecord(records, ctx)).toBe(false);
    expect(records).toHaveLength(1);
  });

  it('registers two parallel SubagentStart events within the adopt window (no false dedupe)', () => {
    const records: ChildRecord[] = [];
    registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-1', agentType: 'Explore', source: 'subagent-start', now: NOW });
    const changed = registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-2', agentType: 'Plan', source: 'subagent-start', now: new Date(NOW_MS + 1000).toISOString() });
    expect(changed).toBe(true);
    expect(records).toHaveLength(2);
    expect(records[1].platform_handle.agent_id).toBe('a-2');
  });

  it('parallel starts then stops: each stop marks its own record', () => {
    const records: ChildRecord[] = [];
    registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-1', agentType: null, source: 'subagent-start', now: NOW });
    registerRecord(records, { host: 'claude', sessionId: 's1', kind: 'host_subagent', agentId: 'a-2', agentType: null, source: 'subagent-start', now: new Date(NOW_MS + 500).toISOString() });
    expect(markRecordStopped(records, { agentId: 'a-2', agentType: null, now: NOW })).toBe(true);
    expect(records[0].status).toBe('running');
    expect(records[1].status).toBe('stopped');
    expect(markRecordStopped(records, { agentId: 'a-1', agentType: null, now: NOW })).toBe(true);
    expect(records[0].status).toBe('stopped');
  });
});

describe('markRecordStopped', () => {
  it('prefers agent_id match', () => {
    const records = [
      makeRunning({ id: 'c1', platform_handle: { agent_id: 'a-1', agent_type: 'Explore', job_id: null } }),
      makeRunning({ id: 'c2', platform_handle: { agent_id: 'a-2', agent_type: 'Explore', job_id: null } }),
    ];
    expect(markRecordStopped(records, { agentId: 'a-2', agentType: 'Explore', now: NOW })).toBe(true);
    expect(records[0].status).toBe('running');
    expect(records[1].status).toBe('stopped');
    expect(records[1].stopped_at).toBe(NOW);
  });

  it('falls back to most recent record of the same agent type (grok child-session stop)', () => {
    const records = [
      makeRunning({ id: 'c1', platform_handle: { agent_id: null, agent_type: 'explore', job_id: null } }),
      makeRunning({ id: 'c2', platform_handle: { agent_id: null, agent_type: 'plan', job_id: null } }),
    ];
    expect(markRecordStopped(records, { agentId: null, agentType: 'plan', now: NOW })).toBe(true);
    expect(records[0].status).toBe('running');
    expect(records[1].status).toBe('stopped');
  });

  it('returns false when nothing is running', () => {
    const records = [makeRunning({ status: 'stopped', stopped_at: NOW })];
    expect(markRecordStopped(records, { agentId: null, agentType: null, now: NOW })).toBe(false);
  });

  it('requireIdentity: refuses blind recency fallback (cross-session safety)', () => {
    const records = [makeRunning({ id: 'c1', platform_handle: { agent_id: null, agent_type: 'explore', job_id: null } })];
    // 无 id、无 type 命中时，requireIdentity 禁止兜底误标
    expect(markRecordStopped(records, { agentId: null, agentType: 'plan', now: NOW }, { requireIdentity: true })).toBe(false);
    expect(records[0].status).toBe('running');
    // 有 type 命中时正常标记
    expect(markRecordStopped(records, { agentId: null, agentType: 'explore', now: NOW }, { requireIdentity: true })).toBe(true);
    expect(records[0].status).toBe('stopped');
  });
});

describe('purgeRecords', () => {
  it('drops terminal records older than 2h', () => {
    const old = new Date(NOW_MS - 3 * 3600e3).toISOString();
    const records = [makeRunning({ status: 'stopped', stopped_at: old })];
    expect(purgeRecords(records, NOW_MS)).toBe(true);
    expect(records).toHaveLength(0);
  });

  it('marks running records older than 30min as orphan', () => {
    const old = new Date(NOW_MS - 31 * 60e3).toISOString();
    const records = [makeRunning({ spawned_at: old })];
    expect(purgeRecords(records, NOW_MS)).toBe(true);
    expect(records[0].status).toBe('orphan');
  });

  it('keeps fresh running records untouched', () => {
    const records = [makeRunning()];
    expect(purgeRecords(records, NOW_MS)).toBe(false);
    expect(records[0].status).toBe('running');
  });
});
