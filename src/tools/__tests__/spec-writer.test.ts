import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeRepositoryIdentity,
  resolveRepositoryContext,
} from '../../repository/context.js';
import { appendSpecEntry, writeSpecEntry, type SpecAddResult } from '../spec-writer.js';

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-spec-writer-'));
  // Create .workflow so resolveSpecDir can resolve 'project' scope
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Basic add
// ---------------------------------------------------------------------------

describe('appendSpecEntry - basic add', () => {
  it('creates entry in correct file and returns ok=true, duplicate=false', () => {
    const result = appendSpecEntry(
      testDir,
      'coding',
      'Use camelCase',
      'Always use camelCase for variables.',
      ['naming', 'style'],
    );

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.category).toBe('coding');
    expect(result.title).toBe('Use camelCase');
    expect(result.file).toContain('coding-conventions.md');

    // Verify file content
    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('### Use camelCase');
    expect(content).toContain('Always use camelCase for variables.');
    expect(content).toContain('<spec-entry');
    expect(content).toContain('</spec-entry>');
  });
});

describe('appendSpecEntry - authorized linked target', () => {
  it('writes only with current share + write authority and persists ID-only applicability', () => {
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-test-spec-linked-'));
    mkdirSync(join(linkedRoot, '.workflow'), { recursive: true });
    try {
      initializeRepositoryIdentity(testDir, { repoName: 'Actor' });
      const linkedId = initializeRepositoryIdentity(linkedRoot, { repoName: 'Library' }).repo_id;
      const configPath = join(testDir, '.workflow', 'config.json');
      const setAuthority = (write: string[], name = 'library') => writeFileSync(configPath, JSON.stringify({
        workspaces: { linked: [{
          name, path: linkedRoot, repo_id: linkedId,
          share: ['spec'], write,
        }] },
      }));
      setAuthority(['spec']);
      const context = resolveRepositoryContext(linkedId, {
        projectRoot: testDir,
        require: { mode: 'write', corpus: 'spec' },
      });
      const result = writeSpecEntry(context, {
        category: 'coding', title: 'Linked rule', content: 'Canonical linked content.',
        appliesToRepoIds: [linkedId], targetRepoId: linkedId,
      });
      const document = readFileSync(result.file, 'utf8');
      expect(result.file.startsWith(linkedRoot)).toBe(true);
      expect(document).toContain(`appliesToRepoIds="${linkedId}"`);
      expect(document).not.toContain('library');

      const before = readdirSync(join(linkedRoot, '.workflow', 'specs'));
      setAuthority(['spec'], 'renamed-library');
      expect(() => writeSpecEntry(context, {
        category: 'debug', title: 'Drifted alias', content: 'Must not appear.',
        targetRepoId: linkedId,
      })).toThrow(/authority changed/);
      expect(readdirSync(join(linkedRoot, '.workflow', 'specs'))).toEqual(before);

      setAuthority([]);
      expect(() => writeSpecEntry(context, {
        category: 'debug', title: 'Revoked rule', content: 'Must not appear.',
        targetRepoId: linkedId,
      })).toThrow(/does not grant write capability/);
      expect(readdirSync(join(linkedRoot, '.workflow', 'specs'))).toEqual(before);
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Creates directory and file if missing
// ---------------------------------------------------------------------------

describe('appendSpecEntry - creates directory and file if missing', () => {
  it('creates specs directory and file when they do not exist', () => {
    // Use a fresh dir without pre-created .workflow/specs
    const freshDir = mkdtempSync(join(tmpdir(), 'maestro-test-spec-writer-fresh-'));
    try {
      const result = appendSpecEntry(
        freshDir,
        'coding',
        'New Rule',
        'Some content.',
        ['test'],
      );

      expect(result.ok).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(existsSync(result.file)).toBe(true);

      // Verify file has header followed by entry
      const content = readFileSync(result.file, 'utf-8');
      expect(content).toContain('# Coding Conventions');
      expect(content).toContain('## Entries');
      expect(content).toContain('### New Rule');
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

describe('appendSpecEntry - duplicate detection', () => {
  it('returns duplicate=true without modifying file when same title added twice', () => {
    const first = appendSpecEntry(
      testDir,
      'coding',
      'Use semicolons',
      'Always use semicolons.',
      ['style'],
    );
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const contentAfterFirst = readFileSync(first.file, 'utf-8');

    const second = appendSpecEntry(
      testDir,
      'coding',
      'Use semicolons',
      'Duplicate content.',
      ['style'],
    );
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    // File should NOT have been modified
    const contentAfterSecond = readFileSync(second.file, 'utf-8');
    expect(contentAfterSecond).toBe(contentAfterFirst);
  });

  it('detects case-insensitive duplicate titles', () => {
    appendSpecEntry(
      testDir,
      'coding',
      'Use JWT',
      'JWT is standard.',
      ['auth'],
    );

    const result = appendSpecEntry(
      testDir,
      'coding',
      'use jwt',
      'Different content.',
      ['auth'],
    );

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Different categories route to different files
// ---------------------------------------------------------------------------

describe('appendSpecEntry - category routing', () => {
  it('routes arch to architecture-constraints.md', () => {
    const result = appendSpecEntry(
      testDir,
      'arch',
      'No circular deps',
      'Modules must not have circular dependencies.',
      ['module', 'boundary'],
    );

    expect(result.ok).toBe(true);
    expect(result.file).toContain('architecture-constraints.md');
  });

  it('routes coding to coding-conventions.md', () => {
    const result = appendSpecEntry(
      testDir,
      'coding',
      'Use ESM',
      'Always use ESM imports.',
      ['imports'],
    );

    expect(result.ok).toBe(true);
    expect(result.file).toContain('coding-conventions.md');
  });

  it('routes learning to learnings.md', () => {
    const result = appendSpecEntry(
      testDir,
      'learning',
      'Found off-by-one',
      'Array index was wrong.',
      ['bug'],
    );

    expect(result.ok).toBe(true);
    expect(result.file).toContain('learnings.md');
  });

  it('routes debug to debug-notes.md', () => {
    const result = appendSpecEntry(
      testDir,
      'debug',
      'Check logs first',
      'Always check logs.',
      ['logging'],
    );

    expect(result.ok).toBe(true);
    expect(result.file).toContain('debug-notes.md');
  });

  it('routes different categories to different files', () => {
    const arch = appendSpecEntry(testDir, 'arch', 'Rule A', 'Content A.', ['a']);
    const coding = appendSpecEntry(testDir, 'coding', 'Rule B', 'Content B.', ['b']);

    expect(arch.file).not.toBe(coding.file);
    expect(arch.file).toContain('architecture-constraints.md');
    expect(coding.file).toContain('coding-conventions.md');
  });
});

// ---------------------------------------------------------------------------
// Source attribute
// ---------------------------------------------------------------------------

describe('appendSpecEntry - source attribute', () => {
  it('includes source in the output entry when provided', () => {
    const result = appendSpecEntry(
      testDir,
      'coding',
      'Agent discovery',
      'Found during analysis.',
      ['discovery'],
      'agent',
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('sourceRef="agent"');
  });

  it('omits source when not provided', () => {
    const result = appendSpecEntry(
      testDir,
      'coding',
      'Manual rule',
      'Added by user.',
      ['manual'],
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(result.file, 'utf-8');
    expect(content).not.toContain('sourceRef=');
  });
});

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

describe('appendSpecEntry - keywords', () => {
  it('includes provided keywords in the spec-entry tag', () => {
    const result = appendSpecEntry(
      testDir,
      'coding',
      'Token rotation',
      'Rotate tokens regularly.',
      ['auth', 'token', 'security'],
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('keywords="auth,token,security"');
  });
});

// ---------------------------------------------------------------------------
// Canonical object contract and replay
// ---------------------------------------------------------------------------

describe('writeSpecEntry - canonical contract', () => {
  it('round-trips related paths, applicability IDs, and sourceRef', () => {
    const repoId = '11111111-1111-4111-8111-111111111111';
    const context = { projectRoot: testDir, repoId, relation: 'current' as const };
    const result = writeSpecEntry(context, {
      category: 'coding',
      title: 'Canonical entry',
      content: 'Use the canonical writer.',
      keywords: ['canonical'],
      sourceRef: 'issue:42',
      relatedPaths: ['src\\index.ts'],
      appliesToRepoIds: [repoId],
      sid: 'S-20260901-canon',
    });

    expect(result.ok).toBe(true);
    const document = readFileSync(result.file, 'utf8');
    expect(document).toContain('sourceRef="issue:42"');
    expect(document).toContain('relatedPaths="src/index.ts"');
    expect(document).toContain(`appliesToRepoIds="${repoId}"`);

    const replay = writeSpecEntry(context, {
      category: 'coding', title: 'Canonical entry', content: 'Use the canonical writer.',
      keywords: ['canonical'], sourceRef: 'issue:42', relatedPaths: ['src/index.ts'],
      appliesToRepoIds: [repoId], sid: 'S-20260901-canon',
    });
    expect(replay.replayed).toBe(true);

    expect(() => writeSpecEntry(context, {
      category: 'coding', title: 'Canonical entry', content: 'Changed.',
      keywords: ['canonical'], sourceRef: 'issue:42', relatedPaths: ['src/index.ts'],
      appliesToRepoIds: [repoId], sid: 'S-20260901-canon',
    })).toThrow(/CALLER_PAYLOAD_CONFLICT/);
  });

  it('rejects non-ID applicability values without mutation', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'maestro-test-applicability-id-'));
    try {
      expect(() => writeSpecEntry(
        { projectRoot: fresh, repoId: null, relation: 'current' },
        { category: 'coding', title: 'Alias leak', content: 'No.', appliesToRepoIds: ['current'] },
      )).toThrow(/exact persisted repository IDs/);
      expect(existsSync(join(fresh, '.workflow'))).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('rejects linked repository context for non-project scopes without mutation', () => {
    const linked = mkdtempSync(join(tmpdir(), 'maestro-test-linked-scope-'));
    try {
      expect(() => writeSpecEntry(
        { projectRoot: linked, repoId: 'repo-linked', relation: 'linked' },
        { category: 'coding', title: 'Global linked', content: 'No.', scope: 'global' },
      )).toThrow(/cannot use a repository selector/);
      expect(existsSync(join(linked, '.workflow'))).toBe(false);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid category
// ---------------------------------------------------------------------------

describe('appendSpecEntry - invalid category', () => {
  it('returns ok=false for invalid category', () => {
    const result = appendSpecEntry(
      testDir,
      'nonexistent' as any,
      'Bad entry',
      'Should fail.',
      ['test'],
    );

    expect(result.ok).toBe(false);
    expect(result.file).toBe('');
    expect(result.duplicate).toBe(false);
  });
});
