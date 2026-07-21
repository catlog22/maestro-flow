// CLI wiring for `maestro session` — drives registerSessionCommand through
// commander (parseAsync) and asserts the JSON surface + exit behavior for
// create / chain insert / chain skip / chain replace. Complements the unit-level
// chain-admin.test.ts by covering the option parsing and output shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawnSync } from 'node:child_process';
import { registerSessionCommand } from './session.js';
import { SessionStore } from '../run/store.js';
import { runResponseSchema } from '../run/protocol-schemas.js';

let root: string;
let logs: string[];
let errs: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-cli-'));
  logs = [];
  errs = [];
  vi.spyOn(console, 'log').mockImplementation((v: unknown) => { logs.push(String(v)); });
  vi.spyOn(console, 'error').mockImplementation((v: unknown) => { errs.push(String(v)); });
  process.exitCode = undefined;
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function program(): Command {
  const p = new Command();
  p.exitOverride();
  registerSessionCommand(p);
  return p;
}

async function run(...argv: string[]): Promise<void> {
  await program().parseAsync(['node', 'maestro', 'session', ...argv]);
}

function lastJson(): Record<string, unknown> {
  return JSON.parse(logs[logs.length - 1]);
}

function invokeMachine(args: string[]) {
  const result = spawnSync(
    process.execPath,
    [resolvePath('bin/maestro.js'), ...args, '--workflow-root', root],
    { encoding: 'utf8', cwd: resolvePath('.') },
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return {
    status: result.status,
    stderr: result.stderr,
    lines,
    body: lines.length === 1 ? runResponseSchema.parse(JSON.parse(lines[0])) : null,
  };
}

describe('maestro session create', () => {
  it('registers create + chain subcommands', () => {
    const p = program();
    const session = p.commands.find(c => c.name() === 'session');
    expect(session?.description()).toContain('topic grouping/index');
    expect(session?.commands.map(c => c.name()).sort()).toEqual([
      'chain',
      'create',
      'list',
      'meta',
      'migrate',
      'resolve',
      'resume',
      'seal',
      'show',
    ]);
    const chain = session?.commands.find(c => c.name() === 'chain');
    expect(chain?.commands.map(c => c.name()).sort()).toEqual(['insert', 'replace', 'skip']);
    for (const name of ['resolve', 'resume']) {
      const recoveryCommand = session?.commands.find(c => c.name() === name);
      expect(recoveryCommand?.description()).toContain('canonical paused');
      expect(recoveryCommand?.description()).not.toContain('[DEPRECATED, ADMIN-ONLY]');
      const help = recoveryCommand?.helpInformation() ?? '';
      for (const flag of [
        '--request-id', '--actor', '--reason', '--evidence',
        '--expected-identity-revision', '--expected-activity-revision',
        '--execution-owner', '--owner-epoch', '--lease-id',
      ]) {
        expect(help, `${name} help should include ${flag}`).toContain(flag);
      }
    }
  });

  it('creates a chain session from a --chain-file and prints the next pointer', async () => {
    const chainFile = join(root, 'chain.json');
    writeFileSync(chainFile, JSON.stringify({
      intent: 'from file',
      engine: 'ralph',
      steps: [
        { command: 'analyze', stage: 'analyze' },
        { command: 'execute', stage: 'execute' },
      ],
    }));

    await run('create', 'feat', '--intent', 'cli intent', '--chain-file', chainFile, '--workflow-root', root);

    const out = lastJson();
    expect(String(out.session_id)).toMatch(/^feat-\d{8}-\d{6}$/);
    expect(out.engine).toBe('ralph');
    expect((out.chain as { total: number }).total).toBe(2);
    expect(out.next).toBe(`maestro run next --session ${out.session_id}`);

    const store = new SessionStore(root);
    const session = store.readBundle(String(out.session_id)).session;
    expect(session.intent).toBe('cli intent'); // --intent overrides file intent
    expect(session.orchestration.chain).toHaveLength(2);
  });

  it('creates a simple chain session from command names and lists/shows it', async () => {
    await run(
      'create',
      '统一 run session',
      '--id',
      'simple',
      '--workflow-root',
      root,
      '--chain',
      'analyze',
      'execute',
    );

    const out = lastJson();
    const sessionId = String(out.session_id);
    expect(sessionId).toMatch(/^simple-\d{8}-\d{6}$/);
    expect((out.chain as { total: number }).total).toBe(2);

    const store = new SessionStore(root);
    const session = store.readBundle(sessionId).session;
    expect(session.intent).toBe('统一 run session');
    expect(session.orchestration.chain.map(step => step.command)).toEqual(['analyze', 'execute']);

    await run('list', '--workflow-root', root);
    const listed = lastJson() as Array<{ session_id: string; chain_total: number; pending_steps: number }>;
    expect(listed).toEqual([
      expect.objectContaining({ session_id: sessionId, chain_total: 2, pending_steps: 2 }),
    ]);

    await run('show', sessionId, '--workflow-root', root);
    expect(lastJson()).toMatchObject({ session_id: sessionId, intent: '统一 run session' });
  });

  it('creates an empty-chain session with no --chain-file', async () => {
    await run('create', 'bare', '--intent', 'just intent', '--workflow-root', root);
    const out = lastJson();
    expect((out.chain as { total: number }).total).toBe(0);
    const store = new SessionStore(root);
    expect(store.readBundle(String(out.session_id)).session.orchestration.chain).toHaveLength(0);
  });

  it('rejects an invalid --engine', async () => {
    await run('create', 'x', '--intent', 'i', '--engine', 'bogus', '--workflow-root', root);
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/invalid --engine/);
  });

  it('requires every canonical recovery audit guard', async () => {
    const complete = [
      'resume', '--session', 'missing',
      '--request-id', 'req-recovery',
      '--actor', 'operator',
      '--reason', 'verified recovery',
      '--evidence', 'outputs/recovery.json',
      '--expected-identity-revision', '1',
      '--expected-activity-revision', '2',
      '--workflow-root', root,
    ];
    for (const flag of [
      '--request-id', '--actor', '--reason', '--evidence',
      '--expected-identity-revision', '--expected-activity-revision',
    ]) {
      const missing = [...complete];
      const index = missing.indexOf(flag);
      missing.splice(index, 2);
      await expect(run(...missing), flag).rejects.toMatchObject({
        code: 'commander.missingMandatoryOptionValue',
      });
    }
  });

  it('rejects stale revisions and does not create a Run', async () => {
    await run('create', 'paused', '--intent', 'paused', '--workflow-root', root);
    const id = String(lastJson().session_id);
    const store = new SessionStore(root);
    store.update(id, draft => {
      draft.session.status = 'paused';
      draft.session.orchestration.decision_points.push({ point_id: 'd1', after_step_id: null, status: 'escalated', retry_count: 0, max_retries: 2, evidence_ref: null });
      return null;
    });
    const before = runCount(store, id);
    await run('resolve', '--session', id, '--request-id', 'tr-stale', '--actor', 'tester', '--reason', 'fix', '--evidence', 'evidence.md', '--expected-identity-revision', '999', '--expected-activity-revision', '1', '--decision', 'd1', '--disposition', 'proceed', '--workflow-root', root);
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/stale identity revision/i);
    expect(runCount(store, id)).toBe(before);
  });

  it('replays the same transition and rejects a changed payload', async () => {
    await run('create', 'replay', '--intent', 'replay', '--workflow-root', root);
    const id = String(lastJson().session_id);
    const store = new SessionStore(root);
    store.update(id, draft => {
      draft.session.status = 'paused';
      draft.session.orchestration.decision_points.push({ point_id: 'd1', after_step_id: null, status: 'escalated', retry_count: 0, max_retries: 2, evidence_ref: null });
      return null;
    });
    const rev = store.readBundle(id).session;
    await run('resolve', '--session', id, '--request-id', 'tr-replay', '--actor', 'tester', '--reason', 'fix', '--evidence', 'evidence.md', '--expected-identity-revision', String(rev.identity_revision), '--expected-activity-revision', String(rev.activity_revision), '--decision', 'd1', '--disposition', 'proceed', '--workflow-root', root);
    const first = lastJson();
    const after = store.readBundle(id).session;
    await run('resolve', '--session', id, '--request-id', 'tr-replay', '--actor', 'tester', '--reason', 'changed', '--evidence', 'evidence.md', '--expected-identity-revision', String(after.identity_revision), '--expected-activity-revision', String(after.activity_revision), '--decision', 'd1', '--disposition', 'proceed', '--workflow-root', root);
    expect(first.replayed).toBe(false);
    expect(errs.join('\n')).toMatch(/different normalized request hash|REQUEST_CONFLICT/i);
  });
});

