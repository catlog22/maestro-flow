import { describe, it, expect } from 'vitest';

import { runPreflight } from '../preflight-core.js';
import type { MemberRecord } from '../../tools/team-members.js';
import type { ActivityEvent } from '../../tools/team-activity.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SELF: MemberRecord = {
  uid: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  host: 'alice-laptop',
  role: 'admin',
  joinedAt: '2026-04-01T00:00:00Z',
};

function evt(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: '2026-04-12T10:00:00Z',
    user: 'bob',
    host: 'bob-desktop',
    action: 'maestro-execute',
    phase_id: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preflight-core', () => {
  it('no self → exit 0 with no warnings', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => null,
      getActivity: () => [],
    });
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('no activity on target phase → exit 0', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => SELF,
      getActivity: () => [evt({ phase_id: 5 })], // different phase
    });
    expect(result.exitCode).toBe(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('own activity on same phase → exit 0 (not a conflict)', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => SELF,
      getActivity: () => [evt({ user: 'alice', phase_id: 3 })],
    });
    expect(result.exitCode).toBe(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('another user active on same phase → exit 1 with warning', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => SELF,
      getActivity: () => [evt({ user: 'bob', phase_id: 3 })],
      now: () => new Date('2026-04-12T10:05:00Z').getTime(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('bob@bob-desktop');
    expect(result.warnings[0]).toContain('phase 3');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].user).toBe('bob');
  });

  it('force mode → exit 0 even with conflicts', () => {
    const result = runPreflight(3, { force: true }, {
      getSelf: () => SELF,
      getActivity: () => [evt({ user: 'bob', phase_id: 3 })],
      now: () => new Date('2026-04-12T10:05:00Z').getTime(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.warnings).toHaveLength(1); // still reports
    expect(result.conflicts).toHaveLength(1);
  });

  it('deduplicates by user@host — keeps most recent', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => SELF,
      getActivity: () => [
        evt({ user: 'bob', host: 'bob-desktop', ts: '2026-04-12T10:00:00Z', action: 'analyze' }),
        evt({ user: 'bob', host: 'bob-desktop', ts: '2026-04-12T10:03:00Z', action: 'execute' }),
      ],
      now: () => new Date('2026-04-12T10:05:00Z').getTime(),
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].action).toBe('execute'); // most recent
  });

  it('multiple different users → one conflict per user@host', () => {
    const result = runPreflight(3, {}, {
      getSelf: () => SELF,
      getActivity: () => [
        evt({ user: 'bob', host: 'bob-desktop', phase_id: 3 }),
        evt({ user: 'carol', host: 'carol-laptop', phase_id: 3 }),
      ],
      now: () => new Date('2026-04-12T10:05:00Z').getTime(),
    });
    expect(result.conflicts).toHaveLength(2);
    expect(result.warnings).toHaveLength(2);
  });
});
