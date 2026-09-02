/**
 * Session-level knowledge ledger operations (origin=session).
 *
 * Implements K1/K2 of docs/knowledge-session-decoupling-mvp.md
 * (pi-maestro-flow repo):
 *   K1 — session-knowledge-delta sidecar writes; legacy 1.x sealed Sessions
 *        refuse writes while canonical 2.0 candidates use immutable source
 *        bindings (S8); run delta v1.0 remains byte-for-byte untouched (S1).
 *   K2 — idempotent synthetic knowledge Session creation for run-less
 *        daily sessions (ID = ksyn-<hash(host+project+date)>, host ids are
 *        mapping keys only, never Session-directory authority, S4).
 *
 * The schema, path, read helpers and summarize aggregation live in
 * knowledge.ts to keep ledger primitives single-sourced; this module owns the
 * write operations so knowledge.ts stays free of synthetic-session policy.
 */
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

import {
  addCandidate,
  addInput,
  createSessionDelta,
  createSessionKnowledgeCandidateSource,
  knowledgeCandidateId,
  sessionKnowledgeDeltaPath,
  sessionKnowledgeDeltaSchema,
  sourceRepositoryBinding,
  summarizeSessionKnowledge,
  upgradeKnowledgeLedgerForStaging,
  type KnowledgeCandidate,
  type KnowledgeInputSignal,
  type KnowledgeInputSource,
  type SessionKnowledgeDelta,
} from './knowledge.js';
import { artifactRegistrySchema, evidenceStoreSchema, sessionStateV30Schema } from './schemas.js';
import { SessionStore } from './store.js';
import {
  CURRENT_REPOSITORY_ALIAS,
  resolveRepositoryContext,
} from '../repository/context.js';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Mutate the Session-level knowledge sidecar atomically under the store lock.
 * Legacy 1.x Sessions retain their running/paused mutation guard. Canonical
 * session/2.0 has no Session status; immutable candidate source snapshots are
 * the authority fence for its session-source candidate writes.
 */
export function updateSessionKnowledgeSidecar<T>(
  projectRoot: string,
  sessionId: string,
  mutator: (
    draft: SessionKnowledgeDelta,
    source: { schemaVersion: string; activityRevision: number; store: SessionStore },
  ) => T,
): T {
  const store = new SessionStore(projectRoot);
  if (!store.sessionExists(sessionId)) throw new Error(`Session not found: ${sessionId}`);
  const path = sessionKnowledgeDeltaPath(store, sessionId);
  const sessionRecord = store.readSessionRecordReadOnly(sessionId);
  if (sessionRecord.schema_version === 'session/3.0') {
    return store.withV30KnowledgeTransaction(sessionId, tx => {
      const session = tx.readSession();
      if (session.status !== 'open') {
        throw new Error(`Session ${sessionId} is ${session.status} and cannot mutate knowledge sidecars`);
      }
      if (!Number.isSafeInteger(session.activity_revision) || session.activity_revision < 0) {
        throw new Error(`Session ${sessionId} has no valid activity revision for knowledge staging`);
      }
      const draft = structuredClone(tx.readJson(
        path,
        sessionKnowledgeDeltaSchema,
        createSessionDelta(sessionId, nowIso(), sourceRepositoryBinding(projectRoot)),
      ));
      const result = mutator(draft, {
        schemaVersion: session.schema_version,
        activityRevision: session.activity_revision,
        store,
      });
      tx.writeJson(path, draft, sessionKnowledgeDeltaSchema);
      return result;
    });
  }

  let result: T | undefined;
  store.updateJsonFile(
    path,
    sessionKnowledgeDeltaSchema,
    createSessionDelta(sessionId, nowIso(), sourceRepositoryBinding(projectRoot)),
    draft => {
      const session = store.readSessionRecordReadOnly(sessionId);
      if (session.schema_version === 'session/3.0') {
        // v3 has no running/paused lifecycle: an open Session may stage;
        // completed/archived Sessions are sealed against sidecar mutation.
        if (session.status !== 'open') {
          throw new Error(`Session ${sessionId} is ${session.status} and cannot mutate knowledge sidecars`);
        }
      } else if (session.schema_version !== 'session/2.0') {
        const status = store.readBundle(sessionId).session.status;
        if (status !== 'running' && status !== 'paused') {
          throw new Error(`Session ${sessionId} is ${status} and cannot mutate knowledge sidecars`);
        }
      }
      const activityRevision = session.activity_revision;
      if (!Number.isSafeInteger(activityRevision) || Number(activityRevision) < 0) {
        throw new Error(`Session ${sessionId} has no valid activity revision for knowledge staging`);
      }
      result = mutator(draft, {
        schemaVersion: session.schema_version,
        activityRevision: Number(activityRevision),
        store,
      });
    },
  );
  return result as T;
}

