import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  intentIdentitySchema,
  type IntentIdentity,
} from './protocol-schemas.js';

const UNICODE_WHITESPACE = /\p{White_Space}+/gu;

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/**
 * Normalize intent text for exact identity only. This intentionally preserves
 * punctuation, emoji, combining marks after NFKC, and the full string length.
 * It must never be reused as a filesystem slug.
 */
export function normalizeIntent(value: string): string {
  return value
    .normalize('NFKC')
    .replace(UNICODE_WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

export function canonicalWorkspaceId(projectRoot: string): string {
  const canonical = resolve(projectRoot).replaceAll('\\', '/').normalize('NFKC').toLowerCase();
  return sha256(`workspace-id/1.0\u0000${canonical}`);
}

export function canonicalCommandIdentity(command: string): string {
  return command
    .normalize('NFKC')
    .replace(UNICODE_WHITESPACE, ' ')
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase();
}

export interface CreateIntentIdentityOptions {
  source?: IntentIdentity['source'];
  backfillStatus?: IntentIdentity['backfill_status'];
}

export function createIntentIdentity(
  projectRoot: string,
  command: string,
  intent: string,
  options: CreateIntentIdentityOptions = {},
): IntentIdentity {
  const verbatim = intent.trim();
  const normalized = normalizeIntent(intent);
  const workspaceId = canonicalWorkspaceId(projectRoot);
  const commandIdentity = canonicalCommandIdentity(command);
  const envelope = JSON.stringify({
    schema_version: 'intent-identity/1.0',
    workspace_id: workspaceId,
    command: commandIdentity,
    normalized,
  });
  return intentIdentitySchema.parse({
    schema_version: 'intent-identity/1.0',
    normalization: 'NFKC+unicode-lower+whitespace-collapse/1',
    workspace_id: workspaceId,
    command: commandIdentity,
    verbatim,
    normalized,
    normalized_length: [...normalized].length,
    normalized_hash: sha256(envelope),
    revision: 1,
    source: options.source ?? 'persisted',
    backfill_status: options.backfillStatus ?? 'native',
    empty: normalized.length === 0,
  });
}

export function sameIntentIdentity(left: IntentIdentity, right: IntentIdentity): boolean {
  return left.schema_version === right.schema_version
    && left.workspace_id === right.workspace_id
    && left.command === right.command
    && left.normalized_hash === right.normalized_hash;
}

export { intentIdentitySchema, type IntentIdentity } from './protocol-schemas.js';
