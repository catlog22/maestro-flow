import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Command } from 'commander';
import { createSessionState } from './defaults.js';
import { sessionStateSchema } from './schemas.js';
import { SessionStore } from './store.js';
import { checkRun, completeRun, createRun, sealSession } from './runtime.js';
import { registerRunCommand } from '../commands/run.js';
import { resolveCommandSource } from './contract.js';
import { migrateV1toV2, readStateJson, writeStateJson } from '../utils/state-schema.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-run-'));
  roots.push(path);
  return path;
}

function commandFile(projectRoot: string, name: string, contract: string): void {
  const dir = join(projectRoot, '.claude', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
}

function writePlanRun(projectRoot: string, sessionId: string, runId: string): void {
  const dir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(dir, 'outputs', 'plan.json'), JSON.stringify({
    _meta: { kind: 'plan', schema: 'plan/1.0', role: 'primary', alias: 'current-plan' },
    tasks: [{ id: 'T1' }],
  }, null, 2));
  writeFileSync(join(dir, 'report.md'), `---
verdict: ready
summary: Plan ready
constraints:
  - id: C1
    text: TypeScript strict mode
    status: locked
decisions:
  - id: D1
    text: Use the canonical Run store
    status: accepted
concerns: []
next:
  - command: execute
    reason: plan sealed
    needs: [current-plan]
---
## 摘要
Plan ready.
`, 'utf8');
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('Session/Run runtime', () => {
  it('registers canonical create/check/complete CLI subcommands', () => {
    const program = new Command();
    registerRunCommand(program);
    const run = program.commands.find(command => command.name() === 'run');
    expect(run?.commands.map(command => command.name())).toEqual(['create', 'check', 'complete', 'seal-session']);
  });

  it('parses every migrated core command contract', () => {
    const names = [
      'maestro-analyze', 'maestro-plan', 'maestro-execute', 'maestro-verify',
      'quality-review', 'quality-test', 'quality-debug',
    ];
    for (const name of names) {
      const source = resolveCommandSource(process.cwd(), name);
      expect(source.relativePath).toBe(`.claude/commands/${name}.md`);
      expect(source.contract.produces.length).toBeGreaterThan(0);
    }
  });

  it('accepts command flags after -- as Run input arguments', async () => {
    const projectRoot = root();
    const program = new Command();
    registerRunCommand(program);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync([
      'node', 'maestro', 'run', 'create', 'empty',
      '--workflow-root', projectRoot, '--', '-y', '--depth', 'deep',
    ]);
    const created = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    const run = new SessionStore(projectRoot).readRun(created.session_id, created.run_id);
    expect(run.input.args).toEqual(['-y', '--depth', 'deep']);
    output.mockRestore();
  });

  it('uses strict protocol schemas', () => {
    const valid = createSessionState('20260713-demo', 'demo');
    expect(sessionStateSchema.parse(valid).schema_version).toBe('session/1.0');
    expect(() => sessionStateSchema.parse({ ...valid, unexpected: true })).toThrow(/unrecognized/i);
  });

  it('allocates stable per-session sequence numbers and creates protected authority files', () => {
    const projectRoot = root();
    const first = createRun({ projectRoot, command: 'empty', intent: 'sequence demo' });
    const second = createRun({ projectRoot, command: 'empty', intent: 'sequence demo' });

    expect(first.session_id).toBe(second.session_id);
    expect(first.run_id).toContain('-001-');
    expect(second.run_id).toContain('-002-');
    const sessionDir = join(projectRoot, '.workflow', 'sessions', first.session_id);
    for (const name of ['session.json', 'gates.json', 'artifacts.json', 'evidence.json']) {
      expect(existsSync(join(sessionDir, name))).toBe(true);
    }
    expect(readdirSync(join(sessionDir, '.backups')).length).toBeGreaterThan(0);
    const store = new SessionStore(projectRoot);
    expect(store.readRun(first.session_id, second.run_id).sequence).toBe(2);
  });

  it('checks gates idempotently and derives canonical artifacts, handoff, and evidence', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'demo-plan', `consumes: []
produces:
  - kind: plan
    primary: true
    path: outputs/plan.json
    alias: current-plan
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'demo-plan', intent: 'plan demo' });

    const missing = checkRun(projectRoot, created.run_id);
    expect(missing.gates.blocking).toHaveLength(1);
    const blocked = completeRun(projectRoot, created.run_id);
    expect(blocked.sealed).toBe(false);
    expect(blocked.status).toBe('blocked');

    writePlanRun(projectRoot, created.session_id, created.run_id);
    const firstCheck = checkRun(projectRoot, created.run_id);
    const gateRevision = JSON.parse(readFileSync(
      join(projectRoot, '.workflow', 'sessions', created.session_id, 'gates.json'),
      'utf8',
    )).revision;
    const secondCheck = checkRun(projectRoot, created.run_id);
    const secondRevision = JSON.parse(readFileSync(
      join(projectRoot, '.workflow', 'sessions', created.session_id, 'gates.json'),
      'utf8',
    )).revision;
    expect(firstCheck.gates.blocking).toEqual([]);
    expect(secondCheck.gates).toEqual(firstCheck.gates);
    expect(secondRevision).toBe(gateRevision);

    const completed = completeRun(projectRoot, created.run_id);
    expect(completed.sealed).toBe(true);
    expect(completed.primary_artifact_id).toMatch(/^ART-001-/);

    const sessionDir = join(projectRoot, '.workflow', 'sessions', created.session_id);
    const artifacts = JSON.parse(readFileSync(join(sessionDir, 'artifacts.json'), 'utf8'));
    const evidence = JSON.parse(readFileSync(join(sessionDir, 'evidence.json'), 'utf8'));
    const run = JSON.parse(readFileSync(join(sessionDir, 'runs', created.run_id, 'run.json'), 'utf8'));
    const state = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'state.json'), 'utf8'));

    expect(artifacts.aliases['current-plan']).toBe(completed.primary_artifact_id);
    expect(run.handoff.summary).toBe('Plan ready');
    expect(run.handoff.next[0].needs).toEqual(['current-plan']);
    expect(Object.values(evidence.records).some((record: any) => record.point === 'D1')).toBe(true);
    expect(state.artifacts).toEqual([]);
    expect(state.sessions.some((session: any) => session.session_id === created.session_id)).toBe(true);
  });

  it('does not consume legacy state artifacts as Run upstream', () => {
    const projectRoot = root();
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    const state = migrateV1toV2({ project_name: 'legacy', status: 'active' });
    state.artifacts.push({
      id: 'PLN-007',
      type: 'plan',
      milestone: null,
      phase: null,
      scope: 'standalone',
      path: 'old-registry/plan.json',
      status: 'completed',
      depends_on: null,
      harvested: true,
      created_at: '2026-07-13T00:00:00+08:00',
      completed_at: '2026-07-13T00:00:00+08:00',
    });
    writeStateJson(projectRoot, state);
    commandFile(projectRoot, 'consume-plan', `consumes:
  - kind: plan
    alias: current-plan
    required: true
    require_status: sealed
produces: []
gates:
  entry: []
  exit: []`);

    const created = createRun({ projectRoot, command: 'consume-plan', intent: 'canonical only' });
    expect(created.upstream).toEqual({});
    expect(created.entry_gates.blocking).not.toEqual([]);
  });

  it('reuses only a running Session with the same normalized intent', () => {
    const projectRoot = root();
    const first = createRun({ projectRoot, command: 'empty', intent: 'Auth Refactor' });
    const unrelated = createRun({ projectRoot, command: 'empty', intent: 'Billing Refactor' });
    const resumed = createRun({ projectRoot, command: 'empty', intent: 'auth-refactor' });

    expect(unrelated.session_id).not.toBe(first.session_id);
    expect(resumed.session_id).toBe(first.session_id);
  });

  it('detects mutations to sealed outputs and rejects a second completion', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'immutable-plan', `consumes: []
produces:
  - kind: plan
    primary: true
    path: outputs/plan.json
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'immutable-plan', intent: 'immutable' });
    writePlanRun(projectRoot, created.session_id, created.run_id);
    expect(completeRun(projectRoot, created.run_id).sealed).toBe(true);
    expect(() => completeRun(projectRoot, created.run_id)).toThrow(/sealed and immutable/i);

    const output = join(
      projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'outputs', 'plan.json',
    );
    const changed = JSON.parse(readFileSync(output, 'utf8'));
    changed.tasks.push({ id: 'T2' });
    writeFileSync(output, JSON.stringify(changed, null, 2));
    expect(() => checkRun(projectRoot, created.run_id)).toThrow(/immutable|artifact set changed/i);
  });

  it('seals a Session only after every Run is sealed and clears the active pointer', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'seal-demo', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const created = createRun({ projectRoot, command: 'seal-demo', intent: 'seal demo' });
    expect(() => sealSession(projectRoot, created.session_id)).toThrow(/unsealed Runs/i);
    writeFileSync(join(
      projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'report.md',
    ), '---\nverdict: ready\nsummary: done\n---\n', 'utf8');
    expect(completeRun(projectRoot, created.run_id).sealed).toBe(true);
    const sealed = sealSession(projectRoot, created.session_id, 'All work complete');
    expect(sealed.status).toBe('sealed');
    const session = new SessionStore(projectRoot).readBundle(created.session_id).session;
    const state = readStateJson(projectRoot);
    expect(session.lifecycle.seal_summary).toBe('All work complete');
    expect(state?.active_session_id).toBeNull();
    expect(state?.sessions?.find(item => item.session_id === created.session_id)?.status).toBe('sealed');
  });

  it('rejects corrupted authoritative JSON through runtime validation', () => {
    const projectRoot = root();
    const created = createRun({ projectRoot, command: 'empty', intent: 'corruption' });
    const path = join(projectRoot, '.workflow', 'sessions', created.session_id, 'session.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.extra = true;
    writeFileSync(path, JSON.stringify(value, null, 2));
    expect(() => new SessionStore(projectRoot).readBundle(created.session_id)).toThrow(/unrecognized/i);
  });
});