function runCount(store: SessionStore, sessionId: string): number {
  return readdirSync(store.sessionDir(sessionId), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('run-')).length;
}

describe('maestro session chain', () => {
  async function seed(): Promise<string> {
    const chainFile = join(root, 'c.json');
    writeFileSync(chainFile, JSON.stringify({
      intent: 'seed', steps: [{ command: 'analyze' }, { command: 'execute' }],
    }));
    await run('create', 'sess', '--intent', 'seed', '--chain-file', chainFile, '--workflow-root', root);
    const id = String(lastJson().session_id);
    // advance step 0 to running so the boundary excludes it
    const store = new SessionStore(root);
    store.update(id, (draft) => { draft.session.orchestration.chain[0].status = 'running'; return null; });
    return id;
  }

  it('insert after the running step lands a new pending step', async () => {
    const id = await seed();
    await run('chain', 'insert', '--session', id, '--after', 'step-000-analyze', '--command', 'debug', '--inserted-by', 'post-execute', '--workflow-root', root);
    const inserted = lastJson().inserted as { step_id: string; status: string; inserted_by: string };
    expect(inserted.step_id).toBe('step-001-debug');
    expect(inserted.status).toBe('pending');
    expect(inserted.inserted_by).toBe('post-execute');
  });

  it('insert before the active position is rejected with exit 1', async () => {
    const id = await seed();
    // completed step 0 → insert after it (slot 1) is fine, but seed made it running;
    // make step 0 completed and try to insert after a NEW completed guard.
    const store = new SessionStore(root);
    store.update(id, (draft) => {
      draft.session.orchestration.chain[0].status = 'completed';
      draft.session.orchestration.chain[1].status = 'running';
      return null;
    });
    await run('chain', 'insert', '--session', id, '--after', 'step-000-analyze', '--command', 'x', '--workflow-root', root);
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/cannot insert before the active position/);
  });

  it('skip marks a pending step skipped', async () => {
    const id = await seed();
    await run('chain', 'skip', '--session', id, '--step', 'step-001-execute', '--workflow-root', root);
    expect((lastJson().skipped as { status: string }).status).toBe('skipped');
    const store = new SessionStore(root);
    expect(store.readBundle(id).session.orchestration.chain[1].status).toBe('skipped');
  });

  it('replace updates a pending step and regenerates step_id', async () => {
    const id = await seed();
    await run('chain', 'replace', '--session', id, '--step', 'step-001-execute', '--command', 'test', '--args', '--fast', '--workflow-root', root);
    const replaced = lastJson().replaced as { step_id: string; command: string; args: string };
    expect(replaced.step_id).toBe('step-001-test');
    expect(replaced.args).toBe('--fast');
  });

  it('skip a non-pending step exits 1', async () => {
    const id = await seed(); // step 0 running
    await run('chain', 'skip', '--session', id, '--step', 'step-000-analyze', '--workflow-root', root);
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/only pending steps can be skipped/);
  });
});

