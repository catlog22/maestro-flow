import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalTopicWorkspaceId,
  createTopicIdentity,
  normalizeTopic,
  sameTopicIdentity,
} from './topic-identity.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'maestro-topic-identity-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('topic-identity/1.0', () => {
  it('normalizes Unicode deterministically while preserving the explicit verbatim topic', () => {
    const workspaceRoot = root();
    const verbatim = '  ＡＢＣ\u3000Cafe\u0301\n任务 😀  ';
    const identity = createTopicIdentity(workspaceRoot, verbatim);

    expect(normalizeTopic(verbatim)).toBe('abc café 任务 😀');
    expect(identity).toMatchObject({
      schema_version: 'topic-identity/1.0',
      source: 'explicit',
      verbatim,
      normalized: 'abc café 任务 😀',
      normalized_length: 13,
    });
    expect(identity.normalized_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(identity.identity_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is command-independent and scopes otherwise equal topics to a workspace', () => {
    const leftRoot = root();
    const rightRoot = root();
    const left = createTopicIdentity(leftRoot, 'ＦＯＯ\tBar');
    const equivalent = createTopicIdentity(join(leftRoot, 'child', '..'), 'foo bar');
    const otherWorkspace = createTopicIdentity(rightRoot, 'foo bar');

    expect(canonicalTopicWorkspaceId(leftRoot)).toBe(canonicalTopicWorkspaceId(join(leftRoot, '.')));
    expect(left.normalized_hash).toBe(otherWorkspace.normalized_hash);
    expect(sameTopicIdentity(left, equivalent)).toBe(true);
    expect(sameTopicIdentity(left, otherWorkspace)).toBe(false);
    expect(left.identity_hash).not.toBe(otherWorkspace.identity_hash);
  });

  it('keeps punctuation and long Unicode suffixes identity-significant', () => {
    const workspaceRoot = root();
    const prefix = '任务'.repeat(40);
    const left = createTopicIdentity(workspaceRoot, `${prefix}-A😀`);
    const right = createTopicIdentity(workspaceRoot, `${prefix}-B😀`);

    expect(left.normalized_hash).not.toBe(right.normalized_hash);
    expect(createTopicIdentity(workspaceRoot, 'a-b').identity_hash)
      .not.toBe(createTopicIdentity(workspaceRoot, 'ab').identity_hash);
  });

  it('rejects missing explicit topic content instead of deriving a fallback', () => {
    expect(() => createTopicIdentity(root(), '\u3000\n\t')).toThrow(/non-empty explicit topic/);
  });

  it('records workflow and legacy backfill provenance without changing topic equivalence', () => {
    const workspaceRoot = root();
    const workflow = createTopicIdentity(workspaceRoot, 'Release', { source: 'workflow' });
    const legacy = createTopicIdentity(workspaceRoot, 'release', { source: 'legacy-intent' });

    expect(workflow.source).toBe('workflow');
    expect(legacy.source).toBe('legacy-intent');
    expect(sameTopicIdentity(workflow, legacy)).toBe(true);
  });
});
