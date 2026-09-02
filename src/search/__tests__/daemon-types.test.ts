import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DAEMON_MAX_QUERY_CHARS,
  DAEMON_MAX_RESULTS,
  SEARCH_DAEMON_PROTOCOL,
  canonicalWorkflowRoot,
  deleteDaemonInfoIfOwned,
  getDaemonPath,
  isDaemonInfoV2,
  isDaemonReadyResponse,
  readDaemonInfo,
  validateDaemonRequest,
} from '../daemon-types.js';
import type { DaemonInfoV2 } from '../daemon-types.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-daemon-types-'));
  roots.push(value);
  return value;
}

function info(workflowRoot: string, instanceId = '12345678-1234-4123-8123-123456789abc'): DaemonInfoV2 {
  return {
    protocol: SEARCH_DAEMON_PROTOCOL,
    instanceId,
    workflowRoot: canonicalWorkflowRoot(workflowRoot),
    pid: process.pid,
    port: 32123,
    startedAt: new Date().toISOString(),
  };
}

describe('daemon descriptor v2 validation', () => {
  it('keeps legacy descriptors readable but unverified', () => {
    const workflowRoot = root();
    writeFileSync(getDaemonPath(workflowRoot), JSON.stringify({
      pid: process.pid,
      port: 32123,
      startedAt: 'legacy',
    }));

    const parsed = readDaemonInfo(workflowRoot);

    expect(parsed).toMatchObject({ pid: process.pid, port: 32123 });
    expect(isDaemonInfoV2(parsed, workflowRoot)).toBe(false);
  });

  it('rejects partially-v2 and malformed v2 descriptors instead of downgrading them', () => {
    const workflowRoot = root();
    writeFileSync(getDaemonPath(workflowRoot), JSON.stringify({
      pid: process.pid,
      port: 32123,
      startedAt: 'now',
      protocol: SEARCH_DAEMON_PROTOCOL,
      instanceId: 'not-a-uuid',
      workflowRoot: canonicalWorkflowRoot(workflowRoot),
    }));

    expect(readDaemonInfo(workflowRoot)).toBeNull();
  });

  it('fences valid descriptors to their canonical workflow identity', () => {
    const workflowRoot = root();
    const otherRoot = root();
    writeFileSync(getDaemonPath(workflowRoot), JSON.stringify(info(workflowRoot)));

    const parsed = readDaemonInfo(workflowRoot);

    expect(isDaemonInfoV2(parsed, workflowRoot)).toBe(true);
    expect(isDaemonInfoV2(parsed, otherRoot)).toBe(false);
  });

  it('only lets the current instance owner delete the descriptor', () => {
    const workflowRoot = root();
    const current = info(workflowRoot);
    writeFileSync(getDaemonPath(workflowRoot), JSON.stringify(current));

    expect(deleteDaemonInfoIfOwned(workflowRoot, {
      ...current,
      instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).toBe(false);
    expect(existsSync(getDaemonPath(workflowRoot))).toBe(true);
    expect(deleteDaemonInfoIfOwned(workflowRoot, current)).toBe(true);
    expect(existsSync(getDaemonPath(workflowRoot))).toBe(false);
  });
});

describe('daemon readiness', () => {
  it('does not treat starting or draining health as ready', () => {
    expect(isDaemonReadyResponse({ ok: true, state: 'starting' })).toBe(false);
    expect(isDaemonReadyResponse({ ok: true, state: 'draining' })).toBe(false);
    expect(isDaemonReadyResponse({ ok: true, state: 'ready' })).toBe(true);
  });
});

describe('daemon request validation', () => {
  it('enforces non-empty bounded queries and integer result limits', () => {
    expect(validateDaemonRequest({ action: 'search', query: '', limit: 1 })).toMatchObject({ ok: false });
    expect(validateDaemonRequest({
      action: 'search',
      query: 'x'.repeat(DAEMON_MAX_QUERY_CHARS + 1),
      limit: 1,
    })).toMatchObject({ ok: false });
    expect(validateDaemonRequest({
      action: 'search',
      query: 'valid',
      limit: DAEMON_MAX_RESULTS + 1,
    })).toMatchObject({ ok: false });
    expect(validateDaemonRequest({ action: 'search', query: 'valid', limit: 1.5 }))
      .toMatchObject({ ok: false });
    expect(validateDaemonRequest({ action: 'search', query: 'valid', limit: DAEMON_MAX_RESULTS }))
      .toMatchObject({ ok: true });
  });

  it('requires protocol identity for lifecycle and load actions', () => {
    expect(validateDaemonRequest({ action: 'shutdown' })).toMatchObject({
      ok: false,
      error: 'invalid daemon protocol',
    });
    expect(validateDaemonRequest({ action: 'load' })).toMatchObject({
      ok: false,
      error: 'invalid daemon protocol',
    });
    const descriptor = info(root());
    expect(validateDaemonRequest({
      action: 'health',
      protocol: descriptor.protocol,
      instanceId: descriptor.instanceId,
      workflowRoot: descriptor.workflowRoot,
    })).toMatchObject({ ok: true });
    expect(validateDaemonRequest({
      action: 'load',
      protocol: descriptor.protocol,
      instanceId: descriptor.instanceId,
      workflowRoot: descriptor.workflowRoot,
    })).toMatchObject({ ok: true });
  });
});