describe('built-bin session run-response/1.0', () => {
  const auditArgs = (requestId: string, identityRevision: number, activityRevision: number): string[] => [
    '--request-id', requestId,
    '--expected-identity-revision', String(identityRevision),
    '--expected-activity-revision', String(activityRevision),
  ];

  it('emits one envelope for recovery chain and meta exits', () => {
    const store = new SessionStore(root);
    store.createSession('recovery', 'recovery');
    store.update('recovery', draft => {
      draft.session.status = 'paused';
      draft.session.orchestration.decision_points.push({
        point_id: 'DP-1', after_step_id: null, status: 'escalated', retry_count: 0, max_retries: 2, evidence_ref: null,
      });
    });
    const recoveryBefore = store.readBundle('recovery').session;
    const resolveArgs = [
      'session', 'resolve', '--session', 'recovery',
      '--actor', 'tester', '--reason', 'verified', '--evidence', 'evidence.md',
      ...auditArgs('req-resolve-machine', recoveryBefore.identity_revision, recoveryBefore.activity_revision),
      '--decision', 'DP-1', '--disposition', 'proceed', '--json',
    ];
    const resolved = invokeMachine(resolveArgs);
    const resolvedReplay = invokeMachine(resolveArgs);
    const recoveryAfter = store.readBundle('recovery').session;
    const resumeArgs = [
      'session', 'resume', '--session', 'recovery',
      '--actor', 'tester', '--reason', 'blockers cleared', '--evidence', 'evidence.md',
      ...auditArgs('req-resume-machine', recoveryAfter.identity_revision, recoveryAfter.activity_revision),
      '--json',
    ];
    const resumed = invokeMachine(resumeArgs);
    const resumedReplay = invokeMachine(resumeArgs);

    store.createSession('blocked-recovery', 'blocked recovery');
    store.update('blocked-recovery', draft => {
      draft.session.status = 'paused';
      draft.session.orchestration.decision_points.push({
        point_id: 'DP-BLOCK', after_step_id: null, status: 'escalated', retry_count: 0, max_retries: 2, evidence_ref: null,
      });
    });
    const blockedBefore = store.readBundle('blocked-recovery').session;
    const blockedResume = invokeMachine([
      'session', 'resume', '--session', 'blocked-recovery',
      '--actor', 'tester', '--reason', 'premature', '--evidence', 'evidence.md',
      ...auditArgs('req-resume-blocked', blockedBefore.identity_revision, blockedBefore.activity_revision),
      '--json',
    ]);

    store.createSession('mutations', 'mutations');
    store.update('mutations', draft => {
      draft.session.orchestration.chain.push(
        { step_id: 'step-000-analyze', command: 'analyze', status: 'pending', run_id: null, inserted_by: 'test', decision_ref: null },
        { step_id: 'step-001-execute', command: 'execute', status: 'pending', run_id: null, inserted_by: 'test', decision_ref: null },
      );
    });
    const insertBefore = store.readBundle('mutations').session;
    const insertArgs = [
      'session', 'chain', 'insert', '--session', 'mutations', '--after', 'step-000-analyze',
      '--command', 'fix', '--inserted-by', 'test',
      ...auditArgs('req-insert-machine', insertBefore.identity_revision, insertBefore.activity_revision), '--json',
    ];
    const inserted = invokeMachine(insertArgs);
    const insertedReplay = invokeMachine(insertArgs);
    const insertConflict = invokeMachine([
      'session', 'chain', 'insert', '--session', 'mutations', '--after', 'step-000-analyze',
      '--command', 'different', '--inserted-by', 'test',
      ...auditArgs('req-insert-machine', insertBefore.identity_revision, insertBefore.activity_revision), '--json',
    ]);

    const skipBefore = store.readBundle('mutations').session;
    const skipArgs = [
      'session', 'chain', 'skip', '--session', 'mutations', '--step', 'step-001-execute',
      ...auditArgs('req-skip-machine', skipBefore.identity_revision, skipBefore.activity_revision), '--json',
    ];
    const skipped = invokeMachine(skipArgs);
    const skippedReplay = invokeMachine(skipArgs);

    const replaceBefore = store.readBundle('mutations').session;
    const replaceArgs = [
      'session', 'chain', 'replace', '--session', 'mutations', '--step', 'step-001-fix', '--command', 'verify',
      ...auditArgs('req-replace-machine', replaceBefore.identity_revision, replaceBefore.activity_revision), '--json',
    ];
    const replaced = invokeMachine(replaceArgs);
    const replacedReplay = invokeMachine(replaceArgs);

    store.createSession('meta-machine', 'meta machine');
    const positionFile = join(root, 'position.json');
    writeFileSync(positionFile, JSON.stringify({
      lifecycle: 'verify', phase: 2, phase_is_new: false, milestone: 'M-2', planning_mode: 'unified',
      passed_gates: ['scope'], scope_verdict: 'medium',
    }));
    const metaBefore = store.readBundle('meta-machine').session;
    const metaArgs = [
      'session', 'meta', 'update', '--session', 'meta-machine', '--position-file', positionFile,
      ...auditArgs('req-meta-machine', metaBefore.identity_revision, metaBefore.activity_revision), '--json',
    ];
    const meta = invokeMachine(metaArgs);
    const metaReplay = invokeMachine(metaArgs);

    const all = [
      resolved, resolvedReplay, resumed, resumedReplay, blockedResume,
      inserted, insertedReplay, insertConflict, skipped, skippedReplay, replaced, replacedReplay, meta, metaReplay,
    ];
    for (const item of all) {
      expect(item.lines).toHaveLength(1);
      expect(item.stderr).toBe('');
      expect(item.body?.schema_version).toBe('run-response/1.0');
      expect(item.body?.exit_code).toBe(item.status);
    }
    expect(resolved.body).toMatchObject({ operation: 'resolve', ok: true, replay: { status: 'applied' } });
    expect(resolvedReplay.body).toMatchObject({ operation: 'resolve', ok: true, replay: { status: 'replayed' } });
    expect(resumed.body).toMatchObject({ operation: 'resume', ok: true, replay: { status: 'applied' } });
    expect(resumedReplay.body).toMatchObject({ operation: 'resume', ok: true, replay: { status: 'replayed' } });
    expect(blockedResume.body).toMatchObject({ operation: 'resume', ok: false, error: { code: 'RESUME_REQUIRED' } });
    expect(inserted.body).toMatchObject({ operation: 'chain-insert', ok: true, replay: { status: 'applied' } });
    expect(insertedReplay.body).toMatchObject({ operation: 'chain-insert', ok: true, replay: { status: 'replayed' } });
    expect(insertConflict.body).toMatchObject({ operation: 'chain-insert', ok: false, error: { code: 'REQUEST_CONFLICT' } });
    expect(skipped.body).toMatchObject({ operation: 'chain-skip', ok: true, replay: { status: 'applied' } });
    expect(skippedReplay.body).toMatchObject({ operation: 'chain-skip', ok: true, replay: { status: 'replayed' } });
    expect(replaced.body).toMatchObject({ operation: 'chain-replace', ok: true, replay: { status: 'applied' } });
    expect(replacedReplay.body).toMatchObject({ operation: 'chain-replace', ok: true, replay: { status: 'replayed' } });
    expect(meta.body).toMatchObject({ operation: 'meta-update', ok: true, replay: { status: 'applied' } });
    expect(metaReplay.body).toMatchObject({ operation: 'meta-update', ok: true, replay: { status: 'replayed' } });
  });

  it('captures every Commander usage exit in machine mode', () => {
    const cases = [
      { args: ['session', 'resolve', '--json'], operation: 'resolve' },
      { args: ['session', 'resume', '--json'], operation: 'resume' },
      { args: ['session', 'chain', 'insert', '--json'], operation: 'chain-insert' },
      { args: ['session', 'chain', 'replace', '--json'], operation: 'chain-replace' },
      { args: ['session', 'chain', 'skip', '--json'], operation: 'chain-skip' },
      { args: ['session', 'meta', 'update', '--json'], operation: 'meta-update' },
      { args: ['session', 'meta', 'update', '--session', 'missing', '--unknown-option', '--json'], operation: 'meta-update' },
    ];
    for (const item of cases) {
      const result = invokeMachine(item.args);
      expect(result.lines, item.operation).toHaveLength(1);
      expect(result.stderr, item.operation).toBe('');
      expect(result.status, item.operation).toBe(2);
      expect(result.body, item.operation).toMatchObject({
        operation: item.operation,
        ok: false,
        exit_code: 2,
        error: { code: 'COMMANDER_USAGE' },
      });
    }
  });
});
