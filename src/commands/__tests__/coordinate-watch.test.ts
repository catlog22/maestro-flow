import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerCoordinateCommand, __setCoordinateBrokerForTests } from '../coordinate.js';
import { FileDelegateBroker } from '../../async/delegate-broker.js';

// ---------------------------------------------------------------------------
// The `watch` subcommand calls process.exit() at the end of its action.
// Tests stub process.exit to throw a tagged error we can catch, stub
// console.log to capture JSONL/text output, and stub console.error to silence
// warnings while recording them for assertions.
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

async function runWatch(args: string[], workflowRoot: string): Promise<RunResult> {
  const program = new Command();
  program.exitOverride();
  registerCoordinateCommand(program);

  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];

  (process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
    throw new ExitError(code ?? 0);
  };
  console.log = (msg: unknown) => { stdout.push(String(msg)); };
  console.error = (msg: unknown) => { stderr.push(String(msg)); };

  try {
    await program.parseAsync(
      ['coordinate', 'watch', ...args, '--workflow-root', workflowRoot],
      { from: 'user' },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    if (err instanceof ExitError) return { code: err.code, stdout, stderr };
    throw err;
  } finally {
    (process as unknown as { exit: typeof origExit }).exit = origExit;
    console.log = origLog;
    console.error = origError;
  }
}

function writeWalkerState(
  workflowRoot: string,
  sessionId: string,
  status: 'running' | 'completed' | 'failed' | 'paused',
): void {
  const dir = join(workflowRoot, '.workflow', '.maestro', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'walker-state.json'),
    JSON.stringify({
      session_id: sessionId,
      graph_id: 'g',
      current_node: 'done',
      status,
      context: { inputs: {}, project: {}, result: null, analysis: null, visits: {}, var: {} },
      history: [],
      fork_state: null,
      delegate_stack: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tool: 'claude',
      auto_mode: true,
      step_mode: false,
      intent: 'test',
    }),
    'utf-8',
  );
}

describe('maestro coordinate watch', () => {
  let workflowRoot: string;
  let brokerPath: string;
  let broker: FileDelegateBroker;

  beforeEach(() => {
    workflowRoot = mkdtempSync(join(tmpdir(), 'maestro-coord-watch-'));
    brokerPath = join(workflowRoot, 'broker.json');
    broker = new FileDelegateBroker({ statePath: brokerPath });
    __setCoordinateBrokerForTests(broker);
  });

  afterEach(() => {
    __setCoordinateBrokerForTests(null);
    try { rmSync(workflowRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('dumps all pre-seeded events as JSONL and exits 0 (no --follow)', async () => {
    const sid = 'coord-watch-1';
    broker.publishEvent({ jobId: sid, type: 'walker:started', payload: { session_id: sid, graph_id: 'g', intent: 'a' } });
    broker.publishEvent({ jobId: sid, type: 'walker:node_enter', payload: { session_id: sid, node_id: 'run', node_type: 'command' } });
    broker.publishEvent({ jobId: sid, type: 'walker:node_exit', payload: { session_id: sid, node_id: 'run', outcome: 'success' } });

    const { code, stdout } = await runWatch([sid], workflowRoot);
    assert.strictEqual(code, 0);
    assert.strictEqual(stdout.length, 3);

    const parsed = stdout.map(l => JSON.parse(l));
    assert.deepStrictEqual(parsed.map(p => p.type), ['walker:started', 'walker:node_enter', 'walker:node_exit']);
    assert.ok(typeof parsed[0].eventId === 'number');
    assert.ok(typeof parsed[0].createdAt === 'string');
    assert.strictEqual(parsed[1].payload.node_id, 'run');
  });

  it('prints nothing (and exits 0) when no events have been published for the session', async () => {
    const { code, stdout } = await runWatch(['unknown-sid'], workflowRoot);
    assert.strictEqual(code, 0);
    assert.strictEqual(stdout.length, 0);
  });

  it('rejects --format values other than json or text with exit code 2', async () => {
    const { code, stderr } = await runWatch(['some-sid', '--format', 'xml'], workflowRoot);
    assert.strictEqual(code, 2);
    assert.ok(
      stderr.some(l => l.includes('--format must be json or text')),
      `expected format error, got: ${stderr.join(' | ')}`,
    );
  });

  it('--format text renders human-readable lines with type and eventId', async () => {
    const sid = 'coord-watch-text';
    broker.publishEvent({ jobId: sid, type: 'walker:started', payload: { session_id: sid, graph_id: 'g' } });
    broker.publishEvent({ jobId: sid, type: 'walker:node_enter', payload: { session_id: sid, node_id: 'run' } });

    const { code, stdout } = await runWatch([sid, '--format', 'text'], workflowRoot);
    assert.strictEqual(code, 0);
    assert.strictEqual(stdout.length, 2);
    assert.ok(stdout[0].includes('walker:started'));
    assert.ok(stdout[0].includes('#'), 'text format should include an event id marker');
    assert.ok(stdout[1].includes('walker:node_enter'));
  });

  it('--since <cursor> skips events with eventId <= cursor', async () => {
    const sid = 'coord-watch-since';
    const e1 = broker.publishEvent({ jobId: sid, type: 'walker:started', payload: { session_id: sid } });
    broker.publishEvent({ jobId: sid, type: 'walker:node_enter', payload: { session_id: sid, node_id: 'run' } });
    broker.publishEvent({ jobId: sid, type: 'walker:node_exit', payload: { session_id: sid, node_id: 'run' } });

    const { code, stdout } = await runWatch([sid, '--since', String(e1.eventId)], workflowRoot);
    assert.strictEqual(code, 0);
    assert.strictEqual(stdout.length, 2);
    const types = stdout.map(l => JSON.parse(l).type);
    assert.deepStrictEqual(types, ['walker:node_enter', 'walker:node_exit']);
  });

  it('--follow exits after observing walker terminal state and draining remaining events', async () => {
    const sid = 'coord-watch-follow';
    broker.publishEvent({ jobId: sid, type: 'walker:started', payload: { session_id: sid } });
    broker.publishEvent({ jobId: sid, type: 'walker:completed', payload: { session_id: sid, status: 'success' } });
    writeWalkerState(workflowRoot, sid, 'completed');

    const { code, stdout } = await runWatch(
      [sid, '--follow', '--interval', '50'],
      workflowRoot,
    );
    assert.strictEqual(code, 0);
    assert.ok(stdout.length >= 2);
    const types = stdout.map(l => JSON.parse(l).type);
    assert.ok(types.includes('walker:started'));
    assert.ok(types.includes('walker:completed'));
  });

  it('--follow with failed walker state also exits 0 (terminal is terminal)', async () => {
    const sid = 'coord-watch-follow-fail';
    broker.publishEvent({ jobId: sid, type: 'walker:started', payload: { session_id: sid } });
    broker.publishEvent({ jobId: sid, type: 'walker:failed', payload: { session_id: sid, reason: 'boom' } });
    writeWalkerState(workflowRoot, sid, 'failed');

    const { code } = await runWatch(
      [sid, '--follow', '--interval', '50'],
      workflowRoot,
    );
    assert.strictEqual(code, 0);
  });
});
