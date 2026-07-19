// CLI wiring for `maestro session` — drives registerSessionCommand through
// commander (parseAsync) and asserts the JSON surface + exit behavior for
// create / chain insert / chain skip / chain replace. Complements the unit-level
// chain-admin.test.ts by covering the option parsing and output shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSessionCommand } from './session.js';
import { SessionStore } from '../run/store.js';

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

describe('maestro session create', () => {
  it('registers create + chain subcommands', () => {
    const p = program();
    const session = p.commands.find(c => c.name() === 'session');
    expect(session?.description()).toContain('topic grouping/index');
    expect(session?.commands.map(c => c.name()).sort()).toEqual(['chain', 'create', 'meta', 'migrate', 'resolve', 'resume']);
    const chain = session?.commands.find(c => c.name() === 'chain');
    expect(chain?.commands.map(c => c.name()).sort()).toEqual(['insert', 'replace', 'skip']);
    for (const name of ['resolve', 'resume']) {
      const compatibilityCommand = session?.commands.find(c => c.name() === name);
      expect(compatibilityCommand?.description()).toContain('[DEPRECATED, ADMIN-ONLY]');
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

  it('requires actor, reason and evidence for lifecycle transitions', async () => {
    await expect(run('resume', '--session', 'missing', '--request-id', 'r1', '--actor', 'a', '--expected-identity-revision', '0', '--expected-activity-revision', '0', '--workflow-root', root)).rejects.toThrow();
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
