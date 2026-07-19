import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { createIntentIdentity, canonicalWorkspaceId, normalizeIntent } from './intent-identity.js';
import { runRecallSchema, sourceFenceSchema, type RunRecall, type RecallConfirmationRecord } from './protocol-schemas.js';
import { SessionStore } from './store.js';
import { sha256Digest, stableJsonUtf8 } from './transition-receipts.js';

export interface RecallRequest {
  command: string;
  intent: string;
  limit?: number;
  asOf?: string;
  interactive?: boolean;
}

function fileHash(path: string): string { return sha256Digest(readFileSync(path)); }
function bp(value: number): number { return Math.max(0, Math.min(10_000, Math.trunc(value))); }
function words(value: string): Set<string> {
  return new Set(normalizeIntent(value).split(/[\p{White_Space}\p{Punctuation}\p{Symbol}]+/u).filter(Boolean));
}
function overlapBp(left: string, right: string): number {
  const a = words(left); const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return bp((intersection * 10_000) / (a.size + b.size - intersection));
}
function recencyBp(timestamp: string | null, asOf: string): number {
  if (!timestamp) return 0;
  const days = Math.max(0, (Date.parse(asOf) - Date.parse(timestamp)) / 86_400_000);
  return days <= 30 ? 10_000 : days <= 90 ? 7_500 : days <= 180 ? 5_000 : days <= 365 ? 2_500 : 0;
}

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

function latestSealedRun(store: SessionStore, sessionId: string): string | null {
  const dir = join(store.sessionDir(sessionId), 'runs');
  if (!existsSync(dir)) return null;
  let best: { id: string; sequence: number } | null = null;
  for (const id of readdirSync(dir).sort()) {
    try {
      const run = store.readRun(sessionId, id);
      if (run.status === 'sealed' && (!best || run.sequence > best.sequence)) best = { id, sequence: run.sequence };
    } catch { /* exclusion is represented by omission */ }
  }
  return best?.id ?? null;
}

function exactLiveCommand(
  session: ReturnType<SessionStore['readBundle']>['session'],
  command: string,
  identityHash: string,
): string {
  if (session.active_run_id) return `maestro run brief ${session.active_run_id} --session ${session.session_id}`;
  if (session.status === 'paused') {
    return `maestro session resume --session ${session.session_id}`
      + ` --request-id recall-resume-${session.identity_revision}-${session.activity_revision}`
      + ' --actor recall --reason exact-live-intent-selected'
      + ` --evidence ${identityHash}`
      + ` --expected-identity-revision ${session.identity_revision}`
      + ` --expected-activity-revision ${session.activity_revision}`;
  }
  if (session.orchestration.chain.some(step => step.status === 'pending' || step.status === 'running')) {
    return `maestro run next --session ${session.session_id}`;
  }
  return `maestro run create ${command} --session ${session.session_id}`;
}

async function wikiRanks(projectRoot: string, query: string, asOf: string, limit: number): Promise<Map<string, number>> {
  try {
    const linked = resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot))
      .filter(item => item.valid && (item.share as string[]).includes('session'))
      .map(item => ({ name: item.name, workflowRoot: item.workflowRoot, shareTypes: ['session'] as Array<'session'> }));
    const { WikiIndexer } = await import('#maestro-dashboard/wiki/wiki-indexer.js');
    const snapshot = await new WikiIndexer({ workflowRoot: join(projectRoot, '.workflow'), linkedWorkspaces: linked })
      .recallSnapshot(query, asOf, limit);
    return new Map(snapshot.candidates.map(candidate => [candidate.entry_id, candidate.score_bp]));
  } catch { return new Map(); }
}