// ---------------------------------------------------------------------------
// K2 — synthetic knowledge Session
// ---------------------------------------------------------------------------

export const SYNTHETIC_SESSION_PREFIX = 'ksyn-';
const SYNTHETIC_SESSION_INTENT = 'knowledge-sedimentation';

/**
 * Deterministic synthetic Session ID: ksyn-<sha256(host|project|date)[:16]>.
 * Date partitioning rotates identity daily so there is no need for an
 * abandon/cleanup lifecycle (MVP-cut decision). Host identifiers are hash
 * inputs only — they never become Session-directory names (S4).
 */
export function syntheticKnowledgeSessionId(
  host: string,
  projectRoot: string,
  date: Date = new Date(),
): string {
  const normalizedHost = host.trim() || 'adhoc';
  const project = basename(resolve(projectRoot)) || 'project';
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const digest = createHash('sha256')
    .update(`${normalizedHost}\u0000${project}\u0000${day}`)
    .digest('hex')
    .slice(0, 16);
  return `${SYNTHETIC_SESSION_PREFIX}${digest}`;
}

/**
 * Idempotently ensure the synthetic knowledge Session for (host, project,
 * today) exists. Reuses the existing Session bundle when present.
 */
export function ensureSyntheticKnowledgeSession(
  projectRoot: string,
  host: string,
): { sessionId: string; created: boolean } {
  const store = new SessionStore(projectRoot);
  const sessionId = syntheticKnowledgeSessionId(host, projectRoot);
  const existed = store.sessionExists(sessionId);
  if (store.sessionSchemaSelection().writer === 'session/3.0') {
    if (!existed) {
      const now = nowIso();
      const session = sessionStateV30Schema.parse({
        schema_version: 'session/3.0',
        session_id: sessionId,
        objective: SYNTHETIC_SESSION_INTENT,
        definition_of_done: 'Capture explicitly attributed knowledge for this host and day',
        status: 'open',
        orchestration_revision: 1,
        activity_revision: 1,
        chain: [],
        decisions: [],
        active_run_ids: [],
        artifacts_ref: 'artifacts.json',
        evidence_ref: 'evidence.json',
        created_at: now,
        updated_at: now,
        completed_at: null,
        archived_at: null,
      });
      store.withV30Transaction(sessionId, tx => {
        if (tx.sessionExists()) return;
        tx.writeSession(session);
        tx.writeJson(join(store.sessionDir(sessionId), session.artifacts_ref), {
          schema_version: 'artifacts/1.0', revision: 0, artifacts: {}, aliases: {},
        }, artifactRegistrySchema);
        tx.writeJson(join(store.sessionDir(sessionId), session.evidence_ref), {
          schema_version: 'evidence/1.0', revision: 0, records: {},
        }, evidenceStoreSchema);
      });
    }
  } else {
    store.createSession(sessionId, SYNTHETIC_SESSION_INTENT, { ifExists: 'reuse' });
  }
  return { sessionId, created: !existed };
}

// ---------------------------------------------------------------------------
// K1 — stage / record against the Session ledger
// ---------------------------------------------------------------------------

/**
 * Stage a candidate on the Session-level ledger (origin=session).
 * Session-source candidates require non-empty evidence (S2/K5 precondition).
 */
