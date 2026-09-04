/**
 * Shared types and utilities for the search daemon (client + server).
 * Single source of truth — both daemon.ts and daemon-client.ts import from here.
 */

import { isAbsolute, join, resolve } from 'node:path';
import {
  existsSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import type { WikiEntry, WikiSearchFilters } from '#maestro-dashboard/wiki/wiki-types.js';
import type { SearchDiagnostics } from './diagnostics.js';
import type { SearchCandidateBudget } from './candidate-budget.js';

const DAEMON_FILE = 'search-daemon.json';
export const DAEMON_SPAWN_LOCK_FILE = 'search-daemon-spawning';

/** Protocol v2 is authenticated with the per-process descriptor instanceId. */
export const SEARCH_DAEMON_PROTOCOL = 'maestro-search-daemon/v2' as const;
export const DAEMON_MAX_QUERY_CHARS = 4_096;
export const DAEMON_MAX_RESULTS = 500;
export const DAEMON_MAX_REQUEST_BYTES = 64 * 1024;
export const DAEMON_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export type DaemonState = 'starting' | 'ready' | 'draining' | 'stopped';

/**
 * Descriptor written by daemon implementations before protocol v2.
 *
 * It remains readable so status output can explain it, but it is never trusted
 * for search or shutdown: a PID alone is not proof that the process occupying it
 * is the daemon that wrote this file.
 */
export interface LegacyDaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export interface DaemonInfoV2 extends LegacyDaemonInfo {
  protocol: typeof SEARCH_DAEMON_PROTOCOL;
  instanceId: string;
  /** Canonical absolute workflow root; this fences descriptors by workspace. */
  workflowRoot: string;
  /** Effective repository/link authority captured when this daemon started. */
  authorityKey?: string;
}

export type DaemonInfo = LegacyDaemonInfo | DaemonInfoV2;

export interface DaemonSearchRequest {
  action: 'search' | 'load' | 'invalidate' | 'ping' | 'health' | 'shutdown';
  query?: string;
  limit?: number;
  skipEmbedding?: boolean;
  filters?: WikiSearchFilters;
  /** One boundary-computed budget; omitted keeps the legacy provider path. */
  candidateBudget?: SearchCandidateBudget;
  /** Opt-in only; diagnostics are request-scoped and never persisted. */
  diagnostics?: boolean | { requestId?: string };
  protocol?: typeof SEARCH_DAEMON_PROTOCOL;
  instanceId?: string;
  workflowRoot?: string;
}

export interface DaemonSearchResponse {
  ok: boolean;
  results?: Array<{ entry: WikiEntry; score: number }>;
  /** Full warm index used by `maestro load`; oversized indexes fall back locally. */
  entries?: WikiEntry[];
  generatedAt?: number;
  embeddingUsed?: boolean;
  embeddingDocs?: number;
  /** True only when the daemon applied request filters before ranking truncation. */
  filtersApplied?: boolean;
  /** Optional request-scoped diagnostics; older daemons omit this field. */
  diagnostics?: SearchDiagnostics;
  error?: string;
  protocol?: typeof SEARCH_DAEMON_PROTOCOL;
  instanceId?: string;
  workflowRoot?: string;
  state?: DaemonState;
  pid?: number;
  startedAt?: string;
  activeRequests?: number;
  activeConnections?: number;
  idleTimeoutMs?: number;
  idleDeadline?: string | null;
  authorityKey?: string;
}

/** Starting/draining health is observable but is never startup readiness. */
export function isDaemonReadyResponse(
  response: DaemonSearchResponse | null | undefined,
): response is DaemonSearchResponse & { ok: true; state: 'ready' } {
  return response?.ok === true && response.state === 'ready';
}

export type DaemonRequestValidation =
  | { ok: true; request: DaemonSearchRequest }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBaseDaemonInfo(value: unknown): value is LegacyDaemonInfo {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.pid) && (value.pid as number) > 0
    && Number.isInteger(value.port) && (value.port as number) > 0 && (value.port as number) <= 65_535
    && typeof value.startedAt === 'string' && value.startedAt.length > 0;
}

