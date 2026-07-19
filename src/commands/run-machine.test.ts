import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runResponseSchema } from '../run/protocol-schemas.js';
import { SessionStore } from '../run/store.js';
import { createTopicIdentity } from '../run/topic-identity.js';

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
  it('marks legacy mutation and recovery commands deprecated admin-only in help', () => {
    const commands = [
      ['run', 'recall-confirm'],
      ['run', 'fork'],
      ['run', 'import'],
      ['run', 'new'],
      ['run', 'rebind'],
      ['session', 'resolve'],
      ['session', 'resume'],
    ];
    for (const command of commands) {
      const result = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...command, '--help'], { encoding: 'utf8', cwd: resolve('.') });
      expect(result.status, `${command.join(' ')}: ${result.stderr}`).toBe(0);
      const help = result.stdout.replace(/\s+/g, ' ');
      expect(help, command.join(' ')).toContain('[DEPRECATED, ADMIN-ONLY]');
      expect(help, command.join(' ')).toContain('excluded from normal topic resolution');
      expect(help, command.join(' ')).toContain('next-action routing');
      expect(help, command.join(' ')).toMatch(/(?:not a force operation|no force bypass)/);
    }

    const rebind = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'run', 'rebind', '--help'], { encoding: 'utf8', cwd: resolve('.') });
    const rebindHelp = rebind.stdout.replace(/\s+/g, ' ');
    expect(rebindHelp).toContain('strictly validates gate and produce compatibility');
    expect(rebindHelp).toContain('--reason is required and recorded in command-rebind.json');
    expect(rebindHelp).not.toContain('prompt-only drift');
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
    expect(recall.body).toMatchObject({
      operation: 'recall',
      ok: true,
      exit_code: 0,
      result: {
        schema_version: 'run-recall/1.1',
        exact_candidates: [{ session_id: 'live', eligible_actions: [], next_if_active: null }],
        recommendation: { action: null, automatic: false },
        confirmation: { required: false, issuance_command: '', allowed_actions: [] },
        next: { suggest_only: true, command: null },
      },
    });
    expect(JSON.stringify((recall.body as any).result)).not.toMatch(/maestro (?:run|session) (?:recall-confirm|fork|import|new|rebind|resolve|resume|create)/);
    expect(complete.stderr).toBe(''); expect(recall.stderr).toBe('');
  });

  it('keeps a paused topic Session outside automatic read-only routing', () => {
    const { root } = fixture();
    const store = new SessionStore(root);
    store.createSession('paused', 'paused intent', { command: 'demo' });
    store.update('paused', draft => { draft.session.status = 'paused'; });
    const recall = invoke(root, ['run', 'recall', 'demo', '--intent', 'paused intent', '--as-of', '2026-07-19T00:00:00.000Z', '--json']);
    const serialized = JSON.stringify((recall.body as any).result);
    expect((recall.body as any).result).toMatchObject({
      exact_candidates: [],
      recommendation: { action: null, automatic: false, reason_codes: expect.arrayContaining(['NO_RUNNING_TOPIC_MATCH']) },
      confirmation: { required: false, allowed_actions: [] },
      next: { suggest_only: true, command: null },
    });
    expect(serialized).not.toContain('maestro session resume');
    expect(serialized).not.toContain('recall-confirm');
    expect(serialized).not.toMatch(/maestro run (?:fork|import|new|rebind)/);
    expect(new SessionStore(root).readBundle('paused').session.status).toBe('paused');
  });

  it('wraps create success and topic ambiguity errors in run-response/1.0', () => {
    const { root } = fixture();
    const first = invoke(root, ['run', 'create', 'demo', '--topic', '共享主题', '--json']);
    expect(first.body).toMatchObject({ operation: 'create', ok: true, exit_code: 0, result: { topic_identity: { normalized: '共享主题' } } });
    const prepared = spawnSync(process.execPath, [
      resolve('bin/maestro.js'), 'run', 'prepare', 'demo', '--topic', '共享主题', '--workflow-root', root,
    ], { encoding: 'utf8', cwd: resolve('.') });
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      previous: { upstream: {}, reuse_assessments: [], selected_refs: [] },
    });
    const store = new SessionStore(root);
    store.createSession('different-topic', 'different topic');
    store.update('different-topic', draft => { draft.session.topic_identity = createTopicIdentity(root, 'different topic'); });
    const mismatch = spawnSync(process.execPath, [
      resolve('bin/maestro.js'), 'run', 'prepare', 'demo', '--session', 'different-topic', '--topic', '共享主题', '--workflow-root', root,
    ], { encoding: 'utf8', cwd: resolve('.') });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toMatch(/incompatible|does not match/i);
    store.createSession('topic-peer', '共享主题');
    store.update('topic-peer', draft => { draft.session.topic_identity = createTopicIdentity(root, '共享主题'); });
    const ambiguous = invoke(root, ['run', 'create', 'demo', '--topic', '共享主题', '--json']);
    expect(ambiguous.body).toMatchObject({ operation: 'create', ok: false, exit_code: 1 });
    expect(ambiguous.stderr).toBe('');
  });
});
