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
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { Command } from 'commander';
import { createSessionState } from './defaults.js';
import { sessionStateSchema } from './schemas.js';
import { briefResultV11Schema, commandRebindAuditSchema, executionContractSchema } from './protocol-schemas.js';
import { SessionStore } from './store.js';
import {
  acceptRunReuse,
  briefRun,
  checkRun,
  completeRun,
  createRun,
  prepareStep,
  rebindRunCommand,
  resolveTopicSessionId,
  sealSession,
} from './runtime.js';
import { registerRunCommand } from '../commands/run.js';
import { invalidateResolutionCache, resolveCommandSource } from './contract.js';
import { migrateV1toV2, readStateJson, writeStateJson } from '../utils/state-schema.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

interface LegacyAttachmentFixture {
  producer: { command: string; sealed_contract: string; current_contract: string };
  review: { command: string; contract: string; required_role: 'primary' };
  authority: {
    output: { _meta: { kind: string; schema: string; role: 'attachment'; alias: string }; changes: unknown[] };
    contract_snapshot: { normalized: { produces: Array<{ role: 'attachment' }> } };
    registry: { kind: string; schema_version: string; role: 'attachment'; status: 'sealed' };
  };
  expected_reason_codes: string[];
}

const legacyAttachmentFixture = JSON.parse(readFileSync(
  new URL('./__fixtures__/sealed-legacy-attachment-execution.json', import.meta.url),
  'utf8',
)) as LegacyAttachmentFixture;

const migratedStepAssociations = {
  'maestro-analyze': 'analyze',
  'quality-auto-test': 'auto-test',
  'maestro-blueprint': 'blueprint',
  'maestro-brainstorm': 'brainstorm',
  'quality-debug': 'debug',
  'maestro-execute': 'execute',
  'maestro-grill': 'grill',
  'maestro-plan': 'plan',
  'quality-retrospective': 'retrospective',
  'quality-review': 'review',
  'maestro-roadmap': 'roadmap',
  'quality-test': 'test',
  'maestro-verify': 'verify',
} as const;

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-run-'));

  v2Workspace(path);
  roots.push(path);
  return path;
}

function commandFile(projectRoot: string, name: string, contract: string): void {
  const dir = join(projectRoot, '.claude', 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `<contract>\n${contract}\n</contract>\n`, 'utf8');
}

