import { describe, expect, it } from 'vitest';
import {
  classifyTeamSession,
  getTeamSessionCleanupEligibility,
  rankResumeCandidates,
  type ResumeCandidate,
  type TeamSessionEvidence,
} from './session-lifecycle.js';

const NOW = '2026-07-17T12:00:00.000Z';
const HOUR = 60 * 60 * 1_000;

function classify(evidence: TeamSessionEvidence) {
  return classifyTeamSession(evidence, { now: NOW, staleTtlMs: HOUR });
}

describe('classifyTeamSession', () => {
  it('uses live broker members before an expired activity clock', () => {
    const result = classify({
      sidecarLifecycle: 'active',
      liveBrokerMembers: 1,
      latestMessageAt: '2026-07-16T12:00:00.000Z',
    });

    expect(result).toMatchObject({ lifecycle: 'active', health: 'fresh', live: true, cleanupEligible: false });
  });

  it('uses non-terminal tasks as liveness but ignores persisted active_workers', () => {
    expect(classify({
      sidecarLifecycle: 'active',
      nonTerminalTasks: 1,
      latestTaskAt: '2026-07-16T12:00:00.000Z',
    }).health).toBe('fresh');

    const persistedOnly = classify({
      sidecarLifecycle: 'active',
      persistedActiveWorkers: 4,
      latestMessageAt: '2026-07-16T12:00:00.000Z',
    });
    expect(persistedOnly).toMatchObject({ health: 'stale_candidate', live: false, cleanupEligible: false });
  });

  it('classifies malformed timestamps as unknown without throwing', () => {
    const result = classify({ sidecarLifecycle: 'active', metaUpdatedAt: 'not-a-date' });

    expect(result.health).toBe('unknown');
    expect(result.lastActivityAt).toBeUndefined();
    expect(result.reasons).toContain('invalid metaUpdatedAt timestamp');
  });

  it('uses durable message/task activity before lower-priority filesystem mtime', () => {
    const result = classify({
      sidecarLifecycle: 'active',
      latestMessageAt: '2026-07-17T10:00:00.000Z',
      filesystemMtime: '2026-07-17T11:59:00.000Z',
    });

    expect(result.health).toBe('stale_candidate');
    expect(result.lastActivityAt).toBe(Date.parse('2026-07-17T10:00:00.000Z'));
  });

  it('keeps lifecycle and derived stale health separate', () => {
    const result = classify({
      sidecarLifecycle: 'paused',
      sidecarUpdatedAt: '2026-07-17T10:00:00.000Z',
    });

    expect(result).toMatchObject({ lifecycle: 'paused', health: 'stale_candidate', cleanupEligible: false });
    expect(getTeamSessionCleanupEligibility(result, { force: true })).toEqual({
      eligible: false,
      reason: 'stale_candidate is derived health, not a cleanup lifecycle',
    });
  });

  it('lets a terminal Run win over an active sidecar and reports the conflict', () => {
    const result = classify({
      runStatus: 'sealed',
      sidecarLifecycle: 'active',
      metaLifecycle: 'active',
      sidecarUpdatedAt: '2026-07-17T11:30:00.000Z',
    });

    expect(result).toMatchObject({ lifecycle: 'completed', health: 'inconsistent', cleanupEligible: false });
  });

  it('resolves a completed sidecar over active meta while surfacing inconsistency', () => {
    const result = classify({ sidecarLifecycle: 'completed', metaLifecycle: 'active' });

    expect(result).toMatchObject({ lifecycle: 'completed', health: 'inconsistent', cleanupEligible: false });
  });

  it('requires an explicit audited transition before accepting abandoned', () => {
    const unaudited = classify({ sidecarLifecycle: 'abandoned' });
    expect(unaudited).toMatchObject({ lifecycle: 'active', health: 'unknown', cleanupEligible: false });

    const audited = classify({
      sidecarLifecycle: 'abandoned',
      abandonmentTransition: {
        audited: true,
        actor: 'operator@example.test',
        reason: 'confirmed no live members or tasks',
        at: '2026-07-17T11:00:00.000Z',
      },
    });
    expect(audited).toMatchObject({ lifecycle: 'abandoned', health: 'idle', cleanupEligible: true });
  });

  it('rejects invalid injected clocks and TTLs', () => {
    expect(() => classifyTeamSession({}, { now: 'bad-clock', staleTtlMs: HOUR })).toThrow(/now/);
    expect(() => classifyTeamSession({}, { now: NOW, staleTtlMs: -1 })).toThrow(/staleTtlMs/);
  });
});

describe('rankResumeCandidates', () => {
  const recent = classify({ sidecarLifecycle: 'active', latestMessageAt: '2026-07-17T11:45:00.000Z' });
  const older = classify({ sidecarLifecycle: 'paused', latestMessageAt: '2026-07-17T11:30:00.000Z' });

  const candidates: ResumeCandidate[] = [
    { sessionId: 'session-a', runId: 'run-a', runDir: '.workflow/sessions/a/runs/run-a', classification: recent },
    { sessionId: 'session-b', runId: 'run-b', runDir: '.workflow/sessions/b/runs/run-b', classification: older },
  ];

  it('ranks an exact Run locator first and selects only that unique match', () => {
    const result = rankResumeCandidates(candidates, { runId: 'run-b' });

    expect(result.candidates.map((candidate) => candidate.runId)).toEqual(['run-b', 'run-a']);
    expect(result.selected?.runId).toBe('run-b');
    expect(result).toMatchObject({ requiresUserSelection: false, reason: 'exact_locator' });
  });

  it('normalizes exact run_dir locators', () => {
    const result = rankResumeCandidates(candidates, { runDir: '.WORKFLOW\\SESSIONS\\B\\RUNS\\RUN-B\\' });

    expect(result.selected?.sessionId).toBe('session-b');
  });

  it('never implicitly selects index zero without a locator', () => {
    const result = rankResumeCandidates(candidates);

    expect(result.candidates[0].sessionId).toBe('session-a');
    expect(result.selected).toBeUndefined();
    expect(result).toMatchObject({ requiresUserSelection: true, reason: 'manual_selection' });
  });

  it('marks tied resume candidates and still requires explicit selection', () => {
    const tiedClassification = classify({
      sidecarLifecycle: 'active',
      latestMessageAt: '2026-07-17T11:45:00.000Z',
    });
    const result = rankResumeCandidates([
      { sessionId: 'session-z', runId: 'run-z', classification: tiedClassification },
      { sessionId: 'session-y', runId: 'run-y', classification: tiedClassification },
    ]);

    expect(result.candidates.every((candidate) => candidate.tied)).toBe(true);
    expect(result.selected).toBeUndefined();
    expect(result.requiresUserSelection).toBe(true);
  });
});
