/**
 * Knowledge write-authority identity plane (K3/K4 of
 * docs/knowledge-session-decoupling-mvp.md).
 *
 * Write authorization tiers (S3):
 *   A — explicit --run/--session/--channel, fenced lease (epoch claim with
 *       30s staleness), host-injected channels (Pi env / hook registration);
 *   C — narrowed scan (exactly ONE running Session AND zero live channels),
 *       always warned;
 *   anything else — fail-closed with a listing of live channels and running
 *   Sessions. Guessing is forbidden; reads are never blocked by identity
 *   failure (S7) because only write paths call into this module.
 *
 * Channels live per-workspace at `.workflow/tmp/channels/<identity>.channel.json`;
 * hook hosts register via the coordinator-tracker write point, manual callers
 * via --channel / MAESTRO_CHANNEL. Lineage fingerprints are intentionally NOT
 * implemented in MVP (deferred, see MVP doc §8).
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ensureSyntheticKnowledgeSession } from './session-knowledge.js';
import type { SessionStore } from './store.js';

export const CHANNEL_SCHEMA_VERSION = 'knowledge-channel/1.0' as const;
/** Generous idle cap: hook events refresh; expiry only fails writes closed. */
export const CHANNEL_TTL_MS = 24 * 60 * 60 * 1000;
/** Mirrors the plugin WorkflowLeaseStore staleAfterMs. */
export const LEASE_STALE_MS = 30_000;
export const MAESTRO_CHANNEL_ENV = 'MAESTRO_CHANNEL';
export const PI_HOST_SESSION_ENV = 'PI_HOST_SESSION_ID';

export type ChannelHostKind = 'pi' | 'hook' | 'manual';

export interface KnowledgeChannelRecord {
  schema_version: typeof CHANNEL_SCHEMA_VERSION;
  identity: string;
  host_kind: ChannelHostKind;
  /** Bound governance context, if resolved. */
  context: { kind: 'session' | 'run'; session_id: string; run_id?: string } | null;
  /** Reserved (MVP always null). */
  workspace_id: string | null;
  /** Reserved for a future CAS upgrade; MVP writes 1. */
  revision: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

// ---------------------------------------------------------------------------
// Channel files
// ---------------------------------------------------------------------------

function tmpRoot(projectRoot: string): string {
  return join(projectRoot, '.workflow', 'tmp');
}

export function channelsDir(projectRoot: string): string {
  return join(tmpRoot(projectRoot), 'channels');
}

/**
 * Normalize a caller-supplied identity into a safe file segment. Non-empty
 * guaranteed; unsafe characters collapsed; bounded length.
 */
export function sanitizeChannelIdentity(raw: string): string {
  const trimmed = raw.trim().slice(0, 128);
  if (!trimmed) throw new Error('Channel identity must be non-empty');
  const safe = trimmed
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 128);
  if (!safe || safe === '.' || safe === '..') {
    throw new Error(`Invalid channel identity: "${raw}"`);
  }
  return safe;
}

export function channelFilePath(projectRoot: string, identity: string): string {
  return join(channelsDir(projectRoot), `${sanitizeChannelIdentity(identity)}.channel.json`);
}

function isFreshChannel(record: KnowledgeChannelRecord, nowMs: number): boolean {
  const expires = Date.parse(record.expires_at);
  return Number.isFinite(expires) && expires > nowMs;
}

export function readChannel(
  projectRoot: string,
  identity: string,
): KnowledgeChannelRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(channelFilePath(projectRoot, identity), 'utf8'));
    if (parsed?.schema_version !== CHANNEL_SCHEMA_VERSION) return null;
    if (typeof parsed.identity !== 'string' || typeof parsed.host_kind !== 'string') return null;
    return parsed as KnowledgeChannelRecord;
  } catch {
    return null;
  }
}

/** Live = parseable, schema-matching, unexpired, and carrying a bound context. */
export function listLiveChannels(
  projectRoot: string,
  nowMs: number = Date.now(),
): KnowledgeChannelRecord[] {
  const dir = channelsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const live: KnowledgeChannelRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.channel.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed?.schema_version !== CHANNEL_SCHEMA_VERSION) continue;
      if (!isFreshChannel(parsed, nowMs)) continue;
      if (!parsed.context || typeof parsed.context.session_id !== 'string') continue;
      live.push(parsed as KnowledgeChannelRecord);
    } catch {
      // Corrupt/partial channel files never break resolution.
    }
  }
  return live;
}

