import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Fixture helpers
//
// Team monitor is a pure function driven by the `.workflow/collab/` tree
// rooted at MAESTRO_PROJECT_ROOT. We spin up a per-test tmp dir, initialize
// a git repo with a known identity, and pre-write a members/{uid}.json so
// `resolveSelf()` returns a record.
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;
let prevCwd: string;

const SESSION_ID = 'test-session-team-mon';

function dedupeTmpPath(sessionId: string = SESSION_ID): string {
  return join(tmpdir(), `maestro-team-dedupe-${sessionId}.json`);
}

function clearDedupe(): void {
  const p = dedupeTmpPath();
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'team-monitor-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;

  prevCwd = process.cwd();
  // Initialize a minimal local git repo with a known identity.
  execSync('git init -q', { cwd: tmpDir });
  execSync('git config user.name "Alice"', { cwd: tmpDir });
  execSync('git config user.email "alice@example.com"', { cwd: tmpDir });
  process.chdir(tmpDir);

  clearDedupe();
}

function teardown(): void {
  clearDedupe();
  try { process.chdir(prevCwd); } catch { /* ignore */ }
  if (prevRoot === undefined) {
    delete process.env.MAESTRO_PROJECT_ROOT;
  } else {
    process.env.MAESTRO_PROJECT_ROOT = prevRoot;
  }
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeMember(): void {
  const dir = join(tmpDir, '.workflow', 'collab', 'members');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'alice.json'),
    JSON.stringify({
      uid: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      host: hostname(),
      role: 'admin',
      joinedAt: '2026-04-11T10:00:00.000Z',
    }),
    'utf-8',
  );
}

function writeState(current_phase?: number, current_task_id?: string): void {
  const dir = join(tmpDir, '.workflow');
  mkdirSync(dir, { recursive: true });
  const obj: Record<string, unknown> = {};
  if (current_phase !== undefined) obj.current_phase = current_phase;
  if (current_task_id !== undefined) obj.current_task_id = current_task_id;
  writeFileSync(join(dir, 'state.json'), JSON.stringify(obj), 'utf-8');
}

async function loadModule() {
  // 查询串动态 import（?t=...）在 vitest/vite 下会触发 "Unknown variable dynamic import"；
  // vi.resetModules() 是标准的模块缓存绕过方式
  vi.resetModules();
  const mod = await import('../team-monitor.js');
  return mod as typeof import('../team-monitor.js');
}

function readActivityLines(): Record<string, unknown>[] {
  const p = join(tmpDir, '.workflow', 'collab', 'activity.jsonl');
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, 'utf-8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team-monitor', () => {
  describe('runTeamMonitor', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('is silent when team mode is not enabled (no member record)', async () => {
      const { runTeamMonitor } = await loadModule();
      // No writeMember() call — members dir empty -> resolveSelf returns null.
      runTeamMonitor({
        session_id: SESSION_ID,
        tool_name: 'Read',
      });
      const lines = readActivityLines();
      assert.strictEqual(lines.length, 0);
    });

    it('reports an activity event when self exists', async () => {
      writeMember();
      writeState(3, 'TASK-001');
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({
        session_id: SESSION_ID,
        tool_name: 'Read',
      });

      const lines = readActivityLines();
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].user, 'alice');
      assert.strictEqual(lines[0].host, hostname());
      assert.strictEqual(lines[0].action, 'Read');
      assert.strictEqual(lines[0].phase_id, 3);
      assert.strictEqual(lines[0].task_id, 'TASK-001');
      assert.ok(typeof lines[0].ts === 'string');
    });

    it('uses "unknown" action when tool_name is absent', async () => {
      writeMember();
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({ session_id: SESSION_ID });

      const lines = readActivityLines();
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].action, 'unknown');
    });

    it('dedupe: two identical calls within 60s -> only first writes', async () => {
      writeMember();
      writeState(3);
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Read' });
      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Read' });

      const lines = readActivityLines();
      assert.strictEqual(lines.length, 1);
    });

    it('dedupe: different phase_id -> second call DOES write', async () => {
      writeMember();
      writeState(3);
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Read' });

      // Switch phase and fire again -- same action, different phase.
      writeState(4);
      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Read' });

      const lines = readActivityLines();
      assert.strictEqual(lines.length, 2);
      assert.strictEqual(lines[0].phase_id, 3);
      assert.strictEqual(lines[1].phase_id, 4);
    });

    it('dedupe: different action -> second call DOES write', async () => {
      writeMember();
      writeState(3);
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Read' });
      runTeamMonitor({ session_id: SESSION_ID, tool_name: 'Edit' });

      const lines = readActivityLines();
      assert.strictEqual(lines.length, 2);
      assert.strictEqual(lines[0].action, 'Read');
      assert.strictEqual(lines[1].action, 'Edit');
    });

    it('missing session_id still reports (dedupe disabled)', async () => {
      writeMember();
      const { runTeamMonitor } = await loadModule();

      runTeamMonitor({ tool_name: 'Read' });
      runTeamMonitor({ tool_name: 'Read' });

      const lines = readActivityLines();
      // No session_id -> no dedupe state persisted -> both write.
      assert.strictEqual(lines.length, 2);
    });

    it('never throws on empty input', async () => {
      writeMember();
      const { runTeamMonitor } = await loadModule();
      assert.doesNotThrow(() => runTeamMonitor({} as never));
    });

    it('never throws on malformed input shape', async () => {
      writeMember();
      const { runTeamMonitor } = await loadModule();
      // Pass junk fields; runTeamMonitor should silently ignore.
      assert.doesNotThrow(() =>
        runTeamMonitor({
          session_id: SESSION_ID,
          tool_name: 42 as unknown as string,
          tool_input: 'not-an-object' as unknown as Record<string, unknown>,
        }),
      );
      // With a non-string tool_name, action falls back to "unknown".
      const lines = readActivityLines();
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0].action, 'unknown');
    });
  });
});
