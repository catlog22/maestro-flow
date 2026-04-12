import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readMaestroSession,
  parseCoordinateOutput,
  readWalkerState,
  resolveNextNode,
  readLatestSession,
  writeCoordBridge,
  readCoordBridge,
  buildNextStepHint,
  type CoordBridgeData,
} from '../coordinator-tracker.js';

const TEST_DIR = join(tmpdir(), `maestro-test-coord-${Date.now()}`);

function cleanup(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// readMaestroSession
// ---------------------------------------------------------------------------

describe('readMaestroSession', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('parses valid status.json', () => {
    const sessionDir = join(TEST_DIR, '.workflow', '.maestro', 'session-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({
      session_id: 'session-1',
      chain_name: 'full-lifecycle',
      intent: 'build API',
      phase: 2,
      steps: [
        { index: 0, skill: 'maestro-analyze', args: '2', status: 'completed' },
        { index: 1, skill: 'maestro-plan', args: '2', status: 'completed' },
        { index: 2, skill: 'maestro-execute', args: '2', status: 'running' },
        { index: 3, skill: 'maestro-verify', args: '2', status: 'pending' },
      ],
      current_step: 2,
      status: 'running',
    }));

    const result = readMaestroSession(TEST_DIR);
    assert.ok(result);
    assert.strictEqual(result.chain_name, 'full-lifecycle');
    assert.strictEqual(result.intent, 'build API');
    assert.strictEqual(result.phase, 2);
    assert.strictEqual(result.steps_total, 4);
    assert.strictEqual(result.steps_completed, 2);
    assert.strictEqual(result.current_step?.skill, 'maestro-execute');
    assert.strictEqual(result.next_step?.skill, 'maestro-verify');
    assert.strictEqual(result.status, 'running');
  });

  it('returns null when .maestro dir missing', () => {
    assert.strictEqual(readMaestroSession(TEST_DIR), null);
  });

  it('returns null when no status.json exists', () => {
    mkdirSync(join(TEST_DIR, '.workflow', '.maestro', 'empty'), { recursive: true });
    assert.strictEqual(readMaestroSession(TEST_DIR), null);
  });
});

// ---------------------------------------------------------------------------
// parseCoordinateOutput
// ---------------------------------------------------------------------------

describe('parseCoordinateOutput', () => {
  it('parses valid coordinate CLI JSON', () => {
    const output = JSON.stringify({
      session_id: 'coord-1744668285953-d428',
      status: 'step_paused',
      graph_id: 'full-lifecycle',
      current_node: 'maestro-verify',
      steps_completed: 3,
      steps_failed: 0,
      history: [
        { node_id: 'maestro-analyze', outcome: 'success' },
        { node_id: 'maestro-plan', outcome: 'success' },
      ],
    });

    const result = parseCoordinateOutput(output);
    assert.ok(result);
    assert.strictEqual(result.session_id, 'coord-1744668285953-d428');
    assert.strictEqual(result.status, 'step_paused');
    assert.strictEqual(result.graph_id, 'full-lifecycle');
    assert.strictEqual(result.steps_completed, 3);
  });

  it('returns null for non-coordinate output', () => {
    assert.strictEqual(parseCoordinateOutput('just some text'), null);
    assert.strictEqual(parseCoordinateOutput(''), null);
  });

  it('returns null when session_id does not start with coord-', () => {
    const output = JSON.stringify({ session_id: 'abc-123', status: 'running' });
    assert.strictEqual(parseCoordinateOutput(output), null);
  });

  it('handles stderr prefix before JSON', () => {
    const output = 'Warning: something\n' + JSON.stringify({
      session_id: 'coord-test',
      status: 'running',
      graph_id: 'test',
      current_node: 'step1',
      steps_completed: 0,
      steps_failed: 0,
      history: [],
    });

    const result = parseCoordinateOutput(output);
    assert.ok(result);
    assert.strictEqual(result.session_id, 'coord-test');
  });
});

// ---------------------------------------------------------------------------
// readLatestSession
// ---------------------------------------------------------------------------