function isInstanceId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Resolve symlinks when possible and make Windows path comparisons stable. */
export function canonicalWorkflowRoot(workflowRoot: string): string {
  let canonical: string;
  try { canonical = realpathSync.native(workflowRoot); }
  catch { canonical = resolve(workflowRoot); }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

export function isDaemonInfoV2(
  info: DaemonInfo | unknown,
  workflowRoot?: string,
): info is DaemonInfoV2 {
  if (!isBaseDaemonInfo(info) || !isRecord(info)) return false;
  if (info.protocol !== SEARCH_DAEMON_PROTOCOL
    || !isInstanceId(info.instanceId)
    || typeof info.workflowRoot !== 'string'
    || info.workflowRoot.length === 0
    || !isAbsolute(info.workflowRoot)
    || info.workflowRoot !== canonicalWorkflowRoot(info.workflowRoot)
    || !Number.isFinite(Date.parse(info.startedAt))) return false;
  return workflowRoot === undefined
    || info.workflowRoot === canonicalWorkflowRoot(workflowRoot);
}

export function getDaemonPath(workflowRoot: string): string {
  return join(workflowRoot, DAEMON_FILE);
}

export function getDaemonSpawnLockPath(workflowRoot: string): string {
  return join(workflowRoot, DAEMON_SPAWN_LOCK_FILE);
}

/**
 * Parse and validate both descriptor generations. Partially-v2 or malformed v2
 * data is rejected rather than silently downgraded to an unverified descriptor.
 */
export function readDaemonInfo(workflowRoot: string): DaemonInfo | null {
  const path = getDaemonPath(workflowRoot);
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isBaseDaemonInfo(value) || !isRecord(value)) return null;
    const hasV2Field = 'protocol' in value || 'instanceId' in value || 'workflowRoot' in value;
    if (hasV2Field && !isDaemonInfoV2(value)) return null;
    return value as DaemonInfo;
  } catch { return null; }
}

/** PID existence is only a stale-file hint. It is never daemon authentication. */
export function isDaemonAlive(info: DaemonInfo): boolean {
  if (!isBaseDaemonInfo(info)) return false;
  try { process.kill(info.pid, 0); return true; } catch { return false; }
}

export function daemonIdentityRequest(info: DaemonInfoV2): Pick<
  DaemonSearchRequest,
  'protocol' | 'instanceId' | 'workflowRoot'
> {
  return {
    protocol: SEARCH_DAEMON_PROTOCOL,
    instanceId: info.instanceId,
    workflowRoot: info.workflowRoot,
  };
}

export function isResponseFromDaemon(
  info: DaemonInfoV2,
  response: DaemonSearchResponse,
): boolean {
  return response.protocol === SEARCH_DAEMON_PROTOCOL
    && response.instanceId === info.instanceId
    && response.workflowRoot === info.workflowRoot
    && response.pid === info.pid;
}

/** Remove a v2 descriptor only when the same instance still owns the path. */
export function deleteDaemonInfoIfOwned(
  workflowRoot: string,
  owner: Pick<DaemonInfoV2, 'instanceId' | 'workflowRoot'>,
): boolean {
  const current = readDaemonInfo(workflowRoot);
  if (!current || !isDaemonInfoV2(current, workflowRoot)) return false;
  if (current.instanceId !== owner.instanceId || current.workflowRoot !== owner.workflowRoot) return false;
  try { unlinkSync(getDaemonPath(workflowRoot)); return true; } catch { return false; }
}

/**
 * Reclaim a descriptor only after its recorded PID is dead and the descriptor
 * still matches the inspected value. This is used during startup, never stop.
 */
