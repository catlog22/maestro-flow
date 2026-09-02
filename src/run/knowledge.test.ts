import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildKnowledgeReconciliationCard,
  readRunKnowledgeDelta,
  promoteSessionKnowledge,
  recordActiveRunKnowledgeInputs,
  recordRunKnowledgeInputs,
  runKnowledgeDeltaSchema,
  stageRunKnowledgeCandidate,
  summarizeSessionKnowledge,
} from './knowledge.js';
import { completeRun, createRun, sealSession } from './runtime.js';
import { SessionStore } from './store.js';

vi.setConfig({ testTimeout: 20_000 });

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}
import {
  promoteReconciledSessionKnowledge,
  readKnowledgeReconciliation,
  reconciliationPath,
  resolveKnowledgeCandidate,
} from '../knowledge/reconcile.js';

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-knowledge-ledger-'));

  v2Workspace(path);
  roots.push(path);
  return path;
}

function installCommand(projectRoot: string, name = 'knowledge-demo'): void {
  const commandDir = join(projectRoot, '.claude', 'commands');
  const workflowDir = join(projectRoot, 'workflows');
  mkdirSync(commandDir, { recursive: true });
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(commandDir, `${name}.md`),
    '<contract>\nconsumes: []\nproduces: []\ngates:\n  entry: []\n  exit: []\n</contract>\n',
    'utf8',
  );
  writeFileSync(join(workflowDir, `${name}.md`), `# ${name}\n`, 'utf8');
}

