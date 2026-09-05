import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sessionKnowledgeCandidateSourceSchema,
  sessionKnowledgeDeltaPath,
  stageRunKnowledgeCandidate,
  summarizeSessionKnowledge,
} from './knowledge.js';
import {
  ensureSyntheticKnowledgeSession,
  recordSessionKnowledgeInputs,
  stageSessionKnowledgeCandidate,
  SYNTHETIC_SESSION_PREFIX,
  syntheticKnowledgeSessionId,
} from './session-knowledge.js';
import { migrateSession } from './migrate.js';
import { completeRun, createRun, sealSession } from './runtime.js';
import { SessionStore } from './store.js';
import { sessionKnowledgeReceiptCandidateSchema } from '../knowledge/reconciliation-schema.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-session-knowledge-'));

  v2Workspace(path);
  roots.push(path);
  installCommand(path);
  const srcDir = join(path, 'src');
  mkdirSync(srcDir, { recursive: true });
  for (const file of ['foo.ts', 'x.ts', 'v20.ts']) {
    writeFileSync(join(srcDir, file), `// immutable evidence fixture: ${file}\n`, 'utf8');
  }
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

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('synthetic knowledge session (K2)', () => {
  it('derives deterministic daily-partitioned IDs from host/project/date', () => {
    const projectRoot = root();
    const fixed = new Date(2026, 7, 6);
    const a = syntheticKnowledgeSessionId('pi-uuid-1', projectRoot, fixed);
    const b = syntheticKnowledgeSessionId('pi-uuid-1', projectRoot, fixed);
    expect(a).toBe(b);
    expect(a).toMatch(/^ksyn-[a-f0-9]{16}$/);
    expect(syntheticKnowledgeSessionId('pi-uuid-2', projectRoot, fixed)).not.toBe(a);
    expect(syntheticKnowledgeSessionId('pi-uuid-1', projectRoot, new Date(2026, 7, 7))).not.toBe(a);
  });

  it('creates idempotently and reuses the same bundle', () => {
    const projectRoot = root();
    const first = ensureSyntheticKnowledgeSession(projectRoot, 'claude-uuid-1');
    expect(first.created).toBe(true);
    expect(first.sessionId.startsWith(SYNTHETIC_SESSION_PREFIX)).toBe(true);
    const second = ensureSyntheticKnowledgeSession(projectRoot, 'claude-uuid-1');
    expect(second.created).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
    const store = new SessionStore(projectRoot);
    expect(store.sessionExists(first.sessionId)).toBe(true);
  });

  it('creates a canonical synthetic session/3.0 authority in a fresh v3 workspace', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'maestro-session-knowledge-v3-synthetic-'));
    roots.push(projectRoot);
    mkdirSync(join(projectRoot, '.workflow'), { recursive: true });
    writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/3.0',
        features: { session_statusless: false },
      },
    }));
    const srcDir = join(projectRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'evidence.ts'), '// v3 synthetic evidence\n', 'utf8');

    const first = ensureSyntheticKnowledgeSession(projectRoot, 'pi-v3-host');
    const second = ensureSyntheticKnowledgeSession(projectRoot, 'pi-v3-host');
    const store = new SessionStore(projectRoot);
    expect(first.created).toBe(true);
    expect(second).toEqual({ sessionId: first.sessionId, created: false });
    expect(store.readSessionRecordReadOnly(first.sessionId)).toMatchObject({
      schema_version: 'session/3.0', status: 'open', objective: 'knowledge-sedimentation',
    });
    expect(existsSync(join(store.sessionDir(first.sessionId), 'artifacts.json'))).toBe(true);
    expect(existsSync(join(store.sessionDir(first.sessionId), 'evidence.json'))).toBe(true);

    const staged = stageSessionKnowledgeCandidate(projectRoot, first.sessionId, {
      target: 'knowhow',
      title: 'Synthetic v3 insight',
      content: 'Synthetic v3 insight content',
      evidenceRefs: ['src/evidence.ts:1'],
    });
    expect(staged.origin).toBe('session');
  });
});

