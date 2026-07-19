import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const UNICODE_WHITESPACE = /\p{White_Space}+/gu;

export const TOPIC_IDENTITY_SCHEMA_VERSION = 'topic-identity/1.0' as const;
export const TOPIC_NORMALIZATION = 'NFKC+unicode-lower+whitespace-collapse/1' as const;
export type TopicIdentitySource = 'explicit' | 'workflow' | 'legacy-intent';

export interface TopicIdentity {
  schema_version: typeof TOPIC_IDENTITY_SCHEMA_VERSION;
  normalization: typeof TOPIC_NORMALIZATION;
  workspace_id: string;
  source: TopicIdentitySource;
  verbatim: string;
  normalized: string;
  normalized_length: number;
  normalized_hash: string;
  identity_hash: string;
  revision: 1;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/**
 * Normalize a user-supplied topic without deriving identity from a command.
 * Punctuation, emoji, and the full normalized text remain identity-significant.
 */
export function normalizeTopic(value: string): string {
  return value
    .normalize('NFKC')
    .replace(UNICODE_WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Produce the same opaque workspace scope for equivalent absolute paths.
 * The path itself is intentionally not persisted in the identity.
 */
export function canonicalTopicWorkspaceId(workspaceRoot: string): string {
  const canonical = resolve(workspaceRoot)
    .replaceAll('\\', '/')
    .normalize('NFKC')
    .toLowerCase();
  return sha256(`workspace-id/1.0\u0000${canonical}`);
}

/**
 * Create an identity from verbatim topic text and workspace scope. Interactive
 * callers must supply an explicit topic; workflow and legacy converters record
 * their provenance through `options.source` rather than deriving from command.
 */
export interface CreateTopicIdentityOptions {
  source?: TopicIdentitySource;
}

export function createTopicIdentity(
  workspaceRoot: string,
  topic: string,
  options: CreateTopicIdentityOptions = {},
): TopicIdentity {
  const normalized = normalizeTopic(topic);
  if (normalized.length === 0) {
    throw new Error('Topic identity requires a non-empty explicit topic');
  }

  const workspaceId = canonicalTopicWorkspaceId(workspaceRoot);
  const normalizedHash = sha256(`topic-normalized/1.0\u0000${normalized}`);
  const identityHash = sha256(JSON.stringify({
    schema_version: TOPIC_IDENTITY_SCHEMA_VERSION,
    workspace_id: workspaceId,
    normalized_hash: normalizedHash,
  }));

  return {
    schema_version: TOPIC_IDENTITY_SCHEMA_VERSION,
    normalization: TOPIC_NORMALIZATION,
    workspace_id: workspaceId,
    source: options.source ?? 'explicit',
    verbatim: topic,
    normalized,
    normalized_length: [...normalized].length,
    normalized_hash: normalizedHash,
    identity_hash: identityHash,
    revision: 1,
  };
}

export function sameTopicIdentity(left: TopicIdentity, right: TopicIdentity): boolean {
  return left.schema_version === right.schema_version
    && left.workspace_id === right.workspace_id
    && left.normalized_hash === right.normalized_hash
    && left.identity_hash === right.identity_hash;
}
