import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runResponseSchema } from '../run/protocol-schemas.js';
import { SessionStore } from '../run/store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function invoke(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...args, '--workflow-root', root], { encoding: 'utf8', cwd: resolve('.') });
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return { status: result.status, stderr: result.stderr, lines, body: lines.length === 1 ? runResponseSchema.parse(JSON.parse(lines[0])) : null };
}
function fixture(): { root: string; chain: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-run-machine-')); roots.push(root);
  mkdirSync(join(root, '.claude', 'commands'), { recursive: true });
  writeFileSync(join(root, '.claude', 'commands', 'demo.md'), '---\nsession-mode: run\n---\n# Demo\n');
  mkdirSync(join(root, 'workflows'), { recursive: true });
  writeFileSync(join(root, 'workflows', 'demo.md'), '# Demo workflow\n');
  const chain = join(root, 'chain.json');
  writeFileSync(chain, JSON.stringify({ steps: [{ command: 'demo' }] }));
  return { root, chain };
}

describe('built-bin run-response/1.0', () => {
  it('documents rebind as an audited compatibility gate rather than a force or legacy-only backfill', () => {
    const result = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'run', 'rebind', '--help'], { encoding: 'utf8', cwd: resolve('.') });
    expect(result.status, result.stderr).toBe(0);
    const normalizedStdout = result.stdout.replace(/\s+/g, ' ');
    expect(normalizedStdout).toContain('compatible command definition, contract snapshot, or hash drift');
    expect(normalizedStdout).toContain('strictly validates gate and produce compatibility');
    expect(normalizedStdout).toContain('--reason is required and recorded in command-rebind.json');
    expect(normalizedStdout).toContain('not a force operation or lifecycle bypass');
    expect(normalizedStdout).not.toContain('Backfill contract_hash for a legacy Run');
    expect(normalizedStdout).not.toContain('prompt-only drift');
  });

  it('emits one stdout envelope for next exits 0, 1, 2, and 3 with empty stderr', () => {
    const { root, chain } = fixture();
    const created = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'session', 'create', 's', '--intent', 'demo', '--chain-file', chain, '--workflow-root', root], { encoding: 'utf8' });
    const sessionId = JSON.parse(created.stdout).session_id as string;
    const ok = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const running = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const missing = invoke(root, ['run', 'next', '--session', 'missing', '--json']);
    const emptyCreated = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'session', 'create', 'empty', '--intent', 'empty', '--workflow-root', root], { encoding: 'utf8' });
    const emptyId = JSON.parse(emptyCreated.stdout).session_id as string;
    const complete = invoke(root, ['run', 'next', '--session', emptyId, '--json']);
    for (const item of [ok, running, missing, complete]) { expect(item.lines).toHaveLength(1); expect(item.stderr).toBe(''); expect(item.body?.exit_code).toBe(item.status); }
    expect([ok.status, missing.status, complete.status, running.status], JSON.stringify({ ok: ok.body, running: running.body })).toEqual([0, 1, 2, 3]);
  });

  it('captures Commander missing arguments and invalid platform in machine mode', () => {
    const { root } = fixture();
    const missing = invoke(root, ['run', 'brief', '--json']);
    const platform = invoke(root, ['run', 'brief', 'missing', '--platform', 'bogus', '--json']);
    expect(missing.body).toMatchObject({ ok: false, exit_code: 2, error: { code: 'COMMANDER_USAGE' } });
    expect(platform.body).toMatchObject({ ok: false, exit_code: 1, error: { code: 'PLATFORM_INVALID' } });
    expect(missing.stderr).toBe(''); expect(platform.stderr).toBe('');
  });

  it('covers complete and recall machine surfaces without stderr payloads', () => {
    const { root } = fixture();
    new SessionStore(root).createSession('live', 'demo intent', { command: 'demo' });
    const complete = invoke(root, ['run', 'complete', 'missing', '--verdict', 'bogus', '--json']);
    const recall = invoke(root, ['run', 'recall', 'demo', '--intent', 'demo intent', '--as-of', '2026-07-19T00:00:00.000Z', '--json']);
    expect(complete.body).toMatchObject({ operation: 'complete', exit_code: 2, error: { code: 'INVALID_VERDICT' } });
    expect(recall.body).toMatchObject({ operation: 'recall', ok: true, exit_code: 0, result: { schema_version: 'run-recall/1.0', recommendation: { automatic: false } } });
    const suggested = (recall.body as any).result.next.command as string;
    expect(suggested).toBe('maestro run create demo --session live');
    const executed = invoke(root, suggested.split(' ').slice(1));
    expect(executed.status).toBe(0);
    expect(complete.stderr).toBe(''); expect(recall.stderr).toBe('');
  });

  it('emits an executable exact-live paused resume pointer without recall-confirm', () => {
    const { root } = fixture();
    const store = new SessionStore(root);
    store.createSession('paused', 'paused intent', { command: 'demo' });
    store.update('paused', draft => { draft.session.status = 'paused'; });
    const recall = invoke(root, ['run', 'recall', 'demo', '--intent', 'paused intent', '--as-of', '2026-07-19T00:00:00.000Z', '--json']);
    const suggested = (recall.body as any).result.next.command as string;
    expect(suggested).toContain('maestro session resume --session paused');
    expect(suggested).not.toContain('recall-confirm');
    const resumed = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...suggested.split(' ').slice(1), '--workflow-root', root], { encoding: 'utf8', cwd: resolve('.') });
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(new SessionStore(root).readBundle('paused').session.status).toBe('running');
  });
});