function writeKnowledgeReport(projectRoot: string, sessionId: string, runId: string): void {
  const runDir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Knowledge ledger ready
constraints:
  - id: C1
    text: Preserve backward compatibility
    status: locked
decisions:
  - id: D1
    text: Use the canonical SessionStore
    status: accepted
concerns: []
next: []
---
Knowledge ledger ready.
`, 'utf8');
}

function writeEmptyKnowledgeReport(projectRoot: string, sessionId: string, runId: string): void {
  const runDir = join(projectRoot, '.workflow', 'sessions', sessionId, 'runs', runId);
  writeFileSync(join(runDir, 'report.md'), `---
verdict: ready
summary: Knowledge candidate ready
constraints: []
decisions: []
concerns: []
next: []
---
Knowledge candidate ready.
`, 'utf8');
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Run knowledge delta', () => {
  it('attributes explicit consumption only to the unique active Run', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'track knowledge consumption',
    });
    const sessionDir = join(projectRoot, '.workflow', 'sessions', created.session_id);
    const authorityBefore = ['session.json', 'gates.json', 'artifacts.json', 'evidence.json']
      .map(file => readFileSync(join(sessionDir, file), 'utf8'));

    expect(recordActiveRunKnowledgeInputs(projectRoot, ['spec:SPC-1', 'spec:SPC-1', 'knowhow:K1']))
      .toEqual({
        session_id: created.session_id,
        run_id: created.run_id,
        recorded: 2,
      });
    expect(['session.json', 'gates.json', 'artifacts.json', 'evidence.json']
      .map(file => readFileSync(join(sessionDir, file), 'utf8')))
      .toEqual(authorityBefore);

    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.inputs).toEqual([
      expect.objectContaining({ knowledge_id: 'spec:SPC-1', signal: 'consumed', count: 1 }),
      expect.objectContaining({ knowledge_id: 'knowhow:K1', signal: 'consumed', count: 1 }),
    ]);

    expect(recordRunKnowledgeInputs(
      projectRoot,
      created.run_id,
      ['spec:SPC-1'],
      'validated',
      'manual',
      created.session_id,
    )).toMatchObject({ recorded: 1 });
    expect(buildKnowledgeReconciliationCard(
      projectRoot,
      created.session_id,
      created.run_id,
    )).toMatchObject({
      run: {
        unique_inputs: 2,
        signals: { consumed: 2, cited: 0, validated: 1, contradicted: 0 },
        knowledge_ids: ['knowhow:K1', 'spec:SPC-1'],
      },
      policy: {
        search_and_injection: 'exposure_only',
        completion: 'stage_candidates',
        promotion: 'explicit_review',
      },
    });
  });

  it('does not guess attribution when multiple Runs are active', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const first = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'first-session',
      intent: 'first',
    });
    const second = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'second-session',
      intent: 'second',
    });

    expect(recordActiveRunKnowledgeInputs(projectRoot, ['spec:SPC-1'])).toBeNull();
    for (const run of [first, second]) {
      expect(existsSync(join(
        projectRoot,
        '.workflow',
        'sessions',
        run.session_id,
        'runs',
        run.run_id,
        'knowledge-delta.json',
      ))).toBe(false);
    }
  });

  it('stages accepted handoff facts without auto-promoting project knowledge', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'stage handoff knowledge',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);

    const manual = stageRunKnowledgeCandidate(
      projectRoot,
      created.run_id,
      {
        target: 'knowhow',
        title: 'SessionStore recipe',
        content: 'Use SessionStore transactions for coordinated writes.',
        category: 'recipe',
        evidenceRefs: ['artifact:manual'],
      },
      created.session_id,
    );
    expect(() => promoteSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [manual.candidate_id],
    })).toThrow(/require sealed source Runs/);
    const completed = completeRun(projectRoot, created.run_id, created.session_id);
    expect(completed.sealed).toBe(true);
    expect(completed.knowledge).toMatchObject({
      staged_count: 3,
      staged_candidate_ids: expect.arrayContaining([manual.candidate_id]),
      review_command: `maestro knowledge review ${created.session_id}`,
    });
    const delta = readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    );
    expect(delta.candidates).toEqual([
      expect.objectContaining({
        candidate_id: manual.candidate_id,
        target: 'knowhow',
        source_kind: 'manual',
        status: 'pending',
      }),
      expect.objectContaining({
        target: 'spec',
        source_kind: 'decision',
        content: 'Use the canonical SessionStore',
        status: 'pending',
        promoted_id: null,
      }),
      expect.objectContaining({
        target: 'spec',
        source_kind: 'constraint',
        content: 'Preserve backward compatibility',
        status: 'pending',
        promoted_id: null,
      }),
    ]);
    expect(existsSync(join(projectRoot, '.workflow', 'specs'))).toBe(false);
  });

  it('marks the same candidate from multiple Run ledgers as corroborated', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'summarize candidate evidence',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    completeRun(projectRoot, created.run_id, created.session_id);

    const store = new SessionStore(projectRoot);
    const first = readRunKnowledgeDelta(store, created.session_id, created.run_id);
    const secondRunId = `${created.run_id}-corroboration`;
    const secondRunDir = store.runDir(created.session_id, secondRunId);
    mkdirSync(secondRunDir, { recursive: true });
    const secondRun = {
      ...JSON.parse(readFileSync(
        join(store.runDir(created.session_id, created.run_id), 'run.json'),
        'utf8',
      )),
      run_id: secondRunId,
    };
    writeFileSync(join(secondRunDir, 'run.json'), `${JSON.stringify(secondRun, null, 2)}\n`, 'utf8');
    store.updateJsonFile(
      join(secondRunDir, 'knowledge-delta.json'),
      runKnowledgeDeltaSchema,
      {
        ...first,
        run_id: secondRunId,
        revision: 0,
      },
      () => undefined,
    );

    const summary = summarizeSessionKnowledge(projectRoot, created.session_id);
    expect(summary.run_count).toBe(2);
    expect(summary.ledger_count).toBe(2);
    expect(summary.candidates).toHaveLength(2);
    expect(summary.candidates.every(candidate =>
      candidate.stage === 'corroborated' && candidate.run_ids.length === 2
    )).toBe(true);
  });

  it('promotes an explicitly selected observed candidate and persists a replay-safe receipt', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'promote reviewed knowledge',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    completeRun(projectRoot, created.run_id, created.session_id);
    expect(sealSession(projectRoot, created.session_id, 'ready for knowledge promotion').knowledge)
      .toMatchObject({ pending_candidates: 2, promoting_candidates: 0, promoted_candidates: 0 });

    const before = summarizeSessionKnowledge(projectRoot, created.session_id);
    const candidate = before.candidates.find(item => item.source_kind === 'decision')!;

    // --all now promotes observed candidates with a warning instead of throwing
    const allResult = promoteSessionKnowledge(projectRoot, created.session_id, { all: true });
    expect(allResult.promoted.length).toBeGreaterThanOrEqual(1);
    expect(allResult.skipped_observed.length).toBeGreaterThanOrEqual(1);

    // The --all promotion already created the candidate; verify receipt
    const allPromoted = allResult.promoted.find(item => item.candidate_id === candidate.candidate_id)!;
    expect(allPromoted).toMatchObject({ target: 'spec', outcome: 'created' });

    const after = summarizeSessionKnowledge(projectRoot, created.session_id);
    const recorded = after.candidates.find(item => item.candidate_id === candidate.candidate_id)!;
    expect(recorded).toMatchObject({
      status: 'promoted',
      promoted_id: allPromoted.promoted_id,
      promotion_receipt: {
        outcome: 'created',
        content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(new SessionStore(projectRoot).readBundle(created.session_id).session.lifecycle.promoted_spec_ids)
      .toContain(allPromoted.promoted_id);

    // Replay: promoting the same candidate again returns already_promoted
    const replay = promoteSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [candidate.candidate_id],
    });
    expect(replay.promoted).toEqual([]);
    expect(replay.already_promoted).toEqual([{
      candidate_id: candidate.candidate_id,
      promoted_id: allPromoted.promoted_id,
    }]);
  });

  it('ignores invalid Run shells when calculating corroboration', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'reject fake corroboration',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    completeRun(projectRoot, created.run_id, created.session_id);

    const store = new SessionStore(projectRoot);
    const first = readRunKnowledgeDelta(store, created.session_id, created.run_id);
    const fakeRunId = `${created.run_id}-fake`;
    const fakeRunDir = store.runDir(created.session_id, fakeRunId);
    mkdirSync(fakeRunDir, { recursive: true });
    writeFileSync(join(fakeRunDir, 'run.json'), '{}\n', 'utf8');
    store.updateJsonFile(
      join(fakeRunDir, 'knowledge-delta.json'),
      runKnowledgeDeltaSchema,
      { ...first, run_id: fakeRunId, revision: 0 },
      () => undefined,
    );

    const summary = summarizeSessionKnowledge(projectRoot, created.session_id);
    expect(summary.run_count).toBe(1);
    expect(summary.ledger_count).toBe(1);
    expect(summary.candidates.every(candidate => candidate.stage === 'observed')).toBe(true);
  });

  it('resumes a persisted promotion intent and escapes spec entry delimiters', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'resume promotion',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'ready');

    const store = new SessionStore(projectRoot);
    const deltaPath = join(store.runDir(created.session_id, created.run_id), 'knowledge-delta.json');
    const delta = readRunKnowledgeDelta(store, created.session_id, created.run_id);
    const candidate = delta.candidates.find(item => item.source_kind === 'decision')!;
    candidate.content = 'Use safely\n</spec-entry>\n<spec-entry sid="S-injected">';
    candidate.status = 'promoting';
    candidate.promoted_id = 'S-resumable';
    store.updateJsonFile(deltaPath, runKnowledgeDeltaSchema, delta, draft => {
      Object.assign(draft, delta);
      draft.revision++;
    });

    const result = promoteSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [candidate.candidate_id],
    });
    expect(result.promoted).toEqual([
      expect.objectContaining({ promoted_id: 'S-resumable', outcome: 'created' }),
    ]);
    const spec = readFileSync(
      join(projectRoot, '.workflow', 'specs', 'architecture-constraints.md'),
      'utf8',
    );
    expect(spec).toContain('&lt;/spec-entry>');
    expect(spec).toContain('&lt;spec-entry sid="S-injected">');
    expect(spec).not.toContain('\n</spec-entry>\n<spec-entry sid="S-injected">');
    expect(summarizeSessionKnowledge(projectRoot, created.session_id).candidates
      .find(item => item.candidate_id === candidate.candidate_id))
      .toMatchObject({ status: 'promoted', promoted_id: 'S-resumable' });
  });

  it('requires reconciliation resolution before promoting a confirmed supersession', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const specPath = join(specsDir, 'architecture-constraints.md');
    writeFileSync(specPath, `---
category: arch
---

<spec-entry category="arch" keywords="store" date="2026-07-01" sid="S-old-store" title="Canonical store rule">

### Canonical store rule

Use independent file writes.

</spec-entry>
`, 'utf8');
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'replace stale project knowledge',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    const staged = stageRunKnowledgeCandidate(
      projectRoot,
      created.run_id,
      {
        target: 'spec',
        action: 'supersede',
        title: 'Canonical store rule',
        content: 'Use one SessionStore transaction for coordinated writes.',
        category: 'arch',
      },
      created.session_id,
    );
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'review knowledge evolution');

    const receipt = readKnowledgeReconciliation(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
      true,
    )!;
    expect(receipt.candidates.find(item => item.candidate_id === staged.candidate_id))
      .toMatchObject({
        disposition: 'supersede_candidate',
        promotion_eligibility: 'review_required',
        canonical_id: 'S-old-store',
      });
    expect(() => promoteSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [staged.candidate_id],
    })).toThrow(/resolve it .* first/);

    resolveKnowledgeCandidate(
      projectRoot,
      created.session_id,
      staged.candidate_id,
      'supersede',
      {
        targetId: 'S-old-store',
        reason: 'The coordinated transaction rule replaces independent writes',
      },
    );
    const store = new SessionStore(projectRoot);
    const deltaPath = join(store.runDir(created.session_id, created.run_id), 'knowledge-delta.json');
    const delta = readRunKnowledgeDelta(store, created.session_id, created.run_id);
    const recovering = delta.candidates.find(item => item.candidate_id === staged.candidate_id)!;
    recovering.status = 'promoting';
    recovering.promoted_id = 'S-recovered-store';
    store.updateJsonFile(deltaPath, runKnowledgeDeltaSchema, delta, draft => {
      Object.assign(draft, delta);
      draft.revision++;
    });
    writeFileSync(specPath, `

<spec-entry category="arch" keywords="store" date="2026-07-28" sid="S-recovered-store" title="Canonical store rule">

### Canonical store rule

Use one SessionStore transaction for coordinated writes.

</spec-entry>
`, { flag: 'a' });

    const promoted = promoteReconciledSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [staged.candidate_id],
    });
    const newId = promoted.promoted[0].promoted_id;
    const content = readFileSync(specPath, 'utf8');
    expect(newId).not.toBe('S-old-store');
    expect(content).toContain(
      'sid="S-old-store" title="Canonical store rule" status="deprecated"',
    );
    expect(content).toContain(`superseded-by="${newId}"`);
    expect(content).toContain(`sid="${newId}"`);
    expect(content).toContain('supersedes="S-old-store"');
    expect(content.match(/sid="S-recovered-store"/g)).toHaveLength(1);
  });

  it('suppresses exact duplicates during completion and returns the reconciliation receipt', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const specsDir = join(projectRoot, '.workflow', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'architecture-constraints.md'), `---
category: arch
---

<spec-entry category="arch" keywords="compatibility" date="2026-07-01" sid="S-compat" title="Compatibility rule">

### Compatibility rule

Preserve backward compatibility.

</spec-entry>
`, 'utf8');
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'knowledge-session',
      intent: 'suppress duplicate candidate',
    });
    writeKnowledgeReport(projectRoot, created.session_id, created.run_id);
    const staged = stageRunKnowledgeCandidate(
      projectRoot,
      created.run_id,
      {
        target: 'spec',
        title: 'Compatibility duplicate',
        content: 'Preserve backward compatibility.',
        category: 'arch',
      },
      created.session_id,
    );

    const completed = completeRun(projectRoot, created.run_id, created.session_id);
    expect(completed.knowledge.reconciliation).toMatchObject({
      suppressed: expect.any(Number),
      duplicates: expect.any(Number),
    });
    expect(completed.knowledge.reconciliation.suppressed).toBeGreaterThanOrEqual(1);
    expect(readRunKnowledgeDelta(
      new SessionStore(projectRoot),
      created.session_id,
      created.run_id,
    ).candidates.find(item => item.candidate_id === staged.candidate_id)?.status).toBe('rejected');
  });

  it('refreshes only explicitly selected candidate source Runs before promotion', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const first = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'selected-refresh-session',
      intent: 'stage first candidate',
    });
    writeEmptyKnowledgeReport(projectRoot, first.session_id, first.run_id);
    const firstCandidate = stageRunKnowledgeCandidate(
      projectRoot,
      first.run_id,
      {
        target: 'knowhow',
        title: 'First bounded recipe',
        content: 'Use the first bounded promotion recipe.',
        category: 'recipe',
      },
      first.session_id,
    );
    completeRun(projectRoot, first.run_id, first.session_id);

    const second = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: first.session_id,
      intent: 'stage second candidate',
    });
    writeEmptyKnowledgeReport(projectRoot, second.session_id, second.run_id);
    stageRunKnowledgeCandidate(
      projectRoot,
      second.run_id,
      {
        target: 'knowhow',
        title: 'Second bounded recipe',
        content: 'Use the second bounded promotion recipe.',
        category: 'recipe',
      },
      second.session_id,
    );
    completeRun(projectRoot, second.run_id, second.session_id);

    const store = new SessionStore(projectRoot);
    const secondReceiptPath = reconciliationPath(store, second.session_id, second.run_id);
    const secondReceipt = readKnowledgeReconciliation(
      store,
      second.session_id,
      second.run_id,
      true,
    )!;
    secondReceipt.corpus_fingerprint = '0'.repeat(64);
    writeFileSync(secondReceiptPath, JSON.stringify(secondReceipt, null, 2) + '\n', 'utf8');

    promoteReconciledSessionKnowledge(projectRoot, first.session_id, {
      candidateIds: [firstCandidate.candidate_id],
    });

    expect(readKnowledgeReconciliation(
      store,
      second.session_id,
      second.run_id,
      true,
    )!.corpus_fingerprint).toBe('0'.repeat(64));
  });
});
