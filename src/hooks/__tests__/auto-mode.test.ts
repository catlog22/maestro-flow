import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isAutoMode } from '../auto-mode.js';
import { writeCoordBridge, type CoordBridgeData } from '../coordinator-tracker.js';
import { COORD_BRIDGE_PREFIX } from '../constants.js';

const TEST_DIR = join(tmpdir(), `maestro-test-automode-${Date.now()}`);

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function makeBridge(overrides?: Partial<CoordBridgeData>): CoordBridgeData {
  return {
    session_id: '',
    coordinator: 'maestro',
    chain_name: 'full-lifecycle',
    intent: 'test',
    phase: 1,
    steps_total: 4,
    steps_completed: 2,
    current_step: null,
    next_step: null,
    remaining_steps: [],
    status: 'running',
    updated_at: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bridge path detection (fast path)
// ---------------------------------------------------------------------------

describe('isAutoMode — bridge file', () => {
  const sessionId = `test-auto-bridge-${Date.now()}`;

  afterEach(() => {
    const bridgePath = join(tmpdir(), `${COORD_BRIDGE_PREFIX}${sessionId}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });

  it('returns true when bridge has auto_mode: true', () => {
    writeCoordBridge(sessionId, makeBridge({ auto_mode: true }));
    assert.strictEqual(isAutoMode({ session_id: sessionId }), true);
  });

  it('returns false when bridge has auto_mode: false', () => {
    writeCoordBridge(sessionId, makeBridge({ auto_mode: false }));
    assert.strictEqual(isAutoMode({ session_id: sessionId }), false);
  });

  it('returns false when bridge has no auto_mode', () => {
    writeCoordBridge(sessionId, makeBridge());
    assert.strictEqual(isAutoMode({ session_id: sessionId }), false);
  });

  it('returns false when no bridge exists', () => {
    assert.strictEqual(isAutoMode({ session_id: 'nonexistent-session' }), false);
  });
});

// ---------------------------------------------------------------------------
// status.json fallback (first-turn detection)
// ---------------------------------------------------------------------------

describe('isAutoMode — status.json fallback', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  function writeWorkspaceState(autoMode: boolean): void {
    // Need valid state.json for workspace detection
    const workflowDir = join(TEST_DIR, '.workflow');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'state.json'), JSON.stringify({
      version: '2.0',
      artifacts: [],
      current_milestone: 'M1',
      status: 'active',
    }));

    // Write maestro session status.json
    const sessionDir = join(workflowDir, '.maestro', 'session-test');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
      session_id: 'session-test',
      chain_name: 'full-lifecycle',
      intent: 'test',
      auto_mode: autoMode,
      steps: [{ index: 0, skill: 'analyze', status: 'running' }],
      current_step: 0,
      status: 'running',
    }));
  }

  it('detects auto_mode from status.json when no bridge exists', () => {
    writeWorkspaceState(true);
    assert.strictEqual(isAutoMode({ cwd: TEST_DIR }), true);
  });

  it('returns false when status.json has auto_mode: false', () => {
    writeWorkspaceState(false);
    assert.strictEqual(isAutoMode({ cwd: TEST_DIR }), false);
  });

  it('returns false when no workspace exists', () => {
    assert.strictEqual(isAutoMode({ cwd: TEST_DIR }), false);
  });
});
