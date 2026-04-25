import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateContext } from '../context-monitor.js';
import { BRIDGE_PREFIX, COORD_BRIDGE_PREFIX } from '../constants.js';
import { writeCoordBridge, type CoordBridgeData } from '../coordinator-tracker.js';

const sessionId = `test-ctx-auto-${Date.now()}`;
const TEST_DIR = join(tmpdir(), `maestro-test-ctxmon-${Date.now()}`);

function cleanup(): void {
  for (const prefix of [BRIDGE_PREFIX, `${BRIDGE_PREFIX}${sessionId}-warned`]) {
    const p = join(tmpdir(), `${prefix}.json`);
    if (existsSync(p)) rmSync(p);
  }
  const metricsPath = join(tmpdir(), `${BRIDGE_PREFIX}${sessionId}.json`);
  if (existsSync(metricsPath)) rmSync(metricsPath);
  const warnPath = join(tmpdir(), `${BRIDGE_PREFIX}${sessionId}-warned.json`);
  if (existsSync(warnPath)) rmSync(warnPath);
  const bridgePath = join(tmpdir(), `${COORD_BRIDGE_PREFIX}${sessionId}.json`);
  if (existsSync(bridgePath)) rmSync(bridgePath);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeMetrics(remaining: number, usedPct: number): void {
  writeFileSync(
    join(tmpdir(), `${BRIDGE_PREFIX}${sessionId}.json`),
    JSON.stringify({
      session_id: sessionId,
      remaining_percentage: remaining,
      used_pct: usedPct,
      timestamp: Math.floor(Date.now() / 1000),
    }),
  );
}

function writeAutoModeBridge(): void {
  const data: CoordBridgeData = {
    session_id: sessionId,
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
    auto_mode: true,
    updated_at: Date.now(),
  };
  writeCoordBridge(sessionId, data);
}

describe('context-monitor auto mode', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('uses soft message for CRITICAL in auto mode', () => {
    writeMetrics(20, 80);
    writeAutoModeBridge();

    const result = evaluateContext({ session_id: sessionId });
    assert.ok(result);
    const msg = result.hookSpecificOutput.additionalContext;

    // Auto mode: should NOT tell model to stop or inform user
    assert.ok(!msg.includes('Do NOT start new complex work'), 'should not block work');
    assert.ok(!msg.includes('Inform the user'), 'should not demand user interaction');

    // Auto mode: should instruct to finish and resume
    assert.ok(msg.includes('Finish current chain step'), 'should instruct to finish step');
    assert.ok(msg.includes('/maestro -c'), 'should mention resume');
    assert.ok(msg.includes('CRITICAL'), 'should still indicate severity');
  });

  it('uses soft message for WARNING in auto mode', () => {
    writeMetrics(30, 70);
    writeAutoModeBridge();

    const result = evaluateContext({ session_id: sessionId });
    assert.ok(result);
    const msg = result.hookSpecificOutput.additionalContext;

    assert.ok(!msg.includes('Avoid starting new complex work'), 'should not block');
    assert.ok(msg.includes('Finish current'), 'should instruct to finish');
    assert.ok(msg.includes('WARNING'), 'should still indicate severity');
  });

  it('uses standard CRITICAL message when not in auto mode', () => {
    writeMetrics(20, 80);
    // No auto mode bridge

    const result = evaluateContext({ session_id: sessionId });
    assert.ok(result);
    const msg = result.hookSpecificOutput.additionalContext;

    // Standard mode: should have strong stop language
    assert.ok(
      msg.includes('Do NOT start new complex work') || msg.includes('Inform the user'),
      'should have standard stop language',
    );
    assert.ok(!msg.includes('Finish current chain step'), 'should not have auto mode language');
  });

  it('returns null when context is healthy (above threshold)', () => {
    writeMetrics(50, 50);
    writeAutoModeBridge();

    const result = evaluateContext({ session_id: sessionId });
    assert.strictEqual(result, null);
  });
});
