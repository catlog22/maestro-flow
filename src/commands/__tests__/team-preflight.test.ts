import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight } from '../../hooks/preflight-core.js';
import type { MemberRecord } from '../../tools/team-members.js';
import type { ActivityEvent } from '../../tools/team-activity.js';

// ---------------------------------------------------------------------------
// `runPreflight` is a pure function — we inject `deps` instead of touching
// the filesystem. That keeps these tests hermetic and fast.
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

describe('runPreflight', () => {
  it('no self → exit 0 with no warnings (team mode off)', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => null,
        getActivity: () => {
          throw new Error('should not be called when self is null');
        },
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 0);
    assert.deepStrictEqual(result.warnings, []);
    assert.deepStrictEqual(result.conflicts, []);
  });

  it('only self activity → exit 0', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => SELF,
        getActivity: () => [
          evt({ user: 'alice', host: 'alice-laptop' }),
          evt({ user: 'alice', host: 'alice-laptop', action: 'maestro-plan' }),
        ],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('conflict on same phase → exit 1 with warning', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => SELF,
        getActivity: () => [evt({ ts: '2026-04-12T10:02:00Z' })],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /bob@bob-desktop/);
    assert.match(result.warnings[0]!, /phase 3/);
    assert.match(result.warnings[0]!, /3 min/);
    assert.strictEqual(result.conflicts.length, 1);
    assert.strictEqual(result.conflicts[0]!.user, 'bob');
  });

  it('conflict + --force → exit 0 but warnings still returned', () => {
    const result = runPreflight(
      3,
      { force: true },
      {
        getSelf: () => SELF,
        getActivity: () => [evt({ ts: '2026-04-12T10:02:00Z' })],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /bob@bob-desktop/);
  });

  it('filters out events with a different phase_id', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => SELF,
        getActivity: () => [
          evt({ phase_id: 2 }),
          evt({ phase_id: 4 }),
          evt({ phase_id: undefined }),
        ],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.warnings.length, 0);
  });

  it('deduplicates multiple events from the same user@host', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => SELF,
        getActivity: () => [
          evt({ ts: '2026-04-12T09:55:00Z', action: 'maestro-plan' }),
          evt({ ts: '2026-04-12T10:00:00Z', action: 'edit' }),
          evt({ ts: '2026-04-12T10:03:00Z', action: 'maestro-execute' }),
        ],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.warnings.length, 1);
    // The most recent event's action wins.
    assert.match(result.warnings[0]!, /maestro-execute/);
  });

  it('reports multiple distinct teammates as separate warnings', () => {
    const result = runPreflight(
      3,
      {},
      {
        getSelf: () => SELF,
        getActivity: () => [
          evt({ user: 'bob', host: 'bob-desktop', ts: '2026-04-12T10:00:00Z' }),
          evt({ user: 'carol', host: 'carol-laptop', ts: '2026-04-12T10:04:00Z' }),
        ],
        now: () => Date.parse('2026-04-12T10:05:00Z'),
      },
    );
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.warnings.length, 2);
    // Most recent first → carol before bob.
    assert.match(result.warnings[0]!, /carol@carol-laptop/);
    assert.match(result.warnings[1]!, /bob@bob-desktop/);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test for `maestro team sync --dry-run`.
//
// We invoke the built CLI as a subprocess. Dry-run must succeed on any
// working tree where `team join` has been executed, OR exit 1 with the
// "Team mode not enabled" message when it has not. Both outcomes are
// acceptable — we just want to assert the command is wired.
// ---------------------------------------------------------------------------

describe('maestro team sync --dry-run (smoke)', () => {
  it('runs without crashing and produces sensible output', () => {
    const bin = join(process.cwd(), 'bin', 'maestro.js');
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(process.execPath, [bin, 'team', 'sync', '--dry-run'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? 1;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }

    // Accept either: team-mode-off (exit 1, clear error) OR successful dry-run plan (exit 0).
    if (exitCode === 1) {
      assert.match(stderr, /Team mode not enabled/);
    } else {
      assert.strictEqual(exitCode, 0);
      assert.match(stdout, /\[dry-run\]/);
    }
  });
});
