import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WikiEntry } from '#maestro-dashboard/wiki/wiki-types.js';
import { CredibilityStore } from '../graph/kg/credibility.js';
import { MaestroGraph } from '../graph/kg/engine.js';
import type { Language, UnifiedNode, UnifiedNodeKind } from '../graph/kg/db/types.js';
import { readRunKnowledgeDelta, readSessionKnowledgeDelta } from '../run/knowledge.js';
import { touchChannel } from '../run/knowledge-identity.js';
import { createRun } from '../run/runtime.js';
import type { RunV30, SessionStateV30 } from '../run/schemas.js';
import { SessionStore } from '../run/store.js';
import { recordLoadedKnowledge, registerLoadCommand } from './load.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

let previousCwd = process.cwd();
let root = '';

afterEach(() => {
  process.chdir(previousCwd);
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function knowledgeNode(): UnifiedNode {
  return {
    id: 'spec:load-rule',
    kind: 'spec_entry' as UnifiedNodeKind,
    name: 'Explicit load rule',
    qualifiedName: 'Explicit load rule',
    filePath: '.workflow/specs/coding-conventions.md',
    language: 'markdown' as Language,
    startLine: 1,
    endLine: 3,
    startColumn: 1,
    endColumn: 1,
    docstring: '',
    signature: '',
    visibility: '',
    isExported: false,
    isAsync: false,
    isStatic: false,
    isAbstract: false,
    decorators: [],
    typeParameters: [],
    sourceType: 'spec',
    definition: 'Explicitly loaded knowledge is consumed.',
    aliases: [],
    keywords: ['load'],
    category: 'coding',
    roles: [],
    priority: '',
    status: 'active',
    body: 'Explicitly loaded knowledge is consumed.',
    metadata: {},
    updatedAt: Date.now(),
  };
}

function wikiEntry(): WikiEntry {
  const now = new Date().toISOString();
  return {
    id: 'spec:project:coding-conventions-001',
    type: 'spec',
    title: 'Explicit load rule',
    summary: 'Explicitly loaded knowledge is consumed.',
    tags: ['load'],
    status: 'active',
    created: now,
    updated: now,
    related: [],
    source: { kind: 'file', path: 'specs/coding-conventions.md' },
    body: 'Explicitly loaded knowledge is consumed.',
    ext: {},
    scope: 'project',
    category: 'coding',
    specCategory: 'coding',
    createdBy: null,
    sourceRef: 'spec:load-rule',
    parent: null,
  };
}

function configureV3Workspace(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
  writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
    session_schema: {
      schema_version: 'session-schema-selection/1.0',
      writer: 'session/3.0',
      features: { session_statusless: false },
    },
  }), 'utf8');
}

function writeV3Session(
  store: SessionStore,
  sessionId: string,
  runIds: string[],
): { session: SessionStateV30; runs: RunV30[] } {
  const session: SessionStateV30 = {
    schema_version: 'session/3.0', session_id: sessionId,
    objective: 'attribute v3 knowledge load', definition_of_done: 'consumption is recorded',
    status: 'open', orchestration_revision: 0, activity_revision: 0,
    chain: runIds.length > 0 ? [{
      step_id: 'step-1', command: 'load-demo', args: [], status: 'running',
      run_ids: [...runIds], goal_ref: null, decision_ref: null, decision_refs: [],
    }] : [],
    decisions: [], active_run_ids: [...runIds],
    artifacts_ref: 'artifacts.json', evidence_ref: 'evidence.json',
    created_at: '2026-08-16T00:00:00.000Z', updated_at: '2026-08-16T00:00:00.000Z',
    completed_at: null, archived_at: null,
  };
  const runs = runIds.map((runId): RunV30 => ({
    schema_version: 'run/3.0', run_id: runId, session_id: session.session_id,
    step_id: 'step-1', parent_run_id: null, retry_of_run_id: null, attempt: 1,
    command: 'load-demo', args: [], goal: null, status: 'running', revision: 0,
    actor_id: 'actor-v3', input_refs: [], output_refs: [], primary_artifact_id: null,
    verdict: null, summary: null, legacy_execution_generation: null,
    created_at: '2026-08-16T00:00:00.000Z', started_at: '2026-08-16T00:00:30.000Z',
    ended_at: null, sealed_at: null,
  }));
  store.writeSessionV30(session);
  for (const run of runs) store.writeRunV30(run);
  return { session, runs };
}

async function initializeKnowledgeGraph(projectRoot: string): Promise<void> {
  const graph = await MaestroGraph.init(projectRoot);
  graph.getConnection().transaction(() => graph.getQueryBuilder().insertNodes([knowledgeNode()]));
  graph.close();
}

async function consumptionCount(projectRoot: string): Promise<number> {
  const graph = await MaestroGraph.open(projectRoot);
  try {
    return new CredibilityStore(graph.rawDb).get('spec:load-rule')?.consumption_count ?? 0;
  } finally {
    graph.close();
  }
}

