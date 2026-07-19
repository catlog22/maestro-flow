import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { briefRun, createRun } from './runtime.js';
import { resolveRunContext } from './context.js';
import { SessionStore } from './store.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-run-context-'));
  roots.push(value);
  return value;
}

function command(projectRoot: string, name = 'context-demo'): void {
  const commands = join(projectRoot, '.claude', 'commands');
  const workflows = join(projectRoot, 'workflows');
  mkdirSync(commands, { recursive: true });
  mkdirSync(workflows, { recursive: true });
  writeFileSync(join(commands, `${name}.md`), '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n');
  writeFileSync(join(workflows, `${name}.md`), '# claude workflow\n');
  writeFileSync(join(workflows, `${name}.codex.md`), '# codex workflow\n');
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('durable Run context', () => {
  it('persists session executor platform and returns the canonical locator from brief', () => {
    const projectRoot = root();
    command(projectRoot);
    const store = new SessionStore(projectRoot);
    store.createSession('s', 'context test');
    store.update('s', (draft) => {
      draft.session.orchestration.executor = { platform: 'codex', cli_tool: 'codex' };
      return null;
    });

    const created = createRun({ projectRoot, command: 'context-demo', sessionId: 's' });
    const persisted = store.readRun('s', created.run_id);
    const brief = briefRun(projectRoot, created.run_id, 's');

    expect(persisted.schema_version).toBe('command-run/1.3');
    expect(persisted.resolved_platform).toBe('codex');
    expect(created.resolved_platform).toBe('codex');
    expect(brief.resolved_platform).toBe('codex');
    expect(brief.run_dir).toBe(created.run_dir);
    expect(brief.workflow?.content).toContain('codex workflow');
    expect(() => briefRun(projectRoot, created.run_id, 's', 'agy')).toThrow(/bound to platform/);
  });

  it('normalizes command-run/1.0 with the session executor and derives run_dir after relocation', () => {
    const original = root();
    command(original);
    const store = new SessionStore(original);
    store.createSession('legacy', 'legacy context');
    store.update('legacy', (draft) => {
      draft.session.orchestration.executor = { platform: 'agy', cli_tool: 'agy' };
      return null;
    });
    const created = createRun({ projectRoot: original, command: 'context-demo', sessionId: 'legacy', platform: 'codex' });
    const runPath = join(store.runDir('legacy', created.run_id), 'run.json');
    const raw = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>;
    for (const key of [
      'chain_step_id',
      'resolved_platform',
      'goal_binding',
      'checkpoint_expectation',
      'checkpoint',
      'retry_fence',
      'contract_snapshot',
      'guidance_snapshot',
      'creation_decision',
      'creation_provenance',
      'transition',
    ]) {
      delete raw[key];
    }
    delete (raw.input as Record<string, unknown>).reuse_assessments;
    raw.schema_version = 'command-run/1.0';
    writeFileSync(runPath, `${JSON.stringify(raw, null, 2)}\n`);

    const relocated = root();
    cpSync(original, relocated, { recursive: true });
    const context = resolveRunContext(relocated, created.run_id, 'legacy');

    expect(context.resolved_platform).toBe('agy');
    expect(context.chain_step_id).toBeNull();
    expect(context.run_dir).toBe(`.workflow/sessions/legacy/runs/${created.run_id}`);
    expect(context.run_dir).not.toContain(original);
  });

  it('normalizes command-run/1.1 while preserving its persisted platform after relocation', () => {
    const original = root();
    command(original);
    const store = new SessionStore(original);
    store.createSession('legacy-v11', 'legacy v1.1 context');
    store.update('legacy-v11', (draft) => {
      draft.session.orchestration.executor = { platform: 'agy', cli_tool: 'agy' };
      return null;
    });
    const created = createRun({ projectRoot: original, command: 'context-demo', sessionId: 'legacy-v11', platform: 'codex' });
    const runPath = join(store.runDir('legacy-v11', created.run_id), 'run.json');
    const raw = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>;
    for (const key of ['contract_snapshot', 'guidance_snapshot', 'creation_decision', 'creation_provenance', 'transition']) {
      delete raw[key];
    }
    delete (raw.input as Record<string, unknown>).reuse_assessments;
    raw.schema_version = 'command-run/1.1';
    writeFileSync(runPath, `${JSON.stringify(raw, null, 2)}\n`);

    const relocated = root();
    cpSync(original, relocated, { recursive: true });
    const context = resolveRunContext(relocated, created.run_id, 'legacy-v11');
    const normalized = new SessionStore(relocated).readRun('legacy-v11', created.run_id);

    expect(normalized.schema_version).toBe('command-run/1.3');
    expect(context.resolved_platform).toBe('codex');
    expect(normalized.creation_provenance.provenance).toBe('verified-v1');
    expect(context.run_dir).toBe(`.workflow/sessions/legacy-v11/runs/${created.run_id}`);
  });
});