export function deleteDaemonInfoIfStale(
  workflowRoot: string,
  expected: DaemonInfo,
): boolean {
  if (isDaemonAlive(expected)) return false;
  const current = readDaemonInfo(workflowRoot);
  if (!current) return false;
  const sameBase = current.pid === expected.pid
    && current.port === expected.port
    && current.startedAt === expected.startedAt;
  const sameGeneration = isDaemonInfoV2(current) === isDaemonInfoV2(expected);
  const sameV2Owner = !isDaemonInfoV2(current) || !isDaemonInfoV2(expected)
    || (current.instanceId === expected.instanceId && current.workflowRoot === expected.workflowRoot);
  if (!sameBase || !sameGeneration || !sameV2Owner) return false;
  try { unlinkSync(getDaemonPath(workflowRoot)); return true; } catch { return false; }
}

/** Release a spawn lock only when the caller still owns its opaque token. */
export function releaseDaemonSpawnLock(workflowRoot: string, token: string | undefined): boolean {
  if (!token) return false;
  const path = getDaemonSpawnLockPath(workflowRoot);
  try {
    if (readFileSync(path, 'utf-8') !== token) return false;
    unlinkSync(path);
    return true;
  } catch { return false; }
}

/**
 * Once a v2 descriptor is atomically owned, it safely supersedes every spawn
 * arbitration artifact: all other contenders must observe the live descriptor
 * before spawning or fail their own descriptor `wx` claim.
 */
export function deleteDaemonSpawnLocksIfOwned(
  workflowRoot: string,
  owner: Pick<DaemonInfoV2, 'instanceId' | 'workflowRoot'>,
): boolean {
  const current = readDaemonInfo(workflowRoot);
  if (!current || !isDaemonInfoV2(current, workflowRoot)) return false;
  if (current.instanceId !== owner.instanceId || current.workflowRoot !== owner.workflowRoot) return false;
  let removed = false;
  for (const path of [getDaemonSpawnLockPath(workflowRoot), `${getDaemonSpawnLockPath(workflowRoot)}.reclaim`]) {
    try { unlinkSync(path); removed = true; }
    catch { /* already absent or concurrently owner-cleaned */ }
  }
  return removed;
}

function validateIdentityFields(value: Record<string, unknown>, required: boolean): string | null {
  const present = value.protocol !== undefined || value.instanceId !== undefined || value.workflowRoot !== undefined;
  if (!required && !present) return null;
  if (value.protocol !== SEARCH_DAEMON_PROTOCOL) return 'invalid daemon protocol';
  if (!isInstanceId(value.instanceId)) return 'invalid daemon instanceId';
  if (typeof value.workflowRoot !== 'string' || value.workflowRoot.length === 0 || value.workflowRoot.length > 32_768) {
    return 'invalid daemon workflowRoot';
  }
  return null;
}

function validateDiagnostics(value: unknown): string | null {
  if (value === undefined || value === false) return null;
  if (value === true) return null;
  if (!isRecord(value)) return 'diagnostics must be a boolean or object';
  for (const key of Object.keys(value)) {
    if (key !== 'requestId') return `unknown diagnostics field: ${key}`;
  }
  if (value.requestId !== undefined && !isInstanceId(value.requestId)) {
    return 'diagnostics.requestId must be a UUID';
  }
  return null;
}

