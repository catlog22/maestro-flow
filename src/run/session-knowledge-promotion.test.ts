import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  promoteSessionKnowledge,
  readSessionKnowledgeDelta,
  sessionKnowledgeDeltaPath,
  sessionReconciliationPath,
  addCandidate,
  isKnowledgeCandidateV11,
  knowledgeCandidateId,
  stageRunKnowledgeCandidate,
  summarizeSessionKnowledge,
} from './knowledge.js';
import {
  ensureSyntheticKnowledgeSession,
  stageSessionKnowledgeCandidate,
  updateSessionKnowledgeSidecar,
} from './session-knowledge.js';
import {
  ensureSessionKnowledgeReconciliation,
  isSessionKnowledgeReconciliationFresh,
  persistSessionKnowledgeReconciliation,
  persistKnowledgeReconciliation,
  promoteReconciledSessionKnowledge,
  reconcileRunKnowledge,
  resolveKnowledgeCandidate,
} from '../knowledge/reconcile.js';
import { migrateSession } from './migrate.js';
import { completeRun, createRun, sealSession } from './runtime.js';
import { startExecution } from './execution.js';
import { SessionStore } from './store.js';
import { buildTranscriptUri, storeTranscriptEvidence } from './transcript-evidence.js';
import {
  initializeRepositoryIdentity,
  reseedRepositoryIdentity,
} from '../repository/context.js';

vi.setConfig({ testTimeout: 60_000 });

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-session-promotion-'));

  v2Workspace(path);
  roots.push(path);
  const srcDir = join(path, 'src');
  mkdirSync(srcDir, { recursive: true });
  for (const file of [
    'early.ts', 'missing.ts', 'stale.ts', 'promote.ts', 'content.ts',
    'evidence.ts', 'corpus.ts', 'revision.ts', 'v20-promotion.ts', 'shared.ts',
  ]) {
    writeFileSync(join(srcDir, file), `// immutable evidence fixture: ${file}\n`, 'utf8');
  }
  return path;
}

