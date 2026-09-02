import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
//
// These tests isolate the project root via MAESTRO_PROJECT_ROOT so that
// getProjectRoot() from path-validator points at a fresh tmp dir per test.
// The module is re-imported inside each test via dynamic import AFTER the
// env var is set; dynamic import with a cache-busting query string gives us
// a clean module cache between tests so the constants resolved inside the
// module (if any) are picked up fresh each time.
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'team-members-test-'));
  prevRoot = process.env.MAESTRO_PROJECT_ROOT;
  process.env.MAESTRO_PROJECT_ROOT = tmpDir;

  // Initialize a minimal git repo so `git config user.name/email` writes
  // to a local config and leaves the user's global config untouched.
  execSync('git init -q', { cwd: tmpDir });
  // Default identity; individual tests can override.
  execSync('git config user.name "Alice"', { cwd: tmpDir });
  execSync('git config user.email "alice@example.com"', { cwd: tmpDir });
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

// git config is read via `execSync('git config ...')` without --cwd. We make
// the tmp dir the process cwd for the duration of each test so that local
// config is picked up.
let prevCwd: string;
function cdTmp(): void {
  prevCwd = process.cwd();
  process.chdir(tmpDir);
}
function cdBack(): void {
  process.chdir(prevCwd);
}

// ---------------------------------------------------------------------------
// Module loader (cache-busted per test so internal state is fresh)
// ---------------------------------------------------------------------------