describe('explicit knowledge load attribution', () => {
  it('records full-content loads as consumed on the unique active Run', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-consumed-'));
    v2Workspace(root);
    previousCwd = process.cwd();
    const commandDir = join(root, '.claude', 'commands');
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(
      join(commandDir, 'load-demo.md'),
      '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n',
      'utf8',
    );
    const created = createRun({
      projectRoot: root,
      command: 'load-demo',
      sessionId: 'load-consumed-session',
      intent: 'verify explicit load consumption',
    });
    const graph = await MaestroGraph.init(root);
    graph.getConnection().transaction(() => graph.getQueryBuilder().insertNodes([knowledgeNode()]));
    graph.close();
    process.chdir(root);

    await recordLoadedKnowledge([wikiEntry()]);

    const delta = readRunKnowledgeDelta(
      new SessionStore(root),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([
      expect.objectContaining({
        knowledge_id: 'spec:load-rule',
        signal: 'consumed',
        source: 'load',
        count: 1,
      }),
    ]);
    expect(await consumptionCount(root)).toBe(1);
  });

  it('infers a unique active run/3.0 target for full-content load consumption', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-consumed-v3-'));
    previousCwd = process.cwd();
    configureV3Workspace(root);
    const store = new SessionStore(root);
    const { session, runs: [run] } = writeV3Session(store, 'load-consumed-v3', ['run-load-v3']);
    await initializeKnowledgeGraph(root);
    process.chdir(root);

    await recordLoadedKnowledge([wikiEntry()]);

    expect(readRunKnowledgeDelta(store, session.session_id, run.run_id).inputs).toEqual([
      expect.objectContaining({
        knowledge_id: 'spec:load-rule', signal: 'consumed', source: 'load', count: 1,
      }),
    ]);
    expect(await consumptionCount(root)).toBe(1);
  });

  it('retains an exact v3 Run channel when its Session has multiple active Runs', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-run-channel-v3-'));
    previousCwd = process.cwd();
    configureV3Workspace(root);
    const store = new SessionStore(root);
    const { session, runs } = writeV3Session(
      store,
      'load-run-channel-v3',
      ['run-load-channel-a', 'run-load-channel-b'],
    );
    touchChannel(root, {
      identity: 'hook-load-run-a',
      hostKind: 'hook',
      context: {
        kind: 'run',
        session_id: session.session_id,
        run_id: runs[0].run_id,
      },
    });
    await initializeKnowledgeGraph(root);
    process.chdir(root);

    await recordLoadedKnowledge([wikiEntry()]);

    expect(readRunKnowledgeDelta(store, session.session_id, runs[0].run_id).inputs).toEqual([
      expect.objectContaining({
        knowledge_id: 'spec:load-rule', signal: 'consumed', source: 'load', count: 1,
      }),
    ]);
    expect(readRunKnowledgeDelta(store, session.session_id, runs[1].run_id).inputs).toEqual([]);
    expect(existsSync(join(store.sessionDir(session.session_id), 'knowledge-delta.json'))).toBe(false);
    expect(await consumptionCount(root)).toBe(1);
  });

  it('attributes once to a resolved v3 Session channel when no active Run is unique', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-session-channel-v3-'));
    previousCwd = process.cwd();
    configureV3Workspace(root);
    const store = new SessionStore(root);
    const { session } = writeV3Session(store, 'load-session-channel-v3', []);
    touchChannel(root, {
      identity: 'hook-load-channel',
      hostKind: 'hook',
      context: { kind: 'session', session_id: session.session_id },
    });
    await initializeKnowledgeGraph(root);
    process.chdir(root);

    await recordLoadedKnowledge([wikiEntry(), wikiEntry()]);

    expect(readSessionKnowledgeDelta(store, session.session_id, true).inputs).toEqual([
      expect.objectContaining({
        knowledge_id: 'spec:load-rule', signal: 'consumed', source: 'load', count: 1,
      }),
    ]);
    expect(await consumptionCount(root)).toBe(1);
  });

  it('keeps ambiguous v3 attribution visible and does not guess a Run or Session', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-ambiguous-v3-'));
    previousCwd = process.cwd();
    configureV3Workspace(root);
    const store = new SessionStore(root);
    const first = writeV3Session(store, 'load-ambiguous-a', ['run-load-a']);
    const second = writeV3Session(store, 'load-ambiguous-b', ['run-load-b']);
    await initializeKnowledgeGraph(root);
    process.chdir(root);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });

    await recordLoadedKnowledge([wikiEntry()]);

    expect(errors.join('\n')).toMatch(/attribution was skipped.*absent or ambiguous/);
    for (const fixture of [first, second]) {
      expect(existsSync(join(store.sessionDir(fixture.session.session_id), 'knowledge-delta.json'))).toBe(false);
      expect(existsSync(join(
        store.runDir(fixture.session.session_id, fixture.runs[0].run_id),
        'knowledge-delta.json',
      ))).toBe(false);
    }
    expect(await consumptionCount(root)).toBe(1);
  });
});

describe('load positional IDs', () => {
  it('still requires --type when browsing with no IDs', async () => {
    root = mkdtempSync(join(tmpdir(), 'maestro-load-browse-'));
    v2Workspace(root);
    previousCwd = process.cwd();
    process.chdir(root);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(value => { errors.push(String(value)); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit);
    const program = new Command().name('maestro').exitOverride();
    registerLoadCommand(program);
    await expect(program.parseAsync(['node', 'maestro', 'load'])).rejects.toThrow('exit:1');
    expect(errors.join('\n')).toContain('--type is required when browsing');
    expect(errors.join('\n')).toContain('maestro load <id>');
  });
});
