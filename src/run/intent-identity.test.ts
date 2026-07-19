import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createIntentIdentity,
  intentIdentitySchema,
  normalizeIntent,
  sameIntentIdentity,
} from './intent-identity.js';
import { SessionStore } from './store.js';
import { createRun } from './runtime.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-intent-identity-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('intent-identity/1.0', () => {
  it('normalizes NFKC, Unicode case and whitespace deterministically', () => {
    expect(normalizeIntent('  ＡＢＣ\u3000Cafe\u0301\n任务 😀  ')).toBe('abc café 任务 😀');
    const projectRoot = root();
    const left = createIntentIdentity(projectRoot, '/Maestro-Plan', 'ＦＯＯ\tBar');
    const right = createIntentIdentity(projectRoot, 'maestro-plan', 'foo bar');
    expect(sameIntentIdentity(left, right)).toBe(true);
    expect(intentIdentitySchema.parse(left).normalized_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('preserves punctuation, emoji and long suffixes for exact identity', () => {
    const projectRoot = root();
    const prefix = '任务'.repeat(40);
    const a = createIntentIdentity(projectRoot, 'plan', `${prefix}-A😀`);
    const b = createIntentIdentity(projectRoot, 'plan', `${prefix}-B😀`);
    expect(a.normalized_hash).not.toBe(b.normalized_hash);
    expect(createIntentIdentity(projectRoot, 'plan', 'a-b').normalized_hash)
      .not.toBe(createIntentIdentity(projectRoot, 'plan', 'ab').normalized_hash);
  });

  it('enumerates exact live candidates from SessionStore and fails ambiguity closed', () => {
    const projectRoot = root();
    const store = new SessionStore(projectRoot);
    store.createSession('s-a', '相同  Intent', { command: 'plan' });
    store.createSession('s-b', '相同 intent', { command: 'plan' });
    const identity = createIntentIdentity(projectRoot, 'plan', '相同 intent');
    const result = store.listSessions({ statuses: ['running', 'paused'], intentIdentity: identity });
    expect(result.candidates.map(item => item.sessionId)).toEqual(['s-a', 's-b']);
    expect(result.candidates.every(item => item.identity?.normalized_hash === identity.normalized_hash)).toBe(true);
    expect(() => createRun({ projectRoot, command: 'plan', intent: '相同 intent' }))
      .toThrow(/Legacy exact intent match is ambiguous/);
  });

  it('rejects malformed hashes and unknown schema versions', () => {
    const identity = createIntentIdentity(root(), 'plan', 'demo');
    expect(() => intentIdentitySchema.parse({ ...identity, normalized_hash: 'bad' })).toThrow();
    expect(() => intentIdentitySchema.parse({ ...identity, schema_version: 'intent-identity/2.0' })).toThrow();
  });
});