/** Atomic-ish write: temp file + rename (same convention as lease claims). */
export function writeChannel(
  projectRoot: string,
  record: KnowledgeChannelRecord,
): void {
  const dir = channelsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const finalPath = channelFilePath(projectRoot, record.identity);
  const pendingPath = `${finalPath}.${createHash('sha256')
    .update(`${record.identity}\u0000${record.last_seen_at}`)
    .digest('hex')
    .slice(0, 8)}.pending`;
  writeFileSync(pendingPath, `${JSON.stringify(record)}\n`, 'utf8');
  renameSync(pendingPath, finalPath);
}

/**
 * Create or refresh a channel. Existing bound context is preserved unless a
 * new one is supplied; TTL/lastSeen always advance.
 */
export function touchChannel(
  projectRoot: string,
  opts: {
    identity: string;
    hostKind: ChannelHostKind;
    context?: KnowledgeChannelRecord['context'];
    nowMs?: number;
  },
): KnowledgeChannelRecord {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const identity = sanitizeChannelIdentity(opts.identity);
  const existing = readChannel(projectRoot, identity);
  const record: KnowledgeChannelRecord = {
    schema_version: CHANNEL_SCHEMA_VERSION,
    identity,
    host_kind: opts.hostKind,
    context: opts.context ?? existing?.context ?? null,
    workspace_id: null,
    revision: 1,
    created_at: existing?.created_at ?? nowIso,
    expires_at: new Date(nowMs + CHANNEL_TTL_MS).toISOString(),
    last_seen_at: nowIso,
  };
  writeChannel(projectRoot, record);
  return record;
}

// ---------------------------------------------------------------------------
// Lease reads (plugin WorkflowLeaseStore claim files)
// ---------------------------------------------------------------------------

export interface LeaseClaim {
  sessionId: string;
  hostSessionId: string;
  epoch: number;
  heartbeatAt: string;
  token: string;
}

function leaseRoot(projectRoot: string): string {
  return join(tmpRoot(projectRoot), 'hook');
}

/**
 * Read the highest-epoch claim per `.workflow/tmp/hook/<sessionId>.lease/`
 * directory. Corrupt directories are skipped; staleness is judged by the
 * caller against the claim file mtime.
 */
