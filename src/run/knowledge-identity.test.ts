import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


import {
  CHANNEL_TTL_MS,
  channelFilePath,
  findLeaseForHost,
  listLiveChannels,
  MAESTRO_CHANNEL_ENV,
  PI_HOST_SESSION_ENV,
  readLeaseClaims,
  resolveWriteAuthority,
  sanitizeChannelIdentity,
  touchChannel,
  type KnowledgeChannelRecord,
} from './knowledge-identity.js';
import { createRun } from './runtime.js';
import { SessionStore } from './store.js';

function v2Workspace(root: string): void {
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow", "config.json"), JSON.stringify({
    session_schema: { schema_version: "session-schema-selection/1.0", writer: "session/1.3", features: { session_statusless: false } },
  }));
}

const roots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'maestro-knowledge-identity-'));

  v2Workspace(path);
  roots.push(path);
  installCommand(path);
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

function seedRunningRun(projectRoot: string, sessionId: string) {
  return createRun({
    projectRoot,
    command: 'knowledge-demo',
    sessionId,
    intent: 'identity resolution fixture',
  });
}

function writeLeaseClaim(
  projectRoot: string,
  sessionId: string,
  hostSessionId: string,
  epoch: number,
  ageMs = 0,
): void {
  const dir = join(projectRoot, '.workflow', 'tmp', 'hook', `${sessionId}.lease`);
  mkdirSync(dir, { recursive: true });
  const claimPath = join(dir, `${epoch}.claim.json`);
  writeFileSync(claimPath, JSON.stringify({
    sessionId,
    hostSessionId,
    epoch,
    heartbeatAt: new Date(Date.now() - ageMs).toISOString(),
    token: `tok-${epoch}`,
  }), 'utf8');
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(claimPath, past, past);
  }
}

describe('channel identity hygiene', () => {
  it('sanitizes unsafe characters and rejects empty identities', () => {
    expect(sanitizeChannelIdentity('pi:uuid/1')).toBe('pi_uuid_1');
    expect(sanitizeChannelIdentity('  win.  ')).toBe('win');
    expect(() => sanitizeChannelIdentity('')).toThrow();
    expect(() => sanitizeChannelIdentity('..')).toThrow();
  });

  it('filters expired channels but keeps fresh ones', () => {
    const projectRoot = root();
    const now = Date.now();
    touchChannel(projectRoot, { identity: 'fresh', hostKind: 'manual', context: { kind: 'session', session_id: 's-1' }, nowMs: now });
    // Hand-craft an expired record.
    const expired: KnowledgeChannelRecord = {
      schema_version: 'knowledge-channel/1.0',
      identity: 'stale',
      host_kind: 'hook',
      context: { kind: 'session', session_id: 's-2' },
      workspace_id: null,
      revision: 1,
      created_at: new Date(now - CHANNEL_TTL_MS - 60_000).toISOString(),
      expires_at: new Date(now - 60_000).toISOString(),
      last_seen_at: new Date(now - 60_000).toISOString(),
    };
    writeFileSync(channelFilePath(projectRoot, 'stale'), JSON.stringify(expired), 'utf8');
    const live = listLiveChannels(projectRoot, now);
    expect(live.map(ch => ch.identity)).toEqual(['fresh']);
  });
});

describe('lease reads', () => {
  it('returns the freshest claim matching the host and skips stale ones', () => {
    const projectRoot = root();
    writeLeaseClaim(projectRoot, 'sess-a', 'host-1', 3);
    const found = findLeaseForHost(projectRoot, 'host-1');
    expect(found?.sessionId).toBe('sess-a');
    expect(found?.epoch).toBe(3);
    expect(findLeaseForHost(projectRoot, 'host-2')).toBeNull();
  });

  it('treats claims older than 30s as stale', () => {
    const projectRoot = root();
    writeLeaseClaim(projectRoot, 'sess-b', 'host-1', 1, 60_000);
    expect(findLeaseForHost(projectRoot, 'host-1')).toBeNull();
    expect(readLeaseClaims(projectRoot)).toHaveLength(1);
  });
});