export function stageSessionKnowledgeCandidate(
  projectRoot: string,
  sessionId: string,
  input: {
    target: KnowledgeCandidate['target'];
    action?: KnowledgeCandidate['action'];
    title: string;
    content: string;
    category?: string | null;
    evidenceRefs?: string[];
    repository?: string;
    keywords?: string[];
    sourceRef?: string | null;
    relatedPaths?: string[];
    appliesToRepoIds?: string[];
    type?: string | null;
    language?: string | null;
    decisionState?: string | null;
    lifecycleStatus?: string | null;
    tool?: boolean;
  },
): { session_id: string; candidate_id: string; origin: 'session' } {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new Error('Knowledge candidate title and content are required');
  const evidence = [...new Set(
    (input.evidenceRefs ?? []).map(ref => ref.trim()).filter(Boolean),
  )];
  if (evidence.length === 0) {
    throw new Error(
      'Session-source candidates require non-empty --evidence '
      + '(file:line / artifact / output anchors)',
    );
  }
  const sourceContext = resolveRepositoryContext(CURRENT_REPOSITORY_ALIAS, { projectRoot });
  const targetContext = resolveRepositoryContext(input.repository ?? CURRENT_REPOSITORY_ALIAS, {
    projectRoot,
    require: { mode: 'write', corpus: input.target },
  });
  if (targetContext.relation === 'linked' && !sourceContext.repoId) {
    throw new Error('Cross-repository staging requires a persisted source repository identity');
  }
  const normalizedCategory = input.category?.trim() || (input.target === 'spec' ? 'learning' : null);
  // addCandidate computes the canonical ID. This preview uses a scratch 1.1
  // ledger so the cross-origin conflict check sees the same immutable identity.
  const scratch = createSessionDelta(
    sessionId,
    nowIso(),
    sourceContext.repoId && sourceContext.identityPersisted
      ? { repo_id: sourceContext.repoId, workspace_id: sourceContext.workspaceId }
      : null,
  );
  const candidateId = addCandidate(scratch, {
    target: input.target,
    action: input.action ?? 'propose',
    title,
    content,
    category: normalizedCategory,
    source_kind: 'manual',
    evidence_refs: ['preview'],
    target_repository: targetContext,
    keywords: input.keywords,
    sourceRef: input.sourceRef,
    relatedPaths: input.relatedPaths,
    appliesToRepoIds: input.appliesToRepoIds,
    type: input.type,
    language: input.language,
    decisionState: input.decisionState,
    lifecycleStatus: input.lifecycleStatus,
    tool: input.tool,
  }, nowIso());
  const prior = summarizeSessionKnowledge(projectRoot, sessionId, {
    readOnly: true,
    strict: true,
  }).candidates.find(candidate =>
    candidate.candidate_id === candidateId && (candidate.origin ?? 'run') === 'session'
  );
  if (prior && prior.action !== (input.action ?? 'propose')) {
    throw new Error(
      `Candidate ${candidateId} already exists in Session ${sessionId} `
      + `with action ${prior.action}; resolve or promote it instead of restaging as `
      + `${input.action ?? 'propose'}`,
    );
  }
  const now = nowIso();
  const evidenceRefs = [...new Set([`session:${sessionId}`, ...evidence])];
  return updateSessionKnowledgeSidecar(projectRoot, sessionId, (draft, source) => {
    upgradeKnowledgeLedgerForStaging(draft, sourceContext, 'session');
    const retainedSource = draft.candidates.find(candidate => candidate.candidate_id === candidateId)
      ?.source_snapshot;
    const id = addCandidate(draft, {
      target: input.target,
      action: input.action ?? 'propose',
      title,
      content,
      category: normalizedCategory,
      source_kind: 'manual',
      evidence_refs: evidenceRefs,
      target_repository: targetContext,
      keywords: input.keywords,
      sourceRef: input.sourceRef,
      relatedPaths: input.relatedPaths,
      appliesToRepoIds: input.appliesToRepoIds,
      type: input.type,
      language: input.language,
      decisionState: input.decisionState,
      lifecycleStatus: input.lifecycleStatus,
      tool: input.tool,
      source_snapshot: retainedSource ?? createSessionKnowledgeCandidateSource(
        projectRoot,
        source.store,
        sessionId,
        source.activityRevision,
        content,
        evidenceRefs,
      ),
    }, now);
    draft.revision++;
    draft.updated_at = now;
    return { session_id: sessionId, candidate_id: id, origin: 'session' as const };
  });
}

/**
 * Record explicit knowledge attribution on the Session-level ledger.
 */
export function recordSessionKnowledgeInputs(
  projectRoot: string,
  sessionId: string,
  knowledgeIds: string[],
  signal: KnowledgeInputSignal = 'consumed',
  source: KnowledgeInputSource = 'manual',
  evidence: readonly string[] = [],
): { session_id: string; recorded: number; origin: 'session' } {
  const ids = [...new Set(knowledgeIds.map(id => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error('At least one knowledge ID is required');
  const now = nowIso();
  return updateSessionKnowledgeSidecar(projectRoot, sessionId, (draft) => {
    for (const id of ids) addInput(draft, id, signal, source, now, evidence);
    draft.revision++;
    draft.updated_at = now;
    return { session_id: sessionId, recorded: ids.length, origin: 'session' as const };
  });
}
