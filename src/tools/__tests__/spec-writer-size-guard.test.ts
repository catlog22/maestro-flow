/**
 * Spec Writer Size Guard — tests for oversized content auto-redirect
 *
 * Covers: MAX_SPEC_ENTRY_SIZE guard in appendSpecEntry that redirects
 * large content to knowhow files with a summary spec ref entry.
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
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
import { appendSpecEntry, MAX_SPEC_ENTRY_SIZE, writeSpecEntry } from '../spec-writer.js';

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-spec-size-guard-'));
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Size guard constant
// ---------------------------------------------------------------------------

describe('MAX_SPEC_ENTRY_SIZE', () => {
  it('is exported and equals 2048', () => {
    expect(MAX_SPEC_ENTRY_SIZE).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// Content under limit — normal behavior
// ---------------------------------------------------------------------------

describe('appendSpecEntry — content under size limit', () => {
  it('writes inline entry when content is under 2KB', () => {
    const content = 'A'.repeat(2000); // Under 2048
    const result = appendSpecEntry(
      testDir, 'coding', 'Small Entry', content, ['test'],
    );

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.redirected).toBeUndefined();
    expect(result.knowhowRef).toBeUndefined();

    const fileContent = readFileSync(result.file, 'utf-8');
    expect(fileContent).toContain('### Small Entry');
    expect(fileContent).toContain(content);
    expect(fileContent).not.toContain('ref=');
  });

  it('writes inline entry when content is exactly 2048 chars', () => {
    const content = 'B'.repeat(2048); // Exactly at limit (not over)
    const result = appendSpecEntry(
      testDir, 'coding', 'Exact Limit', content, ['test'],
    );

    expect(result.ok).toBe(true);
    expect(result.redirected).toBeUndefined();

    const fileContent = readFileSync(result.file, 'utf-8');
    expect(fileContent).toContain(content);
    expect(fileContent).not.toContain('ref=');
  });
});

// ---------------------------------------------------------------------------
// Content over limit — redirects to knowhow
// ---------------------------------------------------------------------------

describe('appendSpecEntry — content over size limit', () => {
  it('redirects to knowhow when content exceeds 2KB', () => {
    const content = 'C'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'coding', 'Large Entry', content, ['big', 'test'],
    );

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.redirected).toBe(true);
    expect(result.knowhowRef).toBeDefined();
    expect(result.knowhowRef).toMatch(/^knowhow\/DOC-/);

    consoleSpy.mockRestore();
  });

  it('creates knowhow file with full content', () => {
    const content = 'D'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'coding', 'Full Content', content, ['test'],
    );

    // Verify knowhow file exists
    const knowhowDir = join(testDir, '.workflow', 'knowhow');
    expect(existsSync(knowhowDir)).toBe(true);

    const files = readdirSync(knowhowDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^DOC-.*\.md$/);

    // Verify full content in knowhow file
    const knowhowContent = readFileSync(join(knowhowDir, files[0]), 'utf-8');
    expect(knowhowContent).toContain(content);
    expect(knowhowContent).toContain('title: Full Content');
    expect(knowhowContent).toContain('type: document');
    expect(knowhowContent).toContain('category: coding');

    consoleSpy.mockRestore();
  });

  it('creates spec entry with ref and summary (first 200 chars)', () => {
    const content = 'E'.repeat(100) + ' ' + 'F'.repeat(150) + ' ' + 'G'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'coding', 'Summary Test', content, ['test'],
    );

    // Spec entry should have ref attribute
    const specContent = readFileSync(result.file, 'utf-8');
    expect(specContent).toContain('ref="knowhow/DOC-');
    expect(specContent).toContain('### Summary Test');
    // Should NOT contain the full 3000+ char content in spec file
    expect(specContent).not.toContain('G'.repeat(3000));

    consoleSpy.mockRestore();
  });

  it('logs redirect message', () => {
    const content = 'H'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    appendSpecEntry(testDir, 'coding', 'Log Test', content, ['test']);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[spec] Content exceeds 2KB, stored as knowhow with spec ref',
    );

    consoleSpy.mockRestore();
  });

  it('preserves keywords in both knowhow and spec entry', () => {
    const content = 'I'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'arch', 'Keyword Test', content, ['api', 'design', 'rest'],
    );

    // Check spec entry has keywords
    const specContent = readFileSync(result.file, 'utf-8');
    expect(specContent).toContain('keywords="api,design,rest"');

    // Check the canonical Knowhow keyword field preserves every value
    const knowhowDir = join(testDir, '.workflow', 'knowhow');
    const files = readdirSync(knowhowDir);
    const knowhowContent = readFileSync(join(knowhowDir, files[0]), 'utf-8');
    expect(knowhowContent).toContain('keywords:\n  - api\n  - design\n  - rest');
    expect(knowhowContent).not.toMatch(/^tags:/m);

    consoleSpy.mockRestore();
  });

  it('externalizes canonical fields into the resolved linked repository', () => {
    const linkedRoot = mkdtempSync(join(tmpdir(), 'maestro-test-spec-size-linked-'));
    try {
      initializeRepositoryIdentity(testDir, { repoName: 'Actor' });
      const linkedId = initializeRepositoryIdentity(linkedRoot, { repoName: 'Library' }).repo_id;
      writeFileSync(join(testDir, '.workflow', 'config.json'), JSON.stringify({
        workspaces: { linked: [{
          name: 'library',
          path: linkedRoot,
          repo_id: linkedId,
          share: ['spec', 'knowhow'],
          write: ['spec', 'knowhow'],
        }] },
      }));
      const context = resolveRepositoryContext(linkedId, {
        projectRoot: testDir,
        require: { mode: 'write', corpus: 'spec' },
      });

      const result = writeSpecEntry(context, {
        category: 'arch',
        title: 'Linked Oversized Contract',
        content: 'Linked canonical content. '.repeat(120),
        keywords: ['api', 'design'],
        sourceRef: 'issue:42',
        relatedPaths: ['src\\linked.ts'],
        appliesToRepoIds: [linkedId],
        targetRepoId: linkedId,
      });

      expect(result.file.startsWith(linkedRoot)).toBe(true);
      expect(result.knowhowRef).toMatch(/^knowhow\/DOC-/);
      expect(existsSync(join(testDir, '.workflow', 'knowhow'))).toBe(false);

      const specContent = readFileSync(result.file, 'utf8');
      expect(specContent).toContain('keywords="api,design"');
      expect(specContent).toContain('sourceRef="issue:42"');
      expect(specContent).toContain('relatedPaths="src/linked.ts"');
      expect(specContent).toContain(`appliesToRepoIds="${linkedId}"`);

      const knowhowDir = join(linkedRoot, '.workflow', 'knowhow');
      const [knowhowFile] = readdirSync(knowhowDir);
      const knowhowContent = readFileSync(join(knowhowDir, knowhowFile), 'utf8');
      expect(knowhowContent).toContain('type: document');
      expect(knowhowContent).toContain('category: arch');
      expect(knowhowContent).toContain('keywords:\n  - api\n  - design');
      expect(knowhowContent).toContain('sourceRef: "issue:42"');
      expect(knowhowContent).toContain('relatedPaths:\n  - src/linked.ts');
      expect(knowhowContent).toContain(`appliesToRepoIds:\n  - ${linkedId}`);
      expect(knowhowContent).not.toMatch(/^tags:/m);
    } finally {
      rmSync(linkedRoot, { recursive: true, force: true });
    }
  });

  it('preserves source in redirected spec entry', () => {
    const content = 'J'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'coding', 'Source Test', content, ['test'], 'agent:ANL-001',
    );

    const specContent = readFileSync(result.file, 'utf-8');
    expect(specContent).toContain('sourceRef="agent:ANL-001"');

    consoleSpy.mockRestore();
  });

  it('routes to correct category file even when redirected', () => {
    const content = 'K'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const archResult = appendSpecEntry(
      testDir, 'arch', 'Arch Large', content, ['test'],
    );
    const debugResult = appendSpecEntry(
      testDir, 'debug', 'Debug Large', content, ['test'],
    );

    expect(archResult.file).toContain('architecture-constraints.md');
    expect(debugResult.file).toContain('debug-notes.md');
    expect(archResult.redirected).toBe(true);
    expect(debugResult.redirected).toBe(true);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('appendSpecEntry — size guard edge cases', () => {
  it('content at 2049 chars triggers redirect', () => {
    const content = 'L'.repeat(2049); // Just over limit
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = appendSpecEntry(
      testDir, 'coding', 'Just Over', content, ['test'],
    );

    expect(result.redirected).toBe(true);
    expect(result.knowhowRef).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('empty content does not trigger redirect', () => {
    const result = appendSpecEntry(
      testDir, 'coding', 'Empty Content', '', ['test'],
    );

    expect(result.ok).toBe(true);
    expect(result.redirected).toBeUndefined();
  });

  it('duplicate detection still works for oversized content', () => {
    const content = 'M'.repeat(3000);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = appendSpecEntry(
      testDir, 'coding', 'Dup Large', content, ['test'],
    );
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.redirected).toBe(true);

    const second = appendSpecEntry(
      testDir, 'coding', 'Dup Large', content, ['test'],
    );
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    consoleSpy.mockRestore();
  });
});
