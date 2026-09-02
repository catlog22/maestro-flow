import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runResponseSchema } from '../run/protocol-schemas.js';
import { SessionStore } from '../run/store.js';
import { createTopicIdentity } from '../run/topic-identity.js';

const MACHINE_CHILD_TIMEOUT_MS = 30_000;
const RELEASE_MACHINE_CHILD_TIMEOUT_MS = 600_000;

function writeSessionSchema(root: string, writer: 'session/1.3' | 'session/3.0'): void {
  mkdirSync(join(root, '.workflow'), { recursive: true });
  writeFileSync(join(root, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer,
      features: { session_statusless: false },
    },
  }));
}

function v2Workspace(root: string): void {
  writeSessionSchema(root, 'session/1.3');
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function invoke(root: string, args: string[]) {
  const result = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...args, '--workflow-root', root], {
    encoding: 'utf8',
    cwd: resolve('.'),
    timeout: MACHINE_CHILD_TIMEOUT_MS,
  });
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return { status: result.status, stderr: result.stderr, lines, body: lines.length === 1 ? runResponseSchema.parse(JSON.parse(lines[0])) : null };
}
function fixture(): { root: string; chain: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-run-machine-')); roots.push(root);

  v2Workspace(root);
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
    const root = mkdtempSync(join(tmpdir(), 'maestro-run-machine-help-'));
    roots.push(root);
    v2Workspace(root);
    const commands = [
      ['run', 'recall-confirm'],
      ['run', 'fork'],
      ['run', 'import'],
      ['run', 'new'],
      ['run', 'rebind'],
    ];
    for (const command of commands) {
      const result = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...command, '--help', '--workflow-root', root], {
        encoding: 'utf8',
        cwd: resolve('.'),
        timeout: MACHINE_CHILD_TIMEOUT_MS,
      });
      expect(result.status, `${command.join(' ')}: ${result.stderr}`).toBe(0);
      const help = result.stdout.replace(/\s+/g, ' ');
      expect(help, command.join(' ')).toContain('[DEPRECATED, ADMIN-ONLY]');
      expect(help, command.join(' ')).toContain('excluded from normal topic resolution');
      expect(help, command.join(' ')).toContain('next-action routing');
      expect(help, command.join(' ')).toMatch(/(?:not a force operation|no force bypass)/);
    }

    const rebind = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'run', 'rebind', '--help', '--workflow-root', root], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    const rebindHelp = rebind.stdout.replace(/\s+/g, ' ');
    expect(rebindHelp).toContain('strictly validates gate and produce compatibility');
    expect(rebindHelp).toContain('--reason is required and recorded in command-rebind.json');
    expect(rebindHelp).not.toContain('prompt-only drift');
  });

  it('emits one stdout envelope for next exits 0, 1, 2, and 3 with empty stderr', () => {
    const { root, chain } = fixture();
    const created = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'session', 'create', 's', '--intent', 'demo', '--chain-file', chain, '--workflow-root', root], {
      encoding: 'utf8',
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    const sessionId = JSON.parse(created.stdout).session_id as string;
    const ok = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const running = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const missing = invoke(root, ['run', 'next', '--session', 'missing', '--json']);
    const emptyCreated = spawnSync(process.execPath, [resolve('bin/maestro.js'), 'session', 'create', 'empty', '--intent', 'empty', '--workflow-root', root], {
      encoding: 'utf8',
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    const emptyId = JSON.parse(emptyCreated.stdout).session_id as string;
    const complete = invoke(root, ['run', 'next', '--session', emptyId, '--json']);
    for (const item of [ok, running, missing, complete]) { expect(item.lines).toHaveLength(1); expect(item.stderr).toBe(''); expect(item.body?.exit_code).toBe(item.status); }
    expect([ok.status, missing.status, complete.status, running.status], JSON.stringify({ ok: ok.body, running: running.body })).toEqual([0, 1, 2, 3]);
    expect(ok.body?.continuation).toMatchObject({
      action: 'load_run', authority: 'automatic', reason_code: 'RUN_ACTIVE',
    });
    expect(running.body?.continuation).toMatchObject({
      action: 'load_run', run_id: (ok.body as any).result.run_id,
    });
    expect(complete.body?.continuation).toMatchObject({
      action: 'seal_session', authority: 'automatic', reason_code: 'CHAIN_COMPLETE',
    });
  });

  it('captures Commander missing arguments and invalid platform in machine mode', () => {
    const { root } = fixture();
    const missing = invoke(root, ['run', 'brief', '--json']);
    const platform = invoke(root, ['run', 'brief', 'missing', '--platform', 'bogus', '--json']);
    expect(missing.body).toMatchObject({ ok: false, exit_code: 2, error: { code: 'COMMANDER_USAGE' } });
    expect(platform.body).toMatchObject({ ok: false, exit_code: 1, error: { code: 'PLATFORM_INVALID' } });
    expect(missing.stderr).toBe(''); expect(platform.stderr).toBe('');
  });

  it('exposes an auditable artifact metadata validation bypass on run check', () => {
    const { root } = fixture();
    writeFileSync(join(root, '.claude', 'commands', 'demo.md'), `<contract>
contract_version: 2
consumes: []
produces:
  - kind: result
    path: outputs/result.json
    role: primary
    required: true
    schema: result/2.0
gates:
  entry: []
  exit: []
</contract>
`);
    const created = invoke(root, ['run', 'create', 'demo', '--json']);
    const locator = (created.body as any).result as { session_id: string; run_id: string };
    const outputDir = join(root, '.workflow', 'sessions', locator.session_id, 'runs', locator.run_id, 'outputs');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'result.json'), JSON.stringify({
      _meta: { kind: 'result', schema: 'result/1.0', role: 'attachment' },
    }));

    const strict = invoke(root, ['run', 'check', locator.run_id, '--session', locator.session_id, '--json']);
    const bypassed = invoke(root, [
      'run', 'check', locator.run_id, '--session', locator.session_id,
      '--skip-artifact-metadata-validation', '--json',
    ]);

    expect((strict.body as any).result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('_meta.schema result/1.0 does not match contract result/2.0'),
      expect.stringContaining('_meta.role attachment does not match contract primary'),
    ]));
    expect((bypassed.body as any).result.errors).toEqual([]);
    expect((bypassed.body as any).result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('artifact metadata validation skipped'),
    ]));
    expect((bypassed.body as any).next.command).toBe(`maestro run check ${locator.run_id}`);
    expect((bypassed.body as any).result).not.toHaveProperty('finish');
    expect(bypassed.body?.continuation).toMatchObject({
      action: 'repair_run',
      reason_code: 'RUN_GATES_BLOCKING',
      command: `maestro run check ${locator.run_id}`,
    });
  });

  it('emits a strict brief-result and one canonical next pointer', () => {
    const { root } = fixture();
    const created = invoke(root, ['run', 'create', 'demo', '--session', 'brief-machine', '--json']);
    const locator = (created.body as any).result as { session_id: string; run_id: string };
    const brief = invoke(root, ['run', 'brief', locator.run_id, '--session', locator.session_id, '--json']);
    expect(brief.body).toMatchObject({
      operation: 'brief',
      ok: true,
      next: { suggest_only: true, command: `maestro run check ${locator.run_id}` },
      result: {
        schema_version: 'brief-result/1.1',
        session: { session_id: locator.session_id, open_decisions: [] },
        run: { run_id: locator.run_id },
        recovery: { next: { suggest_only: true, command: `maestro run check ${locator.run_id}` } },
      },
    });
    expect((brief.body as any).next).toEqual((brief.body as any).result.recovery.next);
    expect(brief.body?.continuation).toMatchObject({
      action: 'execute_run',
      authority: 'automatic',
      reason_code: 'RUN_BRIEF_LOADED',
      command: `maestro run check ${locator.run_id}`,
    });
    for (const removed of ['args', 'argument_requirements', 'reuse_assessments', 'gates', 'outputs']) {
      expect((brief.body as any).result).not.toHaveProperty(removed);
    }
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

  it('routes legacy lease aliases outside the default session/3.0 Run surface', () => {
    const { root } = fixture();
    const created = invoke(root, ['run', 'create', 'demo', '--session', 'legacy-route', '--json']);
    expect(created.status).toBe(0);
    const locator = (created.body as any).result as { session_id: string; run_id: string };
    const store = new SessionStore(root);
    store.update(locator.session_id, draft => {
      draft.session.orchestration.lease = { owner: 'legacy-owner', epoch: 1, id: 'legacy-token' };
    });
    // Existing legacy state remains authoritative even when the project
    // selection is switched back to the default v3 writer for dispatch.
    writeSessionSchema(root, 'session/3.0');

    const completed = invoke(root, [
      'run', 'complete', locator.run_id, '--session', locator.session_id, '--verdict', 'done',
      '--execution-owner', 'legacy-owner', '--owner-epoch', '1', '--lease-id', 'legacy-token', '--json',
    ]);
    expect(completed.status).toBe(0);
    expect(completed.body).toMatchObject({
      schema_version: 'run-response/1.0', operation: 'complete', ok: true,
      result: { run_id: locator.run_id, run_sealed: true },
    });
    expect(store.readRun(locator.session_id, locator.run_id).status).toBe('sealed');
  });

  it('routes a bare shared lease token to the redacted Execution usage boundary', () => {
    const { root } = fixture();
    writeSessionSchema(root, 'session/3.0');
    const secret = 'bare-lease-secret-rv009';
    const result = invoke(root, [
      'run', 'create', 'demo', '--session', 'lease-only', '--lease-id', secret, '--json',
    ]);
    const emitted = `${result.lines.join('\\n')}${result.stderr}${JSON.stringify(result.body)}`;
    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      schema_version: 'run-response/1.1', operation: 'create', ok: false,
      exit_code: 2, disposition: 'usage_error', error: { code: 'COMMANDER_USAGE' },
    });
    expect(emitted).not.toContain(secret);
  });

  it('routes any Execution-exclusive Run option to the Execution alias boundary', () => {
    const { root } = fixture();
    writeSessionSchema(root, 'session/3.0');
    const result = invoke(root, [
      'run', 'create', 'demo', '--session', 'execution-route', '--generation', '1', '--json',
    ]);
    expect(result.status).toBe(2);
    expect(result.body).toMatchObject({
      schema_version: 'run-response/1.1', operation: 'create', ok: false,
      exit_code: 2, disposition: 'usage_error', error: { code: 'COMMANDER_USAGE' },
    });
  });

  it('projects complete transition request and replay metadata at the envelope top level', () => {
    const { root } = fixture();
    const created = invoke(root, ['run', 'create', 'demo', '--json']);
    const locator = (created.body as any).result as { session_id: string; run_id: string };
    const session = new SessionStore(root).readBundle(locator.session_id).session;
    const args = [
      'run', 'complete', locator.run_id,
      '--session', locator.session_id,
      '--verdict', 'done',
      '--request-id', 'req-complete-machine',
      '--expected-identity-revision', String(session.identity_revision),
      '--expected-activity-revision', String(session.activity_revision),
      '--json',
    ];

    const applied = invoke(root, args);
    const replayed = invoke(root, args);

    expect(applied.body).toMatchObject({
      operation: 'complete', ok: true, request_id: 'req-complete-machine', replay: { status: 'applied' },
      continuation: { action: 'seal_session', authority: 'automatic', reason_code: 'CHAIN_COMPLETE' },
    });
    expect(replayed.body).toMatchObject({
      operation: 'complete', ok: true, request_id: 'req-complete-machine', replay: { status: 'replayed' },
    });
    expect(replayed.body?.replay?.transition_id).toBe(applied.body?.replay?.transition_id);
    expect(applied.stderr).toBe('');
    expect(replayed.stderr).toBe('');
  });

  it('continues complete through decide and injects strict constraints into the next Run', () => {
    const { root } = fixture();
    const chain = join(root, 'complete-decide-next.json');
    writeFileSync(chain, JSON.stringify({
      steps: [
        { command: 'demo' },
        { command: 'quality-gate', decision_ref: 'DP-quality' },
        { command: 'demo', args: '--final' },
      ],
      decision_points: [
        { point_id: 'DP-quality', after_step_id: 'step-000-demo', max_retries: 2 },
      ],
    }));
    const created = spawnSync(process.execPath, [
      resolve('bin/maestro.js'), 'session', 'create', 'complete-decide-next',
      '--intent', 'complete decide next', '--chain-file', chain, '--workflow-root', root,
    ], {
      encoding: 'utf8',
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(created.status, created.stderr).toBe(0);
    const sessionId = JSON.parse(created.stdout).session_id as string;

    const first = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const firstRunId = (first.body as any).result.run_id as string;
    const completed = invoke(root, [
      'run', 'complete', firstRunId, '--session', sessionId, '--verdict', 'done', '--json',
    ]);
    expect(completed.body?.continuation).toMatchObject({
      action: 'evaluate_decision',
      authority: 'automatic',
      reason_code: 'DECISION_REQUIRED',
      command: `maestro run next --session ${sessionId} --json`,
    });

    const decisionCard = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    expect(decisionCard.body).toMatchObject({
      operation: 'next',
      ok: false,
      error: { code: 'DECISION_REQUIRED' },
      continuation: {
        action: 'evaluate_decision',
        authority: 'automatic',
        reason_code: 'DECISION_CARD_READY',
        command: null,
        preconditions: expect.arrayContaining([
          'decision_point=DP-quality',
          'do not call run next again for this decision card',
        ]),
      },
    });

    const decided = invoke(root, [
      'run', 'decide', 'DP-quality', '--session', sessionId,
      '--verdict', 'proceed', '--confidence', 'high', '--json',
    ]);
    expect(decided.body?.continuation).toMatchObject({
      action: 'dispatch_next',
      authority: 'automatic',
      reason_code: 'MORE_STEPS',
      command: `maestro run next --session ${sessionId} --json`,
    });

    const second = invoke(root, ['run', 'next', '--session', sessionId, '--json']);
    const secondResult = (second.body as any).result as {
      run_id: string;
      run_already_created: boolean;
      step: { command: string };
      args: string[];
    };
    expect(secondResult).toMatchObject({
      run_already_created: true,
      step: { command: 'demo' },
      args: ['--final'],
    });
    expect(secondResult.run_id).not.toBe(firstRunId);
    expect(second.body?.continuation).toMatchObject({
      action: 'load_run',
      authority: 'automatic',
      run_id: secondResult.run_id,
      preconditions: expect.arrayContaining([
        `run_already_created=${secondResult.run_id}`,
        'execute_command=demo',
        'execute_args=["--final"]',
        'session_goal="complete decide next"',
        'do not call run create or allocate another Run',
      ]),
    });
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
    ], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      previous: { upstream: {}, reuse_assessments: [], selected_refs: [] },
    });
    const store = new SessionStore(root);
    store.createSession('different-topic', 'different topic');
    store.update('different-topic', draft => { draft.session.topic_identity = createTopicIdentity(root, 'different topic'); });
    const mismatch = spawnSync(process.execPath, [
      resolve('bin/maestro.js'), 'run', 'prepare', 'demo', '--session', 'different-topic', '--topic', '共享主题', '--workflow-root', root,
    ], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toMatch(/incompatible|does not match/i);
    store.createSession('topic-peer', '共享主题');
    store.update('topic-peer', draft => { draft.session.topic_identity = createTopicIdentity(root, '共享主题'); });
    const ambiguous = invoke(root, ['run', 'create', 'demo', '--topic', '共享主题', '--json']);
    expect(ambiguous.body).toMatchObject({ operation: 'create', ok: false, exit_code: 1 });
    expect(ambiguous.stderr).toBe('');
  });

  it('emits one envelope for check decide and seal-session exits', () => {
    const { root } = fixture();
    const created = invoke(root, ['run', 'create', 'demo', '--json']);
    const createdResult = (created.body as any).result as { session_id: string; run_id: string };
    const check = invoke(root, ['run', 'check', createdResult.run_id, '--session', createdResult.session_id, '--json']);
    const checkMissing = invoke(root, ['run', 'check', 'missing', '--json']);

    const store = new SessionStore(root);
    store.createSession('decision', 'decision');
    store.update('decision', draft => {
      draft.session.orchestration.decision_points.push({
        point_id: 'DP-1', after_step_id: null, status: 'pending', retry_count: 0, max_retries: 2, evidence_ref: null,
      });
      draft.session.orchestration.chain.push({
        step_id: 'step-000-decision', command: 'decision', status: 'pending', run_id: null,
        inserted_by: 'test', decision_ref: 'DP-1',
      });
    });
    const decision = store.readBundle('decision').session;
    const decideArgs = [
      'run', 'decide', 'DP-1', '--session', 'decision', '--verdict', 'proceed', '--confidence', 'high',
      '--request-id', 'req-decide-machine',
      '--expected-identity-revision', String(decision.identity_revision),
      '--expected-activity-revision', String(decision.activity_revision),
      '--json',
    ];
    const decide = invoke(root, decideArgs);
    const decideReplay = invoke(root, decideArgs);
    const decideMissing = invoke(root, [
      'run', 'decide', 'DP-X', '--session', 'missing', '--verdict', 'proceed', '--confidence', 'high', '--json',
    ]);

    store.createSession('seal-ok', 'seal ok');
    const seal = invoke(root, ['run', 'seal-session', 'seal-ok', '--json']);
    store.createSession('seal-blocked', 'seal blocked');
    const unsealed = invoke(root, ['run', 'create', 'demo', '--session', 'seal-blocked', '--json']);
    expect(unsealed.status).toBe(0);
    const sealBlocked = invoke(root, ['run', 'seal-session', 'seal-blocked', '--json']);

    for (const item of [check, checkMissing, decide, decideReplay, decideMissing, seal, sealBlocked]) {
      expect(item.lines).toHaveLength(1);
      expect(item.stderr).toBe('');
      expect(item.body?.schema_version).toBe('run-response/1.0');
      expect(item.body?.exit_code).toBe(item.status);
    }
    expect(check.body).toMatchObject({ operation: 'check', ok: true, exit_code: 0 });
    expect(checkMissing.body).toMatchObject({ operation: 'check', ok: false, exit_code: 1, error: { code: 'RUN_NOT_FOUND' } });
    expect(decide.body).toMatchObject({
      operation: 'decide', ok: true, replay: { status: 'applied' }, request_id: 'req-decide-machine',
      continuation: { action: 'seal_session', authority: 'automatic', reason_code: 'CHAIN_COMPLETE' },
    });
    expect(decideReplay.body).toMatchObject({
      operation: 'decide', ok: true, replay: { status: 'replayed' },
      continuation: { action: 'seal_session', authority: 'automatic', reason_code: 'CHAIN_COMPLETE' },
    });
    expect(decideMissing.body).toMatchObject({ operation: 'decide', ok: false, error: { code: 'SESSION_NOT_FOUND' } });
    expect(seal.body).toMatchObject({
      operation: 'seal-session',
      ok: true,
      result: {
        status: 'sealed',
        knowledge: {
          pending_candidates: 0,
          promoting_candidates: 0,
          promoted_candidates: 0,
          review_command: 'maestro knowledge review seal-ok',
        },
      },
    });
    expect(sealBlocked.body).toMatchObject({ operation: 'seal-session', ok: false, error: { code: 'SESSION_SEAL_BLOCKED' } });
  });

  it('treats omitted check run-id as active-target resolution, not Commander usage', () => {
    const { root } = fixture();
    const result = invoke(root, ['run', 'check', '--json']);
    expect(result.lines).toHaveLength(1);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.body).toMatchObject({
      operation: 'check',
      ok: false,
      exit_code: 1,
    });
    expect((result.body as any).error.code).not.toBe('COMMANDER_USAGE');
  });

  it('captures every Commander usage exit in machine mode', () => {
    const { root } = fixture();
    const cases = [
      { args: ['run', 'decide', '--json'], operation: 'decide' },
      { args: ['run', 'seal-session', '--json'], operation: 'seal-session' },
      { args: ['run', 'accept-reuse', 'missing', '--json'], operation: 'accept-reuse' },
      { args: ['run', 'check', 'missing', '--unknown-option', '--json'], operation: 'check' },
    ];
    for (const item of cases) {
      const result = invoke(root, item.args);
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

  it('never reflects secret-bearing Commander argv in 1.0 or 1.1 envelopes', () => {
    const { root } = fixture();
    const cases = [
      {
        args: ['run', 'fork', '--confirmation-token', 'confirmation-secret-rv009', '--json'],
        schema: 'run-response/1.0',
        secrets: ['confirmation-secret-rv009'],
      },
      {
        args: ['run', 'create', 'demo', '--retry-token', 'retry-secret-rv009', '--unknown-option', '--json'],
        schema: 'run-response/1.0',
        secrets: ['retry-secret-rv009'],
      },
      {
        args: ['execution', 'handoff', 'accept', '--handoff-token', 'handoff-secret-rv009', '--json'],
        schema: 'run-response/1.1',
        operation: 'execution-handoff-accept',
        secrets: ['handoff-secret-rv009'],
      },
      {
        args: [
          'execution', 'pause', '--lease-id', 'lease-secret-rv009',
          '--claim-output', join(root, 'private', 'claim-secret-rv009.json'), '--json',
        ],
        schema: 'run-response/1.1',
        secrets: ['lease-secret-rv009', 'claim-secret-rv009.json'],
      },
    ];

    for (const item of cases) {
      const result = invoke(root, item.args);
      const emitted = `${result.lines.join('\n')}${result.stderr}${JSON.stringify(result.body)}`;
      expect(result.status, emitted).toBe(2);
      expect(result.lines).toHaveLength(1);
      expect(result.stderr).toBe('');
      expect(result.body).toMatchObject({
        schema_version: item.schema,
        ...(item.operation ? { operation: item.operation } : {}),
        ok: false,
        exit_code: 2,
        error: { code: 'COMMANDER_USAGE' },
      });
      expect((result.body as any).error.details).toEqual({ commander_code: expect.any(String) });
      for (const secret of item.secrets) expect(emitted).not.toContain(secret);
    }
  });

  it('publishes human Execution claims privately in a fresh process and refuses existing targets', () => {
    const { root } = fixture();
    const store = new SessionStore(root);
    store.createSession('fresh-claim', 'fresh claim');
    const common = [
      'execution', 'start', '--session', 'fresh-claim', '--request-id', 'req-fresh-claim',
      '--expected-identity-revision', '1', '--expected-activity-revision', '0',
      '--execution-owner', 'manual-fresh', '--owner-kind', 'manual', '--expected-lease-epoch', '0',
      '--actor', 'manual-fresh', '--reason', 'fresh claim', '--evidence', 'TEST-fresh-claim',
      '--workflow-root', root,
    ];
    const started = spawnSync(process.execPath, [resolve('bin/maestro.js'), ...common], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(started.status, started.stderr).toBe(0);
    expect(started.stderr).toBe('');
    const projected = JSON.parse(started.stdout) as { claim_output: string; lease_claim: null };
    const privateClaim = JSON.parse(readFileSync(projected.claim_output, 'utf8')) as { lease_id: string };
    expect(projected.lease_claim).toBeNull();
    expect(started.stdout).not.toContain(privateClaim.lease_id);
    if (process.platform !== 'win32') {
      expect(statSync(join(root, '.workflow', 'tmp', 'claims')).mode & 0o777).toBe(0o700);
      expect(statSync(projected.claim_output).mode & 0o777).toBe(0o600);
    }

    store.createSession('fresh-existing', 'fresh existing target');
    const existing = join(root, 'private', 'existing-claim.json');
    mkdirSync(join(root, 'private'), { recursive: true });
    writeFileSync(existing, 'do-not-replace\n');
    const refused = spawnSync(process.execPath, [
      resolve('bin/maestro.js'),
      'execution', 'start', '--session', 'fresh-existing', '--request-id', 'req-fresh-existing',
      '--expected-identity-revision', '1', '--expected-activity-revision', '0',
      '--execution-owner', 'manual-fresh', '--owner-kind', 'manual', '--expected-lease-epoch', '0',
      '--actor', 'manual-fresh', '--reason', 'fresh existing', '--evidence', 'TEST-fresh-existing',
      '--claim-output', existing, '--workflow-root', root,
    ], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('Unable to prepare private claim output securely');
    expect(refused.stderr).not.toContain(existing);
    expect(readFileSync(existing, 'utf8')).toBe('do-not-replace\n');
    expect(store.readOpenExecution('fresh-existing')).toBeNull();
  });

  it('rejects the non-machine mutations --json flag instead of succeeding silently', () => {
    const { root } = fixture();
    const result = spawnSync(process.execPath, [
      resolve('bin/maestro.js'), 'run', 'mutations', '--json', '--workflow-root', root,
    ], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^error: unknown option '--json'\r?\n$/);
  });

  it('passes the build-backed release machine child-process smoke', () => {
    const result = spawnSync(process.execPath, [
      resolve('scripts/check-session-run-release-machine.mjs'),
    ], {
      encoding: 'utf8',
      cwd: resolve('.'),
      timeout: RELEASE_MACHINE_CHILD_TIMEOUT_MS,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('session-run release machine parity passed');
  }, RELEASE_MACHINE_CHILD_TIMEOUT_MS);
});