describe('session knowledge ledger (K1)', () => {
  it('preserves legacy candidate and receipt reads without typed descriptors', () => {
    const legacySource = sessionKnowledgeCandidateSourceSchema.parse({
      schema_version: 'session-knowledge-candidate-source/1.0',
      candidate_version: 1,
      session_id: 'legacy-session',
      observed_activity_revision: 2,
      content_hash: 'a'.repeat(64),
      evidence_roots: ['legacy-label'],
      evidence_root_hash: 'b'.repeat(64),
    });
    const legacyReceiptCandidate = sessionKnowledgeReceiptCandidateSchema.parse({
      candidate_id: 'KDC-0123456789abcdef',
      candidate_version: 1,
      observed_activity_revision: 2,
      content_hash: 'a'.repeat(64),
      evidence_root_hash: 'b'.repeat(64),
    });
    expect(legacySource.evidence_root_descriptors).toBeUndefined();
    expect(legacyReceiptCandidate.evidence_root_descriptors).toBeUndefined();
  });

  it('stages candidates with session evidence anchor and summarizes origin=session', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-a');

    const result = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Session-only insight',
      content: 'Session-only insight content',
      evidenceRefs: ['src/foo.ts:12'],
    });
    expect(result.origin).toBe('session');
    expect(result.session_id).toBe(sessionId);

    const summary = summarizeSessionKnowledge(projectRoot, sessionId, { readOnly: true });
    const candidate = summary.candidates.find(item => item.candidate_id === result.candidate_id);
    expect(candidate).toBeDefined();
    expect(candidate?.origin).toBe('session');
    expect(candidate?.run_ids).toEqual([]);
    expect(candidate?.stage).toBe('observed');
    expect(candidate?.evidence_refs).toContain(`session:${sessionId}`);
    expect(candidate?.evidence_refs).toContain('src/foo.ts:12');
    expect(candidate?.source_snapshot).toMatchObject({
      schema_version: 'session-knowledge-candidate-source/1.0',
      candidate_version: 1,
      session_id: sessionId,
      observed_activity_revision: 0,
      evidence_roots: [`session:${sessionId}`, 'src/foo.ts:12'].sort(),
    });
    expect(candidate?.source_snapshot?.evidence_root_descriptors).toEqual([
      expect.objectContaining({
        kind: 'file',
        ref: 'src/foo.ts:12',
        path: 'src/foo.ts',
        anchor: ':12',
        content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(candidate?.source_snapshot?.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate?.source_snapshot?.evidence_root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(summary.run_count).toBe(0);
  });

  it('accepts standard line-range evidence anchors', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-range');
    const result = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Range evidence',
      content: 'Range evidence content',
      evidenceRefs: ['src/foo.ts:1-3'],
    });
    const candidate = summarizeSessionKnowledge(projectRoot, sessionId, { readOnly: true })
      .candidates.find(item => item.candidate_id === result.candidate_id);
    expect(candidate?.source_snapshot?.evidence_root_descriptors).toEqual([
      expect.objectContaining({
        kind: 'file',
        ref: 'src/foo.ts:1-3',
        path: 'src/foo.ts',
        anchor: ':1-3',
      }),
    ]);
  });

  it('rejects staging without evidence (S2 precondition)', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-b');
    expect(() => stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'No evidence',
      content: 'No evidence content',
    })).toThrow(/--evidence/);
  });

  it('rejects unresolved mutable evidence labels with accepted file-anchor formats', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-unresolved');
    expect(() => stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Unresolved evidence',
      content: 'Unresolved evidence content',
      evidenceRefs: ['missing-label'],
    })).toThrow(/Unresolved or mutable session evidence[\s\S]*:line[\s\S]*:start-end/);
  });

  it('content-addresses Run, sealed artifact, and explicit inline roots', () => {
    const projectRoot = root();
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'typed-root-session',
      intent: 'typed evidence root coverage',
    });
    const store = new SessionStore(projectRoot);
    const artifactId = 'ART-typed-root-evidence';
    const artifactRelativePath = 'outputs/typed-root-evidence.txt';
    const artifactPath = join(store.sessionDir(created.session_id), artifactRelativePath);
    mkdirSync(join(store.sessionDir(created.session_id), 'outputs'), { recursive: true });
    const artifactBytes = Buffer.from('sealed artifact evidence\n', 'utf8');
    writeFileSync(artifactPath, artifactBytes);
    const artifactHash = createHash('sha256').update(artifactBytes).digest('hex');
    store.update(created.session_id, draft => {
      draft.artifacts.artifacts[artifactId] = {
        kind: 'evidence',
        role: 'evidence',
        producer_run_id: created.run_id,
        relative_path: artifactRelativePath,
        media_type: 'text/plain',
        schema_version: 'text/1.0',
        content_hash: artifactHash,
        size: artifactBytes.byteLength,
        status: 'sealed',
        derived_from: [],
        replaces: null,
      };
      draft.artifacts.revision++;
    });
    const staged = stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'Typed root candidate',
      content: 'Typed root candidate content',
      evidenceRefs: [
        `run:${created.run_id}`,
        `artifact:${artifactId}`,
        'inline:human-reviewed immutable assertion',
      ],
    });
    const candidate = summarizeSessionKnowledge(projectRoot, created.session_id, { readOnly: true })
      .candidates.find(item => item.candidate_id === staged.candidate_id);
    const descriptors = candidate?.source_snapshot?.evidence_root_descriptors ?? [];
    expect(descriptors.map(item => item.kind).sort()).toEqual(['artifact', 'inline', 'run']);
    const runRoot = descriptors.find(item => item.kind === 'run');
    const runBytes = readFileSync(join(store.runDir(created.session_id, created.run_id), 'run.json'));
    expect(runRoot).toMatchObject({
      kind: 'run',
      run_id: created.run_id,
      content_hash: createHash('sha256').update(runBytes).digest('hex'),
    });
    expect(descriptors.find(item => item.kind === 'artifact')).toMatchObject({
      kind: 'artifact',
      artifact_id: artifactId,
      content_hash: store.readBundle(created.session_id).artifacts.artifacts[artifactId].content_hash,
    });
    expect(descriptors.find(item => item.kind === 'inline')).toMatchObject({
      kind: 'inline',
      content: 'human-reviewed immutable assertion',
    });
  });

  it('records inputs visible in summary with origin=session', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-c');
    const result = recordSessionKnowledgeInputs(projectRoot, sessionId, ['spec:SPC-1'], 'validated', 'manual');
    expect(result.recorded).toBe(1);
    const summary = summarizeSessionKnowledge(projectRoot, sessionId, { readOnly: true });
    const input = summary.inputs.find(item => item.knowledge_id === 'spec:SPC-1');
    expect(input?.origin).toBe('session');
    expect(input?.run_id).toBe('');
    expect(summary.input_totals.validated).toBe(1);
  });

  it('keeps cross-origin same candidate IDs separately accounted (K7)', () => {
    const projectRoot = root();
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'cross-origin-session',
      intent: 'cross origin accounting',
    });
    const content = 'Shared insight across run and session ledgers';
    // Run-origin staging (run delta).
    const runStore = new SessionStore(projectRoot);
    expect(runStore.sessionExists(created.session_id)).toBe(true);
    stageRunKnowledgeCandidate(projectRoot, created.run_id, {
      target: 'knowhow',
      title: 'Shared insight',
      content,
    }, created.session_id);
    // Session-origin staging of the identical content on the same Session.
    const sessionResult = stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'Shared insight',
      content,
      evidenceRefs: ['inline:manual-note'],
    });

    const summary = summarizeSessionKnowledge(projectRoot, created.session_id, { readOnly: true });
    const matching = summary.candidates.filter(item => item.candidate_id === sessionResult.candidate_id);
    expect(matching).toHaveLength(2);
    const origins = matching.map(item => item.origin ?? 'run').sort();
    expect(origins).toEqual(['run', 'session']);
    const runEntry = matching.find(item => (item.origin ?? 'run') === 'run')!;
    expect(runEntry.run_ids).toEqual([created.run_id]);
  });

  it('refuses sidecar writes once the Session is sealed (S8)', () => {
    const projectRoot = root();
    const created = createRun({
      projectRoot,
      command: 'knowledge-demo',
      sessionId: 'seal-guard-session',
      intent: 'sealed write guard',
    });
    completeRun(projectRoot, created.run_id, created.session_id);
    sealSession(projectRoot, created.session_id, 'sealed for guard test');
    expect(() => stageSessionKnowledgeCandidate(projectRoot, created.session_id, {
      target: 'knowhow',
      title: 'Too late',
      content: 'Too late content',
      evidenceRefs: ['src/x.ts:1'],
    })).toThrow(/cannot mutate knowledge sidecars/);
  });

  it('allows canonical session/2.0 sidecar staging without a legacy status gate', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'v20-host');
    sealSession(projectRoot, sessionId, 'legacy session sealed before migration');
    writeFileSync(join(projectRoot, '.workflow', 'config.json'), JSON.stringify({
      session_schema: {
        schema_version: 'session-schema-selection/1.0',
        writer: 'session/2.0',
        features: { session_statusless: true },
      },
    }, null, 2), 'utf8');
    migrateSession(projectRoot, sessionId);
    expect(new SessionStore(projectRoot).readSessionRecordReadOnly(sessionId).schema_version)
      .toBe('session/2.0');

    const staged = stageSessionKnowledgeCandidate(projectRoot, sessionId, {
      target: 'knowhow',
      title: 'Statusless candidate',
      content: 'Statusless candidate content',
      evidenceRefs: ['src/v20.ts:4'],
    });
    expect(summarizeSessionKnowledge(projectRoot, sessionId, { readOnly: true }).candidates
      .find(candidate => candidate.candidate_id === staged.candidate_id)?.source_snapshot)
      .toMatchObject({ session_id: sessionId, candidate_version: 1 });
  });

  it('writes the session delta sidecar next to session.json', () => {
    const projectRoot = root();
    const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, 'host-d');
    recordSessionKnowledgeInputs(projectRoot, sessionId, ['spec:SPC-9'], 'cited', 'manual');
    const store = new SessionStore(projectRoot);
    expect(existsSync(sessionKnowledgeDeltaPath(store, sessionId))).toBe(true);
  });
});