function validateCandidateBudget(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'candidateBudget must be an object';
  const allowed = new Set([
    'resultLimit', 'limit', 'candidateLimit', 'initialCandidateLimit',
    'maxCandidateLimit', 'hardCap', 'mode', 'adaptive', 'escalated',
    'escalationCount', 'legacyCandidateLimit', 'surface',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return `unknown candidateBudget field: ${key}`;
  }
  if (value.mode !== 'legacy' && value.mode !== 'adaptive') return 'candidateBudget.mode is invalid';
  if (typeof value.adaptive !== 'boolean' || value.adaptive !== (value.mode === 'adaptive')) {
    return 'candidateBudget.adaptive is invalid';
  }
  const integerFields = [
    'resultLimit', 'limit', 'candidateLimit', 'initialCandidateLimit',
    'maxCandidateLimit', 'hardCap', 'escalationCount', 'legacyCandidateLimit',
  ];
  for (const field of integerFields) {
    if (!Number.isSafeInteger(value[field])) return `candidateBudget.${field} must be an integer`;
    if ((value[field] as number) < 0 || (value[field] as number) > DAEMON_MAX_RESULTS) {
      return `candidateBudget.${field} is out of bounds`;
    }
  }
  const maxCandidateLimit = value.maxCandidateLimit as number;
  const hardCap = value.hardCap as number;
  const candidateLimit = value.candidateLimit as number;
  const initialCandidateLimit = value.initialCandidateLimit as number;
  const escalationCount = value.escalationCount as number;
  if (maxCandidateLimit !== hardCap || hardCap === 0) {
    return 'candidateBudget cap is inconsistent';
  }
  if (candidateLimit > maxCandidateLimit || initialCandidateLimit > maxCandidateLimit) {
    return 'candidateBudget candidateLimit exceeds hard cap';
  }
  if (typeof value.escalated !== 'boolean' || escalationCount > 1) {
    return 'candidateBudget escalation is invalid';
  }
  if (typeof value.surface !== 'string' || ![
    'search', 'wiki', 'mixed', 'indexer', 'planned', 'kg', 'code', 'arch-kb',
  ].includes(value.surface)) return 'candidateBudget.surface is invalid';
  return null;
}

function validateFilters(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'filters must be an object';
  const allowed = new Set([
    'type', 'category', 'tag', 'keyword', 'workspace',
    'repoId', 'repoAlias', 'applicableRepoId', 'includeDeprecated',
  ]);
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.has(key)) return `unknown filter: ${key}`;
    if (key === 'includeDeprecated') {
      if (typeof field !== 'boolean') return 'filters.includeDeprecated must be a boolean';
    } else if (typeof field !== 'string' || field.length > DAEMON_MAX_QUERY_CHARS) {
      return `filters.${key} must be a bounded string`;
    }
  }
  return null;
}

/** Strict protocol boundary validation before any indexer work is started. */
export function validateDaemonRequest(value: unknown): DaemonRequestValidation {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return { ok: false, error: 'request must be an object with an action' };
  }
  const action = value.action;
  if (!['search', 'load', 'invalidate', 'ping', 'health', 'shutdown'].includes(action)) {
    return { ok: false, error: 'unknown action' };
  }

  const identityError = validateIdentityFields(
    value,
    action === 'load' || action === 'ping' || action === 'health' || action === 'shutdown',
  );
  if (identityError) return { ok: false, error: identityError };

  const commonKeys = new Set(['action', 'protocol', 'instanceId', 'workflowRoot']);
  if (action === 'search') {
    if (typeof value.query !== 'string' || value.query.trim().length === 0) {
      return { ok: false, error: 'query must be a non-empty string' };
    }
    if (value.query.length > DAEMON_MAX_QUERY_CHARS) {
      return { ok: false, error: `query exceeds ${DAEMON_MAX_QUERY_CHARS} characters` };
    }
    if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > DAEMON_MAX_RESULTS) {
      return { ok: false, error: `limit must be an integer between 1 and ${DAEMON_MAX_RESULTS}` };
    }
    if (value.skipEmbedding !== undefined && typeof value.skipEmbedding !== 'boolean') {
      return { ok: false, error: 'skipEmbedding must be a boolean' };
    }
    const filtersError = validateFilters(value.filters);
    if (filtersError) return { ok: false, error: filtersError };
    const candidateBudgetError = validateCandidateBudget(value.candidateBudget);
    if (candidateBudgetError) return { ok: false, error: candidateBudgetError };
    const diagnosticsError = validateDiagnostics(value.diagnostics);
    if (diagnosticsError) return { ok: false, error: diagnosticsError };
    for (const key of Object.keys(value)) {
      if (!commonKeys.has(key) && !['query', 'limit', 'skipEmbedding', 'filters', 'candidateBudget', 'diagnostics'].includes(key)) {
        return { ok: false, error: `unknown request field: ${key}` };
      }
    }
  } else {
    for (const key of Object.keys(value)) {
      if (!commonKeys.has(key)) return { ok: false, error: `unknown request field: ${key}` };
    }
  }

  return { ok: true, request: value as unknown as DaemonSearchRequest };
}