async function loadModule() {
  // 查询串动态 import 在 vitest/vite 下触发 "Unknown variable dynamic import"，改用 vi.resetModules()
  vi.resetModules();
  const mod = await import('../team-members.js');
  return mod as typeof import('../team-members.js');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('team-members', () => {
  describe('deriveUid', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('takes the lowercased local-part of an email', async () => {
      const { deriveUid } = await loadModule();
      assert.strictEqual(deriveUid('Alice@Example.COM'), 'alice');
      assert.strictEqual(deriveUid('bob+tag@example.com'), 'bob+tag');
      assert.strictEqual(deriveUid('Carol'), 'carol');
    });
  });

  describe('listMembers', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns empty array when members dir missing', async () => {
      const { listMembers, getMembersDir } = await loadModule();
      assert.strictEqual(existsSync(getMembersDir()), false);
      assert.deepStrictEqual(listMembers(), []);
    });

    it('skips malformed files', async () => {
      const { listMembers, getMembersDir } = await loadModule();
      const dir = getMembersDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'broken.json'), 'not-json', 'utf-8');
      writeFileSync(
        join(dir, 'alice.json'),
        JSON.stringify({
          uid: 'alice',
          name: 'Alice',
          email: 'alice@example.com',
          host: 'host1',
          role: 'admin',
          joinedAt: '2026-04-11T10:00:00.000Z',
        }),
        'utf-8',
      );
      const rows = listMembers();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].uid, 'alice');
    });
  });

  describe('getMemberByUid', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns null for unknown uid', async () => {
      const { getMemberByUid } = await loadModule();
      assert.strictEqual(getMemberByUid('nobody'), null);
    });
  });

  describe('joinTeam', () => {
    beforeEach(() => {
      setup();
      cdTmp();
    });
    afterEach(() => {
      cdBack();
      teardown();
    });

    it('creates members/{uid}.json with correct shape', async () => {
      const { joinTeam, getMembersDir } = await loadModule();
      const rec = joinTeam();
      assert.strictEqual(rec.uid, 'alice');
      assert.strictEqual(rec.name, 'Alice');
      assert.strictEqual(rec.email, 'alice@example.com');
      assert.strictEqual(rec.role, 'admin'); // first joiner -> admin
      assert.ok(typeof rec.host === 'string' && rec.host.length > 0);
      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(rec.joinedAt));

      const filePath = join(getMembersDir(), 'alice.json');
      assert.strictEqual(existsSync(filePath), true);
      const onDisk = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.strictEqual(onDisk.uid, 'alice');
      assert.strictEqual(onDisk.role, 'admin');
    });

    it('is idempotent: second call returns same record and does not overwrite joinedAt', async () => {
      const { joinTeam } = await loadModule();
      const first = joinTeam();
      // Small sleep to ensure timestamps would differ if overwritten.
      const before = first.joinedAt;
      const second = joinTeam();
      assert.strictEqual(second.uid, first.uid);
      assert.strictEqual(second.joinedAt, before);
      assert.strictEqual(second.role, first.role);
    });

    it('uid collision: different email with same local-part gets -2 suffix', async () => {
      const { joinTeam, listMembers, getMembersDir } = await loadModule();

      // First member joins with alice@example.com
      const first = joinTeam();
      assert.strictEqual(first.uid, 'alice');

      // Switch git identity to a different email that still yields "alice".
      execSync('git config user.name "Alice Two"', { cwd: tmpDir });
      execSync('git config user.email "alice@other.org"', { cwd: tmpDir });

      const second = joinTeam();
      assert.strictEqual(second.uid, 'alice-2');
      assert.strictEqual(second.email, 'alice@other.org');
      // Second member should NOT be admin (first came before).
      assert.strictEqual(second.role, 'member');

      const members = listMembers();
      assert.strictEqual(members.length, 2);
      assert.strictEqual(existsSync(join(getMembersDir(), 'alice.json')), true);
      assert.strictEqual(existsSync(join(getMembersDir(), 'alice-2.json')), true);
    });

    it('throws when git identity is missing', async () => {
      // Build an isolated git environment with no system/global config so
      // that `git config user.name` returns empty. We override HOME and
      // XDG_CONFIG_HOME to a scratch dir for the child process and also
      // set GIT_CONFIG_NOSYSTEM=1 to ignore /etc/gitconfig.
      const subTmp = mkdtempSync(join(tmpdir(), 'team-members-noid-'));
      const fakeHome = join(subTmp, 'home');
      mkdirSync(fakeHome, { recursive: true });
      try {
        execSync('git init -q', { cwd: subTmp });

        const prevEnv = {
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
          GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
          GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
          MAESTRO_PROJECT_ROOT: process.env.MAESTRO_PROJECT_ROOT,
        };
        const oldCwd = process.cwd();

        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;
        process.env.XDG_CONFIG_HOME = fakeHome;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        // Point global config at an empty file that definitely exists.
        const emptyGlobalCfg = join(fakeHome, 'empty-gitconfig');
        writeFileSync(emptyGlobalCfg, '', 'utf-8');
        process.env.GIT_CONFIG_GLOBAL = emptyGlobalCfg;
        process.env.MAESTRO_PROJECT_ROOT = subTmp;
        process.chdir(subTmp);

        try {
          const { joinTeam } = await loadModule();
          assert.throws(() => joinTeam(), /Git identity not configured/);
        } finally {
          process.chdir(oldCwd);
          for (const [k, v] of Object.entries(prevEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        }
      } finally {
        rmSync(subTmp, { recursive: true, force: true });
      }
    });
  });

  describe('requireTeamMode', () => {
    beforeEach(() => {
      setup();
      cdTmp();
    });
    afterEach(() => {
      cdBack();
      teardown();
    });

    it('returns MemberRecord when team mode is active', async () => {
      const { joinTeam, requireTeamMode } = await loadModule();
      joinTeam();
      const self = requireTeamMode();
      assert.strictEqual(self.uid, 'alice');
      assert.strictEqual(self.role, 'admin');
    });

    it('throws when team mode is not active', async () => {
      const { requireTeamMode } = await loadModule();
      assert.throws(() => requireTeamMode(), /Team mode not enabled/);
    });
  });

  describe('requireRole', () => {
    beforeEach(() => {
      setup();
      cdTmp();
    });
    afterEach(() => {
      cdBack();
      teardown();
    });

    it('returns MemberRecord when role matches (admin)', async () => {
      const { joinTeam, requireRole } = await loadModule();
      joinTeam({ role: 'admin' });
      const self = requireRole('admin');
      assert.strictEqual(self.uid, 'alice');
      assert.strictEqual(self.role, 'admin');
    });

    it('returns MemberRecord when role matches (member)', async () => {
      const { joinTeam, requireRole } = await loadModule();
      joinTeam({ role: 'member' });
      const self = requireRole('member');
      assert.strictEqual(self.uid, 'alice');
      assert.strictEqual(self.role, 'member');
    });

    it('throws descriptive error when member tries admin operation', async () => {
      const { joinTeam, requireRole } = await loadModule();
      joinTeam({ role: 'member' });
      assert.throws(
        () => requireRole('admin'),
        /This operation requires admin role\. Your role: member/,
      );
    });

    it('throws descriptive error when admin tries member-only operation', async () => {
      const { joinTeam, requireRole } = await loadModule();
      joinTeam({ role: 'admin' });
      assert.throws(
        () => requireRole('member'),
        /This operation requires member role\. Your role: admin/,
      );
    });

    it('throws when team mode is not active', async () => {
      const { requireRole } = await loadModule();
      assert.throws(() => requireRole('admin'), /Team mode not enabled/);
    });
  });
});
