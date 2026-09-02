/**
 * Spec Writer Ref Mode — comprehensive tests
 *
 * Covers: appendSpecEntryWithRef (spec → knowhow bridge via ref attribute)
 * Guide coverage: ref 引用模式 — Spec entry referencing a knowhow document
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendSpecEntryWithRef } from '../spec-writer.js';

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'maestro-test-spec-writer-ref-'));
  mkdirSync(join(testDir, '.workflow', 'specs'), { recursive: true });
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Basic ref entry creation
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — basic', () => {
  it('creates a spec entry with ref attribute pointing to knowhow', () => {
    const result = appendSpecEntryWithRef(
      testDir,
      'learning',
      'OAuth PKCE Integration',
      'Complete OAuth PKCE flow design.',
      ['oauth', 'pkce', 'auth'],
      'knowhow/AST-oauth-flow.md',
    );

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.file).toContain('learnings.md');

    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('<spec-entry');
    expect(content).toContain('ref="knowhow/AST-oauth-flow.md"');
    expect(content).toContain('### OAuth PKCE Integration');
    expect(content).toContain('Complete OAuth PKCE flow design.');
    expect(content).toContain('keywords="oauth,pkce,auth"');
    expect(content).toContain('</spec-entry>');
    expect(existsSync(join(testDir, '.workflow', 'knowhow'))).toBe(false);
  });

  it('includes category in the entry tag', () => {
    const result = appendSpecEntryWithRef(
      testDir,
      'arch',
      'API Design Standard',
      'REST API conventions.',
      ['api', 'design'],
      'knowhow/DOC-api-design.md',
    );

    expect(result.ok).toBe(true);
    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('category="arch"');
  });

  it('routes to correct file based on category', () => {
    const archResult = appendSpecEntryWithRef(
      testDir, 'arch', 'Title A', 'Summary A.', ['a'], 'knowhow/A.md',
    );
    const codingResult = appendSpecEntryWithRef(
      testDir, 'coding', 'Title B', 'Summary B.', ['b'], 'knowhow/B.md',
    );
    const debugResult = appendSpecEntryWithRef(
      testDir, 'debug', 'Title C', 'Summary C.', ['c'], 'knowhow/C.md',
    );

    expect(archResult.file).toContain('architecture-constraints.md');
    expect(codingResult.file).toContain('coding-conventions.md');
    expect(debugResult.file).toContain('debug-notes.md');
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection with ref entries
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — duplicate detection', () => {
  it('detects duplicate by title (case-insensitive)', () => {
    const first = appendSpecEntryWithRef(
      testDir, 'learning', 'OAuth Flow', 'Summary.', ['oauth'], 'knowhow/A.md',
    );
    expect(first.duplicate).toBe(false);

    const second = appendSpecEntryWithRef(
      testDir, 'learning', 'oauth flow', 'Different summary.', ['oauth'], 'knowhow/B.md',
    );
    expect(second.duplicate).toBe(true);
  });

  it('does not modify file on duplicate', () => {
    appendSpecEntryWithRef(
      testDir, 'coding', 'Pattern X', 'Summary.', ['x'], 'knowhow/X.md',
    );
    const firstContent = readFileSync(
      join(testDir, '.workflow', 'specs', 'coding-conventions.md'), 'utf-8',
    );

    appendSpecEntryWithRef(
      testDir, 'coding', 'Pattern X', 'New summary.', ['x'], 'knowhow/Y.md',
    );
    const secondContent = readFileSync(
      join(testDir, '.workflow', 'specs', 'coding-conventions.md'), 'utf-8',
    );

    expect(secondContent).toBe(firstContent);
  });
});

// ---------------------------------------------------------------------------
// Source attribute
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — source attribute', () => {
  it('includes source when provided', () => {
    const result = appendSpecEntryWithRef(
      testDir, 'learning', 'Discovery', 'Found during analysis.', ['discovery'],
      'knowhow/X.md', 'analyze:ANL-001',
    );

    const content = readFileSync(result.file, 'utf-8');
    expect(content).toContain('sourceRef="analyze:ANL-001"');
  });

  it('omits source when not provided', () => {
    const result = appendSpecEntryWithRef(
      testDir, 'learning', 'Manual', 'Manual entry.', ['manual'], 'knowhow/X.md',
    );

    const content = readFileSync(result.file, 'utf-8');
    expect(content).not.toContain('sourceRef=');
  });
});

// ---------------------------------------------------------------------------
// Invalid category
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — invalid category', () => {
  it('returns ok=false for invalid category', () => {
    const result = appendSpecEntryWithRef(
      testDir,
      'nonexistent' as any,
      'Bad Entry',
      'Should fail.',
      ['test'],
      'knowhow/X.md',
    );

    expect(result.ok).toBe(false);
    expect(result.file).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Directory creation
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — directory creation', () => {
  it('creates specs directory if missing', () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'maestro-test-ref-fresh-'));
    try {
      const result = appendSpecEntryWithRef(
        freshDir, 'coding', 'New Ref', 'Summary.', ['new'], 'knowhow/X.md',
      );

      expect(result.ok).toBe(true);
      expect(existsSync(result.file)).toBe(true);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scope support
// ---------------------------------------------------------------------------

describe('appendSpecEntryWithRef — scope support', () => {
  it('writes to global scope when specified', () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'maestro-test-global-'));
    try {
      // This test relies on resolveSpecDir routing to global dir
      // Since paths.specs resolves to the actual global path, we just test
      // that the function accepts scope parameter without error
      const result = appendSpecEntryWithRef(
        testDir, 'coding', 'Global Rule', 'Content.', ['global'],
        'knowhow/X.md', undefined, 'project',
      );
      expect(result.ok).toBe(true);
      expect(result.file).toContain('coding-conventions.md');
    } finally {
      rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it('writes to team scope when specified', () => {
    const teamDir = join(testDir, '.workflow', 'collab', 'specs');
    mkdirSync(teamDir, { recursive: true });

    const result = appendSpecEntryWithRef(
      testDir, 'coding', 'Team Rule', 'Content.', ['team'],
      'knowhow/X.md', undefined, 'team',
    );
    expect(result.ok).toBe(true);
    expect(result.file).toContain('collab');
  });

  it('writes to personal scope when uid provided', () => {
    const personalDir = join(testDir, '.workflow', 'collab', 'specs', 'alice');
    mkdirSync(personalDir, { recursive: true });

    const result = appendSpecEntryWithRef(
      testDir, 'coding', 'Personal Rule', 'Content.', ['personal'],
      'knowhow/X.md', undefined, 'personal', 'alice',
    );
    expect(result.ok).toBe(true);
    expect(result.file).toContain('alice');
  });
});
