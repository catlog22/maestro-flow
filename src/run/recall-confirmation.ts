import { canonicalWorkspaceId } from './intent-identity.js';
import { loadWorkspaceConfig, resolveWorkspaceLinks } from '../config/index.js';
import { buildSourceFence } from './recall.js';
import { targetFenceSchema, type RecallConfirmationRecord } from './protocol-schemas.js';
import { SessionStore } from './store.js';
import { sha256Digest, stableJsonUtf8 } from './transition-receipts.js';

export interface RecallActionRequest {
  action: RecallConfirmationRecord['action']; target_session_id: string; command: string; intent: string;
  source_session_id?: string | null; source_run_id?: string | null; source_workspace?: string | null; args?: string[];
}
export function recallActionRequestHash(input: RecallActionRequest): string {
  return sha256Digest(stableJsonUtf8({
    action: input.action, target_session_id: input.target_session_id,
    command: input.command, intent: input.intent,
    source_session_id: input.source_session_id ?? null,
    source_run_id: input.source_run_id ?? null,
    source_workspace: input.source_workspace ?? null,
    args: input.args ?? [],
  }));
}
export function issueRecallConfirmation(projectRoot: string, input: RecallActionRequest) {
  const store = new SessionStore(projectRoot);
  if (store.sessionExists(input.target_session_id)) throw new Error(`target Session already exists: ${input.target_session_id}`);
  const link = input.source_workspace
    ? resolveWorkspaceLinks(projectRoot, loadWorkspaceConfig(projectRoot)).find(item => item.valid && item.name === input.source_workspace && (item.share as string[]).includes('session'))
    : null;
  if (input.source_workspace && !link) throw new Error(`linked workspace is unavailable or does not share session: ${input.source_workspace}`);
  if (input.source_workspace && input.action !== 'import') throw new Error('linked workspace sources are import-only');
  const sourceRoot = link?.resolvedPath ?? projectRoot;
  const source = input.source_session_id && input.source_run_id
    ? buildSourceFence(sourceRoot, input.source_session_id, input.source_run_id, link?.name ?? null) : null;
  if (input.action !== 'new' && !source) throw new Error(`${input.action} requires --source-session and --source-run`);
  const target = targetFenceSchema.parse({ workspace_id: canonicalWorkspaceId(projectRoot), session_id: input.target_session_id, must_not_exist: true, status: null, identity_revision: null, activity_revision: null, active_run_id: null, artifact_registry_revision: null });
  return store.issueRecallConfirmation({ action: input.action, candidate_id: source ? `history:${source.session_id}:${source.run_id}` : null, request_hash: recallActionRequestHash(input), source_fence: source, target_fence: target, target_session_id: input.target_session_id });
}
