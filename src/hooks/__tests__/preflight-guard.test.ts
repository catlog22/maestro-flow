import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { evaluatePreflightGuard, loadPreflightConfig } from '../guards/preflight-guard.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let prevRoot: string | undefined;

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'preflight-guard-test-'));
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

function writeConfig(collab: Record<string, unknown>): void {
  const wfDir = join(tmpDir, '.workflow');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, 'config.json'), JSON.stringify({ collab }), 'utf-8');
}

function writeState(phase: number): void {
  const wfDir = join(tmpDir, '.workflow');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, 'state.json'), JSON.stringify({ current_phase: phase }), 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preflight-guard', () => {
  describe('loadPreflightConfig', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns defaults when no config file exists', () => {
      const cfg = loadPreflightConfig(tmpDir);
      expect(cfg.mode).toBe('warn');
      expect(cfg.windowMin).toBe(30);
      expect(cfg.enabled).toBe(true);
    });

    it('reads mode from config.json collab section', () => {
      writeConfig({ preflight_mode: 'block', preflight_window_min: 15 });
      const cfg = loadPreflightConfig(tmpDir);
      expect(cfg.mode).toBe('block');
      expect(cfg.windowMin).toBe(15);
    });

    it('defaults to warn for invalid mode', () => {
      writeConfig({ preflight_mode: 'invalid' });
      const cfg = loadPreflightConfig(tmpDir);
      expect(cfg.mode).toBe('warn');
    });

    it('respects auto_preflight: false', () => {
      writeConfig({ auto_preflight: false });
      const cfg = loadPreflightConfig(tmpDir);
      expect(cfg.enabled).toBe(false);
    });
  });

  describe('evaluatePreflightGuard', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('returns not blocked when disabled', () => {
      const result = evaluatePreflightGuard(tmpDir, { enabled: false });
      expect(result.blocked).toBe(false);
      expect(result.conflictCount).toBe(0);
    });

    it('returns not blocked when no team mode (no member)', () => {
      // No member files → resolveSelf returns null
      const result = evaluatePreflightGuard(tmpDir);
      expect(result.blocked).toBe(false);
      expect(result.conflictCount).toBe(0);
    });

    it('returns not blocked when no state.json', () => {
      // No state.json → can't determine current phase
      const result = evaluatePreflightGuard(tmpDir);
      expect(result.blocked).toBe(false);
    });
  });
});