describe('resolveWriteAuthority (K3 tiers)', () => {
  it('honors explicit --run', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'explicit-session');
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({
      projectRoot, store, explicitRun: created.run_id, env: {},
    });
    expect(authority).toMatchObject({ kind: 'run', sessionId: created.session_id, runId: created.run_id, via: 'explicit' });
  });

  it('honors explicit --session without a run', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'session-only-target');
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({
      projectRoot, store, explicitSession: created.session_id, env: {},
    });
    expect(authority).toMatchObject({ kind: 'session', sessionId: created.session_id, via: 'explicit', synthetic: false });
  });

  it('explains the identity boundary when an explicit Session is missing', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    expect(() => resolveWriteAuthority({
      projectRoot,
      store,
      explicitSession: '01a06eda-a4f5-799a-bbcc-06afc2ca913b',
      env: {},
    })).toThrow(/existing Maestro Workflow Session[\s\S]*Pi chat\/session-history ID[\s\S]*--channel <name>/);
  });

  it('routes through a single live bound channel', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'channeled-session');
    touchChannel(projectRoot, {
      identity: 'claude-uuid',
      hostKind: 'hook',
      context: { kind: 'session', session_id: created.session_id },
    });
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'session', sessionId: created.session_id, via: 'channel' });
  });

  it('fails closed when live channels disagree', () => {
    const projectRoot = root();
    seedRunningRun(projectRoot, 'session-x');
    seedRunningRun(projectRoot, 'session-y');
    touchChannel(projectRoot, { identity: 'host-1', hostKind: 'hook', context: { kind: 'session', session_id: 'session-x' } });
    touchChannel(projectRoot, { identity: 'host-2', hostKind: 'hook', context: { kind: 'session', session_id: 'session-y' } });
    const store = new SessionStore(projectRoot);
    expect(() => resolveWriteAuthority({ projectRoot, store, env: {} }))
      .toThrow(/ambiguous[\s\S]*--run\/--session\/--channel/);
  });

  it('uses the narrowed scan only with zero live channels (plus warning)', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'unique-session');
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'run', runId: created.run_id, via: 'narrowed-scan' });
    if (authority.kind !== 'run') throw new Error('unreachable');
    expect(authority.warning).toMatch(/unique running Session/);
  });

  it('lets a single live hook channel win over other running sessions (A-tier)', () => {
    const projectRoot = root();
    seedRunningRun(projectRoot, 'busy-session');
    seedRunningRun(projectRoot, 'other-session');
    touchChannel(projectRoot, { identity: 'idle-host', hostKind: 'hook', context: { kind: 'session', session_id: 'other-session' } });
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'session', sessionId: 'other-session', via: 'channel' });
  });

  it('manual channels never capture identity-less callers (K4)', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'solo-session');
    touchChannel(projectRoot, { identity: 'someone-else', hostKind: 'manual', context: { kind: 'session', session_id: 'unrelated-session' } });
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'run', runId: created.run_id, via: 'narrowed-scan' });
    if (authority.kind !== 'run') throw new Error('unreachable');
    expect(authority.warning).toContain('No caller identity found');
  });

  it('narrowed scan binds the unique running Session without an active Run', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'runless-session');
    const store = new SessionStore(projectRoot);
    store.update(created.session_id, (bundle) => {
      bundle.session.active_run_id = null;
    });
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'session', sessionId: created.session_id, via: 'narrowed-scan' });
    if (authority.kind !== 'session') throw new Error('unreachable');
    expect(authority.warning).toContain('no active Run');
  });

  it('resolves Pi host env through a fresh lease', () => {
    const projectRoot = root();
    const created = seedRunningRun(projectRoot, 'pi-attached');
    writeLeaseClaim(projectRoot, 'pi-attached', 'pi-uuid-9', 2);
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({
      projectRoot, store, env: { [PI_HOST_SESSION_ENV]: 'pi-uuid-9' },
    });
    expect(authority).toMatchObject({ kind: 'run', sessionId: created.session_id, via: 'lease' });
  });

  it('creates a synthetic session for manual channels and stays idempotent', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const env = { [MAESTRO_CHANNEL_ENV]: 'terminal-alpha' };
    const first = resolveWriteAuthority({ projectRoot, store, env });
    expect(first.kind).toBe('session');
    if (first.kind !== 'session') throw new Error('unreachable');
    expect(first.sessionId.startsWith('ksyn-')).toBe(true);
    expect(first.identity).toBe('terminal-alpha');
    const second = resolveWriteAuthority({ projectRoot, store, env });
    expect(second.kind === 'session' && second.sessionId).toBe(first.sessionId);
  });

  it('opens an adhoc synthetic session when nothing is running', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    const authority = resolveWriteAuthority({ projectRoot, store, env: {} });
    expect(authority).toMatchObject({ kind: 'session', via: 'synthetic', synthetic: true });
  });
});
