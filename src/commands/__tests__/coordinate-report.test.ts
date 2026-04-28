import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerCoordinateCommand, resolveReportPath } from '../coordinate.js';

// ---------------------------------------------------------------------------
// The `report` subcommand calls process.exit() at the end of its action.
// Tests stub process.exit to throw a tagged error we can catch, and stub
// console.error to silence noise while capturing messages for assertions.
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function runReport(args: string[], workflowRoot: string): Promise<number> {
  const program = new Command();
  program.exitOverride(); // prevent commander from calling process.exit on parse errors
  registerCoordinateCommand(program);

  const origExit = process.exit;
  // Cast through unknown to satisfy the `never` return type of process.exit.
  (process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
    throw new ExitError(code ?? 0);
  };

  try {
    await program.parseAsync(
      ['coordinate', 'report', ...args, '--workflow-root', workflowRoot],
      { from: 'user' },
    );
    return 0;
  } catch (err) {
    if (err instanceof ExitError) return err.code;
    throw err;
  } finally {
    (process as unknown as { exit: typeof origExit }).exit = origExit;
  }
}

function sessionDirOf(workflowRoot: string): string {
  return join(workflowRoot, '.workflow', '.maestro');
}

describe('maestro coordinate report', () => {
  let workflowRoot: string;
  const origError = console.error;
  const errorLog: string[] = [];

  beforeEach(() => {
    workflowRoot = mkdtempSync(join(tmpdir(), 'maestro-coord-report-'));
    errorLog.length = 0;
    console.error = (msg: unknown) => { errorLog.push(String(msg)); };
  });

  afterEach(() => {
    console.error = origError;
    try { rmSync(workflowRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('writes structured JSON to the canonical report path on success', async () => {
    const code = await runReport(
      [
        '--session', 'sess-1', '--node', 'execute',
        '--status', 'SUCCESS',
        '--verification', 'passed',
        '--review', 'PASS',
        '--summary', 'implementation complete',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 0);

    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-1', 'execute');
    assert.ok(existsSync(path), `expected report at ${path}`);

    const payload = JSON.parse(readFileSync(path, 'utf-8'));
    assert.strictEqual(payload.status, 'SUCCESS');
    assert.strictEqual(payload.verification_status, 'passed');
    assert.strictEqual(payload.review_verdict, 'PASS');
    assert.strictEqual(payload.summary, 'implementation complete');
    assert.deepStrictEqual(payload.artifacts, []);
    assert.ok(typeof payload.reported_at === 'string');
  });

  it('collects repeatable --artifact flags into an array', async () => {
    const code = await runReport(
      [
        '--session', 'sess-2', '--node', 'plan',
        '--status', 'SUCCESS',
        '--artifact', 'plan.md',
        '--artifact', 'roadmap.json',
        '--artifact', 'tasks.yaml',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 0);

    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-2', 'plan');
    const payload = JSON.parse(readFileSync(path, 'utf-8'));
    assert.deepStrictEqual(payload.artifacts, ['plan.md', 'roadmap.json', 'tasks.yaml']);
  });

  it('exits 0 even when --status is FAILURE (report itself succeeded)', async () => {
    const code = await runReport(
      [
        '--session', 'sess-3', '--node', 'verify',
        '--status', 'FAILURE',
        '--verification', 'failed',
        '--summary', 'tests broke',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 0);

    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-3', 'verify');
    const payload = JSON.parse(readFileSync(path, 'utf-8'));
    assert.strictEqual(payload.status, 'FAILURE');
    assert.strictEqual(payload.verification_status, 'failed');
  });

  it('rejects invalid --status with exit code 2', async () => {
    const code = await runReport(
      [
        '--session', 'sess-4', '--node', 'execute',
        '--status', 'MAYBE',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 2);
    assert.ok(
      errorLog.some(l => l.includes('--status must be one of')),
      `expected enum error, got: ${errorLog.join(' | ')}`,
    );
    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-4', 'execute');
    assert.ok(!existsSync(path), 'no report file should be written on validation error');
  });

  it('rejects invalid --verification with exit code 2', async () => {
    const code = await runReport(
      [
        '--session', 'sess-5', '--node', 'execute',
        '--status', 'SUCCESS',
        '--verification', 'maybe',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 2);
    assert.ok(errorLog.some(l => l.includes('--verification must be one of')));
  });

  it('rejects invalid --review with exit code 2', async () => {
    const code = await runReport(
      [
        '--session', 'sess-6', '--node', 'execute',
        '--status', 'SUCCESS',
        '--review', 'GOOD',
      ],
      workflowRoot,
    );
    assert.strictEqual(code, 2);
    assert.ok(errorLog.some(l => l.includes('--review must be one of')));
  });

  it('fails when required --session is missing', async () => {
    await assert.rejects(
      () => runReport(
        ['--node', 'execute', '--status', 'SUCCESS'],
        workflowRoot,
      ),
      /session/i,
    );
  });

  it('fails when required --node is missing', async () => {
    await assert.rejects(
      () => runReport(
        ['--session', 'sess-7', '--status', 'SUCCESS'],
        workflowRoot,
      ),
      /node/i,
    );
  });

  it('leaves no .tmp file behind after a successful write', async () => {
    const code = await runReport(
      ['--session', 'sess-8', '--node', 'execute', '--status', 'SUCCESS'],
      workflowRoot,
    );
    assert.strictEqual(code, 0);

    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-8', 'execute');
    assert.ok(existsSync(path));
    assert.ok(!existsSync(`${path}.tmp`), 'tmp file should have been renamed away');
  });

  it('normalizes --status to uppercase', async () => {
    const code = await runReport(
      ['--session', 'sess-9', '--node', 'execute', '--status', 'success'],
      workflowRoot,
    );
    assert.strictEqual(code, 0);
    const path = resolveReportPath(sessionDirOf(workflowRoot), 'sess-9', 'execute');
    const payload = JSON.parse(readFileSync(path, 'utf-8'));
    assert.strictEqual(payload.status, 'SUCCESS');
  });
});