export function readLeaseClaims(
  projectRoot: string,
): Array<LeaseClaim & { claimPath: string; mtimeMs: number }> {
  const root = leaseRoot(projectRoot);
  if (!existsSync(root)) return [];
  const claims: Array<LeaseClaim & { claimPath: string; mtimeMs: number }> = [];
  for (const dirName of readdirSync(root)) {
    if (!dirName.endsWith('.lease')) continue;
    const dir = join(root, dirName);
    let entries: string[];
    try {
      entries = readdirSync(dir).filter(name => name.endsWith('.claim.json'));
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    const epochs = entries
      .map((name) => {
        const epoch = Number.parseInt(name.split('.')[0], 10);
        return { name, epoch: Number.isFinite(epoch) ? epoch : -1 };
      })
      .sort((a, b) => b.epoch - a.epoch);
    for (const { name } of epochs) {
      const claimPath = join(dir, name);
      try {
        const parsed = JSON.parse(readFileSync(claimPath, 'utf8')) as LeaseClaim;
        if (typeof parsed.sessionId !== 'string' || typeof parsed.hostSessionId !== 'string') continue;
        claims.push({ ...parsed, claimPath, mtimeMs: statSync(claimPath).mtimeMs });
        break; // highest epoch wins per lease directory
      } catch {
        // Fall through to older epochs when the newest claim is unreadable.
      }
    }
  }
  return claims;
}

/** Fresh lease claim for a host session, if any (mtime within LEASE_STALE_MS). */
export function findLeaseForHost(
  projectRoot: string,
  hostSessionId: string,
  nowMs: number = Date.now(),
): { sessionId: string; heartbeatAt: string; epoch: number } | null {
  const normalized = hostSessionId.trim();
  if (!normalized) return null;
  for (const claim of readLeaseClaims(projectRoot)) {
    if (claim.hostSessionId !== normalized) continue;
    if (nowMs - claim.mtimeMs > LEASE_STALE_MS) continue;
    return { sessionId: claim.sessionId, heartbeatAt: claim.heartbeatAt, epoch: claim.epoch };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Write-authority resolution
// ---------------------------------------------------------------------------

export type WriteAuthorityVia = 'explicit' | 'lease' | 'channel' | 'synthetic' | 'narrowed-scan';

export type WriteAuthority =
  | { kind: 'run'; sessionId: string; runId: string; via: WriteAuthorityVia; identity?: string; warning?: string }
  | {
      kind: 'session';
      sessionId: string;
      via: WriteAuthorityVia;
      synthetic: boolean;
      identity?: string;
      warning?: string;
    };

export interface ResolveWriteAuthorityInput {
  projectRoot: string;
  store: SessionStore;
  explicitRun?: string;
  explicitSession?: string;
  explicitChannel?: string;
  /** Injectable for tests; defaults to process.env. */
  env?: Record<string, string | undefined>;
  nowMs?: number;
}

function formatChannelListing(channels: KnowledgeChannelRecord[]): string {
  return channels
    .map(ch => `  - ${ch.identity} (${ch.host_kind}) → ${ch.context?.session_id ?? 'unbound'} · last seen ${ch.last_seen_at}`)
    .join('\n');
}

interface KnowledgeSessionAuthorityView {
  mutable: boolean;
  activeRunIds: string[];
}

function knowledgeSessionAuthorityView(
  store: SessionStore,
  sessionId: string,
): KnowledgeSessionAuthorityView {
  const record = store.readSessionRecordReadOnly(sessionId);
  if (record.schema_version === 'session/3.0') {
    const session = store.readSessionV30(sessionId);
    return {
      mutable: session.status === 'open',
      activeRunIds: [...new Set(session.active_run_ids)],
    };
  }
  const session = store.readBundle(sessionId).session;
  return {
    mutable: session.status === 'running' || session.status === 'paused',
    activeRunIds: session.status === 'running' && session.active_run_id
      ? [session.active_run_id]
      : [],
  };
}

/**
 * Resolve where a knowledge write belongs. Tier order per MVP K3:
 * explicit → env channel → Pi host lease → single live channel → narrowed
 * scan → synthetic (nothing running) → fail-closed.
 */
export function resolveWriteAuthority(input: ResolveWriteAuthorityInput): WriteAuthority {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  const { projectRoot, store } = input;

  // Tier A: explicit parameters.
  if (input.explicitRun) {
    const located = store.findRunRecord(input.explicitRun, input.explicitSession);
    return { kind: 'run', sessionId: located.sessionId, runId: input.explicitRun, via: 'explicit' };
  }
  if (input.explicitSession) {
    if (!store.sessionExists(input.explicitSession)) {
      throw new Error(
        `Session not found: ${input.explicitSession}. `
        + '--session must name an existing Maestro Workflow Session from session status or run brief, '
        + 'not a Pi chat/session-history ID; if no Maestro Session exists, omit --session or pass --channel <name>',
      );
    }
    return { kind: 'session', sessionId: input.explicitSession, via: 'explicit', synthetic: false };
  }

  // Tier A: manual/env channel identity.
  const channelIdentityRaw = input.explicitChannel ?? env[MAESTRO_CHANNEL_ENV];
  if (channelIdentityRaw?.trim()) {
    const identity = sanitizeChannelIdentity(channelIdentityRaw);
    const live = readChannel(projectRoot, identity);
    if (live && isFreshChannel(live, nowMs) && live.context) {
      const bound = bindChannelContextToAuthority(store, live);
      if (bound) return { ...bound, via: 'channel', identity };
    }
    // Unbound manual channel: create/refresh the synthetic Session it governs.
    const { sessionId, created } = ensureSyntheticKnowledgeSession(projectRoot, identity);
    touchChannel(projectRoot, {
      identity,
      hostKind: 'manual',
      context: { kind: 'session', session_id: sessionId },
      nowMs,
    });
    return {
      kind: 'session',
      sessionId,
      via: 'channel',
      synthetic: created || sessionId.startsWith('ksyn-'),
      identity,
    };
  }

  // Tier A: Pi host session env → lease reverse lookup.
  const hostSessionId = env[PI_HOST_SESSION_ENV]?.trim();
  if (hostSessionId) {
    const lease = findLeaseForHost(projectRoot, hostSessionId, nowMs);
    if (lease && store.sessionExists(lease.sessionId)) {
      const session = knowledgeSessionAuthorityView(store, lease.sessionId);
      if (session.mutable && session.activeRunIds.length === 1) {
        return { kind: 'run', sessionId: lease.sessionId, runId: session.activeRunIds[0], via: 'lease' };
      }
      if (session.mutable && session.activeRunIds.length > 1) {
        throw new Error(
          `Session ${lease.sessionId} has multiple active Runs; lease-bound knowledge authority is ambiguous. `
          + 'Pass --run explicitly.',
        );
      }
      if (session.mutable) {
        return { kind: 'session', sessionId: lease.sessionId, via: 'lease', synthetic: false };
      }
    }
  }

  // Tier A: exactly one live hook-registered channel with a bound context.
  // Manual channels never participate in identity-less inference: they belong
  // to callers who bind explicitly via --channel (K4 semantics).
  const liveChannels = listLiveChannels(projectRoot, nowMs);
  const hookChannels = liveChannels.filter(ch => ch.host_kind !== 'manual');
  const boundSessions = [...new Set(hookChannels.map(ch => ch.context!.session_id))];
  if (boundSessions.length === 1 && store.sessionExists(boundSessions[0])) {
    const sessionId = boundSessions[0];
    const session = knowledgeSessionAuthorityView(store, sessionId);
    const runChannels = hookChannels.filter(ch =>
      ch.context!.kind === 'run'
      && ch.context!.run_id
      && session.activeRunIds.includes(ch.context!.run_id),
    );
    const boundRunIds = [...new Set(runChannels.map(ch => ch.context!.run_id!))];
    if (session.mutable && boundRunIds.length === 1) {
      const runChannel = runChannels.find(ch => ch.context!.run_id === boundRunIds[0])!;
      return {
        kind: 'run',
        sessionId,
        runId: boundRunIds[0],
        via: 'channel',
        identity: runChannel.identity,
      };
    }
    if (session.mutable && boundRunIds.length > 1) {
      throw new Error(
        `Multiple live knowledge channels claim different active Runs in Session ${sessionId}; `
        + 'write authority is ambiguous. Pass --run/--channel explicitly.\nLive channels:\n'
        + formatChannelListing(liveChannels),
      );
    }
    if (session.mutable) {
      return {
        kind: 'session',
        sessionId,
        via: 'channel',
        synthetic: sessionId.startsWith('ksyn-'),
        identity: hookChannels[0].identity,
      };
    }
  }
  if (boundSessions.length > 1) {
    throw new Error(
      'Multiple live knowledge channels claim different Sessions; write authority is ambiguous. '
      + 'Pass --run/--session/--channel explicitly.\nLive channels:\n'
      + formatChannelListing(liveChannels),
    );
  }

  const running = store.listRunningSessions();

  // Tier C: narrowed scan — exactly one running Session, zero live hook
  // channels. Binds the active Run when present, otherwise the Session itself
  // (session-source attribution); always warned.
  if (hookChannels.length === 0) {
    if (running.length === 1) {
      const authority = knowledgeSessionAuthorityView(store, running[0].sessionId);
      if (authority.activeRunIds.length > 1) {
        throw new Error(
          `Session ${running[0].sessionId} has multiple active Runs; narrowed knowledge authority is ambiguous. `
          + 'Pass --run explicitly.',
        );
      }
      if (authority.activeRunIds.length === 1) {
        return {
          kind: 'run',
          sessionId: running[0].sessionId,
          runId: authority.activeRunIds[0],
          via: 'narrowed-scan',
          warning:
            `No caller identity found; attributed to the unique running Session `
            + `${running[0].sessionId}. Pass --run/--session/--channel to bind explicitly.`,
        };
      }
      return {
        kind: 'session',
        sessionId: running[0].sessionId,
        via: 'narrowed-scan',
        synthetic: running[0].sessionId.startsWith('ksyn-'),
        warning:
          `No caller identity found; attributed to the unique running Session `
          + `${running[0].sessionId} (no active Run). Pass --session/--channel to bind explicitly.`,
      };
    }
    if (running.length === 0) {
      // Nothing running: open a synthetic Session (daily-partitioned identity).
      const host = hostSessionId || 'adhoc';
      const { sessionId } = ensureSyntheticKnowledgeSession(projectRoot, host);
      return {
        kind: 'session',
        sessionId,
        via: 'synthetic',
        synthetic: true,
        identity: host,
        warning: host === 'adhoc'
          ? 'No caller identity found; created a shared synthetic knowledge Session. '
            + 'Concurrent terminals should pass --channel <name> to stay separated.'
          : undefined,
      };
    }
  }

  // Fail-closed: ambiguous and no authorization tier matched.
  throw new Error(
    'Knowledge write authority is ambiguous: '
    + `${running.length} running Session(s) and ${liveChannels.length} live channel(s). `
    + 'Pass --run/--session/--channel explicitly.\n'
    + `Running sessions:\n${running.map(r => `  - ${r.sessionId}${r.activeRunId ? ` (run ${r.activeRunId})` : ''}`).join('\n')}\n`
    + (liveChannels.length > 0 ? `Live channels:\n${formatChannelListing(liveChannels)}` : ''),
  );
}

export type KnowledgeAttributionAuthority =
  | { kind: 'run'; sessionId: string; runId: string }
  | { kind: 'session'; sessionId: string };

/**
 * Resolve best-effort load attribution without creating authority. Exact Run
 * channel bindings are retained; divergent channels and multi-Run leases fail
 * closed by returning null.
 */
export function findKnowledgeAttributionAuthority(
  projectRoot: string,
  store: SessionStore,
  env: Record<string, string | undefined> = process.env,
  nowMs: number = Date.now(),
): KnowledgeAttributionAuthority | null {
  const hostSessionId = env[PI_HOST_SESSION_ENV]?.trim();
  if (hostSessionId) {
    const lease = findLeaseForHost(projectRoot, hostSessionId, nowMs);
    if (lease && store.sessionExists(lease.sessionId)) {
      const session = knowledgeSessionAuthorityView(store, lease.sessionId);
      if (session.mutable && session.activeRunIds.length === 1) {
        return { kind: 'run', sessionId: lease.sessionId, runId: session.activeRunIds[0] };
      }
      if (session.mutable && session.activeRunIds.length === 0) {
        return { kind: 'session', sessionId: lease.sessionId };
      }
      return null;
    }
  }

  const liveHookChannels = listLiveChannels(projectRoot, nowMs)
    .filter(channel => channel.host_kind !== 'manual');
  const authorities = liveHookChannels
    .map(channel => bindChannelContextToAuthority(store, channel))
    .filter((authority): authority is WriteAuthority => authority !== null)
    .map(authority => authority.kind === 'run'
      ? { kind: 'run' as const, sessionId: authority.sessionId, runId: authority.runId }
      : { kind: 'session' as const, sessionId: authority.sessionId });
  const unique = new Map(authorities.map(authority => [
    authority.kind === 'run'
      ? `run:${authority.sessionId}:${authority.runId}`
      : `session:${authority.sessionId}`,
    authority,
  ]));
  if (unique.size === 1) return [...unique.values()][0];
  if (unique.size > 1 || liveHookChannels.length > 0) return null;

  const running = store.listRunningSessions();
  if (running.length !== 1) return null;
  const session = knowledgeSessionAuthorityView(store, running[0].sessionId);
  if (!session.mutable || session.activeRunIds.length > 1) return null;
  return session.activeRunIds.length === 1
    ? { kind: 'run', sessionId: running[0].sessionId, runId: session.activeRunIds[0] }
    : { kind: 'session', sessionId: running[0].sessionId };
}

/**
 * Read-only Session ID projection of best-effort attribution authority.
 * Exact Run authority is retained by findKnowledgeAttributionAuthority;
 * this compatibility helper returns only its owning Session. Never creates Sessions.
 */
export function findSessionAttributionTarget(
  projectRoot: string,
  store: SessionStore,
  env: Record<string, string | undefined> = process.env,
  nowMs: number = Date.now(),
): string | null {
  const authority = findKnowledgeAttributionAuthority(projectRoot, store, env, nowMs);
  return authority?.sessionId ?? null;
}

/** Map a channel's bound context back to an authority, if still valid. */
function bindChannelContextToAuthority(
  store: SessionStore,
  channel: KnowledgeChannelRecord,
): WriteAuthority | null {
  const context = channel.context;
  if (!context || !store.sessionExists(context.session_id)) return null;
  const session = knowledgeSessionAuthorityView(store, context.session_id);
  if (context.kind === 'run' && context.run_id
    && session.mutable && session.activeRunIds.includes(context.run_id)) {
    return { kind: 'run', sessionId: context.session_id, runId: context.run_id, via: 'channel' };
  }
  if (session.mutable) {
    return {
      kind: 'session',
      sessionId: context.session_id,
      via: 'channel',
      synthetic: context.session_id.startsWith('ksyn-'),
    };
  }
  return null;
}