describe('readLatestSession', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('picks most recently updated session', () => {
    // Create two maestro sessions with different mtimes
    const s1Dir = join(TEST_DIR, '.workflow', '.maestro', 'session-old');
    const s2Dir = join(TEST_DIR, '.workflow', '.maestro', 'session-new');
    mkdirSync(s1Dir, { recursive: true });
    mkdirSync(s2Dir, { recursive: true });

    writeFileSync(join(s1Dir, 'status.json'), JSON.stringify({
      chain_name: 'old-chain',
      steps: [{ skill: 'a', status: 'completed' }],
      current_step: 0,
      status: 'completed',
    }));

    // Small delay to ensure different mtime
    writeFileSync(join(s2Dir, 'status.json'), JSON.stringify({
      chain_name: 'new-chain',
      steps: [{ skill: 'b', status: 'running' }],
      current_step: 0,
      status: 'running',
    }));

    const result = readLatestSession(TEST_DIR);
    assert.ok(result);
    assert.strictEqual(result.chain_name, 'new-chain');
  });

  it('returns null when no sessions exist', () => {
    assert.strictEqual(readLatestSession(TEST_DIR), null);
  });

  it('uses existing bridge as candidate', () => {
    const bridge: CoordBridgeData = {
      session_id: 'test',
      coordinator: 'maestro',
      chain_name: 'bridge-chain',
      intent: 'test',
      phase: 1,
      steps_total: 2,
      steps_completed: 1,
      current_step: { index: 1, skill: 'step1', args: '' },
      next_step: null,
      remaining_steps: [],
      status: 'paused',
      updated_at: Date.now(),
    };

    const result = readLatestSession(TEST_DIR, bridge);
    assert.ok(result);
    assert.strictEqual(result.chain_name, 'bridge-chain');
  });
});

// ---------------------------------------------------------------------------
// buildNextStepHint
// ---------------------------------------------------------------------------

describe('buildNextStepHint', () => {
  it('generates hint for paused session with next step', () => {
    const data: CoordBridgeData = {
      session_id: 'test',
      coordinator: 'maestro',
      chain_name: 'full-lifecycle',
      intent: '',
      phase: null,
      steps_total: 6,
      steps_completed: 3,
      current_step: { index: 3, skill: 'maestro-verify', args: '2' },
      next_step: { index: 4, skill: 'quality-review', args: '2' },
      remaining_steps: [
        { skill: 'quality-review', args: '2' },
        { skill: 'quality-test', args: '2' },
      ],
      status: 'paused',
      updated_at: Date.now(),
    };

    const hint = buildNextStepHint(data);
    assert.ok(hint);
    assert.ok(hint.includes('Coordinator Session Active'));
    assert.ok(hint.includes('full-lifecycle'));
    assert.ok(hint.includes('[3/6]'));
    assert.ok(hint.includes('quality-review'));
    assert.ok(hint.includes('Resume: /maestro -c'));
  });

  it('returns null for completed session', () => {
    const data: CoordBridgeData = {
      session_id: 'test',
      coordinator: 'maestro',
      chain_name: 'chain',
      intent: '',
      phase: null,
      steps_total: 3,
      steps_completed: 3,
      current_step: null,
      next_step: null,
      remaining_steps: [],
      status: 'completed',
      updated_at: Date.now(),
    };

    assert.strictEqual(buildNextStepHint(data), null);
  });

  it('returns null when no next step', () => {
    const data: CoordBridgeData = {
      session_id: 'test',
      coordinator: 'maestro',
      chain_name: 'chain',
      intent: '',
      phase: null,
      steps_total: 1,
      steps_completed: 0,
      current_step: { index: 0, skill: 'step', args: '' },
      next_step: null,
      remaining_steps: [],
      status: 'paused',
      updated_at: Date.now(),
    };

    assert.strictEqual(buildNextStepHint(data), null);
  });

  it('includes coord_session_id in resume hint for link-coordinate', () => {
    const data: CoordBridgeData = {
      session_id: 'test',
      coord_session_id: 'coord-1744668285953-d428',
      coordinator: 'maestro-link-coordinate',
      chain_name: 'chain',
      intent: '',
      phase: null,
      steps_total: 4,
      steps_completed: 2,
      current_step: { index: 2, skill: 'verify', args: '' },
      next_step: { index: 3, skill: 'review', args: '' },
      remaining_steps: [{ skill: 'review', args: '' }],
      status: 'step_paused',
      updated_at: Date.now(),
    };

    const hint = buildNextStepHint(data);
    assert.ok(hint);
    assert.ok(hint.includes('/maestro-link-coordinate -c coord-1744668285953-d428'));
  });
});

