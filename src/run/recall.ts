import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createIntentIdentity, canonicalWorkspaceId } from './intent-identity.js';
import { runRecallV11Schema, sourceFenceSchema, type RunRecall, type RecallConfirmationRecord } from './protocol-schemas.js';
import { SessionStore } from './store.js';
import { sha256Digest, stableJsonUtf8 } from './transition-receipts.js';
import { createTopicIdentity, normalizeTopic, sameTopicIdentity } from './topic-identity.js';
import { assessSessionReuse } from './runtime.js';

export interface RecallRequest {
  command: string;
  intent: string;
  topic?: string;
  limit?: number;
  asOf?: string;
  interactive?: boolean;
}

function fileHash(path: string): string { return sha256Digest(readFileSync(path)); }
type SourceFence = NonNullable<RecallConfirmationRecord['source_fence']>;
export function buildSourceFence(projectRoot: string, sessionId: string, runId: string, workspaceLinkName: string | null = null): SourceFence {
  const store = new SessionStore(projectRoot);
  const bundle = store.readBundle(sessionId);
  const run = store.readRun(sessionId, runId);
  if (!['sealed', 'archived'].includes(bundle.session.status) || run.status !== 'sealed') {
    throw new Error('source must be an immutable sealed Session and sealed Run');
  }
  const selected = Object.values(bundle.artifacts.artifacts)
    .filter(item => item.producer_run_id === runId && item.status === 'sealed')
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path))
    .map(item => ({ kind: item.kind, relative_path: item.relative_path, content_hash: `sha256:${item.content_hash}` }));
  return sourceFenceSchema.parse({
    workspace_id: canonicalWorkspaceId(projectRoot), workspace_link_name: workspaceLinkName,
    session_id: sessionId, session_schema_version: bundle.session.schema_version,
    session_identity_revision: bundle.session.identity_revision,
    session_activity_revision: bundle.session.activity_revision,
    session_hash: fileHash(join(store.sessionDir(sessionId), 'session.json')),
    run_id: runId, run_schema_version: run.schema_version,
    run_hash: fileHash(join(store.runDir(sessionId, runId), 'run.json')),
    artifact_registry_revision: bundle.artifacts.revision, selected_artifacts: selected,
  });
}

export async function recallRuns(projectRoot: string, request: RecallRequest): Promise<RunRecall> {
  const asOf = request.asOf ?? new Date().toISOString();
  const store = new SessionStore(projectRoot);
  const topicIdentity = createTopicIdentity(
    projectRoot,
    request.topic?.trim() || request.intent,
    { source: request.topic ? 'explicit' : 'legacy-intent' },
  );
  const intentIdentity = createIntentIdentity(projectRoot, request.command, request.intent);
  const exact = store.listSessions({ statuses: ['running'] }).candidates
    .filter(({ session }) => session.topic_identity
      ? sameTopicIdentity(session.topic_identity, topicIdentity)
      : normalizeTopic(session.intent) === topicIdentity.normalized)
    .map(({ sessionId, session }) => ({
      candidate_id: `live:${sessionId}`, session_id: sessionId, status: 'running' as const,
      active_run_id: session.active_run_id, identity_revision: session.identity_revision,
      activity_revision: session.activity_revision, eligible_actions: [],
      exclusions: session.active_run_id ? ['ACTIVE_RUN_PRESENT'] : [],
      next_if_active: null,
    }));
  const reuseAssessments = exact.length === 1
    ? assessSessionReuse(projectRoot, exact[0].session_id, request.command).assessments
    : [];
  const result = {
    schema_version: 'run-recall/1.1' as const,
    request: { request_id: randomUUID(), request_hash: sha256Digest(stableJsonUtf8({ command: request.command, intent: request.intent, topic: topicIdentity.normalized, as_of: asOf })), command: request.command, intent: request.intent, workspace: canonicalWorkspaceId(projectRoot), as_of: asOf, interactive: request.interactive ?? false },
    intent_identity: intentIdentity,
    topic_identity: topicIdentity,
    exact_candidates: exact,
    historical_candidates: [],
    reuse_assessments: reuseAssessments,
    recommendation: { action: null, candidate_id: exact.length === 1 ? exact[0].candidate_id : null, automatic: false as const, reason_codes: [exact.length > 1 ? 'AMBIGUOUS_TOPIC_MATCH' : exact.length === 1 ? 'READ_ONLY_TOPIC_MATCH' : 'NO_RUNNING_TOPIC_MATCH'] },
    confirmation: { required: false, issuance_command: '', allowed_actions: [] },
    next: { suggest_only: true as const, command: null, reason: 'Recall is a read-only topic and reuse assessment; normal run prepare/create performs routing.' },
  };
  return runRecallV11Schema.parse(result);
}