/** Write a prepare file with refs frontmatter for the given workflow base. */
function writePrepareWithRefs(
  projectRoot: string,
  base: string,
  refs: Array<{ path: string; when: string }>,
  contract?: string,
): void {
  const dir = join(projectRoot, 'prepare');
  mkdirSync(dir, { recursive: true });
  const refLines = refs.map(r => `  - path: ${r.path}\n    when: ${r.when}`).join('\n');
  writeFileSync(join(dir, `${base}.md`), `---\nrefs:\n${refLines}\n---\n${contract ? `<contract>\n${contract}\n</contract>\n` : ''}# prepare ${base}\n`, 'utf8');
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
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe('Session/Run runtime', () => {
  it('registers canonical lifecycle CLI subcommands', () => {
    const program = new Command();
    registerRunCommand(program);
    const run = program.commands.find(command => command.name() === 'run');
    expect(run?.commands.map(command => command.name())).toEqual([
      'start',
      'status',
      'recover',
      'done',
      'edit',
      'prepare',
      'next',
      'create',
      'check',
      'rebind',
      'complete',
      'brief',
      'accept-reuse',
      'recall',
      'recall-confirm',
      'fork',
      'import',
      'new',
      'skill',
      'decide',
      'seal-session',
      'log-mutation',
      'mutations',
    ]);
  });

  it('projects session/1.x status and active Run without 2.0 Execution pointers', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'projection', 'consumes: []\nproduces: []\ngates: { entry: [], exit: [] }');
    const created = createRun({ projectRoot, command: 'projection', intent: 'legacy projection' });
    const entry = readStateJson(projectRoot)?.sessions?.find(item => item.session_id === created.session_id);
    expect(entry).toMatchObject({
      session_schema_version: 'session/1.3', status: 'running', active_run_id: created.run_id,
    });
    expect(entry).not.toHaveProperty('current_execution_id');
    expect(entry).not.toHaveProperty('latest_execution_id');
  });

  it('parses every migrated core command contract', () => {
    for (const [command, step] of Object.entries(migratedStepAssociations)) {
      const source = resolveCommandSource(process.cwd(), command);
      // Pin the PROJECT source: a migrated command must resolve to the repo's
      // own prepare file, never a user-global ~/.maestro mirror.
      expect(source.relativePath).toBe(`prepare/${step}.md`);
      expect(source.contract.produces.length).toBeGreaterThan(0);
      for (const consume of source.contract.consumes) {
        expect(consume.schema, `${command} consumes ${consume.kind} must declare schema`).toBeTruthy();
        expect(consume.role, `${command} consumes ${consume.kind} must declare role`).toBeTruthy();
      }
    }
  });

  it('declares schema and role on every v2/v2.1 consumes entry across all prepare contracts', () => {
    const prepareDir = join(process.cwd(), 'prepare');
    let checked = 0;
    for (const file of readdirSync(prepareDir).filter((name) => name.endsWith('.md'))) {
      const contract = resolveCommandSource(process.cwd(), file.replace(/\.md$/, '')).contract;
      if ((contract.contract_version ?? 1) === 1) continue;
      for (const consume of contract.consumes) {
        checked++;
        expect(consume.schema, `${file} consumes ${consume.kind} must declare schema`).toBeTruthy();
        expect(consume.role, `${file} consumes ${consume.kind} must declare role`).toBeTruthy();
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('loads installed global Claude contracts without losing project precedence', () => {
    const projectRoot = root();
    const claudeHome = root();
    vi.stubEnv('MAESTRO_CLAUDE_HOME', claudeHome);
    const globalCommandDir = join(claudeHome, 'commands');
    mkdirSync(globalCommandDir, { recursive: true });
    const globalContract = `<contract>
contract_version: 2
consumes: []
produces:
  - kind: global-plan
    path: outputs/global-plan.json
    role: primary
    required: true
    schema: global-plan/1.0
gates:
  entry: []
  exit: []
</contract>
`;
    const globalCommandPath = join(globalCommandDir, 'installed-plan.md');
    writeFileSync(globalCommandPath, globalContract, 'utf8');

    const created = createRun({ projectRoot, command: 'installed-plan', intent: 'installed command' });
    const run = new SessionStore(projectRoot).readRun(created.session_id, created.run_id);
    const emptyHash = createHash('sha256').update('').digest('hex');
    expect(run.command.source_path.replaceAll('\\', '/')).toMatch(/\/commands\/installed-plan\.md$/);
    expect(run.command.content_hash).toBe(createHash('sha256').update(globalContract).digest('hex'));
    expect(run.command.contract_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.command.content_hash).not.toBe(emptyHash);
    expect(checkRun(projectRoot, created.run_id).gates.blocking).toHaveLength(2);

    const globalSkillDir = join(claudeHome, 'skills', 'installed-skill');
    mkdirSync(globalSkillDir, { recursive: true });
    writeFileSync(join(globalSkillDir, 'SKILL.md'), `<contract>
consumes: []
produces:
  - kind: global-skill
gates:
  entry: []
  exit: []
</contract>
`, 'utf8');
    const globalSkill = resolveCommandSource(projectRoot, 'installed-skill');
    expect(globalSkill.path).toBe(join(globalSkillDir, 'SKILL.md'));
    expect(globalSkill.contract.produces[0]?.kind).toBe('global-skill');

    commandFile(projectRoot, 'installed-plan', `consumes: []
produces:
  - kind: project-plan
gates:
  entry: []
  exit: []`);
    const projectSource = resolveCommandSource(projectRoot, 'installed-plan');
    expect(projectSource.path).toBe(join(projectRoot, '.claude', 'commands', 'installed-plan.md'));
    expect(projectSource.contract.produces[0]?.kind).toBe('project-plan');
  });

  it('allows prompt-only definition drift but rejects lifecycle contract drift', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'prompt-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'prompt-drift', intent: 'prompt drift' });
    const path = join(projectRoot, '.claude', 'commands', 'prompt-drift.md');
    writeFileSync(path, '\n# Documentation-only edit\n', { flag: 'a' });

    const promptDriftCheck = checkRun(projectRoot, created.run_id);
    expect(promptDriftCheck.gates.blocking).toEqual([]);
    expect(promptDriftCheck.warnings).toContainEqual(expect.stringContaining('lifecycle contract is unchanged'));
    expect(completeRun(projectRoot, created.run_id).sealed).toBe(true);

    commandFile(projectRoot, 'contract-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const changed = createRun({ projectRoot, command: 'contract-drift', intent: 'contract drift' });
    commandFile(projectRoot, 'contract-drift', `consumes: []
produces:
  - kind: changed-output
gates:
  entry: []
  exit: []`);
    expect(() => checkRun(projectRoot, changed.run_id)).toThrow(/lifecycle contract changed/);
  });

  it('audits prompt-only and equivalent snapshot/hash rebinds', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'audited-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const promptOnly = createRun({ projectRoot, command: 'audited-drift', intent: 'audited drift' });
    const promptPath = join(projectRoot, '.claude', 'commands', 'audited-drift.md');
    writeFileSync(promptPath, '\n# Whitespace-only guidance edit\n', { flag: 'a' });

    const promptRebind = rebindRunCommand(projectRoot, promptOnly.run_id, 'refresh prompt snapshot');
    expect(promptRebind).toMatchObject({
      rebind_kind: 'prompt_only_rebind',
      old_contract_hash: promptRebind.contract_hash,
      old_snapshot_hash: promptRebind.snapshot_hash,
    });
    const promptAudit = commandRebindAuditSchema.parse(JSON.parse(readFileSync(join(
      projectRoot, '.workflow', 'sessions', promptOnly.session_id, 'runs', promptOnly.run_id, 'command-rebind.json',
    ), 'utf8')));
    expect(promptAudit).toMatchObject({
      schema_version: 'command-rebind/1.1',
      rebind_kind: 'prompt_only_rebind',
      reason: 'refresh prompt snapshot',
      old_contract_snapshot: expect.objectContaining({ schema_version: 'contract-snapshot/1.0' }),
      contract_snapshot: expect.objectContaining({ schema_version: 'contract-snapshot/1.0' }),
      old_guidance_snapshot: expect.objectContaining({ schema_version: 'guidance-snapshot/1.0' }),
      guidance_snapshot: expect.objectContaining({ schema_version: 'guidance-snapshot/1.0' }),
    });
    expect(checkRun(projectRoot, promptOnly.run_id).warnings).not.toContainEqual(
      expect.stringContaining('Command prompt changed'),
    );
    expect(() => rebindRunCommand(projectRoot, promptOnly.run_id, 'repeat')).toThrow(/already bound/);

    commandFile(projectRoot, 'representation-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const representation = createRun({
      projectRoot,
      command: 'representation-drift',
      intent: 'representation drift',
    });
    const representationPath = join(
      projectRoot, '.workflow', 'sessions', representation.session_id, 'runs', representation.run_id, 'run.json',
    );
    const representationRun = JSON.parse(readFileSync(representationPath, 'utf8'));
    representationRun.command.contract_hash = 'b'.repeat(64);
    representationRun.contract_snapshot.snapshot_hash = `sha256:${'c'.repeat(64)}`;
    writeFileSync(representationPath, JSON.stringify(representationRun, null, 2));

    const representationRebind = rebindRunCommand(
      projectRoot,
      representation.run_id,
      'accept equivalent normalized representation',
    );
    expect(representationRebind.rebind_kind).toBe('compatible_contract_rebind');
    expect(representationRebind.old_contract_hash).toBe('b'.repeat(64));
    expect(representationRebind.old_snapshot_hash).toBe(`sha256:${'c'.repeat(64)}`);
    expect(checkRun(projectRoot, representation.run_id).errors).toEqual([]);

    commandFile(projectRoot, 'hash-only-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const hashOnly = createRun({ projectRoot, command: 'hash-only-drift', intent: 'hash only drift' });
    const hashOnlyPath = join(
      projectRoot, '.workflow', 'sessions', hashOnly.session_id, 'runs', hashOnly.run_id, 'run.json',
    );
    const hashOnlyRun = JSON.parse(readFileSync(hashOnlyPath, 'utf8'));
    hashOnlyRun.command.contract_hash = 'd'.repeat(64);
    hashOnlyRun.contract_snapshot = null;
    writeFileSync(hashOnlyPath, JSON.stringify(hashOnlyRun, null, 2));

    const hashOnlyRebind = rebindRunCommand(projectRoot, hashOnly.run_id, 'upgrade hash-only authority');
    expect(hashOnlyRebind).toMatchObject({
      rebind_kind: 'compatible_contract_rebind',
      old_contract_hash: 'd'.repeat(64),
      old_snapshot_hash: null,
    });
    expect(checkRun(projectRoot, hashOnly.run_id).errors).toEqual([]);
  });

  it('keeps legacy no-hash rebind compatible and records a full authority audit', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'legacy-drift', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'legacy-drift', intent: 'legacy drift' });
    const runPath = join(
      projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'run.json',
    );
    const legacy = JSON.parse(readFileSync(runPath, 'utf8'));
    delete legacy.command.contract_hash;
    legacy.contract_snapshot = null;
    writeFileSync(runPath, JSON.stringify(legacy, null, 2));
    writeFileSync(join(projectRoot, '.claude', 'commands', 'legacy-drift.md'), '\n# Prompt edit\n', { flag: 'a' });

    expect(() => checkRun(projectRoot, created.run_id)).toThrow(/maestro run rebind/);
    const rebound = rebindRunCommand(projectRoot, created.run_id, 'accept documentation-only edit');
    expect(rebound.rebind_kind).toBe('legacy_contract_backfill');
    expect(rebound.contract_hash).toMatch(/^[a-f0-9]{64}$/);
    const audit = JSON.parse(readFileSync(join(
      projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'command-rebind.json',
    ), 'utf8'));
    expect(audit).toMatchObject({
      schema_version: 'command-rebind/1.1',
      run_id: created.run_id,
      rebind_kind: 'legacy_contract_backfill',
      reason: 'accept documentation-only edit',
      old_contract_hash: null,
      old_snapshot_hash: null,
      contract_snapshot: expect.objectContaining({ schema_version: 'contract-snapshot/1.0' }),
      old_guidance_snapshot: expect.objectContaining({ schema_version: 'guidance-snapshot/1.0' }),
      guidance_snapshot: expect.objectContaining({ schema_version: 'guidance-snapshot/1.0' }),
    });
    expect(checkRun(projectRoot, created.run_id).gates.blocking).toEqual([]);
  });

  it('rejects gate drift, produce semantics drift, sealed Runs and empty reasons', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'legacy-incompatible', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const incompatible = createRun({ projectRoot, command: 'legacy-incompatible', intent: 'legacy incompatible' });
    const incompatiblePath = join(
      projectRoot, '.workflow', 'sessions', incompatible.session_id, 'runs', incompatible.run_id, 'run.json',
    );
    const incompatibleRun = JSON.parse(readFileSync(incompatiblePath, 'utf8'));
    delete incompatibleRun.command.contract_hash;
    writeFileSync(incompatiblePath, JSON.stringify(incompatibleRun, null, 2));
    commandFile(projectRoot, 'legacy-incompatible', `consumes: []
produces:
  - kind: new-required-output
gates:
  entry: []
  exit: []`);
    expect(() => rebindRunCommand(projectRoot, incompatible.run_id, 'unsafe change')).toThrow(/different Run gate set/);

    commandFile(projectRoot, 'produce-drift', `consumes: []
produces:
  - kind: result
    path: outputs/old.json
gates:
  entry: []
  exit: []`);
    const produceDrift = createRun({ projectRoot, command: 'produce-drift', intent: 'produce drift' });
    commandFile(projectRoot, 'produce-drift', `consumes: []
produces:
  - kind: result
    path: outputs/new.json
gates:
  entry: []
  exit: []`);
    expect(() => rebindRunCommand(projectRoot, produceDrift.run_id, 'unsafe produce change')).toThrow(
      /contract semantics differ/,
    );

    commandFile(projectRoot, 'sealed-rebind', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const sealed = createRun({ projectRoot, command: 'sealed-rebind', intent: 'sealed rebind' });
    expect(completeRun(projectRoot, sealed.run_id).sealed).toBe(true);
    expect(() => rebindRunCommand(projectRoot, sealed.run_id, 'too late')).toThrow(/sealed and immutable/);
    expect(() => rebindRunCommand(projectRoot, produceDrift.run_id, '   ')).toThrow(/non-empty reason/);
  });

  it('resolves every migrated command through workflow YAML associations', () => {
    for (const [command, step] of Object.entries(migratedStepAssociations)) {
      const prepared = prepareStep(process.cwd(), command);
      expect(prepared.prepare?.path).toBe(join(process.cwd(), 'prepare', `${step}.md`));
      expect(prepared.workflow?.path).toBe(join(process.cwd(), 'workflows', `${step}.md`));
    }
  });

  it('keeps intent as Session metadata while merging --arg and positional command inputs', async () => {
    const projectRoot = root();
    const program = new Command();
    registerRunCommand(program);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync([
      'node', 'maestro', 'run', 'create', 'empty',
      '--session', 'cli-args',
      '--intent', 'session metadata only',
      '--arg', 'explicit-input',
      '--workflow-root', projectRoot,
      '--', 'positional-input', '-y', '--depth', 'deep',
    ]);
    const created = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    const store = new SessionStore(projectRoot);
    const run = store.readRun(created.session_id, created.run_id);
    expect(run.input.args).toEqual(['explicit-input', 'positional-input', '-y', '--depth', 'deep']);
    expect(run.input.args).not.toContain('session metadata only');
    expect(store.readBundle(created.session_id).session.intent).toBe('session metadata only');
    expect(run.schema_version).toBe('command-run/1.3');
    expect(run.contract_snapshot?.schema_version).toBe('contract-snapshot/1.0');
    output.mockRestore();
  });

  it('uses strict protocol schemas with passthrough fallback for unknown versions', () => {
    const valid = createSessionState('20260713-demo', 'demo');
    expect(sessionStateSchema.parse(valid).schema_version).toBe('session/1.3');
    // Known version with unknown top-level field → strict rejection
    expect(() => sessionStateSchema.parse({ ...valid, unexpected: true })).toThrow(/unrecognized|passthrough fallback/i);
    const ralph = structuredClone(valid);
    ralph.ralph_authority = { schema_version: 'ralph-authority/1.0', engine: 'ralph', canonical_complete: true };
    expect(sessionStateSchema.parse(ralph).ralph_authority?.canonical_complete).toBe(true);
    expect(() => sessionStateSchema.parse({
      ...ralph,
      ralph_authority: { ...ralph.ralph_authority, engine: 'manual' },
    })).toThrow();
    const invalidDecision = structuredClone(valid);
    invalidDecision.orchestration.decision_points = [{
      point_id: 'D1',
      after_step_id: null,
      status: 'unknown',
      retry_count: 0,
      max_retries: 2,
      evidence_ref: null,
    }];
    expect(() => sessionStateSchema.parse(invalidDecision)).toThrow(/pending|passed|escalated|passthrough fallback/);
    // Unknown future version → passthrough fallback preserves all fields
    const futureSession = { ...valid, schema_version: 'session/9.0', future_field: 'preserved' };
    const parsed = sessionStateSchema.parse(futureSession);
    expect(parsed.schema_version).toBe('session/9.0');
    expect((parsed as any).future_field).toBe('preserved');
  });

  it('allocates stable per-session sequence numbers and creates protected authority files', () => {
    const projectRoot = root();
    const first = createRun({ projectRoot, command: 'empty', intent: 'sequence demo' });
    expect(completeRun(projectRoot, first.run_id, first.session_id).sealed).toBe(true);
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

  it('commits authority before idempotent Session projections', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const sessionId = 'projection-repair';
    const intent = 'projection repair';
    const projectionStore = store as unknown as {
      ensureSessionProjections: (targetSessionId: string, targetIntent: string) => void;
    };
    const projectionFailure = vi.spyOn(projectionStore, 'ensureSessionProjections')
      .mockImplementationOnce(() => { throw new Error('injected projection failure'); });

    expect(() => store.createSession(sessionId, intent)).toThrow(/injected projection failure/);
    expect(store.sessionExists(sessionId)).toBe(true);
    const sessionDir = store.sessionDir(sessionId);
    for (const name of ['session.json', 'gates.json', 'artifacts.json', 'evidence.json']) {
      expect(existsSync(join(sessionDir, name))).toBe(true);
    }
    expect(existsSync(join(sessionDir, 'runs'))).toBe(false);
    expect(existsSync(join(sessionDir, 'context.md'))).toBe(false);
    const committed = store.readBundle(sessionId);
    projectionFailure.mockRestore();

    const reused = store.createSession(sessionId, intent, { ifExists: 'reuse' });

    expect(reused).toEqual(committed);
    expect(reused.session.session_id).toBe(sessionId);
    expect(['runs', 'specs', 'knowhow'].every(name => existsSync(join(sessionDir, name)))).toBe(true);
    expect(readFileSync(join(sessionDir, 'events.ndjson'), 'utf8')).toBe('');
    expect(readFileSync(join(sessionDir, 'context.md'), 'utf8')).toBe(`# ${intent}\n`);
  });

  it('checks gates idempotently and derives canonical artifacts, handoff, and evidence', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'demo-plan', `contract_version: 2
consumes: []
produces:
  - kind: plan
    path: outputs/plan.json
    alias: current-plan
    role: primary
    required: true
    schema: plan/1.0
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'demo-plan', intent: 'plan demo' });
    expect(created.next.command).toBe(`maestro run brief ${created.run_id}`);
    expect(created.next.reason).toContain('maestro run check');

    const missing = checkRun(projectRoot, created.run_id);
    expect(missing.gates.blocking).toHaveLength(2);
    const blocked = completeRun(projectRoot, created.run_id);
    expect(blocked.sealed).toBe(false);
    expect(blocked.status).toBe('blocked');
    expect(blocked.next_action).toMatchObject({ suggest_only: true, action: 'repair_run' });
    expect(blocked.next_action?.command).toBe(`maestro run check ${created.run_id}`);

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
    expect(completed.next_action).toMatchObject({ suggest_only: true, action: 'seal_session' });

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
    expect(created.next.command).toBe(`maestro run brief ${created.run_id}`);
    expect(created.next.reason).toContain('blocking');
  });

  it('reuses only a running Session with the same normalized intent', () => {
    const projectRoot = root();
    const first = createRun({ projectRoot, command: 'empty', intent: 'Auth Refactor' });
    const unrelated = createRun({ projectRoot, command: 'empty', intent: 'Billing Refactor' });
    expect(completeRun(projectRoot, first.run_id, first.session_id).sealed).toBe(true);
    const resumed = createRun({ projectRoot, command: 'empty', intent: 'auth refactor' });

    expect(unrelated.session_id).not.toBe(first.session_id);
    expect(resumed.session_id).toBe(first.session_id);
  });

  it('does not resolve a pre-authority partial Session shell by topic', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const sessionId = 'partial-topic-shell';
    const sessionDir = store.sessionDir(sessionId);
    mkdirSync(join(sessionDir, 'runs'), { recursive: true });
    writeFileSync(join(sessionDir, 'context.md'), '# Partial Topic\n');

    expect(store.sessionExists(sessionId)).toBe(false);
    expect(resolveTopicSessionId(projectRoot, 'Partial Topic')).toBeNull();

    store.createSession(sessionId, 'Partial Topic');
    expect(resolveTopicSessionId(projectRoot, 'Partial Topic')).toBe(sessionId);
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

  it('emits the next pointer and injects the finish checklist only when check passes', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'finish-demo', `contract_version: 2
consumes: []
produces:
  - kind: plan
    path: outputs/plan.json
    alias: current-plan
    role: primary
    required: true
    schema: plan/1.0
gates:
  entry: []
  exit: []`);
    const workflowDir = join(projectRoot, 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'finish-demo.md'), `---
name: finish-demo
prepare: finish-demo
commands: [finish-demo]
finish:
  - Confirm every fix commit references its finding ID.
---
# Workflow: finish demo
`, 'utf8');

    const created = createRun({ projectRoot, command: 'finish-demo', intent: 'finish demo' });
    const blocked = checkRun(projectRoot, created.run_id);
    expect(blocked.gates.blocking).toHaveLength(2);
    expect(blocked.next?.command).toBe(`maestro run check ${created.run_id}`);
    expect(blocked.finish).toBeUndefined();

    writePlanRun(projectRoot, created.session_id, created.run_id);
    const clean = checkRun(projectRoot, created.run_id);
    expect(clean.gates.blocking).toEqual([]);
    expect(clean.next?.command).toBe(`maestro run complete ${created.run_id}`);
    expect(clean.finish?.some(line => line.includes('finding ID'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('maestro knowledge stage'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('--signal cited|validated|contradicted'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('spec supersede'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('spec conflict mark'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('Do not write project spec/knowhow directly'))).toBe(true);
    expect(clean.finish?.some(line => line.includes('handoff frontmatter is empty'))).toBe(false);

    completeRun(projectRoot, created.run_id);
    const sealed = checkRun(projectRoot, created.run_id);
    expect(sealed.next?.command).toBe(`maestro run next --session ${created.session_id}`);
    expect(sealed.finish).toBeUndefined();

    commandFile(projectRoot, 'bare-demo', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const bare = createRun({ projectRoot, command: 'bare-demo', intent: 'bare demo' });
    const bareCheck = checkRun(projectRoot, bare.run_id);
    expect(bareCheck.finish?.[0]).toContain('handoff frontmatter is empty');
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
    expect(sealed.knowledge).toEqual({
      pending_candidates: 0,
      promoting_candidates: 0,
      promoted_candidates: 0,
      review_required_candidates: 0,
      conflict_candidates: 0,
      suppressed_candidates: 0,
      review_command: `maestro knowledge review ${created.session_id}`,
    });
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
    expect(() => new SessionStore(projectRoot).readBundle(created.session_id)).toThrow(/unrecognized|passthrough fallback/i);
  });

  it('brief exposes consumed upstream, the previous handoff, and the session anchor', () => {
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
    commandFile(projectRoot, 'demo-exec', `consumes:
  - kind: plan
    alias: current-plan
    required: false
produces: []
gates:
  entry: []
  exit: []`);
    // Prepare refs for demo-exec drive the brief deferred-reading manifest (G3).
    writePrepareWithRefs(projectRoot, 'demo-exec', [
      { path: 'docs/schema.md', when: 'before touching the store' },
    ], `consumes:
  - kind: plan
    alias: current-plan
    required: false
produces: []
gates:
  entry: []
  exit: []`);

    const planRun = createRun({ projectRoot, command: 'demo-plan', intent: 'brief anchor demo' });
    writePlanRun(projectRoot, planRun.session_id, planRun.run_id);
    expect(completeRun(projectRoot, planRun.run_id).sealed).toBe(true);

    const execRun = createRun({ projectRoot, command: 'demo-exec', sessionId: planRun.session_id, intent: 'brief anchor demo' });
    expect(execRun.upstream['current-plan']).toBeDefined();

    const brief = briefRun(projectRoot, execRun.run_id, execRun.session_id);
    // upstream reverse-lookup by consumed artifact ids
    expect(brief.upstream['current-plan']?.kind).toBe('plan');
    const currentPlan = brief.execution_contract.inputs.find(input => input.alias === 'current-plan')?.resolved;
    expect(currentPlan).toBeDefined();
    expect(currentPlan?.kind).toBe('plan');
    // previous sealed handoff
    expect(brief.continuity.prev_handoff?.run_id).toBe(planRun.run_id);
    expect(brief.continuity.prev_handoff?.summary).toBe('Plan ready');
    // anchor grounding — intent always present; boundary empty here
    expect(brief.continuity.anchor.intent).toBe('**Intent**: brief anchor demo');
    expect(brief.continuity.anchor.boundary_contract).toBeNull();
    // deferred-reading refs manifest (G3)
    expect(brief.guidance.refs).toEqual([{ path: 'docs/schema.md', when: 'before touching the store' }]);
    // next pointer for a live Run — check gate, not seal (G4)
    expect(brief.recovery.next.command).toBe(`maestro run check ${execRun.run_id}`);
    expect(brief.recovery.next.reason).toContain('does not seal');
    expect(brief.recovery.next.reason).toContain(`maestro run complete ${execRun.run_id}`);
  });

  it('persists caller-supplied creation authority for confirmation-driven consumers', () => {
    const projectRoot = root();
    const sourceHash = `sha256:${'a'.repeat(64)}`;
    const created = createRun({
      projectRoot,
      command: 'empty',
      sessionId: 'import-target',
      intent: 'import target',
      creation: {
        requestId: 'req-import-1',
        mode: 'import',
        authority: 'confirmation-token',
        confirmationTokenHash: sourceHash,
        provenance: {
          schema_version: 'creation-provenance/1.0',
          provenance: 'import',
          source_workspace_id: sourceHash,
          source_session_id: 'source-session',
          source_run_id: 'source-run',
          imported_artifact_hashes: [sourceHash],
        },
        transition: null,
      },
    });
    const run = new SessionStore(projectRoot).readRun(created.session_id, created.run_id);
    expect(run.creation_decision).toMatchObject({
      request_id: 'req-import-1', mode: 'import', authority: 'confirmation-token',
    });
    expect(run.creation_provenance).toMatchObject({
      provenance: 'import', source_session_id: 'source-session', source_run_id: 'source-run',
    });
  });

  it('brief additively exposes an independently executable execution-contract/1.1', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'self-contained', `consumes:
  - kind: context
    alias: current-context
    required: true
    require_status: sealed
produces:
  - kind: result
    alias: latest-result
    primary: true
    path: outputs/result.json
    schema: result/1.0
gates:
  entry:
    - key: approval
      title: Approval required
      required: true
      blocking: true
      applicable_modes: []
      check:
        type: manual
        prompt: Approve execution
  exit: []`);
    const workflowDir = join(projectRoot, 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'self-contained.md'), '# Execution manual\n\nPerform the bounded task.\n', 'utf8');
    const created = createRun({
      projectRoot, command: 'self-contained', intent: 'self-contained brief', args: ['--target', 'core'],
    });

    const brief = briefRun(projectRoot, created.run_id, created.session_id);
    expect(brief.schema_version).toBe('brief-result/1.1');
    expect(brief.execution_contract.invocation.args).toEqual(['--target', 'core']);
    expect(brief.guidance.prepare).toBeNull();
    expect(brief.guidance.workflow?.content).toContain('Perform the bounded task');
    expect(brief.guidance.freshness).toMatchObject({ status: 'none', changed: [] });
    expect(brief.knowledge_context).toMatchObject({
      schema_version: 'knowledge-reconciliation-card/1.0',
      run: { unique_inputs: 0 },
      session: { pending_candidates: 0 },
      policy: {
        search_and_injection: 'exposure_only',
        explicit_load: 'consumed',
        completion: 'stage_candidates',
        promotion: 'explicit_review',
      },
    });
    expect(briefResultV11Schema.parse(brief)).toEqual(brief);
    for (const removed of ['command', 'goal', 'args', 'argument_requirements', 'reuse_assessments', 'gates', 'outputs']) {
      expect(brief).not.toHaveProperty(removed);
    }
    expect(brief.execution_contract).toMatchObject({
      schema_version: 'execution-contract/1.1',
      command: 'self-contained',
      invocation: { args: ['--target', 'core'] },
      guidance: { workflow_path: expect.stringContaining('self-contained.md') },
      freshness: { identity_current: true },
    });
    expect(brief.execution_contract.inputs).toEqual([
      expect.objectContaining({
        kind: 'context', alias: 'current-context', required: true, require_status: 'sealed', resolved: null,
      }),
    ]);
    expect(brief.execution_contract.outputs.declared).toEqual([
      expect.objectContaining({ kind: 'result', alias: 'latest-result', primary: true, schema: 'result/1.0' }),
    ]);
    expect(brief.execution_contract.contract.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('v1 produces[0].schema is metadata-only'),
    ]));
    expect(brief.execution_contract.gates.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Approval required', scope: 'entry', blocking: true }),
    ]));
    expect(() => executionContractSchema.parse({
      ...brief.execution_contract,
      schema_version: 'execution-contract/2.0',
    })).toThrow();
  });

  it('reports guidance drift and fails recovery closed on unresolved Session authority', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'drift-demo', `consumes: []
produces: []
gates:
  entry: []
  exit: []`);
    const workflowDir = join(projectRoot, 'workflows');
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(workflowDir, 'drift-demo.md'), '# Workflow\n\nOriginal guidance.\n', 'utf8');
    writeFileSync(join(workflowDir, 'run-mode.md'), '# Run mode\n\n## Completion\n\nRun check, then complete.\n', 'utf8');
    const created = createRun({ projectRoot, command: 'drift-demo', intent: 'drift-safe brief' });

    writeFileSync(join(workflowDir, 'drift-demo.md'), '# Workflow\n\nChanged guidance.\n', 'utf8');
    invalidateResolutionCache();
    const store = new SessionStore(projectRoot);
    store.update(created.session_id, draft => {
      draft.session.orchestration.decision_points.push({
        point_id: 'DP-BRIEF',
        after_step_id: null,
        status: 'pending',
        retry_count: 0,
        max_retries: 1,
        evidence_ref: null,
      });
      draft.session.orchestration.chain.push({
        step_id: 'step-001-decision',
        command: 'decision',
        status: 'pending',
        run_id: null,
        inserted_by: 'test',
        decision_ref: 'DP-BRIEF',
      });
    });

    const brief = briefRun(projectRoot, created.run_id, created.session_id);
    expect(brief.guidance.workflow?.content).toContain('Changed guidance');
    expect(brief.guidance.run_mode?.hash).toBeTruthy();
    expect(brief.guidance.freshness).toMatchObject({ status: 'changed', changed: ['workflow'] });
    expect(brief.session.open_decisions).toEqual([
      expect.objectContaining({ point_id: 'DP-BRIEF', status: 'pending' }),
    ]);
    expect(brief.recovery.next).toMatchObject({
      suggest_only: true,
      command: `maestro run check ${created.run_id}`,
    });

    expect(completeRun(projectRoot, created.run_id, created.session_id).sealed).toBe(true);
    const decision = briefRun(projectRoot, created.run_id, created.session_id);
    expect(decision.recovery.next.command).toBe(`maestro run next --session ${created.session_id}`);
    expect(decision.recovery.next.reason).toContain('unresolved decision DP-BRIEF');

    store.update(created.session_id, draft => { draft.session.status = 'paused'; });
    const paused = briefRun(projectRoot, created.run_id, created.session_id);
    expect(paused.session.status).toBe('paused');
    expect(paused.recovery.next).toMatchObject({ command: null });
    expect(paused.recovery.next.reason).toContain('is paused');
  });

  it('enforces command-contract/2.0 role, required output and schema metadata', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'strict-output', `contract_version: 2
consumes: []
produces:
  - kind: result
    path: outputs/result.json
    alias: strict-result
    role: primary
    required: true
    schema: result/2.0
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'strict-output', intent: 'strict output' });
    const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
    writeFileSync(join(runDir, 'outputs', 'result.json'), JSON.stringify({
      _meta: { kind: 'result', schema: 'result/1.0', role: 'attachment', alias: 'wrong-result' },
      ok: true,
    }, null, 2));
    const rejected = checkRun(projectRoot, created.run_id, created.session_id);
    expect(rejected.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('_meta.schema result/1.0 does not match contract result/2.0'),
      expect.stringContaining('_meta.role attachment does not match contract primary'),
      expect.stringContaining('_meta.alias wrong-result does not match contract strict-result'),
    ]));

    const bypassed = checkRun(projectRoot, created.run_id, created.session_id, {
      skipArtifactMetadataValidation: true,
    });
    expect(bypassed.errors).toEqual([]);
    expect(bypassed.artifacts).toEqual([
      expect.objectContaining({ kind: 'result', role: 'attachment', alias: 'wrong-result' }),
    ]);
    expect(bypassed.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('artifact metadata validation skipped: outputs/result.json: _meta.schema'),
      expect.stringContaining('artifact metadata validation skipped: outputs/result.json: _meta.role'),
      expect.stringContaining('artifact metadata validation skipped: outputs/result.json: _meta.alias'),
    ]));
    expect(bypassed.next?.command).toBe(`maestro run check ${created.run_id}`);
    expect(bypassed.finish).toBeUndefined();
    expect(existsSync(join(runDir, '.check_clean'))).toBe(false);

    rmSync(join(runDir, 'outputs', 'result.json'));
    const missingRequired = checkRun(projectRoot, created.run_id, created.session_id, {
      skipArtifactMetadataValidation: true,
    });
    expect(missingRequired.errors).toContain('Missing required contract v2 output: outputs/result.json');

    writeFileSync(join(runDir, 'outputs', 'result.json'), JSON.stringify({
      _meta: { kind: 'result', schema: 'result/2.0', role: 'primary', alias: 'strict-result' },
      ok: true,
    }, null, 2));
    expect(checkRun(projectRoot, created.run_id, created.session_id).errors).toEqual([]);
  });

  it('keeps artifact metadata skip diagnostic-only during completion', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'strict-complete', `contract_version: 2
consumes: []
produces:
  - kind: result
    path: outputs/result.json
    alias: strict-result
    role: primary
    required: true
    schema: result/2.0
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'strict-complete', intent: 'strict completion' });
    const store = new SessionStore(projectRoot);
    const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
    const outputPath = join(runDir, 'outputs', 'result.json');
    writeFileSync(outputPath, JSON.stringify({
      _meta: { kind: 'legacy-result', schema: 'result/1.0', role: 'attachment', alias: 'wrong-result' },
    }));

    const strict = completeRun(projectRoot, created.run_id, created.session_id);
    expect(strict.sealed).toBe(false);
    expect(strict.errors).not.toEqual([]);
    const registryBeforeDiagnosticCompletion = structuredClone(store.readBundle(created.session_id).artifacts);

    const diagnosticOption = completeRun(projectRoot, created.run_id, created.session_id, {
      skipArtifactMetadataValidation: true,
    });
    expect(diagnosticOption.sealed).toBe(false);
    expect(diagnosticOption.primary_artifact_id).toBeNull();
    expect(diagnosticOption.artifact_ids).toEqual([]);
    expect(diagnosticOption.artifacts).toEqual([
      expect.objectContaining({ kind: 'legacy-result', role: 'attachment', alias: 'wrong-result' }),
    ]);
    expect(diagnosticOption.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('_meta.kind legacy-result does not match contract result'),
      expect.stringContaining('_meta.schema result/1.0 does not match contract result/2.0'),
      expect.stringContaining('_meta.role attachment does not match contract primary'),
      expect.stringContaining('_meta.alias wrong-result does not match contract strict-result'),
    ]));
    expect(diagnosticOption.warnings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('artifact metadata validation skipped'),
    ]));
    expect(store.readBundle(created.session_id).artifacts).toEqual(registryBeforeDiagnosticCompletion);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))._meta).toEqual({
      kind: 'legacy-result', schema: 'result/1.0', role: 'attachment', alias: 'wrong-result',
    });
  });

  it('keeps sealed legacy attachment authority rejected when current review requires primary', () => {
    const fixture = legacyAttachmentFixture;
    const projectRoot = root();
    commandFile(projectRoot, fixture.producer.command, fixture.producer.sealed_contract);
    commandFile(projectRoot, fixture.review.command, fixture.review.contract);

    const producer = createRun({
      projectRoot,
      command: fixture.producer.command,
      sessionId: 'legacy-role',
      intent: 'legacy execution role regression',
    });
    const store = new SessionStore(projectRoot);
    const producerDir = store.runDir(producer.session_id, producer.run_id);
    writeFileSync(
      join(producerDir, 'outputs', 'execution.json'),
      JSON.stringify(fixture.authority.output, null, 2),
      'utf8',
    );
    writeFileSync(join(producerDir, 'report.md'), [
      '---', 'verdict: ready', 'summary: sealed legacy execution', 'constraints: []',
      'decisions: []', 'concerns: []', 'next: []', '---', '',
    ].join('\n'), 'utf8');

    const sealed = completeRun(projectRoot, producer.run_id, producer.session_id);
    expect(sealed.sealed).toBe(true);
    const producerRun = store.readRun(producer.session_id, producer.run_id);
    const registered = store.readBundle(producer.session_id).artifacts.artifacts[sealed.artifact_ids[0]];
    expect(fixture.authority.output._meta.role).toBe('attachment');
    expect(producerRun.contract_snapshot?.normalized.produces[0]).toMatchObject({ role: 'attachment' });
    expect(registered).toMatchObject(fixture.authority.registry);

    commandFile(projectRoot, fixture.producer.command, fixture.producer.current_contract);
    invalidateResolutionCache();
    const review = createRun({
      projectRoot,
      command: fixture.review.command,
      sessionId: producer.session_id,
      intent: 'legacy execution role regression',
    });
    const assessment = review.reuse_assessments[0];
    expect(assessment).toMatchObject({
      decision: 'REJECT',
      reason_codes: fixture.expected_reason_codes,
      source_fence: { artifact_role: 'attachment' },
      consumer: { role: fixture.review.required_role },
    });
    expect(review.upstream).toEqual({});

    expect(() => acceptRunReuse(
      projectRoot,
      review.run_id,
      assessment.assessment_hash,
      review.session_id,
      {
        actor: 'reviewer',
        reason: 'attempted force acceptance',
        evidence: ['outputs/review.json'],
      },
    )).toThrow(/is REJECT, expected REVIEW/);
    expect(store.readRun(review.session_id, review.run_id).input.consumes).toEqual([]);
  });

  it('matches required contract path templates against produced artifacts', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'templated-output', `contract_version: 2
consumes: []
produces:
  - kind: plan-task
    path: outputs/tasks/TASK-{NNN}.json
    role: attachment
    required: true
    schema: plan-task/1.0
gates:
  entry: []
  exit: []`);
    const created = createRun({ projectRoot, command: 'templated-output', intent: 'templated output' });
    const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
    mkdirSync(join(runDir, 'outputs', 'tasks'), { recursive: true });
    writeFileSync(join(runDir, 'outputs', 'tasks', 'TASK-001.json'), JSON.stringify({
      _meta: { kind: 'plan-task', schema: 'plan-task/1.0', role: 'attachment' },
    }));
    const secondTaskPath = join(runDir, 'outputs', 'tasks', 'TASK-002.json');
    writeFileSync(secondTaskPath, JSON.stringify({
      _meta: { kind: 'plan-task', schema: 'plan-task/2.0', role: 'attachment' },
    }));

    const rejected = checkRun(projectRoot, created.run_id, created.session_id);
    expect(rejected.errors).toContain(
      'outputs/tasks/TASK-002.json: _meta.schema plan-task/2.0 does not match contract plan-task/1.0',
    );

    writeFileSync(secondTaskPath, JSON.stringify({
      _meta: { kind: 'plan-task', schema: 'plan-task/1.0', role: 'attachment' },
    }));
    const checked = checkRun(projectRoot, created.run_id, created.session_id);

    expect(checked.errors).toEqual([]);
    expect(checked.artifacts.filter(item => item.kind === 'plan-task')).toHaveLength(2);
  });

  it('brief of a sealed Run points next at run next to advance the chain (G4)', () => {
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

    const planRun = createRun({ projectRoot, command: 'demo-plan', intent: 'sealed brief demo' });
    writePlanRun(projectRoot, planRun.session_id, planRun.run_id);
    expect(completeRun(projectRoot, planRun.run_id).sealed).toBe(true);

    const brief = briefRun(projectRoot, planRun.run_id, planRun.session_id);
    expect(brief.run.status).toBe('sealed');
    expect(brief.recovery.next.command).toBe(`maestro run next --session ${planRun.session_id}`);
    expect(brief.recovery.next.reason).toContain('run sealed');
  });

  it('prepare --session attaches the previous handoff and consume status; bare prepare is unchanged', () => {
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
    commandFile(projectRoot, 'demo-exec', `consumes:
  - kind: plan
    alias: current-plan
    required: true
produces: []
gates:
  entry: []
  exit: []`);

    const bare = prepareStep(projectRoot, 'demo-exec');
    expect(bare.previous).toBeUndefined();
    expect(bare.session_guidance).toBeUndefined();

    const planRun = createRun({ projectRoot, command: 'demo-plan', intent: 'prepare session demo' });
    writePlanRun(projectRoot, planRun.session_id, planRun.run_id);
    expect(completeRun(projectRoot, planRun.run_id).sealed).toBe(true);

    const withSession = prepareStep(projectRoot, 'demo-exec', undefined, planRun.session_id);
    // bare-content fields identical to the stateless call
    expect(withSession.prepare).toEqual(bare.prepare);
    expect(withSession.workflow).toEqual(bare.workflow);
    // previous context populated from latest_completed_run_id + contract consumes
    expect(withSession.previous?.handoff?.run_id).toBe(planRun.run_id);
    const consume = withSession.previous?.consumes.find(c => c.alias === 'current-plan');
    expect(consume).toMatchObject({ kind: 'plan', required: true, present: true, status: 'sealed' });
    expect(withSession.session_guidance).toMatchObject({
      session_id: planRun.session_id,
      status: 'running',
      latest_completed_run_id: planRun.run_id,
      current_step: null,
      open_decisions: [],
      knowledge: {
        unique_inputs: 0,
        pending_candidates: 2,
        corroborated_candidates: 0,
        promoting_candidates: 0,
        review_command: `maestro knowledge review ${planRun.session_id}`,
      },
      next: {
        command: `maestro run seal-session ${planRun.session_id}`,
        reason: 'chain has no pending execution steps',
      },
    });
  });

  it('complete --note merges into handoff concerns with de-duplication', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'note-demo', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const created = createRun({ projectRoot, command: 'note-demo', intent: 'note merge' });
    writeFileSync(join(
      projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'report.md',
    ), '---\nverdict: ready\nsummary: done\nconcerns:\n  - existing concern\n---\n', 'utf8');

    const completed = completeRun(projectRoot, created.run_id, undefined, {
      notes: ['existing concern', 'fresh note', 'fresh note'],
    });
    expect(completed.sealed).toBe(true);
    const run = new SessionStore(projectRoot).readRun(created.session_id, created.run_id);
    expect(run.handoff?.concerns).toEqual(['existing concern', 'fresh note']);
  });

  it('complete --artifact registers extra evidence and rejects out-of-bounds paths', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'art-demo', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const created = createRun({ projectRoot, command: 'art-demo', intent: 'extra artifact' });
    const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
    writeFileSync(join(runDir, 'report.md'), '---\nverdict: ready\nsummary: done\n---\n', 'utf8');
    writeFileSync(join(runDir, 'evidence', 'trace.log'), 'trace lines\n', 'utf8');

    // out-of-bounds path is rejected before any state change
    expect(() => completeRun(projectRoot, created.run_id, undefined, {
      extraArtifacts: ['../../escape.txt'],
    })).toThrow(/escapes run directory/i);
    // missing path is rejected
    expect(() => completeRun(projectRoot, created.run_id, undefined, {
      extraArtifacts: ['evidence/missing.log'],
    })).toThrow(/does not exist/i);

    const completed = completeRun(projectRoot, created.run_id, undefined, {
      extraArtifacts: ['evidence/trace.log'],
    });
    expect(completed.sealed).toBe(true);
    const artifacts = JSON.parse(readFileSync(
      join(projectRoot, '.workflow', 'sessions', created.session_id, 'artifacts.json'), 'utf8',
    ));
    const extra = Object.values(artifacts.artifacts).find((a: any) => a.relative_path.endsWith('evidence/trace.log')) as any;
    expect(extra).toBeDefined();
    expect(extra.kind).toBe('trace');
    expect(extra.role).toBe('evidence');
  });

  it('complete --artifact accepts a CWD-relative path that lands inside the run directory', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'art-cwd', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const created = createRun({ projectRoot, command: 'art-cwd', intent: 'cwd relative evidence' });
    const runDir = join(projectRoot, '.workflow', 'sessions', created.session_id, 'runs', created.run_id);
    writeFileSync(join(runDir, 'evidence', 'trace.log'), 'trace lines\n', 'utf8');

    // Callers pass shell-CWD-relative paths by habit; the run-relative reading
    // misses, but the CWD reading reaches a file inside the run directory.
    const prevCwd = process.cwd();
    process.chdir(projectRoot);
    try {
      const completed = completeRun(projectRoot, created.run_id, undefined, {
        extraArtifacts: [join('.workflow', 'sessions', created.session_id, 'runs', created.run_id, 'evidence', 'trace.log')],
      });
      expect(completed.sealed).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('complete --artifact errors name the run-directory resolution base', () => {
    const projectRoot = root();
    commandFile(projectRoot, 'art-msg', `consumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []`);
    const created = createRun({ projectRoot, command: 'art-msg', intent: 'error message base' });
    expect(() => completeRun(projectRoot, created.run_id, undefined, {
      extraArtifacts: ['evidence/missing.log'],
    })).toThrow(/relative paths resolve against the run directory/i);
  });

  it('surfaces complete --note as a review assessment and in the next prev handoff', () => {
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
    commandFile(projectRoot, 'demo-exec', `consumes:
  - kind: plan
    alias: current-plan
    required: false
produces: []
gates:
  entry: []
  exit: []`);

    const planRun = createRun({ projectRoot, command: 'demo-plan', intent: 'closed loop' });
    writePlanRun(projectRoot, planRun.session_id, planRun.run_id);
    const done = completeRun(projectRoot, planRun.run_id, undefined, { notes: ['watch the migration order'] });
    expect(done.sealed).toBe(true);

    // A downstream run consuming the plan sees the alias and the note in prev handoff.
    const execRun = createRun({ projectRoot, command: 'demo-exec', sessionId: planRun.session_id, intent: 'closed loop' });
    const brief = briefRun(projectRoot, execRun.run_id, execRun.session_id);
    expect(brief.execution_contract.inputs.find(input => input.alias === 'current-plan')?.resolved).toBeNull();
    expect(brief.execution_contract.reuse_assessments).toEqual([
      expect.objectContaining({ decision: 'REVIEW', reason_codes: expect.arrayContaining(['QUALITY_MEDIUM']) }),
    ]);
    expect(brief.continuity.prev_handoff?.concerns).toContain('watch the migration order');
  });

  // -----------------------------------------------------------------------
  // v3.1 forward-compatibility: state.json must not be silently downgraded
  // -----------------------------------------------------------------------

  it('readStateJson preserves v3.1 fields without downgrade', () => {
    const projectRoot = root();
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    const v31 = {
      version: '3.1',
      project_name: 'fwd-compat',
      status: 'active',
      current_milestone: null,
      current_task_id: null,
      milestones: [{
        id: 'M1', name: 'alpha', title: 'Alpha', status: 'active', phases: [1, 2],
        type: 'standard', phase_slugs: { 1: 'setup', 2: 'build' },
        roadmap_ref: 'roadmap-001', created_at: '2026-07-01T00:00:00+08:00',
      }],
      artifacts: [],
      accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
      transition_history: [],
      milestone_history: [],
      last_updated: '2026-07-20T00:00:00+08:00',
      _milestone_schema: '{ id, name, type, status, phases[], phase_slugs{}, roadmap_ref, created_at }',
      current_phase: 1,
      phases_summary: { total: 2, completed: 0, in_progress: 1, pending: 1 },
    };
    writeFileSync(join(projectRoot, '.workflow', 'state.json'), JSON.stringify(v31, null, 2), 'utf8');

    const state = readStateJson(projectRoot);
    expect(state).not.toBeNull();
    expect(state!.version).toBe('3.1');
    expect(state!._milestone_schema).toBe(v31._milestone_schema);
    expect(state!.current_phase).toBe(1);
    expect(state!.phases_summary).toEqual(v31.phases_summary);
    expect(state!.milestones[0].type).toBe('standard');
    expect(state!.milestones[0].phase_slugs).toEqual({ 1: 'setup', 2: 'build' });
    expect(state!.milestones[0].roadmap_ref).toBe('roadmap-001');
    expect(state!.milestones[0].created_at).toBe('2026-07-01T00:00:00+08:00');
  });

  it('writeStateJson round-trips v3.1 state without losing extension fields', () => {
    const projectRoot = root();
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    const v31 = {
      version: '3.1',
      project_name: 'round-trip',
      status: 'active',
      current_milestone: null,
      current_task_id: null,
      milestones: [],
      artifacts: [],
      accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
      transition_history: [],
      milestone_history: [],
      last_updated: '2026-07-20T00:00:00+08:00',
      _milestone_schema: 'hint-string',
      current_phase: null,
      phases_summary: { total: 0, completed: 0, in_progress: 0, pending: 0 },
    };
    // Write v3.1 directly, then read + write through the API
    writeFileSync(join(projectRoot, '.workflow', 'state.json'), JSON.stringify(v31, null, 2), 'utf8');
    const state = readStateJson(projectRoot)!;
    writeStateJson(projectRoot, state);

    // Re-read from disk
    const onDisk = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'state.json'), 'utf8'));
    expect(onDisk.version).toBe('3.1');
    expect(onDisk._milestone_schema).toBe('hint-string');
    expect(onDisk.phases_summary).toEqual(v31.phases_summary);
  });

  it('migrateV1toV2 preserves unknown fields from legacy state', () => {
    const v1 = {
      version: '1.0',
      project_name: 'legacy',
      status: 'active',
      current_phase: 3,
      phases_summary: { total: 5, completed: 2, in_progress: 1, pending: 2 },
      custom_extension: 'must-survive',
    };
    const v2 = migrateV1toV2(v1 as any);
    expect(v2.version).toBe('2.0');
    // Unknown fields from v1 should be preserved
    expect((v2 as any).custom_extension).toBe('must-survive');
    // Legacy fields should also survive (not silently dropped)
    expect((v2 as any).current_phase).toBe(3);
    expect((v2 as any).phases_summary).toEqual(v1.phases_summary);
  });

  it('createRun on v3.1 workspace does not downgrade state.json', () => {
    const projectRoot = root();
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    const v31 = {
      version: '3.1',
      project_name: 'no-downgrade',
      status: 'active',
      current_milestone: null,
      current_task_id: null,
      milestones: [],
      artifacts: [],
      accumulated_context: { key_decisions: [], blockers: [], deferred: [] },
      transition_history: [],
      milestone_history: [],
      last_updated: '2026-07-20T00:00:00+08:00',
      _milestone_schema: 'schema-hint',
      phases_summary: { total: 0, completed: 0, in_progress: 0, pending: 0 },
    };
    writeFileSync(join(projectRoot, '.workflow', 'state.json'), JSON.stringify(v31, null, 2), 'utf8');
    commandFile(projectRoot, 'empty', `produces: []
gates:
  entry: []
  exit: []`);

    createRun({ projectRoot, command: 'empty', intent: 'v3.1 compat' });

    const onDisk = JSON.parse(readFileSync(join(projectRoot, '.workflow', 'state.json'), 'utf8'));
    expect(onDisk.version).toBe('3.1');
    expect(onDisk._milestone_schema).toBe('schema-hint');
  });
});