// ---------------------------------------------------------------------------
// Bridge file I/O
// ---------------------------------------------------------------------------

describe('writeCoordBridge / readCoordBridge', () => {
  const testSessionId = `test-coord-bridge-${Date.now()}`;

  afterEach(() => {
    // Clean up bridge file
    const bridgePath = join(tmpdir(), `maestro-coord-${testSessionId}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });

  it('round-trips bridge data', () => {
    const data: CoordBridgeData = {
      session_id: testSessionId,
      coordinator: 'maestro',
      chain_name: 'test-chain',
      intent: 'test intent',
      phase: 1,
      steps_total: 3,
      steps_completed: 1,
      current_step: { index: 1, skill: 'plan', args: '1' },
      next_step: { index: 2, skill: 'execute', args: '1' },
      remaining_steps: [{ skill: 'execute', args: '1' }],
      status: 'running',
      updated_at: Date.now(),
    };

    writeCoordBridge(testSessionId, data);
    const read = readCoordBridge(testSessionId);
    assert.ok(read);
    assert.strictEqual(read.chain_name, 'test-chain');
    assert.strictEqual(read.steps_completed, 1);
    assert.strictEqual(read.next_step?.skill, 'execute');
  });

  it('returns null for missing bridge', () => {
    assert.strictEqual(readCoordBridge('nonexistent-session-id'), null);
  });
});

// ---------------------------------------------------------------------------
// resolveNextNode
// ---------------------------------------------------------------------------

describe('resolveNextNode', () => {
  beforeEach(() => { cleanup(); mkdirSync(TEST_DIR, { recursive: true }); });
  afterEach(() => cleanup());

  it('resolves next command node from chain graph', () => {
    const chainsDir = join(TEST_DIR, 'chains');
    mkdirSync(chainsDir, { recursive: true });
    writeFileSync(join(chainsDir, 'test-graph.json'), JSON.stringify({
      nodes: {
        'step-1': { type: 'command', cmd: 'maestro-analyze', args: '1', next: 'step-2' },
        'step-2': { type: 'command', cmd: 'maestro-plan', args: '1', next: 'step-3' },
        'step-3': { type: 'terminal' },
      },
    }));

    const next = resolveNextNode(TEST_DIR, 'test-graph', 'step-1');
    assert.ok(next);
    assert.strictEqual(next.skill, 'maestro-plan');
    assert.strictEqual(next.args, '1');
  });

  it('skips decision nodes to find next command', () => {
    const chainsDir = join(TEST_DIR, 'chains');
    mkdirSync(chainsDir, { recursive: true });
    writeFileSync(join(chainsDir, 'decision-graph.json'), JSON.stringify({
      nodes: {
        'step-1': { type: 'command', cmd: 'analyze', next: 'gate-1' },
        'gate-1': { type: 'decision', edges: [
          { target: 'step-2', default: true },
          { target: 'step-3' },
        ]},
        'step-2': { type: 'command', cmd: 'plan', args: '' },
        'step-3': { type: 'command', cmd: 'skip', args: '' },
      },
    }));

    const next = resolveNextNode(TEST_DIR, 'decision-graph', 'step-1');
    assert.ok(next);
    assert.strictEqual(next.skill, 'plan');
  });

  it('returns null when no graph found', () => {
    assert.strictEqual(resolveNextNode(TEST_DIR, 'nonexistent', 'step-1'), null);
  });

  it('returns null at terminal node', () => {
    const chainsDir = join(TEST_DIR, 'chains');
    mkdirSync(chainsDir, { recursive: true });
    writeFileSync(join(chainsDir, 'terminal-graph.json'), JSON.stringify({
      nodes: {
        'last': { type: 'command', cmd: 'verify', next: 'end' },
        'end': { type: 'terminal' },
      },
    }));

    const next = resolveNextNode(TEST_DIR, 'terminal-graph', 'last');
    assert.strictEqual(next, null);
  });
});
