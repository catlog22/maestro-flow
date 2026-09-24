import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Compaction-reattach proof: after a partial v3 chain has been driven by one
// process, a NEW process (simulating a compacted/recovered session with only
// the durable .workflow state) re-attaches through `session resume-view` and
// `run brief` (Resume Packet), inserts the next chain step and continues with
// `run next` -> complete. Orchestration revisions must stay contiguous across
// the process boundary (audit §14.3.4 compaction reattach).
// ---------------------------------------------------------------------------

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-v3-compaction-'));
  roots.push(root);
  mkdirSync(join(root, '.workflow'), { recursive: true });
  writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }));
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(root, '.claude', 'commands', 'implement.md'), [
    '---',
    'session-mode: run',
    'contract:',
    '  consumes: []',
    '  produces:',
    '    - kind: artifact',
    '      path: outputs/result.json',
    '      alias: latest-result',
    '      role: primary',
    '      required: true',
    '      schema: artifacts/1.0',
    '  gates: { entry: [], exit: [] }',
    '---',
    '# Implement\n',
  ].join('\n'), 'utf8');
  return root;
}

function invoke(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [
    resolve('bin/maestro.js'), ...args, '--json', '--workflow-root', root,
  ], { encoding: 'utf8', cwd: resolve('.') });
  expect(result.status, `exit ${result.status}: ${result.stderr}\n${result.stdout}`).toBe(0);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as {
    ok: boolean;
    operation: string;
    request_id: string | null;
    revision?: { target_type: string; target_id: string; revision: number } | null;
    result?: Record<string, unknown>;
    error?: { code?: string; message?: string } | null;
  };
}

function writeRunOutput(root: string, runId: string): void {
  const runDir = join(root, '.workflow', 'sessions', 'compaction-session', 'runs', runId);
  mkdirSync(join(runDir, 'outputs'), { recursive: true });
  writeFileSync(join(runDir, 'outputs', 'result.json'), JSON.stringify({ done: true }), 'utf8');
  writeFileSync(join(runDir, 'report.md'), [
    '---',
    'summary: "compaction step completed"',
    'decisions:',
    '  - status: accepted',
    '    text: "compaction reattach keeps orchestration revision contiguous"',
    'constraints: []',
    '---',
  ].join('\n'), 'utf8');
}

describe('v3 compaction reattach', () => {
  it('re-attaches a partially driven Session from durable state only and continues the chain', { timeout: 180_000 }, () => {
    const root = fixture();

    // ── Process 1: drive step-1 to completion ──────────────────────────────
    const open = invoke(root, [
      'session', 'open', 'compaction reattach', '--id', 'compaction-session',
      '--participant', 'pi-c1', '--actor', 'pi-c1',
      '--request-id', 'req-c1-open', '--reason', 'process 1',
    ]);
    expect(open.ok).toBe(true);
    expect(open.operation).toBe('session-open');

    const insert1 = invoke(root, [
      'session', 'chain', 'insert', '--session', 'compaction-session',
      '--step-id', 'step-1', '--command', 'implement',
      '--participant', 'pi-c1', '--actor', 'pi-c1',
      '--request-id', 'req-c1-insert', '--reason', 'process 1',
      '--expected-orchestration-revision', '1',
    ]);
    expect(insert1.ok).toBe(true);

    const next1 = invoke(root, [
      'run', 'next', '--session', 'compaction-session',
      '--participant', 'pi-c1', '--actor', 'pi-c1',
      '--request-id', 'req-c1-next', '--reason', 'process 1',
      '--expected-orchestration-revision', '2',
    ]);
    expect(next1.ok).toBe(true);
    const run1Id = next1.result?.run_id as string;
    expect(next1.result?.run_already_created).toBe(true);
    writeRunOutput(root, run1Id);

    const complete1 = invoke(root, [
      'run', 'complete', run1Id, '--session', 'compaction-session',
      '--participant', 'pi-c1', '--actor', 'pi-c1',
      '--request-id', 'req-c1-complete', '--reason', 'process 1',
      '--expected-orchestration-revision', '3', '--expected-run-revision', '1',
      '--verdict', 'done', '--advance',
    ]);
    expect(complete1.ok).toBe(true);
    expect(complete1.result?.status).toBe('sealed');

    // ── Process 2: compaction recovery — only durable .workflow state ──────
    const resume = invoke(root, [
      'session', 'resume-view', '--session', 'compaction-session',
    ]);
    expect(resume.ok).toBe(true);
    expect(resume.result?.sessionStatus).toBe('open');
    expect(resume.result?.orchestrationRevision).toBe(4);

    const brief = invoke(root, [
      'run', 'brief', run1Id, '--session', 'compaction-session',
    ]);
    expect(brief.ok).toBe(true);
    expect(brief.result?.schema_version).toBe('brief-result/3.0');
    const briefSession = brief.result?.session as Record<string, unknown> | undefined;
    expect(briefSession?.orchestration_revision).toBe(4);
    expect((brief.result?.run as Record<string, unknown> | undefined)?.status).toBe('sealed');
    expect((brief.result?.next as { command?: string } | undefined)?.command).toBe(
      'maestro session complete --session compaction-session --actor <actor-id> '
      + '--expected-orchestration-revision 4 --json',
    );
    expect(brief.result?.continuation).toMatchObject({
      operation: 'session-complete',
      locator: { session_id: 'compaction-session' },
      revision_requirements: { expected_orchestration_revision: 4 },
    });

    // Insert step-2 and continue — revisions stay contiguous (4 -> 5 -> 6).
    const insert2 = invoke(root, [
      'session', 'chain', 'insert', '--session', 'compaction-session',
      '--step-id', 'step-2', '--command', 'implement',
      '--participant', 'pi-c2', '--actor', 'pi-c2',
      '--request-id', 'req-c2-insert', '--reason', 'process 2 after compaction',
      '--expected-orchestration-revision', '4',
    ]);
    expect(insert2.ok).toBe(true);

    const next2 = invoke(root, [
      'run', 'next', '--session', 'compaction-session',
      '--participant', 'pi-c2', '--actor', 'pi-c2',
      '--request-id', 'req-c2-next', '--reason', 'process 2 after compaction',
      '--expected-orchestration-revision', '5',
    ]);
    expect(next2.ok).toBe(true);
    const run2Id = next2.result?.run_id as string;
    writeRunOutput(root, run2Id);

    const complete2 = invoke(root, [
      'run', 'complete', run2Id, '--session', 'compaction-session',
      '--participant', 'pi-c2', '--actor', 'pi-c2',
      '--request-id', 'req-c2-complete', '--reason', 'process 2 after compaction',
      '--expected-orchestration-revision', '6', '--expected-run-revision', '1',
      '--verdict', 'done', '--advance',
    ]);
    expect(complete2.ok).toBe(true);
    expect(complete2.result?.status).toBe('sealed');

    const sessionComplete = invoke(root, [
      'session', 'complete', '--session', 'compaction-session',
      '--participant', 'pi-c2', '--actor', 'pi-c2',
      '--request-id', 'req-c2-session-complete', '--reason', 'process 2 after compaction',
      '--expected-orchestration-revision', '7',
    ]);
    expect(sessionComplete.ok).toBe(true);
    expect(sessionComplete.result?.status).toBe('completed');
  });
});
