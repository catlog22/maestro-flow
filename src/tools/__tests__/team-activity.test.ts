import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'team-activity-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;
}

function teardown(): void {
  if (prevRoot === undefined) {
    delete process.env.MAESTRO_PROJECT_ROOT;
  } else {
    process.env.MAESTRO_PROJECT_ROOT = prevRoot;
  }
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function loadModule() {
  // 查询串动态 import 在 vitest/vite 下触发 "Unknown variable dynamic import"，改用 vi.resetModules()
  vi.resetModules();
  const mod = await import('../team-activity.js');
  return mod as typeof import('../team-activity.js');
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team-activity', () => {
  describe('reportActivity + readRecentActivity', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('round-trips an event through the log', async () => {
      const { reportActivity, readRecentActivity, getActivityLogPath } =
        await loadModule();

      reportActivity({
        user: 'alice',
        host: 'alice-laptop',
        action: 'maestro-execute',
        phase_id: 3,
        task_id: 'TASK-001',
      });

      assert.strictEqual(existsSync(getActivityLogPath()), true);
      const events = readRecentActivity(30);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].user, 'alice');
      assert.strictEqual(events[0].action, 'maestro-execute');
      assert.strictEqual(events[0].phase_id, 3);
      assert.strictEqual(events[0].task_id, 'TASK-001');
      assert.ok(typeof events[0].ts === 'string' && events[0].ts.length > 0);
    });

    it('returns empty array when log does not exist', async () => {
      const { readRecentActivity } = await loadModule();
      assert.deepStrictEqual(readRecentActivity(30), []);
    });

    it('clock tolerance: includes event from 34 min ago when window=30', async () => {
      const { reportActivity, readRecentActivity } = await loadModule();

      // 34 min old: inside window (30) + tolerance (5) = 35 min.
      reportActivity({
        user: 'alice',
        host: 'h',
        action: 'old-action',
        ts: isoMinutesAgo(34),
      });

      const events = readRecentActivity(30);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].action, 'old-action');
    });

    it('clock tolerance: excludes event from 36 min ago when window=30', async () => {
      const { reportActivity, readRecentActivity } = await loadModule();

      // 36 min old: outside window (30) + tolerance (5) = 35 min.
      reportActivity({
        user: 'alice',
        host: 'h',
        action: 'too-old',
        ts: isoMinutesAgo(36),
      });
      // Add a fresh event so we know the file was parsed.
      reportActivity({
        user: 'alice',
        host: 'h',
        action: 'fresh',
      });

      const events = readRecentActivity(30);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].action, 'fresh');
    });
  });

  describe('readWorkflowContext', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns phase_id from state.json when present', async () => {
      const { readWorkflowContext } = await loadModule();
      const stateDir = join(tmpDir, '.workflow');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, 'state.json'),
        JSON.stringify({ current_phase: 3, current_task_id: 'TASK-001' }),
        'utf-8',
      );

      const ctx = readWorkflowContext();
      assert.strictEqual(ctx.phase_id, 3);
      assert.strictEqual(ctx.task_id, 'TASK-001');
    });

    it('returns empty object when state.json missing', async () => {
      const { readWorkflowContext } = await loadModule();
      assert.deepStrictEqual(readWorkflowContext(), {});
    });

    it('returns empty object when state.json is malformed', async () => {
      const { readWorkflowContext } = await loadModule();
      const stateDir = join(tmpDir, '.workflow');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, 'state.json'), 'not-json', 'utf-8');
      assert.deepStrictEqual(readWorkflowContext(), {});
    });

    it('returns only phase_id when task_id missing', async () => {
      const { readWorkflowContext } = await loadModule();
      const stateDir = join(tmpDir, '.workflow');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, 'state.json'),
        JSON.stringify({ current_phase: 2 }),
        'utf-8',
      );
      const ctx = readWorkflowContext();
      assert.strictEqual(ctx.phase_id, 2);
      assert.strictEqual(ctx.task_id, undefined);
    });
  });

  describe('rotateIfNeeded', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns null for a small file below threshold', async () => {
      const { reportActivity, rotateIfNeeded } = await loadModule();
      reportActivity({ user: 'alice', host: 'h', action: 'tiny' });
      // Default is 10 MB; file is ~100 bytes.
      assert.strictEqual(rotateIfNeeded(), null);
    });

    it('returns null when log does not exist', async () => {
      const { rotateIfNeeded } = await loadModule();
      assert.strictEqual(rotateIfNeeded(), null);
    });

    it('rotates when file exceeds the requested threshold', async () => {
      const { reportActivity, rotateIfNeeded, getActivityLogPath, getArchiveDir } =
        await loadModule();
      // Write a few events, then rotate with a tiny threshold.
      for (let i = 0; i < 20; i++) {
        reportActivity({ user: 'alice', host: 'h', action: `act-${i}` });
      }
      const archivePath = rotateIfNeeded(1);
      assert.notStrictEqual(archivePath, null);
      assert.strictEqual(existsSync(getActivityLogPath()), false);
      assert.strictEqual(existsSync(archivePath!), true);
      assert.ok(archivePath!.startsWith(getArchiveDir()));
    });
  });
});
