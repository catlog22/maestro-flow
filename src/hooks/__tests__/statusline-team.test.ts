/**
 * Tests for buildTeamSegment (team-lite Wave 3B).
 *
 * Covers teammate activity rendering, cache semantics, self-filtering,
 * error swallowing, and never-throws contract.
 *
 * Uses node:test so it runs under `npx tsx --test` alongside every other
 * Wave test file. The suite spins up a temp project root (via
 * MAESTRO_PROJECT_ROOT), primes a member record + activity.jsonl fixture,
 * then calls buildTeamSegment.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { buildTeamSegment } from '../statusline.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SELF_UID = 'alice';
const SELF_HOST = 'alice-box';
const SESSION_ID = 'test-session-team-status';

let tmpDir: string;
let prevRoot: string | undefined;
let prevCwd: string;

function cachePath(session: string = SESSION_ID): string {
  const projectRoot = resolve(process.env.MAESTRO_PROJECT_ROOT || process.cwd());
  const rootFence = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16);
  return join(tmpdir(), `maestro-team-statusline-${rootFence}-${session}.json`);
}

function clearCache(session: string = SESSION_ID): void {
  const p = cachePath(session);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'statusline-team-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;

  prevCwd = process.cwd();
  // Minimal local git repo so resolveSelf() can read git identity.
  execSync('git init -q', { cwd: tmpDir });
  execSync('git config user.name "Alice"', { cwd: tmpDir });
  execSync('git config user.email "alice@example.com"', { cwd: tmpDir });
  process.chdir(tmpDir);

  clearCache();
}

function teardown(): void {
  clearCache();
  try {
    process.chdir(prevCwd);
  } catch {
    /* ignore */
  }
  if (prevRoot === undefined) {
    delete process.env.MAESTRO_PROJECT_ROOT;
  } else {
    process.env.MAESTRO_PROJECT_ROOT = prevRoot;
  }
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeSelfMember(): void {
  const dir = join(tmpDir, '.workflow', 'collab', 'members');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SELF_UID}.json`),
    JSON.stringify({
      uid: SELF_UID,
      name: 'Alice',
      email: 'alice@example.com',
      host: SELF_HOST,
      role: 'admin',
      joinedAt: '2026-04-11T10:00:00.000Z',
    }),
    'utf-8',
  );
}

interface ActivityFixture {
  ts?: string;
  user: string;
  host?: string;
  action: string;
  phase_id?: number;
  task_id?: string;
  target?: string;
}

function writeActivity(events: ActivityFixture[]): void {
  const dir = join(tmpDir, '.workflow', 'collab');
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const lines = events.map((e, i) => {
    const rec = {
      ts: e.ts ?? new Date(now - (events.length - i) * 1000).toISOString(),
      user: e.user,
      host: e.host ?? `${e.user}-box`,
      action: e.action,
      ...(e.phase_id !== undefined ? { phase_id: e.phase_id } : {}),
      ...(e.task_id !== undefined ? { task_id: e.task_id } : {}),
      ...(e.target !== undefined ? { target: e.target } : {}),
    };
    return JSON.stringify(rec);
  });
  writeFileSync(join(dir, 'activity.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTeamSegment', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns empty string when team mode is not enabled (no self record)', () => {
    // No member file written -> resolveSelf() returns null.
    writeActivity([{ user: 'bob', action: 'Read', phase_id: 3 }]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '');
  });

  it('returns empty string when self exists but there is no teammate activity', () => {
    writeSelfMember();
    // No activity.jsonl at all.
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '');
  });

  it('returns empty string when only self events exist (self filtered out)', () => {
    writeSelfMember();
    writeActivity([
      { user: SELF_UID, host: SELF_HOST, action: 'Read', phase_id: 3 },
      { user: SELF_UID, host: SELF_HOST, action: 'Edit', phase_id: 3 },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '');
  });

  it('renders one teammate with phase_id + task_id as "name (P{phase}/{short})"', () => {
    writeSelfMember();
    writeActivity([
      { user: 'bob', action: 'Edit', phase_id: 3, task_id: 'TASK-001' },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3/001)');
  });

  it('renders one teammate with phase_id only as "name (P{phase})"', () => {
    writeSelfMember();
    writeActivity([{ user: 'bob', action: 'Read', phase_id: 3 }]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3)');
  });

  it('renders one teammate with target only as "name ({target})"', () => {
    writeSelfMember();
    writeActivity([{ user: 'bob', action: 'team.join', target: 'spec-auth' }]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (spec-auth)');
  });

  it('renders a teammate with neither phase_id nor target as bare name', () => {
    writeSelfMember();
    writeActivity([{ user: 'bob', action: 'Read' }]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob');
  });

  it('renders multiple teammates separated by " | "', () => {
    writeSelfMember();
    writeActivity([
      { user: 'bob', action: 'Read', phase_id: 3 },
      { user: 'carol', action: 'team.join', target: 'spec-auth' },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    // carol is newer (later index -> later ts) so appears first.
    assert.strictEqual(result, '\u{1F465} carol (spec-auth) | bob (P3)');
  });

  it('collapses more than 3 teammates with " +N"', () => {
    writeSelfMember();
    // 5 distinct teammates; writeActivity assigns increasing timestamps.
    writeActivity([
      { user: 'dave', action: 'Read', phase_id: 1 },
      { user: 'eve', action: 'Read', phase_id: 2 },
      { user: 'frank', action: 'Read', phase_id: 3 },
      { user: 'grace', action: 'Read', phase_id: 4 },
      { user: 'heidi', action: 'Read', phase_id: 5 },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    // Newest-first ordering: heidi, grace, frank inline; dave+eve collapsed.
    assert.strictEqual(result, '\u{1F465} heidi (P5) | grace (P4) | frank (P3) +2');
  });

  it('uses the most recent event per teammate', () => {
    writeSelfMember();
    writeActivity([
      { user: 'bob', action: 'Read', phase_id: 2 },
      { user: 'bob', action: 'Edit', phase_id: 5, task_id: 'TASK-042' },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P5/042)');
  });

  it('cache hit within 10s returns cached value even if underlying data changes', () => {
    writeSelfMember();
    writeActivity([{ user: 'bob', action: 'Read', phase_id: 3 }]);
    const first = buildTeamSegment(SESSION_ID);
    assert.strictEqual(first, '\u{1F465} bob (P3)');

    // Mutate activity: add a new teammate. Cache should ignore this.
    writeActivity([
      { user: 'bob', action: 'Read', phase_id: 3 },
      { user: 'carol', action: 'Read', phase_id: 7 },
    ]);
    const second = buildTeamSegment(SESSION_ID);
    assert.strictEqual(second, first);
  });

  it('stale cache (> 10s old) is bypassed and recomputed', () => {
    writeSelfMember();
    // Seed a stale cache file with an obviously-wrong payload.
    writeFileSync(
      cachePath(),
      JSON.stringify({ ts: Date.now() - 60_000, segment: 'STALE' }),
    );
    writeActivity([{ user: 'bob', action: 'Read', phase_id: 3 }]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3)');
    // And the cache was overwritten with the fresh value.
    const written = JSON.parse(readFileSync(cachePath(), 'utf-8')) as {
      segment: string;
    };
    assert.strictEqual(written.segment, '\u{1F465} bob (P3)');
  });

  it('swallows corrupt cache file and recomputes', () => {
    writeSelfMember();
    writeActivity([{ user: 'bob', action: 'Read', phase_id: 3 }]);
    // Corrupt cache: not JSON.
    writeFileSync(cachePath(), '{not valid json', 'utf-8');
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3)');
  });

  it('never throws when MAESTRO_PROJECT_ROOT points at a missing path', () => {
    process.env.MAESTRO_PROJECT_ROOT = join(tmpDir, 'does-not-exist');
    // Should swallow everything and return empty string.
    assert.doesNotThrow(() => buildTeamSegment(SESSION_ID));
    assert.strictEqual(buildTeamSegment(SESSION_ID), '');
  });

  it('collapses task ids with no hyphen to the id itself', () => {
    writeSelfMember();
    writeActivity([
      { user: 'bob', action: 'Edit', phase_id: 3, task_id: 'plain' },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3/plain)');
  });

  it('collapses multi-segment task ids to the last segment', () => {
    writeSelfMember();
    writeActivity([
      { user: 'bob', action: 'Edit', phase_id: 3, task_id: 'WFS-auth-refactor' },
    ]);
    const result = buildTeamSegment(SESSION_ID);
    assert.strictEqual(result, '\u{1F465} bob (P3/refactor)');
  });
});
