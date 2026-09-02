/**
 * Integration tests for coordinator-tracker using an isolated mock workspace.
 *
 * The `.workflow` files are created at runtime because repository `.workflow`
 * state is intentionally gitignored. The chain graph and coordinate CLI output
 * remain tracked source fixtures under ./fixtures/.
 */

import { afterAll, beforeAll, describe, it } from 'vitest';
import assert from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
let MOCK_WS: string;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

beforeAll(() => {
  MOCK_WS = mkdtempSync(join(tmpdir(), 'coordinator-tracker-test-'));

  const chainDir = join(MOCK_WS, 'chains');
  mkdirSync(chainDir, { recursive: true });
  writeFileSync(
    join(chainDir, 'full-lifecycle.json'),
    readFileSync(join(FIXTURES, 'mock-workspace', 'chains', 'full-lifecycle.json'), 'utf8'),
    'utf8',
  );

  writeJson(
    join(MOCK_WS, '.workflow', '.maestro', 'session-abc123', 'status.json'),
    {
      session_id: 'session-abc123',
      intent: 'implement OAuth2 authentication with refresh tokens',
      chain_name: 'full-lifecycle',
      phase: 2,
      current_step: 2,
      status: 'paused',
      steps: [
        { index: 0, skill: 'maestro-plan', args: '2', status: 'completed' },
        { index: 1, skill: 'maestro-execute', args: '2', status: 'completed' },
        { index: 2, skill: 'quality-review', args: '2', status: 'paused' },
        { index: 3, skill: 'quality-test', args: '2', status: 'pending' },
        { index: 4, skill: 'maestro-milestone-audit', args: '', status: 'pending' },
        { index: 5, skill: 'maestro-milestone-complete', args: '', status: 'pending' },
      ],
    },
  );

  writeJson(
    join(
      MOCK_WS,
      '.workflow',
      '.maestro',
      'coord-1744668285953-d428',
      'walker-state.json',
    ),
    {
      graph_id: 'full-lifecycle',
      intent: 'implement OAuth2 authentication with refresh tokens',
      current_node: 'review',
      status: 'step_paused',
      context: { project: { current_phase: 2 } },
      history: [
        { node_id: 'plan', node_type: 'command', outcome: 'success' },
        { node_id: 'execute', node_type: 'command', outcome: 'success' },
        { node_id: 'review', node_type: 'command', outcome: 'success' },
      ],
    },
  );
});

afterAll(() => {
  if (MOCK_WS && existsSync(MOCK_WS)) {
    rmSync(MOCK_WS, { recursive: true, force: true });
  }
});

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
    assert.strictEqual(result.steps_completed, 2); // plan + execute completed
    assert.strictEqual(result.status, 'paused');

    // Current step: quality-review (index 2)
    assert.ok(result.current_step);
    assert.strictEqual(result.current_step.index, 2);
    assert.strictEqual(result.current_step.skill, 'quality-review');
    assert.strictEqual(result.current_step.args, '2');

    // Next step: quality-test (index 3)
    assert.ok(result.next_step);
    assert.strictEqual(result.next_step.index, 3);
    assert.strictEqual(result.next_step.skill, 'quality-test');
    assert.strictEqual(result.next_step.args, '2');

    // Remaining: quality-test, maestro-milestone-audit, maestro-milestone-complete
    assert.strictEqual(result.remaining_steps.length, 3);
    assert.strictEqual(result.remaining_steps[0].skill, 'quality-test');
    assert.strictEqual(result.remaining_steps[1].skill, 'maestro-milestone-audit');
    assert.strictEqual(result.remaining_steps[2].skill, 'maestro-milestone-complete');
  });

  it('generates correct next-step hint for paused A类 session', () => {
    const session = readMaestroSession(MOCK_WS);
    assert.ok(session);

    const hint = buildNextStepHint(session);
    assert.ok(hint, 'should produce hint for paused session');

    // Verify hint content
    assert.ok(hint.includes('## Coordinator Session Active'));
    assert.ok(hint.includes('full-lifecycle'));
    assert.ok(hint.includes('[2/6]'));
    assert.ok(hint.includes('paused'));
    assert.ok(hint.includes('Last: quality-review'));
    assert.ok(hint.includes('Next: quality-test 2'));
    assert.ok(hint.includes('Then: maestro-milestone-audit'));
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
    assert.strictEqual(result.current_node, 'review');
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

    // History: 3 command nodes completed (plan, execute, review)
    assert.strictEqual(result.steps_completed, 3);
  });

  it('resolves next node from chain graph for current walker position', () => {
    // Walker is at "review", next: review → check_review (decision)
    // Default edge of check_review → test (command, cmd: quality-test)
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'review');
    assert.ok(next, 'should resolve through decision node to next command');
    assert.strictEqual(next.skill, 'quality-test');
    assert.strictEqual(next.args, '{phase}');
  });

  it('generates correct next-step hint for B类 session', () => {
    const session = readWalkerState(MOCK_WS, 'coord-1744668285953-d428');
    assert.ok(session);

    const hint = buildNextStepHint(session);
    assert.ok(hint, 'should produce hint for step_paused B类 session');

    assert.ok(hint.includes('## Coordinator Session Active'));
    assert.ok(hint.includes('step_paused'));
    assert.ok(hint.includes('maestro coordinate -c coord-1744668285953-d428'));
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

  it('follows direct edge: execute → review', () => {
    const next = resolveNextNode(MOCK_WS, 'full-lifecycle', 'execute');
    assert.ok(next);
    assert.strictEqual(next.skill, 'quality-review');
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
    assert.strictEqual(read.steps_completed, 2);
    assert.strictEqual(read.current_step?.skill, 'quality-review');
    assert.strictEqual(read.next_step?.skill, 'quality-test');
    assert.strictEqual(read.remaining_steps.length, 3);
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
