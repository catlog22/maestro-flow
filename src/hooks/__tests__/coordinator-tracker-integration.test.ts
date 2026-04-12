/**
 * Integration tests for coordinator-tracker using mock workspace fixtures.
 *
 * Fixtures at: ./fixtures/mock-workspace/
 *   .workflow/.maestro/session-abc123/status.json     — A类 (maestro/maestro-coordinate)
 *   .workflow/.maestro-coordinate/coord-.../walker-state.json — B类 (link-coordinate)
 *   chains/full-lifecycle.json                         — chain graph for next-node resolution
 *
 * Fixtures at: ./fixtures/coordinate-cli-output.json   — simulated Bash CLI output
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  readMaestroSession,
  parseCoordinateOutput,
  readWalkerState,
  resolveNextNode,
  readLatestSession,
  writeCoordBridge,
  readCoordBridge,
  buildNextStepHint,
} from '../coordinator-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES = join(__dirname, 'fixtures');
const MOCK_WS = join(FIXTURES, 'mock-workspace');

// ---------------------------------------------------------------------------
// Scenario A: /maestro & /maestro-coordinate — status.json tracking
// ---------------------------------------------------------------------------

describe('Scenario A: maestro status.json tracking', () => {
  it('reads paused session from mock status.json', () => {
    const result = readMaestroSession(MOCK_WS);
    assert.ok(result, 'should parse mock status.json');

    assert.strictEqual(result.coordinator, 'maestro');
    assert.strictEqual(result.chain_name, 'full-lifecycle');
    assert.strictEqual(result.intent, 'implement OAuth2 authentication with refresh tokens');
    assert.strictEqual(result.phase, 2);
    assert.strictEqual(result.steps_total, 6);
    assert.strictEqual(result.steps_completed, 3); // plan + execute + verify completed
    assert.strictEqual(result.status, 'paused');

    // Current step: quality-review (index 3)
    assert.ok(result.current_step);
    assert.strictEqual(result.current_step.index, 3);
    assert.strictEqual(result.current_step.skill, 'quality-review');
    assert.strictEqual(result.current_step.args, '2');

    // Next step: quality-test (index 4)
    assert.ok(result.next_step);
    assert.strictEqual(result.next_step.index, 4);
    assert.strictEqual(result.next_step.skill, 'quality-test');
    assert.strictEqual(result.next_step.args, '2');

    // Remaining: quality-test, maestro-phase-transition
    assert.strictEqual(result.remaining_steps.length, 2);
    assert.strictEqual(result.remaining_steps[0].skill, 'quality-test');
    assert.strictEqual(result.remaining_steps[1].skill, 'maestro-phase-transition');
  });

  it('generates correct next-step hint for paused A类 session', () => {
    const session = readMaestroSession(MOCK_WS);
    assert.ok(session);

    const hint = buildNextStepHint(session);
    assert.ok(hint, 'should produce hint for paused session');

    // Verify hint content
    assert.ok(hint.includes('## Coordinator Session Active'));
    assert.ok(hint.includes('full-lifecycle'));
    assert.ok(hint.includes('[3/6]'));
    assert.ok(hint.includes('paused'));
    assert.ok(hint.includes('Last: quality-review'));
    assert.ok(hint.includes('Next: quality-test 2'));
    assert.ok(hint.includes('Then: maestro-phase-transition'));
    assert.ok(hint.includes('Resume: /maestro -c'));
  });
});

// ---------------------------------------------------------------------------
// Scenario B: /maestro-link-coordinate — Bash output capture + walker-state
// ---------------------------------------------------------------------------

describe('Scenario B: link-coordinate Bash output capture', () => {
  it('parses coordinate CLI output from fixture', () => {
    const cliOutput = readFileSync(join(FIXTURES, 'coordinate-cli-output.json'), 'utf8');
    const result = parseCoordinateOutput(cliOutput);

    assert.ok(result, 'should parse coordinate CLI JSON');
    assert.strictEqual(result.session_id, 'coord-1744668285953-d428');
    assert.strictEqual(result.status, 'step_paused');
    assert.strictEqual(result.graph_id, 'full-lifecycle');
    assert.strictEqual(result.current_node, 'verify');
    assert.strictEqual(result.steps_completed, 3);
    assert.strictEqual(result.steps_failed, 0);
    assert.strictEqual(result.history.length, 3);
  });

  it('reads walker-state for captured coord session', () => {
    const result = readWalkerState(MOCK_WS, 'coord-1744668285953-d428');
    assert.ok(result, 'should read walker-state.json');

    assert.strictEqual(result.coordinator, 'maestro-link-coordinate');
    assert.strictEqual(result.coord_session_id, 'coord-1744668285953-d428');
    assert.strictEqual(result.chain_name, 'full-lifecycle');
    assert.strictEqual(result.phase, 2);
    assert.strictEqual(result.status, 'step_paused');

    // History: 3 command nodes completed (plan, execute, verify)
    assert.strictEqual(result.steps_completed, 3);
  });

  it('resolves next node from chain graph for current walker position', () => {
    // Walker is at "verify", next: verify → check_verify (decision)
    // Default edge of check_verify → fix_plan (command, cmd: maestro-plan)
    // The "passed" edge goes to review, but resolveNextNode follows default
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'verify');
    assert.ok(next, 'should resolve through decision node to next command');
    assert.strictEqual(next.skill, 'maestro-plan');
    assert.strictEqual(next.args, '{phase} --gaps');
  });

  it('generates correct next-step hint for B类 session', () => {
    const session = readWalkerState(MOCK_WS, 'coord-1744668285953-d428');
    assert.ok(session);

    const hint = buildNextStepHint(session);
    assert.ok(hint, 'should produce hint for step_paused B类 session');

    assert.ok(hint.includes('## Coordinator Session Active'));
    assert.ok(hint.includes('step_paused'));
    assert.ok(hint.includes('/maestro-link-coordinate -c coord-1744668285953-d428'));
  });
});

// ---------------------------------------------------------------------------
// Scenario C: Chain graph next-node resolution (decision/gate traversal)
// ---------------------------------------------------------------------------

describe('Scenario C: chain graph traversal', () => {
  it('follows command → command edge', () => {
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'plan');
    assert.ok(next);
    assert.strictEqual(next.skill, 'maestro-execute');
  });

  it('follows command → decision → command (default edge)', () => {
    // review → check_review (decision, default → test)
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'review');
    assert.ok(next);
    assert.strictEqual(next.skill, 'quality-test');
  });

  it('returns null at terminal node via transition → done', () => {
    // transition → done (terminal)
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'transition');
    assert.strictEqual(next, null);
  });

  it('follows multi-hop: execute → verify (direct command edge)', () => {
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'execute');
    assert.ok(next);
    assert.strictEqual(next.skill, 'maestro-verify');
  });
});

// ---------------------------------------------------------------------------
// Scenario D: Bridge file round-trip + readLatestSession merge
// ---------------------------------------------------------------------------

describe('Scenario D: bridge file + session merge', () => {
  const testSession = `integration-test-${Date.now()}`;

  it('bridge write → read round-trip preserves all fields', () => {
    const session = readMaestroSession(MOCK_WS);
    assert.ok(session);

    session.session_id = testSession;
    writeCoordBridge(testSession, session);

    const read = readCoordBridge(testSession);
    assert.ok(read);
    assert.strictEqual(read.session_id, testSession);
    assert.strictEqual(read.chain_name, 'full-lifecycle');
    assert.strictEqual(read.steps_total, 6);
    assert.strictEqual(read.steps_completed, 3);
    assert.strictEqual(read.current_step?.skill, 'quality-review');
    assert.strictEqual(read.next_step?.skill, 'quality-test');
    assert.strictEqual(read.remaining_steps.length, 2);
    assert.strictEqual(read.status, 'paused');

    // Cleanup
    const bridgePath = join(tmpdir(), `maestro-coord-${testSession}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });

  it('readLatestSession picks most recent across A/B types', () => {
    const result = readLatestSession(MOCK_WS);
    assert.ok(result, 'should find at least one session');
    // Both status.json and walker-state.json exist; should pick the newer one
    assert.ok(['maestro', 'maestro-link-coordinate'].includes(result.coordinator));
    assert.strictEqual(result.chain_name, 'full-lifecycle');
  });
});

// ---------------------------------------------------------------------------
// Scenario E: Full PostToolUse hook simulation
// ---------------------------------------------------------------------------

describe('Scenario E: simulated PostToolUse hook flow', () => {
  const hookSession = `hook-sim-${Date.now()}`;

  it('Path A: Bash output with coord JSON → bridge write → hint', () => {
    // 1. Simulate Bash tool output containing coordinate JSON
    const cliOutput = readFileSync(join(FIXTURES, 'coordinate-cli-output.json'), 'utf8');
    const coordResult = parseCoordinateOutput(cliOutput);
    assert.ok(coordResult);

    // 2. Read walker-state for captured session
    const bridgeData = readWalkerState(MOCK_WS, coordResult.session_id);
    assert.ok(bridgeData);

    // 3. Write bridge
    bridgeData.session_id = hookSession;
    writeCoordBridge(hookSession, bridgeData);

    // 4. Verify bridge persisted
    const read = readCoordBridge(hookSession);
    assert.ok(read);
    assert.strictEqual(read.coord_session_id, 'coord-1744668285953-d428');
    assert.strictEqual(read.coordinator, 'maestro-link-coordinate');

    // 5. Generate hint
    const hint = buildNextStepHint(read);
    assert.ok(hint);
    assert.ok(hint.includes('Coordinator Session Active'));

    // Cleanup
    const bridgePath = join(tmpdir(), `maestro-coord-${hookSession}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });

  it('Path B: status.json read → bridge write → hint', () => {
    // 1. Read maestro session from status.json
    const bridgeData = readMaestroSession(MOCK_WS);
    assert.ok(bridgeData);

    // 2. Write bridge
    bridgeData.session_id = hookSession;
    writeCoordBridge(hookSession, bridgeData);

    // 3. Verify bridge
    const read = readCoordBridge(hookSession);
    assert.ok(read);
    assert.strictEqual(read.coordinator, 'maestro');
    assert.strictEqual(read.chain_name, 'full-lifecycle');

    // 4. Hint for paused session
    const hint = buildNextStepHint(read);
    assert.ok(hint);
    assert.ok(hint.includes('Next: quality-test 2'));
    assert.ok(hint.includes('Resume: /maestro -c'));

    // Cleanup
    const bridgePath = join(tmpdir(), `maestro-coord-${hookSession}.json`);
    if (existsSync(bridgePath)) rmSync(bridgePath);
  });
});