function reviewSessionKnowledge(projectRoot: string, sessionId: string): void {
  persistSessionKnowledgeReconciliation(
    projectRoot,
    ensureSessionKnowledgeReconciliation(projectRoot, sessionId),
  );
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

function writeSpec(projectRoot: string, content: string): void {
  const dir = join(projectRoot, '.workflow', 'specs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'phase-four.md'), `---
category: coding
---

<spec-entry category="coding" date="2026-08-01" sid="S-phase-four" title="Phase four corpus">

### Phase four corpus

${content}

</spec-entry>
`, 'utf8');
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('session-source promotion gate matrix (K5)', () => {
  it('promotes a reviewed session candidate without sealing the Session', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'gate-host');
    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Early promotion',
      content: 'Early promotion content',
      evidenceRefs: ['src/early.ts:1'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);
    expect(new SessionStore(projectRoot).readBundle(sessionId).session.status).toBe('running');
    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true });
    expect(result.promoted.map(item => item.candidate_id)).toContain(staged.candidate_id);
  });

  it('rejects a session candidate with a missing receipt (fail-closed)', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'gate-host');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Missing receipt',
      content: 'Missing receipt content',
      evidenceRefs: ['src/missing.ts:1'],
    });
    expect(() => promoteSessionKnowledge(projectRoot, sessionId, { all: true }))
      .toThrow(/no session knowledge reconciliation receipt/);
  });

  it('resolve rejects a stale session receipt', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'gate-host');
    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Stale gate',
      content: 'Stale gate content',
      evidenceRefs: ['src/stale.ts:1'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);
    // Tamper with the bound delta evidence after review.
    const store = new SessionStore(projectRoot);
    const deltaPath = sessionKnowledgeDeltaPath(store, sessionId);
    const delta = JSON.parse(readFileSync(deltaPath, 'utf8'));
    delta.candidates[0].evidence_refs.push('src/changed.ts:9');
    writeFileSync(deltaPath, JSON.stringify(delta), 'utf8');
    expect(() => resolveKnowledgeCandidate(
      projectRoot,
      sessionId,
      staged.candidate_id,
      'unique',
      { reason: 'attempt resolve against stale receipt' },
    )).toThrow(/stale session reconciliation receipt/);
  });

  it('promotes an eligible session candidate after review without seal', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'gate-host');
    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Promotable session insight',
      content: 'Promotable session insight content',
      evidenceRefs: ['src/promote.ts:2'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);
    const store = new SessionStore(projectRoot);
    expect(existsSync(sessionReconciliationPath(store, sessionId))).toBe(true);

    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true });
    expect(result.promoted.map(item => item.candidate_id)).toContain(staged.candidate_id);
    expect(result.promoted[0].outcome).toBe('created');

    const delta = readSessionKnowledgeDelta(store, sessionId, true);
    const promoted = delta.candidates.find(item => item.candidate_id === staged.candidate_id);
    expect(promoted?.status).toBe('promoted');
    expect(promoted?.promotion_receipt?.outcome).toBe('created');
  });

  it('fails closed when candidate content or evidence changes after review', () => {
    for (const field of ['content', 'evidence'] as const) {
      const projectRoot = root();
      const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, `mutation-${field}`);
      stageSessionKnowledgeCandidate(projectRoot, sessionId, {
        target: 'knowhow',
        title: `Bound ${field}`,
        content: `Bound ${field} content`,
        evidenceRefs: [`src/${field}.ts:1`],
      });
      reviewSessionKnowledge(projectRoot, sessionId);
      const store = new SessionStore(projectRoot);
      const deltaPath = sessionKnowledgeDeltaPath(store, sessionId);
      const delta = JSON.parse(readFileSync(deltaPath, 'utf8'));
      if (field === 'content') delta.candidates[0].content = 'Mutated candidate content';
      else delta.candidates[0].evidence_refs.push('src/mutated-evidence.ts:2');
      writeFileSync(deltaPath, JSON.stringify(delta), 'utf8');
      expect(() => promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true }))
        .toThrow(/stale session knowledge reconciliation receipt/);
    }
  });

  it('fails closed when the corpus changes after session review', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'corpus-host');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Corpus-bound candidate',
      content: 'Corpus-bound candidate content',
      evidenceRefs: ['src/corpus.ts:1'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);
    writeSpec(projectRoot, 'The corpus changed after review.');
    expect(() => promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true }))
      .toThrow(/stale session knowledge reconciliation receipt/);
  });

  it('fails closed when referenced file bytes change after review', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'evidence-byte-host');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Byte-bound candidate',
      content: 'Byte-bound candidate content',
      evidenceRefs: ['src/evidence.ts:1'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);
    writeFileSync(join(projectRoot, 'src', 'evidence.ts'), '// changed after review\n', 'utf8');

    expect(() => promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true }))
      .toThrow(/stale session knowledge reconciliation receipt|evidence bytes changed/);
  });

  it('fails closed when the corpus changes inside the final promotion transaction', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'final-cas-host');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Final CAS candidate',
      content: 'Final CAS candidate content',
      evidenceRefs: ['inline:reviewed immutable evidence'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);

    expect(() => promoteReconciledSessionKnowledge(projectRoot, sessionId, {
      all: true,
      _beforeFinalSessionValidation: () => {
        writeSpec(projectRoot, 'Concurrent corpus bytes written at final validation.');
      },
    })).toThrow(/stale session knowledge reconciliation receipt at final commit/);
    expect(readSessionKnowledgeDelta(new SessionStore(projectRoot), sessionId, true).candidates[0].status)
      .toBe('pending');
    expect(existsSync(join(projectRoot, '.workflow', 'knowhow'))).toBe(false);
  });

  it('keeps a bound candidate fresh across unrelated later Session activity', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'activity-host');
    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Revision-independent candidate',
      content: 'Revision-independent candidate content',
      evidenceRefs: ['src/revision.ts:1'],
    });
    const receipt = ensureSessionKnowledgeReconciliation(projectRoot, sessionId);
    expect(receipt.session_source).toMatchObject({
      schema_version: 'session-knowledge-reconciliation-source/1.0',
      session_activity_revision: 0,
      candidates: [{
        candidate_id: staged.candidate_id,
        candidate_version: 1,
        observed_activity_revision: 0,
      }],
    });
    expect(receipt.session_source?.evidence_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.session_source?.candidates[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.session_source?.candidates[0].evidence_root_descriptors).toEqual([
      expect.objectContaining({
        kind: 'file',
        ref: 'src/revision.ts:1',
        path: 'src/revision.ts',
        content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    persistSessionKnowledgeReconciliation(projectRoot, receipt);
    const store = new SessionStore(projectRoot);
    store.update(sessionId, draft => {
      draft.session.activity_revision++;
    });
    expect(isSessionKnowledgeReconciliationFresh(projectRoot, sessionId, receipt)).toBe(true);
    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, {
      candidateIds: [staged.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toContain(staged.candidate_id);
  });

  it('reviews and promotes a canonical session/2.0 candidate without a Session seal gate', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'v20-promotion-host');
    sealSession(projectRoot, sessionId, 'legacy seal before statusless migration');
    writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/2.0',
        features: { session_statusless: true },
      },
    }, null, 2), 'utf8');
    migrateSession(projectRoot, sessionId);
    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Statusless promotion candidate',
      content: 'Statusless promotion candidate content',
      evidenceRefs: ['src/v20-promotion.ts:3'],
    });
    reviewSessionKnowledge(projectRoot, sessionId);

    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, {
      candidateIds: [staged.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toContain(staged.candidate_id);
    const store = new SessionStore(projectRoot);
    expect(store.readSessionRecordReadOnly(sessionId).schema_version).toBe('session/2.0');
    expect(readSessionKnowledgeDelta(store, sessionId, true).candidates[0].status).toBe('promoted');
  });

  it('resolves transcript-only copies across Run and Session origins with one decision', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const content = 'Shared transcript-only cross-origin insight';
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'mixed-origin-transcript-session',
      intent: 'mixed origin transcript resolution',
    });
    const runStaged = stageRunKnowledgeCandidate(projectRoot, created.run_id, {
      target: 'knowhow',
      title: 'Shared transcript-only insight',
      content,
      evidenceRefs: ['transcript:pi:host-1:entry-1:aaaaaaaaaaaaaaaa'],
    }, created.session_id);
    const sessionTranscript = storeTranscriptEvidence(
      projectRoot,
      created.session_id,
      'Session-origin transcript evidence',
      { host_kind: 'pi', host_session_id: 'host-2', entry_id: 'entry-2' },
    );
    const sessionStaged = stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'Shared transcript-only insight',
      content,
      evidenceRefs: [buildTranscriptUri(
        'pi',
        'host-2',
        'entry-2',
        sessionTranscript.sha256,
      )],
    });
    expect(sessionStaged.candidate_id).toBe(runStaged.candidate_id);

    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'mixed transcript origins sealed');
    const resolved = resolveKnowledgeCandidate(
      projectRoot,
      created.session_id,
      runStaged.candidate_id,
      'unique',
      { reason: 'Human reviewed both cross-origin transcript references' },
    );
    expect(resolved.affected_runs).toContain(created.run_id);

    const result = promoteReconciledSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [runStaged.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toContain(runStaged.candidate_id);

    const store = new SessionStore(projectRoot);
    const sessionDelta = readSessionKnowledgeDelta(store, created.session_id, true);
    expect(sessionDelta.candidates.find(item => item.candidate_id === runStaged.candidate_id)?.status)
      .toBe('promoted');
    const runDelta = JSON.parse(readFileSync(
      join(store.runDir(created.session_id, created.run_id), 'knowledge-delta.json'),
      'utf8',
    ));
    expect(runDelta.candidates.find(
      (item: { candidate_id: string }) => item.candidate_id === runStaged.candidate_id,
    )?.status).toBe('promoted');
  });
});

describe('mixed-origin accounting (K7)', () => {
  it('dispatches promotion write-back to each origin ledger separately', () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const content = 'Shared cross-origin insight content';
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'mixed-origin-session',
      intent: 'mixed origin promotion',
    });
    stageRunKnowledgeCandidate(projectRoot, created.run_id, {
      target: 'knowhow',
      title: 'Shared cross-origin insight',
      content,
    }, created.session_id);
    const sessionStaged = stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'Shared cross-origin insight',
      content,
      evidenceRefs: ['src/shared.ts:3'],
    });

    const summary = summarizeSessionKnowledge(projectRoot, created.session_id);
    expect(summary.candidates.filter(item => item.candidate_id === sessionStaged.candidate_id))
      .toHaveLength(2);

    // Seal both sources (run complete + session seal with K6 receipt), then
    // promote by ID: identical content in both ledgers promotes through each
    // origin's own gate and writes back to each ledger separately.
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'mixed origin sealed');
    const result = promoteReconciledSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [sessionStaged.candidate_id],
    });
    expect(result.promoted.length).toBeGreaterThanOrEqual(1);
    expect(result.promoted.map(item => item.candidate_id))
      .toContain(sessionStaged.candidate_id);

    const store = new SessionStore(projectRoot);
    const sessionDelta = readSessionKnowledgeDelta(store, created.session_id, true);
    const sessionCopy = sessionDelta.candidates.find(
      item => item.candidate_id === sessionStaged.candidate_id,
    );
    expect(sessionCopy?.status).toBe('promoted');
    expect(sessionCopy?.promotion_receipt).toBeTruthy();

    const runDelta = JSON.parse(readFileSync(
      join(store.runDir(created.session_id, created.run_id), 'knowledge-delta.json'),
      'utf8',
    ));
    const runCopy = runDelta.candidates.find(
      (item: { candidate_id: string }) => item.candidate_id === sessionStaged.candidate_id,
    );
    expect(runCopy?.status).toBe('promoted');
    // Both copies share one corpus entry: outcomes are created + reaffirmed.
    const outcomes = result.promoted.map(item => item.outcome).sort();
    expect(outcomes).toContain('created');
  });
});

describe('statusless Run-origin promotion routing', () => {
  it('reconciles, reviews, and promotes a v2 Run-origin candidate without rewriting session authority', async () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'v20-run-origin-host',
      intent: 'v2 run-origin promotion',
    });
    const staged = stageRunKnowledgeCandidate(projectRoot, created.run_id, {
      target: 'knowhow',
      title: 'V2 Run-origin candidate',
      content: 'V2 Run-origin candidate content',
      evidenceRefs: ['src/v20-promotion.ts:3'],
    }, created.session_id);
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'seal before statusless migration');
    writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/2.0',
        features: { session_statusless: true },
      },
    }, null, 2), 'utf8');
    migrateSession(projectRoot, created.session_id);

    const store = new SessionStore(projectRoot);
    const sessionPath = join(store.sessionDir(created.session_id), 'session.json');
    const sessionBefore = readFileSync(sessionPath, 'utf8');
    const receipt = await reconcileRunKnowledge(projectRoot, created.session_id, created.run_id);
    persistKnowledgeReconciliation(projectRoot, receipt);
    // review --refresh uses the same post-hoc persist path.
    persistKnowledgeReconciliation(
      projectRoot,
      await reconcileRunKnowledge(projectRoot, created.session_id, created.run_id),
    );
    expect(readFileSync(sessionPath, 'utf8')).toBe(sessionBefore);

    const result = promoteReconciledSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [staged.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toContain(staged.candidate_id);
    expect(readFileSync(sessionPath, 'utf8')).toBe(sessionBefore);
    expect(readFileSync(
      join(store.runDir(created.session_id, created.run_id), 'knowledge-delta.json'),
      'utf8',
    )).toContain('"status": "promoted"');
  });

  it('promotes a v2 mixed-origin candidate through Run and Session sidecars only', async () => {
    const projectRoot = root();
    installCommand(projectRoot);
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'v20-mixed-origin-host',
      intent: 'v2 mixed origin promotion',
    });
    const content = 'V2 mixed-origin candidate content';
    const runStaged = stageRunKnowledgeCandidate(projectRoot, created.run_id, {
      target: 'knowhow',
      title: 'V2 mixed-origin candidate',
      content,
      evidenceRefs: ['src/v20-promotion.ts:3'],
    }, created.session_id);
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'seal mixed origin before migration');
    writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/2.0',
        features: { session_statusless: true },
      },
    }, null, 2), 'utf8');
    migrateSession(projectRoot, created.session_id);
    const sessionStaged = stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'V2 mixed-origin candidate',
      content,
      evidenceRefs: ['src/shared.ts:3'],
    });
    expect(sessionStaged.candidate_id).toBe(runStaged.candidate_id);
    reviewSessionKnowledge(projectRoot, created.session_id);
    const runReceipt = await reconcileRunKnowledge(projectRoot, created.session_id, created.run_id);
    persistKnowledgeReconciliation(projectRoot, runReceipt);

    const store = new SessionStore(projectRoot);
    const sessionPath = join(store.sessionDir(created.session_id), 'session.json');
    const sessionBefore = readFileSync(sessionPath, 'utf8');
    const result = promoteReconciledSessionKnowledge(projectRoot, created.session_id, {
      candidateIds: [runStaged.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toContain(runStaged.candidate_id);
    expect(readFileSync(sessionPath, 'utf8')).toBe(sessionBefore);
    expect(readSessionKnowledgeDelta(store, created.session_id, true).candidates[0].status)
      .toBe('promoted');
  });
});

describe('legacy Execution fence for knowledge reconciliation', () => {
  it('rejects v1 session reconciliation persistence while an Execution is open', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'legacy-open-execution');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Legacy open Execution candidate',
      content: 'Legacy open Execution candidate content',
      evidenceRefs: ['src/early.ts:1'],
    });
    const receipt = ensureSessionKnowledgeReconciliation(projectRoot, sessionId);
    startExecution(projectRoot, sessionId, {
      requestId: 'knowledge-open-execution',
      ownerId: 'knowledge-test',
      ownerKind: 'codex',
    });
    expect(() => persistSessionKnowledgeReconciliation(projectRoot, receipt))
      .toThrow(/open Execution.*seal the Execution, then retry/);
  });
});

/**
 * Injects a session candidate that deliberately lacks the immutable
 * source_snapshot — the exact defect class that previously failed the whole
 * session receipt (missing snapshot) and blocked every promotion in the
 * session (per-candidate fence regression).
 */
function stageBrokenCandidate(projectRoot: string, sessionId: string): string {
  const now = new Date().toISOString();
  let candidateId = '';
  updateSessionKnowledgeSidecar(projectRoot, sessionId, (draft) => {
    candidateId = addCandidate(draft, {
      target: 'knowhow',
      action: 'propose',
      title: 'Broken candidate',
      content: 'Broken candidate content without an immutable source snapshot',
      category: null,
      source_kind: 'manual',
      evidence_refs: [`session:${sessionId}`, 'src/early.ts:1'],
      // source_snapshot deliberately omitted.
    }, now);
    draft.revision++;
    draft.updated_at = now;
  });
  return candidateId;
}

describe('per-candidate session fence (blocked candidate does not block promotion)', () => {
  it('records a snapshot-less candidate as blocked while the session receipt stays fresh', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'block-host');
    const good = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Healthy candidate',
      content: 'Healthy candidate content',
      evidenceRefs: ['src/early.ts:1'],
    });
    const bad = stageBrokenCandidate(projectRoot, sessionId);

    // Session-level refresh must succeed despite the broken candidate.
    const receipt = ensureSessionKnowledgeReconciliation(projectRoot, sessionId);
    const badEntry = receipt.session_source!.candidates.find(
      entry => entry.candidate_id === bad,
    );
    expect(badEntry?.status).toBe('blocked');
    expect(badEntry?.block_reason).toMatch(/no immutable source snapshot/);
    const goodEntry = receipt.session_source!.candidates.find(
      entry => entry.candidate_id === good.candidate_id,
    );
    expect(goodEntry?.status ?? 'ok').not.toBe('blocked');
    expect(isSessionKnowledgeReconciliationFresh(projectRoot, sessionId, receipt)).toBe(true);
    badEntry!.block_reason = 'platform-specific diagnostic wording changed';
    expect(isSessionKnowledgeReconciliationFresh(projectRoot, sessionId, receipt)).toBe(true);
  });

  it('promote --all promotes the healthy candidate and skips the blocked one', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'block-all-host');
    const good = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Healthy candidate',
      content: 'Healthy candidate content',
      evidenceRefs: ['src/early.ts:1'],
    });
    const bad = stageBrokenCandidate(projectRoot, sessionId);
    reviewSessionKnowledge(projectRoot, sessionId);

    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, { all: true });
    expect(result.promoted.map(item => item.candidate_id)).toContain(good.candidate_id);
    expect(result.promoted.map(item => item.candidate_id)).not.toContain(bad);
    expect(result.skipped_blocked).toContain(bad);
  });

  it('promote --candidate promotes a healthy candidate individually', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'block-one-host');
    const good = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Healthy candidate',
      content: 'Healthy candidate content',
      evidenceRefs: ['src/early.ts:1'],
    });
    stageBrokenCandidate(projectRoot, sessionId);
    reviewSessionKnowledge(projectRoot, sessionId);

    const result = promoteReconciledSessionKnowledge(projectRoot, sessionId, {
      candidateIds: [good.candidate_id],
    });
    expect(result.promoted.map(item => item.candidate_id)).toEqual([good.candidate_id]);
  });

  it('explicitly selecting the blocked candidate fails with its block reason', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'block-explicit-host');
    stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Healthy candidate',
      content: 'Healthy candidate content',
      evidenceRefs: ['src/early.ts:1'],
    });
    const bad = stageBrokenCandidate(projectRoot, sessionId);
    reviewSessionKnowledge(projectRoot, sessionId);

    expect(() => promoteReconciledSessionKnowledge(projectRoot, sessionId, {
      candidateIds: [bad],
    })).toThrow(/is blocked: .*no immutable source snapshot/);
  });
});


function linkedPromotionFixture(): {
  sourceRoot: string;
  targetRoot: string;
  sourceRepoId: string;
  targetRepoId: string;
} {
  const sourceRoot = root();
  const targetRoot = mkdtempSync(join(tmpdir(), 'maestro-promotion-target-'));
  roots.push(targetRoot);
  v2Workspace(targetRoot);
  const source = initializeRepositoryIdentity(sourceRoot, { repoName: 'Source' });
  const target = initializeRepositoryIdentity(targetRoot, { repoName: 'Target' });
  const configPath = join(sourceRoot, '.workflow', 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.workspaces = {
    linked: [{
      name: 'library',
      path: targetRoot,
      repo_id: target.repo_id,
      share: ['spec', 'knowhow'],
      write: ['spec', 'knowhow'],
    }],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return {
    sourceRoot,
    targetRoot,
    sourceRepoId: source.repo_id,
    targetRepoId: target.repo_id,
  };
}

describe('canonical cross-repository promotion saga', () => {
  it('dual-reads legacy 1.0 bytes and upgrades without injecting fields into legacy candidates', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'legacy-upgrade-host');
    const store = new SessionStore(fixture.sourceRoot);
    const path = sessionKnowledgeDeltaPath(store, sessionId);
    const legacy = {
      schema_version: 'session-knowledge-delta/1.0',
      session_id: sessionId,
      revision: 0,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      inputs: [],
      candidates: [{
        candidate_id: 'KDC-0000000000000001', target: 'knowhow', action: 'propose',
        title: 'Legacy candidate', content: 'Legacy bytes remain legacy.', category: null,
        source_kind: 'manual', evidence_refs: ['legacy:evidence'], occurrences: 1,
        first_recorded_at: '2026-09-01T00:00:00.000Z', last_recorded_at: '2026-09-01T00:00:00.000Z',
        status: 'pending', promoted_id: null, promotion_receipt: null,
      }],
    };
    writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    const before = readFileSync(path, 'utf8');
    expect(readSessionKnowledgeDelta(store, sessionId, true).schema_version)
      .toBe('session-knowledge-delta/1.0');
    expect(readFileSync(path, 'utf8')).toBe(before);

    stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'knowhow', title: 'Canonical candidate', content: 'New bytes are canonical.',
      evidenceRefs: ['src/evidence.ts:1'],
    });
    const upgraded = JSON.parse(readFileSync(path, 'utf8'));
    expect(upgraded).toMatchObject({
      schema_version: 'session-knowledge-delta/1.1',
      source_repository: { repo_id: fixture.sourceRepoId },
    });
    expect(upgraded.candidates[0]).toEqual(legacy.candidates[0]);
    expect(upgraded.candidates[1]).toMatchObject({ schema_version: 'knowledge-candidate/1.1' });
  });

  it('keeps the physical target excluded from canonical Knowhow applicability through recovery', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'cross-root-host');
    const staged = stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'knowhow',
      repository: 'library',
      title: 'Recoverable linked recipe',
      content: 'Use the recoverable linked promotion saga.',
      evidenceRefs: ['src/evidence.ts:1'],
      type: 'recipe',
      category: 'coding',
      keywords: ['recovery', 'linked'],
      sourceRef: 'issue:cross-root',
      relatedPaths: ['src/evidence.ts'],
      appliesToRepoIds: [fixture.sourceRepoId, fixture.sourceRepoId],
      language: 'typescript',
      lifecycleStatus: 'active',
      tool: true,
    });
    reviewSessionKnowledge(fixture.sourceRoot, sessionId);

    const stagedCandidate = summarizeSessionKnowledge(fixture.sourceRoot, sessionId, { readOnly: true })
      .candidates.find(candidate => candidate.candidate_id === staged.candidate_id)!;
    expect(stagedCandidate).toMatchObject({
      schema_version: 'knowledge-candidate/1.1',
      repository_binding: {
        source_repo_id: fixture.sourceRepoId,
        target_repo_id: fixture.targetRepoId,
        target_alias_snapshot: 'library',
      },
      payload: {
        kind: 'knowhow',
        type: 'recipe',
        category: 'coding',
        sourceRef: 'issue:cross-root',
        relatedPaths: ['src/evidence.ts'],
        appliesToRepoIds: [fixture.sourceRepoId],
        language: 'typescript',
        tool: true,
      },
    });
    if (!isKnowledgeCandidateV11(stagedCandidate)) throw new Error('Expected canonical candidate');
    const targetVisiblePayload = {
      ...stagedCandidate.payload,
      appliesToRepoIds: [fixture.targetRepoId],
    };
    expect(knowledgeCandidateId({
      targetRepoId: fixture.targetRepoId,
      appliesToRepoIds: targetVisiblePayload.appliesToRepoIds,
      payload: targetVisiblePayload,
    })).not.toBe(staged.candidate_id);
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      targetRepository: 'current',
    })).toThrow(/target assertion/);

    let crashed = false;
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      targetRepository: 'library',
      _afterTargetWrite: () => {
        if (!crashed) {
          crashed = true;
          throw new Error('simulated crash after target write');
        }
      },
    })).toThrow(/simulated crash/);
    expect(readSessionKnowledgeDelta(new SessionStore(fixture.sourceRoot), sessionId, true)
      .candidates[0]).toMatchObject({
        status: 'promoting',
        promotion_intent: {
          schema_version: 'knowledge-promotion-intent/1.1',
          target_repo_id: fixture.targetRepoId,
        },
      });
    expect(existsSync(join(fixture.sourceRoot, '.workflow', 'knowhow'))).toBe(false);

    // Alias renames recover by stable repository ID, not the staged alias snapshot.
    const configPath = join(fixture.sourceRoot, '.workflow', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.workspaces.linked[0].name = 'renamed-library';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const recovered = promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      targetRepository: fixture.targetRepoId,
    });
    expect(recovered.promoted).toEqual([
      expect.objectContaining({ candidate_id: staged.candidate_id, outcome: 'reaffirmed' }),
    ]);
    const files = readdirSync(join(fixture.targetRoot, '.workflow', 'knowhow'));
    expect(files).toHaveLength(1);
    const document = readFileSync(join(fixture.targetRoot, '.workflow', 'knowhow', files[0]), 'utf8');
    expect(document).toContain('type: recipe');
    expect(document).toContain('category: coding');
    expect(document).toMatch(/sourceRef: ["']?issue:cross-root["']?/);
    expect(document).toContain('language: typescript');
    expect(document).toContain('tool: true');
    expect(document).toContain(fixture.sourceRepoId);
    expect(document).not.toContain(fixture.targetRepoId);
    expect(readSessionKnowledgeDelta(new SessionStore(fixture.sourceRoot), sessionId, true)
      .candidates[0]).toMatchObject({
        status: 'promoted',
        promotion_receipt: {
          schema_version: 'knowledge-promotion-receipt/1.1',
          target_repo_id: fixture.targetRepoId,
          target_alias_snapshot: 'renamed-library',
          acknowledged_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
  }, 60_000);

  it('promotes a canonical Spec to its frozen target without adding target visibility', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'cross-spec-host');
    const staged = stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'spec', repository: 'library', title: 'Linked canonical rule',
      content: 'Always preserve the full canonical Spec payload.',
      category: 'coding', keywords: ['canonical', 'linked'],
      sourceRef: 'decision:linked-spec', relatedPaths: ['src/evidence.ts'],
      appliesToRepoIds: [fixture.sourceRepoId], evidenceRefs: ['src/evidence.ts:1'],
    });
    reviewSessionKnowledge(fixture.sourceRoot, sessionId);
    const result = promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id], targetRepository: fixture.targetRepoId,
    });
    expect(result.promoted).toEqual([
      expect.objectContaining({ candidate_id: staged.candidate_id, target: 'spec', outcome: 'created' }),
    ]);
    expect(existsSync(join(fixture.sourceRoot, '.workflow', 'specs'))).toBe(false);
    const targetSpec = readFileSync(join(fixture.targetRoot, '.workflow', 'specs', 'coding-conventions.md'), 'utf8');
    expect(targetSpec).toContain('title="Linked canonical rule"');
    expect(targetSpec).toContain('keywords="canonical,linked"');
    expect(targetSpec).toContain('sourceRef="decision:linked-spec"');
    expect(targetSpec).toContain('relatedPaths="src/evidence.ts"');
    expect(targetSpec).toContain(fixture.sourceRepoId);
    expect(targetSpec).not.toContain(fixture.targetRepoId);
  });

  it('retries a missing target write from the durable promoting intent', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'missing-target-host');
    const staged = stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'knowhow', repository: 'library', title: 'Retry missing target',
      content: 'A missing target is recreated idempotently.', evidenceRefs: ['src/evidence.ts:1'],
    });
    reviewSessionKnowledge(fixture.sourceRoot, sessionId);
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      _afterTargetWrite: () => { throw new Error('crash'); },
    })).toThrow(/crash/);
    const dir = join(fixture.targetRoot, '.workflow', 'knowhow');
    rmSync(join(dir, readdirSync(dir)[0]));
    const recovered = promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
    });
    expect(recovered.promoted).toEqual([
      expect.objectContaining({ candidate_id: staged.candidate_id, outcome: 'created' }),
    ]);
    expect(readdirSync(dir)).toHaveLength(1);
  }, 60_000);

  it('keeps a conflicting target payload fenced in promoting state', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'payload-conflict-host');
    const staged = stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'knowhow', repository: 'library', title: 'Payload fenced tip',
      content: 'The target payload is immutable.', evidenceRefs: ['src/evidence.ts:1'],
    });
    reviewSessionKnowledge(fixture.sourceRoot, sessionId);
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      _afterTargetWrite: () => { throw new Error('crash'); },
    })).toThrow(/crash/);
    const dir = join(fixture.targetRoot, '.workflow', 'knowhow');
    const path = join(dir, readdirSync(dir)[0]);
    writeFileSync(path, readFileSync(path, 'utf8').replace(
      'The target payload is immutable.',
      'The target payload now conflicts.',
    ), 'utf8');
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
    })).toThrow(/CALLER_PAYLOAD_CONFLICT|acknowledgment conflict/);
    expect(readSessionKnowledgeDelta(new SessionStore(fixture.sourceRoot), sessionId, true)
      .candidates[0].status).toBe('promoting');
  }, 60_000);

  it('fails closed on target repository identity mismatch and leaves the intent recoverable', () => {
    const fixture = linkedPromotionFixture();
    const { sessionId } = ensureSyntheticKnowledgeSession(fixture.sourceRoot, 'identity-mismatch-host');
    const staged = stageSessionKnowledgeCandidate(fixture.sourceRoot, sessionId, {
      target: 'knowhow', repository: 'library', title: 'Identity fenced tip',
      content: 'The target identity is immutable.', evidenceRefs: ['src/evidence.ts:1'],
    });
    reviewSessionKnowledge(fixture.sourceRoot, sessionId);
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
      _afterTargetWrite: () => { throw new Error('crash'); },
    })).toThrow(/crash/);
    reseedRepositoryIdentity(fixture.targetRoot);
    expect(() => promoteReconciledSessionKnowledge(fixture.sourceRoot, sessionId, {
      candidateIds: [staged.candidate_id],
    })).toThrow(/identity mismatch|not found/i);
    expect(readSessionKnowledgeDelta(new SessionStore(fixture.sourceRoot), sessionId, true)
      .candidates[0].status).toBe('promoting');
  });
});