export async function recallRuns(projectRoot: string, request: RecallRequest): Promise<RunRecall> {
  const asOf = request.asOf ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(100, request.limit ?? 20));
  const store = new SessionStore(projectRoot);
  const identity = createIntentIdentity(projectRoot, request.command, request.intent);
  const exact = store.listSessions({ statuses: ['running', 'paused'], intentIdentity: identity }).candidates
    .map(({ sessionId, session }) => ({
      candidate_id: `live:${sessionId}`, session_id: sessionId, status: session.status as 'running' | 'paused',
      active_run_id: session.active_run_id, identity_revision: session.identity_revision,
      activity_revision: session.activity_revision, eligible_actions: ['resume'] as const,
      exclusions: session.active_run_id ? ['ACTIVE_RUN_PRESENT'] : [],
      next_if_active: exactLiveCommand(session, request.command, identity.normalized_hash),
    }));
  const wiki = await wikiRanks(projectRoot, `${request.command} ${request.intent}`, asOf, limit * 3);
  const historical = [] as RunRecall['historical_candidates'];
  for (const { sessionId, session } of store.listSessions({ statuses: ['sealed', 'archived'] }).candidates) {
    const runId = latestSealedRun(store, sessionId); if (!runId) continue;
    const run = store.readRun(sessionId, runId);
    const intentBp = overlapBp(request.intent, session.intent);
    const commandBp = run.command.name === request.command ? 10_000 : 0;
    const artifactBp = 10_000;
    const recentBp = recencyBp(run.sealed_at, asOf);
    const wikiBp = [...wiki.entries()].find(([id]) => id.includes(sessionId) && id.includes(runId))?.[1] ?? 0;
    const score = bp((intentBp * 4 + commandBp * 3 + artifactBp + recentBp + wikiBp) / 10);
    const band = score >= 7_500 ? 'strong_suggestion' : score >= 5_000 ? 'weak_suggestion' : 'hidden_by_default';
    historical.push({
      candidate_id: `history:${sessionId}:${runId}`, session_id: sessionId, run_id: runId,
      workspace_scope: 'local', source_status: session.status as 'sealed' | 'archived', score_bp: score, band,
      advisory_embedding_bp: null, eligible_actions: ['fork', 'import'], exclusions: [],
      feature_snapshot: { intent_overlap_bp: intentBp, command_compatibility_bp: commandBp, artifact_coverage_bp: artifactBp, recency_bp: recentBp, wiki_bm25_bp: wikiBp, embedding_weight_bp: 0 },
      source_fence: buildSourceFence(projectRoot, sessionId, runId), tied: false,
    });
  }
  for (const link of resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot)).filter(item => item.valid && (item.share as string[]).includes('session'))) {
    const linkedStore = new SessionStore(link.resolvedPath);
    for (const { sessionId, session } of linkedStore.listSessions({ statuses: ['sealed', 'archived'] }).candidates) {
      const runId = latestSealedRun(linkedStore, sessionId); if (!runId) continue;
      const run = linkedStore.readRun(sessionId, runId);
      const intentBp = overlapBp(request.intent, session.intent);
      const commandBp = run.command.name === request.command ? 10_000 : 0;
      const recentBp = recencyBp(run.sealed_at, asOf);
      const score = bp((intentBp * 5 + commandBp * 3 + 10_000 + recentBp) / 10);
      historical.push({
        candidate_id: `linked:${link.name}:${sessionId}:${runId}`, session_id: sessionId, run_id: runId,
        workspace_scope: 'linked', source_status: session.status as 'sealed' | 'archived', score_bp: score,
        band: score >= 7_500 ? 'strong_suggestion' : score >= 5_000 ? 'weak_suggestion' : 'hidden_by_default',
        advisory_embedding_bp: null, eligible_actions: ['import'], exclusions: ['LINKED_SOURCE_IMPORT_ONLY'],
        feature_snapshot: { intent_overlap_bp: intentBp, command_compatibility_bp: commandBp, artifact_coverage_bp: 10_000, recency_bp: recentBp, wiki_bm25_bp: 0, embedding_weight_bp: 0 },
        source_fence: buildSourceFence(link.resolvedPath, sessionId, runId, link.name), tied: false,
      });
    }
  }
  historical.sort((a, b) => b.score_bp - a.score_bp || a.candidate_id.localeCompare(b.candidate_id));
  const visible = historical.slice(0, limit);
  if (visible.length > 1 && visible[0].score_bp === visible[1].score_bp) {
    const top = visible[0].score_bp; for (const item of visible) if (item.score_bp === top) item.tied = true;
  }
  const recommendation = exact.length === 1
    ? { action: 'resume' as const, candidate_id: exact[0].candidate_id, automatic: false as const, reason_codes: ['EXACT_LIVE_IDENTITY', ...(exact[0].active_run_id ? ['ACTIVE_RUN_PRESENT'] : [])] }
    : exact.length > 1
      ? { action: null, candidate_id: null, automatic: false as const, reason_codes: ['AMBIGUOUS_EXACT_MATCH'] }
      : visible[0] && !visible[0].tied && visible[0].band !== 'hidden_by_default'
        ? { action: 'fork' as const, candidate_id: visible[0].candidate_id, automatic: false as const, reason_codes: [visible[0].band === 'strong_suggestion' ? 'STRONG_SIMILARITY' : 'WEAK_SIMILARITY'] }
        : { action: 'new' as const, candidate_id: null, automatic: false as const, reason_codes: [visible[0]?.tied ? 'SCORE_TIE' : 'NEW_SESSION_AVAILABLE'] };
  const result = {
    schema_version: 'run-recall/1.0' as const,
    request: { request_id: randomUUID(), request_hash: sha256Digest(stableJsonUtf8({ command: request.command, intent: request.intent, as_of: asOf })), command: request.command, intent: request.intent, workspace: canonicalWorkspaceId(projectRoot), as_of: asOf, interactive: request.interactive ?? false },
    intent_identity: identity, exact_candidates: exact, historical_candidates: visible,
    recommendation,
    confirmation: exact.length > 0
      ? { required: false, issuance_command: '', allowed_actions: [] }
      : { required: true, issuance_command: 'maestro run recall-confirm <fork|import|new> ...', allowed_actions: ['fork', 'import', 'new'] as const },
    next: exact.length === 1
      ? { suggest_only: true as const, command: exact[0].next_if_active, reason: 'Exact live Session locator from SessionStore authority; execute explicitly.' }
      : { suggest_only: true as const, command: null, reason: exact.length > 1 ? 'Multiple exact live Sessions are ambiguous; select an exact Session ID.' : 'Historical similarity is advisory; issue a confirmation token before fork/import/new.' },
  };
  return runRecallSchema.parse(result);
}
